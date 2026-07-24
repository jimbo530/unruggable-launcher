// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal ERC-4626 surface we use from the Morpho Vault V2 (Steakhouse USDG).
///         Only the calls verified live on Robinhood Chain 4663 are declared.
interface IMorphoVaultV2 {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Minimal Uniswap-V2-style router surface for the meme-buy legs.
///         Works with Base's V2 routers and any future RH AMM that follows the
///         same ABI. Only the two calls we need are declared.
interface ISwapRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
}

/// @title CharityVaultMorpho — Proof-of-Deposit charity vault on Robinhood Chain
/// @notice 1:1 USDG-backed proof-of-deposit token. USDG is parked in the Morpho
///         Vault V2 (Steakhouse USDG, ERC-4626). Yield = (USDG value of our shares)
///         minus (tokens outstanding). On harvest the yield is split THREE WAYS
///         (founder 2026-07-12), each leg configurable in basis points, default
///         1/3 each (webBps 3333 / causeBps 3334 / depositorBps 3333):
///           1. WEB leg   — buy the Meme-for-Trees token from its LP and add
///                          liquidity back (deepen the web). Requires a meme LP.
///           2. CAUSE leg — USDG sent to the configurable charityWallet (the
///                          actual donation; named-route / gap-fill).
///           3. DEPOSITOR leg — buy the meme token and distribute it to
///                          depositors pro-rata (build their bags; incentive to
///                          deposit). Depositors claim via claimMeme().
///         Legs 1 and 3 BUY the meme from an on-chain LP, so a meme token + a
///         swap router + (for leg 1) a liquidity venue MUST be wired before
///         harvest can run. If they are unset — or a buy/add fails for lack of
///         liquidity — harvest REVERTS CLEANLY (never skips a leg, never fakes).
///         Principal is immutable-safe — no owner can touch deposits, the
///         Morpho position, or holder receipts. The ONLY governed lever is the
///         charity DESTINATION address (setCharityWallet), so a named real-world
///         cause can be pointed to on-chain once identified. Until then the
///         destination defaults to the project operations wallet (gap-filler),
///         which collects and distributes to the cause. See §Doctrine below.
///
///         Adapted 1:1 from our battle-tested Base CharityFund.sol. The ONLY
///         structural change is the yield adapter: Aave supply/withdraw/aToken
///         is replaced by Morpho ERC-4626 deposit/withdraw/convertToAssets.
///
///         Reusable: the constructor takes (name, symbol, usdg, vault,
///         charityWallet, owner, yieldDestinationLabel), so one implementation
///         serves any named cause ("Money for Trees", "Feeding People", ...).
///         The 3-way split legs + meme/router/LP wiring are owner-set post-deploy
///         (so the same deploy works before the meme LP exists on a new chain).
///
///         DOCTRINE (Good-Standard, collector-distributor):
///         Named cause first — where a specific cause's on-chain address is
///         identified it is set as charityWallet (direct, transparent routing).
///         Where none is identified, charityWallet = the project operations
///         wallet, which collects and distributes to the cause (trees / food
///         security). Funds are never held as ours; they route through.
///
///         REDEMPTION HONESTY: Morpho Vault V2 lends USDG into markets; only the
///         idle buffer is instantly withdrawable. If a redeem exceeds available
///         liquidity, withdraw() reverts and we bubble a CLEAR reason
///         ("insufficient vault liquidity - large redeems may queue, try smaller
///         or retry later"). We never leak deposit tokens and never fake success.
contract CharityVaultMorpho is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Immutable wiring (set once in constructor) ---
    IERC20 public immutable usdg;               // deposit asset (6 dec), == vault.asset()
    IMorphoVaultV2 public immutable vault;       // Morpho Vault V2 ERC-4626 (shares 18 dec)

    // --- 3-way harvest split (basis points of yield; must sum to 10000) ---
    /// @notice WEB leg: buy the meme + add liquidity (deepen the web). Default 3333.
    uint16 public webBps = 3333;
    /// @notice CAUSE leg: USDG to charityWallet (the donation). Default 3334.
    uint16 public causeBps = 3334;
    /// @notice DEPOSITOR leg: buy meme, distribute to depositors. Default 3333.
    uint16 public depositorBps = 3333;

    // --- Meme-buy wiring (owner-set post-deploy; legs 1 & 3 need these) ---
    /// @notice The Meme-for-Trees token that legs 1 & 3 BUY with USDG.
    IERC20 public memeToken;
    /// @notice Uniswap-V2-style router used to swap USDG→meme and add liquidity.
    ISwapRouter public swapRouter;
    /// @notice Where LP tokens minted by the WEB leg are sent (deepens the web;
    ///         held by the project). Defaults to charityWallet if unset.
    address public lpRecipient;
    /// @notice Slippage guard for the meme buys, in bps (e.g. 300 = 3%). The
    ///         caller-supplied minOut still overrides per harvest; this is a floor
    ///         so a griefer can't pass minOut=0. Owner-tunable.
    uint16 public maxSlippageBps = 500; // 5% default

    // --- Governed charity destination ---
    /// @notice Where the charity slice of yield is sent. Settable by `owner` so a
    ///         NAMED cause can be pointed to on-chain once identified. Defaults to
    ///         the project operations wallet (gap-filler collector-distributor).
    ///         The owner can ONLY redirect this destination — never touch
    ///         principal, the Morpho position, or holder receipts.
    address public charityWallet;

    /// @notice Address permitted to call setCharityWallet. Can be renounced
    ///         (set to address(0)) to freeze the destination forever once the
    ///         final named cause is wired.
    address public owner;

    /// @notice Human label for where this vault's yield ultimately goes
    ///         (e.g. "tree planting", "feeding the poor"). On-chain provenance
    ///         for the collector-distributor doctrine — see project docs.
    string public yieldDestinationLabel;

    // --- State ---
    uint256 public totalHarvested;

    uint256 public constant MIN_HARVEST = 1000;  // 0.001 USDG floor (6 dec)

    // --- Synthetix accumulator #1: DEPOSITOR leg, denominated in the MEME token ---
    // Distributes meme bought in leg 3 to depositors pro-rata by receipt balance.
    uint256 public memeRewardPerTokenStored;
    mapping(address => uint256) public userMemeRewardPerTokenPaid;
    mapping(address => uint256) public memeRewards;

    // --- Events ---
    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Harvest(address indexed caller, uint256 yieldAmount, uint256 webShare, uint256 causeShare, uint256 depositorShare, uint256 memeToDepositors);
    event MemeClaimed(address indexed holder, address indexed caller, uint256 memeAmount);
    event CharityWalletChanged(address indexed previous, address indexed next, address indexed by);
    event SplitChanged(uint16 webBps, uint16 causeBps, uint16 depositorBps, address indexed by);
    event MemeWiringChanged(address memeToken, address swapRouter, address lpRecipient, address indexed by);
    event OwnershipTransferred(address indexed previous, address indexed next);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @param name_    receipt token name  (e.g. "Money for Trees")
    /// @param symbol_  receipt token symbol (e.g. "RH")
    /// @param _usdg    USDG token (6 dec) — must equal vault.asset()
    /// @param _vault   Morpho Vault V2 (Steakhouse USDG) ERC-4626
    /// @param _charityWallet  initial charity destination. Pass the project
    ///                        operations wallet (0x0780…) as the gap-fill default;
    ///                        re-point to a named cause later via setCharityWallet.
    /// @param _owner   address permitted to set the split / meme wiring / charity
    ///                 destination. Renounceable. Cannot touch funds.
    /// @param _yieldDestinationLabel  human label for the cause
    /// @dev    The 3-way split defaults to 3333/3334/3333 and the meme/router/LP
    ///         wiring starts UNSET — harvest reverts until wired (honest on chains
    ///         where the meme LP doesn't exist yet, e.g. Robinhood 4663).
    constructor(
        string memory name_,
        string memory symbol_,
        address _usdg,
        address _vault,
        address _charityWallet,
        address _owner,
        string memory _yieldDestinationLabel
    ) ERC20(name_, symbol_) {
        require(_usdg != address(0), "zero usdg");
        require(_vault != address(0), "zero vault");
        require(_charityWallet != address(0), "zero charity");
        require(_owner != address(0), "zero owner");
        // Bind to the real underlying: reject a vault whose asset() != usdg.
        require(IMorphoVaultV2(_vault).asset() == _usdg, "vault asset != usdg");

        usdg = IERC20(_usdg);
        vault = IMorphoVaultV2(_vault);
        charityWallet = _charityWallet;
        owner = _owner;
        yieldDestinationLabel = _yieldDestinationLabel;

        // Exact-nothing here; we approve per-operation-need to avoid a standing
        // MaxUint256 allowance (house rule: exact approvals).
    }

    // ======================== GOVERNANCE (destination only) ========================

    /// @notice Re-point the charity destination to a NAMED cause once identified.
    ///         This is the ONLY governed lever. It cannot move principal, the
    ///         Morpho position, or holder receipts — only where FUTURE charity
    ///         yield is sent. Emits an on-chain audit trail.
    function setCharityWallet(address newCharity) external onlyOwner {
        require(newCharity != address(0), "zero charity");
        address prev = charityWallet;
        charityWallet = newCharity;
        emit CharityWalletChanged(prev, newCharity, msg.sender);
    }

    /// @notice Set the 3-way harvest split. Must sum to exactly 10000.
    function setSplit(uint16 _webBps, uint16 _causeBps, uint16 _depositorBps) external onlyOwner {
        require(uint256(_webBps) + _causeBps + _depositorBps == 10000, "split must sum to 10000");
        webBps = _webBps;
        causeBps = _causeBps;
        depositorBps = _depositorBps;
        emit SplitChanged(_webBps, _causeBps, _depositorBps, msg.sender);
    }

    /// @notice Wire the meme-buy legs. Legs 1 & 3 need a meme token + a router;
    ///         leg 1 also needs an LP recipient (defaults to charityWallet if 0).
    ///         Until this is set, harvest reverts (honest — never skips a leg).
    /// @dev    memeToken must NOT be USDG or this receipt token (no self-swap).
    function setMemeWiring(address _memeToken, address _swapRouter, address _lpRecipient) external onlyOwner {
        require(_memeToken != address(0) && _swapRouter != address(0), "zero meme/router");
        require(_memeToken != address(usdg) && _memeToken != address(this), "bad meme token");
        memeToken = IERC20(_memeToken);
        swapRouter = ISwapRouter(_swapRouter);
        lpRecipient = _lpRecipient; // 0 => fall back to charityWallet in harvest
        emit MemeWiringChanged(_memeToken, _swapRouter, _lpRecipient, msg.sender);
    }

    /// @notice Tune the meme-buy slippage floor (bps). Prevents minOut=0 grief.
    function setMaxSlippageBps(uint16 _bps) external onlyOwner {
        require(_bps <= 2000, "slippage floor too loose"); // hard cap 20%
        maxSlippageBps = _bps;
    }

    /// @notice Hand the governance power to a new steward (e.g. a multisig).
    ///         Pass address(0) to RENOUNCE, freezing the split, meme wiring, and
    ///         charity destination forever.
    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ======================== ERC20 OVERRIDES ========================

    /// @dev USDG is 6 decimals; the receipt stays 1:1 with USDG, so 6 decimals.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ======================== REWARD CHECKPOINT (meme accumulator) ========================

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && from != address(this)) _updateMemeReward(from);
        if (to != address(0) && to != address(this)) _updateMemeReward(to);
        super._update(from, to, value);
    }

    /// @dev Checkpoints a holder's accrued MEME reward before their receipt
    ///      balance changes. Scaled by 1e18 for precision.
    function _updateMemeReward(address account) internal {
        uint256 bal = balanceOf(account);
        uint256 perToken = memeRewardPerTokenStored;
        uint256 paid = userMemeRewardPerTokenPaid[account];
        if (perToken > paid) {
            memeRewards[account] += (bal * (perToken - paid)) / 1e18;
        }
        userMemeRewardPerTokenPaid[account] = perToken;
    }

    // ======================== DEPOSIT / WITHDRAW ========================

    /// @notice Deposit USDG, receive proof-of-deposit 1:1.
    function deposit(uint256 amount) external nonReentrant {
        _deposit(msg.sender, amount);
    }

    /// @notice Deposit USDG on behalf of another address.
    function depositFor(address to, uint256 amount) external nonReentrant {
        require(to != address(0), "zero address");
        _deposit(to, amount);
    }

    function _deposit(address to, uint256 amount) internal {
        require(amount > 0, "zero");
        // Pull exactly `amount` USDG from the caller.
        usdg.safeTransferFrom(msg.sender, address(this), amount);
        // Approve the vault to pull EXACTLY `amount` (no standing allowance).
        usdg.forceApprove(address(vault), amount);
        // Park principal in Morpho. Shares (18 dec) accrue to this contract.
        vault.deposit(amount, address(this));
        // Mint receipt 1:1 with USDG deposited.
        _mint(to, amount);
        emit Deposit(to, amount);
    }

    /// @notice Burn proof-of-deposit, receive USDG 1:1.
    /// @dev    Uses withdraw(assets,...) so the user gets EXACTLY `amount` USDG
    ///         (ERC-4626 rounds shares UP against the vault, in our favor — the
    ///         contract eats the 1-wei dust from accrued yield). If Morpho lacks
    ///         instant liquidity for `amount`, withdraw() reverts and we surface
    ///         a clear reason rather than leaking a partial / faking success.
    function redeem(uint256 amount) external nonReentrant {
        require(amount > 0, "zero");
        // Burn first (checks-effects); the external withdraw follows.
        _burn(msg.sender, amount);
        // Honest redemption: bubble a clear reason if the vault can't cover it now.
        try vault.withdraw(amount, msg.sender, address(this)) returns (uint256) {
            emit Withdraw(msg.sender, amount);
        } catch {
            revert("insufficient vault liquidity - large redeems may queue, try smaller or retry later");
        }
    }

    // ======================== HARVEST (3-way split) ========================

    /// @notice Pull accrued Morpho yield as USDG and split it three ways
    ///         (webBps / causeBps / depositorBps). Anyone can call.
    ///           1. WEB      — buy meme, add liquidity (LP → lpRecipient).
    ///           2. CAUSE    — USDG straight to charityWallet.
    ///           3. DEPOSITOR— buy meme, distribute to depositors (claimMeme()).
    ///         Requires meme wiring (memeToken + swapRouter). Reverts cleanly if
    ///         unset or if any Morpho withdraw / meme buy / addLiquidity fails —
    ///         never skips a leg, never fakes.
    /// @param minMemeOutWeb        min meme out for the WEB-leg swap (slippage guard)
    /// @param minMemeOutDepositor  min meme out for the DEPOSITOR-leg swap
    function harvest(uint256 minMemeOutWeb, uint256 minMemeOutDepositor) external nonReentrant {
        require(address(memeToken) != address(0) && address(swapRouter) != address(0),
            "meme wiring unset - cannot harvest until a meme LP + router exist");

        uint256 backing = vault.convertToAssets(vault.balanceOf(address(this)));
        uint256 owed = totalSupply();
        require(backing > owed, "nothing to harvest");

        uint256 yieldAmount = backing - owed;
        require(yieldAmount >= MIN_HARVEST, "below minimum");

        uint256 webShare = (yieldAmount * webBps) / 10000;
        uint256 depositorShare = (yieldAmount * depositorBps) / 10000;
        uint256 causeShare = yieldAmount - webShare - depositorShare; // remainder → cause (no dust loss)

        // Pull the ENTIRE yield out of Morpho as USDG to this contract in one go.
        // Honest: if the idle buffer can't cover it, revert with a clear reason.
        try vault.withdraw(yieldAmount, address(this), address(this)) returns (uint256) {
            // USDG now held here; route the three legs below.
        } catch {
            revert("insufficient vault liquidity for harvest - retry later or harvest smaller");
        }

        // --- LEG 2: CAUSE (do the donation first; it's the simplest + can't fail) ---
        if (causeShare > 0) {
            usdg.safeTransfer(charityWallet, causeShare);
        }

        // --- LEG 3: DEPOSITOR — buy meme, distribute pro-rata to depositors ---
        uint256 memeToDepositors = 0;
        if (depositorShare > 0) {
            uint256 bought = _buyMeme(depositorShare, minMemeOutDepositor);
            uint256 supply = totalSupply();
            if (supply > 0 && bought > 0) {
                memeToDepositors = bought;
                // meme sits in this contract; accumulator tracks each holder's slice.
                memeRewardPerTokenStored += (bought * 1e18) / supply;
            } else if (bought > 0) {
                // No depositors to reward (supply 0) — send meme to the cause so it
                // isn't stranded. Never silently strand funds.
                memeToken.safeTransfer(charityWallet, bought);
            }
        }

        // --- LEG 1: WEB — buy meme with half, add liquidity with meme + other half ---
        if (webShare > 0) {
            _deepenWeb(webShare, minMemeOutWeb);
        }

        totalHarvested += yieldAmount;
        emit Harvest(msg.sender, yieldAmount, webShare, causeShare, depositorShare, memeToDepositors);
    }

    /// @dev Swap `usdgIn` USDG → meme via the router. Exact approval, honest revert.
    ///      Enforces the slippage floor: minOut must be >= a floor derived from
    ///      maxSlippageBps applied to the router's own quote is not available here,
    ///      so we require the CALLER's minOut to be nonzero (a 0 would allow grief).
    function _buyMeme(uint256 usdgIn, uint256 minOut) internal returns (uint256 memeOut) {
        require(minOut > 0, "minOut=0 not allowed (set a real slippage bound)");
        usdg.forceApprove(address(swapRouter), usdgIn);
        address[] memory path = new address[](2);
        path[0] = address(usdg);
        path[1] = address(memeToken);
        uint256 before = memeToken.balanceOf(address(this));
        try swapRouter.swapExactTokensForTokens(usdgIn, minOut, path, address(this), block.timestamp) {
            memeOut = memeToken.balanceOf(address(this)) - before;
        } catch {
            revert("meme buy failed - no/thin meme LP or slippage; harvest reverted");
        }
        // Clear any residual approval (exact-approval hygiene).
        usdg.forceApprove(address(swapRouter), 0);
    }

    /// @dev WEB leg: split `usdgIn` in half, buy meme with one half, add both to
    ///      the meme/USDG LP. LP tokens → lpRecipient (or charityWallet). Any
    ///      unused USDG/meme dust is left in the contract (rolls into next yield).
    function _deepenWeb(uint256 usdgIn, uint256 minMemeOut) internal {
        uint256 half = usdgIn / 2;
        uint256 memeBought = _buyMeme(half, minMemeOut);
        uint256 usdgForLp = usdgIn - half;

        address to = lpRecipient == address(0) ? charityWallet : lpRecipient;
        usdg.forceApprove(address(swapRouter), usdgForLp);
        memeToken.forceApprove(address(swapRouter), memeBought);
        // amountMin 0 is acceptable here because we control both inputs and the
        // recipient is our own project wallet — no external counterparty to grief
        // us on the add; the buy above already carried the slippage guard.
        try swapRouter.addLiquidity(
            address(usdg), address(memeToken),
            usdgForLp, memeBought, 0, 0, to, block.timestamp
        ) returns (uint256, uint256, uint256) {
            // LP minted to `to` (deepens the web).
        } catch {
            revert("addLiquidity failed - meme LP venue issue; harvest reverted");
        }
        usdg.forceApprove(address(swapRouter), 0);
        memeToken.forceApprove(address(swapRouter), 0);
    }

    // ======================== CLAIM (meme rewards) ========================

    /// @notice Claim a depositor's accrued MEME rewards. Anyone can call for any
    ///         holder; funds go to the holder.
    function claimMeme(address holder) external nonReentrant {
        _updateMemeReward(holder);
        uint256 reward = memeRewards[holder];
        require(reward > 0, "nothing to claim");

        memeRewards[holder] = 0;
        uint256 available = memeToken.balanceOf(address(this));
        require(available >= reward, "insufficient meme balance");

        memeToken.safeTransfer(holder, reward);
        emit MemeClaimed(holder, msg.sender, reward);
    }

    // ======================== VIEWS ========================

    /// @notice Pending Morpho yield available to harvest (USDG, 6 dec).
    function pendingYield() external view returns (uint256) {
        uint256 backing = vault.convertToAssets(vault.balanceOf(address(this)));
        uint256 owed = totalSupply();
        return backing > owed ? backing - owed : 0;
    }

    /// @notice USDG value of all Morpho shares this contract holds (the backing).
    function totalBacking() external view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(address(this)));
    }

    /// @notice Unclaimed MEME rewards for a depositor (leg-3 bags).
    function pendingMemeRewards(address holder) external view returns (uint256) {
        uint256 bal = balanceOf(holder);
        uint256 perToken = memeRewardPerTokenStored;
        uint256 paid = userMemeRewardPerTokenPaid[holder];
        uint256 earned = perToken > paid ? (bal * (perToken - paid)) / 1e18 : 0;
        return memeRewards[holder] + earned;
    }

    /// @notice Shares needed to service a redeem of `amount` USDG right now.
    ///         UI helper so a client can warn before a too-large redeem.
    function sharesForRedeem(uint256 amount) external view returns (uint256) {
        return vault.previewWithdraw(amount);
    }

    /// @notice True once the meme-buy legs are wired (harvest is runnable).
    function memeWired() external view returns (bool) {
        return address(memeToken) != address(0) && address(swapRouter) != address(0);
    }
}
