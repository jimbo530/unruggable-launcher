// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// ⚠️ SUPERSEDED by SporeReactorV6 / MycoPadV9 — kept for reference, DO NOT DEPLOY.
///    This "pay launcher 50% in the launched token" model is replaced by the V6
///    model (burn 100% of the launched token; redeem Money fees to USDC and pay
///    the FeeShareDistributor in USDC). Retained only for diff history.
///
/// @title SporeReactorV5 — Reactor with fee-share NFT distributor
///
/// Clone of SporeReactorV4 with ONE behavioral change: in processPool step 2
/// the launcher 50% of core-token fees is sent to a FeeShareDistributor
/// (which splits it across 100 NFTs) instead of a single launcher wallet.
///
/// V5 changes over V4:
///   1. `distributor` address stored; settable ONCE by admin (the factory)
///      after the distributor is deployed (chicken/egg: reactor address is
///      needed to construct the distributor, distributor address is needed
///      here, so it is wired post-initialize via setDistributor()).
///   2. processPool step 2: 50% burn / 50% to distributor + notifyDeposit().
///      If the distributor is not yet set, the launcher 50% falls back to the
///      launcher wallet exactly like V4 (so the reactor is never bricked).
///   3. DistributorFunded event (LauncherPaid retained for back-compat).
///
/// Everything else (burn, the X-side fuel/buy/LP logic) is byte-identical to V4.

// Interfaces

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
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

contract SporeReactorV5 {

    address private constant BURN = 0xfd780B0aE569e15e514B819ecFDF46f804953a4B;
    uint256 public  constant COOLDOWN  = 2 hours;
    uint256 public  constant MAX_POOLS = 20;
    uint256 public  constant MIN_FUEL  = 1000;
    uint256 public  constant MIN_PROCESS = 1000;
    uint256 private constant FUEL_BPS  = 1000;    // 10% of X-token to upstream
    uint256 private constant LAUNCHER_BPS = 5000; // 50% of core-token fees to fee-share
    uint256 public  constant MAX_PRICE_IMPACT_BPS = 300;

    uint160 private constant MIN_SQRT_RATIO = 4295128739;
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    address public token;
    address public mft;
    INonfungiblePositionManager public pm;
    ISwapRouter02 public router;
    IUniswapV3Factory public factory;
    IUpstreamReactor public upstreamReactor;
    address public launcher;
    address public distributor;   // V5: fee-share NFT distributor (settable once)
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

    event Executed(uint256 burned, uint256 paid, uint256 deposited, uint256 fueled, uint256 timestamp, address caller);
    event LauncherPaid(address indexed launcher, uint256 amount);
    event DistributorFunded(address indexed distributor, uint256 amount);
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
        require(_pm      != address(0), "zero pm");
        require(_router  != address(0), "zero router");
        require(_factory != address(0), "zero factory");
        require(_upstreamReactor != address(0), "zero upstream");
        require(_launcher != address(0), "zero launcher");
        require(_token != _mft, "token cannot be mft");

        token            = _token;
        mft              = _mft;
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
        uint256 totalPaid;
        uint256 totalDeposited;
        uint256 totalFueled;
        uint256 len = pools.length;

        for (uint256 i; i < len; ++i) {
            if (pools[i].disabled) {
                emit PoolSkipped(i, pools[i].tokenId);
                continue;
            }
            try this.processPool(i) returns (uint256 burned, uint256 paid, uint256 bought, uint256 fueled) {
                totalBurned += burned;
                totalPaid += paid;
                totalDeposited += bought;
                totalFueled += fueled;
            } catch {
                emit PoolSkipped(i, pools[i].tokenId);
            }
        }

        emit Executed(totalBurned, totalPaid, totalDeposited, totalFueled, block.timestamp, msg.sender);
    }

    function processPool(uint256 poolIndex) external onlySelf returns (uint256 burned, uint256 paid, uint256 bought, uint256 fueled) {
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

        // 2. V5: Split core-token fees — 50% burn, 50% to fee-share distributor
        uint256 tokenBal = IERC20(token).balanceOf(address(this));
        if (tokenBal > 0) {
            uint256 toLauncher = tokenBal * LAUNCHER_BPS / 10000;
            uint256 toBurn = tokenBal - toLauncher;
            if (toBurn > 0) {
                _safeTransfer(token, BURN, toBurn);
                burned = toBurn;
            }
            if (toLauncher > 0) {
                if (distributor != address(0)) {
                    // Transfer the launcher share to the distributor, then notify.
                    _safeTransfer(token, distributor, toLauncher);
                    IFeeShareDistributor(distributor).notifyDeposit(toLauncher);
                    paid = toLauncher;
                    emit DistributorFunded(distributor, toLauncher);
                } else {
                    // Fallback (distributor not wired): pay launcher wallet (V4 behavior).
                    _safeTransfer(token, launcher, toLauncher);
                    paid = toLauncher;
                    emit LauncherPaid(launcher, toLauncher);
                }
            }
        }

        // 3. Get total X-token balance
        uint256 xBal = IERC20(pool.xToken).balanceOf(address(this));
        if (xBal < MIN_PROCESS) return (burned, paid, 0, 0);

        // 4. Divert 10% of X-token to upstream reactor
        uint256 fuelAmount = xBal * FUEL_BPS / 10000;
        if (fuelAmount >= MIN_FUEL) {
            _safeApprove(pool.xToken, address(upstreamReactor), fuelAmount);
            try upstreamReactor.fuel(pool.xToken, fuelAmount) {
                fueled = fuelAmount;
                emit FuelSent(pool.xToken, fuelAmount);
            } catch {
                emit FuelFailed(pool.xToken, fuelAmount);
                _safeApprove(pool.xToken, address(upstreamReactor), 0);
                fuelAmount = 0;
            }
        } else {
            fuelAmount = 0;
        }

        // 5. Remaining X: split half buy / half LP
        uint256 xRemaining = xBal - fuelAmount;
        if (xRemaining < MIN_PROCESS) return (burned, paid, 0, fueled);

        uint256 xForBuy = xRemaining / 2;
        uint256 xForLP  = xRemaining - xForBuy;

        // 6. Slippage-protected swap: buy core token with half-X
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

        // 7. Deposit bought token + remaining X as deeper LP
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

        // 8. Burn any dust from ratio mismatch
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) {
            _safeTransfer(token, BURN, dust);
            burned += dust;
        }
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
