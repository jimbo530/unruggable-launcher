// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TGNReactor — V3 LP staking with TGN burn + auto-compound
///
/// Community deposits V3 LP position NFTs (full range) with a lock period.
/// Compound cycle (anyone can call):
///   1. collectFees() harvests V3 fees from a position
///   2. TGN portion auto-burned
///   3. Half of X token swapped → TGN (buy pressure)
///   4. Both tokens added back via increaseLiquidity (deeper LP)
///
/// All compound/burn functions are callable by ANYONE — no admin discretion.
///
/// Safety (ported from SporeReactorV4):
///   - Slippage protection: slot0-derived sqrtPriceLimitX96, 3% max impact per swap
///   - Pool reentrancy check: require(unlocked) before every swap
///   - MIN_PROCESS threshold: skip dust amounts that waste gas
///   - Admin can NEVER withdraw deposited position NFTs
///   - compound(), burnTGN() have ZERO admin gating
///   - Lock duration immutable once set
///   - Two-step admin transfer
///   - Reentrancy guard on all state-changing functions
///   - No removePool
///   - Emergency pause (deposits + fuel only, withdrawals always work)
///   - forwardTokens only handles ERC20, cannot touch locked NFTs

// ═══════════════════════════════════════════════════════════════════════════
//  Interfaces
// ═══════════════════════════════════════════════════════════════════════════

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
    function positions(uint256 tokenId) external view returns (
        uint96 nonce, address operator,
        address token0, address token1, uint24 fee,
        int24 tickLower, int24 tickUpper,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0, uint128 tokensOwed1
    );
    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
    function increaseLiquidity(IncreaseLiquidityParams calldata params) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
}

interface IUpstreamReactor {
    function fuel(address xToken, uint256 amount) external;
    function canFuel(address xToken) external view returns (bool);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Contract
// ═══════════════════════════════════════════════════════════════════════════

contract TGNReactor {

    // ── Constants ────────────────────────────────────────────────────────
    uint256 public constant MAX_POOLS = 20;
    uint256 public constant MIN_FUEL  = 1000;
    uint256 public constant MIN_PROCESS = 1000;  // skip dust below this
    uint256 public constant FUEL_BPS  = 1000;    // 10% forwarded upstream
    uint256 public constant MAX_PRICE_IMPACT_BPS = 300;  // 3% max slippage per swap

    address public constant BURN_ADDR = 0x000000000000000000000000000000000000dEaD;

    // UniswapV3 TickMath bounds
    uint160 private constant MIN_SQRT_RATIO = 4295128739;
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    // ── Immutables ───────────────────────────────────────────────────────
    INonfungiblePositionManager public immutable positionManager;
    ISwapRouter public immutable swapRouter;
    address public immutable tgnToken;

    // ── State ────────────────────────────────────────────────────────────
    address public upstreamReactor;
    uint256 public minLockDuration;
    uint256 public maxLockDuration;
    bool    public paused;

    uint256 public totalTGNBurned;
    uint256 public totalCompounded;  // count of compound operations

    struct Pool {
        address v3Pool;
        address token0;
        address token1;
        uint24  fee;
        bool    disabled;
    }

    struct Deposit {
        address depositor;
        uint256 tokenId;
        uint256 poolIndex;
        uint128 liquidity;   // V3 position liquidity (updated on compound)
        uint256 unlockTime;
        bool    withdrawn;
    }

    Pool[]    public pools;
    Deposit[] public deposits;

    uint128 public totalLiquidity;  // sum of all active deposit liquidities

    // Two-step admin transfer
    address public admin;
    address public pendingAdmin;

    // Reentrancy guard
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    // ── Events ──────────────────────────────────────────────────────────
    event PoolAdded(uint256 indexed poolIndex, address v3Pool, address token0, address token1, uint24 fee);
    event PoolDisabled(uint256 indexed poolIndex);
    event PoolEnabled(uint256 indexed poolIndex);
    event PositionDeposited(uint256 indexed depositId, address indexed depositor, uint256 tokenId, uint256 poolIndex, uint128 liquidity, uint256 unlockTime);
    event PositionWithdrawn(uint256 indexed depositId, address indexed depositor, uint256 tokenId);
    event TGNBurned(uint256 amount, uint256 totalBurned);
    event Compounded(uint256 indexed depositId, uint256 tgnBurned, uint128 liquidityAdded, uint256 amount0, uint256 amount1);
    event FuelProcessed(address indexed tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);
    event FuelSent(address indexed token, uint256 amount);
    event FuelFailed(address indexed token, uint256 amount);
    event TokensForwarded(address indexed token, address indexed to, uint256 amount);
    event AdminTransferStarted(address indexed current, address indexed pending);
    event AdminTransferred(address indexed previous, address indexed newAdmin);
    event Paused(bool status);
    event MinLockUpdated(uint256 oldDuration, uint256 newDuration);
    event UpstreamUpdated(address indexed oldUpstream, address indexed newUpstream);

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _positionManager,
        address _swapRouter,
        address _tgnToken,
        uint256 _minLockDuration,
        uint256 _maxLockDuration
    ) {
        require(_positionManager != address(0), "zero pm");
        require(_swapRouter != address(0), "zero router");
        require(_tgnToken != address(0), "zero tgn");
        require(_minLockDuration >= 1 days, "min 1 day");
        require(_maxLockDuration >= _minLockDuration, "max < min");

        positionManager = INonfungiblePositionManager(_positionManager);
        swapRouter      = ISwapRouter(_swapRouter);
        tgnToken        = _tgnToken;
        minLockDuration = _minLockDuration;
        maxLockDuration = _maxLockDuration;
        admin           = msg.sender;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Pool Management (admin only, no removePool)
    // ═══════════════════════════════════════════════════════════════════════

    function addPool(address v3Pool) external onlyAdmin {
        require(pools.length < MAX_POOLS, "max pools");
        require(v3Pool != address(0), "zero address");

        address t0  = IUniswapV3Pool(v3Pool).token0();
        address t1  = IUniswapV3Pool(v3Pool).token1();
        uint24  fee = IUniswapV3Pool(v3Pool).fee();
        require(t0 != address(0), "invalid pool");

        // At least one side must be TGN
        require(t0 == tgnToken || t1 == tgnToken, "pool must include TGN");

        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            require(pools[i].v3Pool != v3Pool, "already added");
        }

        pools.push(Pool({ v3Pool: v3Pool, token0: t0, token1: t1, fee: fee, disabled: false }));
        emit PoolAdded(pools.length - 1, v3Pool, t0, t1, fee);
    }

