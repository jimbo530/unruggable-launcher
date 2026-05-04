// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MycoPad Launch Factory — Grow an unruggable token
/// @notice One transaction: deploy token, create 3 V3 pools (USDC/WETH/cbBTC),
///         mint full-range positions, deploy SporeReactor, lock liquidity forever.
///         0.1% supply -> MfT treasury, 1% -> grower, 98.9% -> pools.
///         Reactors feed 10% of X-side fees to Reactor Prime (MfT).
///         Launches above meshSeed are auto-whitelisted for mycelium mesh connections.

import "./LaunchToken.sol";

// -- Interfaces ---------------------------------------------------------------

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IUniswapV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
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
}

interface ISporeReactor {
    function initialize(address _token, address _mft, address _pm, address _router, address _factory, address _reactorPrime) external;
    function addPool(uint256 tokenId) external;
    function transferAdmin(address newAdmin) external;
}

// -- Main Contract ------------------------------------------------------------

contract TokenLaunchFactory {

    // -- Chain-specific addresses (set in constructor) -------------------------
    address public immutable weth;
    address public immutable usdc;
    address public immutable wrappedBtc;

    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;

    address public immutable reactorImplementation;
    address public immutable mftTreasury;
    address public immutable mft;
    address public immutable reactorPrime;
    address public owner;

    // -- V3 constants ---------------------------------------------------------
    uint24  constant FEE_TIER    = 10000;       // 1% fee
    int24   constant TICK_LOWER  = -887200;     // full range for tick spacing 200
    int24   constant TICK_UPPER  =  887200;

    // -- Supply allocation (basis points, total = 10000) ----------------------
    uint256 constant BPS_MFT       = 10;    // 0.1%
    uint256 constant BPS_LAUNCHER  = 100;   // 1%
    uint256 constant BPS_USDC_POOL = 3956;  // ~40%
    uint256 constant BPS_WETH_POOL = 3467;  // ~35%
    uint256 constant BPS_BTC_POOL  = 2467;  // ~25%

    // -- Seed split (basis points of ETH received) ----------------------------
    uint256 constant SEED_USDC = 6000;  // 60%
    uint256 constant SEED_WETH = 2000;  // 20%

    // -- Existing pool fees for seed swaps (set per chain in constructor) ------
    uint24 public immutable wethUsdcFee;
    uint24 public immutable wethBtcFee;

    uint256 public minSeed  = 0.0003 ether;
    uint256 public meshSeed = 0.4 ether;      // ~$1000 — auto-whitelist threshold

    // -- Mycelium Mesh Tracking -----------------------------------------------
    struct Spore {
        address token;
        address reactor;
        address grower;          // launcher
        uint256 seed;            // ETH seeded
        uint256 timestamp;
        uint256 connections;     // mesh connections made to this token
        bool    meshed;          // true if launched above meshSeed
    }
    Spore[] public spores;
    mapping(address => uint256) public tokenToSporeId;   // token addr -> spores index + 1 (0 = not found)
    mapping(address => uint256) public reactorToSporeId;  // reactor addr -> spores index + 1

    uint256 public constant MAX_MESH_CONNECTIONS = 20;

    // -- Events (mushroom-themed) ---------------------------------------------
    event Sporulated(
        address indexed token,
        address indexed reactor,
        address indexed grower,
        string  name,
        string  symbol,
        uint256 supply,
        uint256 seed,
        bool    meshed
    );
    event MeshConnected(
        address indexed fromToken,
        address indexed toToken,
        uint256 connectionCount
    );

    // =========================================================================
    //  Constructor
    // =========================================================================

    constructor(
        address _weth,
        address _usdc,
        address _wrappedBtc,
        address _v3Factory,
        address _pm,
        address _router,
        address _reactorImpl,
        address _mftTreasury,
        address _mft,
        address _reactorPrime,
        uint24  _wethUsdcFee,
        uint24  _wethBtcFee
    ) {
        weth                   = _weth;
        usdc                   = _usdc;
        wrappedBtc             = _wrappedBtc;
        v3Factory              = _v3Factory;
        positionManager        = _pm;
        swapRouter             = _router;
        reactorImplementation  = _reactorImpl;
        mftTreasury            = _mftTreasury;
        mft                    = _mft;
        reactorPrime           = _reactorPrime;
        wethUsdcFee            = _wethUsdcFee;
        wethBtcFee             = _wethBtcFee;
        owner                  = msg.sender;
    }

    // =========================================================================
    //  Launch — sporulate a new token into the mycelium
    // =========================================================================

    function launch(
        string calldata _name,
        string calldata _symbol,
        uint256 _totalSupply
    ) external payable returns (address tokenAddr, address reactorAddr) {
        require(msg.value >= minSeed, "seed too low");
        require(_totalSupply >= 1e18, "min 1 token");

        bool isMeshed = msg.value >= meshSeed;

        // 1. Deploy token — all supply to this contract
        tokenAddr = address(new LaunchToken(_name, _symbol, _totalSupply, address(this), ""));

        // 2. Send allocations
        IERC20(tokenAddr).transfer(mftTreasury, _totalSupply * BPS_MFT / 10000);
        IERC20(tokenAddr).transfer(msg.sender, _totalSupply * BPS_LAUNCHER / 10000);

        // 3. Prepare seed: wrap ETH, swap to base assets
        uint256[3] memory baseAmounts = _prepareSeed(msg.value);

        // 4. Create pools and mint positions
        uint256[3] memory tokenIds = _createAllPools(tokenAddr, _totalSupply, baseAmounts);

        // 5. Deploy SporeReactor, transfer NFTs, give admin to grower
        reactorAddr = _setupReactor(tokenAddr, tokenIds, msg.sender);

        // 6. Refund dust
        _refundDust(tokenAddr, msg.sender);

        // 7. Record spore in mycelium
        uint256 sporeId = spores.length;
        spores.push(Spore({
            token:       tokenAddr,
            reactor:     reactorAddr,
            grower:      msg.sender,
            seed:        msg.value,
            timestamp:   block.timestamp,
            connections: 0,
            meshed:      isMeshed
        }));
        tokenToSporeId[tokenAddr]    = sporeId + 1;
        reactorToSporeId[reactorAddr] = sporeId + 1;

        emit Sporulated(tokenAddr, reactorAddr, msg.sender, _name, _symbol, _totalSupply, msg.value, isMeshed);
    }

    // =========================================================================
    //  Mycelium — mesh connection tracking
    // =========================================================================

    /// @notice Record a mesh connection to a spore. Called by keeper/wildcard after pool creation.
    function recordMeshConnection(address toToken) external {
        require(msg.sender == owner, "not owner");
        uint256 id = tokenToSporeId[toToken];
        require(id > 0, "token not found");
        spores[id - 1].connections++;
        emit MeshConnected(address(0), toToken, spores[id - 1].connections);
    }

    /// @notice Get up to 5 mesh-eligible spores (meshed, under MAX_MESH_CONNECTIONS).
    ///         Returns most recent eligible first.
    function getMeshTargets(uint256 maxTargets) external view returns (address[] memory tokens, address[] memory reactors) {
        if (maxTargets > 5) maxTargets = 5;

        tokens   = new address[](maxTargets);
        reactors = new address[](maxTargets);
        uint256 found;

        // Walk backwards from newest to find eligible spores
        for (uint256 i = spores.length; i > 0 && found < maxTargets; --i) {
            Spore storage s = spores[i - 1];
            if (s.meshed && s.connections < MAX_MESH_CONNECTIONS) {
                tokens[found]   = s.token;
                reactors[found] = s.reactor;
                found++;
            }
        }

        // Trim arrays if fewer found
        if (found < maxTargets) {
            assembly {
                mstore(tokens, found)
                mstore(reactors, found)
            }
        }
    }

    /// @notice Check if a specific token is mesh-eligible
    function isMeshEligible(address token) external view returns (bool) {
        uint256 id = tokenToSporeId[token];
        if (id == 0) return false;
        Spore storage s = spores[id - 1];
        return s.meshed && s.connections < MAX_MESH_CONNECTIONS;
    }

    // =========================================================================
    //  Internal — prepare seed (wrap + swap)
    // =========================================================================

    function _prepareSeed(uint256 ethAmount) internal returns (uint256[3] memory amounts) {
        // Wrap all ETH to WETH
        IWETH(weth).deposit{value: ethAmount}();

        uint256 wethForUsdc = ethAmount * SEED_USDC / 10000;
        uint256 wethKeep    = ethAmount * SEED_WETH / 10000;
        uint256 wethForBtc  = ethAmount - wethForUsdc - wethKeep;

        // Swap WETH -> USDC
        IERC20(weth).approve(swapRouter, wethForUsdc + wethForBtc);

        amounts[0] = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           weth,
                tokenOut:          usdc,
                fee:               wethUsdcFee,
                recipient:         address(this),
                amountIn:          wethForUsdc,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: 0
            })
        );

        // WETH kept for WETH pool
        amounts[1] = wethKeep;

        // Swap WETH -> cbBTC
        amounts[2] = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           weth,
                tokenOut:          wrappedBtc,
                fee:               wethBtcFee,
                recipient:         address(this),
                amountIn:          wethForBtc,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    // =========================================================================
    //  Internal — create all 3 pools and mint positions
    // =========================================================================

    function _createAllPools(
        address tokenAddr,
        uint256 supply,
        uint256[3] memory baseAmounts
    ) internal returns (uint256[3] memory tokenIds) {
        tokenIds[0] = _createPoolAndMint(tokenAddr, usdc,  supply * BPS_USDC_POOL / 10000, baseAmounts[0]);
        tokenIds[1] = _createPoolAndMint(tokenAddr, weth,  supply * BPS_WETH_POOL / 10000, baseAmounts[1]);
        tokenIds[2] = _createPoolAndMint(tokenAddr, wrappedBtc, supply * BPS_BTC_POOL  / 10000, baseAmounts[2]);
    }

    function _createPoolAndMint(
        address tokenAddr,
        address baseAsset,
        uint256 tokenAmount,
        uint256 baseAmount
    ) internal returns (uint256 tokenId) {
        // Sort tokens (V3 requires token0 < token1)
        bool tokenIs0 = tokenAddr < baseAsset;
        address token0 = tokenIs0 ? tokenAddr : baseAsset;
        address token1 = tokenIs0 ? baseAsset : tokenAddr;
        uint256 amount0 = tokenIs0 ? tokenAmount : baseAmount;
        uint256 amount1 = tokenIs0 ? baseAmount  : tokenAmount;

        // Create and initialize pool
        address pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, FEE_TIER);
        IUniswapV3Pool(pool).initialize(_calcSqrtPrice(amount0, amount1));

        // Approve tokens to position manager
        IERC20(token0).approve(positionManager, amount0);
        IERC20(token1).approve(positionManager, amount1);

        // Mint full-range position
        (tokenId, , ,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0:         token0,
                token1:         token1,
                fee:            FEE_TIER,
                tickLower:      TICK_LOWER,
                tickUpper:      TICK_UPPER,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min:     0,
                amount1Min:     0,
                recipient:      address(this),
                deadline:       block.timestamp
            })
        );
    }

    // =========================================================================
    //  Internal — setup reactor and lock NFTs
    // =========================================================================

    function _setupReactor(
        address tokenAddr,
        uint256[3] memory tokenIds,
        address grower
    ) internal returns (address reactorAddr) {
        reactorAddr = _cloneReactor();
        ISporeReactor(reactorAddr).initialize(
            tokenAddr,
            mft,
            positionManager,
            swapRouter,
            v3Factory,
            reactorPrime
        );

        for (uint256 i; i < 3; ++i) {
            _transferNFT(tokenIds[i], reactorAddr);
            ISporeReactor(reactorAddr).addPool(tokenIds[i]);
        }

        // Transfer admin to grower — they can add pools but never withdraw
        ISporeReactor(reactorAddr).transferAdmin(grower);
    }

    // =========================================================================
    //  Internal — math
    // =========================================================================

    /// @dev sqrtPriceX96 = sqrt(amount1 / amount0) * 2^96
    function _calcSqrtPrice(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "zero amounts");
        uint256 s1 = _sqrt(amount1);
        uint256 s0 = _sqrt(amount0);
        uint256 result = (s1 << 96) / s0;
        require(result > 0 && result <= type(uint160).max, "price overflow");
        return uint160(result);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // =========================================================================
    //  Internal — clone reactor (EIP-1167)
    // =========================================================================

    function _cloneReactor() internal returns (address instance) {
        address impl = reactorImplementation;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "clone failed");
    }

    // =========================================================================
    //  Internal — transfer V3 position NFT
    // =========================================================================

    function _transferNFT(uint256 tokenId, address to) internal {
        (bool success,) = positionManager.call(
            abi.encodeWithSignature(
                "safeTransferFrom(address,address,uint256)",
                address(this), to, tokenId
            )
        );
        require(success, "NFT transfer failed");
    }

    // =========================================================================
    //  Internal — refund dust
    // =========================================================================

    function _refundDust(address tokenAddr, address to) internal {
        uint256 bal;

        bal = IERC20(tokenAddr).balanceOf(address(this));
        if (bal > 0) IERC20(tokenAddr).transfer(to, bal);

        bal = IERC20(weth).balanceOf(address(this));
        if (bal > 0) IERC20(weth).transfer(to, bal);

        bal = IERC20(usdc).balanceOf(address(this));
        if (bal > 0) IERC20(usdc).transfer(to, bal);

        bal = IERC20(wrappedBtc).balanceOf(address(this));
        if (bal > 0) IERC20(wrappedBtc).transfer(to, bal);
    }

    // =========================================================================
    //  NFT receiver
    // =========================================================================

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // =========================================================================
    //  Admin
    // =========================================================================

    function setMinSeed(uint256 _minSeed) external {
        require(msg.sender == owner, "not owner");
        minSeed = _minSeed;
    }

    function setMeshSeed(uint256 _meshSeed) external {
        require(msg.sender == owner, "not owner");
        meshSeed = _meshSeed;
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

    // =========================================================================
    //  Views
    // =========================================================================

    function launchCount() external view returns (uint256) {
        return spores.length;
    }

    function getSpore(uint256 index) external view returns (
        address token, address reactor, address grower,
        uint256 seed, uint256 timestamp, uint256 connections, bool meshed
    ) {
        Spore storage s = spores[index];
        return (s.token, s.reactor, s.grower, s.seed, s.timestamp, s.connections, s.meshed);
    }
}
