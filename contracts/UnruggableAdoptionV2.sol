// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UnruggableAdoptionV2 — Make any token unruggable with instant liquidity
///
/// Adopter provides USDC + some of their token. One transaction:
///   1. adopt(token, upstream, usdcAmount, tokenAmount)
///   2. 90% USDC → swap to MfT → MfT/Token LP → locked in TOKEN REACTOR
///   3. 10% USDC → swap to CHAR → CHAR/Token LP → locked in CHAR REACTOR
///   4. Chain: token reactor → CHAR reactor → upstream invite ref
///
/// Adopter supplies their own token for the LP pairing side.
/// Two reactors per adoption. MfT is root in every token reactor.
/// CHAR tracks carbon impact in every CHAR reactor.
/// Team seeds CHAR/MfT into CHAR reactors separately.
///
/// No withdraw function on either reactor. Pools are permanent.

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
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
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }
    function mint(MintParams calldata) external payable returns (
        uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1
    );
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata) external returns (uint256 amountOut);
}

interface IUniswapV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
}

contract UnruggableAdoptionV2 {

    // ═══════════════════════════════════════════════════════════════════════
    //  State
    // ═══════════════════════════════════════════════════════════════════════

    address public immutable reactorImpl;     // SporeReactorV4 implementation
    address public immutable usdc;
    address public immutable mft;
    address public immutable char;
    address public immutable positionManager; // NonfungiblePositionManager
    address public immutable swapRouter;      // SwapRouter02
    address public immutable v3Factory;       // Uniswap V3 Factory
    address public immutable defaultUpstream; // Default upstream if no invite ref
    address public owner;

    uint256 public constant MIN_ADOPTION = 5_000_000;  // $5 USDC minimum (6 decimals)
    uint24  public constant FEE_TIER     = 10000;       // 1% fee tier for all pools
    int24   public constant TICK_MIN     = -887200;
    int24   public constant TICK_MAX     =  887200;

    // Swap routes: USDC → MfT and USDC → CHAR fee tiers
    uint24 public immutable mftSwapFee;
    uint24 public immutable charSwapFee;

    uint256 public adoptionCount;

    mapping(address => address) public reactorOf;      // token => token reactor
    mapping(address => address) public charReactorOf;   // token => CHAR reactor
    mapping(address => address) public adopterOf;       // token => adopter

    event TokenAdopted(
        address indexed token,
        address indexed reactor,
        address indexed charReactor,
        address adopter,
        address upstreamReactor,
        uint256 usdcAmount,
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
        address _char,
        address _positionManager,
        address _swapRouter,
        address _v3Factory,
        address _defaultUpstream,
        uint24  _mftSwapFee,
        uint24  _charSwapFee
    ) {
        reactorImpl      = _reactorImpl;
        usdc             = _usdc;
        mft              = _mft;
        char             = _char;
        positionManager  = _positionManager;
        swapRouter       = _swapRouter;
        v3Factory        = _v3Factory;
        defaultUpstream  = _defaultUpstream;
        mftSwapFee       = _mftSwapFee;
        charSwapFee      = _charSwapFee;
        owner            = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Adopt — make any token unruggable with instant MfT + CHAR liquidity
    // ═══════════════════════════════════════════════════════════════════════

    /// @param token The ERC-20 token to adopt
    /// @param upstreamReactor Invite ref reactor (or address(0) for default)
    /// @param usdcAmount USDC to spend (minimum $5, 6 decimals)
    /// @param tokenAmount Amount of the adopted token to pair (must be > 0)
    function adopt(
        address token,
        address upstreamReactor,
        uint256 usdcAmount,
        uint256 tokenAmount
    ) external returns (address reactor, address charReactor) {
        require(token != address(0), "zero token");
        require(token != mft, "cannot adopt MfT");
        require(token != usdc, "cannot adopt USDC");
        require(token != char, "cannot adopt CHAR");
        require(usdcAmount >= MIN_ADOPTION, "min $5");
        require(tokenAmount > 0, "need tokens to pair");
        require(reactorOf[token] == address(0), "already adopted");

        // Pull USDC and adopted token from caller
        IERC20(usdc).transferFrom(msg.sender, address(this), usdcAmount);
        IERC20(token).transferFrom(msg.sender, address(this), tokenAmount);

        // Resolve upstream
        address upstream = upstreamReactor != address(0)
            ? upstreamReactor
            : defaultUpstream;

        // Split USDC: 90% token reactor, 10% CHAR reactor
        uint256 charUsdc = usdcAmount / 10;
        uint256 tokenUsdc = usdcAmount - charUsdc;

        // Split adopted token proportionally: 90% for MfT pool, 10% for CHAR pool
        uint256 charTokens = tokenAmount / 10;
        uint256 mftTokens = tokenAmount - charTokens;

        // ── Clone BOTH reactors first (need addresses before initialize) ──
        charReactor = _cloneReactor();
        reactor = _cloneReactor();

        // ── Initialize CHAR reactor first (with invite upstream) ──────────
        IReactor(charReactor).initialize(
            char, mft, positionManager, swapRouter, v3Factory, upstream
        );

        // ── Initialize token reactor (upstream → CHAR reactor) ────────────
        IReactor(reactor).initialize(
            token, mft, positionManager, swapRouter, v3Factory, charReactor
        );

        // ── TOKEN REACTOR: swap 90% USDC → MfT, create MfT/Token LP ──────
        uint256 mftAmount = _swapExact(usdc, mft, mftSwapFee, tokenUsdc);
        uint256 mftPoolId = _createPool(mft, token, mftAmount, mftTokens);
        _depositPool(mftPoolId, reactor);

        // ── CHAR REACTOR: swap 10% USDC → CHAR, create CHAR/Token LP ─────
        uint256 charAmount = _swapExact(usdc, char, charSwapFee, charUsdc);
        uint256 charPoolId = _createPool(char, token, charAmount, charTokens);
        _depositPool(charPoolId, charReactor);

        // ── Refund dust ───────────────────────────────────────────────────
        _refundDust(token, msg.sender);

        // Record
        reactorOf[token] = reactor;
        charReactorOf[token] = charReactor;
        adopterOf[token] = msg.sender;
        adoptionCount++;

        // Emit
        string memory tokenName = "";
        string memory tokenSymbol = "";
        try IERC20(token).name() returns (string memory n) { tokenName = n; } catch {}
        try IERC20(token).symbol() returns (string memory s) { tokenSymbol = s; } catch {}

        emit TokenAdopted(token, reactor, charReactor, msg.sender, upstream, usdcAmount, tokenName, tokenSymbol);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Pool Management — adopter functions
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit an LP NFT already owned by this contract into token reactor
    function depositPool(address token, uint256 tokenId) external {
        require(msg.sender == adopterOf[token], "not adopter");
        address reactor = reactorOf[token];
        require(reactor != address(0), "not adopted");
        require(INPM(positionManager).ownerOf(tokenId) == address(this), "NFT not here");
        INPM(positionManager).safeTransferFrom(address(this), reactor, tokenId);
        IReactor(reactor).addPool(tokenId);
    }

    /// @notice Deposit into CHAR reactor specifically
    function depositCharPool(address token, uint256 tokenId) external {
        require(msg.sender == adopterOf[token], "not adopter");
        address cr = charReactorOf[token];
        require(cr != address(0), "no char reactor");
        require(INPM(positionManager).ownerOf(tokenId) == address(this), "NFT not here");
        INPM(positionManager).safeTransferFrom(address(this), cr, tokenId);
        IReactor(cr).addPool(tokenId);
    }

    /// @notice Pull LP NFT from adopter and deposit+register in token reactor
    function forwardAndRegister(address token, uint256 tokenId) external {
        require(msg.sender == adopterOf[token], "not adopter");
        address reactor = reactorOf[token];
        require(reactor != address(0), "not adopted");
        INPM(positionManager).transferFrom(msg.sender, address(this), tokenId);
        INPM(positionManager).safeTransferFrom(address(this), reactor, tokenId);
        IReactor(reactor).addPool(tokenId);
    }

    /// @notice Transfer token reactor admin to adopter
    function releaseAdmin(address token) external {
        require(msg.sender == adopterOf[token], "not adopter");
        IReactor(reactorOf[token]).transferAdmin(msg.sender);
    }

    /// @notice Transfer CHAR reactor admin to adopter
    function releaseCharAdmin(address token) external {
        require(msg.sender == adopterOf[token], "not adopter");
        IReactor(charReactorOf[token]).transferAdmin(msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Swap + Pool Creation
    // ═══════════════════════════════════════════════════════════════════════

    function _swapExact(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).approve(swapRouter, amountIn);
        amountOut = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @dev Create a V3 pool position. Both amounts must be > 0 (two-sided LP).
    function _createPool(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) internal returns (uint256 positionId) {
        require(amountA > 0 && amountB > 0, "need both sides");

        bool aIs0 = tokenA < tokenB;
        address token0 = aIs0 ? tokenA : tokenB;
        address token1 = aIs0 ? tokenB : tokenA;
        uint256 t0 = aIs0 ? amountA : amountB;
        uint256 t1 = aIs0 ? amountB : amountA;

        // Create pool if it doesn't exist
        address pool = IUniswapV3Factory(v3Factory).getPool(token0, token1, FEE_TIER);
        if (pool == address(0)) {
            pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
            IUniswapV3Pool(pool).initialize(_calcSqrtPrice(t0, t1));
        }

        IERC20(token0).approve(positionManager, t0);
        IERC20(token1).approve(positionManager, t1);

        (positionId,,,) = INPM(positionManager).mint(
            INPM.MintParams({
                token0: token0,
                token1: token1,
                fee: FEE_TIER,
                tickLower: TICK_MIN,
                tickUpper: TICK_MAX,
                amount0Desired: t0,
                amount1Desired: t1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
    }

    function _depositPool(uint256 tokenId, address reactor) internal {
        INPM(positionManager).safeTransferFrom(address(this), reactor, tokenId);
        IReactor(reactor).addPool(tokenId);
    }

    /// @dev Return any leftover tokens to the adopter after LP creation
    function _refundDust(address token, address to) internal {
        uint256 bal;
        bal = IERC20(usdc).balanceOf(address(this));
        if (bal > 0) IERC20(usdc).transferFrom(address(this), to, bal);
        bal = IERC20(mft).balanceOf(address(this));
        if (bal > 0) IERC20(mft).transferFrom(address(this), to, bal);
        bal = IERC20(char).balanceOf(address(this));
        if (bal > 0) IERC20(char).transferFrom(address(this), to, bal);
        bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).transferFrom(address(this), to, bal);
    }

    function _cloneReactor() internal returns (address instance) {
        address impl = reactorImpl;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(96, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "clone failed");
    }

    function _calcSqrtPrice(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0);
        uint256 s1 = _sqrt(amount1);
        uint256 s0 = _sqrt(amount0);
        uint256 result = (s1 << 96) / s0;
        require(result > 0 && result <= type(uint160).max);
        return uint160(result);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════════════════════════════════

    function isAdopted(address token) external view returns (bool) {
        return reactorOf[token] != address(0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ERC721 Receiver
    // ═══════════════════════════════════════════════════════════════════════

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Owner — rescue + admin
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Rescue accidentally sent ERC-20 tokens (cannot touch reactor LP NFTs)
    function rescue(address tokenAddr, address to, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        IERC20(tokenAddr).transferFrom(address(this), to, amount);
    }

    function setOwner(address newOwner) external {
        require(msg.sender == owner, "not owner");
        require(newOwner != address(0), "zero owner");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }
}
