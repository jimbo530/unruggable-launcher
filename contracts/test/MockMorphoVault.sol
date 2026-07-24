// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice TEST-ONLY mock of a Morpho Vault V2 ERC-4626 whose withdraw() can be
///         toggled to revert — to prove CharityVaultMorpho surfaces the honest
///         "insufficient vault liquidity" reason instead of leaking or faking.
///         NEVER deployed to any live chain.
contract MockMorphoVault is ERC20 {
    IERC20 public immutable underlying;
    bool public liquidityFrozen;      // when true, withdraw() reverts (illiquid)
    uint256 public sharePriceBps = 10000; // 10000 = 1.0000; >10000 simulates yield

    constructor(address _underlying) ERC20("Mock steakUSDG", "mUSDG") {
        underlying = IERC20(_underlying);
    }

    function asset() external view returns (address) { return address(underlying); }

    function setLiquidityFrozen(bool v) external { liquidityFrozen = v; }
    function setSharePriceBps(uint256 v) external { sharePriceBps = v; }

    function decimals() public pure override returns (uint8) { return 18; }

    // assets(6dec) -> shares(18dec) at inverse share price
    function _sharesFor(uint256 assets) internal view returns (uint256) {
        return (assets * 1e12 * 10000) / sharePriceBps;
    }
    // shares(18dec) -> assets(6dec) at share price
    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * sharePriceBps) / (1e12 * 10000);
    }
    function previewWithdraw(uint256 assets) external view returns (uint256) {
        return _sharesFor(assets);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        underlying.transferFrom(msg.sender, address(this), assets);
        shares = _sharesFor(assets);
        _mint(receiver, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        require(!liquidityFrozen, "MOCK: illiquid");
        shares = _sharesFor(assets);
        _burn(owner, shares);
        underlying.transfer(receiver, assets);
    }
}

/// @notice TEST-ONLY 6-dec ERC20 to stand in for USDG in local unit tests.
contract MockUSDG is ERC20 {
    constructor() ERC20("Mock USDG", "USDG") { _mint(msg.sender, 1_000_000e6); }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// @notice TEST-ONLY meme token (18 dec) for the meme-buy legs.
contract MockMeme is ERC20 {
    constructor() ERC20("Mock Meme for Trees", "MMfT") { _mint(msg.sender, 1_000_000_000e18); }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// @notice TEST-ONLY Uniswap-V2-style router. Swaps USDG(6dec)→meme(18dec) at a
///         fixed rate and mints "LP" as a receipt. Can be toggled to fail either
///         call to prove CharityVaultMorpho reverts honestly. NEVER live.
contract MockRouter {
    IERC20 public immutable usdg;
    MockMeme public immutable meme;
    uint256 public memePerUsdg = 1000; // 1 USDG(1e6) -> 1000 meme(1e18)  (arbitrary)
    bool public swapFrozen;
    bool public addFrozen;

    constructor(address _usdg, address _meme) { usdg = IERC20(_usdg); meme = MockMeme(_meme); }
    function setSwapFrozen(bool v) external { swapFrozen = v; }
    function setAddFrozen(bool v) external { addFrozen = v; }
    function setRate(uint256 r) external { memePerUsdg = r; }

    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256)
        external returns (uint256[] memory amounts)
    {
        require(!swapFrozen, "MOCK: swap frozen");
        require(path.length == 2 && path[0] == address(usdg) && path[1] == address(meme), "MOCK: bad path");
        usdg.transferFrom(msg.sender, address(this), amountIn);
        // USDG(6dec) -> meme(18dec) at `memePerUsdg` meme per whole USDG:
        //   1 USDG = 1e6 raw -> memePerUsdg * 1e18 meme.  factor = 1e18*mpu/1e6 = mpu*1e12
        uint256 out = amountIn * memePerUsdg * 1e12;
        require(out >= amountOutMin, "MOCK: insufficient output");
        meme.mint(to, out);
        amounts = new uint256[](2);
        amounts[0] = amountIn; amounts[1] = out;
    }

    function addLiquidity(address, address, uint256 amountADesired, uint256 amountBDesired, uint256, uint256, address to, uint256)
        external returns (uint256, uint256, uint256)
    {
        require(!addFrozen, "MOCK: add frozen");
        // pull both sides, mint a trivial LP receipt (meme token stands in as "LP")
        usdg.transferFrom(msg.sender, address(this), amountADesired);
        meme.transferFrom(msg.sender, address(this), amountBDesired);
        meme.mint(to, 1e18); // token of "LP" to the recipient
        return (amountADesired, amountBDesired, 1e18);
    }
}
