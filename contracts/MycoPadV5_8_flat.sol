// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Unrugable2 V5.8 — Ecosystem-Native Floors (TBTC/TETH/MfTUSD)
///
/// Two launch modes:
///   - launchMeme():    $5 mftUSD min, no vesting, 100% supply to pools
///   - launchProject(): $100 mftUSD min, 20% VolumeVesting, 80% supply to pools
///
/// ALL floor liquidity uses ecosystem tokens instead of external assets:
///   - MfTUSD (stablecoin) replaces USDC
///   - TBTC (tree BTC) replaces cbBTC
///   - TETH (tree ETH) replaces WETH
///
/// Pool structure per launch:
///   3 floor pools: TOKEN/MfTUSD + TOKEN/TBTC + TOKEN/TETH
///   3 MfT sell walls: TOKEN/MfT(meme) at 1.1x / 2x / 5x
///   CHAR reactor: CHAR/TBTC + CHAR/TETH (6% of seed)
///
/// V5.8 changes from V5.7:
///   - TBTC replaces cbBTC, TETH replaces WETH in all floor pools
///   - CHAR reactor pairs with TBTC/TETH instead of cbBTC/WETH
///   - No more mftUSD.withdraw() → USDC intermediary
///   - Swaps route through MfTUSD/TBTC and MfTUSD/TETH pools directly
///   - Every launch deepens ecosystem liquidity instead of external tokens

/// @title LaunchToken — Minimal fixed-supply ERC20
/// @notice All supply minted to a single recipient (the factory). No owner, no mint, no burn.
///         Once deployed this token is completely immutable.
contract LaunchToken {

    string public name;
    string public symbol;
    uint8  public constant decimals = 18;
    uint256 public totalSupply;
    string private _baseURI;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 _supply, address _recipient, string memory baseURI_) {
        require(_supply > 0, "zero supply");
        require(_recipient != address(0), "zero recipient");
        name = _name;
        symbol = _symbol;
        totalSupply = _supply;
        _baseURI = baseURI_;
        balanceOf[_recipient] = _supply;
        emit Transfer(address(0), _recipient, _supply);
    }

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

// ═══════════════════════════════════════════════════════════════════════════
//  Interfaces
// ═══════════════════════════════════════════════════════════════════════════

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
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
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256);

    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata) external payable returns (uint256);
}

interface ISporeReactor {
    function initialize(address _token, address _mft, address _pm, address _router, address _factory, address _upstreamReactor) external;
    function addPool(uint256 tokenId) external;
    function transferAdmin(address newAdmin) external;
}

interface IVolumeVesting {
    function initialize(address _token, address _charity, address _burnAddress, uint256 _totalAllocation, uint256 _vestRateBPS) external;
}

interface IMfTStable {
    function deposit(uint256 amount) external;
}

// ═══════════════════════════════════════════════════════════════════════════

