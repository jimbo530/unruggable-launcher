// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Unrugable V9 — Free Launch, 2 Pools, 1 Reactor, USDC Fee-Share NFTs
///
/// Clone of V8 wired to SporeReactorV6. At launch it deploys a FeeShareDistributor
/// whose PAYOUT TOKEN IS USDC (100 NFTs, all minted to the launcher), and wires
/// the V6 reactor (which burns 100% of the launched token, redeems Money fees to
/// USDC, and funds the distributor in USDC).
///
/// Everything else is identical to V8/V7:
///   - 1,000,000,000 fixed supply, $10,000 market cap
///   - 70% supply → TOKEN/Money sell wall, 30% → TOKEN/Meme sell wall
///   - 1 reactor managing both positions, Money LP registered for yield
///   - No seed required, dust refunded
///
/// IMPORTANT: reactorImpl passed to this factory MUST be a SporeReactorV6 impl
/// (extended initialize with money+usdc, setDistributor). NEW LAUNCHES ONLY —
/// does not touch V8/V7/V5/V4.

import "./LaunchToken.sol";
import "./FeeShareDistributor.sol";

// ═══════════════════════════════════════════════════════════════════════════
//  Interfaces
// ═══════════════════════════════════════════════════════════════════════════

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IUniswapV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
}

interface INonfungiblePositionManager {
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
}

interface ISporeReactorV6 {
    function initialize(
        address _token, address _mft, address _money, address _usdc,
        address _pm, address _router, address _factory,
        address _upstreamReactor, address _launcher
    ) external;
    function addPool(uint256 tokenId) external;
    function setDistributor(address _distributor) external;
    function transferAdmin(address newAdmin) external;
}

interface ICharityFund {
    function registerV3Position(uint256 tokenId) external;
}

// ═══════════════════════════════════════════════════════════════════════════

