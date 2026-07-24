// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SporeReactorV6 — Burn-token / redeem-Money-to-USDC fee-share reactor
///
/// Remodel of SporeReactorV5. Per pool, when fees are collected:
///   1. Collected launched TOKEN → BURN 100% (no launcher cut, no token payout).
///   2. xToken branch:
///      - xToken == money: redeem ALL collected Money to USDC via
///        IMoney(money).redeem(amount); MEASURE the reactor's real USDC balance
///        increase; transfer that USDC delta to the FeeShareDistributor and call
///        notifyDeposit(delta). Money is NEVER transferred out as Money ("can't
///        leak") — only redeemed. If redeem reverts or yields zero USDC delta,
///        the pool is skipped gracefully (the whole fire is NOT reverted) and a
///        RedeemFailed/RedeemZero event is emitted so the failure is visible.
///      - xToken == meme: LP-ONLY (no upstream fuel). 100% of collected MfT/X
///        fees buy half TOKEN and deepen the TOKEN/Meme LP.
///   3. Any other xToken: same LP-only buy+deepen behavior.
///
/// DESIGN INVARIANT — POSITIONS ARE PERMANENT, ONLY FEES MOVE:
///   The reactor only ever COLLECTS and PROCESSES FEES. The underlying Money
///   (calm/stable anchor) and Meme (volatile) Uniswap V3 LP positions are NEVER
///   withdrawn, decreased, or drained — there is no decreaseLiquidity / withdraw
///   / position-transfer path in this contract. processPool only calls
///   pm.collect() (fees) and pm.increaseLiquidity() (deepen). Both pools stay
///   permanently liquid. The upstream-"fuel" engine now lives in the game layer,
///   not in this contract.
///
/// V6 changes over V5:
///   - initialize() extended to accept `money` and `usdc` (added params).
///   - LAUNCHER_BPS 50/50 split removed — collected TOKEN is burned 100%.
///   - processPool Money branch redeems to USDC and funds the distributor.
///   - Meme side is LP-ONLY: the 10% upstream-fuel diversion is removed.
///     `upstreamReactor` is kept in initialize (unused) to avoid changing the
///     factory/initialize signature; the standalone fuel() intake is untouched.
///   - setDistributor() once-settable pattern retained from V5.
/// No token addresses are hardcoded — all passed in at initialize.

// Interfaces

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IMoney {
    /// @dev VERIFIED on Base fork (block 47510000): the live Money is an EIP-1167
    ///      clone (impl 0xbea5…c96f, exposes usdc()) whose holder-callable
    ///      redeem(uint256) burns the caller's Money and delivers USDC 1:1.
    ///      (withdraw(uint256) does NOT exist on the live impl — do not use it.)
    function redeem(uint256 amount) external;
}

interface INonfungiblePositionManager {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }
    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }
    function collect(CollectParams calldata) external payable returns (uint256, uint256);
    function increaseLiquidity(IncreaseLiquidityParams calldata) external payable returns (uint128, uint256, uint256);
    function positions(uint256 tokenId) external view returns (
        uint96, address, address, address, uint24, int24, int24, uint128,
        uint256, uint256, uint128, uint128
    );
    function ownerOf(uint256 tokenId) external view returns (address);
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

interface IUniswapV3Factory {
    function getPool(address, address, uint24) external view returns (address);
}

interface IUniswapV3Pool {
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
        uint16 observationCardinality, uint16 observationCardinalityNext,
        uint8 feeProtocol, bool unlocked
    );
}

interface IUpstreamReactor {
    function fuel(address xToken, uint256 amount) external;
    function canFuel(address xToken) external view returns (bool);
}

interface IFeeShareDistributor {
    function notifyDeposit(uint256 amount) external;
}

