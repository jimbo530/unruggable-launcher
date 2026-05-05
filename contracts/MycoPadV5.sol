// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Unruggable1 — Unruggable Token Launcher (BTC/ETH floors)
///
/// Two-step launch:
///   Step 1 — launchStep1(): Deploy token, swap USDC into floor assets,
///            create 3 floor pools (AZUSD/cbBTC/WETH) + 3 MfT sell walls.
///   Step 2 — launchStep2(): Create CHAR reactor + primary reactor, lock positions.
///
/// V5 changes from V4: floors use cbBTC and WETH directly instead of BB/EB.

import "./LaunchToken.sol";

// ═══════════════════════════════════════════════════════════════════════════
//  Interfaces
// ═══════════════════════════════════════════════════════════════════════════

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniswapV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }
    function mint(MintParams calldata) external payable returns (
        uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1
    );
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256);
}

interface IAeroRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        int24   tickSpacing;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256);
}

interface ISporeReactor {
    function initialize(address _token, address _mft, address _pm, address _router, address _factory, address _upstreamReactor) external;
    function addPool(uint256 tokenId) external;
    function transferAdmin(address newAdmin) external;
}

// ═══════════════════════════════════════════════════════════════════════════

contract Unruggable1 {

    // ── Immutables ────────────────────────────────────────────────────────
    address public immutable weth;
    address public immutable usdc;
    address public immutable azusd;
    address public immutable wrappedBtc;      // cbBTC — used directly as floor
    address public immutable mft;
    address public immutable char;

    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;

    address public immutable reactorImpl;
    address public immutable upstreamReactor;
    address public immutable charUpstream;

    address public immutable aeroRouter;
    uint24  public immutable wethUsdcFee;
    int24   public immutable aeroTickSpacing;
    uint24  public immutable wethBtcFee;
    uint24  public immutable mftPriceFee;

    address public owner;

    // ── Constants ─────────────────────────────────────────────────────────
    string  constant METADATA_BASE = "https://tasern.quest/api/unruggable/metadata/";
    uint24  constant FEE_TIER   = 10000;
    uint24  constant CHAR_FEE   = 10000;
    int24   constant TICK_SPACE = 200;
    int24   constant TICK_MIN   = -887200;
    int24   constant TICK_MAX   =  887200;

    uint256 constant TOKENS_PER_USDC_RAW = 1e19;

    // Seed split ratios (BPS of 10000)
    uint256 constant SEED_FLOOR = 9400;
    uint256 constant SEED_CHAR  = 600;
    uint256 constant SEED_AZUSD = 4000;    // 40% of floor -> AZUSD
    uint256 constant SEED_BTC   = 3000;    // 30% of floor -> cbBTC
    uint256 constant SEED_ETH   = 3000;    // 30% of floor -> WETH

    // MfT wall tick offsets
    int24 constant WALL_1_1X = 1000;
    int24 constant WALL_2X   = 7000;
    int24 constant WALL_5X   = 16200;

    uint256 public minSeed = 1_000_000;

    // ── Registry ──────────────────────────────────────────────────────────
    mapping(address => bool)    public isReactor;
    mapping(address => address) public reactorOf;
    mapping(address => address) public charReactorOf;

    // ── Pending launch ────────────────────────────────────────────────────
    struct Pending {
        address token;
        address upstream;
        uint256 totalSupply;
        uint256 usdcAmount;
        uint256 floorAzusdId;
        uint256 floorBtcId;
        uint256 floorEthId;
        uint256 mftWall1Id;
        uint256 mftWall2Id;
        uint256 mftWall3Id;
        uint256 charUsdc;
    }
    mapping(address => Pending) public pending;

    struct Launch {
        address token;
        address reactor;
        address charReactor;
        address launcher;
        uint256 supply;
        uint256 seed;
        uint256 timestamp;
    }
    Launch[] public launches;

    event TokenLaunched(
        address indexed token,
        address indexed reactor,
        address indexed charReactor,
        address launcher,
        string  name,
        string  symbol,
        uint256 supply,
        uint256 seed
    );

    // ═══════════════════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _weth,
        address _usdc,
        address _azusd,
        address _wrappedBtc,
        address _mft,
        address _char,
        address _v3Factory,
        address _pm,
        address _router,
        address _aeroRouter,
        address _reactorImpl,
        address _upstreamReactor,
        address _charUpstream,
        uint24  _wethUsdcFee,
        int24   _aeroTickSpacing,
        uint24  _wethBtcFee,
        uint24  _mftPriceFee
    ) {
        weth             = _weth;
        usdc             = _usdc;
        azusd            = _azusd;
        wrappedBtc       = _wrappedBtc;
        mft              = _mft;
        char             = _char;
        v3Factory        = _v3Factory;
        positionManager  = _pm;
        swapRouter       = _router;
        aeroRouter       = _aeroRouter;
        reactorImpl      = _reactorImpl;
        upstreamReactor  = _upstreamReactor;
        charUpstream     = _charUpstream;
        wethUsdcFee      = _wethUsdcFee;
        aeroTickSpacing  = _aeroTickSpacing;
        wethBtcFee       = _wethBtcFee;
        mftPriceFee      = _mftPriceFee;
        owner            = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — Step 1
    // ═══════════════════════════════════════════════════════════════════════

    function launchStep1(
        string calldata _name,
        string calldata _symbol,
        uint256 _totalSupply,
        uint256 _usdcAmount,
        address _customUpstream
    ) external returns (address tokenAddr) {
        require(_usdcAmount >= minSeed);
        require(_totalSupply >= 1e18);
        require(pending[msg.sender].token == address(0));

        address primaryUpstream = (_customUpstream != address(0) && isReactor[_customUpstream])
            ? _customUpstream : upstreamReactor;

        IERC20(usdc).transferFrom(msg.sender, address(this), _usdcAmount);

        tokenAddr = address(new LaunchToken(_name, _symbol, _totalSupply, address(this), METADATA_BASE));

        uint256 floorUsdc = _usdcAmount * SEED_FLOOR / 10000;
        uint256 charUsdc  = _usdcAmount - floorUsdc;

        // Swap floor USDC -> floor assets (AZUSD, cbBTC, WETH)
        (uint256 azusdAmount, uint256 btcAmount, uint256 ethAmount) = _prepareFloorSeed(floorUsdc);

        uint256 totalFloorTokens = floorUsdc * TOKENS_PER_USDC_RAW;
        require(totalFloorTokens < _totalSupply);

        uint256 azusdFloorTokens = totalFloorTokens * SEED_AZUSD / 10000;
        uint256 btcFloorTokens   = totalFloorTokens * SEED_BTC / 10000;
        uint256 ethFloorTokens   = totalFloorTokens - azusdFloorTokens - btcFloorTokens;

        uint256 floorAzusdId = _createFloorPool(tokenAddr, azusd, azusdFloorTokens, azusdAmount);
        uint256 floorBtcId   = _createFloorPool(tokenAddr, wrappedBtc, btcFloorTokens, btcAmount);
        uint256 floorEthId   = _createFloorPool(tokenAddr, weth, ethFloorTokens, ethAmount);

        uint256 curveSupply = _totalSupply - totalFloorTokens;
        (uint256 mftWall1Id, uint256 mftWall2Id, uint256 mftWall3Id) = _createMftWalls(
            tokenAddr, curveSupply, ethFloorTokens, floorUsdc * SEED_ETH / 10000
        );

        pending[msg.sender] = Pending({
            token:         tokenAddr,
            upstream:      primaryUpstream,
            totalSupply:   _totalSupply,
            usdcAmount:    _usdcAmount,
            floorAzusdId:  floorAzusdId,
            floorBtcId:    floorBtcId,
            floorEthId:    floorEthId,
            mftWall1Id:    mftWall1Id,
            mftWall2Id:    mftWall2Id,
            mftWall3Id:    mftWall3Id,
            charUsdc:      charUsdc
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — Step 2
    // ═══════════════════════════════════════════════════════════════════════

    function launchStep2(
        string calldata _name,
        string calldata _symbol
    ) external returns (address reactorAddr, address charReactorAddr) {
        Pending memory p = pending[msg.sender];
        require(p.token != address(0));

        charReactorAddr = _setupCharReactor(p.charUsdc, p.upstream);

        reactorAddr = _setupReactor(
            p.token, p.floorAzusdId, p.floorBtcId, p.floorEthId,
            p.mftWall1Id, p.mftWall2Id, p.mftWall3Id, charReactorAddr
        );

        isReactor[reactorAddr] = true;
        isReactor[charReactorAddr] = true;
        reactorOf[msg.sender] = reactorAddr;
        charReactorOf[msg.sender] = charReactorAddr;

        _refundDust(p.token, msg.sender);

        launches.push(Launch({
            token: p.token, reactor: reactorAddr, charReactor: charReactorAddr,
            launcher: msg.sender, supply: p.totalSupply, seed: p.usdcAmount,
            timestamp: block.timestamp
        }));

        emit TokenLaunched(p.token, reactorAddr, charReactorAddr, msg.sender, _name, _symbol, p.totalSupply, p.usdcAmount);

        delete pending[msg.sender];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — prepare floor seed (USDC -> AZUSD, cbBTC, WETH)
    // ═══════════════════════════════════════════════════════════════════════

    function _prepareFloorSeed(uint256 usdcAmount) internal returns (
        uint256 azusdAmt, uint256 btcAmt, uint256 ethAmt
    ) {
        // Swap all floor USDC to WETH first
        IERC20(usdc).approve(swapRouter, usdcAmount);
        uint256 wethTotal = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: usdc, tokenOut: weth, fee: wethUsdcFee,
                recipient: address(this), amountIn: usdcAmount,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        uint256 forAzusd = wethTotal * SEED_AZUSD / 10000;
        uint256 forBtc   = wethTotal * SEED_BTC / 10000;
        ethAmt           = wethTotal - forAzusd - forBtc; // WETH kept directly

        // WETH -> USDC -> AZUSD (via Aerodrome)
        IERC20(weth).approve(swapRouter, forAzusd + forBtc);
        uint256 usdcForAzusd = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: weth, tokenOut: usdc, fee: wethUsdcFee,
                recipient: address(this), amountIn: forAzusd,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        IERC20(usdc).approve(aeroRouter, usdcForAzusd);
        azusdAmt = IAeroRouter(aeroRouter).exactInputSingle(
            IAeroRouter.ExactInputSingleParams({
                tokenIn: usdc, tokenOut: azusd, tickSpacing: aeroTickSpacing,
                recipient: address(this), deadline: block.timestamp,
                amountIn: usdcForAzusd, amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        // WETH -> cbBTC (direct)
        btcAmt = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: weth, tokenOut: wrappedBtc, fee: wethBtcFee,
                recipient: address(this), amountIn: forBtc,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — CHAR reactor setup (CHAR/cbBTC, CHAR/WETH, CHAR/MfT)
    // ═══════════════════════════════════════════════════════════════════════

    function _setupCharReactor(uint256 charUsdc, address charUpstreamAddr) internal returns (address charReactorAddr) {
        // Convert all CHAR USDC to WETH
        IERC20(usdc).approve(swapRouter, charUsdc);
        uint256 charWeth = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: usdc, tokenOut: weth, fee: wethUsdcFee,
                recipient: address(this), amountIn: charUsdc,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        uint256 wethPerPool = charWeth / 3;

        // Pool 1: CHAR/cbBTC — buy cbBTC, swap half for CHAR
        IERC20(weth).approve(swapRouter, charWeth);
        uint256 btcTotal = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: weth, tokenOut: wrappedBtc, fee: wethBtcFee,
                recipient: address(this), amountIn: wethPerPool,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        uint256 btcForPool = btcTotal / 2;
        uint256 btcForChar = btcTotal - btcForPool;
        IERC20(wrappedBtc).approve(swapRouter, btcForChar);
        uint256 charFromBtc = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: wrappedBtc, tokenOut: char, fee: CHAR_FEE,
                recipient: address(this), amountIn: btcForChar,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        uint256 charBtcId = _createCharPool(char, wrappedBtc, charFromBtc, btcForPool);

        // Pool 2: CHAR/WETH — swap half WETH for CHAR
        uint256 ethForPool = wethPerPool / 2;
        uint256 ethForChar = wethPerPool - ethForPool;
        IERC20(weth).approve(swapRouter, ethForChar);
        uint256 charFromEth = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: weth, tokenOut: char, fee: CHAR_FEE,
                recipient: address(this), amountIn: ethForChar,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        uint256 charEthId = _createCharPool(char, weth, charFromEth, ethForPool);

        // Pool 3: CHAR/MfT — buy MfT via AZUSD, swap half for CHAR
        uint256 remainingWeth = charWeth - wethPerPool - wethPerPool;
        uint256 mftTotal = _buyMft(remainingWeth);
        uint256 mftForPool = mftTotal / 2;
        uint256 mftForChar = mftTotal - mftForPool;
        IERC20(mft).approve(swapRouter, mftForChar);
        uint256 charFromMft = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: mft, tokenOut: char, fee: CHAR_FEE,
                recipient: address(this), amountIn: mftForChar,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        uint256 charMftId = _createCharPool(char, mft, charFromMft, mftForPool);

        // Clone and setup CHAR reactor
        charReactorAddr = _cloneReactor();
        ISporeReactor(charReactorAddr).initialize(char, mft, positionManager, swapRouter, v3Factory, charUpstreamAddr);

        _transferNFT(charBtcId, charReactorAddr);
        ISporeReactor(charReactorAddr).addPool(charBtcId);

        _transferNFT(charEthId, charReactorAddr);
        ISporeReactor(charReactorAddr).addPool(charEthId);

        _transferNFT(charMftId, charReactorAddr);
        ISporeReactor(charReactorAddr).addPool(charMftId);
    }

    /// @dev Buy MfT: WETH -> USDC -> AZUSD -> MfT
    function _buyMft(uint256 wethAmt) internal returns (uint256 mftAmt) {
        IERC20(weth).approve(swapRouter, wethAmt);
        uint256 usdcAmt = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: weth, tokenOut: usdc, fee: wethUsdcFee,
                recipient: address(this), amountIn: wethAmt,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        IERC20(usdc).approve(aeroRouter, usdcAmt);
        uint256 azusdAmt = IAeroRouter(aeroRouter).exactInputSingle(
            IAeroRouter.ExactInputSingleParams({
                tokenIn: usdc, tokenOut: azusd, tickSpacing: aeroTickSpacing,
                recipient: address(this), deadline: block.timestamp,
                amountIn: usdcAmt, amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        IERC20(azusd).approve(swapRouter, azusdAmt);
        mftAmt = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: azusd, tokenOut: mft, fee: mftPriceFee,
                recipient: address(this), amountIn: azusdAmt,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
    }

    /// @dev Create a CHAR/X pool position (uses existing pool, full range)
    function _createCharPool(
        address charToken,
        address xToken,
        uint256 charAmount,
        uint256 xAmount
    ) internal returns (uint256 positionId) {
        bool charIs0 = charToken < xToken;
        address token0 = charIs0 ? charToken : xToken;
        address token1 = charIs0 ? xToken : charToken;
        uint256 t0 = charIs0 ? charAmount : xAmount;
        uint256 t1 = charIs0 ? xAmount : charAmount;

        address pool = IUniswapV3Factory(v3Factory).getPool(token0, token1, CHAR_FEE);
        if (pool == address(0)) {
            pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, CHAR_FEE);
            IUniswapV3Pool(pool).initialize(_calcSqrtPrice(t0, t1));
        }

        IERC20(token0).approve(positionManager, t0);
        IERC20(token1).approve(positionManager, t1);

        (positionId,,,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: CHAR_FEE,
                tickLower: TICK_MIN, tickUpper: TICK_MAX,
                amount0Desired: t0, amount1Desired: t1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — create floor pool
    // ═══════════════════════════════════════════════════════════════════════

    function _createFloorPool(
        address tokenAddr,
        address baseAsset,
        uint256 tokenAmount,
        uint256 baseAmount
    ) internal returns (uint256 positionId) {
        bool tokenIs0 = tokenAddr < baseAsset;
        address token0 = tokenIs0 ? tokenAddr : baseAsset;
        address token1 = tokenIs0 ? baseAsset : tokenAddr;
        uint256 t0 = tokenIs0 ? tokenAmount : baseAmount;
        uint256 t1 = tokenIs0 ? baseAmount : tokenAmount;

        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(_calcSqrtPrice(t0, t1));

        IERC20(token0).approve(positionManager, t0);
        IERC20(token1).approve(positionManager, t1);

        (positionId,,,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: FEE_TIER,
                tickLower: TICK_MIN, tickUpper: TICK_MAX,
                amount0Desired: t0, amount1Desired: t1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — 3 MfT sell walls at 1.1x / 2x / 5x launch price
    // ═══════════════════════════════════════════════════════════════════════

    function _createMftWalls(
        address tokenAddr,
        uint256 curveSupply,
        uint256 floorTokens,
        uint256 floorUsdc6
    ) internal returns (uint256 id1, uint256 id2, uint256 id3) {
        bool tokenIs0 = tokenAddr < mft;
        address token0 = tokenIs0 ? tokenAddr : mft;
        address token1 = tokenIs0 ? mft : tokenAddr;

        uint160 sqrtPrice = _deriveMftPrice(tokenIs0, floorTokens, floorUsdc6);

        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(sqrtPrice);

        (, int24 currentTick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 base = (currentTick / TICK_SPACE) * TICK_SPACE;

        uint256 s1 = curveSupply / 3;
        uint256 s2 = curveSupply / 3;
        uint256 s3 = curveSupply - s1 - s2;

        if (tokenIs0) {
            int24 t1 = base + WALL_1_1X;
            int24 t2 = base + WALL_2X;
            int24 t5 = base + WALL_5X;
            if (t5 >= TICK_MAX) t5 = TICK_MAX - TICK_SPACE;

            IERC20(token0).approve(positionManager, s1);
            (id1,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: t1, tickUpper: t2,
                    amount0Desired: s1, amount1Desired: 0,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );

            IERC20(token0).approve(positionManager, s2);
            (id2,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: t2, tickUpper: t5,
                    amount0Desired: s2, amount1Desired: 0,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );

            IERC20(token0).approve(positionManager, s3);
            (id3,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: t5, tickUpper: TICK_MAX,
                    amount0Desired: s3, amount1Desired: 0,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );
        } else {
            int24 t1 = base - WALL_1_1X;
            int24 t2 = base - WALL_2X;
            int24 t5 = base - WALL_5X;
            if (t5 <= TICK_MIN) t5 = TICK_MIN + TICK_SPACE;

            IERC20(token1).approve(positionManager, s1);
            (id1,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: t2, tickUpper: t1,
                    amount0Desired: 0, amount1Desired: s1,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );

            IERC20(token1).approve(positionManager, s2);
            (id2,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: t5, tickUpper: t2,
                    amount0Desired: 0, amount1Desired: s2,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );

            IERC20(token1).approve(positionManager, s3);
            (id3,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: TICK_MIN, tickUpper: t5,
                    amount0Desired: 0, amount1Desired: s3,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );
        }
    }

    function _deriveMftPrice(
        bool tokenIs0InMftPool,
        uint256 floorTokens,
        uint256 floorUsdc6
    ) internal view returns (uint160) {
        address mftPool = IUniswapV3Factory(v3Factory).getPool(azusd, mft, mftPriceFee);
        require(mftPool != address(0));
        (uint160 sqrtPriceMft,,,,,,) = IUniswapV3Pool(mftPool).slot0();

        uint256 azusdEquiv = floorUsdc6 * 1e12;
        uint256 equivalentMft = _convertViaPool(azusdEquiv, sqrtPriceMft, azusd < mft);
        equivalentMft = equivalentMft * 11 / 10;

        if (tokenIs0InMftPool) {
            return _calcSqrtPrice(floorTokens, equivalentMft);
        } else {
            return _calcSqrtPrice(equivalentMft, floorTokens);
        }
    }

    function _convertViaPool(uint256 amount, uint160 sqrtPriceX96, bool inputIs0) internal pure returns (uint256) {
        uint256 sqrtP = uint256(sqrtPriceX96);
        if (inputIs0) {
            return (amount * sqrtP >> 96) * sqrtP >> 96;
        } else {
            return (amount << 96) / sqrtP * (1 << 96) / sqrtP;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — setup primary reactor
    // ═══════════════════════════════════════════════════════════════════════

    function _setupReactor(
        address tokenAddr,
        uint256 azusdId,
        uint256 btcId,
        uint256 ethId,
        uint256 mftWall1,
        uint256 mftWall2,
        uint256 mftWall3,
        address upstream
    ) internal returns (address reactorAddr) {
        reactorAddr = _cloneReactor();
        ISporeReactor(reactorAddr).initialize(tokenAddr, mft, positionManager, swapRouter, v3Factory, upstream);

        _transferNFT(azusdId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(azusdId);
        _transferNFT(btcId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(btcId);
        _transferNFT(ethId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(ethId);
        _transferNFT(mftWall1, reactorAddr);
        ISporeReactor(reactorAddr).addPool(mftWall1);
        _transferNFT(mftWall2, reactorAddr);
        ISporeReactor(reactorAddr).addPool(mftWall2);
        _transferNFT(mftWall3, reactorAddr);
        ISporeReactor(reactorAddr).addPool(mftWall3);
    }

    function _cloneReactor() internal returns (address instance) {
        address impl = reactorImpl;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Math
    // ═══════════════════════════════════════════════════════════════════════

    function _calcSqrtPrice(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0);
        uint256 s1 = _sqrt(amount1);
        uint256 s0 = _sqrt(amount0);
        uint256 result = (s1 << 96) / s0;
        require(result > 0 && result <= type(uint160).max);
        return uint160(result);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════════════════════════════════

    function _transferNFT(uint256 tokenId, address to) internal {
        (bool success,) = positionManager.call(
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", address(this), to, tokenId)
        );
        require(success);
    }

    function _refundDust(address tokenAddr, address to) internal {
        address[7] memory tokens = [tokenAddr, weth, usdc, azusd, wrappedBtc, char, mft];
        for (uint256 i; i < 7; ++i) {
            uint256 bal = IERC20(tokens[i]).balanceOf(address(this));
            if (bal > 0) IERC20(tokens[i]).transfer(to, bal);
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Cancel pending launch
    // ═══════════════════════════════════════════════════════════════════════

    function cancelPending() external {
        Pending memory p = pending[msg.sender];
        require(p.token != address(0));
        delete pending[msg.sender];
        IERC20(usdc).transfer(msg.sender, p.charUsdc);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════════════════════════════════

    function addPoolToReactor(address reactor, uint256 tokenId) external {
        require(msg.sender == owner);
        (bool pulled,) = positionManager.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), tokenId)
        );
        require(pulled);
        _transferNFT(tokenId, reactor);
        ISporeReactor(reactor).addPool(tokenId);
    }

    function transferReactorAdmin(address reactor, address newAdmin) external {
        require(msg.sender == owner);
        ISporeReactor(reactor).transferAdmin(newAdmin);
    }

    function setMinSeed(uint256 _minSeed) external {
        require(msg.sender == owner);
        minSeed = _minSeed;
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner);
        owner = newOwner;
    }

    function rescue(address _token) external {
        require(msg.sender == owner);
        uint256 bal = IERC20(_token).balanceOf(address(this));
        if (bal > 0) IERC20(_token).transfer(owner, bal);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════════════════════════════════

    function launchCount() external view returns (uint256) {
        return launches.length;
    }

    function getLaunch(uint256 index) external view returns (
        address token, address reactor, address charReactor, address launcher,
        uint256 supply, uint256 seed, uint256 timestamp
    ) {
        Launch storage l = launches[index];
        return (l.token, l.reactor, l.charReactor, l.launcher, l.supply, l.seed, l.timestamp);
    }
}
