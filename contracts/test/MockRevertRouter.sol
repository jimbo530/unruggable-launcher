// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev A swap router whose exactInputSingle ALWAYS reverts. Used on the fork to
///      prove Shipyard's buy-in failure path: when the swap reverts, the launch
///      must NOT revert — the buy-in USDC is routed to treasury and BuyInFailed
///      is emitted. Only the router slot is swapped; everything else stays real.
contract MockRevertRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256) {
        revert("router down");
    }
}
