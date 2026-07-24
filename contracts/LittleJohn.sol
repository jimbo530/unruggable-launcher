// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Little John ($LJ) — a meme for the Charity Suite
/// @notice Standard 1,000,000,000 fixed-supply ERC20, 18 decimals. Entire
///         supply minted to the deployer/treasury at construction. No owner,
///         no mint, no admin, no pause — the supply is fixed forever.
///
///         $LJ has NO vault. It is the meme whose one-sided sell wall is paired
///         against $FTP (Feeding People's proof-of-deposit receipt). Trading LJ
///         flows value into FTP — the wall is the on-ramp that feeds people.
///
///         (Same recipe as our Base band tokens RISH/BONGO/DGT/HT.)
contract LittleJohn is ERC20 {
    uint256 public constant SUPPLY = 1_000_000_000 ether; // 1B * 1e18

    constructor(address treasury) ERC20("Little John", "LJ") {
        require(treasury != address(0), "zero treasury");
        _mint(treasury, SUPPLY);
    }
}
