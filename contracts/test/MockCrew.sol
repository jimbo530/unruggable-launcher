// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal ERC-721-shaped crew mock for ShipToken mutiny tests. Only
///      balanceOf is needed by ShipToken.mutiny (the 51% captain gate), so this
///      exposes a controllable balanceOf with a helper to set holdings. Total
///      "supply" is conceptually 100 NFTs; the test assigns counts to addresses.
contract MockCrew {
    mapping(address => uint256) public balanceOf;

    /// @notice Set how many crew NFTs an address holds (0..100).
    function setBalance(address who, uint256 count) external {
        require(count <= 100, "max 100 crew");
        balanceOf[who] = count;
    }
}
