// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal Shipyard mock for Dock unit tests. Implements the surface Dock
///      touches: launchFee(), launchFor(), distributorOf(). On launchFor it
///      pulls the fee from msg.sender (the Dock) EXACTLY like the real Shipyard,
///      mints a tiny "100-crew" marker to the shipOwner via MockCrew so the test
///      can prove the ship/crew went to the stored user (not the fulfiller), and
///      deploys a throwaway token address per launch.

interface IERC20Mock {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IMockCrew {
    function setBalance(address who, uint256 count) external;
}

/// A throwaway token (just needs a distinct address + a distributorOf entry).
contract MockShipToken {
    address public immutable owner;
    constructor(address _owner) { owner = _owner; }
}

contract MockShipyard {
    address public usdc;
    address public treasury;
    address public crew;          // shared MockCrew used as the "100-NFT" marker
    uint256 public launchFee;

    mapping(address => address) public distributorOf;

    event LaunchedFor(address indexed shipOwner, address token);

    constructor(address _usdc, address _treasury, address _crew, uint256 _fee) {
        usdc = _usdc;
        treasury = _treasury;
        crew = _crew;
        launchFee = _fee;
    }

    function setLaunchFee(uint256 f) external { launchFee = f; }

    /// @dev Mirrors the real launchFor: pulls `launchFee` USDC from msg.sender
    ///      (the Dock), routes it to treasury, "mints" 100 crew NFTs to shipOwner.
    function launchFor(
        address shipOwner,
        string calldata /*name*/,
        string calldata /*symbol*/,
        address /*upstream*/
    ) external returns (address tokenAddr, address reactorAddr) {
        require(shipOwner != address(0), "zero shipOwner");
        uint256 fee = launchFee;
        if (fee > 0) {
            require(IERC20Mock(usdc).transferFrom(msg.sender, treasury, fee), "fee pull failed");
        }
        // Deploy a unique token + register a distributor (the shared crew).
        MockShipToken t = new MockShipToken(shipOwner);
        tokenAddr = address(t);
        reactorAddr = address(uint160(uint256(keccak256(abi.encode(tokenAddr)))));
        distributorOf[tokenAddr] = crew;

        // The ship owner gets the 100 crew NFTs (marker on the shared MockCrew).
        IMockCrew(crew).setBalance(shipOwner, 100);

        emit LaunchedFor(shipOwner, tokenAddr);
    }
}
