// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UnruggableAdoption — Make any token unruggable
///
/// Clones a SporeReactorV4 for any existing token. The reactor has no
/// withdraw function — LP positions locked forever once added.
///
/// Flow:
///   1. User calls adopt(token, upstreamReactor) with $5 USDC
///   2. Contract clones SporeReactorV4 implementation
///   3. Initializes the reactor for that token
///   4. Contract stays as reactor admin (proxies pool management for adopter)
///   5. Invite chain: upstream reactor receives 5% of fees on every fire
///
/// Adding pools after adoption:
///   Option A (Card Shop): WildcardManager sends NFT HERE, then adopter calls depositPool()
///   Option B (Manual): Adopter approves NFT, calls forwardAndRegister() in one call
///
/// The reactor has no withdraw function. Pools are permanent once registered.

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

interface IReactor {
    function initialize(
        address _token,
        address _mft,
        address _pm,
        address _router,
        address _factory,
        address _upstreamReactor
    ) external;
    function addPool(uint256 tokenId) external;
    function transferAdmin(address newAdmin) external;
}

interface INPM {
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract UnruggableAdoption {

    // ═══════════════════════════════════════════════════════════════════════
    //  State
    // ═══════════════════════════════════════════════════════════════════════

    address public immutable reactorImpl;     // SporeReactorV4 implementation
    address public immutable usdc;
    address public immutable mft;
    address public immutable weth;
    address public immutable pm;              // NonfungiblePositionManager
    address public immutable router;          // SwapRouter02
    address public immutable v3Factory;       // Uniswap V3 Factory
    address public immutable defaultUpstream; // Default upstream if no invite ref
    address public owner;

    uint256 public constant ADOPTION_FEE = 5_000_000; // $5 USDC (6 decimals)
    uint256 public adoptionCount;

    mapping(address => address) public reactorOf;   // token => reactor
    mapping(address => address) public adopterOf;   // token => adopter (who can manage)

    event TokenAdopted(
        address indexed token,
        address indexed reactor,
        address indexed adopter,
        address upstreamReactor,
        string name,
        string symbol
    );

    event OwnerTransferred(address indexed oldOwner, address indexed newOwner);

    // ═══════════════════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _reactorImpl,
        address _usdc,
        address _mft,
        address _weth,
        address _pm,
        address _router,
        address _v3Factory,
        address _defaultUpstream
    ) {
        reactorImpl      = _reactorImpl;
        usdc             = _usdc;
        mft              = _mft;
        weth             = _weth;
        pm               = _pm;
        router           = _router;
        v3Factory        = _v3Factory;
        defaultUpstream  = _defaultUpstream;
        owner            = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Adopt — make any token unruggable
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Clone a reactor for an existing token
    /// @param token The ERC-20 token to adopt
    /// @param upstreamReactor Invite ref reactor (or address(0) for default)
    function adopt(
        address token,
        address upstreamReactor
    ) external returns (address reactor) {
        require(token != address(0), "zero token");
        require(token != mft, "cannot adopt MfT");
        require(token != usdc, "cannot adopt USDC");
        require(token != weth, "cannot adopt WETH");
        require(reactorOf[token] == address(0), "already adopted");

        // Verify token exists as a contract
        IERC20(token).balanceOf(address(this));

        // Pull adoption fee — goes directly to owner
        IERC20(usdc).transferFrom(msg.sender, owner, ADOPTION_FEE);

        // Resolve upstream
        address upstream = upstreamReactor != address(0)
            ? upstreamReactor
            : defaultUpstream;

        // Clone reactor (EIP-1167 minimal proxy)
        reactor = _clone(reactorImpl);

        // Initialize — this contract becomes admin
        IReactor(reactor).initialize(
            token, mft, pm, router, v3Factory, upstream
        );

        // Record
        reactorOf[token] = reactor;
        adopterOf[token] = msg.sender;
        adoptionCount++;

        // Emit with token info (best effort)
        string memory tokenName = "";
        string memory tokenSymbol = "";
        try IERC20(token).name() returns (string memory n) { tokenName = n; } catch {}
        try IERC20(token).symbol() returns (string memory s) { tokenSymbol = s; } catch {}

        emit TokenAdopted(token, reactor, msg.sender, upstream, tokenName, tokenSymbol);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Pool Management — adopter functions
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit an LP NFT that is already owned by this contract into the reactor
    /// @dev Use when WildcardManager sends NFT here (Card Shop flow with reactor=this)
    function depositPool(address token, uint256 tokenId) external {
        require(msg.sender == adopterOf[token], "not adopter");
        address reactor = reactorOf[token];
        require(reactor != address(0), "not adopted");
        require(INPM(pm).ownerOf(tokenId) == address(this), "NFT not here");
        // Forward NFT to reactor (from = this = admin, passes onERC721Received check)
        INPM(pm).safeTransferFrom(address(this), reactor, tokenId);
        // Register pool
        IReactor(reactor).addPool(tokenId);
    }

    /// @notice Pull an LP NFT from adopter and deposit+register in one call
    /// @dev Use for manually created LP positions. Adopter must approve this contract first.
    function forwardAndRegister(address token, uint256 tokenId) external {
        require(msg.sender == adopterOf[token], "not adopter");
        address reactor = reactorOf[token];
        require(reactor != address(0), "not adopted");
        // Pull NFT from adopter
        INPM(pm).transferFrom(msg.sender, address(this), tokenId);
        // Forward to reactor (from = this = admin)
        INPM(pm).safeTransferFrom(address(this), reactor, tokenId);
        // Register pool
        IReactor(reactor).addPool(tokenId);
    }

    /// @notice Transfer reactor admin to adopter (two-step: adopter calls acceptAdmin on reactor)
    function releaseAdmin(address token) external {
        require(msg.sender == adopterOf[token], "not adopter");
        IReactor(reactorOf[token]).transferAdmin(msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ERC721 Receiver — accepts NFTs from WildcardManager / manual sends
    // ═══════════════════════════════════════════════════════════════════════

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════════════════════════════════

    function isAdopted(address token) external view returns (bool) {
        return reactorOf[token] != address(0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  EIP-1167 Minimal Proxy Clone
    // ═══════════════════════════════════════════════════════════════════════

    function _clone(address impl) internal returns (address instance) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(96, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "clone failed");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Owner
    // ═══════════════════════════════════════════════════════════════════════

    function setOwner(address newOwner) external {
        require(msg.sender == owner, "not owner");
        require(newOwner != address(0), "zero owner");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }
}
