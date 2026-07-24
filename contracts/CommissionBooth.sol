// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  CommissionBooth — Bankr songsmith entrypoint (Base, chain 8453).
//
//  A fan pays with a band token; the contract pulls the price straight
//  to projectWallet (holds NOTHING itself) and emits Commissioned so
//  the off-chain watcher can feed the songsmith queue.
//
//  Design constraints
//  ─────────────────
//  • Pure pass-through: no token custody, no balance accumulation.
//  • transferFrom return value is checked — reverts on false (bad token).
//  • No re-entrancy surface: state is only read/written before the external
//    call, and the external call (transferFrom) writes only to the token
//    contract; we hold nothing and write nothing after the transfer.
//  • Owner-only admin: setBand / setProjectWallet / setPaused / transferOwnership.
//  • idea + handle are arbitrary strings stored only in event calldata (no state
//    cost). Front-end / watcher should cap idea at ~280 chars to keep gas sane;
//    the contract does not enforce a cap (cheap on Base, watcher can ignore bloat).
// ============================================================

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract CommissionBooth {
    // ── State ─────────────────────────────────────────────────────────────────

    address public owner;
    address public projectWallet;
    bool public paused;

    struct Band {
        address token;
        uint256 price;
        bool active;
    }

    mapping(uint8 => Band) public bands;

    // ── Events ────────────────────────────────────────────────────────────────

    event Commissioned(
        address indexed payer,
        uint8 indexed bandId,
        address token,
        uint256 price,
        string idea,
        string handle,
        uint256 ts
    );

    event BandSet(uint8 indexed id, address token, uint256 price, bool active);
    event ProjectWalletSet(address newWallet);
    event Paused(bool isPaused);
    event OwnershipTransferred(address indexed prev, address indexed next);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _projectWallet) {
        require(_projectWallet != address(0), "zero wallet");
        owner = msg.sender;
        projectWallet = _projectWallet;
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    // ── Fan entrypoint ────────────────────────────────────────────────────────

    /// @notice Pay with bandId's token and submit a song idea.
    /// @param bandId  1-indexed band id from the roster.
    /// @param idea    Song idea / topic (free text; keep ≤280 chars client-side).
    /// @param handle  Fan's X / Farcaster handle for attribution.
    function commission(
        uint8 bandId,
        string calldata idea,
        string calldata handle
    ) external {
        require(!paused, "paused");
        Band storage b = bands[bandId];
        require(b.active, "band");
        require(b.token != address(0), "no token");
        require(b.price > 0, "no price");

        // Pull band tokens straight to projectWallet — contract holds nothing.
        bool ok = IERC20(b.token).transferFrom(msg.sender, projectWallet, b.price);
        require(ok, "pay");

        emit Commissioned(msg.sender, bandId, b.token, b.price, idea, handle, block.timestamp);
    }

    // ── Owner admin ──────────────────────────────────────────────────────────

    /// @notice Register or update a band. Set active=false to disable.
    function setBand(uint8 id, address token, uint256 price, bool active) external onlyOwner {
        require(id > 0, "id 0 reserved");
        bands[id] = Band({ token: token, price: price, active: active });
        emit BandSet(id, token, price, active);
    }

    function setProjectWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "zero wallet");
        projectWallet = _wallet;
        emit ProjectWalletSet(_wallet);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
