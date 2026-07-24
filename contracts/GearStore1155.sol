// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GearStore1155 — basic battle-grid gear (open-mint, burn-on-loss)
///
/// An ERC-1155 store for BASIC, no-rarity gameplay gear (weapons/armor). Anyone
/// can buy any registered gear type for a fixed USDC price (open mint, no supply
/// cap). Gear is burned when a player loses it in battle.
///
/// ── IMPACT ROUTING (project rule) ──────────────────────────────────────────
/// Gear is GAMEPLAY, not cosmetic. Per the project's "cosmetics = the ONLY
/// operator revenue" rule, gameplay sales must fund impact — so `proceeds` MUST
/// be pointed at a trees / LP / endowment address at deploy, NEVER an
/// operator-profit wallet. It is a constructor param so it is fixed at deploy.
///
/// ── TRUST POINT: gameBurner ────────────────────────────────────────────────
/// `gameBurner` is a single-purpose role that can burn a player's gear via
/// burnForLoss() to enforce off-chain-resolved battle losses. This is an
/// AUTHORITY burn: for v1 we trust the game resolver to only burn genuinely-lost
/// gear. A future hardening is a battle-escrow / stake model where players stake
/// gear into a match and ONLY staked gear is loseable — removing the blanket
/// authority. Kept narrow and clearly-scoped on purpose.
///
/// ── STATS ARE OFF-CHAIN ─────────────────────────────────────────────────────
/// Stat bonuses (attack/defense/etc.) are OFF-CHAIN game config keyed by gear
/// id. We deliberately do NOT put combat stats on-chain in v1 — only id, price,
/// active, name, and metadata uri live here.

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPaymentToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract GearStore1155 is ERC1155, ERC1155Burnable, Ownable, ReentrancyGuard {

    // ── Config ────────────────────────────────────────────────────────────
    address public immutable paymentToken;  // USDC (6-dec) — sale currency
    address public immutable proceeds;       // impact sink (trees/LP/endowment)
    address public gameBurner;               // single-purpose battle-loss burner

    // ── Gear registry ─────────────────────────────────────────────────────
    struct Gear {
        uint256 price;     // in paymentToken units
        bool     active;   // can it be bought right now
        bool     exists;   // registered at all
        string   name;     // display name (basic; stats are off-chain)
    }
    mapping(uint256 => Gear) public gear;

    string private _baseURI;  // metadata base; per-id appended

    // ── Events ────────────────────────────────────────────────────────────
    event GearRegistered(uint256 indexed id, uint256 price, string name);
    event PriceSet(uint256 indexed id, uint256 price);
    event ActiveSet(uint256 indexed id, bool active);
    event GameBurnerSet(address indexed gameBurner);
    event BaseURISet(string baseURI);
    event GearBought(address indexed buyer, uint256 indexed id, uint256 amount, uint256 cost);
    event GearBurnedForLoss(address indexed account, uint256 indexed id, uint256 amount);

    modifier onlyGameBurner() {
        require(msg.sender == gameBurner && gameBurner != address(0), "not game burner");
        _;
    }

    constructor(
        address _paymentToken,
        address _proceeds,
        string memory baseURI_
    ) ERC1155(baseURI_) Ownable(msg.sender) {
        require(_paymentToken != address(0), "zero paymentToken");
        require(_proceeds != address(0), "zero proceeds");
        paymentToken = _paymentToken;
        proceeds = _proceeds;
        _baseURI = baseURI_;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin — gear registry
    // ═══════════════════════════════════════════════════════════════════════

    function registerGear(uint256 id, uint256 price, string calldata name) external onlyOwner {
        require(!gear[id].exists, "already registered");
        gear[id] = Gear({ price: price, active: true, exists: true, name: name });
        emit GearRegistered(id, price, name);
    }

    function setPrice(uint256 id, uint256 price) external onlyOwner {
        require(gear[id].exists, "not registered");
        gear[id].price = price;
        emit PriceSet(id, price);
    }

    function setActive(uint256 id, bool active) external onlyOwner {
        require(gear[id].exists, "not registered");
        gear[id].active = active;
        emit ActiveSet(id, active);
    }

    function setGameBurner(address _gameBurner) external onlyOwner {
        gameBurner = _gameBurner;
        emit GameBurnerSet(_gameBurner);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseURI = baseURI_;
        _setURI(baseURI_);
        emit BaseURISet(baseURI_);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Buy — open mint, exact USDC pull to proceeds (impact)
    // ═══════════════════════════════════════════════════════════════════════

    function buy(uint256 id, uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        Gear memory g = gear[id];
        require(g.exists, "not registered");
        require(g.active, "inactive");

        uint256 cost = g.price * amount;
        if (cost > 0) {
            // Exact amount → impact proceeds. Reverts on failure (no silent catch).
            require(
                IPaymentToken(paymentToken).transferFrom(msg.sender, proceeds, cost),
                "payment failed"
            );
        }

        _mint(msg.sender, id, amount, "");  // OPEN MINT — no supply cap
        emit GearBought(msg.sender, id, amount, cost);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Burn — holder burn (inherited) + battle-loss authority burn
    // ═══════════════════════════════════════════════════════════════════════

    // Standard holder/operator burn comes from ERC1155Burnable:
    //   burn(account, id, value) / burnBatch(account, ids, values)
    // (account must be msg.sender or have approved msg.sender as operator).

    /// @notice Burn gear a player LOST in an off-chain-resolved battle.
    ///         Single-purpose authority role — see TRUST POINT in the header.
    function burnForLoss(address account, uint256 id, uint256 amount) external onlyGameBurner {
        require(amount > 0, "zero amount");
        _burn(account, id, amount);  // OZ _burn checks the account's balance
        emit GearBurnedForLoss(account, id, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Metadata
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Per-id metadata = baseURI + decimal id. Stat bonuses live off-chain.
    function uri(uint256 id) public view override returns (string memory) {
        require(gear[id].exists, "not registered");
        return string.concat(_baseURI, _toString(id));
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 d; uint256 t = v;
        while (t != 0) { d++; t /= 10; }
        bytes memory b = new bytes(d);
        while (v != 0) { d--; b[d] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }
}