contract UnrugableV9 {

    // ── Immutables ────────────────────────────────────────────────────────
    address public immutable meme;             // Meme for Trees (18 dec)
    address public immutable money;            // Money for Trees (6 dec)
    address public immutable usdc;             // USDC (6 dec) — distributor payout
    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;       // passed to reactor
    address public immutable reactorImpl;      // MUST be a SporeReactorV6 impl
    address public immutable upstreamReactor;
    uint24  public immutable moneyMemeFee;     // fee tier of Money/Meme pool

    address public owner;

    // ── Constants ─────────────────────────────────────────────────────────
    string  constant METADATA_BASE = "https://tasern.quest/api/unruggable/metadata/";
    uint256 constant TOTAL_SUPPLY     = 1_000_000_000e18;         // 1B tokens
    uint256 constant TARGET_MC_MONEY  = 10_000_000_000;           // $10K in Money (6 dec)
    uint256 constant MONEY_BPS        = 7000;                     // 70% → Money wall
    uint24  constant FEE_TIER         = 10000;                    // 1% fee tier
    int24   constant TICK_SPACE       = 200;
    int24   constant TICK_MIN         = -887200;
    int24   constant TICK_MAX         =  887200;

    // ── Registry ──────────────────────────────────────────────────────────
    mapping(address => bool)    public isReactor;
    mapping(address => address) public reactorOf;
    mapping(address => address) public launcherOf;
    mapping(address => address) public distributorOf;   // token => fee-share NFT

    struct Launch {
        address token;
        address reactor;
        address distributor;
        address launcher;
        uint256 timestamp;
    }
    Launch[] public launches;

    event TokenLaunched(
        address indexed token, address reactor, address distributor,
        address indexed launcher, string name, string symbol
    );
    event YieldRegistrationFailed(uint256 indexed tokenId);

    // ═══════════════════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _meme,
        address _money,
        address _usdc,
        address _v3Factory,
        address _pm,
        address _router,
        address _reactorImpl,
        address _upstreamReactor,
        uint24  _moneyMemeFee
    ) {
        meme            = _meme;
        money           = _money;
        usdc            = _usdc;
        v3Factory       = _v3Factory;
        positionManager = _pm;
        swapRouter      = _router;
        reactorImpl     = _reactorImpl;
        upstreamReactor = _upstreamReactor;
        moneyMemeFee    = _moneyMemeFee;
        owner           = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — single transaction, no seed required
    // ═══════════════════════════════════════════════════════════════════════

    function launch(
        string calldata _name,
        string calldata _symbol,
        address _customUpstream
    ) external returns (address tokenAddr, address reactorAddr) {

        // 1. Mint 1B tokens to this contract
        tokenAddr = address(new LaunchToken(_name, _symbol, TOTAL_SUPPLY, address(this), METADATA_BASE));

        uint256 moneySupply = TOTAL_SUPPLY * MONEY_BPS / 10000;  // 70%
        uint256 memeSupply  = TOTAL_SUPPLY - moneySupply;         // 30%

        // 2. Create TOKEN/Money sell wall (70%)
        uint256 moneyWallId = _createMoneyWall(tokenAddr, moneySupply);

        // 2b. Register Money LP for yield — reactor earns Aave yield via CharityFund
        try ICharityFund(money).registerV3Position(moneyWallId) {} catch {
            emit YieldRegistrationFailed(moneyWallId);
        }

        // 3. Create TOKEN/Meme sell wall (30%)
        uint256 memeWallId = _createMemeWall(tokenAddr, memeSupply);

        // 4. Determine upstream reactor
        address upstream = upstreamReactor;
        if (_customUpstream != address(0)) {
            uint256 sz;
            assembly { sz := extcodesize(_customUpstream) }
            if (sz > 0) upstream = _customUpstream;
        }

        // 5. Deploy reactor (V6), hand it both positions
        reactorAddr = _cloneReactor();
        ISporeReactorV6(reactorAddr).initialize(
            tokenAddr, meme, money, usdc,
            positionManager, swapRouter, v3Factory, upstream, msg.sender
        );

        _transferNFT(moneyWallId, reactorAddr);
        ISporeReactorV6(reactorAddr).addPool(moneyWallId);
        _transferNFT(memeWallId, reactorAddr);
        ISporeReactorV6(reactorAddr).addPool(memeWallId);

        // 5b. V9: deploy the fee-share distributor (PAYOUT = USDC) and wire reactor.
        //     Distributor mints all 100 NFTs to msg.sender in its constructor.
        FeeShareDistributor dist = new FeeShareDistributor(
            usdc, reactorAddr, msg.sender,
            string.concat(_name, " Fee Share"),
            string.concat(_symbol, "FEE"),
            "" // reference factory — empty baseURI (ShipyardV2 supplies the crew URI)
        );
        // This factory is the reactor's admin until any transferAdmin call,
        // so it can setDistributor exactly once here.
        ISporeReactorV6(reactorAddr).setDistributor(address(dist));

        // 6. Refund any dust from rounding
        _refundDust(tokenAddr, msg.sender);

        // 7. Registry
        isReactor[reactorAddr] = true;
        reactorOf[tokenAddr] = reactorAddr;
        launcherOf[reactorAddr] = msg.sender;
        distributorOf[tokenAddr] = address(dist);

        launches.push(Launch({
            token: tokenAddr, reactor: reactorAddr, distributor: address(dist),
            launcher: msg.sender, timestamp: block.timestamp
        }));

        emit TokenLaunched(tokenAddr, reactorAddr, address(dist), msg.sender, _name, _symbol);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — TOKEN/Money sell wall (70%, fixed $10K MC price)
    // ═══════════════════════════════════════════════════════════════════════

    function _createMoneyWall(
        address tokenAddr,
        uint256 tokenAmount
    ) internal returns (uint256 positionId) {
        bool tokenIs0 = tokenAddr < money;
        address token0 = tokenIs0 ? tokenAddr : money;
        address token1 = tokenIs0 ? money : tokenAddr;

        uint160 sqrtPrice = tokenIs0
            ? _calcSqrtPrice(TOTAL_SUPPLY, TARGET_MC_MONEY)
            : _calcSqrtPrice(TARGET_MC_MONEY, TOTAL_SUPPLY);

        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(sqrtPrice);

        (, int24 currentTick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 baseTick = (currentTick / TICK_SPACE) * TICK_SPACE;
        if (baseTick > currentTick) baseTick -= TICK_SPACE;

        int24 tickLower;
        int24 tickUpper;
        uint256 a0;
        uint256 a1;

        if (tokenIs0) {
            tickLower = baseTick + TICK_SPACE;
            tickUpper = TICK_MAX;
            a0 = tokenAmount;
            a1 = 0;
        } else {
            tickLower = TICK_MIN;
            tickUpper = baseTick;
            a0 = 0;
            a1 = tokenAmount;
        }

        IERC20(tokenAddr).approve(positionManager, tokenAmount);

        (positionId,,,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: FEE_TIER,
                tickLower: tickLower, tickUpper: tickUpper,
                amount0Desired: a0, amount1Desired: a1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — TOKEN/Meme sell wall (30%, price derived from Money/Meme)
    // ═══════════════════════════════════════════════════════════════════════

    function _createMemeWall(
        address tokenAddr,
        uint256 tokenAmount
    ) internal returns (uint256 positionId) {
        bool tokenIs0 = tokenAddr < meme;
        address token0 = tokenIs0 ? tokenAddr : meme;
        address token1 = tokenIs0 ? meme : tokenAddr;

        address moneyMemePool = IUniswapV3Factory(v3Factory).getPool(money, meme, moneyMemeFee);
        require(moneyMemePool != address(0), "no Money/Meme pool");
        (uint160 sqrtPriceMoneyMeme,,,,,,) = IUniswapV3Pool(moneyMemePool).slot0();

        uint256 equivalentMeme = _convertViaPool(
            TARGET_MC_MONEY, sqrtPriceMoneyMeme, money < meme
        );
        require(equivalentMeme > 0, "meme conversion zero");

        uint160 sqrtPrice = tokenIs0
            ? _calcSqrtPrice(TOTAL_SUPPLY, equivalentMeme)
            : _calcSqrtPrice(equivalentMeme, TOTAL_SUPPLY);

        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(sqrtPrice);

        (, int24 currentTick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 baseTick = (currentTick / TICK_SPACE) * TICK_SPACE;
        if (baseTick > currentTick) baseTick -= TICK_SPACE;

        int24 tickLower;
        int24 tickUpper;
        uint256 a0;
        uint256 a1;

        if (tokenIs0) {
            tickLower = baseTick + TICK_SPACE;
            tickUpper = TICK_MAX;
            a0 = tokenAmount;
            a1 = 0;
        } else {
            tickLower = TICK_MIN;
            tickUpper = baseTick;
            a0 = 0;
            a1 = tokenAmount;
        }

        IERC20(tokenAddr).approve(positionManager, tokenAmount);

        (positionId,,,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: FEE_TIER,
                tickLower: tickLower, tickUpper: tickUpper,
                amount0Desired: a0, amount1Desired: a1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Math
    // ═══════════════════════════════════════════════════════════════════════

    function _convertViaPool(
        uint256 amount, uint160 sqrtPriceX96, bool inputIs0
    ) internal pure returns (uint256) {
        uint256 sqrtP = uint256(sqrtPriceX96);
        if (inputIs0) {
            return (amount * sqrtP >> 96) * sqrtP >> 96;
        } else {
            return (amount << 96) / sqrtP * (1 << 96) / sqrtP;
        }
    }

    function _calcSqrtPrice(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "zero amount");
        uint256 s1 = _sqrt(amount1);
        uint256 s0 = _sqrt(amount0);
        uint256 result = (s1 << 96) / s0;
        require(result > 0 && result <= type(uint160).max, "sqrt overflow");
        return uint160(result);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════════════════════════════════

    function _cloneReactor() internal returns (address instance) {
        address impl = reactorImpl;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "clone failed");
    }

    function _transferNFT(uint256 tokenId, address to) internal {
        (bool success,) = positionManager.call(
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", address(this), to, tokenId)
        );
        require(success, "NFT transfer failed");
    }

    function _refundDust(address tokenAddr, address to) internal {
        uint256 bal = IERC20(tokenAddr).balanceOf(address(this));
        if (bal > 0) IERC20(tokenAddr).transfer(to, bal);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════════════════════════════════

    function addPoolToReactor(address reactor, uint256 tokenId) external {
        require(msg.sender == owner || msg.sender == launcherOf[reactor], "not authorized");
        (bool pulled,) = positionManager.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), tokenId)
        );
        require(pulled, "pull failed");
        _transferNFT(tokenId, reactor);
        ISporeReactorV6(reactor).addPool(tokenId);
    }

    function addPoolFromHolding(address reactor, uint256 tokenId) external {
        require(msg.sender == owner || msg.sender == launcherOf[reactor], "not authorized");
        _transferNFT(tokenId, reactor);
        ISporeReactorV6(reactor).addPool(tokenId);
    }

    function transferReactorAdmin(address reactor, address newAdmin) external {
        require(msg.sender == owner, "not owner");
        ISporeReactorV6(reactor).transferAdmin(newAdmin);
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "not owner");
        owner = newOwner;
    }

    function rescue(address _token) external {
        require(msg.sender == owner, "not owner");
        uint256 bal = IERC20(_token).balanceOf(address(this));
        if (bal > 0) IERC20(_token).transfer(owner, bal);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════════════════════════════════

    function launchCount() external view returns (uint256) {
        return launches.length;
    }
}