    function disablePool(uint256 poolIndex) external onlyAdmin {
        require(poolIndex < pools.length, "invalid index");
        require(!pools[poolIndex].disabled, "already disabled");
        pools[poolIndex].disabled = true;
        emit PoolDisabled(poolIndex);
    }

    function enablePool(uint256 poolIndex) external onlyAdmin {
        require(poolIndex < pools.length, "invalid index");
        require(pools[poolIndex].disabled, "already enabled");
        pools[poolIndex].disabled = false;
        emit PoolEnabled(poolIndex);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin Transfer (two-step)
    // ═══════════════════════════════════════════════════════════════════════

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "zero address");
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "not pending");
        emit AdminTransferred(admin, pendingAdmin);
        admin        = pendingAdmin;
        pendingAdmin = address(0);
    }

    function renounceAdmin() external onlyAdmin {
        emit AdminTransferred(admin, address(0));
        admin        = address(0);
        pendingAdmin = address(0);
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        emit Paused(_paused);
    }

    function setMinLockDuration(uint256 _duration) external onlyAdmin {
        require(_duration >= 1 days, "min 1 day");
        emit MinLockUpdated(minLockDuration, _duration);
        minLockDuration = _duration;
    }

    function setUpstreamReactor(address _upstream) external onlyAdmin {
        emit UpstreamUpdated(upstreamReactor, _upstream);
        upstreamReactor = _upstream;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Position Deposits
    // ═══════════════════════════════════════════════════════════════════════

    function depositPosition(uint256 tokenId, uint256 lockDuration) external nonReentrant {
        require(!paused, "paused");
        require(lockDuration >= minLockDuration, "lock too short");
        require(lockDuration <= maxLockDuration, "lock too long");

        (,, address t0, address t1, uint24 fee,,, uint128 liquidity,,,,)
            = positionManager.positions(tokenId);
        require(liquidity > 0, "no liquidity");

        uint256 poolIdx = _findPool(t0, t1, fee);
        require(poolIdx != type(uint256).max, "pool not allowed");
        require(!pools[poolIdx].disabled, "pool disabled");

        positionManager.transferFrom(msg.sender, address(this), tokenId);

        uint256 unlockTime = block.timestamp + lockDuration;
        uint256 depositId  = deposits.length;

        deposits.push(Deposit({
            depositor:  msg.sender,
            tokenId:    tokenId,
            poolIndex:  poolIdx,
            liquidity:  liquidity,
            unlockTime: unlockTime,
            withdrawn:  false
        }));

        totalLiquidity += liquidity;

        emit PositionDeposited(depositId, msg.sender, tokenId, poolIdx, liquidity, unlockTime);
    }

    /// @notice Withdraw position after lock. Always works, even when paused.
    function withdrawPosition(uint256 depositId) external nonReentrant {
        require(depositId < deposits.length, "invalid deposit");
        Deposit storage dep = deposits[depositId];

        require(msg.sender == dep.depositor, "not depositor");
        require(block.timestamp >= dep.unlockTime, "still locked");
        require(!dep.withdrawn, "already withdrawn");

        dep.withdrawn = true;
        totalLiquidity -= dep.liquidity;

        positionManager.safeTransferFrom(address(this), msg.sender, dep.tokenId);
        emit PositionWithdrawn(depositId, msg.sender, dep.tokenId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  TGN Burn — anyone can call, zero admin discretion
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Burns all accumulated TGN by sending to dead address.
    function burnTGN() external nonReentrant {
        uint256 bal = IERC20(tgnToken).balanceOf(address(this));
        require(bal > 0, "no TGN to burn");

        _safeTransfer(tgnToken, BURN_ADDR, bal);
        totalTGNBurned += bal;

        emit TGNBurned(bal, totalTGNBurned);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Compound — anyone can call, collect fees + burn TGN + deepen LP
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Compound a single position: collect fees, burn TGN, swap half X→TGN,
    ///         add both back as liquidity. Anyone can call.
    function compound(uint256 depositId) external nonReentrant {
        _compoundPosition(depositId);
    }

    /// @notice Compound all active positions in one call. Anyone can call.
    function compoundAll() external nonReentrant {
        uint256 len = deposits.length;
        for (uint256 i; i < len; ++i) {
            if (!deposits[i].withdrawn) {
                _compoundPosition(i);
            }
        }
    }

    function _compoundPosition(uint256 depositId) internal {
        Deposit storage dep = deposits[depositId];
        if (dep.withdrawn) return;

        Pool memory pool = pools[dep.poolIndex];

        // 1. Collect all accumulated fees
        (uint256 a0, uint256 a1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: dep.tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        if (a0 == 0 && a1 == 0) return;

        // 2. Identify sides and burn TGN fees
        bool tgnIs0 = (pool.token0 == tgnToken);
        {
            uint256 tgnFees = tgnIs0 ? a0 : a1;
            if (tgnFees > 0) {
                _safeTransfer(tgnToken, BURN_ADDR, tgnFees);
                totalTGNBurned += tgnFees;
                emit TGNBurned(tgnFees, totalTGNBurned);
            }
        }

        // 3. Compound X side: swap half → TGN, add both back as LP
        uint256 xFees = tgnIs0 ? a1 : a0;
        if (xFees >= MIN_PROCESS) {
            _swapAndAddLiquidity(dep, pool, tgnIs0, xFees, depositId);
        }
    }

    /// @dev Swap half of xFees → TGN with slippage protection, then increaseLiquidity.
    function _swapAndAddLiquidity(
        Deposit storage dep,
        Pool memory pool,
        bool tgnIs0,
        uint256 xFees,
        uint256 depositId
    ) internal {
        address xToken = tgnIs0 ? pool.token1 : pool.token0;
        uint256 halfX = xFees / 2;
        uint256 xForLP = xFees - halfX;

        // Slippage-protected swap: xToken → TGN
        // When selling xToken: if TGN is token0, xToken is token1 so tokenInIsToken0=false
        uint160 limit = _getSqrtPriceLimitSafe(pool.v3Pool, !tgnIs0, xToken);

        _safeApprove(xToken, address(swapRouter), halfX);
        uint256 tgnForLP;
        try swapRouter.exactInputSingle(ISwapRouter.ExactInputSingleParams({
            tokenIn:           xToken,
            tokenOut:          tgnToken,
            fee:               pool.fee,
            recipient:         address(this),
            deadline:          block.timestamp,
            amountIn:          halfX,
            amountOutMinimum:  0,
            sqrtPriceLimitX96: limit
        })) returns (uint256 tgnOut) {
            tgnForLP = tgnOut;
        } catch {
            _safeApprove(xToken, address(swapRouter), 0);
            return;
        }

        if (tgnForLP == 0) return;

        // Add liquidity back to position
        uint256 amt0 = tgnIs0 ? tgnForLP : xForLP;
        uint256 amt1 = tgnIs0 ? xForLP   : tgnForLP;

        _safeApprove(pool.token0, address(positionManager), amt0);
        _safeApprove(pool.token1, address(positionManager), amt1);

        try positionManager.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId:        dep.tokenId,
                amount0Desired: amt0,
                amount1Desired: amt1,
                amount0Min:     0,
                amount1Min:     0,
                deadline:       block.timestamp
            })
        ) returns (uint128 addedLiq, uint256 used0, uint256 used1) {
            dep.liquidity += addedLiq;
            totalLiquidity += addedLiq;
            totalCompounded++;
            emit Compounded(depositId, 0, addedLiq, used0, used1);
        } catch {
            _safeApprove(pool.token0, address(positionManager), 0);
            _safeApprove(pool.token1, address(positionManager), 0);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Fuel Processing — reactor network compatible, V3 swaps
    // ═══════════════════════════════════════════════════════════════════════

    function fuel(address token, uint256 amount) external nonReentrant {
        require(!paused, "paused");
        require(amount >= MIN_FUEL, "below minimum");

        _safeTransferFrom(token, msg.sender, address(this), amount);

        uint256 fuelPortion;
        if (upstreamReactor != address(0)) {
            fuelPortion = amount * FUEL_BPS / 10000;
            if (fuelPortion >= MIN_FUEL) {
                _safeApprove(token, upstreamReactor, fuelPortion);
                try IUpstreamReactor(upstreamReactor).fuel(token, fuelPortion) {
                    emit FuelSent(token, fuelPortion);
                } catch {
                    emit FuelFailed(token, fuelPortion);
                    _safeApprove(token, upstreamReactor, 0);
                    fuelPortion = 0;
                }
            } else {
                fuelPortion = 0;
            }
        }

        uint256 swapAmount = amount - fuelPortion;
        if (swapAmount >= MIN_PROCESS) {
            _swapFuel(token, swapAmount);
        }
    }

    function canFuel(address token) external view returns (bool) {
        return _findPoolWithToken(token) < type(uint256).max;
    }

    /// @notice Admin forwards loose ERC20 tokens. Cannot touch locked NFTs.
    function forwardTokens(address token, address to, uint256 amount) external onlyAdmin {
        require(to != address(0), "zero address");
        require(amount > 0, "zero amount");
        _safeTransfer(token, to, amount);
        emit TokensForwarded(token, to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Fuel Swap (slippage protected)
    // ═══════════════════════════════════════════════════════════════════════

    function _swapFuel(address tokenIn, uint256 amountIn) internal {
        uint256 poolIdx = _findPoolWithToken(tokenIn);
        if (poolIdx == type(uint256).max) return;

        Pool memory pool = pools[poolIdx];
        address tokenOut = (tokenIn == pool.token0) ? pool.token1 : pool.token0;
        bool tokenInIsToken0 = (tokenIn == pool.token0);

        uint160 limit = _getSqrtPriceLimitSafe(pool.v3Pool, tokenInIsToken0, tokenIn);

        _safeApprove(tokenIn, address(swapRouter), amountIn);

        try swapRouter.exactInputSingle(ISwapRouter.ExactInputSingleParams({
            tokenIn:           tokenIn,
            tokenOut:          tokenOut,
            fee:               pool.fee,
            recipient:         address(this),
            deadline:          block.timestamp,
            amountIn:          amountIn,
            amountOutMinimum:  0,
            sqrtPriceLimitX96: limit
        })) returns (uint256 amountOut) {
            emit FuelProcessed(tokenIn, amountIn, tokenOut, amountOut);
        } catch {
            _safeApprove(tokenIn, address(swapRouter), 0);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Slippage Protection (from SporeReactorV4)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Read slot0, verify pool isn't being reentered, then cap price movement at 3%.
    ///      For compound swaps: selling xToken for TGN, so direction depends on token order.
    function _getSqrtPriceLimitSafe(address poolAddr, bool tokenInIsToken0, address /*tokenIn*/) internal view returns (uint160) {
        (uint160 sqrtPriceX96,,,,,, bool unlocked) = IUniswapV3Pool(poolAddr).slot0();
        require(unlocked, "pool locked");

        if (tokenInIsToken0) {
            // Selling token0 → sqrtPrice falls
            uint256 limit = uint256(sqrtPriceX96) * (10000 - MAX_PRICE_IMPACT_BPS) / 10000;
            if (limit >= sqrtPriceX96) limit = uint256(sqrtPriceX96) - 1;
            if (limit <= MIN_SQRT_RATIO) limit = MIN_SQRT_RATIO + 1;
            return uint160(limit);
        } else {
            // Selling token1 → sqrtPrice rises
            uint256 limit = uint256(sqrtPriceX96) * (10000 + MAX_PRICE_IMPACT_BPS) / 10000;
            if (limit <= sqrtPriceX96) limit = uint256(sqrtPriceX96) + 1;
            if (limit >= MAX_SQRT_RATIO) limit = MAX_SQRT_RATIO - 1;
            return uint160(limit);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Pool Lookup
    // ═══════════════════════════════════════════════════════════════════════

    function _findPool(address t0, address t1, uint24 fee) internal view returns (uint256) {
        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            if (pools[i].token0 == t0 && pools[i].token1 == t1 && pools[i].fee == fee) {
                return i;
            }
        }
        return type(uint256).max;
    }

    function _findPoolWithToken(address token) internal view returns (uint256) {
        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            if (!pools[i].disabled && (pools[i].token0 == token || pools[i].token1 == token)) {
                return i;
            }
        }
        return type(uint256).max;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Safe Token Operations
    // ═══════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════════════════════════════════

    function poolCount() external view returns (uint256) { return pools.length; }
    function depositCount() external view returns (uint256) { return deposits.length; }

    function getDeposit(uint256 depositId) external view returns (
        address depositor, uint256 tokenId, uint256 poolIndex,
        uint128 liquidity, uint256 unlockTime, bool withdrawn
    ) {
        require(depositId < deposits.length, "invalid deposit");
        Deposit memory dep = deposits[depositId];
        return (dep.depositor, dep.tokenId, dep.poolIndex, dep.liquidity, dep.unlockTime, dep.withdrawn);
    }

    function getDepositsBy(address depositor) external view returns (uint256[] memory) {
        uint256 count;
        uint256 len = deposits.length;
        for (uint256 i; i < len; ++i) {
            if (deposits[i].depositor == depositor) count++;
        }
        uint256[] memory ids = new uint256[](count);
        uint256 idx;
        for (uint256 i; i < len; ++i) {
            if (deposits[i].depositor == depositor) ids[idx++] = i;
        }
        return ids;
    }

    function timeUntilUnlock(uint256 depositId) external view returns (uint256) {
        require(depositId < deposits.length, "invalid deposit");
        if (block.timestamp >= deposits[depositId].unlockTime) return 0;
        return deposits[depositId].unlockTime - block.timestamp;
    }

    function isUnlocked(uint256 depositId) external view returns (bool) {
        require(depositId < deposits.length, "invalid deposit");
        return block.timestamp >= deposits[depositId].unlockTime && !deposits[depositId].withdrawn;
    }

    function activePoolCount() external view returns (uint256) {
        uint256 count;
        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            if (!pools[i].disabled) count++;
        }
        return count;
    }

    function dustBalance(address _token) external view returns (uint256) {
        return IERC20(_token).balanceOf(address(this));
    }
}
