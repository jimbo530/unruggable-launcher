// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * CommunityGarden — Shared POOP pool for future public good
 *
 * Simple: accept POOP deposits, track per-player contributions.
 * Purpose TBD — could fund impact, DAO, community treasury, etc.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract CommunityGarden {

    address public owner;
    address public poopToken;

    uint256 public totalContributions;
    mapping(address => uint256) public contributions;
    address[] public contributors;
    mapping(address => bool) private isContributor;

    event Deposited(address indexed player, uint256 amount);
    event FundsUsed(address indexed to, uint256 amount, string purpose);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address _poopToken) {
        owner = msg.sender;
        poopToken = _poopToken;
    }

    /// @notice Deposit POOP to the community garden
    function deposit(uint256 amount) external {
        require(amount > 0, "zero");
        IERC20(poopToken).transferFrom(msg.sender, address(this), amount);
        contributions[msg.sender] += amount;
        totalContributions += amount;
        if (!isContributor[msg.sender]) {
            contributors.push(msg.sender);
            isContributor[msg.sender] = true;
        }
        emit Deposited(msg.sender, amount);
    }

    /// @notice Owner can use funds for public good (with logged purpose)
    function useFunds(address to, uint256 amount, string calldata purpose) external onlyOwner {
        require(IERC20(poopToken).balanceOf(address(this)) >= amount, "insufficient");
        IERC20(poopToken).transfer(to, amount);
        emit FundsUsed(to, amount, purpose);
    }

    function contributorCount() external view returns (uint256) { return contributors.length; }
    function poopBalance() external view returns (uint256) { return IERC20(poopToken).balanceOf(address(this)); }

    function setPoopToken(address _poop) external onlyOwner { poopToken = _poop; }
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        owner = newOwner;
    }
}
