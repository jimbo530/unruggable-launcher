// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MfT Reactor — Hardened LP fee compounder for MfT V2 stablecoin
///
/// Collects Uniswap V3 LP fees, burns native token, buys back with X-side,
/// deepens LP, and sends 10% of X-side upstream. Positions locked forever.
///
/// Safety: reentrancy guard, two-step admin, 3% slippage cap, 2hr cooldown,
/// pool cap (20), disable/enable (no remove), safe approve, dust recycling.
/// Admin can ONLY: addPool, disable/enable, transfer/renounce admin, pause.
/// NO withdraw, NO emergency drain — fuel in, no outs.

// ═══════════════════════════════════════════════════════════════════════════
//  Interfaces
// ═══════════════════════════════════════════════════════════════════════════

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface INPM {
    struct CollectParams {
        uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max;
    }
    struct IncreaseLiquidityParams {
        uint256 tokenId; uint256 amount0Desired; uint256 amount1Desired;
        uint256 amount0Min; uint256 amount1Min; uint256 deadline;
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
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256);
}

interface IUniswapV3Factory {
    function getPool(address, address, uint24) external view returns (address);
}

interface IUniswapV3Pool {
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool unlocked
    );
}

interface IUpstreamReactor {
    function fuel(address xToken, uint256 amount) external;
    function canFuel(address xToken) external view returns (bool);
}

