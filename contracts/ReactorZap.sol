// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ReactorZap — one-click liquidity deepening for SporeReactorV2
/// @notice User sends USDC, ETH, or any token. Contract routes to the pool's
///         xToken (e.g. BB/EB), swaps half for the launched token, and calls
///         depositLiquidity(). Fully permissionless.

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
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

interface IReactor {
    function token() external view returns (address);
    function pools(uint256) external view returns (uint256, address, address, uint24, bool, bool);
    function poolCount() external view returns (uint256);
    function depositLiquidity(uint256 poolIndex, uint256 tokenAmount, uint256 xAmount) external;
}

contract ReactorZap {
    ISwapRouter02 public immutable router;
    address public immutable WETH;

    event Zapped(
        address indexed user,
        address indexed reactor,
        uint256 tokenDeposited,
        uint256 xDeposited
    );

    constructor(address _router, address _weth) {
        router = ISwapRouter02(_router);
        WETH = _weth;
    }

    /// @notice Zap any ERC20 into a reactor pool. If the input token differs
    ///         from the pool's xToken, it swaps all input → xToken first (hop 1),
    ///         then splits the xToken: half → launched token (hop 2), half stays.
    /// @param reactor The SporeReactorV2 address
    /// @param poolIndex Which pool to deepen
    /// @param inputToken The token the user is sending (e.g. USDC, BB, EB)
    /// @param inputAmount Amount to deposit (must be approved first)
    /// @param hopFee Fee tier for input→xToken swap (ignored if input == xToken)
    function zap(
        address reactor,
        uint256 poolIndex,
        address inputToken,
        uint256 inputAmount,
        uint24 hopFee
    ) external {
        // Pull input from user
        IERC20(inputToken).transferFrom(msg.sender, address(this), inputAmount);

        _zapWithInput(reactor, poolIndex, inputToken, inputAmount, hopFee);
    }

    /// @notice Zap ETH into a reactor pool. Wraps to WETH then routes.
    /// @param reactor The SporeReactorV2 address
    /// @param poolIndex Which pool to deepen
    /// @param hopFee Fee tier for WETH→xToken swap (ignored if xToken == WETH)
    function zapETH(
        address reactor,
        uint256 poolIndex,
        uint24 hopFee
    ) external payable {
        require(msg.value > 0, "no ETH");
        IWETH(WETH).deposit{value: msg.value}();

        _zapWithInput(reactor, poolIndex, WETH, msg.value, hopFee);
    }

    function _zapWithInput(
        address reactor,
        uint256 poolIndex,
        address inputToken,
        uint256 inputAmount,
        uint24 hopFee
    ) internal {
        IReactor rx = IReactor(reactor);
        address nativeToken = rx.token();
        (, address xToken, , uint24 poolFee, , bool disabled) = rx.pools(poolIndex);
        require(!disabled, "pool disabled");

        uint256 xAmount;

        if (inputToken == xToken) {
            // Direct — input IS the xToken (e.g. user sent BB directly)
            xAmount = inputAmount;
        } else {
            // Hop 1: swap all input → xToken
            IERC20(inputToken).approve(address(router), inputAmount);
            xAmount = router.exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: inputToken,
                    tokenOut: xToken,
                    fee: hopFee,
                    recipient: address(this),
                    amountIn: inputAmount,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        // Now we have xAmount of xToken. Split and deposit.
        uint256 halfX = xAmount / 2;
        uint256 otherHalf = xAmount - halfX;

        // Hop 2: swap half xToken → launched token via the reactor's pool fee
        IERC20(xToken).approve(address(router), halfX);
        uint256 tokenOut = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: xToken,
                tokenOut: nativeToken,
                fee: poolFee,
                recipient: address(this),
                amountIn: halfX,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        // Approve both to reactor and deposit
        IERC20(nativeToken).approve(reactor, tokenOut);
        IERC20(xToken).approve(reactor, otherHalf);
        rx.depositLiquidity(poolIndex, tokenOut, otherHalf);

        // Refund any dust
        uint256 dustToken = IERC20(nativeToken).balanceOf(address(this));
        uint256 dustX = IERC20(xToken).balanceOf(address(this));
        if (dustToken > 0) IERC20(nativeToken).transfer(msg.sender, dustToken);
        if (dustX > 0) IERC20(xToken).transfer(msg.sender, dustX);

        emit Zapped(msg.sender, reactor, tokenOut, otherHalf);
    }

    /// @notice Find the pool index for a given xToken on a reactor
    function findPool(address reactor, address xToken) external view returns (uint256) {
        IReactor rx = IReactor(reactor);
        uint256 count = rx.poolCount();
        for (uint256 i = 0; i < count; i++) {
            (, address xt, , , , bool disabled) = rx.pools(i);
            if (xt == xToken && !disabled) return i;
        }
        revert("pool not found");
    }

    receive() external payable {}
}
