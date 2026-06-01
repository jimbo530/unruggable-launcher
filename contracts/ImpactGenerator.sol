// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ImpactGenerator — Burns paired tokens, compounds Money for Trees LP
///
/// Inverse of SporeReactor: reactors capture energy, generators create it.
/// - Users deposit V3 LP positions (Money/X pairs) — withdrawable anytime or with optional lock
/// - Collects LP fees from all positions on execute()
/// - BURNS all xToken (meme) fees — deflationary pressure
/// - Uses Money side (fees + yield) to buy xTokens + deposit deeper LP
/// - Share-based accounting for proportional yield attribution
/// - "Fund trees. Burn memes."
///
/// Safety features (carried from SporeReactorV3):
///   - Reentrancy guard, two-step admin
///   - Slippage protection via slot0-derived sqrtPriceLimitX96 (3% cap)
///   - Pool cap (20), safe approve, disable/enable pools
///   - Pool unlock check — verifies V3 pool isn't mid-reentrancy before swap
///   - MIN_PROCESS threshold — skips pools with dust-level fees
///   - Global pause — admin can halt execute() in emergencies
///   - Users can withdraw LP positions anytime (unless self-locked)

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
    function collect(CollectParams calldata) external payable returns (uint256, uint256);
    function increaseLiquidity(IncreaseLiquidityParams calldata) external payable returns (uint128, uint256, uint256);
    function positions(uint256 tokenId) external view returns (
        uint96, address, address, address, uint24, int24, int24, uint128,
        uint256, uint256, uint128, uint128
    );
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

/// @dev SwapRouter02 on Base — no deadline field
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
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );
}

