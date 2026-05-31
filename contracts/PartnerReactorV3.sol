// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PartnerReactorV3 — Time-locked V3 LP positions with fuel processing
///
/// Community deposits V3 LP position NFTs with a minimum lock period.
/// Positions should be full-range for simplicity. Fees accumulate inside
/// the locked position — depositor gets position + all accrued fees on withdraw.
/// Fuel tokens are swapped through V3 pools to generate volume/fees.
///
/// Safety:
///   - Admin can NEVER withdraw deposited position NFTs
///   - Lock duration immutable once set (cannot be shortened)
///   - Two-step admin transfer (matches SporeReactorV4 pattern)
///   - Reentrancy guard on all state-changing functions
///   - No removePool — pools are permanent once added
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
    function positions(uint256 tokenId) external view returns (
        uint96 nonce, address operator,
        address token0, address token1, uint24 fee,
        int24 tickLower, int24 tickUpper,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0, uint128 tokensOwed1
    );
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
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

contract PartnerReactorV3 {

    // ── Constants ────────────────────────────────────────────────────────
    uint256 public constant MAX_POOLS = 20;
    uint256 public constant MIN_FUEL  = 1000;
    uint256 public constant FUEL_BPS  = 1000;   // 10% forwarded upstream

    // ── State ────────────────────────────────────────────────────────────
    INonfungiblePositionManager public positionManager;
    ISwapRouter public swapRouter;
    address public upstreamReactor;
    uint256 public minLockDuration;
    uint256 public maxLockDuration;
    bool    public paused;

    struct Pool {
        address v3Pool;
        address token0;
        address token1;
        uint24  fee;
        bool    disabled;
    }

    struct Deposit {
        address depositor;
        uint256 tokenId;     // V3 position NFT ID
        uint256 poolIndex;
        uint256 unlockTime;
        bool    withdrawn;
    }

    Pool[]    public pools;
    Deposit[] public deposits;

    mapping(uint256 => uint256) public positionsLocked;  // poolIndex => count

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
    event PositionDeposited(uint256 indexed depositId, address indexed depositor, uint256 tokenId, uint256 poolIndex, uint256 unlockTime);
    event PositionWithdrawn(uint256 indexed depositId, address indexed depositor, uint256 tokenId);
    event FuelProcessed(address indexed tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);
    event FuelSent(address indexed token, uint256 amount);
    event FuelFailed(address indexed token, uint256 amount);
    event TokensForwarded(address indexed token, address indexed to, uint256 amount);
    event AdminTransferStarted(address indexed current, address indexed pending);
    event AdminTransferred(address indexed previous, address indexed newAdmin);
    event Paused(bool status);
    event MinLockUpdated(uint256 oldDuration, uint256 newDuration);
    event UpstreamUpdated(address indexed oldUpstream, address indexed newUpstream);

    // ── Modifiers ───────────────────────────────────────────────────────
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
        uint256 _minLockDuration,
        uint256 _maxLockDuration
    ) {
        require(_positionManager != address(0), "zero pm");
        require(_swapRouter != address(0), "zero router");
        require(_minLockDuration >= 1 days, "min 1 day");
        require(_maxLockDuration >= _minLockDuration, "max < min");

        positionManager = INonfungiblePositionManager(_positionManager);
        swapRouter      = ISwapRouter(_swapRouter);
        minLockDuration = _minLockDuration;
        maxLockDuration = _maxLockDuration;
        admin           = msg.sender;
    }

    /// @dev Accept incoming NFTs from the position manager
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

        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            require(pools[i].v3Pool != v3Pool, "already added");
        }

        pools.push(Pool({
            v3Pool:   v3Pool,
            token0:   t0,
            token1:   t1,
            fee:      fee,
            disabled: false
        }));

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
    //  Admin Transfer (two-step, matches SporeReactorV4)
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
    //  Position Deposits — approve NFT first, then call deposit
    // ═══════════════════════════════════════════════════════════════════════

    function depositPosition(uint256 tokenId, uint256 lockDuration) external nonReentrant {
        require(!paused, "paused");
        require(lockDuration >= minLockDuration, "lock too short");
        require(lockDuration <= maxLockDuration, "lock too long");

        // Read position from NPM
        (,, address t0, address t1, uint24 fee,,, uint128 liquidity,,,,)
            = positionManager.positions(tokenId);
        require(liquidity > 0, "no liquidity");

        // Verify position matches an allowed pool
        uint256 poolIdx = _findPool(t0, t1, fee);
        require(poolIdx != type(uint256).max, "pool not allowed");
        require(!pools[poolIdx].disabled, "pool disabled");

        // Transfer NFT to this contract
        positionManager.transferFrom(msg.sender, address(this), tokenId);

        uint256 unlockTime = block.timestamp + lockDuration;
        uint256 depositId  = deposits.length;

        deposits.push(Deposit({
            depositor: msg.sender,
            tokenId:   tokenId,
            poolIndex: poolIdx,
            unlockTime: unlockTime,
            withdrawn: false
        }));

        positionsLocked[poolIdx]++;

        emit PositionDeposited(depositId, msg.sender, tokenId, poolIdx, unlockTime);
    }

    /// @notice Withdraw position after lock expires. Always works, even when paused.
    ///         Depositor receives their NFT with all accumulated V3 fees inside.
    function withdrawPosition(uint256 depositId) external nonReentrant {
        require(depositId < deposits.length, "invalid deposit");
        Deposit storage dep = deposits[depositId];

        require(msg.sender == dep.depositor, "not depositor");
        require(block.timestamp >= dep.unlockTime, "still locked");
        require(!dep.withdrawn, "already withdrawn");

        dep.withdrawn = true;
        positionsLocked[dep.poolIndex]--;

        positionManager.safeTransferFrom(address(this), msg.sender, dep.tokenId);

        emit PositionWithdrawn(depositId, msg.sender, dep.tokenId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Fuel Processing — reactor network compatible, V3 swaps
    // ═══════════════════════════════════════════════════════════════════════

    function fuel(address token, uint256 amount) external nonReentrant {
        require(!paused, "paused");
        require(amount >= MIN_FUEL, "below minimum");

        _safeTransferFrom(token, msg.sender, address(this), amount);

        // Forward portion upstream
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

        // Swap remainder through matching V3 pool for volume
        uint256 swapAmount = amount - fuelPortion;
        if (swapAmount > 0) {
            _swapFuel(token, swapAmount);
        }
    }

    function canFuel(address token) external view returns (bool) {
        return _findPoolWithToken(token) < type(uint256).max;
    }

    /// @notice Admin forwards accumulated ERC20 tokens. Cannot touch locked NFTs.
    function forwardTokens(address token, address to, uint256 amount) external onlyAdmin {
        require(to != address(0), "zero address");
        require(amount > 0, "zero amount");
        _safeTransfer(token, to, amount);
        emit TokensForwarded(token, to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — V3 Fuel Swap
    // ═══════════════════════════════════════════════════════════════════════

    function _swapFuel(address tokenIn, uint256 amountIn) internal {
        uint256 poolIdx = _findPoolWithToken(tokenIn);
        if (poolIdx == type(uint256).max) return;

        Pool memory pool = pools[poolIdx];
        address tokenOut = (tokenIn == pool.token0) ? pool.token1 : pool.token0;

        _safeApprove(tokenIn, address(swapRouter), amountIn);

        try swapRouter.exactInputSingle(ISwapRouter.ExactInputSingleParams({
            tokenIn:           tokenIn,
            tokenOut:          tokenOut,
            fee:               pool.fee,
            recipient:         address(this),
            deadline:          block.timestamp,
            amountIn:          amountIn,
            amountOutMinimum:  0,
            sqrtPriceLimitX96: 0
        })) returns (uint256 amountOut) {
            emit FuelProcessed(tokenIn, amountIn, tokenOut, amountOut);
        } catch {
            _safeApprove(tokenIn, address(swapRouter), 0);
        }
    }

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
    //  Internal — Safe ERC20 Operations
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

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    function depositCount() external view returns (uint256) {
        return deposits.length;
    }

    function getDeposit(uint256 depositId) external view returns (
        address depositor,
        uint256 tokenId,
        uint256 poolIndex,
        uint256 unlockTime,
        bool    withdrawn
    ) {
        require(depositId < deposits.length, "invalid deposit");
        Deposit memory dep = deposits[depositId];
        return (dep.depositor, dep.tokenId, dep.poolIndex, dep.unlockTime, dep.withdrawn);
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
            if (deposits[i].depositor == depositor) {
                ids[idx++] = i;
            }
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
