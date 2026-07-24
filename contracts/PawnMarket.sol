// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PawnMarket — OPEN marketplace for ship crew NFTs (pawns).
///
/// Fully open + multi-seller + multi-ship: ANY captain lists pawns from ANY ship's
/// crew collection (its FeeShareDistributor) at their OWN price, and can undercut
/// anyone. No admin, no gatekeeper. Pawns stay in the seller's wallet until sold
/// (seller just sets approvalForAll once); buy() pulls the NFT seller→buyer and
/// sends the USDC straight to that seller.
///
/// Price 0 = a FREE pawn, capped at ONE per address PER SHIP — so the free seats
/// seed real players, not flippers, while a flood of free pawns across many idle
/// ships is harmless (an idle ship's pawn is worth ~nothing anyway; value tracks
/// the ship's haul).
///
/// Framing: pawns are GAME UNITS you buy to play (the 1% fee-share is an in-game
/// "cut of the haul"), not an investment product.

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PawnMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;   // payment token (6-dec)

    struct Listing { address seller; uint96 price; bool active; }   // price in USDC (6-dec) fits uint96
    // collection (ship crew distributor) => tokenId => listing
    mapping(address => mapping(uint256 => Listing)) public listings;
    // collection => buyer => has claimed a free pawn from this ship
    mapping(address => mapping(address => bool)) public claimedFree;

    event Listed(address indexed collection, uint256 indexed tokenId, address indexed seller, uint256 price);
    event Delisted(address indexed collection, uint256 indexed tokenId);
    event Sold(address indexed collection, uint256 indexed tokenId, address indexed buyer, address seller, uint256 price, bool free);

    constructor(address _usdc) { require(_usdc != address(0), "zero usdc"); usdc = IERC20(_usdc); }

    // ── list (any owner of the pawn; must have approved this market for the ship) ──
    function list(address collection, uint256 tokenId, uint96 price) public {
        require(IERC721(collection).ownerOf(tokenId) == msg.sender, "not your pawn");
        require(IERC721(collection).isApprovedForAll(msg.sender, address(this)), "approve market first");
        listings[collection][tokenId] = Listing(msg.sender, price, true);
        emit Listed(collection, tokenId, msg.sender, price);
    }
    function listMany(address collection, uint256[] calldata ids, uint96 price) external {
        for (uint256 i; i < ids.length; ++i) list(collection, ids[i], price);
    }
    function setPrice(address collection, uint256 tokenId, uint96 price) external {
        require(listings[collection][tokenId].seller == msg.sender, "not seller");
        listings[collection][tokenId].price = price;
        emit Listed(collection, tokenId, msg.sender, price);
    }
    function delist(address collection, uint256 tokenId) external {
        require(listings[collection][tokenId].seller == msg.sender, "not seller");
        listings[collection][tokenId].active = false;
        emit Delisted(collection, tokenId);
    }

    // ── buy / claim ───────────────────────────────────────────────────────────
    function buy(address collection, uint256 tokenId) external nonReentrant {
        Listing memory L = listings[collection][tokenId];
        require(L.active, "not for sale");
        require(IERC721(collection).ownerOf(tokenId) == L.seller, "seller moved it");

        if (L.price == 0) {
            require(!claimedFree[collection][msg.sender], "already claimed a free pawn from this ship");
            claimedFree[collection][msg.sender] = true;
        } else {
            usdc.safeTransferFrom(msg.sender, L.seller, L.price);   // proceeds → that captain
        }

        listings[collection][tokenId].active = false;
        IERC721(collection).safeTransferFrom(L.seller, msg.sender, tokenId);
        emit Sold(collection, tokenId, msg.sender, L.seller, L.price, L.price == 0);
    }

    // ── view: which of these ids are buyable right now (for the storefront) ──────
    function availability(address collection, uint256[] calldata ids)
        external view returns (bool[] memory ok, uint256[] memory prices)
    {
        ok = new bool[](ids.length);
        prices = new uint256[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            Listing memory L = listings[collection][ids[i]];
            ok[i] = L.active && IERC721(collection).ownerOf(ids[i]) == L.seller;
            prices[i] = L.price;
        }
    }
}
