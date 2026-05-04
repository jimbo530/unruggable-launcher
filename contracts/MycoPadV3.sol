// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MycoPadV3 — MfT's Unruggable Token Launcher
///
/// Architecture (4 pools, fixed launch price):
///   1. Deploy token (all supply to factory)
///   2. Seed ETH -> wrap WETH -> split 40/30/30:
///      - 40% -> WETH->USDC(Uniswap)->AZUSD(Aerodrome) for stable floor
///      - 30% -> WETH->cbBTC->BB(Uniswap) for BTC-banded floor
///      - 30% -> WETH->EB(Uniswap) for ETH-banded floor
///   3. Fixed price $0.0000001/token — floor token amounts from seed value
///   4. Remaining supply -> single-sided TOKEN/MfT curve at 1.5x above floor
///   5. Clone SporeReactorV3, lock all 4 positions forever
///
/// BB/EB accumulate BTC/ETH backing via their own reactors.
/// Every launch creates buy pressure on both banding tokens.
/// 0% to launcher. 0% to treasury. 100% to markets.

import "./LaunchToken.sol";

// ═══════════════════════════════════════════════════════════════════════════
//  Interfaces
// ═══════════════════════════════════════════════════════════════════════════

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
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

    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata) external payable returns (uint256);
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

contract MycoPadV3 {

    // ── Immutables ────────────────────────────────────────────────────────
    address public immutable weth;
    address public immutable usdc;
    address public immutable azusd;
    address public immutable wrappedBtc;        // intermediate for WETH->cbBTC->BB route
    address public immutable mft;
    address public immutable bb;                // BTCband v3 — BTC-banded floor asset
    address public immutable eb;                // ETHband v3 — ETH-banded floor asset

    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;

    address public immutable reactorImpl;
    address public immutable upstreamReactor;

    address public immutable aeroRouter;
    uint24  public immutable wethUsdcFee;       // 500 — deep WETH/USDC pool
    int24   public immutable aeroTickSpacing;   // 50 — USDC/AZUSD Aerodrome pool
    uint24  public immutable wethBtcFee;        // 500 — WETH->cbBTC first hop
    uint24  public immutable btcBbFee;          // cbBTC->BB second hop
    uint24  public immutable wethEbFee;         // WETH->EB direct
    uint24  public immutable mftPriceFee;       // fee tier for AZUSD/MfT price oracle pool

    address public owner;

    // ── Constants ─────────────────────────────────────────────────────────
    string  constant METADATA_BASE = "https://tasern.quest/api/mycopad/metadata/";
    uint24  constant FEE_TIER   = 10000;    // 1% fee for new TOKEN pools
    int24   constant TICK_SPACE = 200;      // tick spacing for 1% fee
    int24   constant TICK_MIN   = -887200;
    int24   constant TICK_MAX   =  887200;

    // Fixed launch price: $0.0000001 per token
    // 1 raw USDC ($0.000001) buys 10 tokens = 10 * 1e18 = 1e19 raw TOKEN
    uint256 constant TOKENS_PER_USDC_RAW = 1e19;

    // Seed split ratios (BPS of 10000)
    uint256 constant SEED_AZUSD = 4000;   // 40% seed -> AZUSD
    uint256 constant SEED_BB    = 3000;   // 30% seed -> BB (via cbBTC)
    uint256 constant SEED_EB    = 3000;   // 30% seed -> EB (direct)

    uint256 public minSeed = 0.0001 ether;

    // ── Invite system ─────────────────────────────────────────────────────
    mapping(address => bool)    public isReactor;
    mapping(address => address) public reactorOf;

    // ── Registry ──────────────────────────────────────────────────────────
    struct Launch {
        address token;
        address reactor;
        address launcher;
        address upstream;
        uint256 supply;
        uint256 seed;
        uint256 timestamp;
    }
    Launch[] public launches;

    event TokenLaunched(
        address indexed token,
        address indexed reactor,
        address indexed launcher,
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
        address _bb,
        address _eb,
        address _v3Factory,
        address _pm,
        address _router,
        address _aeroRouter,
        address _reactorImpl,
        address _upstreamReactor,
        uint24  _wethUsdcFee,
        int24   _aeroTickSpacing,
        uint24  _wethBtcFee,
        uint24  _btcBbFee,
        uint24  _wethEbFee,
        uint24  _mftPriceFee
    ) {
        weth             = _weth;
        usdc             = _usdc;
        azusd            = _azusd;
        wrappedBtc       = _wrappedBtc;
        mft              = _mft;
        bb               = _bb;
        eb               = _eb;
        v3Factory        = _v3Factory;
        positionManager  = _pm;
        swapRouter       = _router;
        aeroRouter       = _aeroRouter;
        reactorImpl      = _reactorImpl;
        upstreamReactor  = _upstreamReactor;
        wethUsdcFee      = _wethUsdcFee;
        aeroTickSpacing  = _aeroTickSpacing;
        wethBtcFee       = _wethBtcFee;
        btcBbFee         = _btcBbFee;
        wethEbFee        = _wethEbFee;
        mftPriceFee      = _mftPriceFee;
        owner            = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch
    // ═══════════════════════════════════════════════════════════════════════

    function launch(
        string calldata _name,
        string calldata _symbol,
        uint256 _totalSupply,
        address _inviteReactor
    ) external payable returns (address tokenAddr, address reactorAddr) {
        require(msg.value >= minSeed, "seed too low");
        require(_totalSupply >= 1e18, "min 1 token");

        // 1. Resolve upstream
        address upstream = upstreamReactor;
        if (_inviteReactor != address(0)) {
            require(isReactor[_inviteReactor], "not a reactor");
            upstream = _inviteReactor;
        }

        // 2. Deploy token — all supply to this contract
        tokenAddr = address(new LaunchToken(_name, _symbol, _totalSupply, address(this), METADATA_BASE));

        // 3. Prepare seed: wrap ETH, swap to AZUSD/BB/EB
        (uint256 azusdAmount, uint256 bbAmount, uint256 ebAmount) = _prepareSeed(msg.value);

        // 4. Calculate floor token amounts at fixed $0.0000001 price
        address wethUsdcPool = IUniswapV3Factory(v3Factory).getPool(weth, usdc, wethUsdcFee);
        require(wethUsdcPool != address(0), "no WETH/USDC pool");
        (uint160 sqrtPriceWU,,,,,,) = IUniswapV3Pool(wethUsdcPool).slot0();

        // Total seed value in USDC -> total floor tokens at target price
        uint256 totalUsdc = _convertViaPool(msg.value, sqrtPriceWU, weth < usdc);
        uint256 totalFloorTokens = totalUsdc * TOKENS_PER_USDC_RAW;
        require(totalFloorTokens < _totalSupply, "seed too large for supply at this price");

        // Split floor tokens proportional to seed weights
        uint256 azusdFloorTokens = totalFloorTokens * SEED_AZUSD / 10000;
        uint256 bbFloorTokens    = totalFloorTokens * SEED_BB / 10000;
        uint256 ebFloorTokens    = totalFloorTokens - azusdFloorTokens - bbFloorTokens;

        uint256 curveSupply = _totalSupply - totalFloorTokens;

        // 5. Create 3 floor pools (two-sided, full range, priced at $0.0000001)
        uint256 floorAzusdId = _createFloorPool(tokenAddr, azusd, azusdFloorTokens, azusdAmount);
        uint256 floorBbId    = _createFloorPool(tokenAddr, bb,    bbFloorTokens,    bbAmount);
        uint256 floorEbId    = _createFloorPool(tokenAddr, eb,    ebFloorTokens,    ebAmount);

        // 6. Create MfT curve — remaining supply, 1.5x above floor, widest band
        uint256 ebFloorUsdc = totalUsdc * SEED_EB / 10000;
        uint256 mftCurveId = _createMftCurve(tokenAddr, curveSupply, ebFloorTokens, ebFloorUsdc);

        // 7. Deploy reactor, lock all 4 positions
        reactorAddr = _setupReactor(tokenAddr, floorAzusdId, floorBbId, floorEbId, mftCurveId, upstream);

        // 8. Register
        isReactor[reactorAddr] = true;
        reactorOf[msg.sender] = reactorAddr;

        // 9. Refund dust
        _refundDust(tokenAddr, msg.sender);

        // 10. Record
        launches.push(Launch({
            token: tokenAddr, reactor: reactorAddr, launcher: msg.sender,
            upstream: upstream, supply: _totalSupply, seed: msg.value,
            timestamp: block.timestamp
        }));

        emit TokenLaunched(tokenAddr, reactorAddr, msg.sender, _name, _symbol, _totalSupply, msg.value);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — prepare seed (wrap + swap to AZUSD, BB, EB)
    // ═══════════════════════════════════════════════════════════════════════

    function _prepareSeed(uint256 ethAmount) internal returns (
        uint256 azusdAmt, uint256 bbAmt, uint256 ebAmt
    ) {
        // Wrap all ETH to WETH
        IWETH(weth).deposit{value: ethAmount}();

        uint256 forAzusd = ethAmount * SEED_AZUSD / 10000;
        uint256 forBb    = ethAmount * SEED_BB / 10000;
        uint256 forEb    = ethAmount - forAzusd - forBb;

        // Approve all WETH to Uniswap router (covers AZUSD, BB, and EB swaps)
        IERC20(weth).approve(swapRouter, ethAmount);

        // Step 1: WETH -> USDC via Uniswap (deep 0.05% pool)
        uint256 usdcAmt = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           weth,
                tokenOut:          usdc,
                fee:               wethUsdcFee,
                recipient:         address(this),
                amountIn:          forAzusd,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: 0
            })
        );

        // Step 2: USDC -> AZUSD via Aerodrome (deep CL pool)
        IERC20(usdc).approve(aeroRouter, usdcAmt);
        azusdAmt = IAeroRouter(aeroRouter).exactInputSingle(
            IAeroRouter.ExactInputSingleParams({
                tokenIn:           usdc,
                tokenOut:          azusd,
                tickSpacing:       aeroTickSpacing,
                recipient:         address(this),
                deadline:          block.timestamp,
                amountIn:          usdcAmt,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: 0
            })
        );

        // Step 3: WETH -> cbBTC -> BB via Uniswap multi-hop
        bbAmt = ISwapRouter02(swapRouter).exactInput(
            ISwapRouter02.ExactInputParams({
                path: abi.encodePacked(weth, wethBtcFee, wrappedBtc, btcBbFee, bb),
                recipient: address(this),
                amountIn:  forBb,
                amountOutMinimum: 0
            })
        );

        // Step 4: WETH -> EB via Uniswap single-hop
        ebAmt = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           weth,
                tokenOut:          eb,
                fee:               wethEbFee,
                recipient:         address(this),
                amountIn:          forEb,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — create a two-sided floor pool (full range)
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

        // Create and initialize pool
        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(_calcSqrtPrice(t0, t1));

        // Approve position manager
        IERC20(token0).approve(positionManager, t0);
        IERC20(token1).approve(positionManager, t1);

        // Mint full-range position
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
    //  Internal — MfT curve (single-sided, 1.5x above floor, widest band)
    // ═══════════════════════════════════════════════════════════════════════

    function _createMftCurve(
        address tokenAddr,
        uint256 curveSupply,
        uint256 floorTokens,
        uint256 floorUsdc6
    ) internal returns (uint256 positionId) {
        bool tokenIs0 = tokenAddr < mft;
        address token0 = tokenIs0 ? tokenAddr : mft;
        address token1 = tokenIs0 ? mft : tokenAddr;

        // Derive TOKEN/MfT price at 1.5x above floor
        uint160 sqrtPrice = _deriveMftPrice(tokenIs0, floorTokens, floorUsdc6);

        // Create and initialize pool
        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(sqrtPrice);

        // Read actual tick after initialization
        (, int24 currentTick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 roundedTick = (currentTick / TICK_SPACE) * TICK_SPACE;

        // Single-sided position: widest possible band above current price
        int24 curveLower;
        int24 curveUpper;
        uint256 c0;
        uint256 c1;

        if (tokenIs0) {
            // TOKEN is token0 -> place above current tick (widest band to TICK_MAX)
            curveLower = roundedTick + TICK_SPACE;
            curveUpper = TICK_MAX;
            c0 = curveSupply;
            c1 = 0;
            IERC20(token0).approve(positionManager, c0);
        } else {
            // TOKEN is token1 -> place below current tick (widest band to TICK_MIN)
            curveLower = TICK_MIN;
            curveUpper = roundedTick - TICK_SPACE;
            c0 = 0;
            c1 = curveSupply;
            IERC20(token1).approve(positionManager, c1);
        }

        (positionId,,,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: FEE_TIER,
                tickLower: curveLower, tickUpper: curveUpper,
                amount0Desired: c0, amount1Desired: c1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );
    }

    /// @dev Derive TOKEN/MfT price at 1.5x above floor using on-chain MfT price
    function _deriveMftPrice(
        bool tokenIs0InMftPool,
        uint256 floorTokens,
        uint256 floorUsdc6
    ) internal view returns (uint160) {
        // Look up real MfT price from AZUSD/MfT pool (both 18 dec)
        address mftPool = IUniswapV3Factory(v3Factory).getPool(azusd, mft, mftPriceFee);
        require(mftPool != address(0), "no MfT price pool");
        (uint160 sqrtPriceMft,,,,,,) = IUniswapV3Pool(mftPool).slot0();

        // Convert floor USDC value to AZUSD equivalent (both ~$1, scale 6->18 dec)
        uint256 azusdEquiv = floorUsdc6 * 1e12;

        // Convert AZUSD to actual MfT amount using on-chain price
        uint256 equivalentMft = _convertViaPool(azusdEquiv, sqrtPriceMft, azusd < mft);

        // Apply 1.5x premium above floor
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
    //  Internal — setup reactor with 4 positions
    // ═══════════════════════════════════════════════════════════════════════

    function _setupReactor(
        address tokenAddr,
        uint256 azusdId,
        uint256 bbId,
        uint256 ebId,
        uint256 mftId,
        address upstream
    ) internal returns (address reactorAddr) {
        reactorAddr = _cloneReactor();
        ISporeReactor(reactorAddr).initialize(tokenAddr, mft, positionManager, swapRouter, v3Factory, upstream);

        _transferNFT(azusdId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(azusdId);

        _transferNFT(bbId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(bbId);

        _transferNFT(ebId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(ebId);

        _transferNFT(mftId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(mftId);
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
        require(instance != address(0), "clone failed");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Math
    // ═══════════════════════════════════════════════════════════════════════

    function _calcSqrtPrice(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "zero amounts");
        uint256 s1 = _sqrt(amount1);
        uint256 s0 = _sqrt(amount0);
        uint256 result = (s1 << 96) / s0;
        require(result > 0 && result <= type(uint160).max, "price overflow");
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
        require(success, "NFT transfer failed");
    }

    function _refundDust(address tokenAddr, address to) internal {
        address[7] memory tokens = [tokenAddr, weth, usdc, azusd, wrappedBtc, bb, eb];
        for (uint256 i; i < 7; ++i) {
            uint256 bal = IERC20(tokens[i]).balanceOf(address(this));
            if (bal > 0) IERC20(tokens[i]).transfer(to, bal);
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Add a pool to an existing reactor. Pulls NFT from caller,
    ///         forwards to reactor, then registers it.
    function addPoolToReactor(address reactor, uint256 tokenId) external {
        require(msg.sender == owner, "not owner");

        // Pull NFT from caller (requires prior PM.approve(factory, tokenId))
        (bool pulled,) = positionManager.call(
            abi.encodeWithSignature(
                "transferFrom(address,address,uint256)",
                msg.sender, address(this), tokenId
            )
        );
        require(pulled, "NFT pull failed");

        // Forward to reactor + register
        _transferNFT(tokenId, reactor);
        ISporeReactor(reactor).addPool(tokenId);
    }

    function transferReactorAdmin(address reactor, address newAdmin) external {
        require(msg.sender == owner, "not owner");
        ISporeReactor(reactor).transferAdmin(newAdmin);
    }

    function setMinSeed(uint256 _minSeed) external {
        require(msg.sender == owner, "not owner");
        minSeed = _minSeed;
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "not owner");
        owner = newOwner;
    }

    function rescue(address _token) external {
        require(msg.sender == owner, "not owner");
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
        address token, address reactor, address launcher,
        uint256 supply, uint256 seed, uint256 timestamp
    ) {
        Launch storage l = launches[index];
        return (l.token, l.reactor, l.launcher, l.supply, l.seed, l.timestamp);
    }
}
