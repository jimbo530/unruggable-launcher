// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CharityFeeRouter — the cookie-cutter charity fee pass-through
///
/// ONE per charity. Copy/deploy as needed (Fins Attached, then any charity we
/// like). A token launches with all the standard LP tooling; its USDC fee stream
/// is pointed at this router, which forwards 100% straight to the charity. We
/// NEVER sit in between the money:
///
///   - This contract HOLDS NOTHING. flush() pushes the entire USDC balance to the
///     charity. It is permissionless, so funds can never be trapped and anyone
///     (a keeper, a holder, the charity itself) can sweep it through.
///   - There is NO owner/operator withdraw, drain, or rescue path anywhere. The
///     only place USDC leaves is flush(), and flush() can only send to a
///     constrained beneficiary (a verified charity or the immortal trees fallback)
///     — NEVER to the owner, the governance, or this contract.
///
/// The ONE lever (mirrors ResilientEndowmentVault): governance may RE-POINT the
/// beneficiary if a charity dies / its deposit address rotates — but only to
/// another verified charity or the trees fallback, via a 2-step timelock, and
/// never to itself. If the beneficiary is ever unset or de-verified ("buckles"),
/// flush() routes to trees. Good never stops; holders keep a working token + pool;
/// we just repoint and stop promoting the dead charity.
///
/// USDC-only by design — charities are paid in USDC, never the meme/partner token
/// (no leak, no money-transmission of partner assets).

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CharityFeeRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //  Immutable core
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice The asset charities are paid in. USDC (6-dec). Set once.
    IERC20 public immutable usdc;

    /// @notice The immortal fallback. If the beneficiary is unset or buckled,
    ///         flush() routes here. Set once, never changed. NOT the operator.
    address public immutable trees;

    /// @notice Delay a proposed beneficiary change must age before it can execute.
    uint256 public immutable timelockDelay;

    // ═══════════════════════════════════════════════════════════════════════
    //  Mutable governance state (the one lever)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Current charity USDC recipient. 0 = unset ⇒ flush routes to trees.
    address public beneficiary;

    /// @notice Whitelist of verified charity addresses the beneficiary may be set
    ///         to. trees is always valid. Owner can NEVER be a usable beneficiary
    ///         (_validBeneficiary bars it explicitly).
    mapping(address => bool) public verifiedCharity;

    struct BeneficiaryProposal {
        address target;
        uint256 readyAt; // 0 = none pending
    }
    BeneficiaryProposal public pendingBeneficiary;

    /// @notice Lifetime USDC forwarded through this router. On-chain proof for the
    ///         disbursement tracker (the page reads this + Flushed events).
    uint256 public totalRouted;

    // ═══════════════════════════════════════════════════════════════════════
    //  Events — every move is public & auditable
    // ═══════════════════════════════════════════════════════════════════════

    event Flushed(address indexed to, uint256 amount, bool toTreesFallback);
    event Received(uint256 amount); // informational; emitted by notifyDeposit hook
    event CharityVerified(address indexed charity, bool verified);
    event BeneficiaryProposed(address indexed target, uint256 readyAt);
    event BeneficiaryChanged(address indexed previous, address indexed next);
    event BeneficiaryProposalCancelled(address indexed target);

    constructor(
        address _usdc,
        address _trees,
        address _beneficiary,
        uint256 _timelockDelay,
        address _governance
    ) Ownable(_governance) {
        require(_usdc != address(0), "zero usdc");
        require(_trees != address(0), "zero trees");
        require(_governance != address(0), "zero governance");
        require(_trees != _governance, "trees == governance");

        usdc = IERC20(_usdc);
        trees = _trees;
        timelockDelay = _timelockDelay;

        // Initial beneficiary may be unset (⇒ trees) or a real charity. If set, it
        // must be valid right now: not the owner, not this contract, not zero.
        if (_beneficiary != address(0)) {
            require(_beneficiary != _governance, "beneficiary == governance");
            require(_beneficiary != address(this), "beneficiary == self");
            beneficiary = _beneficiary;
            verifiedCharity[_beneficiary] = true; // the launch charity is verified
            emit CharityVerified(_beneficiary, true);
            emit BeneficiaryChanged(address(0), _beneficiary);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Flush — the only way USDC leaves. Permissionless. To charity or trees.
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Push the router's entire USDC balance to the current beneficiary,
    ///         or to the immortal trees fallback if the beneficiary is unset or
    ///         has buckled (de-verified). Callable by anyone — funds can never be
    ///         trapped here, and we never custody them.
    function flush() external nonReentrant returns (uint256 amount) {
        amount = usdc.balanceOf(address(this));
        require(amount > 0, "nothing to flush");

        (address dest, bool toTrees) = _destination();
        totalRouted += amount;
        usdc.safeTransfer(dest, amount);
        emit Flushed(dest, amount, toTrees);
    }

    /// @notice Drop-in hook so this router can serve as a SporeReactorV6
    ///         `distributor`. The reactor transfers the USDC here FIRST, then
    ///         calls this. We deliberately do NOTHING with funds and NEVER revert
    ///         — so a charity-side issue can never block the reactor's burn/LP
    ///         cycle. The real payout happens via flush() (permissionless).
    ///         `amount` is informational only; totalRouted + Flushed events are
    ///         the source of truth (do not trust Received in the tracker).
    function notifyDeposit(uint256 amount) external {
        emit Received(amount);
    }

    /// @dev Where a flush would send right now. The beneficiary if set & still
    ///      valid; otherwise the immortal trees fallback.
    function _destination() internal view returns (address dest, bool toTrees) {
        address b = beneficiary;
        if (b != address(0) && _validBeneficiary(b)) {
            return (b, false);
        }
        return (trees, true);
    }

    /// @notice Where the next flush would send (and whether via the trees fallback).
    function destination() external view returns (address dest, bool toTrees) {
        return _destination();
    }

    /// @notice USDC sitting here awaiting the next flush.
    function pending() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  The one lever — re-point the charity (2-step, timelocked, constrained)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Whitelist (or de-list) a verified charity. trees never needs
    ///         whitelisting. The owner can never whitelist itself into a usable
    ///         beneficiary — _validBeneficiary bars the owner explicitly.
    function setVerifiedCharity(address charity, bool verified) external onlyOwner {
        require(charity != address(0), "zero charity");
        require(charity != owner(), "charity == owner");
        require(charity != address(this), "charity == self");
        verifiedCharity[charity] = verified;
        emit CharityVerified(charity, verified);
    }

    /// @notice Propose re-pointing future flushes. Target must be a verified
    ///         charity or trees — NEVER the operator/owner. Starts the timelock.
    function proposeBeneficiary(address target) external onlyOwner {
        require(_validBeneficiary(target), "bad target");
        uint256 readyAt = block.timestamp + timelockDelay;
        pendingBeneficiary = BeneficiaryProposal({ target: target, readyAt: readyAt });
        emit BeneficiaryProposed(target, readyAt);
    }

    function executeBeneficiary() external onlyOwner {
        BeneficiaryProposal memory p = pendingBeneficiary;
        require(p.readyAt != 0, "none pending");
        require(block.timestamp >= p.readyAt, "timelocked");
        require(_validBeneficiary(p.target), "target no longer valid");

        address prev = beneficiary;
        beneficiary = p.target;
        delete pendingBeneficiary;
        emit BeneficiaryChanged(prev, p.target);
    }

    function cancelBeneficiary() external onlyOwner {
        require(pendingBeneficiary.readyAt != 0, "none pending");
        address t = pendingBeneficiary.target;
        delete pendingBeneficiary;
        emit BeneficiaryProposalCancelled(t);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Beneficiary validity — the hard governance constraint
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Valid ONLY if it is the immortal trees fallback or a whitelisted
    ///      verified charity. NEVER the owner/governance, this contract, or zero.
    ///      Governance can redirect good, never redirect funds to itself.
    function _validBeneficiary(address b) internal view returns (bool) {
        if (b == address(0)) return false;
        if (b == owner()) return false;       // never the operator/governance
        if (b == address(this)) return false; // never back into the router
        if (b == trees) return true;          // immortal fallback always OK
        return verifiedCharity[b];            // else must be whitelisted
    }

    function isValidBeneficiary(address b) external view returns (bool) {
        return _validBeneficiary(b);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  NO-DRAIN NOTE
    //  There is intentionally NO owner withdraw / rescue path. The only transfer
    //  of USDC out is flush(), which sends the full balance to a constrained
    //  destination (verified charity or trees). We never custody, never skim.
    //  Do not add an owner-withdraw path.
    // ═══════════════════════════════════════════════════════════════════════
}
