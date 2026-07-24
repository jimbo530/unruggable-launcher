// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ShipToken — Mutiny-capable fixed-supply ERC20
///
/// Identical to LaunchToken economically: fixed totalSupply minted once to a
/// single recipient (the factory), decimals=18, no mint, no burn, no owner
/// drain. The transfer/approve/transferFrom logic and supply are BYTE-FOR-BYTE
/// the same — this token can never be rugged or inflated.
///
/// The ONLY mutable surface is COSMETIC: name, symbol, and logoURI. These can be
/// changed via `mutiny()` by a "captain" — an address holding >= 51 of the 100
/// crew NFTs (the FeeShareDistributor collection). Each mutiny is a PAID cosmetic
/// microtransaction: a flat 1 USDC fee is pulled from the caller to the operator
/// treasury. There is NO cooldown — spam is allowed (each call pays $1). Crew
/// governs the ship's identity; the crew can NEVER touch balances, supply, or
/// transfer logic.
///
/// No-rug guarantee: economic state is immutable; only the ship's name/flag
/// (cosmetic metadata) is crew-governable via a 51% mutiny.

interface IERC721Balance {
    function balanceOf(address owner) external view returns (uint256);
}

interface IUSDC {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract ShipToken {

    // ── Cosmetic state (MUTABLE via mutiny) ──────────────────────────────────
    string public name;
    string public symbol;
    string public logoURI;

    // ── Economic state (IMMUTABLE behavior — no mint/burn/drain) ──────────────
    uint8  public constant decimals = 18;
    uint256 public totalSupply;
    string private _baseURI;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ── Crew governance ───────────────────────────────────────────────────────
    address public crew;                 // FeeShareDistributor (100-NFT ERC-721)

    uint256 public constant MUTINY_QUORUM = 51;        // 51+ of 100 crew NFTs
    /// Flat cosmetic-revenue fee per mutiny. USDC is a 6-dec stablecoin, so this
    /// is a fixed $1 FEE (not a market price) — a constant is correct here. This
    /// is the operator's cosmetic-revenue line.
    uint256 public constant MUTINY_FEE = 1_000_000;    // 1 USDC (6-dec)

    address public immutable usdc;        // USDC token (mutiny fee currency)
    address public immutable treasury;    // operator revenue wallet (fee sink)
    address private immutable _deployer;  // the factory / deployer (sets crew once)

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event CrewSet(address indexed crew);
    event ShipRenamed(
        address indexed captain, string name, string symbol, string logoURI, uint256 timestamp
    );

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _supply,
        address _recipient,
        string memory baseURI_,
        address _usdc,
        address _treasury
    ) {
        require(_supply > 0, "zero supply");
        require(_recipient != address(0), "zero recipient");
        require(_usdc != address(0), "zero usdc");
        require(_treasury != address(0), "zero treasury");
        name = _name;
        symbol = _symbol;
        totalSupply = _supply;
        _baseURI = baseURI_;
        usdc = _usdc;
        treasury = _treasury;
        _deployer = msg.sender;
        balanceOf[_recipient] = _supply;
        emit Transfer(address(0), _recipient, _supply);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Crew wiring (deploy-order: distributor address known after token deploy)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Wire the crew NFT collection. Settable ONCE, by the deployer
    ///         (the factory), mirroring the reactor's setDistributor pattern.
    function setCrew(address _crew) external {
        require(msg.sender == _deployer, "not deployer");
        require(crew == address(0), "crew already set");
        require(_crew != address(0), "zero crew");
        crew = _crew;
        emit CrewSet(_crew);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Mutiny — cosmetic-only, 51% crew gated, paid $1 USDC (no cooldown)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice A captain (holds >= 51 of the 100 crew NFTs) renames/re-flags the
    ///         ship for a flat 1 USDC fee. Changes ONLY name/symbol/logoURI —
    ///         never balances or supply. No cooldown: spam is allowed, each call
    ///         pays $1. The caller must have approved EXACTLY MUTINY_FEE of USDC
    ///         to this contract; a failed pull reverts the whole mutiny (visible
    ///         failure, no silent catch).
    function mutiny(
        string calldata newName,
        string calldata newSymbol,
        string calldata newLogoURI
    ) external {
        require(crew != address(0), "crew not set");
        require(
            IERC721Balance(crew).balanceOf(msg.sender) >= MUTINY_QUORUM,
            "not captain"
        );

        // Charge the flat $1 cosmetic fee → operator treasury. Reverts on any
        // failure (no approval / insufficient balance / non-true return).
        require(
            IUSDC(usdc).transferFrom(msg.sender, treasury, MUTINY_FEE),
            "fee transfer failed"
        );

        name = newName;
        symbol = newSymbol;
        logoURI = newLogoURI;

        emit ShipRenamed(msg.sender, newName, newSymbol, newLogoURI, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Metadata (unchanged from LaunchToken)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice EIP-7572 contract-level metadata for aggregators
    function contractURI() external view returns (string memory) {
        return string.concat(_baseURI, _toHexString(address(this)));
    }

    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory s = new bytes(42);
        s[0] = "0";
        s[1] = "x";
        bytes memory hex16 = "0123456789abcdef";
        uint160 v = uint160(addr);
        for (uint256 i = 41; i > 1; i--) {
            s[i] = hex16[v & 0xf];
            v >>= 4;
        }
        return string(s);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ERC20 — byte-for-byte identical to LaunchToken
    // ═══════════════════════════════════════════════════════════════════════

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 current = allowance[from][msg.sender];
        if (current != type(uint256).max) {
            require(current >= amount, "allowance exceeded");
            unchecked { allowance[from][msg.sender] = current - amount; }
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(from != address(0) && to != address(0), "zero address");
        require(balanceOf[from] >= amount, "exceeds balance");
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
        return true;
    }
}