contract SporeReactorV6 {

    address private constant BURN = 0xfd780B0aE569e15e514B819ecFDF46f804953a4B;
    uint256 public  constant COOLDOWN  = 2 hours;
    uint256 public  constant MAX_POOLS = 20;
    uint256 public  constant MIN_FUEL  = 1000;
    uint256 public  constant MIN_PROCESS = 1000;
    uint256 private constant FUEL_BPS  = 1000;    // 10% of X-token to upstream
    uint256 public  constant MAX_PRICE_IMPACT_BPS = 300;

    uint160 private constant MIN_SQRT_RATIO = 4295128739;
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    address public token;
    address public mft;       // == meme (MfT). Kept name for V4/V5 parity.
    address public money;     // V6: Money receipt token (redeemed to USDC)
    address public usdc;      // V6: USDC, the distributor payout token
    INonfungiblePositionManager public pm;
    ISwapRouter02 public router;
    IUniswapV3Factory public factory;
    IUpstreamReactor public upstreamReactor;
    address public launcher;
    address public distributor;   // fee-share NFT distributor (settable once)
    bool public initialized;

    uint256 public lastExecute;
    bool public paused;

    struct Pool {
        uint256 tokenId;
        address xToken;
        address poolAddress;
        uint24  fee;
        bool    tokenIsToken0;
        bool    disabled;
    }
    Pool[] public pools;
    mapping(uint256 => bool) public registeredTokenId;
    mapping(address => bool) public hasXToken;

    address public admin;
    address public pendingAdmin;

    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    event Executed(uint256 burned, uint256 redeemed, uint256 deposited, uint256 fueled, uint256 timestamp, address caller);
    event TokenBurned(uint256 indexed poolIndex, uint256 amount);
    event MoneyRedeemed(uint256 indexed poolIndex, uint256 moneyIn, uint256 usdcOut);
    event RedeemFailed(uint256 indexed poolIndex, uint256 moneyAmount);
    event RedeemZero(uint256 indexed poolIndex, uint256 moneyAmount);
    event DistributorFunded(address indexed distributor, uint256 usdcAmount);
    event DistributorSet(address indexed distributor);
    event PoolAdded(uint256 indexed tokenId, address xToken, address poolAddr, uint24 fee);
    event PoolDisabled(uint256 indexed poolIndex, uint256 tokenId);
    event PoolEnabled(uint256 indexed poolIndex, uint256 tokenId);
    event PoolSkipped(uint256 indexed poolIndex, uint256 tokenId);
    event FuelSent(address indexed xToken, uint256 amount);
    event FuelFailed(address indexed xToken, uint256 amount);
    event LiquidityDeposited(uint256 indexed poolIndex, uint256 amount0, uint256 amount1);
    event Fueled(uint256 indexed poolIndex, address xToken, uint256 xIn, uint256 tokenDeposited, uint256 xDeposited);
    event DustBurned(uint256 amount);
    event AdminTransferStarted(address indexed current, address indexed pending);
    event AdminTransferred(address indexed previous, address indexed newAdmin);
    event Paused(bool status);

    modifier onlyAdmin() { require(msg.sender == admin, "not admin"); _; }
    modifier onlySelf() { require(msg.sender == address(this), "internal only"); _; }

    function initialize(
        address _token,
        address _mft,
        address _money,
        address _usdc,
        address _pm,
        address _router,
        address _factory,
        address _upstreamReactor,
        address _launcher
    ) external {
        require(!initialized, "already initialized");
        initialized = true;

        require(_token   != address(0), "zero token");
        require(_mft     != address(0), "zero mft");
        require(_money   != address(0), "zero money");
        require(_usdc    != address(0), "zero usdc");
        require(_pm      != address(0), "zero pm");
        require(_router  != address(0), "zero router");
        require(_factory != address(0), "zero factory");
        require(_upstreamReactor != address(0), "zero upstream");
        require(_launcher != address(0), "zero launcher");
        require(_token != _mft, "token cannot be mft");
        require(_money != _usdc, "money cannot be usdc");

        token            = _token;
        mft              = _mft;
        money            = _money;
        usdc             = _usdc;
        pm               = INonfungiblePositionManager(_pm);
        router           = ISwapRouter02(_router);
        factory          = IUniswapV3Factory(_factory);
        upstreamReactor  = IUpstreamReactor(_upstreamReactor);
        launcher         = _launcher;
        admin            = msg.sender;
        _locked          = 1;
    }

    /// @notice Wire the fee-share distributor. Callable once by the admin
    ///         (the factory) after the distributor has been deployed.
    function setDistributor(address _distributor) external onlyAdmin {
        require(distributor == address(0), "distributor already set");
        require(_distributor != address(0), "zero distributor");
        distributor = _distributor;
        emit DistributorSet(_distributor);
    }

    // ── Pool Management ─────────────────────────────────────────────────────

    function addPool(uint256 tokenId) external onlyAdmin {
        require(pools.length < MAX_POOLS, "max pools reached");
        require(!registeredTokenId[tokenId], "already registered");
        require(pm.ownerOf(tokenId) == address(this), "NFT not owned by reactor");

        (, , address token0, address token1, uint24 fee, , , , , , ,) = pm.positions(tokenId);

        bool is0 = (token0 == token);
        bool is1 = (token1 == token);
        require(is0 || is1, "token not in pair");

        address xToken = is0 ? token1 : token0;
        require(xToken != token, "xToken cannot be native token");

        address poolAddr = factory.getPool(token0, token1, fee);
        require(poolAddr != address(0), "pool not found");

        pools.push(Pool({
            tokenId:       tokenId,
            xToken:        xToken,
            poolAddress:   poolAddr,
            fee:           fee,
            tokenIsToken0: is0,
            disabled:      false
        }));
        registeredTokenId[tokenId] = true;
        hasXToken[xToken] = true;

        emit PoolAdded(tokenId, xToken, poolAddr, fee);
    }

    function disablePool(uint256 poolIndex) external onlyAdmin {
        require(poolIndex < pools.length, "invalid index");
        require(!pools[poolIndex].disabled, "already disabled");
        pools[poolIndex].disabled = true;
        emit PoolDisabled(poolIndex, pools[poolIndex].tokenId);
    }

    function enablePool(uint256 poolIndex) external onlyAdmin {
        require(poolIndex < pools.length, "invalid index");
        require(pools[poolIndex].disabled, "already enabled");
        pools[poolIndex].disabled = false;
        emit PoolEnabled(poolIndex, pools[poolIndex].tokenId);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "zero address");
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "not pending admin");
        emit AdminTransferred(admin, pendingAdmin);
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    function renounceAdmin() external onlyAdmin {
        emit AdminTransferred(admin, address(0));
        admin = address(0);
        pendingAdmin = address(0);
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        emit Paused(_paused);
    }

    // ── Fuel Intake ─────────────────────────────────────────────────────────

    function depositLiquidity(uint256 poolIndex, uint256 tokenAmount, uint256 xAmount) external nonReentrant {
        require(poolIndex < pools.length, "invalid index");
        require(!pools[poolIndex].disabled, "pool disabled");
        Pool memory pool = pools[poolIndex];

        if (tokenAmount > 0) {
            _safeTransferFrom(token, msg.sender, address(this), tokenAmount);
            _safeApprove(token, address(pm), tokenAmount);
        }
        if (xAmount > 0) {
            _safeTransferFrom(pool.xToken, msg.sender, address(this), xAmount);
            _safeApprove(pool.xToken, address(pm), xAmount);
        }

        uint256 a0d = pool.tokenIsToken0 ? tokenAmount : xAmount;
        uint256 a1d = pool.tokenIsToken0 ? xAmount : tokenAmount;

        pm.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId:        pool.tokenId,
                amount0Desired: a0d,
                amount1Desired: a1d,
                amount0Min:     0,
                amount1Min:     0,
                deadline:       block.timestamp
            })
        );

        emit LiquidityDeposited(poolIndex, a0d, a1d);
    }

    function fuel(address xToken, uint256 amount) external nonReentrant {
        require(amount >= MIN_FUEL, "below minimum fuel");

        uint256 poolIndex = _findPool(xToken);
        require(poolIndex < type(uint256).max, "no pool for token");

        Pool memory pool = pools[poolIndex];
        require(!pool.disabled, "pool disabled");

        _safeTransferFrom(xToken, msg.sender, address(this), amount);

        uint256 halfX  = amount / 2;
        uint256 xForLP = amount - halfX;

        uint160 limit = _getSqrtPriceLimitSafe(pool.poolAddress, pool.tokenIsToken0);

        _safeApprove(xToken, address(router), halfX);
        uint256 tokenAmount = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           xToken,
                tokenOut:          token,
                fee:               pool.fee,
                recipient:         address(this),
                amountIn:          halfX,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: limit
            })
        );

        _safeApprove(token, address(pm), tokenAmount);
        _safeApprove(xToken, address(pm), xForLP);

        uint256 a0d = pool.tokenIsToken0 ? tokenAmount : xForLP;
        uint256 a1d = pool.tokenIsToken0 ? xForLP : tokenAmount;

        pm.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId:        pool.tokenId,
                amount0Desired: a0d,
                amount1Desired: a1d,
                amount0Min:     0,
                amount1Min:     0,
                deadline:       block.timestamp
            })
        );

        _burnDust();

        emit Fueled(poolIndex, xToken, amount, tokenAmount, xForLP);
    }

    // ── Execute ─────────────────────────────────────────────────────────────

    function execute() external nonReentrant {
        require(!paused, "paused");
        require(block.timestamp >= lastExecute + COOLDOWN, "cooldown");
        lastExecute = block.timestamp;

        uint256 totalBurned;
        uint256 totalRedeemed;
        uint256 totalDeposited;
        uint256 totalFueled;
        uint256 len = pools.length;

        for (uint256 i; i < len; ++i) {
            if (pools[i].disabled) {
                emit PoolSkipped(i, pools[i].tokenId);
                continue;
            }
            try this.processPool(i) returns (uint256 burned, uint256 redeemed, uint256 bought, uint256 fueled) {
                totalBurned += burned;
                totalRedeemed += redeemed;
                totalDeposited += bought;
                totalFueled += fueled;
            } catch {
                emit PoolSkipped(i, pools[i].tokenId);
            }
        }

        emit Executed(totalBurned, totalRedeemed, totalDeposited, totalFueled, block.timestamp, msg.sender);
    }

    function processPool(uint256 poolIndex) external onlySelf returns (uint256 burned, uint256 redeemed, uint256 bought, uint256 fueled) {
        Pool memory pool = pools[poolIndex];

        // 1. Collect fees
        pm.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:    pool.tokenId,
                recipient:  address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // 2. V6: Collected launched TOKEN → BURN 100% (no launcher cut).
        uint256 tokenBal = IERC20(token).balanceOf(address(this));
        if (tokenBal > 0) {
            _safeTransfer(token, BURN, tokenBal);
            burned = tokenBal;
            emit TokenBurned(poolIndex, tokenBal);
        }

        // 3. xToken branch
        if (pool.xToken == money) {
            // 3a. Money branch — redeem ALL collected Money to USDC → distributor.
            redeemed = _redeemMoneyToDistributor(poolIndex);
            return (burned, redeemed, 0, 0);
        }

        // 3b. Meme (and any other xToken) branch — LP-ONLY (no upstream fuel).
        //     100% of the collected MfT/X fees feed the LP-deepen path: buy half
        //     TOKEN with X, then deepen the TOKEN/Meme position with the other
        //     half X + the bought TOKEN. The upstream "fuel" diversion has been
        //     removed — that engine now lives in the game layer, not here.
        //     NOTE: this only ever spends COLLECTED FEES; the LP position
        //     principal is never withdrawn or reduced (see invariant below).
        //     `fueled` stays 0 (kept in the return tuple / Executed event for
        //     ABI stability with V4/V5).
        uint256 xBal = IERC20(pool.xToken).balanceOf(address(this));
        if (xBal < MIN_PROCESS) return (burned, 0, 0, 0);

        // 100% of X: split half buy / half LP
        uint256 xForBuy = xBal / 2;
        uint256 xForLP  = xBal - xForBuy;

        // Slippage-protected swap: buy core token with half-X
        uint160 limit = _getSqrtPriceLimitSafe(pool.poolAddress, pool.tokenIsToken0);

        _safeApprove(pool.xToken, address(router), xForBuy);
        bought = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           pool.xToken,
                tokenOut:          token,
                fee:               pool.fee,
                recipient:         address(this),
                amountIn:          xForBuy,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: limit
            })
        );

        // Deposit bought token + remaining X as deeper LP
        if (bought > 0 && xForLP > 0) {
            _safeApprove(token, address(pm), bought);
            _safeApprove(pool.xToken, address(pm), xForLP);

            uint256 a0d = pool.tokenIsToken0 ? bought : xForLP;
            uint256 a1d = pool.tokenIsToken0 ? xForLP : bought;

            pm.increaseLiquidity(
                INonfungiblePositionManager.IncreaseLiquidityParams({
                    tokenId:        pool.tokenId,
                    amount0Desired: a0d,
                    amount1Desired: a1d,
                    amount0Min:     0,
                    amount1Min:     0,
                    deadline:       block.timestamp
                })
            );
        }

        // Burn any dust from ratio mismatch
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) {
            _safeTransfer(token, BURN, dust);
            burned += dust;
        }
    }

    // ── Money → USDC redemption ──────────────────────────────────────────────

    /// @dev Redeems ALL collected Money to USDC and forwards the real USDC delta
    ///      to the distributor. Never transfers Money out as Money. On any
    ///      failure (redeem reverts, or zero USDC delta) it does NOT revert the
    ///      caller — it emits a visible event and returns 0. Called only inside
    ///      processPool (onlySelf gating on the parent), so the try/catch in
    ///      execute() still wraps the whole pool.
    function _redeemMoneyToDistributor(uint256 poolIndex) internal returns (uint256 usdcOut) {
        uint256 moneyBal = IERC20(money).balanceOf(address(this));
        if (moneyBal < MIN_PROCESS) return 0;
        if (distributor == address(0)) {
            // Not wired yet — surface it, keep the Money (don't leak / don't burn).
            emit RedeemFailed(poolIndex, moneyBal);
            return 0;
        }

        uint256 usdcBefore = IERC20(usdc).balanceOf(address(this));

        // Redeem Money → USDC. redeem() burns Money and delivers USDC 1:1;
        // Money must NEVER be transferred out as Money.
        try IMoney(money).redeem(moneyBal) {
            // proceed to measure below
        } catch {
            emit RedeemFailed(poolIndex, moneyBal);
            return 0;
        }

        uint256 usdcAfter = IERC20(usdc).balanceOf(address(this));
        uint256 delta = usdcAfter - usdcBefore; // real USDC received
        if (delta == 0) {
            emit RedeemZero(poolIndex, moneyBal);
            return 0;
        }

        // Forward the USDC delta to the distributor, then notify.
        _safeTransfer(usdc, distributor, delta);
        IFeeShareDistributor(distributor).notifyDeposit(delta);

        emit MoneyRedeemed(poolIndex, moneyBal, delta);
        emit DistributorFunded(distributor, delta);
        return delta;
    }

    // ── Slippage Protection ─────────────────────────────────────────────────

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

    // ── Safe Token Operations ───────────────────────────────────────────────

    function _safeTransfer(address _token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = _token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }

    function _safeTransferFrom(address _token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = _token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transferFrom failed");
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

    function _findPool(address xToken) internal view returns (uint256) {
        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            if (pools[i].xToken == xToken && !pools[i].disabled) return i;
        }
        return type(uint256).max;
    }

    function _burnDust() internal {
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) {
            _safeTransfer(token, BURN, dust);
            emit DustBurned(dust);
        }
    }

    // ── Views ───────────────────────────────────────────────────────────────

    function poolCount() external view returns (uint256) { return pools.length; }

    function activePoolCount() external view returns (uint256) {
        uint256 count;
        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            if (!pools[i].disabled) count++;
        }
        return count;
    }

    function timeUntilExecute() external view returns (uint256) {
        if (block.timestamp >= lastExecute + COOLDOWN) return 0;
        return (lastExecute + COOLDOWN) - block.timestamp;
    }

    function canFuel(address xToken) external view returns (bool) {
        return _findPool(xToken) < type(uint256).max;
    }

    function dustBalance(address _token) external view returns (uint256) {
        return IERC20(_token).balanceOf(address(this));
    }

    function onERC721Received(address, address from, uint256, bytes calldata) external view returns (bytes4) {
        require(from == admin, "only admin can send NFTs");
        return this.onERC721Received.selector;
    }
}