interface IMoneyForTreesV2 {
    function setReactorPool(address pool) external;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Contract
// ═══════════════════════════════════════════════════════════════════════════

contract MfTReactor {

    // ── Constants ────────────────────────────────────────────────────────
    uint256 public constant COOLDOWN  = 2 hours;
    uint256 public constant MAX_POOLS = 20;
    uint256 public constant MIN_FUEL  = 1000;
    uint256 public constant MIN_PROCESS = 1000;
    uint256 private constant FUEL_BPS = 1000;
    uint256 public constant MAX_PRICE_IMPACT_BPS = 300;
    uint160 private constant MIN_SQRT = 4295128739;
    uint160 private constant MAX_SQRT = 1461446703485210103287273052203988822378723970342;

    // ── Immutable State ─────────────────────────────────────────────────
    address public immutable token;
    address public immutable burnAddress;
    INPM    public immutable pm;
    ISwapRouter02 public immutable router;
    IUniswapV3Factory public immutable uniFactory;

    // ── Mutable State ───────────────────────────────────────────────────
    IUpstreamReactor public upstreamReactor;
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
    modifier nonReentrant() { require(_locked == 1, "reentrant"); _locked = 2; _; _locked = 1; }
    modifier onlyAdmin() { require(msg.sender == admin, "not admin"); _; }
    modifier onlySelf() { require(msg.sender == address(this), "internal"); _; }

    // ── Events ──────────────────────────────────────────────────────────
    event Executed(uint256 burned, uint256 deposited, uint256 fueled, uint256 ts, address caller);
    event PoolAdded(uint256 indexed tokenId, address xToken, address poolAddr, uint24 fee);
    event PoolDisabled(uint256 indexed idx, uint256 tokenId);
    event PoolEnabled(uint256 indexed idx, uint256 tokenId);
    event PoolSkipped(uint256 indexed idx, uint256 tokenId);
    event FuelSent(address indexed xToken, uint256 amount);
    event FuelFailed(address indexed xToken, uint256 amount);
    event LiquidityDeposited(uint256 indexed idx, uint256 a0, uint256 a1);
    event SingleDeposit(uint256 indexed idx, address inputToken, uint256 inputAmt, uint256 t0, uint256 t1);
    event Fueled(uint256 indexed idx, address xToken, uint256 xIn, uint256 tokDep, uint256 xDep);
    event DustBurned(uint256 amount);
    event AdminTransferStarted(address indexed cur, address indexed pend);
    event AdminTransferred(address indexed prev, address indexed next_);
    event UpstreamUpdated(address indexed prev, address indexed next_);
    event Paused(bool status);

    // ═══════════════════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _token, address _burn, address _pm,
        address _router, address _factory, address _upstream
    ) {
        require(_token != address(0) && _burn != address(0), "zero");
        require(_pm != address(0) && _router != address(0) && _factory != address(0), "zero");

        token = _token;
        burnAddress = _burn;
        pm = INPM(_pm);
        router = ISwapRouter02(_router);
        uniFactory = IUniswapV3Factory(_factory);
        if (_upstream != address(0)) upstreamReactor = IUpstreamReactor(_upstream);
        admin = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Pool Management
    // ═══════════════════════════════════════════════════════════════════════

    function addPool(uint256 tokenId) external onlyAdmin {
        require(pools.length < MAX_POOLS, "max");
        require(!registeredTokenId[tokenId], "dup");
        require(pm.ownerOf(tokenId) == address(this), "not owned");

        (address t0, address t1, uint24 fee) = _getPositionInfo(tokenId);
        bool is0 = (t0 == token);
        require(is0 || t1 == token, "not paired");

        address xToken = is0 ? t1 : t0;
        address poolAddr = uniFactory.getPool(t0, t1, fee);
        require(poolAddr != address(0), "no pool");

        pools.push(Pool(tokenId, xToken, poolAddr, fee, is0, false));
        registeredTokenId[tokenId] = true;
        hasXToken[xToken] = true;
        emit PoolAdded(tokenId, xToken, poolAddr, fee);
    }

    function _getPositionInfo(uint256 tokenId) internal view returns (address t0, address t1, uint24 fee) {
        (, , t0, t1, fee, , , , , , ,) = pm.positions(tokenId);
    }

    function disablePool(uint256 i) external onlyAdmin {
        require(i < pools.length && !pools[i].disabled, "invalid");
        pools[i].disabled = true;
        emit PoolDisabled(i, pools[i].tokenId);
    }

    function enablePool(uint256 i) external onlyAdmin {
        require(i < pools.length && pools[i].disabled, "invalid");
        pools[i].disabled = false;
        emit PoolEnabled(i, pools[i].tokenId);
    }

    // ── Admin ───────────────────────────────────────────────────────────

    function transferAdmin(address a) external onlyAdmin { require(a != address(0)); pendingAdmin = a; emit AdminTransferStarted(admin, a); }
    function acceptAdmin() external { require(msg.sender == pendingAdmin); emit AdminTransferred(admin, pendingAdmin); admin = pendingAdmin; pendingAdmin = address(0); }
    function renounceAdmin() external onlyAdmin { emit AdminTransferred(admin, address(0)); admin = address(0); pendingAdmin = address(0); }
    function setUpstream(address u) external onlyAdmin { emit UpstreamUpdated(address(upstreamReactor), u); upstreamReactor = u == address(0) ? IUpstreamReactor(address(0)) : IUpstreamReactor(u); }
    function setPaused(bool p) external onlyAdmin { paused = p; emit Paused(p); }

    /// @notice Register a Uniswap pool as the reactor's protected LP on the MfT V2 contract.
    ///         That pool's yield rewards get redirected to this reactor. Set once, never changed.
    function registerReactorPool(address pool) external onlyAdmin {
        IMoneyForTreesV2(token).setReactorPool(pool);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Permissionless Deposits
    // ═══════════════════════════════════════════════════════════════════════

    function depositLiquidity(uint256 idx, uint256 tokenAmt, uint256 xAmt) external nonReentrant {
        require(idx < pools.length && !pools[idx].disabled, "invalid");
        Pool memory p = pools[idx];

        if (tokenAmt > 0) { _safeTransferFrom(token, msg.sender, address(this), tokenAmt); _safeApprove(token, address(pm), tokenAmt); }
        if (xAmt > 0) { _safeTransferFrom(p.xToken, msg.sender, address(this), xAmt); _safeApprove(p.xToken, address(pm), xAmt); }

        uint256 a0 = p.tokenIsToken0 ? tokenAmt : xAmt;
        uint256 a1 = p.tokenIsToken0 ? xAmt : tokenAmt;
        _addLiquidity(p.tokenId, a0, a1);
        _returnDustTo(p.xToken, msg.sender);
        emit LiquidityDeposited(idx, a0, a1);
    }

    function depositSingle(uint256 idx, uint256 amount, bool isNative) external nonReentrant {
        require(idx < pools.length && !pools[idx].disabled && amount > 0, "invalid");
        Pool memory p = pools[idx];

        address inTok = isNative ? token : p.xToken;
        address outTok = isNative ? p.xToken : token;
        _safeTransferFrom(inTok, msg.sender, address(this), amount);

        uint256 half = amount / 2;
        uint160 limit = _priceLimitDeposit(p.poolAddress, p.tokenIsToken0, isNative);
        _safeApprove(inTok, address(router), half);
        uint256 got = _swap(inTok, outTok, p.fee, half, limit);

        uint256 tAmt = isNative ? (amount - half) : got;
        uint256 xAmt = isNative ? got : (amount - half);
        _safeApprove(token, address(pm), tAmt);
        _safeApprove(p.xToken, address(pm), xAmt);
        _addLiquidity(p.tokenId, p.tokenIsToken0 ? tAmt : xAmt, p.tokenIsToken0 ? xAmt : tAmt);

        // Return dust to caller
        _returnDustTo(p.xToken, msg.sender);
        emit SingleDeposit(idx, inTok, amount, tAmt, xAmt);
    }

    function fuel(address xToken, uint256 amount) external nonReentrant {
        require(amount >= MIN_FUEL, "min");
        uint256 idx = _findPool(xToken);
        require(idx < type(uint256).max, "no pool");
        Pool memory p = pools[idx];
        require(!p.disabled, "disabled");

        _safeTransferFrom(xToken, msg.sender, address(this), amount);
        uint256 halfX = amount / 2;
        uint256 xLP = amount - halfX;

        uint160 limit = _priceLimitSafe(p.poolAddress, p.tokenIsToken0);
        _safeApprove(xToken, address(router), halfX);
        uint256 tAmt = _swap(xToken, token, p.fee, halfX, limit);

        _safeApprove(token, address(pm), tAmt);
        _safeApprove(xToken, address(pm), xLP);
        _addLiquidity(p.tokenId, p.tokenIsToken0 ? tAmt : xLP, p.tokenIsToken0 ? xLP : tAmt);
        _burnDust();
        emit Fueled(idx, xToken, amount, tAmt, xLP);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Execute
    // ═══════════════════════════════════════════════════════════════════════

    function execute() external nonReentrant {
        require(!paused, "paused");
        require(block.timestamp >= lastExecute + COOLDOWN, "cooldown");
        lastExecute = block.timestamp;

        uint256 tBurned; uint256 tDeposited; uint256 tFueled;
        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            if (pools[i].disabled) { emit PoolSkipped(i, pools[i].tokenId); continue; }
            try this.processPool(i) returns (uint256 b, uint256 d, uint256 f) {
                tBurned += b; tDeposited += d; tFueled += f;
            } catch { emit PoolSkipped(i, pools[i].tokenId); }
        }
        emit Executed(tBurned, tDeposited, tFueled, block.timestamp, msg.sender);
    }

    function processPool(uint256 idx) external onlySelf returns (uint256 burned, uint256 bought, uint256 fueled) {
        Pool memory p = pools[idx];

        // 1. Collect fees
        pm.collect(INPM.CollectParams(p.tokenId, address(this), type(uint128).max, type(uint128).max));

        // 2. Burn all native token
        burned = _burnAllToken();

        // 3. Get X balance
        uint256 xBal = IERC20(p.xToken).balanceOf(address(this));
        if (xBal < MIN_PROCESS) return (burned, 0, 0);

        // 4. Fuel upstream (10%)
        fueled = _fuelUpstream(p.xToken, xBal);

        // 5. Split remaining: half buy, half LP
        uint256 xRem = xBal - fueled;
        if (xRem < MIN_PROCESS) return (burned, 0, fueled);

        uint256 xBuy = xRem / 2;
        uint256 xLP  = xRem - xBuy;

        // 6. Buyback
        uint160 limit = _priceLimitSafe(p.poolAddress, p.tokenIsToken0);
        _safeApprove(p.xToken, address(router), xBuy);
        bought = _swap(p.xToken, token, p.fee, xBuy, limit);

        // 7. Deepen LP
        if (bought > 0 && xLP > 0) {
            _safeApprove(token, address(pm), bought);
            _safeApprove(p.xToken, address(pm), xLP);
            _addLiquidity(p.tokenId, p.tokenIsToken0 ? bought : xLP, p.tokenIsToken0 ? xLP : bought);
        }

        // 8. Burn dust
        burned += _burnAllToken();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal Helpers
    // ═══════════════════════════════════════════════════════════════════════

    function _burnAllToken() internal returns (uint256 amt) {
        amt = IERC20(token).balanceOf(address(this));
        if (amt > 0) _safeTransfer(token, burnAddress, amt);
    }

    function _burnDust() internal {
        uint256 d = IERC20(token).balanceOf(address(this));
        if (d > 0) { _safeTransfer(token, burnAddress, d); emit DustBurned(d); }
    }

    function _returnDustTo(address xToken, address to) internal {
        uint256 d0 = IERC20(token).balanceOf(address(this));
        uint256 d1 = IERC20(xToken).balanceOf(address(this));
        if (d0 > 0) _safeTransfer(token, to, d0);
        if (d1 > 0) _safeTransfer(xToken, to, d1);
    }

    function _fuelUpstream(address xToken, uint256 xBal) internal returns (uint256 fueled) {
        if (address(upstreamReactor) == address(0)) return 0;
        uint256 amt = xBal * FUEL_BPS / 10000;
        if (amt < MIN_FUEL) return 0;

        _safeApprove(xToken, address(upstreamReactor), amt);
        try upstreamReactor.fuel(xToken, amt) {
            fueled = amt;
            emit FuelSent(xToken, amt);
        } catch {
            emit FuelFailed(xToken, amt);
            _safeApprove(xToken, address(upstreamReactor), 0);
        }
    }

    function _swap(address tIn, address tOut, uint24 fee, uint256 amtIn, uint160 limit) internal returns (uint256) {
        return router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(tIn, tOut, fee, address(this), amtIn, 0, limit)
        );
    }

    function _addLiquidity(uint256 tokenId, uint256 a0, uint256 a1) internal {
        pm.increaseLiquidity(INPM.IncreaseLiquidityParams(tokenId, a0, a1, 0, 0, block.timestamp));
    }

    // ── Slippage ────────────────────────────────────────────────────────

    function _priceLimitSafe(address poolAddr, bool tIs0) internal view returns (uint160) {
        (uint160 sqrtP,,,,,, bool unlocked) = IUniswapV3Pool(poolAddr).slot0();
        require(unlocked, "locked");
        return _calcLimit(sqrtP, tIs0);
    }

    function _priceLimitDeposit(address poolAddr, bool tIs0, bool sellingNative) internal view returns (uint160) {
        (uint160 sqrtP,,,,,, bool unlocked) = IUniswapV3Pool(poolAddr).slot0();
        require(unlocked, "locked");
        return _calcLimit(sqrtP, sellingNative ? !tIs0 : tIs0);
    }

    function _calcLimit(uint160 sqrtP, bool tIs0) internal pure returns (uint160) {
        if (tIs0) {
            uint256 lim = uint256(sqrtP) * (10000 + MAX_PRICE_IMPACT_BPS) / 10000;
            if (lim <= sqrtP) lim = uint256(sqrtP) + 1;
            if (lim >= MAX_SQRT) lim = MAX_SQRT - 1;
            return uint160(lim);
        } else {
            uint256 lim = uint256(sqrtP) * (10000 - MAX_PRICE_IMPACT_BPS) / 10000;
            if (lim >= sqrtP) lim = uint256(sqrtP) - 1;
            if (lim <= MIN_SQRT) lim = MIN_SQRT + 1;
            return uint160(lim);
        }
    }

    // ── Safe Token Ops ──────────────────────────────────────────────────

    function _safeTransfer(address t, address to, uint256 a) internal {
        (bool ok, bytes memory d) = t.call(abi.encodeWithSelector(IERC20.transfer.selector, to, a));
        require(ok && (d.length == 0 || abi.decode(d, (bool))), "tf");
    }

    function _safeTransferFrom(address t, address from, address to, uint256 a) internal {
        (bool ok, bytes memory d) = t.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, a));
        require(ok && (d.length == 0 || abi.decode(d, (bool))), "tff");
    }

