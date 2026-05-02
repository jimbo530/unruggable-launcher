// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MycoGrove — Guarded launchpad for tree planting impact tokens
/// @notice Each launch: deploy token (supply = trees planted), create 5 base pools
///         + up to 10 chain pools with previous tree tokens, deploy burn reactor,
///         deploy volume-based charity vesting. One function. Auto-chains.
///
///         Seed split ($200 target, paid in ETH):
///           Base:  $30 AZUSD / $20 BTC / $20 ETH / $15 MfT / $15 MGROW
///           Chain: ~$10 each x up to 10 previous tree tokens
///
///         Supply: 50% charity vesting (burn-proportional), 50% across pools.
///         Reactor burns tree token from all pool fees. Vesting reads burns on-chain.
///         Every new launch buys previous tree tokens — planting trees funds trees.

import "./LaunchToken.sol";

// ═══════════════════════════════════════════════════════════════════════════
//  Interfaces
// ═══════════════════════════════════════════════════════════════════════════

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
}

interface IUniswapV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
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

interface IVolumeVesting {
    function initialize(address _token, address _charity, address _burnAddress, uint256 _totalAllocation, uint256 _vestRateBPS) external;
}

// ═══════════════════════════���═══════════════════════════════��═══════════════
//  Contract
// ═══════════════════════���═══════════════════════════════���═══════════════════

