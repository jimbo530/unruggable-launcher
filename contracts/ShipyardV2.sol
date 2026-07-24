// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ShipyardV2 — Shipyard with dynamic crew-NFT metadata (go-forward factory)
///
/// Identical to Shipyard.sol in EVERY economic respect (V6 reactor, 2 pools, $1
/// launch fee, $0.50 buy-in, money/usdc, treasury, mutiny-capable ShipToken). The
/// ONLY change: it threads a `crewBaseURI` (constructor immutable) into the
/// FeeShareDistributor so each ship's 100 crew NFTs resolve `tokenURI(id)` to the
/// crew-meta service (dynamic paper-doll metadata), e.g.
///   https://crew.tasern.quest/crew/meta/<distributor>:<id>
///
/// Why a new factory: the deployed FeeShareDistributor returns empty tokenURIs and
/// has no setter, and the V1 Shipyard never passed a baseURI. With NO real ships
/// launched yet, we redeploy this fixed factory before going public so crew NFTs
/// have living metadata from day one.
///
/// IMPORTANT: reactorImpl MUST be a SporeReactorV6 impl (reused, not redeployed).

import "./ShipToken.sol";
import "./FeeShareDistributor.sol";

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

interface ISporeReactorV6 {
    function initialize(
        address _token, address _mft, address _money, address _usdc,
        address _pm, address _router, address _factory,
        address _upstreamReactor, address _launcher
    ) external;
    function addPool(uint256 tokenId) external;
    function setDistributor(address _distributor) external;
    function transferAdmin(address newAdmin) external;
}

interface ICharityFund {
    function registerV3Position(uint256 tokenId) external;
}

