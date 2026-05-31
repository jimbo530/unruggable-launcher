// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Unruggable2 — Unruggable Token Launcher (BTC/ETH/USDC floors)
///
/// Two-step launch:
///   Step 1 — launchStep1(): Deploy token, swap USDC into floor assets,
///            create 3 floor pools (USDC/cbBTC/WETH) + 3 MfT sell walls.
///   Step 2 — launchStep2(): Create CHAR reactor + primary reactor, lock positions.
///
/// Reactor chain: token reactor -> CHAR reactor -> prime / invitation upstream
///
/// V5.3 changes from V5.2:
///   - AZUSD floor replaced with USDC floor (AZUSD depegged)
///   - Removed Aerodrome router + USDC->AZUSD swap (40% USDC stays as USDC)
///   - MfT pricing uses WETH/MfT + USDC/WETH pools instead of AZUSD/MfT
///   - 3 fewer constructor params (azusd, aeroRouter, aeroTickSpacing)
///   - Only 2 floor swaps instead of 3 (USDC->cbBTC, USDC->WETH)

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

interface ISporeReactor {
    function initialize(address _token, address _mft, address _pm, address _router, address _factory, address _upstreamReactor) external;
    function addPool(uint256 tokenId) external;
    function transferAdmin(address newAdmin) external;
}

// ═══════════════════════════════════════════════════════════════════════════

