// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";

/// @dev Mock aUSDC (6-dec) — the Aave receipt token. Open mint/burn for the pool.
contract MockAUSDC is MockERC20 {
    constructor() MockERC20("Aave USDC", "aUSDC") {}

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "burn>bal");
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }
}

/// @dev Minimal Aave V3 pool mock for ResilientEndowmentVault tests.
///      supply(): pull USDC in, mint aUSDC 1:1 to onBehalfOf.
///      withdraw(): burn aUSDC from caller, send USDC out 1:1.
///      simulateYield(account, amount): mint extra aUSDC to `account` and back it
///        with USDC reserves — models Aave interest accruing to the holder.
contract MockAavePool {
    MockERC20 public immutable usdc;
    MockAUSDC public immutable aUsdc;

    constructor(MockERC20 _usdc, MockAUSDC _aUsdc) {
        usdc = _usdc;
        aUsdc = _aUsdc;
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        require(asset == address(usdc), "asset");
        require(usdc.transferFrom(msg.sender, address(this), amount), "pull");
        aUsdc.mint(onBehalfOf, amount); // 1:1 receipt
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        require(asset == address(usdc), "asset");
        aUsdc.burn(msg.sender, amount);          // burn caller's receipt
        require(usdc.transfer(to, amount), "send");
        return amount;
    }

    /// @dev Model yield: holder's aUSDC grows; pool gains matching USDC reserves.
    function simulateYield(address account, uint256 amount) external {
        aUsdc.mint(account, amount);
        usdc.mint(address(this), amount);
    }
}
