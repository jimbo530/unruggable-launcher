// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal Uniswap-V3-shaped mocks for SporeReactorV6 unit tests.
///      Only the surface the reactor's Money branch + addPool() touch is
///      implemented. collect() is a no-op: the test pre-funds the reactor with
///      the "collected" TOKEN/Money so the redeem→USDC path can be exercised
///      without real swaps. The meme/buy/LP path is NOT exercised here (it needs
///      a real pool) — it is covered by the unchanged V5/V4 behavior.

contract MockPositionManager {
    struct PoolInfo {
        address token0;
        address token1;
        uint24  fee;
        address owner;
    }
    mapping(uint256 => PoolInfo) public info;

    function setPosition(uint256 tokenId, address token0, address token1, uint24 fee, address owner_) external {
        info[tokenId] = PoolInfo(token0, token1, fee, owner_);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return info[tokenId].owner;
    }

    function positions(uint256 tokenId) external view returns (
        uint96, address, address, address, uint24, int24, int24, uint128,
        uint256, uint256, uint128, uint128
    ) {
        PoolInfo memory p = info[tokenId];
        return (0, address(0), p.token0, p.token1, p.fee, int24(0), int24(0), uint128(0), 0, 0, uint128(0), uint128(0));
    }

    // No-op collect: reactor is pre-funded with the "collected" tokens by the test.
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }
    function collect(CollectParams calldata) external payable returns (uint256, uint256) {
        return (0, 0);
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }
    function increaseLiquidity(IncreaseLiquidityParams calldata) external payable returns (uint128, uint256, uint256) {
        return (0, 0, 0);
    }
}

contract MockV3Factory {
    // Return a non-zero placeholder pool so addPool()'s require passes.
    function getPool(address, address, uint24) external view returns (address) {
        return address(this);
    }
}
