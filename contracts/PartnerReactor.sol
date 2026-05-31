// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PartnerReactor — Time-locked LP deposits with fuel processing
///
/// Community deposits V2 LP tokens with a minimum lock period.
/// Fuel tokens are swapped through pools to generate volume/fees.
/// LP tokens appreciate from swap fees during the lock.
/// After lock expires, depositor withdraws their LP.
///
/// Safety:
///   - Admin can NEVER withdraw deposited LP
///   - Lock duration immutable once set (cannot be shortened)
///   - Two-step admin transfer (matches SporeReactorV4 pattern)
///   - Reentrancy guard on all state-changing functions
///   - No removePool — pools are permanent once added
///   - Emergency pause (deposits + fuel only, withdrawals always work)
///   - forwardTokens protected: cannot touch locked LP balances

// ═══════════════════════════════════════════════════════════════════════════
//  Interfaces
// ═══════════════════════════════════════════════════════════════════════════

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IUpstreamReactor {
    function fuel(address xToken, uint256 amount) external;
    function canFuel(address xToken) external view returns (bool);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Contract
// ═══════════════════════════════════════════════════════════════════════════

contract PartnerReactor {

    // ── Constants ────────────────────────────────────────────────────────
    uint256 public constant MAX_POOLS  = 20;
    uint256 public constant MIN_FUEL   = 1000;
    uint256 public constant FUEL_BPS   = 1000;   // 10% of fuel forwarded upstream

    // ── State ────────────────────────────────────────────────────────────
    IUniswapV2Router02 public router;
    address public upstreamReactor;
    uint256 public minLockDuration;
    uint256 public maxLockDuration;
    bool    public paused;

    struct Pool {
        address lpToken;    // V2 pair address (also the LP token)
        address token0;
        address token1;
        bool    disabled;
    }

    struct Deposit {
        address depositor;
        uint256 poolIndex;
        uint256 amount;
        uint256 unlockTime;
        bool    withdrawn;
    }

    Pool[]    public pools;
    Deposit[] public deposits;

    // Total locked LP per pool — protects against admin draining deposited LP
    mapping(uint256 => uint256) public totalLocked;

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
    event PoolAdded(uint256 indexed poolIndex, address lpToken, address token0, address token1);
    event PoolDisabled(uint256 indexed poolIndex);
    event PoolEnabled(uint256 indexed poolIndex);
    event LPDeposited(uint256 indexed depositId, address indexed depositor, uint256 poolIndex, uint256 amount, uint256 unlockTime);
    event LPWithdrawn(uint256 indexed depositId, address indexed depositor, uint256 amount);
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

    constructor(address _router, uint256 _minLockDuration, uint256 _maxLockDuration) {
        require(_router != address(0), "zero router");
        require(_minLockDuration >= 1 days, "min 1 day");
        require(_maxLockDuration >= _minLockDuration, "max < min");

        router          = IUniswapV2Router02(_router);
        minLockDuration = _minLockDuration;
        maxLockDuration = _maxLockDuration;
        admin           = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Pool Management (admin only, no removePool)
    // ═══════════════════════════════════════════════════════════════════════

    function addPool(address lpToken) external onlyAdmin {
        require(pools.length < MAX_POOLS, "max pools");
        require(lpToken != address(0), "zero address");

        // Verify it's a V2 pair
        address t0 = IUniswapV2Pair(lpToken).token0();
        address t1 = IUniswapV2Pair(lpToken).token1();
        require(t0 != address(0) && t1 != address(0), "invalid pair");

        // No duplicates
        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            require(pools[i].lpToken != lpToken, "already added");
        }

        pools.push(Pool({
            lpToken:  lpToken,
            token0:   t0,
            token1:   t1,
            disabled: false
        }));

        emit PoolAdded(pools.length - 1, lpToken, t0, t1);
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
    //  LP Deposits — anyone can deposit, withdraw only after lock
    // ═══════════════════════════════════════════════════════════════════════

    function depositLP(uint256 poolIndex, uint256 amount, uint256 lockDuration) external nonReentrant {
        require(!paused, "paused");
        require(poolIndex < pools.length, "invalid pool");
        require(!pools[poolIndex].disabled, "pool disabled");
        require(amount > 0, "zero amount");
        require(lockDuration >= minLockDuration, "lock too short");
        require(lockDuration <= maxLockDuration, "lock too long");

        _safeTransferFrom(pools[poolIndex].lpToken, msg.sender, address(this), amount);

        uint256 unlockTime = block.timestamp + lockDuration;
        uint256 depositId  = deposits.length;

        deposits.push(Deposit({
            depositor: msg.sender,
            poolIndex: poolIndex,
            amount:    amount,
            unlockTime: unlockTime,
            withdrawn: false
        }));

        totalLocked[poolIndex] += amount;

        emit LPDeposited(depositId, msg.sender, poolIndex, amount, unlockTime);
    }

    /// @notice Withdraw LP after lock expires. Always works, even when paused.
    function withdrawLP(uint256 depositId) external nonReentrant {
        require(depositId < deposits.length, "invalid deposit");
        Deposit storage dep = deposits[depositId];

        require(msg.sender == dep.depositor, "not depositor");
        require(block.timestamp >= dep.unlockTime, "still locked");
        require(!dep.withdrawn, "already withdrawn");

        dep.withdrawn = true;
        totalLocked[dep.poolIndex] -= dep.amount;

        _safeTransfer(pools[dep.poolIndex].lpToken, msg.sender, dep.amount);

        emit LPWithdrawn(depositId, msg.sender, dep.amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Fuel Processing — reactor network compatible
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Accept fuel from other reactors. Swaps through matching pool for volume.
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

        // Swap remainder through matching pool to generate volume
        uint256 swapAmount = amount - fuelPortion;
        if (swapAmount > 0) {
            _swapFuel(token, swapAmount);
        }
    }

    /// @notice Check if this reactor can accept a token as fuel
    function canFuel(address token) external view returns (bool) {
        return _findPoolWithToken(token) < type(uint256).max;
    }

    /// @notice Admin forwards accumulated tokens (fuel output). Cannot touch locked LP.
    function forwardTokens(address token, address to, uint256 amount) external onlyAdmin {
        require(to != address(0), "zero address");
        require(amount > 0, "zero amount");

        // SAFETY: prevent admin from draining deposited LP
        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            if (pools[i].lpToken == token) {
                uint256 balance = IERC20(token).balanceOf(address(this));
                require(balance - amount >= totalLocked[i], "would drain locked LP");
            }
        }

        _safeTransfer(token, to, amount);
        emit TokensForwarded(token, to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Fuel Swap
    // ═══════════════════════════════════════════════════════════════════════

    function _swapFuel(address tokenIn, uint256 amountIn) internal {
        uint256 poolIdx = _findPoolWithToken(tokenIn);
        if (poolIdx == type(uint256).max) return;    // no matching pool, tokens accumulate

        Pool memory pool = pools[poolIdx];
        address tokenOut = (tokenIn == pool.token0) ? pool.token1 : pool.token0;

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        _safeApprove(tokenIn, address(router), amountIn);

        try router.swapExactTokensForTokens(amountIn, 0, path, address(this), block.timestamp)
            returns (uint256[] memory amounts)
        {
            emit FuelProcessed(tokenIn, amountIn, tokenOut, amounts[1]);
        } catch {
            _safeApprove(tokenIn, address(router), 0);
        }
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
    //  Internal — Safe Token Operations (same pattern as SporeReactorV4)
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

    /// @dev Reset approval to 0 before setting (handles USDT-style tokens)
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
        uint256 poolIndex,
        uint256 amount,
        uint256 unlockTime,
        bool    withdrawn
    ) {
        require(depositId < deposits.length, "invalid deposit");
        Deposit memory dep = deposits[depositId];
        return (dep.depositor, dep.poolIndex, dep.amount, dep.unlockTime, dep.withdrawn);
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