contract Unruggable2 {

    // ── Immutables ────────────────────────────────────────────────────────
    address public immutable weth;
    address public immutable usdc;
    address public immutable wrappedBtc;
    address public immutable mft;
    address public immutable char;

    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;

    address public immutable reactorImpl;
    address public immutable upstreamReactor;

    uint24  public immutable wethUsdcFee;
    uint24  public immutable mftWethFee;
    uint24  public immutable charUsdcFee;
    uint24  public immutable usdcBtcFee;

    address public owner;

    // ── Constants ─────────────────────────────────────────────────────────
    string  constant METADATA_BASE = "https://tasern.quest/api/unruggable/metadata/";
    uint24  constant FEE_TIER      = 10000;
    uint24  constant CHAR_FEE      = 10000;
    int24   constant TICK_SPACE    = 200;
    int24   constant TICK_MIN      = -887200;
    int24   constant TICK_MAX      =  887200;

    uint256 constant TOKENS_PER_USDC_RAW = 1e19;

    // Seed split ratios (BPS of 10000)
    uint256 constant SEED_FLOOR = 9400;
    uint256 constant SEED_CHAR  = 600;
    uint256 constant SEED_USDC  = 4000;    // 40% of floor -> USDC (direct, no swap)
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
        uint256 floorUsdcId;
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
        address _wrappedBtc,
        address _mft,
        address _char,
        address _v3Factory,
        address _pm,
        address _router,
        address _reactorImpl,
        address _upstreamReactor,
        uint24  _wethUsdcFee,
        uint24  _mftWethFee,
        uint24  _charUsdcFee,
        uint24  _usdcBtcFee
    ) {
        weth             = _weth;
        usdc             = _usdc;
        wrappedBtc       = _wrappedBtc;
        mft              = _mft;
        char             = _char;
        v3Factory        = _v3Factory;
        positionManager  = _pm;
        swapRouter       = _router;
        reactorImpl      = _reactorImpl;
        upstreamReactor  = _upstreamReactor;
        wethUsdcFee      = _wethUsdcFee;
        mftWethFee       = _mftWethFee;
        charUsdcFee      = _charUsdcFee;
        usdcBtcFee       = _usdcBtcFee;
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

        // Swap floor USDC -> floor assets (keep USDC, buy cbBTC + WETH)
        (uint256 usdcKeep, uint256 btcAmount, uint256 ethAmount) = _prepareFloorSeed(floorUsdc);

        uint256 totalFloorTokens = floorUsdc * TOKENS_PER_USDC_RAW;
        require(totalFloorTokens < _totalSupply);

        uint256 usdcFloorTokens = totalFloorTokens * SEED_USDC / 10000;
        uint256 btcFloorTokens  = totalFloorTokens * SEED_BTC / 10000;
        uint256 ethFloorTokens  = totalFloorTokens - usdcFloorTokens - btcFloorTokens;

        uint256 floorUsdcId = _createFloorPool(tokenAddr, usdc, usdcFloorTokens, usdcKeep);
        uint256 floorBtcId  = _createFloorPool(tokenAddr, wrappedBtc, btcFloorTokens, btcAmount);
        uint256 floorEthId  = _createFloorPool(tokenAddr, weth, ethFloorTokens, ethAmount);

        uint256 curveSupply = _totalSupply - totalFloorTokens;
        (uint256 mftWall1Id, uint256 mftWall2Id, uint256 mftWall3Id) = _createMftWalls(
            tokenAddr, curveSupply, ethFloorTokens, floorUsdc * SEED_ETH / 10000
        );

        pending[msg.sender] = Pending({
            token:        tokenAddr,
            upstream:     primaryUpstream,
            totalSupply:  _totalSupply,
            usdcAmount:   _usdcAmount,
            floorUsdcId:  floorUsdcId,
            floorBtcId:   floorBtcId,
            floorEthId:   floorEthId,
            mftWall1Id:   mftWall1Id,
            mftWall2Id:   mftWall2Id,
            mftWall3Id:   mftWall3Id,
            charUsdc:     charUsdc
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

        delete pending[msg.sender];

        charReactorAddr = _setupCharReactor(p.charUsdc, p.upstream);

        reactorAddr = _setupReactor(
            p.token, p.floorUsdcId, p.floorBtcId, p.floorEthId,
            p.mftWall1Id, p.mftWall2Id, p.mftWall3Id, charReactorAddr
        );

        isReactor[reactorAddr] = true;
        isReactor[charReactorAddr] = true;
        reactorOf[p.token] = reactorAddr;
        charReactorOf[p.token] = charReactorAddr;

        _refundDust(p.token, msg.sender);

        launches.push(Launch({
            token: p.token, reactor: reactorAddr, charReactor: charReactorAddr,
            launcher: msg.sender, supply: p.totalSupply, seed: p.usdcAmount,
            timestamp: block.timestamp
        }));

        emit TokenLaunched(p.token, reactorAddr, charReactorAddr, msg.sender, _name, _symbol, p.totalSupply, p.usdcAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — prepare floor seed (keep USDC, buy cbBTC + WETH)
    // ═══════════════════════════════════════════════════════════════════════

    function _prepareFloorSeed(uint256 usdcAmount) internal returns (
        uint256 usdcKeep, uint256 btcAmt, uint256 ethAmt
    ) {
        usdcKeep = usdcAmount * SEED_USDC / 10000;             // 40% stays as USDC
        uint256 usdcForBtc  = usdcAmount * SEED_BTC / 10000;   // 30%
        uint256 usdcForWeth = usdcAmount - usdcKeep - usdcForBtc; // 30%

        // 1. USDC -> cbBTC directly
        IERC20(usdc).approve(swapRouter, usdcForBtc);
        btcAmt = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: usdc, tokenOut: wrappedBtc, fee: usdcBtcFee,
                recipient: address(this), amountIn: usdcForBtc,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        // 2. USDC -> WETH directly
        IERC20(usdc).approve(swapRouter, usdcForWeth);
        ethAmt = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: usdc, tokenOut: weth, fee: wethUsdcFee,
                recipient: address(this), amountIn: usdcForWeth,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — CHAR reactor setup (CHAR/cbBTC + CHAR/WETH)
    // ═══════════════════════════════════════════════════════════════════════

    function _setupCharReactor(uint256 charUsdc, address upstreamAddr) internal returns (address charReactorAddr) {
        uint256 usdcForChar  = charUsdc / 2;
        uint256 usdcForPairs = charUsdc - usdcForChar;

        IERC20(usdc).approve(swapRouter, usdcForChar);
        uint256 totalChar = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: usdc, tokenOut: char, fee: charUsdcFee,
                recipient: address(this), amountIn: usdcForChar,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        uint256 charForBtc = totalChar / 2;
        uint256 charForEth = totalChar - charForBtc;
        uint256 usdcForBtc = usdcForPairs / 2;
        uint256 usdcForEth = usdcForPairs - usdcForBtc;

        IERC20(usdc).approve(swapRouter, usdcForBtc);
        uint256 btcAmount = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: usdc, tokenOut: wrappedBtc, fee: usdcBtcFee,
                recipient: address(this), amountIn: usdcForBtc,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        uint256 charBtcId = _createCharPool(char, wrappedBtc, charForBtc, btcAmount);

        IERC20(usdc).approve(swapRouter, usdcForEth);
        uint256 ethAmount = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: usdc, tokenOut: weth, fee: wethUsdcFee,
                recipient: address(this), amountIn: usdcForEth,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        uint256 charEthId = _createCharPool(char, weth, charForEth, ethAmount);

        charReactorAddr = _cloneReactor();
        ISporeReactor(charReactorAddr).initialize(char, mft, positionManager, swapRouter, v3Factory, upstreamAddr);

        _transferNFT(charBtcId, charReactorAddr);
        ISporeReactor(charReactorAddr).addPool(charBtcId);

        _transferNFT(charEthId, charReactorAddr);
        ISporeReactor(charReactorAddr).addPool(charEthId);
    }

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

    /// @dev Derive MfT price for sell walls using WETH/MfT + USDC/WETH pools
    function _deriveMftPrice(
        bool tokenIs0InMftPool,
        uint256 floorTokens,
        uint256 floorUsdc6
    ) internal view returns (uint160) {
        // Get USDC/WETH price to convert USDC value to WETH
        address wethUsdcPool = IUniswapV3Factory(v3Factory).getPool(usdc, weth, wethUsdcFee);
        require(wethUsdcPool != address(0));
        (uint160 sqrtPriceWethUsdc,,,,,,) = IUniswapV3Pool(wethUsdcPool).slot0();
        uint256 wethEquiv = _convertViaPool(floorUsdc6, sqrtPriceWethUsdc, usdc < weth);

        // Get WETH/MfT price to convert WETH value to MfT
        address mftPool = IUniswapV3Factory(v3Factory).getPool(weth, mft, mftWethFee);
        require(mftPool != address(0));
        (uint160 sqrtPriceMft,,,,,,) = IUniswapV3Pool(mftPool).slot0();
        uint256 equivalentMft = _convertViaPool(wethEquiv, sqrtPriceMft, weth < mft);
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
        uint256 usdcId,
        uint256 btcId,
        uint256 ethId,
        uint256 mftWall1,
        uint256 mftWall2,
        uint256 mftWall3,
        address upstream
    ) internal returns (address reactorAddr) {
        reactorAddr = _cloneReactor();
        ISporeReactor(reactorAddr).initialize(tokenAddr, mft, positionManager, swapRouter, v3Factory, upstream);

        _transferNFT(usdcId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(usdcId);
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
        address[6] memory tokens = [tokenAddr, weth, usdc, wrappedBtc, char, mft];
        for (uint256 i; i < 6; ++i) {
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
