// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FeeShareDistributor — 100-NFT fee-share layer (NEW LAUNCHES ONLY)
///
/// A fixed-supply ERC-721 (exactly 100 NFTs, ids 0..99) that receives the
/// reactor's "launcher 50%" of core-token fees and splits it evenly across the
/// 100 NFTs. Each NFT = 1/100 of that share.
///
/// Mechanics:
///   - Reactor transfers the launched token IN, then calls notifyDeposit().
///   - notifyDeposit measures the ACTUAL balance increase (never trusts the
///     reported amount) and credits delta/100 per NFT via accPerShare.
///   - Holders pull their share with claim(id) / claimAll(ids).
///   - On transfer, the SELLER's already-earned share is settled into a
///     withdrawable escrow and the NFT's debt is reset to current accPerShare,
///     so the BUYER only earns from future deposits and a malicious/blocking
///     payout token can NEVER revert an NFT transfer.
///
/// Non-custodial: no owner/admin can withdraw the fee pool. Rounding dust from
/// the /100 division simply remains in the contract.
///
/// Metadata: tokenURI(id) resolves to `<baseURI><thisAddress>:<id>` so the
/// off-chain crew-meta service (keyed by `<distributor>:<tokenId>`) serves
/// dynamic paper-doll JSON + live art. `baseURI` is settable by the launcher so
/// the metadata HOST can move over the life of the NFT (forever-NFT resilience).
/// IMPORTANT: baseURI is DISPLAY-ONLY — it controls where metadata is fetched,
/// NEVER funds or fee-share accounting. The fee pool stays non-custodial and the
/// 100-mint / dividend logic is byte-for-byte unchanged; baseURI is the only add.
///
/// ⚠️ Legal flag: an NFT bought specifically to earn fee revenue looks closer
/// to a security than burn/LP-deepening. Do not deploy until legal signs off.

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFeeToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract FeeShareDistributor is ERC721, ReentrancyGuard {

    // ── Constants ───────────────────────────────────────────────────────────
    uint256 public constant TOTAL_SHARES = 100;   // fixed supply, ids 0..99
    uint256 private constant ACC_PRECISION = 1e18;

    // ── Immutables ──────────────────────────────────────────────────────────
    address public immutable token;     // the launched ERC20 paid out
    address public immutable reactor;   // only address allowed to notifyDeposit
    address public immutable launcher;  // received all 100 at construction

    // ── Dividend accounting ─────────────────────────────────────────────────
    /// Cumulative token earned PER NFT, scaled by ACC_PRECISION (1e18).
    uint256 public accPerShare;
    /// Last-settled checkpoint per token id, scaled by ACC_PRECISION.
    mapping(uint256 => uint256) public rewardDebt;
    /// Settled-but-unclaimed balance for sellers after a transfer settle.
    mapping(address => uint256) public escrow;
    /// Last observed token balance, used to measure real deposit deltas.
    uint256 public lastBalance;

    // ── Metadata (DISPLAY-ONLY; controls where metadata is fetched, not funds) ─
    /// Base for tokenURI. tokenURI(id) = `<baseURI><thisAddress>:<id>`.
    /// Settable by the launcher so the metadata host can move (forever-NFT).
    string public baseURI;

    // ── Events ──────────────────────────────────────────────────────────────
    event Deposited(uint256 amount, uint256 accPerShareAdded);
    event Claimed(uint256 indexed id, address indexed to, uint256 amount);
    event EscrowSettled(uint256 indexed id, address indexed seller, uint256 amount);
    event EscrowWithdrawn(address indexed to, uint256 amount);
    event BaseURISet(string baseURI);

    modifier onlyReactor() {
        require(msg.sender == reactor, "not reactor");
        _;
    }

    constructor(
        address _token,
        address _reactor,
        address _launcher,
        string memory _name,
        string memory _symbol,
        string memory _baseURI
    ) ERC721(_name, _symbol) {
        require(_token != address(0), "zero token");
        require(_reactor != address(0), "zero reactor");
        require(_launcher != address(0), "zero launcher");

        token    = _token;
        reactor  = _reactor;
        launcher = _launcher;
        baseURI  = _baseURI;

        // Mint all 100 NFTs to the launcher. rewardDebt starts at 0 == accPerShare.
        for (uint256 id; id < TOTAL_SHARES; ++id) {
            _mint(_launcher, id);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Metadata (display-only)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Move the metadata base (e.g. if the crew-meta host changes).
    ///         Launcher-gated. DISPLAY-ONLY — never touches funds or accounting.
    function setBaseURI(string calldata _baseURI) external {
        require(msg.sender == launcher, "not launcher");
        baseURI = _baseURI;
        emit BaseURISet(_baseURI);
    }

    /// @notice tokenURI(id) = `<baseURI><thisAddress>:<id>`.
    ///         The crew-meta service is keyed by `<distributor>:<tokenId>`.
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id); // reverts for a nonexistent id
        return string.concat(baseURI, _toHexString(address(this)), ":", _toString(id));
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 digits; uint256 t = v;
        while (t != 0) { digits++; t /= 10; }
        bytes memory b = new bytes(digits);
        while (v != 0) { digits--; b[digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }

    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory s = new bytes(42);
        s[0] = "0";
        s[1] = "x";
        bytes memory hexc = "0123456789abcdef";
        uint160 a = uint160(addr);
        for (uint256 i = 41; i > 1; i--) {
            s[i] = hexc[a & 0xf];
            a >>= 4;
        }
        return string(s);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Deposits (reactor only)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Credit a fee deposit across all 100 NFTs.
    /// @dev Reactor must transfer `token` IN before calling. We measure the
    ///      ACTUAL balance increase since the last accounting rather than
    ///      trusting `reportedAmount` (handles fee-on-transfer / mismatches).
    function notifyDeposit(uint256 reportedAmount) external onlyReactor {
        reportedAmount; // accepted for interface compatibility; not trusted
        uint256 bal = IFeeToken(token).balanceOf(address(this));
        uint256 delta = bal - lastBalance; // real increase
        if (delta == 0) {
            lastBalance = bal;
            return;
        }
        // delta * 1e18 / 100 added to per-NFT accumulator.
        uint256 added = (delta * ACC_PRECISION) / TOTAL_SHARES;
        accPerShare += added;
        lastBalance = bal;
        emit Deposited(delta, added);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Token amount currently claimable for NFT `id`.
    function pending(uint256 id) public view returns (uint256) {
        _requireOwned(id);
        return (accPerShare - rewardDebt[id]) / ACC_PRECISION;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Claims (pull)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Settle NFT `id`'s pending share to its current owner.
    ///         Anyone may trigger; payout always goes to ownerOf(id).
    function claim(uint256 id) external nonReentrant {
        _claim(id);
    }

    /// @notice Claim several NFTs at once.
    function claimAll(uint256[] calldata ids) external nonReentrant {
        for (uint256 i; i < ids.length; ++i) {
            _claim(ids[i]);
        }
    }

    function _claim(uint256 id) internal {
        address owner = ownerOf(id); // reverts if non-existent
        uint256 amount = (accPerShare - rewardDebt[id]) / ACC_PRECISION;
        rewardDebt[id] = accPerShare;
        if (amount > 0) {
            _payout(owner, amount);
            emit Claimed(id, owner, amount);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Escrow withdrawal (sellers)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Withdraw fees that were settled to you when you sold an NFT.
    function withdrawEscrow() external nonReentrant {
        uint256 amount = escrow[msg.sender];
        require(amount > 0, "nothing to withdraw");
        escrow[msg.sender] = 0;
        _payout(msg.sender, amount);
        emit EscrowWithdrawn(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Transfer hook — settle seller's earnings to escrow (OZ v5 _update)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev On every transfer (not mint), settle the FROM owner's pending into
    ///      withdrawable escrow and reset the NFT's debt to current accPerShare.
    ///      Escrow (not direct payout) guarantees a blocking token can never
    ///      revert the transfer. Mints (auth==0) are handled by constructor.
    function _update(address to, uint256 id, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(id);
        // Only settle on real transfers/burns of an existing token (from != 0).
        if (from != address(0)) {
            uint256 owed = (accPerShare - rewardDebt[id]) / ACC_PRECISION;
            rewardDebt[id] = accPerShare;
            if (owed > 0) {
                escrow[from] += owed;
                emit EscrowSettled(id, from, owed);
            }
        }
        return super._update(to, id, auth);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal payout — accounts for tokens leaving the contract
    // ═══════════════════════════════════════════════════════════════════════

    function _payout(address to, uint256 amount) internal {
        require(IFeeToken(token).transfer(to, amount), "token transfer failed");
        // Keep lastBalance in sync so the next notifyDeposit delta is correct.
        uint256 bal = IFeeToken(token).balanceOf(address(this));
        lastBalance = bal;
    }
}
