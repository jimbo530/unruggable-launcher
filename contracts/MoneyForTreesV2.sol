// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/// @title Money for Trees V2 — 1:1 USDC stablecoin with yield sharing
/// @notice Deposit USDC, get MfT. 1 MfT = 1 USDC, always. Withdraw anytime.
///         Aave V3 yield splits into thirds:
///           1/3 → new MfT minted for holders (claim to collect)
///           1/3 → USDC sent to meme reactor (flywheel)
///           1/3 → USDC sent to ops wallet (trees + operations)
///         LP contract addresses are excluded from rewards — no scraping.
///         Immutable — no owner, no admin, no upgrades.
///
///         "Save 10 MfT. Plant 1 tree a year. Earn at least 1%."
contract MoneyForTreesV2 is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //  Immutable State
    // ═══════════════════════════════════════════════════════════════════════

    IERC20  public immutable usdc;
    IAaveV3Pool public immutable aavePool;
    IERC20  public immutable aUsdc;
    address public immutable opsWallet;
    address public immutable memeReactor;

    // ═══════════════════════════════════════════════════════════════════════
    //  Reward Tracking (Synthetix-style accumulator)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Cumulative rewards per MfT held (scaled by 1e18)
    uint256 public rewardPerTokenStored;

    /// @notice Snapshot of rewardPerTokenStored when user last interacted
    mapping(address => uint256) public userRewardPerTokenPaid;

    /// @notice Unclaimed MfT rewards for each holder
    mapping(address => uint256) public rewards;

    /// @notice Total MfT rewards allocated but not yet claimed (USDC backing in Aave)
    uint256 public pendingRewards;

    // ═══════════════════════════════════════════════════════════════════════
    //  LP Exclusion — prevents yield scraping
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Addresses excluded from reward accumulation (LP pools, etc.)
    mapping(address => bool) public excluded;

    /// @notice Total MfT balance held by excluded addresses
    uint256 public excludedSupply;

    /// @notice The one LP pool whose rewards redirect to the meme reactor.
    ///         Set once after pool creation. Not excludable. Earns rewards
    ///         that anyone can flush to the reactor via claimForReactor().
    address public reactorPool;

    // ═══════════════════════════════════════════════════════════════════════
    //  Tracking
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public totalRewardsDistributed;   // cumulative MfT minted as rewards
    uint256 public totalOpsYield;             // cumulative USDC sent to ops
    uint256 public totalMemeYield;            // cumulative USDC sent to meme reactor

    // ═══════════════════════════════════════════════════════════════════════
    //  Events
    // ═══════════════════════════════════════════════════════════════════════

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Harvest(address indexed caller, uint256 rewardAmount, uint256 memeAmount, uint256 opsAmount);
    event RewardClaimed(address indexed user, uint256 amount);
    event AddressExcluded(address indexed addr);
    event ReactorPoolSet(address indexed pool);
    event ReactorPoolClaimed(address indexed pool, uint256 amount);
    event Swept(uint256 amount);

    // ═══════════════════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _usdc,
        address _aavePool,
        address _aUsdc,
        address _opsWallet,
        address _memeReactor
    ) ERC20("Money for Trees", "MfT") {
        require(_usdc != address(0), "zero usdc");
        require(_aavePool != address(0), "zero aave");
        require(_aUsdc != address(0), "zero aUsdc");
        require(_opsWallet != address(0), "zero ops");
        require(_memeReactor != address(0), "zero meme");

        usdc = IERC20(_usdc);
        aavePool = IAaveV3Pool(_aavePool);
        aUsdc = IERC20(_aUsdc);
        opsWallet = _opsWallet;
        memeReactor = _memeReactor;

        IERC20(_usdc).approve(_aavePool, type(uint256).max);

        // Auto-exclude reactor from holder rewards
        excluded[_memeReactor] = true;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LP Exclusion — Permissionless, contracts only
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Exclude a contract address from earning rewards.
    ///         Permissionless — anyone can call, but only works on contracts.
    ///         Once excluded, tokens held by that address earn zero rewards.
    ///         LP providers earn trading fees instead.
    function exclude(address addr) external {
        require(addr.code.length > 0, "not a contract");
        require(!excluded[addr], "already excluded");
        require(addr != reactorPool, "reactor pool protected");
        excluded[addr] = true;
        excludedSupply += balanceOf(addr);
        emit AddressExcluded(addr);
    }

    /// @notice Supply eligible for rewards (total minus excluded balances)
    function eligibleSupply() public view returns (uint256) {
        return totalSupply() - excludedSupply;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Reactor Pool — one protected LP that fuels the flywheel
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Register the reactor's LP pool. Set once, never changed.
    ///         Only callable by the meme reactor contract.
    ///         This pool earns rewards that get redirected to the reactor.
    function setReactorPool(address pool) external {
        require(msg.sender == memeReactor, "only reactor");
        require(reactorPool == address(0), "already set");
        require(pool != address(0), "zero pool");
        require(pool.code.length > 0, "not a contract");
        reactorPool = pool;
        emit ReactorPoolSet(pool);
    }

    /// @notice Flush the reactor pool's accumulated rewards to the reactor.
    ///         Permissionless — anyone can call (keeper, reactor, user).
    ///         MfT minted to memeReactor as fuel.
    function claimForReactor() external nonReentrant {
        require(reactorPool != address(0), "no reactor pool");
        _updateReward(reactorPool);
        uint256 reward = rewards[reactorPool];
        require(reward > 0, "nothing to claim");

        rewards[reactorPool] = 0;
        pendingRewards -= reward;

        _mint(memeReactor, reward);
        emit ReactorPoolClaimed(reactorPool, reward);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Deposit / Withdraw — always 1:1 with USDC
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit USDC, receive MfT 1:1
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "zero");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        aavePool.supply(address(usdc), amount, address(this), 0);
        _mint(msg.sender, amount);
        emit Deposit(msg.sender, amount);
    }

    /// @notice Deposit USDC, mint MfT to a different recipient
    function depositFor(address recipient, uint256 amount) external nonReentrant {
        require(amount > 0, "zero");
        require(recipient != address(0), "zero recipient");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        aavePool.supply(address(usdc), amount, address(this), 0);
        _mint(recipient, amount);
        emit Deposit(recipient, amount);
    }

    /// @notice Burn MfT, receive USDC 1:1
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "zero");
        _burn(msg.sender, amount);
        aavePool.withdraw(address(usdc), amount, msg.sender);
        emit Withdraw(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Harvest — Permissionless yield distribution
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Split accrued Aave yield three ways:
    ///         1/3 as claimable MfT rewards for eligible holders
    ///         1/3 as MfT minted to meme reactor (fuel for LP flywheel)
    ///         1/3 as USDC to ops wallet (trees + operations)
    ///         Holder + reactor MfT is backed by yield USDC staying in Aave.
    function harvest() external nonReentrant {
        uint256 totalAave = aUsdc.balanceOf(address(this));
        uint256 totalOwed = totalSupply() + pendingRewards;
        require(totalAave > totalOwed, "no yield");

        uint256 totalYield = totalAave - totalOwed;

        // Three-way split
        uint256 rewardAmount = totalYield / 3;
        uint256 memeAmount = totalYield / 3;
        uint256 opsAmount = totalYield - rewardAmount - memeAmount;

        // Distribute rewards proportionally to eligible holders only
        uint256 eligible = eligibleSupply();
        if (eligible > 0 && rewardAmount > 0) {
            rewardPerTokenStored += (rewardAmount * 1e18) / eligible;
            pendingRewards += rewardAmount;
            totalRewardsDistributed += rewardAmount;
        }

        // Mint MfT fuel to reactor — backed by yield USDC in Aave
        if (memeAmount > 0) {
            _mint(memeReactor, memeAmount);
            totalMemeYield += memeAmount;
        }

        // Send ops portion as USDC
        if (opsAmount > 0) {
            aavePool.withdraw(address(usdc), opsAmount, opsWallet);
            totalOpsYield += opsAmount;
        }

        emit Harvest(msg.sender, rewardAmount, memeAmount, opsAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Claim — Holders collect their MfT rewards
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Claim accumulated MfT rewards. New MfT minted, backed by USDC in Aave.
    function claim() external nonReentrant {
        require(!excluded[msg.sender], "excluded address");
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "nothing to claim");

        rewards[msg.sender] = 0;
        pendingRewards -= reward;

        // Mint new MfT backed by the yield USDC sitting in Aave
        _mint(msg.sender, reward);
        emit RewardClaimed(msg.sender, reward);
    }

    /// @notice View: how much MfT a holder can claim right now
    function claimable(address account) external view returns (uint256) {
        if (excluded[account]) return 0;
        uint256 earned = (balanceOf(account) * (rewardPerTokenStored - userRewardPerTokenPaid[account])) / 1e18;
        return rewards[account] + earned;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Sweep
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Push stray USDC into Aave (handles accidental direct transfers)
    function sweep() external nonReentrant {
        uint256 raw = usdc.balanceOf(address(this));
        require(raw > 0, "nothing to sweep");
        aavePool.supply(address(usdc), raw, address(this), 0);
        emit Swept(raw);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  View Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Pending yield available to harvest
    function pendingYield() external view returns (uint256) {
        uint256 totalAave = aUsdc.balanceOf(address(this));
        uint256 totalOwed = totalSupply() + pendingRewards;
        return totalAave > totalOwed ? totalAave - totalOwed : 0;
    }

    /// @notice Total USDC in Aave
    function totalBacking() external view returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }

    /// @notice Trees planted estimate (half of ops at $0.10/tree)
    function treesPlanted() external view returns (uint256) {
        return (totalOpsYield / 2) / 100_000;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — Reward Checkpoint on Every Transfer
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Override OZ _update to checkpoint rewards before any token movement
    ///      Excluded addresses are skipped — they never accumulate rewards.
    ///      Also tracks excludedSupply when tokens move in/out of excluded addrs.
    function _update(address from, address to, uint256 value) internal override {
        // Checkpoint rewards for non-excluded participants
        if (from != address(0) && !excluded[from]) _updateReward(from);
        if (to != address(0) && !excluded[to]) _updateReward(to);

        super._update(from, to, value);

        // Update excludedSupply tracking
        if (from != address(0) && excluded[from]) {
            excludedSupply -= value;
        }
        if (to != address(0) && excluded[to]) {
            excludedSupply += value;
        }
    }

    function _updateReward(address account) internal {
        uint256 earned = (balanceOf(account) * (rewardPerTokenStored - userRewardPerTokenPaid[account])) / 1e18;
        rewards[account] += earned;
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }
}
