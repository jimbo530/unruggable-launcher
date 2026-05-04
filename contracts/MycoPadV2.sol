// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MycoPadV2 — Free token launcher with floor + curve architecture
///
/// Architecture:
///   1. Deploy token (all supply to factory)
///   2. Seed ETH → AZUSD (60%, via USDC) + cbBTC (20%) + keep WETH (20%)
///   3. 5% supply → 3 two-sided floor pools (TOKEN/AZUSD, TOKEN/cbBTC, TOKEN/WETH)
///   4. 95% supply → single-sided TOKEN/MfT curve (price from floors + AZUSD/MfT)
///   5. Clone SporeReactorV3, lock all 4 positions forever
///
/// As ETH/BTC appreciate vs USD, floor pools represent higher dollar value.
/// MfT in every reactor = heartbeat — when MfT Prime fires, all TOKEN/MfT
/// pools generate fees, trigger burns, cascade through the network.
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

interface ISporeReactor {
    function initialize(address _token, address _mft, address _pm, address _router, address _factory, address _upstreamReactor) external;
    function addPool(uint256 tokenId) external;
    function transferAdmin(address newAdmin) external;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Contract
// ═══════════════════════════════════════════════════════════════════════════

contract MycoPadV2 {

    // ── Immutables (set in constructor) ───────────────────────────────────
    address public immutable weth;
    address public immutable usdc;
    address public immutable azusd;
    address public immutable wrappedBtc;
    address public immutable mft;

    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;

    address public immutable reactorImpl;
    address public immutable upstreamReactor;

    address public owner;

    // ── Constants ─────────────────────────────────────────────────────────
    uint24  constant FEE_TIER   = 10000;    // 1% fee for new pools
    int24   constant TICK_SPACE = 200;      // tick spacing for 1% fee
    int24   constant TICK_MIN   = -887200;  // full range lower
    int24   constant TICK_MAX   =  887200;  // full range upper

    // Supply allocation
    uint256 constant BPS_FLOOR = 500;   // 5% across 3 floor pools (AZUSD/cbBTC/WETH)
    // Remaining 95% → single-sided TOKEN/MfT curve

    // Seed split (AZUSD heavy — the stable anchor)
    uint256 constant SEED_AZUSD = 6000;  // 60%
    uint256 constant SEED_BTC   = 2000;  // 20%
    uint256 constant SEED_WETH  = 2000;  // 20%

    // Floor supply split per pool (same weights)
    uint256 constant FLOOR_AZUSD = 6000;  // 60%
    uint256 constant FLOOR_BTC   = 2000;  // 20%
    uint256 constant FLOOR_WETH  = 2000;  // 20%

    // Remaining 95% → single-sided MfT curve (the heartbeat)

    // Pool fees for swaps + price reads
    uint24 public immutable wethUsdcFee;    // WETH→USDC hop (fee 500)
    uint24 public immutable usdcAzusdFee;   // USDC→AZUSD hop (fee 10000)
    uint24 public immutable wethBtcFee;     // WETH→cbBTC swap
    uint24 public immutable azusdMftFee;    // AZUSD/MfT price read

    uint256 public minSeed = 0.0001 ether;

    // ── Invite system ──────────────────────────────────────��─────────────
    mapping(address => bool)    public isReactor;     // reactor address → launched by this factory
    mapping(address => address) public reactorOf;     // launcher wallet → their reactor (latest)

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
        address _v3Factory,
        address _pm,
        address _router,
        address _reactorImpl,
        address _upstreamReactor,
        uint24  _wethUsdcFee,
        uint24  _usdcAzusdFee,
        uint24  _wethBtcFee,
        uint24  _azusdMftFee
    ) {
        weth             = _weth;
        usdc             = _usdc;
        azusd            = _azusd;
        wrappedBtc       = _wrappedBtc;
        mft              = _mft;
        v3Factory        = _v3Factory;
        positionManager  = _pm;
        swapRouter       = _router;
        reactorImpl      = _reactorImpl;
        upstreamReactor  = _upstreamReactor;
        wethUsdcFee      = _wethUsdcFee;
        usdcAzusdFee     = _usdcAzusdFee;
        wethBtcFee       = _wethBtcFee;
        azusdMftFee      = _azusdMftFee;
        owner            = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — one transaction, free unruggable token
    // ═══════════════════════════════════════════════════════════════════════

    /// @param _inviteReactor Pass a reactor address to chain to it (0x0 for default upstream)
    function launch(
        string calldata _name,
        string calldata _symbol,
        uint256 _totalSupply,
        address _inviteReactor
    ) external payable returns (address tokenAddr, address reactorAddr) {
        require(msg.value >= minSeed, "seed too low");
        require(_totalSupply >= 1e18, "min 1 token");

        // 1. Resolve upstream — invite chain or default (MfT)
        address upstream = upstreamReactor;
        if (_inviteReactor != address(0)) {
            require(isReactor[_inviteReactor], "not a reactor");
            upstream = _inviteReactor;
        }

        // 2. Deploy token — all supply to this contract
        tokenAddr = address(new LaunchToken(_name, _symbol, _totalSupply, address(this), ""));

        // 3. Calculate allocations — 5% floor, 95% curve
        uint256 floorSupply = _totalSupply * BPS_FLOOR / 10000;
        uint256 curveSupply = _totalSupply - floorSupply;

        // 4. Prepare seed: wrap ETH → AZUSD + cbBTC + keep WETH
        uint256[3] memory seedAmounts = _prepareSeed(msg.value);

        // 5. Create 3 floor pools (AZUSD/cbBTC/WETH) with two-sided LP
        uint256[3] memory floorIds = _createFloorPools(tokenAddr, floorSupply, seedAmounts);

        // 6. Create MfT curve — 95% supply single-sided, price from floors + AZUSD/MfT
        uint256 wethFloorTokens = floorSupply * FLOOR_WETH / 10000;
        uint256 mftCurveId = _createMftCurve(
            tokenAddr, curveSupply,
            wethFloorTokens, seedAmounts[2]
        );

        // 7. Deploy reactor, lock all 4 positions, chain upstream
        uint256[4] memory allIds = [floorIds[0], floorIds[1], floorIds[2], mftCurveId];
        reactorAddr = _setupReactor(tokenAddr, allIds, upstream);

        // 8. Register reactor in invite network
        isReactor[reactorAddr] = true;
        reactorOf[msg.sender] = reactorAddr;

        // 9. Refund any leftover dust
        _refundDust(tokenAddr, msg.sender);

        // 10. Record launch in registry
        launches.push(Launch({
            token:     tokenAddr,
            reactor:   reactorAddr,
            launcher:  msg.sender,
            upstream:  upstream,
            supply:    _totalSupply,
            seed:      msg.value,
            timestamp: block.timestamp
        }));

        emit TokenLaunched(tokenAddr, reactorAddr, msg.sender, _name, _symbol, _totalSupply, msg.value);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — prepare seed (wrap ETH + swap to AZUSD and cbBTC)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Returns [azusd, btc, weth] amounts. MfT gets the curve on top.
    function _prepareSeed(uint256 ethAmount) internal returns (uint256[3] memory amounts) {
        IWETH(weth).deposit{value: ethAmount}();

        uint256 forAzusd = ethAmount * SEED_AZUSD / 10000;
        uint256 forBtc   = ethAmount * SEED_BTC   / 10000;
        uint256 forWeth  = ethAmount - forAzusd - forBtc;

        IERC20(weth).approve(swapRouter, forAzusd + forBtc);

        // Swap WETH → USDC → AZUSD (multi-hop)
        amounts[0] = ISwapRouter02(swapRouter).exactInput(
            ISwapRouter02.ExactInputParams({
                path: abi.encodePacked(weth, wethUsdcFee, usdc, usdcAzusdFee, azusd),
                recipient: address(this),
                amountIn: forAzusd,
                amountOutMinimum: 0
            })
        );

        // Swap WETH → cbBTC
        amounts[1] = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: weth, tokenOut: wrappedBtc, fee: wethBtcFee,
                recipient: address(this), amountIn: forBtc,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        // WETH kept directly
        amounts[2] = forWeth;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — create 3 floor pools (AZUSD, cbBTC, WETH)
    // ═══════════════════════════════════════════════════════════════════════

    function _createFloorPools(
        address tokenAddr,
        uint256 floorSupply,
        uint256[3] memory seedAmounts
    ) internal returns (uint256[3] memory ids) {
        address[3] memory bases = [azusd, wrappedBtc, weth];
        uint256[3] memory weights = [FLOOR_AZUSD, FLOOR_BTC, FLOOR_WETH];

        for (uint256 i; i < 3; ++i) {
            uint256 floorTokens = floorSupply * weights[i] / 10000;
            ids[i] = _createFloorPool(tokenAddr, bases[i], floorTokens, seedAmounts[i]);
        }
    }

    function _createFloorPool(
        address tokenAddr,
        address baseAsset,
        uint256 floorTokenAmount,
        uint256 baseAmount
    ) internal returns (uint256 positionId) {
        bool tokenIs0 = tokenAddr < baseAsset;
        address token0 = tokenIs0 ? tokenAddr : baseAsset;
        address token1 = tokenIs0 ? baseAsset : tokenAddr;

        uint256 t0 = tokenIs0 ? floorTokenAmount : baseAmount;
        uint256 t1 = tokenIs0 ? baseAmount : floorTokenAmount;

        // Create and initialize pool at floor price
        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(_calcSqrtPrice(t0, t1));

        // Mint full-range two-sided position
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
    //  Internal — create MfT curve pool (single-sided, the heartbeat)
    // ═══════════════════════════════════════════════════════════════════════

    function _createMftCurve(
        address tokenAddr,
        uint256 curveSupply,
        uint256 wethFloorTokens,
        uint256 wethFloorSeed
    ) internal returns (uint256 positionId) {
        bool tokenIs0 = tokenAddr < mft;
        address token0 = tokenIs0 ? tokenAddr : mft;
        address token1 = tokenIs0 ? mft : tokenAddr;

        // Derive TOKEN/MfT price from WETH floor + WETH/USDC + AZUSD/MfT chain
        uint160 sqrtPrice = _deriveMftPrice(tokenIs0, wethFloorTokens, wethFloorSeed);

        // Create TOKEN/MfT pool and initialize at derived price
        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(sqrtPrice);

        // Read actual tick after initialization (rounded to tick spacing)
        (, int24 currentTick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 roundedTick = (currentTick / TICK_SPACE) * TICK_SPACE;

        // Single-sided curve: TOKEN deposited as sell wall above floor price
        int24 curveLower;
        int24 curveUpper;
        uint256 c0;
        uint256 c1;

        if (tokenIs0) {
            // TOKEN is token0 — deposit above current tick (sell wall as price rises)
            curveLower = roundedTick + TICK_SPACE;
            curveUpper = TICK_MAX;
            c0 = curveSupply;
            c1 = 0;
            IERC20(token0).approve(positionManager, c0);
        } else {
            // TOKEN is token1 — deposit below current tick (sell wall as price rises)
            curveLower = TICK_MIN;
            curveUpper = roundedTick;
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

    /// @dev Derive TOKEN/MfT sqrtPriceX96 by chaining:
    ///      WETH floor ratio → WETH/USDC market → scale to AZUSD → AZUSD/MfT market
    function _deriveMftPrice(
        bool tokenIs0InMftPool,
        uint256 wethFloorTokens,
        uint256 wethFloorSeed
    ) internal view returns (uint160) {
        // Step 1: Read WETH/USDC market price
        address wethUsdcPool = IUniswapV3Factory(v3Factory).getPool(weth, usdc, wethUsdcFee);
        require(wethUsdcPool != address(0), "no WETH/USDC pool");
        (uint160 sqrtPriceWU,,,,,,) = IUniswapV3Pool(wethUsdcPool).slot0();

        // Step 2: Convert WETH floor seed → USDC equivalent
        uint256 equivalentUsdc = _convertViaPool(wethFloorSeed, sqrtPriceWU, weth < usdc);

        // Step 3: Scale USDC (6 dec) → AZUSD (18 dec)
        uint256 equivalentAzusd = equivalentUsdc * 1e12;

        // Step 4: Read AZUSD/MfT market price
        address azusdMftPool = IUniswapV3Factory(v3Factory).getPool(azusd, mft, azusdMftFee);
        require(azusdMftPool != address(0), "no AZUSD/MfT pool");
        (uint160 sqrtPriceAM,,,,,,) = IUniswapV3Pool(azusdMftPool).slot0();

        // Step 5: Convert AZUSD equivalent → MfT equivalent
        uint256 equivalentMft = _convertViaPool(equivalentAzusd, sqrtPriceAM, azusd < mft);

        // Step 6: TOKEN/MfT price from floor ratio
        // wethFloorTokens TOKEN ≈ equivalentMft MfT at current market rates
        if (tokenIs0InMftPool) {
            return _calcSqrtPrice(wethFloorTokens, equivalentMft);
        } else {
            return _calcSqrtPrice(equivalentMft, wethFloorTokens);
        }
    }

    /// @dev Convert an amount through a pool's sqrtPriceX96
    ///      inputIs0 = true means input is token0, output is token1
    function _convertViaPool(uint256 amount, uint160 sqrtPriceX96, bool inputIs0) internal pure returns (uint256) {
        uint256 sqrtP = uint256(sqrtPriceX96);
        if (inputIs0) {
            // token0 → token1: multiply by price (price = token1/token0)
            return (amount * sqrtP >> 96) * sqrtP >> 96;
        } else {
            // token1 → token0: divide by price
            return (amount << 96) / sqrtP * (1 << 96) / sqrtP;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — setup reactor with all 4 positions
    // ═══════════════════════════════════════════════════════════════════════

    function _setupReactor(
        address tokenAddr,
        uint256[4] memory tokenIds,
        address upstream
    ) internal returns (address reactorAddr) {
        reactorAddr = _cloneReactor();
        ISporeReactor(reactorAddr).initialize(
            tokenAddr, mft, positionManager, swapRouter, v3Factory, upstream
        );

        for (uint256 i; i < 4; ++i) {
            if (tokenIds[i] > 0) {
                _transferNFT(tokenIds[i], reactorAddr);
                ISporeReactor(reactorAddr).addPool(tokenIds[i]);
            }
        }

        // Factory stays admin — can add wildcard pools later
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — EIP-1167 clone
    // ═══════════════════════════════════════════════════════════════════════

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
    //  Internal — math
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
    //  Internal — helpers
    // ═══════════════════════════════════════════════════════════════════════

    function _transferNFT(uint256 tokenId, address to) internal {
        (bool success,) = positionManager.call(
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", address(this), to, tokenId)
        );
        require(success, "NFT transfer failed");
    }

    function _refundDust(address tokenAddr, address to) internal {
        address[4] memory tokens = [tokenAddr, weth, azusd, wrappedBtc];
        for (uint256 i; i < 4; ++i) {
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

    function addPoolToReactor(address reactor, uint256 tokenId) external {
        require(msg.sender == owner, "not owner");
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