interface IMoneyDeposit {
    function deposit(uint256 amount) external;
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

// ═══════════════════════════════════════════════════════════════════════════

contract ShipyardV2 {

    // ── Immutables ────────────────────────────────────────────────────────
    address public immutable meme;             // Meme for Trees (18 dec)
    address public immutable money;            // Money for Trees (6 dec)
    address public immutable usdc;             // USDC (6 dec) — distributor payout
    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;       // passed to reactor
    address public immutable reactorImpl;      // MUST be a SporeReactorV6 impl
    address public immutable upstreamReactor;
    uint24  public immutable moneyMemeFee;     // fee tier of Money/Meme pool
    address public immutable treasury;         // operator revenue wallet (mutiny fees)

    /// @notice Base for each crew distributor's tokenURI. tokenURI(id) becomes
    ///         `<crewBaseURI><distributor>:<id>`. Display-only; never funds.
    string public crewBaseURI;

    address public owner;

    // ── Constants ─────────────────────────────────────────────────────────
    string  constant METADATA_BASE = "https://tasern.quest/api/unruggable/metadata/";
    uint256 constant TOTAL_SUPPLY     = 1_000_000_000e18;         // 1B tokens
    uint256 constant TARGET_MC_MONEY  = 10_000_000_000;           // $10K in Money (6 dec)
    uint256 constant MONEY_BPS        = 7000;                     // 70% → Money wall
    uint24  constant FEE_TIER         = 10000;                    // 1% fee tier
    int24   constant TICK_SPACE       = 200;
    int24   constant TICK_MIN         = -887200;
    int24   constant TICK_MAX         =  887200;

    // ── Launch fee (USDC, 6-dec) ──────────────────────────────────────────
    uint256 public constant MAX_LAUNCH_FEE = 5_000_000;          // $5 ceiling
    uint256 public launchFee = 1_000_000;                        // $1 default

    // ── Launch buy-in (USDC, 6-dec) ───────────────────────────────────────
    uint256 public buyInAmount = 500_000;                        // $0.50 default
    address public prizeWallet;                                  // moonshot bag sink

    // ── Buy-in slippage guard (mirrors SporeReactorV6) ────────────────────
    uint256 private constant MAX_PRICE_IMPACT_BPS = 300;         // 3% cap
    uint160 private constant MIN_SQRT_RATIO = 4295128739;
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    // ── Registry ──────────────────────────────────────────────────────────
    mapping(address => bool)    public isReactor;
    mapping(address => address) public reactorOf;
    mapping(address => address) public launcherOf;
    mapping(address => address) public distributorOf;   // token => crew NFT (fee-share)

    struct Launch {
        address token;
        address reactor;
        address distributor;
        address launcher;
        uint256 timestamp;
    }
    Launch[] public launches;

    event ShipLaunched(
        address indexed token, address reactor, address distributor,
        address indexed launcher, string name, string symbol
    );
    event YieldRegistrationFailed(uint256 indexed tokenId);
    event LaunchFeeSet(uint256 newFee);
    event LaunchFeePaid(address indexed payer, address indexed shipOwner, uint256 amount);
    event BuyInSet(uint256 newAmount);
    event PrizeWalletSet(address indexed prizeWallet);
    event BoughtIn(address indexed token, uint256 usdcIn, uint256 tokenOut, address indexed prizeWallet);
    event BuyInFailed(address indexed token, uint256 usdcAmount);

    // ═══════════════════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _meme,
        address _money,
        address _usdc,
        address _v3Factory,
        address _pm,
        address _router,
        address _reactorImpl,
        address _upstreamReactor,
        uint24  _moneyMemeFee,
        address _treasury,
        string memory _crewBaseURI
    ) {
        require(_treasury != address(0), "zero treasury");
        meme            = _meme;
        money           = _money;
        usdc            = _usdc;
        v3Factory       = _v3Factory;
        positionManager = _pm;
        swapRouter      = _router;
        reactorImpl     = _reactorImpl;
        upstreamReactor = _upstreamReactor;
        moneyMemeFee    = _moneyMemeFee;
        treasury        = _treasury;
        prizeWallet     = _treasury;   // safe non-zero default; owner can split it out
        crewBaseURI     = _crewBaseURI;
        owner           = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — single transaction, no seed required
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Direct launch — caller pays gas + the $1 fee AND owns the ship.
    function launch(
        string calldata _name,
        string calldata _symbol,
        address _customUpstream
    ) external returns (address tokenAddr, address reactorAddr) {
        return launchFor(msg.sender, _name, _symbol, _customUpstream);
    }

    /// @notice Relayer-ready launch. `shipOwner` receives the 100 crew NFTs,
    ///         mutiny/captain rights, the reactor's launcher role, and any dust.
    ///         The $1 USDC launch fee is pulled from msg.sender (the relayer).
    function launchFor(
        address shipOwner,
        string calldata _name,
        string calldata _symbol,
        address _customUpstream
    ) public returns (address tokenAddr, address reactorAddr) {
        require(shipOwner != address(0), "zero shipOwner");

        // 0. Collect the launch fee from the CALLER into THIS contract.
        uint256 fee = launchFee;
        if (fee > 0) {
            require(
                IERC20(usdc).transferFrom(msg.sender, address(this), fee),
                "launch fee failed"
            );
            emit LaunchFeePaid(msg.sender, shipOwner, fee);
        }

        // 1. Deploy a mutiny-capable ShipToken, 1B supply to this contract.
        ShipToken ship = new ShipToken(
            _name, _symbol, TOTAL_SUPPLY, address(this), METADATA_BASE, usdc, treasury
        );
        tokenAddr = address(ship);

        uint256 moneySupply = TOTAL_SUPPLY * MONEY_BPS / 10000;  // 70%
        uint256 memeSupply  = TOTAL_SUPPLY - moneySupply;         // 30%

        // 2. Create TOKEN/Money sell wall (70%)
        uint256 moneyWallId = _createMoneyWall(tokenAddr, moneySupply);

        // 2b. Register Money LP for yield — reactor earns Aave yield via CharityFund
        try ICharityFund(money).registerV3Position(moneyWallId) {} catch {
            emit YieldRegistrationFailed(moneyWallId);
        }

        // 3. Create TOKEN/Meme sell wall (30%)
        uint256 memeWallId = _createMemeWall(tokenAddr, memeSupply);

        // 4. Determine upstream reactor
        address upstream = upstreamReactor;
        if (_customUpstream != address(0)) {
            uint256 sz;
            assembly { sz := extcodesize(_customUpstream) }
            if (sz > 0) upstream = _customUpstream;
        }

        // 5. Deploy reactor (V6), hand it both positions. shipOwner = launcher.
        reactorAddr = _cloneReactor();
        ISporeReactorV6(reactorAddr).initialize(
            tokenAddr, meme, money, usdc,
            positionManager, swapRouter, v3Factory, upstream, shipOwner
        );

        _transferNFT(moneyWallId, reactorAddr);
        ISporeReactorV6(reactorAddr).addPool(moneyWallId);
        _transferNFT(memeWallId, reactorAddr);
        ISporeReactorV6(reactorAddr).addPool(memeWallId);

        // 5b. Deploy the crew (fee-share distributor, PAYOUT = USDC) and wire it.
        //     V2: pass crewBaseURI so the crew NFTs resolve to dynamic metadata.
        FeeShareDistributor dist = new FeeShareDistributor(
            usdc, reactorAddr, shipOwner,
            string.concat(_name, " Crew"),
            string.concat(_symbol, "CREW"),
            crewBaseURI
        );
        // Reactor learns where its USDC goes...
        ISporeReactorV6(reactorAddr).setDistributor(address(dist));
        // ...and the ship learns which crew can mutiny it (settable once, here).
        ship.setCrew(address(dist));

        // 6. Refund any dust from rounding to the ship owner
        _refundDust(tokenAddr, shipOwner);

        // 6b. Moonshot buy-in: spend min(buyInAmount, fee) USDC of the collected
        //     fee on TOKEN at the $10K floor → prizeWallet; remainder → treasury.
        _buyInAndSettleFee(tokenAddr, fee);

        // 7. Registry
        isReactor[reactorAddr] = true;
        reactorOf[tokenAddr] = reactorAddr;
        launcherOf[reactorAddr] = shipOwner;
        distributorOf[tokenAddr] = address(dist);

        launches.push(Launch({
            token: tokenAddr, reactor: reactorAddr, distributor: address(dist),
            launcher: shipOwner, timestamp: block.timestamp
        }));

        emit ShipLaunched(tokenAddr, reactorAddr, address(dist), shipOwner, _name, _symbol);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — TOKEN/Money sell wall (70%, fixed $10K MC price)
    // ═══════════════════════════════════════════════════════════════════════

    function _createMoneyWall(
        address tokenAddr,
        uint256 tokenAmount
    ) internal returns (uint256 positionId) {
        bool tokenIs0 = tokenAddr < money;
        address token0 = tokenIs0 ? tokenAddr : money;
        address token1 = tokenIs0 ? money : tokenAddr;

        uint160 sqrtPrice = tokenIs0
            ? _calcSqrtPrice(TOTAL_SUPPLY, TARGET_MC_MONEY)
            : _calcSqrtPrice(TARGET_MC_MONEY, TOTAL_SUPPLY);

        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(sqrtPrice);

        (, int24 currentTick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 baseTick = (currentTick / TICK_SPACE) * TICK_SPACE;
        if (baseTick > currentTick) baseTick -= TICK_SPACE;

        int24 tickLower;
        int24 tickUpper;
        uint256 a0;
        uint256 a1;

        if (tokenIs0) {
            tickLower = baseTick + TICK_SPACE;
            tickUpper = TICK_MAX;
            a0 = tokenAmount;
            a1 = 0;
        } else {
            tickLower = TICK_MIN;
            tickUpper = baseTick;
            a0 = 0;
            a1 = tokenAmount;
        }

        IERC20(tokenAddr).approve(positionManager, tokenAmount);

        (positionId,,,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: FEE_TIER,
                tickLower: tickLower, tickUpper: tickUpper,
                amount0Desired: a0, amount1Desired: a1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — TOKEN/Meme sell wall (30%, price derived from Money/Meme)
    // ═══════════════════════════════════════════════════════════════════════

    function _createMemeWall(
        address tokenAddr,
        uint256 tokenAmount
    ) internal returns (uint256 positionId) {
        bool tokenIs0 = tokenAddr < meme;
        address token0 = tokenIs0 ? tokenAddr : meme;
        address token1 = tokenIs0 ? meme : tokenAddr;

        address moneyMemePool = IUniswapV3Factory(v3Factory).getPool(money, meme, moneyMemeFee);
        require(moneyMemePool != address(0), "no Money/Meme pool");
        (uint160 sqrtPriceMoneyMeme,,,,,,) = IUniswapV3Pool(moneyMemePool).slot0();

        uint256 equivalentMeme = _convertViaPool(
            TARGET_MC_MONEY, sqrtPriceMoneyMeme, money < meme
        );
        require(equivalentMeme > 0, "meme conversion zero");

        uint160 sqrtPrice = tokenIs0
            ? _calcSqrtPrice(TOTAL_SUPPLY, equivalentMeme)
            : _calcSqrtPrice(equivalentMeme, TOTAL_SUPPLY);

        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(sqrtPrice);

        (, int24 currentTick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 baseTick = (currentTick / TICK_SPACE) * TICK_SPACE;
        if (baseTick > currentTick) baseTick -= TICK_SPACE;

        int24 tickLower;
        int24 tickUpper;
        uint256 a0;
        uint256 a1;

        if (tokenIs0) {
            tickLower = baseTick + TICK_SPACE;
            tickUpper = TICK_MAX;
            a0 = tokenAmount;
            a1 = 0;
        } else {
            tickLower = TICK_MIN;
            tickUpper = baseTick;
            a0 = 0;
            a1 = tokenAmount;
        }

        IERC20(tokenAddr).approve(positionManager, tokenAmount);

        (positionId,,,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: FEE_TIER,
                tickLower: tickLower, tickUpper: tickUpper,
                amount0Desired: a0, amount1Desired: a1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Math
    // ═══════════════════════════════════════════════════════════════════════

    function _convertViaPool(
        uint256 amount, uint160 sqrtPriceX96, bool inputIs0
    ) internal pure returns (uint256) {
        uint256 sqrtP = uint256(sqrtPriceX96);
        if (inputIs0) {
            return (amount * sqrtP >> 96) * sqrtP >> 96;
        } else {
            return (amount << 96) / sqrtP * (1 << 96) / sqrtP;
        }
    }

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

    function _transferNFT(uint256 tokenId, address to) internal {
        (bool success,) = positionManager.call(
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", address(this), to, tokenId)
        );
        require(success, "NFT transfer failed");
    }

    function _refundDust(address tokenAddr, address to) internal {
        uint256 bal = IERC20(tokenAddr).balanceOf(address(this));
        if (bal > 0) IERC20(tokenAddr).transfer(to, bal);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Buy-in — moonshot buy at the $10K floor, then settle the fee remainder
    // ═══════════════════════════════════════════════════════════════════════

    function _buyInAndSettleFee(address tokenAddr, uint256 fee) internal {
        if (fee == 0) return;

        uint256 bi = buyInAmount < fee ? buyInAmount : fee;  // min(buyInAmount, fee)
        uint256 remainder = fee - bi;

        if (bi > 0) {
            try this.executeBuyIn(tokenAddr, bi) returns (uint256 tokenOut) {
                emit BoughtIn(tokenAddr, bi, tokenOut, prizeWallet);
            } catch {
                _safeTransfer(usdc, treasury, bi);
                emit BuyInFailed(tokenAddr, bi);
            }
        }

        if (remainder > 0) {
            _safeTransfer(usdc, treasury, remainder);
        }
    }

    /// @dev External so it can be wrapped in try/catch from within the contract.
    ///      Only callable by self. USDC → Money (1:1) → TOKEN → prizeWallet.
    function executeBuyIn(address tokenAddr, uint256 usdcIn) external returns (uint256 tokenOut) {
        require(msg.sender == address(this), "internal only");

        _safeApprove(usdc, money, usdcIn);
        IMoneyDeposit(money).deposit(usdcIn);
        uint256 moneyBal = IERC20(money).balanceOf(address(this));
        require(moneyBal > 0, "no money minted");

        address pool = IUniswapV3Factory(v3Factory).getPool(tokenAddr, money, FEE_TIER);
        require(pool != address(0), "no token/money pool");
        bool tokenIsToken0 = tokenAddr < money;
        uint160 limit = _getSqrtPriceLimitSafe(pool, tokenIsToken0);

        _safeApprove(money, swapRouter, moneyBal);
        tokenOut = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           money,
                tokenOut:          tokenAddr,
                fee:               FEE_TIER,
                recipient:         prizeWallet,
                amountIn:          moneyBal,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: limit
            })
        );
        require(tokenOut > 0, "zero token out");
    }

    // ── Buy-in slippage (mirrors SporeReactorV6) ──────────────────────────────

    function _getSqrtPriceLimitSafe(address poolAddr, bool tokenIsToken0) internal view returns (uint160) {
        (uint160 sqrtPriceX96,,,,,, bool unlocked) = IUniswapV3Pool(poolAddr).slot0();
        require(unlocked, "pool locked");
        return _calcPriceLimit(sqrtPriceX96, tokenIsToken0);
    }

    function _calcPriceLimit(uint160 sqrtPriceX96, bool tokenIsToken0) internal pure returns (uint160) {
        if (tokenIsToken0) {
            uint256 limit = uint256(sqrtPriceX96) * (10000 + MAX_PRICE_IMPACT_BPS) / 10000;
            if (limit <= sqrtPriceX96) limit = uint256(sqrtPriceX96) + 1;
            if (limit >= MAX_SQRT_RATIO) limit = MAX_SQRT_RATIO - 1;
            return uint160(limit);
        } else {
            uint256 limit = uint256(sqrtPriceX96) * (10000 - MAX_PRICE_IMPACT_BPS) / 10000;
            if (limit >= sqrtPriceX96) limit = uint256(sqrtPriceX96) - 1;
            if (limit <= MIN_SQRT_RATIO) limit = MIN_SQRT_RATIO + 1;
            return uint160(limit);
        }
    }

    // ── Safe token ops (used by the buy-in path) ──────────────────────────────

    function _safeTransfer(address _token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = _token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }

    function _safeApprove(address _token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = _token.call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, 0)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "approve reset failed");
        if (amount > 0) {
            (success, data) = _token.call(
                abi.encodeWithSelector(IERC20.approve.selector, spender, amount)
            );
            require(success && (data.length == 0 || abi.decode(data, (bool))), "approve failed");
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Note vs V1 Shipyard: the post-launch pool-management conveniences
    // (addPoolToReactor / addPoolFromHolding) and onERC721Received are omitted
    // here to keep ShipyardV2 under the 24,576-byte limit. They were never on the
    // launch path (the factory mints positions to itself and transfers them out;
    // it is never an NFT recipient via safeTransferFrom). Reactor pool management
    // still happens through the reactor's own admin (transferReactorAdmin).

    function transferReactorAdmin(address reactor, address newAdmin) external {
        require(msg.sender == owner, "not owner");
        ISporeReactorV6(reactor).transferAdmin(newAdmin);
    }

    /// @notice Owner sets the USDC launch fee. 0 = free launch, capped at $5.
    function setLaunchFee(uint256 newFee) external {
        require(msg.sender == owner, "not owner");
        require(newFee <= MAX_LAUNCH_FEE, "fee too high");
        launchFee = newFee;
        emit LaunchFeeSet(newFee);
    }

    /// @notice Owner sets the moonshot buy-in (USDC).
    function setBuyIn(uint256 newAmount) external {
        require(msg.sender == owner, "not owner");
        buyInAmount = newAmount;
        emit BuyInSet(newAmount);
    }

    /// @notice Owner sets the prize wallet (the moonshot TOKEN bag sink).
    function setPrizeWallet(address newPrizeWallet) external {
        require(msg.sender == owner, "not owner");
        require(newPrizeWallet != address(0), "zero prize wallet");
        prizeWallet = newPrizeWallet;
        emit PrizeWalletSet(newPrizeWallet);
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