/// @dev CharityFund (Money for Trees) — register V3 positions for yield claims
interface ICharityFund {
    function registerV3Position(uint256 tokenId) external;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Contract
// ═══════════════════════════════════════════════════════════════════════════

contract ImpactGenerator {

    // ── Constants ────────────────────────────────────────────────────────────
    address private constant BURN = 0xfd780B0aE569e15e514B819ecFDF46f804953a4B;
    uint256 public  constant MAX_POOLS = 20;
    uint256 public  constant MIN_PROCESS = 1000;  // skip pools with < this balance
    uint256 public  constant MAX_PRICE_IMPACT_BPS = 300; // 3% max slippage per swap
    uint256 public  constant PROTOCOL_FEE_BPS = 100;  // 1% of yield to forever-locked protocol position

    // UniswapV3 TickMath bounds
    uint160 private constant MIN_SQRT_RATIO = 4295128739;
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    // ── State (set once via initialize, not constructor) ─────────────────────
    address public money;    // Money for Trees — the central token
    INonfungiblePositionManager public pm;
    ISwapRouter02 public router;
    IUniswapV3Factory public factory;
    bool public initialized;

    uint256 public lastExecute;
    uint256 public cooldown;       // configurable, 0 = no time lock on execute
    bool public paused;

    struct Pool {
        uint256 tokenId;
        address xToken;        // the paired meme token (gets burned)
        address poolAddress;   // cached V3 pool contract for slot0 lookups
        uint24  fee;
        bool    moneyIsToken0;
        bool    disabled;
        address depositor;     // who deposited this position
        uint256 lockUntil;     // 0 = no lock, >0 = locked until timestamp
    }
    Pool[] public pools;
    mapping(uint256 => uint256) public tokenIdToIndex;  // tokenId → pool index + 1 (0 = not registered)
    mapping(address => bool) public hasXToken;

    // Share accounting — tracks proportional deposits for yield attribution
    mapping(address => uint256) public shares;
    uint256 public totalShares;

    // Protocol forever-locked position — 1% of yield compounds here permanently
    uint256 public protocolPoolIndex;  // index of the forever-locked protocol position
    bool public protocolPoolSet;       // whether protocol pool has been designated
    uint256 public protocolAccumulated; // Money accumulated for protocol compounding

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

    // ── Events ──────────────────────────────────────────────────────────────
    event Executed(uint256 burned, uint256 compounded, uint256 timestamp, address caller);
    event PositionDeposited(uint256 indexed tokenId, address indexed depositor, address xToken, uint256 lockUntil);
    event PositionWithdrawn(uint256 indexed tokenId, address indexed depositor);
    event PoolDisabled(uint256 indexed poolIndex, uint256 tokenId);
    event PoolEnabled(uint256 indexed poolIndex, uint256 tokenId);
    event PoolSkipped(uint256 indexed poolIndex, uint256 tokenId);
    event XTokenBurned(address indexed xToken, uint256 amount);
    event LiquidityCompounded(uint256 indexed poolIndex, uint256 moneyUsed, uint256 xBought);
    event YieldHarvested(uint256 surplus, uint256 timestamp);
    event AdminTransferStarted(address indexed current, address indexed pending);
    event AdminTransferred(address indexed previous, address indexed newAdmin);
    event Paused(bool status);
    event YieldRegistrationFailed(uint256 indexed tokenId);

    // ── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    modifier onlySelf() {
        require(msg.sender == address(this), "internal only");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Initialize (called once by factory, replaces constructor for clones)
    // ═══════════════════════════════════════════════════════════════════════════

    function initialize(
        address _money,
        address _pm,
        address _router,
        address _factory
    ) external {
        require(!initialized, "already initialized");
        initialized = true;

        require(_money   != address(0), "zero money");
        require(_pm      != address(0), "zero pm");
        require(_router  != address(0), "zero router");
        require(_factory != address(0), "zero factory");

        money   = _money;
        pm      = INonfungiblePositionManager(_pm);
        router  = ISwapRouter02(_router);
        factory = IUniswapV3Factory(_factory);
        admin   = msg.sender;
        _locked = 1;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Position Deposit — anyone can deposit Money/X LP positions
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Deposit a V3 LP position. Called internally by onERC721Received — not directly.
    /// @param tokenId The position NFT token ID (must already be transferred to this contract)
    /// @param lockUntil Timestamp until which the position is locked (0 = no lock, withdraw anytime)
    /// @param depositor The address that sent the NFT (set by onERC721Received, not msg.sender)
    function _depositPosition(uint256 tokenId, uint256 lockUntil, address depositor) internal {
        require(pools.length < MAX_POOLS, "max pools reached");
        require(tokenIdToIndex[tokenId] == 0, "already registered");
        require(pm.ownerOf(tokenId) == address(this), "NFT not received");

        (, , address token0, address token1, uint24 fee, , , uint128 liquidity, , , ,) = pm.positions(tokenId);
        require(liquidity > 0, "empty position");

        bool is0 = (token0 == money);
        bool is1 = (token1 == money);
        require(is0 || is1, "money not in pair");

        address xToken = is0 ? token1 : token0;

        address poolAddr = factory.getPool(token0, token1, fee);
        require(poolAddr != address(0), "pool not found");

        pools.push(Pool({
            tokenId:       tokenId,
            xToken:        xToken,
            poolAddress:   poolAddr,
            fee:           fee,
            moneyIsToken0: is0,
            disabled:      false,
            depositor:     depositor,
            lockUntil:     lockUntil
        }));
        tokenIdToIndex[tokenId] = pools.length;  // index + 1
        hasXToken[xToken] = true;

        // Track shares based on liquidity amount for proportional yield
        shares[depositor] += uint256(liquidity);
        totalShares += uint256(liquidity);

        // Auto-register with CharityFund so this position earns yield
        try ICharityFund(money).registerV3Position(tokenId) {} catch {
            emit YieldRegistrationFailed(tokenId);
        }

        emit PositionDeposited(tokenId, depositor, xToken, lockUntil);
    }

    /// @notice Admin-only recovery: register an NFT already in the contract to its rightful owner.
    function adminRegisterPosition(uint256 tokenId, uint256 lockUntil, address depositor) external onlyAdmin nonReentrant {
        _depositPosition(tokenId, lockUntil, depositor);
    }

    /// @notice Withdraw your LP position. Only the original depositor can withdraw, and only if unlocked.
    function withdrawPosition(uint256 tokenId) external nonReentrant {
        uint256 rawIndex = tokenIdToIndex[tokenId];
        require(rawIndex > 0, "not registered");
        uint256 poolIndex = rawIndex - 1;

        Pool storage pool = pools[poolIndex];
        require(pool.depositor == msg.sender, "not your position");
        require(pool.lockUntil == 0 || block.timestamp >= pool.lockUntil, "still locked");

        // Remove shares
        (, , , , , , , uint128 liquidity, , , ,) = pm.positions(tokenId);
        uint256 liq = uint256(liquidity);
        if (liq > shares[msg.sender]) liq = shares[msg.sender];
        shares[msg.sender] -= liq;
        totalShares -= liq;

        // Disable pool (don't remove from array to preserve indices)
        pool.disabled = true;
        tokenIdToIndex[tokenId] = 0;

        // Return the NFT to depositor
        pm.safeTransferFrom(address(this), msg.sender, tokenId);

        emit PositionWithdrawn(tokenId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Pool Management (admin only)
    // ═══════════════════════════════════════════════════════════════════════════

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

    // ── Two-step admin transfer ─────────────────────────────────────────────

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

    // ── Emergency pause + cooldown ──────────────────────────────────────────

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        emit Paused(_paused);
    }

    function setCooldown(uint256 _cooldown) external onlyAdmin {
        cooldown = _cooldown;
    }

    /// @notice Designate a forever-locked position as the protocol pool. 1% of all yield compounds here permanently.
    function setProtocolPool(uint256 poolIndex) external onlyAdmin {
        require(poolIndex < pools.length, "invalid index");
        require(pools[poolIndex].lockUntil == type(uint256).max, "must be forever-locked");
        protocolPoolIndex = poolIndex;
        protocolPoolSet = true;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Deposit Liquidity — directly deepen a pool (permissionless)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Deepen an existing pool with raw tokens. Caller must approve both.
    function depositLiquidity(uint256 poolIndex, uint256 moneyAmount, uint256 xAmount) external nonReentrant {
        require(poolIndex < pools.length, "invalid index");
        require(!pools[poolIndex].disabled, "pool disabled");
        Pool memory pool = pools[poolIndex];

        if (moneyAmount > 0) {
            _safeTransferFrom(money, msg.sender, address(this), moneyAmount);
            _safeApprove(money, address(pm), moneyAmount);
        }
        if (xAmount > 0) {
            _safeTransferFrom(pool.xToken, msg.sender, address(this), xAmount);
            _safeApprove(pool.xToken, address(pm), xAmount);
        }

        uint256 a0d = pool.moneyIsToken0 ? moneyAmount : xAmount;
        uint256 a1d = pool.moneyIsToken0 ? xAmount : moneyAmount;

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

    // ═══════════════════════════════════════════════════════════════════════════
    //  Execute — anyone can call (unless paused or on cooldown)
    // ═══════════════════════════════════════════════════════════════════════════

    function execute() external nonReentrant {
        require(!paused, "paused");
        if (cooldown > 0) {
            require(block.timestamp >= lastExecute + cooldown, "cooldown");
        }
        lastExecute = block.timestamp;

        uint256 totalBurned;
        uint256 totalCompounded;
        uint256 len = pools.length;

        for (uint256 i; i < len; ++i) {
            if (pools[i].disabled) {
                emit PoolSkipped(i, pools[i].tokenId);
                continue;
            }
            try this.processPool(i) returns (uint256 burned, uint256 compounded) {
                totalBurned += burned;
                totalCompounded += compounded;
            } catch {
                emit PoolSkipped(i, pools[i].tokenId);
            }
        }

        emit Executed(totalBurned, totalCompounded, block.timestamp, msg.sender);
    }

    function processPool(uint256 poolIndex) external onlySelf returns (uint256 burned, uint256 compounded) {
        Pool memory pool = pools[poolIndex];

        // 1. Collect fees from position
        pm.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:    pool.tokenId,
                recipient:  address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // 2. BURN ALL xToken (meme) — this is the inverse of reactor
        uint256 xBal = IERC20(pool.xToken).balanceOf(address(this));
        if (xBal > 0) {
            _safeTransfer(pool.xToken, BURN, xBal);
            burned = xBal;
            emit XTokenBurned(pool.xToken, xBal);
        }

        // 3. Get Money balance (fees collected + any yield surplus)
        uint256 moneyBal = IERC20(money).balanceOf(address(this));
        // Subtract protocol accumulator (not available for this pool)
        if (moneyBal <= protocolAccumulated) return (burned, 0);
        moneyBal -= protocolAccumulated;
        if (moneyBal < MIN_PROCESS) return (burned, 0);

        // 4. Skim 1% to protocol forever-locked position
        if (protocolPoolSet) {
            uint256 protocolCut = moneyBal * PROTOCOL_FEE_BPS / 10000;
            protocolAccumulated += protocolCut;
            moneyBal -= protocolCut;
        }

        // 5. Use Money to buy xToken + deposit as LP (compounds the position)
        uint256 moneyForBuy = moneyBal / 2;
        uint256 moneyForLP  = moneyBal - moneyForBuy;

        // 5. Slippage-protected swap: Money → xToken
        uint160 limit = _getSqrtPriceLimitSafe(pool.poolAddress, pool.moneyIsToken0);

        _safeApprove(money, address(router), moneyForBuy);
        uint256 xBought = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           money,
                tokenOut:          pool.xToken,
                fee:               pool.fee,
                recipient:         address(this),
                amountIn:          moneyForBuy,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: limit
            })
        );

        // 6. Deposit Money + bought xToken as deeper LP
        if (xBought > 0 && moneyForLP > 0) {
            _safeApprove(money, address(pm), moneyForLP);
            _safeApprove(pool.xToken, address(pm), xBought);

            uint256 a0d = pool.moneyIsToken0 ? moneyForLP : xBought;
            uint256 a1d = pool.moneyIsToken0 ? xBought : moneyForLP;

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

            compounded = moneyForLP + moneyForBuy;
            emit LiquidityCompounded(poolIndex, compounded, xBought);
        }

        // 7. Burn any remaining xToken dust from ratio mismatch
        uint256 xDust = IERC20(pool.xToken).balanceOf(address(this));
        if (xDust > 0) {
            _safeTransfer(pool.xToken, BURN, xDust);
            burned += xDust;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Protocol Compound — compounds accumulated 1% into forever-locked position
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Compound accumulated protocol Money into the forever-locked position.
    ///         Buys xToken + deposits as LP. Anyone can call.
    function compoundProtocol() external nonReentrant {
        require(protocolPoolSet, "no protocol pool");
        require(protocolAccumulated >= MIN_PROCESS, "below minimum");

        Pool memory pool = pools[protocolPoolIndex];
        require(!pool.disabled, "protocol pool disabled");

        uint256 amount = protocolAccumulated;
        protocolAccumulated = 0;

        uint256 moneyForBuy = amount / 2;
        uint256 moneyForLP  = amount - moneyForBuy;

        // Swap Money → xToken (slippage protected)
        uint160 limit = _getSqrtPriceLimitSafe(pool.poolAddress, pool.moneyIsToken0);
        _safeApprove(money, address(router), moneyForBuy);
        uint256 xBought = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           money,
                tokenOut:          pool.xToken,
                fee:               pool.fee,
                recipient:         address(this),
                amountIn:          moneyForBuy,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: limit
            })
        );

        // Deposit as LP into the forever-locked position
        if (xBought > 0 && moneyForLP > 0) {
            _safeApprove(money, address(pm), moneyForLP);
            _safeApprove(pool.xToken, address(pm), xBought);

            uint256 a0d = pool.moneyIsToken0 ? moneyForLP : xBought;
            uint256 a1d = pool.moneyIsToken0 ? xBought : moneyForLP;

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

            emit LiquidityCompounded(protocolPoolIndex, amount, xBought);
        }

        // Burn any xToken dust
        uint256 xDust = IERC20(pool.xToken).balanceOf(address(this));
        if (xDust > 0) {
            _safeTransfer(pool.xToken, BURN, xDust);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Harvest — recognize Money yield that arrived from holding deposits
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Detects surplus Money (yield from Aave via Money contract).
    ///         Next execute() will use it to buy xTokens + deepen LP across all pools.
    function harvest() external {
        uint256 currentBal = IERC20(money).balanceOf(address(this));
        if (currentBal > 0) {
            emit YieldHarvested(currentBal, block.timestamp);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Internal — Slippage Protection (with unlock safety check)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Read slot0, verify pool isn't being reentered, then cap price movement at 3%.
    function _getSqrtPriceLimitSafe(address poolAddr, bool moneyIsToken0) internal view returns (uint160) {
        (uint160 sqrtPriceX96,,,,,, bool unlocked) = IUniswapV3Pool(poolAddr).slot0();
        require(unlocked, "pool locked");
        return _calcPriceLimit(sqrtPriceX96, moneyIsToken0);
    }

    /// @dev Calculate sqrtPriceLimitX96 for a swap that sells Money for xToken.
    function _calcPriceLimit(uint160 sqrtPriceX96, bool moneyIsToken0) internal pure returns (uint160) {
        if (moneyIsToken0) {
            // selling token0 (Money) for token1 (xToken) → sqrtPrice falls
            uint256 limit = uint256(sqrtPriceX96) * (10000 - MAX_PRICE_IMPACT_BPS) / 10000;
            if (limit >= sqrtPriceX96) limit = uint256(sqrtPriceX96) - 1;
            if (limit <= MIN_SQRT_RATIO) limit = MIN_SQRT_RATIO + 1;
            return uint160(limit);
        } else {
            // selling token1 (Money) for token0 (xToken) → sqrtPrice rises
            uint256 limit = uint256(sqrtPriceX96) * (10000 + MAX_PRICE_IMPACT_BPS) / 10000;
            if (limit <= sqrtPriceX96) limit = uint256(sqrtPriceX96) + 1;
            if (limit >= MAX_SQRT_RATIO) limit = MAX_SQRT_RATIO - 1;
            return uint160(limit);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Internal — Safe Token Operations
    // ═══════════════════════════════════════════════════════════════════════════

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

    /// @dev Reset approval to 0 before setting new value (handles USDT-style tokens)
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

    // ═══════════════════════════════════════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════════════════════════════════════

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    function activePoolCount() external view returns (uint256) {
        uint256 count;
        uint256 len = pools.length;
        for (uint256 i; i < len; ++i) {
            if (!pools[i].disabled) count++;
        }
        return count;
    }

    function timeUntilExecute() external view returns (uint256) {
        if (cooldown == 0) return 0;
        if (block.timestamp >= lastExecute + cooldown) return 0;
        return (lastExecute + cooldown) - block.timestamp;
    }

    function moneyBalance() external view returns (uint256) {
        return IERC20(money).balanceOf(address(this));
    }

    function sharesOf(address account) external view returns (uint256) {
        return shares[account];
    }

    function positionDepositor(uint256 tokenId) external view returns (address) {
        uint256 rawIndex = tokenIdToIndex[tokenId];
        if (rawIndex == 0) return address(0);
        return pools[rawIndex - 1].depositor;
    }

    function positionLockUntil(uint256 tokenId) external view returns (uint256) {
        uint256 rawIndex = tokenIdToIndex[tokenId];
        if (rawIndex == 0) return 0;
        return pools[rawIndex - 1].lockUntil;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  NFT receiver — accepts from anyone (public-facing)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Receives V3 LP NFTs and auto-registers them. Atomic — no orphan window.
    /// @dev `data` can optionally encode a uint256 lockUntil timestamp. Empty data = no lock.
    function onERC721Received(address, address from, uint256 tokenId, bytes calldata data) external returns (bytes4) {
        require(msg.sender == address(pm), "only position manager");
        uint256 lockUntil = 0;
        if (data.length >= 32) {
            lockUntil = abi.decode(data, (uint256));
        }
        _depositPosition(tokenId, lockUntil, from);
        return this.onERC721Received.selector;
    }
}
