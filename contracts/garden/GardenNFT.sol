// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * GardenNFT — Tradable yield-bearing garden NFTs
 *
 * Types:
 *   0 = Flower Pot  (1 plant)  — free with each house
 *   1 = Small Plot  (4 plants) — comes with certain houses
 *   2 = Large Plot  (9 plants) — comes with premium houses
 *
 * Each plant grows one asset type (WETH, BTC, AZUSD, more later).
 * Player deposits POOP into plants → POOP/asset LP → asset rewards.
 *
 * Gardens are per-player, not per-baseling.
 * If sold, seller auto-gets a new free flower pot.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

// ═══════════════════════════════════════════════════════════════════════════

contract GardenNFT {

    // --- ERC721 Core ---
    string public constant name = "Baseling Garden";
    string public constant symbol = "GARDEN";

    uint256 public totalMinted;
    address public owner;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    // --- Garden Types ---
    uint8 constant POT        = 0;  // 1 plant
    uint8 constant SMALL_PLOT = 1;  // 4 plants
    uint8 constant LARGE_PLOT = 2;  // 9 plants

    uint8[3] public plantsPerType = [1, 4, 9];

    struct Garden {
        uint8  gardenType;     // POT, SMALL_PLOT, LARGE_PLOT
        uint64 mintTime;
    }
    mapping(uint256 => Garden) public gardens;

    // --- Plants (per garden, per slot) ---
    struct Plant {
        address targetAsset;   // what this plant grows (WETH, BTC, AZUSD addr)
        uint256 poopDeposited; // POOP deposited into this plant
        uint256 yieldAccum;    // accumulated yield (target asset)
    }
    // gardenId => plantIndex => Plant
    mapping(uint256 => mapping(uint8 => Plant)) public plants;

    // --- POOP Token ---
    address public poopToken;

    // Accepted target assets for plants
    mapping(address => bool) public acceptedAsset;
    address[] public assetList;

    // Authorized minters (game contract for house purchases)
    mapping(address => bool) public authorized;

    // --- Events ---
    event GardenMinted(uint256 indexed tokenId, address indexed to, uint8 gardenType);
    event PlantConfigured(uint256 indexed gardenId, uint8 plantIndex, address targetAsset);
    event PoopDeposited(uint256 indexed gardenId, uint8 plantIndex, uint256 amount);
    event PoopWithdrawn(uint256 indexed gardenId, uint8 plantIndex, uint256 amount);
    event YieldHarvested(uint256 indexed gardenId, uint8 plantIndex, uint256 amount);
    event ReplacementPotMinted(uint256 indexed newTokenId, address indexed to);

    // --- Modifiers ---
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyAuthorized() { require(authorized[msg.sender] || msg.sender == owner, "not authorized"); _; }
    modifier onlyGardenOwner(uint256 gardenId) { require(ownerOf[gardenId] == msg.sender, "not garden owner"); _; }

    // ═══════════════════════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(address _poopToken) {
        owner = msg.sender;
        poopToken = _poopToken;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ERC721
    // ═══════════════════════════════════════════════════════════════════════

    function approve(address to, uint256 tokenId) external {
        address tokenOwner = ownerOf[tokenId];
        require(msg.sender == tokenOwner || isApprovedForAll[tokenOwner][msg.sender], "not authorized");
        getApproved[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(from == ownerOf[tokenId], "not owner");
        require(
            msg.sender == from ||
            msg.sender == getApproved[tokenId] ||
            isApprovedForAll[from][msg.sender],
            "not authorized"
        );
        require(to != address(0), "zero address");

        getApproved[tokenId] = address(0);
        balanceOf[from]--;
        balanceOf[to]++;
        ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);

        // Auto-mint replacement pot for seller (they still own a house)
        _mintPot(from);
        emit ReplacementPotMinted(totalMinted, from);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length > 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) == IERC721Receiver.onERC721Received.selector,
                "unsafe recipient"
            );
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x80ac58cd || interfaceId == 0x01ffc9a7 || interfaceId == 0x5b5e139f;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Mint Gardens — called by game/house purchase system
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Mint a flower pot (1 plant) — free with house purchase
    function mintPot(address to) external onlyAuthorized returns (uint256) {
        return _mintPot(to);
    }

    /// @notice Mint a small plot (4 plants) — comes with certain houses
    function mintSmallPlot(address to) external onlyAuthorized returns (uint256) {
        return _mintGarden(to, SMALL_PLOT);
    }

    /// @notice Mint a large plot (9 plants) — comes with premium houses
    function mintLargePlot(address to) external onlyAuthorized returns (uint256) {
        return _mintGarden(to, LARGE_PLOT);
    }

    function _mintPot(address to) internal returns (uint256) {
        return _mintGarden(to, POT);
    }

    function _mintGarden(address to, uint8 gardenType) internal returns (uint256 tokenId) {
        tokenId = ++totalMinted;
        ownerOf[tokenId] = to;
        balanceOf[to]++;
        gardens[tokenId] = Garden({
            gardenType: gardenType,
            mintTime: uint64(block.timestamp)
        });
        emit Transfer(address(0), to, tokenId);
        emit GardenMinted(tokenId, to, gardenType);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Plant Management
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Configure a plant slot to grow a specific asset
    function configurePlant(uint256 gardenId, uint8 plantIndex, address targetAsset) external onlyGardenOwner(gardenId) {
        require(plantIndex < plantsPerType[gardens[gardenId].gardenType], "invalid plant slot");
        require(acceptedAsset[targetAsset], "asset not accepted");
        Plant storage p = plants[gardenId][plantIndex];
        require(p.poopDeposited == 0, "withdraw poop first");
        p.targetAsset = targetAsset;
        emit PlantConfigured(gardenId, plantIndex, targetAsset);
    }

    /// @notice Deposit POOP into a plant
    function depositPoop(uint256 gardenId, uint8 plantIndex, uint256 amount) external onlyGardenOwner(gardenId) {
        require(amount > 0, "zero");
        Plant storage p = plants[gardenId][plantIndex];
        require(p.targetAsset != address(0), "plant not configured");
        require(plantIndex < plantsPerType[gardens[gardenId].gardenType], "invalid slot");

        IERC20(poopToken).transferFrom(msg.sender, address(this), amount);
        p.poopDeposited += amount;

        emit PoopDeposited(gardenId, plantIndex, amount);
    }

    /// @notice Withdraw POOP from a plant (pull back unswapped POOP)
    function withdrawPoop(uint256 gardenId, uint8 plantIndex, uint256 amount) external onlyGardenOwner(gardenId) {
        require(amount > 0, "zero");
        Plant storage p = plants[gardenId][plantIndex];
        require(p.poopDeposited >= amount, "insufficient");

        p.poopDeposited -= amount;
        IERC20(poopToken).transfer(msg.sender, amount);

        emit PoopWithdrawn(gardenId, plantIndex, amount);
    }

    /// @notice Harvest yield from a plant (keeper deposits yield, player harvests)
    function harvest(uint256 gardenId, uint8 plantIndex) external onlyGardenOwner(gardenId) {
        Plant storage p = plants[gardenId][plantIndex];
        uint256 yield = p.yieldAccum;
        require(yield > 0, "no yield");

        p.yieldAccum = 0;
        IERC20(p.targetAsset).transfer(msg.sender, yield);

        emit YieldHarvested(gardenId, plantIndex, yield);
    }

    /// @notice Keeper deposits yield for a plant (from LP fee processing)
    function addYield(uint256 gardenId, uint8 plantIndex, uint256 amount) external onlyAuthorized {
        Plant storage p = plants[gardenId][plantIndex];
        require(p.targetAsset != address(0), "not configured");
        IERC20(p.targetAsset).transferFrom(msg.sender, address(this), amount);
        p.yieldAccum += amount;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Views
    // ═══════════════════════════════════════════════════════════════════════

    function maxPlants(uint256 gardenId) external view returns (uint8) {
        return plantsPerType[gardens[gardenId].gardenType];
    }

    function gardenType(uint256 gardenId) external view returns (uint8) {
        return gardens[gardenId].gardenType;
    }

    function totalPoopInGarden(uint256 gardenId) external view returns (uint256 total) {
        uint8 max = plantsPerType[gardens[gardenId].gardenType];
        for (uint8 i = 0; i < max; i++) {
            total += plants[gardenId][i].poopDeposited;
        }
    }

    function totalYieldInGarden(uint256 gardenId) external view returns (uint256 total) {
        uint8 max = plantsPerType[gardens[gardenId].gardenType];
        for (uint8 i = 0; i < max; i++) {
            total += plants[gardenId][i].yieldAccum;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Admin
    // ═══════════════════════════════════════════════════════════════════════

    function addAcceptedAsset(address asset) external onlyOwner {
        require(!acceptedAsset[asset], "exists");
        acceptedAsset[asset] = true;
        assetList.push(asset);
    }

    function setPoopToken(address _poop) external onlyOwner { poopToken = _poop; }
    function setAuthorized(address account, bool status) external onlyOwner { authorized[account] = status; }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        owner = newOwner;
    }
}
