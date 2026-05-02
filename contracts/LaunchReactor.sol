// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LaunchReactor — Clone-friendly buyback/burn engine
/// @notice Deployed as EIP-1167 minimal proxy by TokenLaunchFactory.
///         Collects V3 fees, burns token (dead address), buys back with opposing fees,
///         deposits as LP. Positions held forever — no withdraw function exists.
///         Anyone can call execute() after 2-hour cooldown.

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

contract LaunchReactor {

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant COOLDOWN = 2 hours;

    // ── State (set once via initialize, not constructor) ─────────────────────
    address public token;
    INonfungiblePositionManager public pm;
    ISwapRouter02 public router;
    bool public initialized;

    uint256 public lastExecute;

    struct Pool {
        uint256 tokenId;
        address xToken;
        uint24  fee;
        bool    tokenIsToken0;
    }
    Pool[] public pools;

    address public admin;

    // ── Events ───────────────────────────────────────────────────────────────
    event Executed(uint256 burned, uint256 bought, uint256 timestamp, address caller);
    event PoolAdded(uint256 indexed tokenId, address xToken, uint24 fee);
    event LiquidityDeposited(uint256 indexed poolIndex, uint256 amount0, uint256 amount1);

    // ═════════════════════════════════════════════════════════════════════════
    //  Initialize (called once by factory, replaces constructor for clones)
    // ═════════════════════════════════════════════════════════════════════════

    function initialize(address _token, address _pm, address _router) external {
        require(!initialized, "already initialized");
        initialized = true;
        token  = _token;
        pm     = INonfungiblePositionManager(_pm);
        router = ISwapRouter02(_router);
        admin  = msg.sender;
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Pool management (admin — factory sets this up then renounces)
    // ═════════════════════════════════════════════════════════════════════════

    function addPool(uint256 tokenId) external {
        require(msg.sender == admin, "not admin");

        (, , address token0, address token1, uint24 fee, , , , , , ,) = pm.positions(tokenId);

        bool is0 = (token0 == token);
        bool is1 = (token1 == token);
        require(is0 || is1, "token not in pair");

        address xToken = is0 ? token1 : token0;

        pools.push(Pool({
            tokenId:       tokenId,
            xToken:        xToken,
            fee:           fee,
            tokenIsToken0: is0
        }));

        emit PoolAdded(tokenId, xToken, fee);
    }

    /// @notice Anyone can deposit additional liquidity into a pool. One-way — no withdraw exists.
    function depositLiquidity(uint256 poolIndex, uint256 tokenAmount, uint256 xAmount) external {
        require(poolIndex < pools.length, "invalid pool");

        Pool memory pool = pools[poolIndex];

        if (tokenAmount > 0) {
            IERC20(token).transferFrom(msg.sender, address(this), tokenAmount);
            IERC20(token).approve(address(pm), tokenAmount);
        }
        if (xAmount > 0) {
            IERC20(pool.xToken).transferFrom(msg.sender, address(this), xAmount);
            IERC20(pool.xToken).approve(address(pm), xAmount);
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

    function transferAdmin(address newAdmin) external {
        require(msg.sender == admin, "not admin");
        admin = newAdmin;
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Execute — anyone can call after cooldown
    // ═════════════════════════════════════════════════════════════════════════

    function execute() external {
        require(block.timestamp >= lastExecute + COOLDOWN, "cooldown");
        lastExecute = block.timestamp;

        uint256 totalBurned;
        uint256 totalBought;
        uint256 len = pools.length;

        for (uint256 i; i < len; ++i) {
            Pool memory pool = pools[i];

            // 1. Collect accrued fees from V3 position
            (uint256 a0, uint256 a1) = pm.collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId:   pool.tokenId,
                    recipient: address(this),
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );

            uint256 tokenFees = pool.tokenIsToken0 ? a0 : a1;
            uint256 xFees     = pool.tokenIsToken0 ? a1 : a0;

            if (tokenFees == 0 && xFees == 0) continue;

            // 2. Burn token side (send to dead address)
            if (tokenFees > 0) {
                IERC20(token).transfer(DEAD, tokenFees);
                totalBurned += tokenFees;
            }

            if (xFees == 0) continue;

            // 3. Split X: half buys token, half stays for LP
            uint256 xForBuy = xFees / 2;
            uint256 xForLP  = xFees - xForBuy;

            // 4. Swap half X -> token
            IERC20(pool.xToken).approve(address(router), xForBuy);
            uint256 tokenBought = router.exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn:           pool.xToken,
                    tokenOut:          token,
                    fee:               pool.fee,
                    recipient:         address(this),
                    amountIn:          xForBuy,
                    amountOutMinimum:  0,
                    sqrtPriceLimitX96: 0
                })
            );
            totalBought += tokenBought;

            // 5. Deposit bought token + remaining X as LP
            if (tokenBought > 0 && xForLP > 0) {
                IERC20(token).approve(address(pm), tokenBought);
                IERC20(pool.xToken).approve(address(pm), xForLP);

                uint256 a0d = pool.tokenIsToken0 ? tokenBought : xForLP;
                uint256 a1d = pool.tokenIsToken0 ? xForLP : tokenBought;

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
        }

        emit Executed(totalBurned, totalBought, block.timestamp, msg.sender);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  NFT receiver — required to accept V3 position NFTs
    // ═════════════════════════════════════════════════════════════════════════

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Views
    // ═════════════════════════════════════════════════════════════════════════

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    function timeUntilExecute() external view returns (uint256) {
        if (block.timestamp >= lastExecute + COOLDOWN) return 0;
        return (lastExecute + COOLDOWN) - block.timestamp;
    }
}
