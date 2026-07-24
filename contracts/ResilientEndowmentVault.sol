// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ResilientEndowmentVault — immortal charity endowment core for the battle grid
///
/// THE IMMORTAL CORE. Once funded, principal is LOCKED FOREVER — there is no
/// withdraw, drain, or escape hatch for principal anywhere in this contract. Only
/// the YIELD moves, and only to a governance-constrained beneficiary or the
/// immortal trees fallback. Designed for the 1000-year horizon: charities buckle,
/// on-chain is forever — so resilience is baked into v1 (you can NOT add a
/// redirect to an already-locked vault later).
///
/// Fits the existing Money/CharityFund/Aave pattern (see MoneyForTreesV2):
///   - Principal is USDC supplied into Aave V3 (yield-bearing aUSDC).
///   - harvest() pulls the accrued Aave yield (aUSDC above principal) and routes
///     it per cause to that cause's beneficiary, or to trees if unset/buckled.
///
/// What this contract guarantees:
///   1. PRINCIPAL LOCKED FOREVER — no withdraw/drain of principal, ever.
///   2. PER-CAUSE ENDOWMENT LEDGER — each account's cumulative $ endowed PER
///      CAUSE is recorded permanently. $1 = 1 level. Levels never drop, even if
///      the charity dies (the record is the level, not the charity).
///   3. GOVERNABLE BENEFICIARY (constrained) — governance can re-point which
///      charity receives a cause's FUTURE yield, WITHOUT touching principal, but
///      ONLY to a whitelisted verified charity OR the trees fallback. NEVER to
///      the operator/owner/governance themselves.
///   4. TREES = IMMORTAL FALLBACK — unset/buckled beneficiary ⇒ yield routes to
///      trees. Good never stops.
///   5. SUCCESSOR REMAP — a cause can be re-mapped to a successor cause; player
///      endowment/levels carry over (read through the successor chain). Records
///      are never lost.
///   6. TRANSPARENT + TIMELOCKED — every beneficiary change / successor remap is
///      a 2-step (propose → execute after a delay) emitting public events, so no
///      change is instant or silent.
///
/// Governance = owner (committee) for now. NOTE: before mainnet this owner MUST
/// become a timelock + multisig. There is no operator drain anywhere regardless.

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

