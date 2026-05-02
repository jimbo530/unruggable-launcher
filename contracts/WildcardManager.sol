// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WildcardManager — Add new LP pools to any LaunchReactor
/// @notice Accepts ETH, buys both tokens, creates V3 pool if needed,
///         mints LP position, deposits NFT to reactor.
///         Launcher then calls reactor.addPool(tokenId) to register it.
///         No platform fee — MfT benefits when launched tokens succeed.

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IUniswapV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
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

contract WildcardManager {

    address public immutable weth;
    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;
    address public owner;

    uint24  constant FEE_TIER   = 10000;
    int24   constant TICK_LOWER = -887200;
    int24   constant TICK_UPPER =  887200;

    event WildcardCreated(
        address indexed reactor,
        address indexed tokenA,
        address indexed tokenB,
        uint256 tokenId,
        uint256 ethSpent
    );

    constructor(address _weth, address _v3Factory, address _pm, address _router) {
        weth            = _weth;
        v3Factory       = _v3Factory;
        positionManager = _pm;
        swapRouter      = _router;
        owner           = msg.sender;
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  addPool — pay ETH, buy both tokens, create pool, send NFT to reactor
    // ═════════════════════════════════════════════════════════════════════════

    /// @param reactor Reactor to deposit the LP NFT into
    /// @param tokenA First token (e.g. the launched token)
    /// @param tokenB Second token (e.g. charity token, meme token)
    /// @param feeA Fee tier of existing WETH/tokenA pool to route through
    /// @param feeB Fee tier of existing WETH/tokenB pool to route through
    function addPool(
        address reactor,
        address tokenA,
        address tokenB,
        uint24 feeA,
        uint24 feeB
    ) external payable returns (uint256 tokenId) {
        require(msg.value > 0, "send ETH");
        require(tokenA != tokenB, "same token");

        // 1. Wrap all ETH — no platform fee, MfT benefits when tokens succeed
        IWETH(weth).deposit{value: msg.value}();

        // 2. Split 50/50 and buy both tokens
        uint256 halfA = msg.value / 2;
        uint256 halfB = msg.value - halfA;

        IERC20(weth).approve(swapRouter, msg.value);

        uint256 amountA = _buyToken(tokenA, feeA, halfA);
        uint256 amountB = _buyToken(tokenB, feeB, halfB);

        // 3. Create pool + mint position + send to reactor

        tokenId = _createAndDeposit(tokenA, tokenB, amountA, amountB, reactor);

        // 4. Refund dust
        _refundDust(tokenA, tokenB, msg.sender);

        emit WildcardCreated(reactor, tokenA, tokenB, tokenId, msg.value);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Internal
    // ═════════════════════════════════════════════════════════════════════════

    function _buyToken(address token, uint24 fee, uint256 wethAmount) internal returns (uint256) {
        if (token == weth) return wethAmount;
        return ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           weth,
                tokenOut:          token,
                fee:               fee,
                recipient:         address(this),
                amountIn:          wethAmount,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _createAndDeposit(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        address reactor
    ) internal returns (uint256 tokenId) {
        bool aIs0 = tokenA < tokenB;
        address token0 = aIs0 ? tokenA : tokenB;
        address token1 = aIs0 ? tokenB : tokenA;
        uint256 amount0 = aIs0 ? amountA : amountB;
        uint256 amount1 = aIs0 ? amountB : amountA;

        // Create pool if it doesn't exist
        address pool = IUniswapV3Factory(v3Factory).getPool(token0, token1, FEE_TIER);
        if (pool == address(0)) {
            pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
            IUniswapV3Pool(pool).initialize(_calcSqrtPrice(amount0, amount1));
        }

        IERC20(token0).approve(positionManager, amount0);
        IERC20(token1).approve(positionManager, amount1);

        (tokenId, , ,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0:         token0,
                token1:         token1,
                fee:            FEE_TIER,
                tickLower:      TICK_LOWER,
                tickUpper:      TICK_UPPER,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min:     0,
                amount1Min:     0,
                recipient:      address(this),
                deadline:       block.timestamp
            })
        );

        // Send NFT to reactor
        (bool success,) = positionManager.call(
            abi.encodeWithSignature(
                "safeTransferFrom(address,address,uint256)",
                address(this), reactor, tokenId
            )
        );
        require(success, "NFT transfer failed");
    }

    function _calcSqrtPrice(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "zero amounts");
        uint256 result = (_sqrt(amount1) << 96) / _sqrt(amount0);
        require(result > 0 && result <= type(uint160).max, "price overflow");
        return uint160(result);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    function _refundDust(address tokenA, address tokenB, address to) internal {
        uint256 bal;
        bal = IERC20(tokenA).balanceOf(address(this));
        if (bal > 0) IERC20(tokenA).transfer(to, bal);
        bal = IERC20(tokenB).balanceOf(address(this));
        if (bal > 0) IERC20(tokenB).transfer(to, bal);
        bal = IERC20(weth).balanceOf(address(this));
        if (bal > 0) IERC20(weth).transfer(to, bal);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function rescue(address _token) external {
        require(msg.sender == owner, "not owner");
        uint256 bal = IERC20(_token).balanceOf(address(this));
        if (bal > 0) IERC20(_token).transfer(owner, bal);
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "not owner");
        owner = newOwner;
    }
}