contract TreeLaunchFactory {

    // ── Constants ──────────────────────────────────────────────────────────
    address constant BURN       = 0xfd780B0aE569e15e514B819ecFDF46f804953a4B;
    uint24  constant POOL_FEE   = 10000;     // 1% fee tier for all tree pools
    int24   constant TICK_LOWER = -887200;   // full range for tick spacing 200
    int24   constant TICK_UPPER =  887200;
    uint256 constant VEST_RATE  = 5000;      // 0.5 tokens vest per 1 burned
    uint256 constant MAX_CHAIN  = 10;        // max chain connections per launch

    // Base seed weights (BPS within base portion, total = 10000)
    uint256 constant W_AZUSD = 3000;  // 30%
    uint256 constant W_BTC   = 2000;  // 20%
    uint256 constant W_ETH   = 2000;  // 20%
    uint256 constant W_MFT   = 1500;  // 15%
    // W_MGROW = remainder     1500   // 15%

    // ── Immutables ────────────────────────────────────────────────────────
    address public immutable weth;
    address public immutable azusd;
    address public immutable wrappedBtc;
    address public immutable mft;
    address public immutable mgrow;

    uint24 public immutable feeAzusd;    // WETH/AZUSD pool fee for seed swap
    uint24 public immutable feeBtc;      // WETH/cbBTC pool fee
    uint24 public immutable feeMft;      // WETH/MfT pool fee
    uint24 public immutable feeMgrow;    // WETH/MGROW pool fee

    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable swapRouter;
    address public immutable reactorImpl;
    address public immutable vestingImpl;
    address public immutable reactorPrime;

    // ── State ─────────────────────────────────────────────────────────────
    address public owner;
    mapping(address => bool) public approved;

    struct Sapling {
        address token;
        address reactor;
        address vesting;
        address charity;
        uint256 treeCount;
        uint256 seed;
        uint256 pools;
        uint256 timestamp;
    }
    Sapling[] public saplings;
    mapping(address => uint256) public tokenToSaplingId; // token -> index + 1

    // ── Events ────────────────────────────────────────────────────────────
    event TreePlanted(
        uint256 indexed saplingId,
        address indexed token,
        address indexed charity,
        uint256 treeCount,
        uint256 seed,
        uint256 pools
    );
    event GrowerApproved(address indexed grower, bool status);

    // ═══════════════════════════════════════════════════════════════════════
    //  Constructor
    // ══════���════════════════════════════════════════════════════════════════

    constructor(
        address _weth,
        address _azusd,
        address _wrappedBtc,
        address _mft,
        address _mgrow,
        uint24  _feeAzusd,
        uint24  _feeBtc,
        uint24  _feeMft,
        uint24  _feeMgrow,
        address _v3Factory,
        address _pm,
        address _router,
        address _reactorImpl,
        address _vestingImpl,
        address _reactorPrime
    ) {
        weth            = _weth;
        azusd           = _azusd;
        wrappedBtc      = _wrappedBtc;
        mft             = _mft;
        mgrow           = _mgrow;
        feeAzusd        = _feeAzusd;
        feeBtc          = _feeBtc;
        feeMft          = _feeMft;
        feeMgrow        = _feeMgrow;
        v3Factory       = _v3Factory;
        positionManager = _pm;
        swapRouter      = _router;
        reactorImpl     = _reactorImpl;
        vestingImpl     = _vestingImpl;
        reactorPrime    = _reactorPrime;
        owner           = msg.sender;
    }

    // ═════════════════════════════════════════════���═════════════════════════
    //  Plant — one function, auto-wires everything
    // ═══════════════════════════════════════════���═══════════════════════════

    function plant(
        string calldata _name,
        uint256 _treeCount,
        address _charity
    ) external payable returns (address tokenAddr, address reactorAddr, address vestingAddr) {
        require(msg.sender == owner || approved[msg.sender], "not approved");
        require(_treeCount > 0 && _charity != address(0) && msg.value > 0, "bad input");

        uint256 totalSupply = _treeCount * 1e18;

        // 1. Deploy token — all supply to this contract
        tokenAddr = address(new LaunchToken(
            _name,
            string(abi.encodePacked("TREE-", _uint2str(saplings.length + 1))),
            totalSupply,
            address(this)
        ));

        // 2. Deploy vesting — 50% to charity
        vestingAddr = _setupVesting(tokenAddr, _charity, totalSupply / 2);

        // 3-4. Prepare seeds + create pools
        uint256 numPools;
        (reactorAddr, numPools) = _setupPoolsAndReactor(tokenAddr, totalSupply / 2, msg.value);

        // 5. Register sapling in the grove
        saplings.push(Sapling({
            token:     tokenAddr,
            reactor:   reactorAddr,
            vesting:   vestingAddr,
            charity:   _charity,
            treeCount: _treeCount,
            seed:      msg.value,
            pools:     numPools,
            timestamp: block.timestamp
        }));
        tokenToSaplingId[tokenAddr] = saplings.length; // length is already index + 1

        emit TreePlanted(saplings.length - 1, tokenAddr, _charity, _treeCount, msg.value, numPools);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Setup vesting contract
    // ═══════════════════════════════════════════════════════════════════════

    function _setupVesting(address tokenAddr, address _charity, uint256 amount) internal returns (address v) {
        v = _cloneVesting();
        IERC20(tokenAddr).transfer(v, amount);
        IVolumeVesting(v).initialize(tokenAddr, _charity, BURN, amount, VEST_RATE);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Create all pools + deploy reactor
    // ═══════════════════════════════════════════════════════════════════════

    function _setupPoolsAndReactor(
        address tokenAddr,
        uint256 supplyForPools,
        uint256 ethSeed
    ) internal returns (address reactorAddr, uint256 numPools) {
        uint256 numChain = saplings.length < MAX_CHAIN ? saplings.length : MAX_CHAIN;
        numPools = 5 + numChain;

        (
            address[] memory pairTokens,
            uint256[] memory pairAmounts,
            uint256[] memory ethWeights
        ) = _prepareSeed(ethSeed, numChain);

        // Create pools + mint positions
        uint256[] memory tokenIds = new uint256[](numPools);
        for (uint256 i; i < numPools; i++) {
            tokenIds[i] = _createPoolAndMint(
                tokenAddr, pairTokens[i],
                supplyForPools * ethWeights[i] / ethSeed,
                pairAmounts[i]
            );
        }

        // Deploy reactor — factory stays admin
        reactorAddr = _cloneReactor();
        ISporeReactor(reactorAddr).initialize(tokenAddr, mft, positionManager, swapRouter, v3Factory, reactorPrime);

        for (uint256 i; i < numPools; i++) {
            _transferNFT(tokenIds[i], reactorAddr);
            ISporeReactor(reactorAddr).addPool(tokenIds[i]);
        }

        // Refund dust
        _refundDust(tokenAddr, pairTokens, msg.sender);
    }

    // ═══════════════════════��════════════════════════════════��══════════════
    //  Internal — Prepare Seed (wrap ETH + buy all pair tokens)
    // ═══════════════════════════════════════════════════════════════════════

    function _prepareSeed(uint256 ethAmount, uint256 numChain) internal returns (
        address[] memory pairTokens,
        uint256[] memory pairAmounts,
        uint256[] memory ethWeights
    ) {
        uint256 numPools = 5 + numChain;
        pairTokens  = new address[](numPools);
        pairAmounts = new uint256[](numPools);
        ethWeights  = new uint256[](numPools);

        // Split: 50% base / 50% chain (or 100% base if no chain tokens yet)
        uint256 basePortion = numChain > 0 ? ethAmount / 2 : ethAmount;
        uint256 chainPortion = ethAmount - basePortion;

        // Base weights within base portion
        uint256 ethForAzusd = basePortion * W_AZUSD / 10000;
        uint256 ethForBtc   = basePortion * W_BTC   / 10000;
        uint256 ethForEth   = basePortion * W_ETH   / 10000;
        uint256 ethForMft   = basePortion * W_MFT   / 10000;
        uint256 ethForMgrow = basePortion - ethForAzusd - ethForBtc - ethForEth - ethForMft;

        ethWeights[0] = ethForAzusd;
        ethWeights[1] = ethForBtc;
        ethWeights[2] = ethForEth;
        ethWeights[3] = ethForMft;
        ethWeights[4] = ethForMgrow;

        // Chain weights — even split, remainder to last
        if (numChain > 0) {
            uint256 ethPerChain = chainPortion / numChain;
            for (uint256 i; i < numChain; i++) {
                ethWeights[5 + i] = ethPerChain;
            }
            uint256 assigned = ethPerChain * numChain;
            if (assigned < chainPortion) {
                ethWeights[5 + numChain - 1] += chainPortion - assigned;
            }
        }

        // Wrap ALL ETH to WETH
        IWETH(weth).deposit{value: ethAmount}();
        IERC20(weth).approve(swapRouter, ethAmount);

        // Buy base assets
        pairTokens[0] = azusd;
        pairAmounts[0] = _swap(weth, azusd, feeAzusd, ethForAzusd);

        pairTokens[1] = wrappedBtc;
        pairAmounts[1] = _swap(weth, wrappedBtc, feeBtc, ethForBtc);

        pairTokens[2] = weth;
        pairAmounts[2] = ethForEth; // keep as WETH — no swap needed

        pairTokens[3] = mft;
        pairAmounts[3] = _swap(weth, mft, feeMft, ethForMft);

        pairTokens[4] = mgrow;
        pairAmounts[4] = _swap(weth, mgrow, feeMgrow, ethForMgrow);

        // Buy chain tokens (most recent tree tokens first)
        for (uint256 i; i < numChain; i++) {
            uint256 chainIdx = saplings.length - 1 - i;
            address chainToken = saplings[chainIdx].token;
            pairTokens[5 + i]  = chainToken;
            pairAmounts[5 + i] = _swap(weth, chainToken, POOL_FEE, ethWeights[5 + i]);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Create V3 pool + mint full-range position
    // ════���══════════════════════════════��══════════════════════════════════���

    function _createPoolAndMint(
        address tokenAddr,
        address baseAsset,
        uint256 tokenAmount,
        uint256 baseAmount
    ) internal returns (uint256 tokenId) {
        require(tokenAmount > 0 && baseAmount > 0, "zero pool amounts");

        bool tokenIs0 = tokenAddr < baseAsset;
        address token0 = tokenIs0 ? tokenAddr : baseAsset;
        address token1 = tokenIs0 ? baseAsset : tokenAddr;
        uint256 amount0 = tokenIs0 ? tokenAmount : baseAmount;
        uint256 amount1 = tokenIs0 ? baseAmount  : tokenAmount;

        // Create + initialize pool if it doesn't exist
        address pool = IUniswapV3Factory(v3Factory).getPool(token0, token1, POOL_FEE);
        if (pool == address(0)) {
            pool = IUniswapV3Factory(v3Factory).createPool(token0, token1, POOL_FEE);
            IUniswapV3Pool(pool).initialize(_calcSqrtPrice(amount0, amount1));
        }

        // Approve position manager for both tokens
        IERC20(token0).approve(positionManager, amount0);
        IERC20(token1).approve(positionManager, amount1);

        // Mint full-range position
        (tokenId, , ,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0:         token0,
                token1:         token1,
                fee:            POOL_FEE,
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

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Swap via Uniswap V3 router
    // ══════════════════════════════════════════════���════════════════════════

    function _swap(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) internal returns (uint256) {
        if (amountIn == 0) return 0;
        return ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn:           tokenIn,
                tokenOut:          tokenOut,
                fee:               fee,
                recipient:         address(this),
                amountIn:          amountIn,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    // ═══════════════════════════════════════════���═══════════════════════════
    //  Internal — Clone contracts (EIP-1167 minimal proxy)
    // ════════════════════════════════════════��══════════════════════════════

    function _cloneReactor() internal returns (address instance) {
        address impl = reactorImpl;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "reactor clone failed");
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
        require(instance != address(0), "vesting clone failed");
    }

    // ═════════════════════════���════════════════════════════════���════════════
    //  Internal — Transfer V3 position NFT to reactor
    // ═══════════════════════════════════════════════════════════════════════

    function _transferNFT(uint256 tokenId, address to) internal {
        (bool success,) = positionManager.call(
            abi.encodeWithSignature(
                "safeTransferFrom(address,address,uint256)",
                address(this), to, tokenId
            )
        );
        require(success, "NFT transfer failed");
    }

    // ═══════════════════════════════════════════════���═══════════════════════
    //  Internal — Refund leftover dust to caller
    // ═══════════════════════════════════════════════════════════════════════

    function _refundDust(address tokenAddr, address[] memory pairTokens, address to) internal {
        uint256 bal;

        // Tree token dust
        bal = IERC20(tokenAddr).balanceOf(address(this));
        if (bal > 0) IERC20(tokenAddr).transfer(to, bal);

        // WETH dust
        bal = IERC20(weth).balanceOf(address(this));
        if (bal > 0) IERC20(weth).transfer(to, bal);

        // All pair token dust
        for (uint256 i; i < pairTokens.length; i++) {
            if (pairTokens[i] == weth) continue; // already handled
            bal = IERC20(pairTokens[i]).balanceOf(address(this));
            if (bal > 0) IERC20(pairTokens[i]).transfer(to, bal);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Math helpers
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev sqrtPriceX96 = sqrt(amount1 / amount0) * 2^96
    function _calcSqrtPrice(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "zero amounts");
        uint256 result = (_sqrt(amount1) << 96) / _sqrt(amount0);
        require(result > 0 && result <= type(uint160).max, "price overflow");
        return uint160(result);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    function _uint2str(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin — add pool to existing reactor (for post-launch wildcards)
    // ════════════════════════════════════���══════════════════════════════════

    /// @notice Add a V3 position to an existing tree reactor. Caller must approve
    ///         the position manager NFT to this factory first.
    function addPoolToReactor(uint256 saplingId, uint256 positionTokenId) external {
        require(msg.sender == owner, "not owner");
        require(saplingId < saplings.length, "invalid sapling");
        address reactor = saplings[saplingId].reactor;

        // Pull NFT from caller (requires prior PM.approve(factory, tokenId))
        (bool pulled,) = positionManager.call(
            abi.encodeWithSignature(
                "transferFrom(address,address,uint256)",
                msg.sender, address(this), positionTokenId
            )
        );
        require(pulled, "NFT pull failed");

        // Forward to reactor + register
        _transferNFT(positionTokenId, reactor);
        ISporeReactor(reactor).addPool(positionTokenId);
    }

    /// @notice Release reactor admin to owner (for direct management)
    function transferReactorAdmin(uint256 saplingId, address newAdmin) external {
        require(msg.sender == owner, "not owner");
        require(saplingId < saplings.length, "invalid sapling");
        ISporeReactor(saplings[saplingId].reactor).transferAdmin(newAdmin);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin — access control
    // ═══════════════════════════════════════════════════════════════════════

    function approveGrower(address grower, bool status) external {
        require(msg.sender == owner, "not owner");
        approved[grower] = status;
        emit GrowerApproved(grower, status);
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "not owner");
        require(newOwner != address(0), "zero owner");
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

    function saplingCount() external view returns (uint256) {
        return saplings.length;
    }

    function getSapling(uint256 index) external view returns (
        address token, address reactor, address vesting, address charity,
        uint256 treeCount, uint256 seed, uint256 pools, uint256 timestamp
    ) {
        Sapling storage s = saplings[index];
        return (s.token, s.reactor, s.vesting, s.charity, s.treeCount, s.seed, s.pools, s.timestamp);
    }

    /// @notice Get the most recent tree token addresses (for chain reference)
    function getChainTargets(uint256 count) external view returns (address[] memory tokens) {
        if (count > saplings.length) count = saplings.length;
        if (count > MAX_CHAIN) count = MAX_CHAIN;
        tokens = new address[](count);
        for (uint256 i; i < count; i++) {
            tokens[i] = saplings[saplings.length - 1 - i].token;
        }
    }

    function totalTreesPlanted() external view returns (uint256 total) {
        for (uint256 i; i < saplings.length; i++) {
            total += saplings[i].treeCount;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  NFT receiver — accept V3 positions during pool creation
    // ═══════════════════════════════════════════════════════════════════════

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