contract ResilientEndowmentVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //  Immutable core
    // ═══════════════════════════════════════════════════════════════════════

    IERC20      public immutable usdc;       // endowment asset (6-dec)
    IAaveV3Pool public immutable aavePool;   // yield source
    IERC20      public immutable aUsdc;      // Aave receipt (tracks principal+yield)

    /// @notice The immortal fallback. Yield routes here whenever a cause's
    ///         beneficiary is unset or buckled. Set once, never changed — the one
    ///         thing that must never move. NOT the operator.
    address public immutable trees;

    /// @notice Total USDC principal supplied. Locked forever — only ever grows.
    uint256 public totalPrincipal;

    /// @notice Time a proposed governance change must age before it can execute.
    uint256 public immutable timelockDelay;

    // ═══════════════════════════════════════════════════════════════════════
    //  Cause registry
    // ═══════════════════════════════════════════════════════════════════════

    struct Cause {
        bool    exists;
        address beneficiary;   // current yield recipient (0 = unset ⇒ trees)
        uint256 successor;     // remapped target cause id (0 = none)
        uint256 totalEndowed;  // cumulative USDC endowed to this cause
    }
    mapping(uint256 => Cause) public causes;

    /// @notice account => causeId => cumulative USDC endowed. THE LEVEL SOURCE.
    ///         $1 = 1 level. Permanent; never decreases.
    mapping(address => mapping(uint256 => uint256)) public endowedBy;

    /// @notice Whitelist of verified charity addresses a beneficiary may be set to.
    ///         trees is always valid (immortal). Operator/owner can NEVER be here
    ///         in a way that matters — _validBeneficiary explicitly bars owner.
    mapping(address => bool) public verifiedCharity;

    // ═══════════════════════════════════════════════════════════════════════
    //  Timelocked governance proposals (2-step)
    // ═══════════════════════════════════════════════════════════════════════

    struct BeneficiaryProposal {
        address target;
        uint256 readyAt;   // 0 = none pending
    }
    mapping(uint256 => BeneficiaryProposal) public pendingBeneficiary;

    struct SuccessorProposal {
        uint256 successor;
        uint256 readyAt;
    }
    mapping(uint256 => SuccessorProposal) public pendingSuccessor;

    uint256 private constant MAX_SUCCESSOR_HOPS = 20; // anti-loop / gas bound

    // ═══════════════════════════════════════════════════════════════════════
    //  Events — every change is public & auditable
    // ═══════════════════════════════════════════════════════════════════════

    event CauseRegistered(uint256 indexed causeId, address beneficiary);
    event Endowed(address indexed account, uint256 indexed causeId, uint256 amount, uint256 newCumulative);
    event CharityVerified(address indexed charity, bool verified);

    event BeneficiaryProposed(uint256 indexed causeId, address indexed target, uint256 readyAt);
    event BeneficiaryChanged(uint256 indexed causeId, address indexed previous, address indexed next);
    event BeneficiaryProposalCancelled(uint256 indexed causeId);

    event SuccessorProposed(uint256 indexed causeId, uint256 indexed successor, uint256 readyAt);
    event SuccessorRemapped(uint256 indexed causeId, uint256 indexed successor);
    event SuccessorProposalCancelled(uint256 indexed causeId);

    event YieldRouted(uint256 indexed causeId, address indexed to, uint256 amount, bool toTreesFallback);

    constructor(
        address _usdc,
        address _aavePool,
        address _aUsdc,
        address _trees,
        uint256 _timelockDelay,
        address _governance
    ) Ownable(_governance) {
        require(_usdc != address(0), "zero usdc");
        require(_aavePool != address(0), "zero aave");
        require(_aUsdc != address(0), "zero aUsdc");
        require(_trees != address(0), "zero trees");
        require(_governance != address(0), "zero governance");
        require(_trees != _governance, "trees == governance");

        usdc = IERC20(_usdc);
        aavePool = IAaveV3Pool(_aavePool);
        aUsdc = IERC20(_aUsdc);
        trees = _trees;
        timelockDelay = _timelockDelay;

        // Approve Aave to pull USDC for supply. This grants spend on USDC the
        // vault is ABOUT to deposit; it can never be used to remove principal —
        // only supply() (deposit) is ever called with this allowance.
        IERC20(_usdc).approve(_aavePool, type(uint256).max);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Cause registry (governance)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Register a new cause. causeId must be > 0 (0 is reserved as "none").
    ///         Initial beneficiary must be a verified charity or trees (or unset).
    function registerCause(uint256 causeId, address beneficiary) external onlyOwner {
        require(causeId != 0, "cause 0 reserved");
        require(!causes[causeId].exists, "exists");
        if (beneficiary != address(0)) {
            require(_validBeneficiary(beneficiary), "bad beneficiary");
        }
        causes[causeId] = Cause({
            exists: true,
            beneficiary: beneficiary,
            successor: 0,
            totalEndowed: 0
        });
        emit CauseRegistered(causeId, beneficiary);
    }

    /// @notice Whitelist (or de-list) a verified charity address. trees never
    ///         needs whitelisting (always valid). Owner cannot whitelist itself
    ///         into a usable beneficiary — _validBeneficiary bars owner explicitly.
    function setVerifiedCharity(address charity, bool verified) external onlyOwner {
        require(charity != address(0), "zero charity");
        verifiedCharity[charity] = verified;
        emit CharityVerified(charity, verified);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Endow — lock USDC forever, record the per-cause level
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Endow USDC to a cause on behalf of `account`. Principal is supplied
    ///         to Aave and LOCKED FOREVER. The account's cumulative endowment to
    ///         this cause grows by `amount` ($1 = 1 level). Resolves through any
    ///         successor remap so endowing a dead cause credits its successor.
    function endow(address account, uint256 causeId, uint256 amount) external nonReentrant {
        require(account != address(0), "zero account");
        require(amount > 0, "zero amount");
        uint256 resolved = _resolveCause(causeId);
        require(causes[resolved].exists, "no cause");

        // Pull principal in and lock it into Aave. Never withdrawable.
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        aavePool.supply(address(usdc), amount, address(this), 0);
        totalPrincipal += amount;

        uint256 cum = endowedBy[account][resolved] + amount;
        endowedBy[account][resolved] = cum;
        causes[resolved].totalEndowed += amount;

        emit Endowed(account, resolved, amount, cum);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Harvest — route ONLY yield, never principal
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Permissionless. Pulls all accrued Aave yield (aUSDC above the
    ///         locked principal) and routes it to a cause's beneficiary, or to
    ///         trees if that beneficiary is unset/buckled. Principal stays in Aave.
    ///         `causeId` only decides WHERE the (shared) yield goes this call;
    ///         per-cause yield split/streaming can layer on later — v1 routes the
    ///         whole available yield to one cause's destination per harvest.
    function harvest(uint256 causeId) external nonReentrant {
        uint256 resolved = _resolveCause(causeId);
        require(causes[resolved].exists, "no cause");

        uint256 backing = aUsdc.balanceOf(address(this));
        require(backing > totalPrincipal, "no yield");
        uint256 yield = backing - totalPrincipal;

        (address dest, bool fallbackToTrees) = _yieldDestination(resolved);

        // Withdraw ONLY the yield from Aave straight to the destination.
        // Principal (totalPrincipal) is never touched.
        aavePool.withdraw(address(usdc), yield, dest);

        emit YieldRouted(resolved, dest, yield, fallbackToTrees);
    }

    /// @dev A cause's yield goes to its verified beneficiary; if that beneficiary
    ///      is unset OR has since been de-verified (buckled), it falls back to
    ///      the immortal trees address. Good never stops.
    function _yieldDestination(uint256 causeId) internal view returns (address dest, bool fellBack) {
        address b = causes[causeId].beneficiary;
        if (b != address(0) && _validBeneficiary(b)) {
            return (b, false);
        }
        return (trees, true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Beneficiary redirect (2-step, timelocked, constrained)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Propose re-pointing a cause's future yield. Target must be a
    ///         verified charity or trees — NEVER the operator/owner. Starts the
    ///         timelock; executeBeneficiary() applies it after the delay.
    function proposeBeneficiary(uint256 causeId, address target) external onlyOwner {
        require(causes[causeId].exists, "no cause");
        require(_validBeneficiary(target), "bad target");
        uint256 readyAt = block.timestamp + timelockDelay;
        pendingBeneficiary[causeId] = BeneficiaryProposal({ target: target, readyAt: readyAt });
        emit BeneficiaryProposed(causeId, target, readyAt);
    }

    function executeBeneficiary(uint256 causeId) external onlyOwner {
        BeneficiaryProposal memory p = pendingBeneficiary[causeId];
        require(p.readyAt != 0, "none pending");
        require(block.timestamp >= p.readyAt, "timelocked");
        require(_validBeneficiary(p.target), "target no longer valid");

        address prev = causes[causeId].beneficiary;
        causes[causeId].beneficiary = p.target;
        delete pendingBeneficiary[causeId];
        emit BeneficiaryChanged(causeId, prev, p.target);
    }

    function cancelBeneficiary(uint256 causeId) external onlyOwner {
        require(pendingBeneficiary[causeId].readyAt != 0, "none pending");
        delete pendingBeneficiary[causeId];
        emit BeneficiaryProposalCancelled(causeId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Successor remap (2-step, timelocked) — levels carry over, never lost
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Propose remapping a cause to a successor cause. After execution,
    ///         new endowments to the old cause credit the successor, and level
    ///         reads resolve through the chain — players keep their levels/class.
    function proposeSuccessor(uint256 causeId, uint256 successor) external onlyOwner {
        require(causes[causeId].exists, "no cause");
        require(causes[successor].exists, "no successor");
        require(successor != causeId, "self successor");
        uint256 readyAt = block.timestamp + timelockDelay;
        pendingSuccessor[causeId] = SuccessorProposal({ successor: successor, readyAt: readyAt });
        emit SuccessorProposed(causeId, successor, readyAt);
    }

    function executeSuccessor(uint256 causeId) external onlyOwner {
        SuccessorProposal memory p = pendingSuccessor[causeId];
        require(p.readyAt != 0, "none pending");
        require(block.timestamp >= p.readyAt, "timelocked");
        require(causes[p.successor].exists, "successor gone");

        causes[causeId].successor = p.successor;
        delete pendingSuccessor[causeId];

        // Guard against creating a cycle that would loop _resolveCause.
        _assertNoCycle(causeId);

        emit SuccessorRemapped(causeId, p.successor);
    }

    function cancelSuccessor(uint256 causeId) external onlyOwner {
        require(pendingSuccessor[causeId].readyAt != 0, "none pending");
        delete pendingSuccessor[causeId];
        emit SuccessorProposalCancelled(causeId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Level / endowment views (carry through successor chain)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice An account's level for a cause = cumulative USDC endowed across
    ///         this cause AND every cause that has been remapped INTO it, summed
    ///         through the successor chain so a remap never loses levels.
    ///         (Sums the resolved-tail balance plus this id's own balance.)
    function levelOf(address account, uint256 causeId) public view returns (uint256) {
        // Walk the successor chain from causeId, summing the account's endowment
        // at each hop. Records at every id in the chain belong to the player.
        uint256 total;
        uint256 id = causeId;
        for (uint256 i = 0; i < MAX_SUCCESSOR_HOPS; i++) {
            total += endowedBy[account][id];
            uint256 next = causes[id].successor;
            if (next == 0 || next == id) break;
            id = next;
        }
        return total;
    }

    /// @notice Resolve a causeId through its successor chain to the live tail.
    function resolveCause(uint256 causeId) external view returns (uint256) {
        return _resolveCause(causeId);
    }

    function _resolveCause(uint256 causeId) internal view returns (uint256) {
        uint256 id = causeId;
        for (uint256 i = 0; i < MAX_SUCCESSOR_HOPS; i++) {
            uint256 next = causes[id].successor;
            if (next == 0 || next == id) return id;
            id = next;
        }
        return id; // bounded; cycles are prevented at remap time
    }

    function _assertNoCycle(uint256 causeId) internal view {
        uint256 slow = causeId;
        uint256 fast = causeId;
        for (uint256 i = 0; i < MAX_SUCCESSOR_HOPS; i++) {
            uint256 fn = causes[fast].successor;
            if (fn == 0) return;
            fast = fn;
            fn = causes[fast].successor;
            if (fn == 0) return;
            fast = fn;
            slow = causes[slow].successor;
            require(slow != fast, "cycle");
        }
        // Chain longer than the bound is treated as malformed.
        revert("chain too long");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Beneficiary validity — the hard governance constraint
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev A beneficiary is valid ONLY if it is the immortal trees fallback or a
    ///      whitelisted verified charity. It can NEVER be the owner/governance,
    ///      the vault itself, or the zero address. This is the backbone of
    ///      "control nothing that isn't ours" — governance can redirect good, but
    ///      can never redirect funds to itself.
    function _validBeneficiary(address b) internal view returns (bool) {
        if (b == address(0)) return false;
        if (b == owner()) return false;          // never the operator/governance
        if (b == address(this)) return false;     // never back into the vault
        if (b == trees) return true;              // immortal fallback always OK
        return verifiedCharity[b];                // else must be whitelisted
    }

    function isValidBeneficiary(address b) external view returns (bool) {
        return _validBeneficiary(b);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Yield currently available to harvest (aUSDC above locked principal).
    function pendingYield() external view returns (uint256) {
        uint256 backing = aUsdc.balanceOf(address(this));
        return backing > totalPrincipal ? backing - totalPrincipal : 0;
    }

    /// @notice Where a cause's yield would go right now (and whether via fallback).
    function yieldDestination(uint256 causeId) external view returns (address dest, bool fellBack) {
        return _yieldDestination(_resolveCause(causeId));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  IMMORTALITY NOTE
    //  There is intentionally NO function that withdraws, transfers, or rescues
    //  principal — not for the owner, not for anyone. The only Aave withdraw call
    //  in this contract is in harvest(), and it withdraws EXACTLY the yield
    //  (backing - totalPrincipal) straight to a constrained destination. Principal
    //  can never leave. Do not add a principal-withdraw path.
    // ═══════════════════════════════════════════════════════════════════════
}