    function _safeApprove(address t, address s, uint256 a) internal {
        (bool ok, bytes memory d) = t.call(abi.encodeWithSelector(IERC20.approve.selector, s, 0));
        require(ok && (d.length == 0 || abi.decode(d, (bool))), "ar");
        if (a > 0) {
            (ok, d) = t.call(abi.encodeWithSelector(IERC20.approve.selector, s, a));
            require(ok && (d.length == 0 || abi.decode(d, (bool))), "a");
        }
    }

    function _findPool(address xToken) internal view returns (uint256) {
        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            if (pools[i].xToken == xToken && !pools[i].disabled) return i;
        }
        return type(uint256).max;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════════════════════════════════

    function poolCount() external view returns (uint256) { return pools.length; }
    function activePoolCount() external view returns (uint256) { uint256 c; for (uint256 i; i < pools.length; ++i) if (!pools[i].disabled) c++; return c; }
    function timeUntilExecute() external view returns (uint256) { return block.timestamp >= lastExecute + COOLDOWN ? 0 : (lastExecute + COOLDOWN) - block.timestamp; }
    function canFuel(address x) external view returns (bool) { return _findPool(x) < type(uint256).max; }
    function dustBalance(address t) external view returns (uint256) { return IERC20(t).balanceOf(address(this)); }

    function onERC721Received(address, address from, uint256, bytes calldata) external view returns (bytes4) {
        require(from == admin, "admin only");
        return this.onERC721Received.selector;
    }
}
