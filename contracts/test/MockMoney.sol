// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";

/// @dev Mock USDC (6-dec) for the V6 redeem tests. Minimal ERC20.
contract MockUSDC is MockERC20 {
    constructor() MockERC20("USD Coin", "USDC") {}
}

/// @dev Mock Money receipt token (6-dec). `redeem(amount)` burns the caller's
///      Money 1:1 and sends them `amount` of MockUSDC — mirroring the LIVE Money
///      selector (holder-callable redeem(uint256) → USDC 1:1, verified on Base
///      fork) so the V6 reactor's redeem→USDC→distributor→NFT path is tested
///      against the same ABI the real contract exposes.
///
///      The mock is pre-funded with USDC at construction so it can pay out.
///      The `failNext` / `payZero` switches let tests exercise the
///      RedeemFailed / RedeemZero branches without bricking the fire.
contract MockMoney is MockERC20 {
    MockUSDC public immutable usdc;
    bool public failNext;  // make the next redeem() revert
    bool public payZero;   // make redeem() succeed but pay 0 USDC

    constructor(MockUSDC _usdc) MockERC20("Money for Trees", "Money") {
        usdc = _usdc;
    }

    function setFailNext(bool v) external { failNext = v; }
    function setPayZero(bool v) external { payZero = v; }

    /// @dev Burn caller's Money, send them USDC 1:1. Reverts the caller's Money
    ///      balance check if they lack the amount (real redeem would too).
    ///      Matches the live Money selector: redeem(uint256).
    function redeem(uint256 amount) external {
        require(!failNext, "redeem disabled");
        require(balanceOf[msg.sender] >= amount, "insufficient money");
        // Burn the Money (it must never leak out as Money).
        _burn(msg.sender, amount);
        if (payZero) return; // succeed but deliver no USDC — RedeemZero branch
        // Deliver USDC 1:1 from the mock's pre-funded reserve.
        require(usdc.transfer(msg.sender, amount), "usdc payout failed");
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "burn exceeds balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }
}
