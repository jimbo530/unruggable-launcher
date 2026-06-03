// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Unrugable V6 — Fixed 1B Supply, $10K Market Cap at Launch
///
/// Two launch modes:
///   - launchMeme():    $5 USDC min, no vesting, 100% supply to pools
///   - launchProject(): $100 USDC min, 20% VolumeVesting, 80% supply to pools
///
/// Fixed structure:
///   - Every token launches with 1,000,000,000 supply and $10,000 market cap
///   - Floor pool depth scales with seed (bigger seed = deeper liquidity)
///   - Sell walls absorb remaining supply at 1.1x / 2x / 5x
///
/// Flow:
///   1. Launcher sends USDC
///   2. Factory deposits USDC into mftUSD (1:1 mint)
///   3. Factory swaps mftUSD → MfT via mftUSD/MfT pool
///   4. Creates 1 floor pool: TOKEN/MfT (full range, sized for $10K MC)
///   5. Creates 3 mftUSD sell walls: TOKEN/mftUSD at 1.1x / 2x / 5x
///   6. CHAR reactor: buys CHAR with MfT, creates CHAR/MfT pool (6% of seed)
///
/// Every launch strengthens mftUSD backing + deepens mftUSD/MfT liquidity.

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

interface IMftStable {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function deposit(uint256 amount) external;
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

interface IVolumeVesting {
    function initialize(address _token, address _charity, address _burnAddress, uint256 _totalAllocation, uint256 _vestRateBPS) external;
}

// ═══════════════════════════════════════════════════════════════════════════

contract Unrugable {

    // ── Immutables ────────────────────────────────────────────────────────
    address public immutable usdc;
    address public immutable mft;          // MfT meme token (floor asset)
    address public immutable char;         // CHAR carbon token
    address public immutable mftStable;    // mftUSD stablecoin (sell walls)

    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;

    address public immutable reactorImpl;
    address public immutable vestingImpl;
    address public immutable upstreamReactor;

    // Fee tiers for routing swaps
    uint24  public immutable mftStableMftFee;   // mftUSD/MfT pool fee
    uint24  public immutable mftCharFee;        // MfT/CHAR pool fee

    address public owner;

    // ── Constants ─────────────────────────────────────────────────────────
    string  constant METADATA_BASE = "https://tasern.quest/api/unruggable/metadata/";
    uint24  constant FEE_TIER      = 10000;
    uint24  constant CHAR_FEE      = 10000;
    int24   constant TICK_SPACE    = 200;
    int24   constant TICK_MIN      = -887200;
    int24   constant TICK_MAX      =  887200;

    // Fixed supply: every token launches with 1 billion tokens
    uint256 constant TOTAL_SUPPLY = 1_000_000_000e18;

    // Fixed market cap: $10,000 at launch (in USDC 6-decimal units)
    uint256 constant TARGET_MC_USDC = 10_000_000_000;

    // Seed split ratios (BPS of 10000)
    uint256 constant SEED_FLOOR = 9400;    // 94% → TOKEN/MfT floor
    uint256 constant SEED_CHAR  = 600;     // 6%  → CHAR/MfT reactor

    // mftUSD sell wall tick offsets from launch price
    int24 constant WALL_1_1X = 1000;
    int24 constant WALL_2X   = 7000;
    int24 constant WALL_5X   = 16200;

    // Vesting (project tier only)
    uint256 constant VEST_BPS  = 2000;     // 20% of supply to launcher vesting
    uint256 constant VEST_RATE = 5000;     // 0.5 tokens vest per 1 token burned
    address constant BURN      = 0xfd780B0aE569e15e514B819ecFDF46f804953a4B;

    uint256 public minSeedMeme    = 5_000_000;     // $5 USDC (6 decimals)
    uint256 public minSeedProject = 100_000_000;   // $100 USDC (6 decimals)

    // ── Registry ──────────────────────────────────────────────────────────
    mapping(address => bool)    public isReactor;
    mapping(address => address) public reactorOf;
    mapping(address => address) public charReactorOf;
    mapping(address => address) public vestingOf;
    mapping(address => address) public launcherOf;

    // ── Pending launch ────────────────────────────────────────────────────
    struct Pending {
        address token;
        address upstream;
        uint256 seedAmount;
        uint256 floorMftId;
        uint256 wallId1;
        uint256 wallId2;
        uint256 wallId3;
        uint256 charSeedMft;    // MfT amount reserved for CHAR
        bool    hasVesting;
    }
    mapping(address => Pending) public pending;

    struct Launch {
        address token;
        address reactor;
        address charReactor;
        address vesting;
        address launcher;
        uint256 supply;
        uint256 seed;
        uint256 timestamp;
    }
    Launch[] public launches;

    // ── Events ────────────────────────────────────────────────────────────
    event TokenLaunched(
        address indexed token, address reactor, address charReactor, address vesting,
        address indexed launcher, string name, string symbol, uint256 supply, uint256 seed
    );

    // ═══════════════════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _usdc,
        address _mft,
        address _char,
        address _mftStable,
        address _v3Factory,
        address _pm,
        address _router,
        address _reactorImpl,
        address _vestingImpl,
        address _upstreamReactor,
        uint24  _mftStableMftFee,
        uint24  _mftCharFee
    ) {
        usdc             = _usdc;
        mft              = _mft;
        char             = _char;
        mftStable        = _mftStable;
        v3Factory        = _v3Factory;
        positionManager  = _pm;
        swapRouter       = _router;
        reactorImpl      = _reactorImpl;
        vestingImpl      = _vestingImpl;
        upstreamReactor  = _upstreamReactor;
        mftStableMftFee  = _mftStableMftFee;
        mftCharFee       = _mftCharFee;
        owner            = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — Meme Tier ($5 USDC min, no vesting)
    // ═══════════════════════════════════════════════════════════════════════

    function launchMemeStep1(
        string calldata _name,
        string calldata _symbol,
        uint256 _seedAmount,
        address _customUpstream
    ) external returns (address tokenAddr) {
        require(_seedAmount >= minSeedMeme, "seed too low");
        IERC20(usdc).transferFrom(msg.sender, address(this), _seedAmount);
        tokenAddr = _launchStep1(_name, _symbol, _seedAmount, _customUpstream, false);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — Project Tier ($100 USDC min, 20% VolumeVesting)
    // ═══════════════════════════════════════════════════════════════════════

    function launchProjectStep1(
        string calldata _name,
        string calldata _symbol,
        uint256 _seedAmount,
        address _customUpstream
    ) external returns (address tokenAddr) {
        require(_seedAmount >= minSeedProject, "seed too low");
        IERC20(usdc).transferFrom(msg.sender, address(this), _seedAmount);
        tokenAddr = _launchStep1(_name, _symbol, _seedAmount, _customUpstream, true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — Step 2 (shared, completes either tier)
    // ═══════════════════════════════════════════════════════════════════════

    function launchStep2(
        string calldata _name,
        string calldata _symbol
    ) external returns (address reactorAddr, address charReactorAddr) {
        Pending memory p = pending[msg.sender];
        require(p.token != address(0), "no pending");

        delete pending[msg.sender];

        charReactorAddr = _setupCharReactor(p.charSeedMft, p.upstream);

        reactorAddr = _setupReactor(
            p.token, p.floorMftId,
            p.wallId1, p.wallId2, p.wallId3, charReactorAddr
        );

        address vestingAddr = address(0);
        if (p.hasVesting) {
            uint256 vestingAmount = TOTAL_SUPPLY * VEST_BPS / 10000;
            vestingAddr = _setupVesting(p.token, msg.sender, vestingAmount);
        }

        isReactor[reactorAddr] = true;
        isReactor[charReactorAddr] = true;
        reactorOf[p.token] = reactorAddr;
        charReactorOf[p.token] = charReactorAddr;
        vestingOf[p.token] = vestingAddr;
        launcherOf[reactorAddr] = msg.sender;
        launcherOf[charReactorAddr] = msg.sender;

        _refundDust(p.token, msg.sender);

        launches.push(Launch({
            token: p.token, reactor: reactorAddr, charReactor: charReactorAddr,
            vesting: vestingAddr, launcher: msg.sender, supply: TOTAL_SUPPLY,
            seed: p.seedAmount, timestamp: block.timestamp
        }));

        emit TokenLaunched(p.token, reactorAddr, charReactorAddr, vestingAddr, msg.sender, _name, _symbol, TOTAL_SUPPLY, p.seedAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — shared Step 1 logic
    // ═══════════════════════════════════════════════════════════════════════

    function _launchStep1(
        string calldata _name,
        string calldata _symbol,
        uint256 _seedAmount,
        address _customUpstream,
        bool _hasVesting
    ) internal returns (address tokenAddr) {
        require(pending[msg.sender].token == address(0), "pending exists");

        address primaryUpstream = upstreamReactor;
        if (_customUpstream != address(0)) {
            uint256 sz;
            assembly { sz := extcodesize(_customUpstream) }
            if (sz > 0) primaryUpstream = _customUpstream;
        }

        // 1. Deposit USDC → mftUSD (1:1 mint, strengthens mftUSD backing)
        IERC20(usdc).approve(mftStable, _seedAmount);
        IMftStable(mftStable).deposit(_seedAmount);

        // 2. Swap mftUSD → MfT (deepens mftUSD/MfT pool)
        uint256 mftUsdBal = IMftStable(mftStable).balanceOf(address(this));
        IMftStable(mftStable).approve(swapRouter, mftUsdBal);
        uint256 mftReceived = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: mftStable, tokenOut: mft, fee: mftStableMftFee,
                recipient: address(this), amountIn: mftUsdBal,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        // 3. Deploy token with fixed 1B supply
        tokenAddr = address(new LaunchToken(_name, _symbol, TOTAL_SUPPLY, address(this), METADATA_BASE));

        // 4. Determine pool supply (project reserves 20% for vesting)
        uint256 poolSupply = _hasVesting
            ? TOTAL_SUPPLY - (TOTAL_SUPPLY * VEST_BPS / 10000)
            : TOTAL_SUPPLY;

        // 5. Split MfT: 94% floor, 6% CHAR reactor
        uint256 floorMft = mftReceived * SEED_FLOOR / 10000;
        uint256 charMft  = mftReceived - floorMft;

        // 6. Calculate floor tokens for $10K market cap
        //    MC = TOTAL_SUPPLY * (floorMft / floorTokens) * (seedUSD / mftReceived)
        //    Solving: floorTokens = TOTAL_SUPPLY * SEED_FLOOR * seedAmount / (TARGET_MC_USDC * 10000)
        uint256 floorTokens = TOTAL_SUPPLY * SEED_FLOOR * _seedAmount / (TARGET_MC_USDC * 10000);
        require(floorTokens > 0, "floor tokens zero");
        require(floorTokens < poolSupply, "seed too large for target MC");

        // 7. Create TOKEN/MfT floor pool (full range)
        uint256 floorMftId = _createFloorPool(tokenAddr, mft, floorTokens, floorMft);

        // 8. Create mftUSD sell walls with remaining pool supply
        uint256 curveSupply = poolSupply - floorTokens;
        (uint256 wallId1, uint256 wallId2, uint256 wallId3) = _createMftUsdWalls(
            tokenAddr, curveSupply, floorTokens, floorMft
        );

        pending[msg.sender] = Pending({
            token:         tokenAddr,
            upstream:      primaryUpstream,
            seedAmount:    _seedAmount,
            floorMftId:    floorMftId,
            wallId1:       wallId1,
            wallId2:       wallId2,
            wallId3:       wallId3,
            charSeedMft:   charMft,
            hasVesting:    _hasVesting
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — deploy VolumeVesting clone (project tier only)
    // ═══════════════════════════════════════════════════════════════════════

    function _setupVesting(
        address tokenAddr,
        address launcher,
        uint256 vestingAmount
    ) internal returns (address vestingAddr) {
        vestingAddr = _cloneVesting();
        IERC20(tokenAddr).transfer(vestingAddr, vestingAmount);
        IVolumeVesting(vestingAddr).initialize(
            tokenAddr,
            launcher,
            BURN,
            vestingAmount,
            VEST_RATE
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — CHAR reactor setup (buy CHAR with MfT, create CHAR/MfT pool)
    // ═══════════════════════════════════════════════════════════════════════

    function _setupCharReactor(uint256 charSeedMft, address upstreamAddr) internal returns (address charReactorAddr) {
        uint256 mftForChar = charSeedMft / 2;
        uint256 mftForLP   = charSeedMft - mftForChar;

        // Buy CHAR with MfT
        IERC20(mft).approve(swapRouter, mftForChar);
        uint256 charAmount = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: mft, tokenOut: char, fee: mftCharFee,
                recipient: address(this), amountIn: mftForChar,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        // Create CHAR/MfT pool
        uint256 charMftId = _createCharPool(char, mft, charAmount, mftForLP);

        // Deploy CHAR reactor clone
        charReactorAddr = _cloneReactor();
        ISporeReactor(charReactorAddr).initialize(char, mft, positionManager, swapRouter, v3Factory, upstreamAddr);

        _transferNFT(charMftId, charReactorAddr);
        ISporeReactor(charReactorAddr).addPool(charMftId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — create TOKEN/MfT floor pool (full range)
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
    //  Internal — 3 mftUSD sell walls at 1.1x / 2x / 5x launch price
    // ═══════════════════════════════════════════════════════════════════════

    function _createMftUsdWalls(
        address tokenAddr,
        uint256 curveSupply,
        uint256 floorTokens,
        uint256 floorMft
    ) internal returns (uint256 id1, uint256 id2, uint256 id3) {
        bool tokenIs0 = tokenAddr < mftStable;
        address token0 = tokenIs0 ? tokenAddr : mftStable;
        address token1 = tokenIs0 ? mftStable : tokenAddr;

        // Derive mftUSD price from the MfT floor ratio
        uint160 sqrtPrice = _deriveMftUsdPrice(tokenIs0, floorTokens, floorMft);

        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(sqrtPrice);

        (, int24 currentTick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 base = (currentTick / TICK_SPACE) * TICK_SPACE;

        uint256 s1 = curveSupply / 3;
        uint256 s2 = curveSupply / 3;
        uint256 s3 = curveSupply - s1 - s2;

        if (tokenIs0) {
            // token is token0, walls go above current price (token0 sell = sqrtPrice drops)
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
            // token is token1, walls go below current tick
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

    /// @dev Derive TOKEN/mftUSD price from the TOKEN/MfT floor ratio + mftUSD/MfT pool price
    function _deriveMftUsdPrice(
        bool tokenIs0InStablePool,
        uint256 floorTokens,
        uint256 floorMft
    ) internal view returns (uint160) {
        // Get mftUSD/MfT pool price to convert MfT value → mftUSD value
        address mftUsdPool = IUniswapV3Factory(v3Factory).getPool(mftStable, mft, mftStableMftFee);
        require(mftUsdPool != address(0), "no mftUSD/MfT pool");
        (uint160 sqrtPriceMftUsd,,,,,,) = IUniswapV3Pool(mftUsdPool).slot0();

        // Convert floorMft (18 dec) to equivalent mftUSD (6 dec)
        uint256 equivalentMftUsd = _convertViaPool(floorMft, sqrtPriceMftUsd, mft < mftStable);
        equivalentMftUsd = equivalentMftUsd * 11 / 10;  // 1.1x starting price

        if (tokenIs0InStablePool) {
            return _calcSqrtPrice(floorTokens, equivalentMftUsd);
        } else {
            return _calcSqrtPrice(equivalentMftUsd, floorTokens);
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
        uint256 floorId,
        uint256 wall1,
        uint256 wall2,
        uint256 wall3,
        address upstream
    ) internal returns (address reactorAddr) {
        reactorAddr = _cloneReactor();
        ISporeReactor(reactorAddr).initialize(tokenAddr, mft, positionManager, swapRouter, v3Factory, upstream);

        _transferNFT(floorId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(floorId);
        _transferNFT(wall1, reactorAddr);
        ISporeReactor(reactorAddr).addPool(wall1);
        _transferNFT(wall2, reactorAddr);
        ISporeReactor(reactorAddr).addPool(wall2);
        _transferNFT(wall3, reactorAddr);
        ISporeReactor(reactorAddr).addPool(wall3);
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

    function _cloneVesting() internal returns (address instance) {
        address impl = vestingImpl;
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
        require(amount0 > 0 && amount1 > 0, "zero amount");
        uint256 s1 = _sqrt(amount1);
        uint256 s0 = _sqrt(amount0);
        uint256 result = (s1 << 96) / s0;
        require(result > 0 && result <= type(uint160).max, "sqrt overflow");
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
        address[5] memory tokens = [tokenAddr, usdc, char, mft, mftStable];
        for (uint256 i; i < 5; ++i) {
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
        require(p.token != address(0), "no pending");
        delete pending[msg.sender];
        // Refund any MfT held for CHAR (already swapped, so refund MfT)
        uint256 mftBal = IERC20(mft).balanceOf(address(this));
        if (mftBal > 0) IERC20(mft).transfer(msg.sender, mftBal);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════════════════════════════════

    function addPoolToReactor(address reactor, uint256 tokenId) external {
        require(msg.sender == owner || msg.sender == launcherOf[reactor], "not authorized");
        (bool pulled,) = positionManager.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), tokenId)
        );
        require(pulled, "pull failed");
        _transferNFT(tokenId, reactor);
        ISporeReactor(reactor).addPool(tokenId);
    }

    function addPoolFromHolding(address reactor, uint256 tokenId) external {
        require(msg.sender == owner || msg.sender == launcherOf[reactor], "not authorized");
        _transferNFT(tokenId, reactor);
        ISporeReactor(reactor).addPool(tokenId);
    }

    function transferReactorAdmin(address reactor, address newAdmin) external {
        require(msg.sender == owner, "not owner");
        ISporeReactor(reactor).transferAdmin(newAdmin);
    }

    function setMinSeeds(uint256 _meme, uint256 _project) external {
        require(msg.sender == owner, "not owner");
        minSeedMeme = _meme;
        minSeedProject = _project;
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
}
