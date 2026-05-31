// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UnruggableAdoptionV3 — USDC-only adoption, multi-hop routing
///
/// Anyone pays USDC to create a reactor for any token. No token supply needed.
///   1. adopt(token, upstream, usdcAmount, tokenWethFee)
///   2. 90% USDC → split → buy MfT (USDC→WETH→MfT) + buy Token (USDC→WETH→Token) → MfT/Token LP → TOKEN REACTOR
///   3. 10% USDC → split → buy CHAR (USDC→CHAR) + buy Token (USDC→WETH→Token) → CHAR/Token LP → CHAR REACTOR
///   4. Chain: token reactor → CHAR reactor → upstream invite ref
///
/// Multiple reactors per token allowed. Slippage may apply.
/// No withdraw function on either reactor. Pools are permanent.

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
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

    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata) external returns (uint256 amountOut);
}

interface IUniswapV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
}

contract UnruggableAdoptionV3 {

    // ═══════════════════════════════════════════════════════════════════════
    //  State
    // ═══════════════════════════════════════════════════════════════════════

    address public immutable reactorImpl;
    address public immutable usdc;
    address public immutable weth;
    address public immutable mft;
    address public immutable char;
    address public immutable positionManager;
    address public immutable swapRouter;
    address public immutable v3Factory;
    address public immutable defaultUpstream;
    address public owner;

    uint256 public constant MIN_ADOPTION = 5_000_000;  // $5 USDC (6 decimals)
    uint24  public constant POOL_FEE     = 10000;       // 1% fee tier for created LPs
    int24   public constant TICK_MIN     = -887200;
    int24   public constant TICK_MAX     =  887200;

    // Known swap route fees
    uint24 public immutable usdcWethFee;   // USDC → WETH leg
    uint24 public immutable wethMftFee;    // WETH → MfT leg
    uint24 public immutable usdcCharFee;   // USDC → CHAR (direct)

    uint256 public adoptionCount;

    // Multiple reactors per token
    mapping(address => address[]) internal _reactors;
    mapping(address => address[]) internal _charReactors;

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
        address _weth,
        address _mft,
        address _char,
        address _positionManager,
        address _swapRouter,
        address _v3Factory,
        address _defaultUpstream,
        uint24  _usdcWethFee,
        uint24  _wethMftFee,
        uint24  _usdcCharFee
    ) {
        reactorImpl      = _reactorImpl;
        usdc             = _usdc;
        weth             = _weth;
        mft              = _mft;
        char             = _char;
        positionManager  = _positionManager;
        swapRouter       = _swapRouter;
        v3Factory        = _v3Factory;
        defaultUpstream  = _defaultUpstream;
        usdcWethFee      = _usdcWethFee;
        wethMftFee       = _wethMftFee;
        usdcCharFee      = _usdcCharFee;
        owner            = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Adopt — USDC-only, buys both sides of LP via multi-hop
    // ═══════════════════════════════════════════════════════════════════════

    /// @param token The ERC-20 token to adopt
    /// @param upstreamReactor Invite ref reactor (or address(0) for default)
    /// @param usdcAmount USDC to spend (minimum $5, 6 decimals)
    /// @param tokenWethFee Fee tier for the token's WETH pool (e.g. 10000, 3000)
    function adopt(
        address token,
        address upstreamReactor,
        uint256 usdcAmount,
        uint24  tokenWethFee
    ) external returns (address reactor, address charReactor) {
        require(token != address(0), "zero token");
        require(token != mft && token != usdc && token != char && token != weth, "reserved token");
        require(usdcAmount >= MIN_ADOPTION, "min $5");
        require(tokenWethFee > 0, "need fee tier");

        IERC20(usdc).transferFrom(msg.sender, address(this), usdcAmount);

        address upstream = upstreamReactor != address(0) ? upstreamReactor : defaultUpstream;

        // Clone and initialize both reactors
        charReactor = _cloneReactor();
        reactor = _cloneReactor();
        IReactor(charReactor).initialize(char, mft, positionManager, swapRouter, v3Factory, upstream);
        IReactor(reactor).initialize(token, mft, positionManager, swapRouter, v3Factory, charReactor);

        // Build LPs and deposit
        uint256 charUsdc = usdcAmount / 10;
        _buildTokenReactorLP(token, tokenWethFee, usdcAmount - charUsdc, reactor);
        _buildCharReactorLP(token, tokenWethFee, charUsdc, charReactor);

        _refundDust(token, msg.sender);

        // Record
        _reactors[token].push(reactor);
        _charReactors[token].push(charReactor);
        adoptionCount++;

        _emitAdopted(token, reactor, charReactor, upstream, usdcAmount);
    }

    function _buildTokenReactorLP(address token, uint24 tokenWethFee, uint256 budget, address reactor) internal {
        uint256 half = budget / 2;
        uint256 mftAmt = _swapMultihop(usdc, usdcWethFee, weth, wethMftFee, mft, half);
        uint256 tkAmt  = _swapMultihop(usdc, usdcWethFee, weth, tokenWethFee, token, budget - half);
        uint256 pid = _createPool(mft, token, mftAmt, tkAmt);
        _depositPool(pid, reactor);
    }

    function _buildCharReactorLP(address token, uint24 tokenWethFee, uint256 budget, address reactor) internal {
        uint256 half = budget / 2;
        uint256 charAmt = _swapDirect(usdc, char, usdcCharFee, half);
        uint256 tkAmt   = _swapMultihop(usdc, usdcWethFee, weth, tokenWethFee, token, budget - half);
        uint256 pid = _createPool(char, token, charAmt, tkAmt);
        _depositPool(pid, reactor);
    }

    function _emitAdopted(address token, address reactor, address charReactor, address upstream, uint256 usdcAmount) internal {
        string memory tokenName = "";
        string memory tokenSymbol = "";
        try IERC20(token).name() returns (string memory n) { tokenName = n; } catch {}
        try IERC20(token).symbol() returns (string memory s) { tokenSymbol = s; } catch {}
        emit TokenAdopted(token, reactor, charReactor, msg.sender, upstream, usdcAmount, tokenName, tokenSymbol);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Swaps
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Multi-hop: tokenIn → tokenMid → tokenOut
    function _swapMultihop(
        address tokenIn,  uint24 fee1,
        address tokenMid, uint24 fee2,
        address tokenOut, uint256 amountIn
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).approve(swapRouter, amountIn);
        bytes memory path = abi.encodePacked(tokenIn, fee1, tokenMid, fee2, tokenOut);
        amountOut = ISwapRouter02(swapRouter).exactInput(
            ISwapRouter02.ExactInputParams({
                path: path,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0
            })
        );
    }

    /// @dev Single-hop direct swap
    function _swapDirect(
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

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Pool Creation
    // ═══════════════════════════════════════════════════════════════════════

    function _createPool(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) internal returns (uint256 positionId) {
        require(amountA > 0 && amountB > 0, "swap returned 0");

        bool aIs0 = tokenA < tokenB;
        address token0 = aIs0 ? tokenA : tokenB;
        address token1 = aIs0 ? tokenB : tokenA;
        uint256 t0 = aIs0 ? amountA : amountB;
        uint256 t1 = aIs0 ? amountB : amountA;

        // Create pool if it doesn't exist
        address pool = IUniswapV3Factory(v3Factory).getPool(token0, token1, POOL_FEE);
        if (pool == address(0)) {
            pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, POOL_FEE);
            IUniswapV3Pool(pool).initialize(_calcSqrtPrice(t0, t1));
        }

        IERC20(token0).approve(positionManager, t0);
        IERC20(token1).approve(positionManager, t1);

        (positionId,,,) = INPM(positionManager).mint(
            INPM.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
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

    function _refundDust(address token, address to) internal {
        uint256 bal;
        bal = IERC20(usdc).balanceOf(address(this));
        if (bal > 0) IERC20(usdc).transfer(to, bal);
        bal = IERC20(mft).balanceOf(address(this));
        if (bal > 0) IERC20(mft).transfer(to, bal);
        bal = IERC20(char).balanceOf(address(this));
        if (bal > 0) IERC20(char).transfer(to, bal);
        bal = IERC20(weth).balanceOf(address(this));
        if (bal > 0) IERC20(weth).transfer(to, bal);
        bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).transfer(to, bal);
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

    function reactorsOf(address token) external view returns (address[] memory) {
        return _reactors[token];
    }

    function charReactorsOf(address token) external view returns (address[] memory) {
        return _charReactors[token];
    }

    function reactorCount(address token) external view returns (uint256) {
        return _reactors[token].length;
    }

    function isAdopted(address token) external view returns (bool) {
        return _reactors[token].length > 0;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ERC721 Receiver
    // ═══════════════════════════════════════════════════════════════════════

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Owner
    // ═══════════════════════════════════════════════════════════════════════

    function rescue(address tokenAddr, address to, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        IERC20(tokenAddr).transfer(to, amount);
    }

    function setOwner(address newOwner) external {
        require(msg.sender == owner, "not owner");
        require(newOwner != address(0), "zero owner");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }
}