contract Unruggable2 {

    // ── Immutables ────────────────────────────────────────────────────────
    address public immutable teth;       // Tree ETH (replaces WETH)
    address public immutable tbtc;       // Tree BTC (replaces cbBTC)
    address public immutable mft;        // MfT meme token (sell walls)
    address public immutable char;       // CHAR carbon token
    address public immutable mftStable;  // MfTUSD stablecoin (seed currency + stable floor)

    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;

    address public immutable reactorImpl;
    address public immutable vestingImpl;
    address public immutable upstreamReactor;

    // Fee tiers for swap routing
    uint24  public immutable mftStableTbtcFee;  // MfTUSD/TBTC pool fee
    uint24  public immutable mftStableTethFee;  // MfTUSD/TETH pool fee
    uint24  public immutable mftStableMftFee;   // MfTUSD/MfT(meme) fee (for CHAR 2-hop route)
    uint24  public immutable mftMemeCharFee;    // MfT(meme)/CHAR fee (for CHAR 2-hop route)
    uint24  public immutable mftMemeWethFee;    // MfT(meme)/WETH fee for price derivation

    // WETH needed only for MfT meme price derivation (WETH/USDC → WETH/MfT path)
    address public immutable weth;
    address public immutable usdc;
    uint24  public immutable wethUsdcFee;

    address public owner;

    // ── Constants ─────────────────────────────────────────────────────────
    string  constant METADATA_BASE = "https://tasern.quest/api/unruggable/metadata/";
    uint24  constant FEE_TIER      = 10000;   // 1% for launched token pools
    uint24  constant CHAR_FEE      = 10000;   // 1% for CHAR pools
    int24   constant TICK_SPACE    = 200;
    int24   constant TICK_MIN      = -887200;
    int24   constant TICK_MAX      =  887200;

    uint256 constant TOKENS_PER_MFTUSD_RAW = 1e19;   // 10B tokens per $1 mftUSD (6 dec)

    // Seed split ratios (BPS of 10000)
    uint256 constant SEED_FLOOR  = 9400;
    uint256 constant SEED_CHAR   = 600;
    uint256 constant SEED_STABLE = 4000;    // 40% of floor -> MfTUSD (stays as-is)
    uint256 constant SEED_BTC    = 3000;    // 30% of floor -> TBTC
    uint256 constant SEED_ETH    = 3000;    // 30% of floor -> TETH

    // MfT meme wall tick offsets
    int24 constant WALL_1_1X = 1000;
    int24 constant WALL_2X   = 7000;
    int24 constant WALL_5X   = 16200;

    // Vesting (project tier only)
    uint256 constant VEST_BPS  = 2000;     // 20% of supply to launcher vesting
    uint256 constant VEST_RATE = 5000;     // 0.5 tokens vest per 1 token burned
    address constant BURN      = 0xfd780B0aE569e15e514B819ecFDF46f804953a4B;

    uint256 public minSeedMeme    = 5_000_000;     // $5 mftUSD (6 decimals)
    uint256 public minSeedProject = 100_000_000;   // $100 mftUSD (6 decimals)

    // ── Registry ──────────────────────────────────────────────────────────
    mapping(address => bool)    public isReactor;
    mapping(address => address) public reactorOf;
    mapping(address => address) public charReactorOf;
    mapping(address => address) public vestingOf;
    mapping(address => address) public launcherOf;

    // ── Pending launch ────────────────────────────────────────────────────
    struct Pending {
        address token;
        address upstream;
        uint256 totalSupply;
        uint256 seedAmount;
        uint256 floorStableId;
        uint256 floorBtcId;
        uint256 floorEthId;
        uint256 mftWall1Id;
        uint256 mftWall2Id;
        uint256 mftWall3Id;
        uint256 charSeed;
        bool    hasVesting;
    }
    mapping(address => Pending) public pending;

    struct Launch {
        address token;
        address reactor;
        address charReactor;
        address vesting;
        address launcher;
        uint256 supply;
        uint256 seed;
        uint256 timestamp;
    }
    Launch[] public launches;

    event TokenLaunched(
        address indexed token,
        address indexed reactor,
        address indexed charReactor,
        address vesting,
        address launcher,
        string  name,
        string  symbol,
        uint256 supply,
        uint256 seed
    );

    // ═══════════════════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _teth,
        address _tbtc,
        address _mft,
        address _char,
        address _mftStable,
        address _weth,
        address _usdc,
        address _v3Factory,
        address _pm,
        address _router,
        address _reactorImpl,
        address _vestingImpl,
        address _upstreamReactor,
        uint24  _mftStableTbtcFee,
        uint24  _mftStableTethFee,
        uint24  _mftStableMftFee,
        uint24  _mftMemeCharFee,
        uint24  _mftMemeWethFee,
        uint24  _wethUsdcFee
    ) {
        teth             = _teth;
        tbtc             = _tbtc;
        mft              = _mft;
        char             = _char;
        mftStable        = _mftStable;
        weth             = _weth;
        usdc             = _usdc;
        v3Factory        = _v3Factory;
        positionManager  = _pm;
        swapRouter       = _router;
        reactorImpl      = _reactorImpl;
        vestingImpl      = _vestingImpl;
        upstreamReactor  = _upstreamReactor;
        mftStableTbtcFee = _mftStableTbtcFee;
        mftStableTethFee = _mftStableTethFee;
        mftStableMftFee  = _mftStableMftFee;
        mftMemeCharFee   = _mftMemeCharFee;
        mftMemeWethFee   = _mftMemeWethFee;
        wethUsdcFee      = _wethUsdcFee;
        owner            = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — Meme Tier ($5 min, no vesting)
    // ═══════════════════════════════════════════════════════════════════════

    function launchMemeStep1(
        string calldata _name,
        string calldata _symbol,
        uint256 _totalSupply,
        uint256 _seedAmount,
        address _customUpstream
    ) external returns (address tokenAddr) {
        require(_seedAmount >= minSeedMeme, "seed too low");
        IERC20(mftStable).transferFrom(msg.sender, address(this), _seedAmount);
        tokenAddr = _launchStep1(_name, _symbol, _totalSupply, _seedAmount, _customUpstream, false);
    }

    function launchMemeStep1WithUSDC(
        string calldata _name,
        string calldata _symbol,
        uint256 _totalSupply,
        uint256 _seedAmount,
        address _customUpstream
    ) external returns (address tokenAddr) {
        require(_seedAmount >= minSeedMeme, "seed too low");
        _mintMftFromUSDC(_seedAmount);
        tokenAddr = _launchStep1(_name, _symbol, _totalSupply, _seedAmount, _customUpstream, false);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — Project Tier ($100 min, 20% vesting)
    // ═══════════════════════════════════════════════════════════════════════

    function launchProjectStep1(
        string calldata _name,
        string calldata _symbol,
        uint256 _totalSupply,
        uint256 _seedAmount,
        address _customUpstream
    ) external returns (address tokenAddr) {
        require(_seedAmount >= minSeedProject, "seed too low");
        IERC20(mftStable).transferFrom(msg.sender, address(this), _seedAmount);
        tokenAddr = _launchStep1(_name, _symbol, _totalSupply, _seedAmount, _customUpstream, true);
    }

    function launchProjectStep1WithUSDC(
        string calldata _name,
        string calldata _symbol,
        uint256 _totalSupply,
        uint256 _seedAmount,
        address _customUpstream
    ) external returns (address tokenAddr) {
        require(_seedAmount >= minSeedProject, "seed too low");
        _mintMftFromUSDC(_seedAmount);
        tokenAddr = _launchStep1(_name, _symbol, _totalSupply, _seedAmount, _customUpstream, true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Launch — Step 2 (shared, completes either tier)
    // ═══════════════════════════════════════════════════════════════════════

    function launchStep2(
        string calldata _name,
        string calldata _symbol
    ) external returns (address reactorAddr, address charReactorAddr) {
        Pending memory p = pending[msg.sender];
        require(p.token != address(0), "no pending");

        delete pending[msg.sender];

        charReactorAddr = _setupCharReactor(p.charSeed, p.upstream);

        reactorAddr = _setupReactor(
            p.token, p.floorStableId, p.floorBtcId, p.floorEthId,
            p.mftWall1Id, p.mftWall2Id, p.mftWall3Id, charReactorAddr
        );

        address vestingAddr = address(0);
        if (p.hasVesting) {
            uint256 vestingAmount = p.totalSupply * VEST_BPS / 10000;
            vestingAddr = _setupVesting(p.token, msg.sender, vestingAmount);
        }

        isReactor[reactorAddr] = true;
        isReactor[charReactorAddr] = true;
        reactorOf[p.token] = reactorAddr;
        charReactorOf[p.token] = charReactorAddr;
        vestingOf[p.token] = vestingAddr;
        launcherOf[reactorAddr] = msg.sender;
        launcherOf[charReactorAddr] = msg.sender;

        _refundDust(p.token, msg.sender);

        launches.push(Launch({
            token: p.token, reactor: reactorAddr, charReactor: charReactorAddr,
            vesting: vestingAddr, launcher: msg.sender, supply: p.totalSupply,
            seed: p.seedAmount, timestamp: block.timestamp
        }));

        emit TokenLaunched(p.token, reactorAddr, charReactorAddr, vestingAddr, msg.sender, _name, _symbol, p.totalSupply, p.seedAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — pull USDC from user, mint MfTUSD 1:1
    // ═══════════════════════════════════════════════════════════════════════

    function _mintMftFromUSDC(uint256 amount) internal {
        IERC20(usdc).transferFrom(msg.sender, address(this), amount);
        IERC20(usdc).approve(mftStable, amount);
        IMfTStable(mftStable).deposit(amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — shared Step 1 logic
    // ═══════════════════════════════════════════════════════════════════════

    function _launchStep1(
        string calldata _name,
        string calldata _symbol,
        uint256 _totalSupply,
        uint256 _seedAmount,
        address _customUpstream,
        bool _hasVesting
    ) internal returns (address tokenAddr) {
        require(_totalSupply >= 1e18, "supply too low");
        require(pending[msg.sender].token == address(0), "pending exists");

        address primaryUpstream = upstreamReactor;
        if (_customUpstream != address(0)) {
            uint256 sz;
            assembly { sz := extcodesize(_customUpstream) }
            if (sz > 0) primaryUpstream = _customUpstream;
        }

        // Caller must ensure _seedAmount of mftStable is already in this contract
        tokenAddr = address(new LaunchToken(_name, _symbol, _totalSupply, address(this), METADATA_BASE));

        // Determine pool supply (project reserves 20% for vesting)
        uint256 poolSupply = _hasVesting
            ? _totalSupply - (_totalSupply * VEST_BPS / 10000)
            : _totalSupply;

        uint256 floorSeed = _seedAmount * SEED_FLOOR / 10000;
        uint256 charSeed  = _seedAmount - floorSeed;

        // Split: 40% stays as mftUSD, 30% swaps to TBTC, 30% swaps to TETH
        uint256 stableKeep  = floorSeed * SEED_STABLE / 10000;
        uint256 forSwaps    = floorSeed - stableKeep;
        uint256 mftForTbtc  = forSwaps * SEED_BTC / (SEED_BTC + SEED_ETH);
        uint256 mftForTeth  = forSwaps - mftForTbtc;

        // Swap MfTUSD → TBTC (direct, no USDC intermediary)
        IERC20(mftStable).approve(swapRouter, mftForTbtc);
        uint256 tbtcAmount = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: mftStable, tokenOut: tbtc, fee: mftStableTbtcFee,
                recipient: address(this), amountIn: mftForTbtc,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        // Swap MfTUSD → TETH (direct, no USDC intermediary)
        IERC20(mftStable).approve(swapRouter, mftForTeth);
        uint256 tethAmount = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: mftStable, tokenOut: teth, fee: mftStableTethFee,
                recipient: address(this), amountIn: mftForTeth,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        // Calculate token allocations for each floor pool
        uint256 totalFloorTokens = floorSeed * TOKENS_PER_MFTUSD_RAW;
        require(totalFloorTokens < poolSupply, "floor exceeds supply");

        uint256 stableFloorTokens = totalFloorTokens * SEED_STABLE / 10000;
        uint256 btcFloorTokens    = totalFloorTokens * SEED_BTC / 10000;
        uint256 ethFloorTokens    = totalFloorTokens - stableFloorTokens - btcFloorTokens;

        // Create 3 floor pools: TOKEN/MfTUSD + TOKEN/TBTC + TOKEN/TETH
        uint256 floorStableId = _createFloorPool(tokenAddr, mftStable, stableFloorTokens, stableKeep);
        uint256 floorBtcId    = _createFloorPool(tokenAddr, tbtc, btcFloorTokens, tbtcAmount);
        uint256 floorEthId    = _createFloorPool(tokenAddr, teth, ethFloorTokens, tethAmount);

        // Create MfT meme sell walls with remaining token supply
        uint256 curveSupply = poolSupply - totalFloorTokens;
        (uint256 mftWall1Id, uint256 mftWall2Id, uint256 mftWall3Id) = _createMftWalls(
            tokenAddr, curveSupply, ethFloorTokens, floorSeed * SEED_ETH / 10000
        );

        pending[msg.sender] = Pending({
            token:         tokenAddr,
            upstream:      primaryUpstream,
            totalSupply:   _totalSupply,
            seedAmount:    _seedAmount,
            floorStableId: floorStableId,
            floorBtcId:    floorBtcId,
            floorEthId:    floorEthId,
            mftWall1Id:    mftWall1Id,
            mftWall2Id:    mftWall2Id,
            mftWall3Id:    mftWall3Id,
            charSeed:      charSeed,
            hasVesting:    _hasVesting
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — deploy VolumeVesting clone (project tier only)
    // ═══════════════════════════════════════════════════════════════════════

    function _setupVesting(
        address tokenAddr,
        address launcher,
        uint256 vestingAmount
    ) internal returns (address vestingAddr) {
        vestingAddr = _cloneVesting();
        IERC20(tokenAddr).transfer(vestingAddr, vestingAmount);
        IVolumeVesting(vestingAddr).initialize(
            tokenAddr,
            launcher,
            BURN,
            vestingAmount,
            VEST_RATE
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — CHAR reactor setup (MfTUSD → CHAR + TBTC/TETH)
    // ═══════════════════════════════════════════════════════════════════════

    function _setupCharReactor(uint256 charSeed, address upstreamAddr) internal returns (address charReactorAddr) {
        uint256 mftForChar  = charSeed / 2;
        uint256 mftForPairs = charSeed - mftForChar;

        // Buy CHAR via 2-hop: MfTUSD → MfT(meme) → CHAR
        IERC20(mftStable).approve(swapRouter, mftForChar);
        uint256 totalChar = ISwapRouter02(swapRouter).exactInput(
            ISwapRouter02.ExactInputParams({
                path: abi.encodePacked(mftStable, mftStableMftFee, mft, mftMemeCharFee, char),
                recipient: address(this),
                amountIn: mftForChar,
                amountOutMinimum: 0
            })
        );

        uint256 charForBtc = totalChar / 2;
        uint256 charForEth = totalChar - charForBtc;
        uint256 mftForTbtc = mftForPairs / 2;
        uint256 mftForTeth = mftForPairs - mftForTbtc;

        // Buy TBTC for CHAR/TBTC pool
        IERC20(mftStable).approve(swapRouter, mftForTbtc);
        uint256 tbtcAmount = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: mftStable, tokenOut: tbtc, fee: mftStableTbtcFee,
                recipient: address(this), amountIn: mftForTbtc,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        uint256 charBtcId = _createCharPool(char, tbtc, charForBtc, tbtcAmount);

        // Buy TETH for CHAR/TETH pool
        IERC20(mftStable).approve(swapRouter, mftForTeth);
        uint256 tethAmount = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: mftStable, tokenOut: teth, fee: mftStableTethFee,
                recipient: address(this), amountIn: mftForTeth,
                amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        uint256 charEthId = _createCharPool(char, teth, charForEth, tethAmount);

        // Deploy CHAR reactor clone
        charReactorAddr = _cloneReactor();
        ISporeReactor(charReactorAddr).initialize(char, mft, positionManager, swapRouter, v3Factory, upstreamAddr);

        _transferNFT(charBtcId, charReactorAddr);
        ISporeReactor(charReactorAddr).addPool(charBtcId);

        _transferNFT(charEthId, charReactorAddr);
        ISporeReactor(charReactorAddr).addPool(charEthId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — create floor pool (TOKEN/MfTUSD or TOKEN/TBTC or TOKEN/TETH)
    // ═══════════════════════════════════════════════════════════════════════

    function _createFloorPool(
        address tokenAddr,
        address baseAsset,
        uint256 tokenAmount,
        uint256 baseAmount
    ) internal returns (uint256 positionId) {
        bool tokenIs0 = tokenAddr < baseAsset;
        address token0 = tokenIs0 ? tokenAddr : baseAsset;
        address token1 = tokenIs0 ? baseAsset : tokenAddr;
        uint256 t0 = tokenIs0 ? tokenAmount : baseAmount;
        uint256 t1 = tokenIs0 ? baseAmount : tokenAmount;

        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(_calcSqrtPrice(t0, t1));

        IERC20(token0).approve(positionManager, t0);
        IERC20(token1).approve(positionManager, t1);

        (positionId,,,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: FEE_TIER,
                tickLower: TICK_MIN, tickUpper: TICK_MAX,
                amount0Desired: t0, amount1Desired: t1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );
    }

    function _createCharPool(
        address charToken,
        address xToken,
        uint256 charAmount,
        uint256 xAmount
    ) internal returns (uint256 positionId) {
        bool charIs0 = charToken < xToken;
        address token0 = charIs0 ? charToken : xToken;
        address token1 = charIs0 ? xToken : charToken;
        uint256 t0 = charIs0 ? charAmount : xAmount;
        uint256 t1 = charIs0 ? xAmount : charAmount;

        address pool = IUniswapV3Factory(v3Factory).getPool(token0, token1, CHAR_FEE);
        if (pool == address(0)) {
            pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, CHAR_FEE);
            IUniswapV3Pool(pool).initialize(_calcSqrtPrice(t0, t1));
        }

        IERC20(token0).approve(positionManager, t0);
        IERC20(token1).approve(positionManager, t1);

        (positionId,,,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: CHAR_FEE,
                tickLower: TICK_MIN, tickUpper: TICK_MAX,
                amount0Desired: t0, amount1Desired: t1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — 3 MfT meme sell walls at 1.1x / 2x / 5x launch price
    // ═══════════════════════════════════════════════════════════════════════

    function _createMftWalls(
        address tokenAddr,
        uint256 curveSupply,
        uint256 floorTokens,
        uint256 floorMftUsd6
    ) internal returns (uint256 id1, uint256 id2, uint256 id3) {
        bool tokenIs0 = tokenAddr < mft;
        address token0 = tokenIs0 ? tokenAddr : mft;
        address token1 = tokenIs0 ? mft : tokenAddr;

        uint160 sqrtPrice = _deriveMftPrice(tokenIs0, floorTokens, floorMftUsd6);

        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(sqrtPrice);

        (, int24 currentTick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 base = (currentTick / TICK_SPACE) * TICK_SPACE;

        uint256 s1 = curveSupply / 3;
        uint256 s2 = curveSupply / 3;
        uint256 s3 = curveSupply - s1 - s2;

        if (tokenIs0) {
            int24 t1 = base + WALL_1_1X;
            int24 t2 = base + WALL_2X;
            int24 t5 = base + WALL_5X;
            if (t5 >= TICK_MAX) t5 = TICK_MAX - TICK_SPACE;

            IERC20(token0).approve(positionManager, s1);
            (id1,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: t1, tickUpper: t2,
                    amount0Desired: s1, amount1Desired: 0,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );

            IERC20(token0).approve(positionManager, s2);
            (id2,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: t2, tickUpper: t5,
                    amount0Desired: s2, amount1Desired: 0,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );

            IERC20(token0).approve(positionManager, s3);
            (id3,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: t5, tickUpper: TICK_MAX,
                    amount0Desired: s3, amount1Desired: 0,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );
        } else {
            int24 t1 = base - WALL_1_1X;
            int24 t2 = base - WALL_2X;
            int24 t5 = base - WALL_5X;
            if (t5 <= TICK_MIN) t5 = TICK_MIN + TICK_SPACE;

            IERC20(token1).approve(positionManager, s1);
            (id1,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: t2, tickUpper: t1,
                    amount0Desired: 0, amount1Desired: s1,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );

            IERC20(token1).approve(positionManager, s2);
            (id2,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: t5, tickUpper: t2,
                    amount0Desired: 0, amount1Desired: s2,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );

            IERC20(token1).approve(positionManager, s3);
            (id3,,,) = INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0, token1: token1, fee: FEE_TIER,
                    tickLower: TICK_MIN, tickUpper: t5,
                    amount0Desired: 0, amount1Desired: s3,
                    amount0Min: 0, amount1Min: 0,
                    recipient: address(this), deadline: block.timestamp
                })
            );
        }
    }

    /// @dev Derive MfT meme price for sell walls using WETH/USDC + WETH/MfT oracle pools
    /// We still need WETH/USDC and WETH/MfT for price derivation since MfT meme
    /// doesn't have a direct MfTUSD pair for pricing
    function _deriveMftPrice(
        bool tokenIs0InMftPool,
        uint256 floorTokens,
        uint256 floorStable6
    ) internal view returns (uint160) {
        // Get USDC/WETH price (MfTUSD ≈ USDC peg, so $-equivalent)
        address wethUsdcPool = IUniswapV3Factory(v3Factory).getPool(usdc, weth, wethUsdcFee);
        require(wethUsdcPool != address(0), "no WETH/USDC pool");
        (uint160 sqrtPriceWethUsdc,,,,,,) = IUniswapV3Pool(wethUsdcPool).slot0();
        uint256 wethEquiv = _convertViaPool(floorStable6, sqrtPriceWethUsdc, usdc < weth);

        // Get WETH/MfT price
        address mftPool = IUniswapV3Factory(v3Factory).getPool(weth, mft, mftMemeWethFee);
        require(mftPool != address(0), "no WETH/MfT pool");
        (uint160 sqrtPriceMft,,,,,,) = IUniswapV3Pool(mftPool).slot0();
        uint256 equivalentMft = _convertViaPool(wethEquiv, sqrtPriceMft, weth < mft);
        equivalentMft = equivalentMft * 11 / 10;  // 1.1x starting price

        if (tokenIs0InMftPool) {
            return _calcSqrtPrice(floorTokens, equivalentMft);
        } else {
            return _calcSqrtPrice(equivalentMft, floorTokens);
        }
    }

    function _convertViaPool(uint256 amount, uint160 sqrtPriceX96, bool inputIs0) internal pure returns (uint256) {
        uint256 sqrtP = uint256(sqrtPriceX96);
        if (inputIs0) {
            return (amount * sqrtP >> 96) * sqrtP >> 96;
        } else {
            return (amount << 96) / sqrtP * (1 << 96) / sqrtP;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — setup primary reactor
    // ═══════════════════════════════════════════════════════════════════════

    function _setupReactor(
        address tokenAddr,
        uint256 stableId,
        uint256 btcId,
        uint256 ethId,
        uint256 mftWall1,
        uint256 mftWall2,
        uint256 mftWall3,
        address upstream
    ) internal returns (address reactorAddr) {
        reactorAddr = _cloneReactor();
        ISporeReactor(reactorAddr).initialize(tokenAddr, mft, positionManager, swapRouter, v3Factory, upstream);

        _transferNFT(stableId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(stableId);
        _transferNFT(btcId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(btcId);
        _transferNFT(ethId, reactorAddr);
        ISporeReactor(reactorAddr).addPool(ethId);
        _transferNFT(mftWall1, reactorAddr);
        ISporeReactor(reactorAddr).addPool(mftWall1);
        _transferNFT(mftWall2, reactorAddr);
        ISporeReactor(reactorAddr).addPool(mftWall2);
        _transferNFT(mftWall3, reactorAddr);
        ISporeReactor(reactorAddr).addPool(mftWall3);
    }

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

    function _cloneVesting() internal returns (address instance) {
        address impl = vestingImpl;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "clone failed");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Math
    // ═══════════════════════════════════════════════════════════════════════

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

    function _transferNFT(uint256 tokenId, address to) internal {
        (bool success,) = positionManager.call(
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", address(this), to, tokenId)
        );
        require(success, "NFT transfer failed");
    }

    function _refundDust(address tokenAddr, address to) internal {
        address[7] memory tokens = [tokenAddr, teth, tbtc, char, mft, mftStable, address(0)];
        for (uint256 i; i < 7; ++i) {
            if (tokens[i] == address(0)) continue;
            uint256 bal = IERC20(tokens[i]).balanceOf(address(this));
            if (bal > 0) IERC20(tokens[i]).transfer(to, bal);
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Cancel pending launch (refunds remaining mftUSD)
    // ═══════════════════════════════════════════════════════════════════════

    function cancelPending() external {
        Pending memory p = pending[msg.sender];
        require(p.token != address(0), "no pending");
        delete pending[msg.sender];
        uint256 bal = IERC20(mftStable).balanceOf(address(this));
        if (bal > 0) IERC20(mftStable).transfer(msg.sender, bal);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin — owner OR launcher can add pools to their reactor
    // ═══════════════════════════════════════════════════════════════════════

    function addPoolToReactor(address reactor, uint256 tokenId) external {
        require(msg.sender == owner || msg.sender == launcherOf[reactor], "not authorized");
        (bool pulled,) = positionManager.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), tokenId)
        );
        require(pulled, "pull failed");
        _transferNFT(tokenId, reactor);
        ISporeReactor(reactor).addPool(tokenId);
    }

    function addPoolFromHolding(address reactor, uint256 tokenId) external {
        require(msg.sender == owner || msg.sender == launcherOf[reactor], "not authorized");
        _transferNFT(tokenId, reactor);
        ISporeReactor(reactor).addPool(tokenId);
    }

    // ── Owner-only admin ─────────────────────────────────────────────────

    function transferReactorAdmin(address reactor, address newAdmin) external {
        require(msg.sender == owner, "not owner");
        ISporeReactor(reactor).transferAdmin(newAdmin);
    }

    function setMinSeeds(uint256 _meme, uint256 _project) external {
        require(msg.sender == owner, "not owner");
        minSeedMeme = _meme;
        minSeedProject = _project;
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

    function getLaunch(uint256 index) external view returns (
        address token, address reactor, address charReactor, address vesting,
        address launcher, uint256 supply, uint256 seed, uint256 timestamp
    ) {
        Launch storage l = launches[index];
        return (l.token, l.reactor, l.charReactor, l.vesting, l.launcher, l.supply, l.seed, l.timestamp);
    }
}
