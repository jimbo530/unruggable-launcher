// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VolumeVesting — Burn-proportional token vesting for tree planting charities
/// @notice Clone-friendly (EIP-1167). Tracks cumulative token burns on-chain.
///         As the reactor burns supply from trading fees, this contract releases
///         tokens to the charity at a configurable rate per token burned.
///         No keeper, no oracle — fully autonomous on-chain vesting.
///
///         Math: vestRateBPS = 5000 means 0.5 tokens vest per 1 token burned.
///         With 50% supply in vesting and 2:1 burn ratio, charity is fully
///         vested when cumulative burns reach totalSupply.

interface IERC20Vest {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract VolumeVesting {

    address public token;
    address public charity;
    address public burnAddress;
    uint256 public totalAllocation;
    uint256 public claimed;
    uint256 public vestRateBPS;
    bool    public initialized;

    event Claimed(address indexed charity, uint256 amount, uint256 totalClaimed, uint256 totalBurned);

    // ═══════���═══════════════════════════════════════════════════════════════
    //  Initialize (called once by factory, replaces constructor for clones)
    // ═════���════════════════════════════════════════════���════════════════════

    function initialize(
        address _token,
        address _charity,
        address _burnAddress,
        uint256 _totalAllocation,
        uint256 _vestRateBPS
    ) external {
        require(!initialized, "already init");
        initialized = true;
        require(_token != address(0) && _charity != address(0) && _burnAddress != address(0), "zero addr");
        require(_totalAllocation > 0, "zero allocation");
        require(_vestRateBPS > 0 && _vestRateBPS <= 10000, "invalid rate");

        token           = _token;
        charity         = _charity;
        burnAddress     = _burnAddress;
        totalAllocation = _totalAllocation;
        vestRateBPS     = _vestRateBPS;
    }

    // ═���═══════════════════════════════════════════════════════════════���═════
    //  Claim — charity withdraws vested tokens
    // ═════���══════════════���══════════════════════════════════════════════════

    function claim() external {
        require(msg.sender == charity, "not charity");
        uint256 amount = claimable();
        require(amount > 0, "nothing to claim");
        claimed += amount;
        IERC20Vest(token).transfer(charity, amount);
        emit Claimed(charity, amount, claimed, IERC20Vest(token).balanceOf(burnAddress));
    }

    // ══���══════════════════════════════════════════════════════════════��═════
    //  Views
    // ══════��═══════════════��═════════════════════════���══════════════════════

    /// @notice Total tokens vested so far (proportional to cumulative burns)
    function vested() public view returns (uint256) {
        uint256 burned = IERC20Vest(token).balanceOf(burnAddress);
        uint256 v = burned * vestRateBPS / 10000;
        return v > totalAllocation ? totalAllocation : v;
    }

    /// @notice Tokens available to claim right now
    function claimable() public view returns (uint256) {
        return vested() - claimed;
    }

    /// @notice Total tokens burned so far
    function totalBurned() external view returns (uint256) {
        return IERC20Vest(token).balanceOf(burnAddress);
    }

    /// @notice Progress toward full vesting (BPS, 10000 = 100%)
    function vestedBPS() external view returns (uint256) {
        if (totalAllocation == 0) return 0;
        return vested() * 10000 / totalAllocation;
    }

    /// @notice How many more tokens need to burn before charity is fully vested
    function burnsUntilFullyVested() external view returns (uint256) {
        uint256 v = vested();
        if (v >= totalAllocation) return 0;
        uint256 remaining = totalAllocation - v;
        return remaining * 10000 / vestRateBPS;
    }
}
