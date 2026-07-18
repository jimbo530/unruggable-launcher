// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILocationFactoryV2 {
    function gameSigner() external view returns (address);
    function owner() external view returns (address);
}

/// @title LocationPoolV2 — location-keyed, position-gated x*y=k AMM (clone template).
/// @notice V2 of the Seize the Seas trade-route pool. Same gated swap as V1 (a signed game
///         attestation proves the caller is AT this location), with two changes learned the
///         hard way on the V1 fleet:
///
///         1. DROPPABLE: a pool can be created UNPLACED (a pre-built "town kit"). It cannot
///            trade until the owner calls placeAt(hexId) — ONCE, then the location is locked
///            forever. Lets us pre-build + pre-seed whole town markets and drop one on a hex
///            the moment players explore it.
///
///         2. WITHDRAWABLE UNTIL SHIPPED: V1 was add-only from day one and the whole seeded
///            fleet had to be redone. V2 keeps an adminWithdraw escape hatch for the build
///            phase, closed by a ONE-WAY renounceAdminWithdraw() at ship — after which it is
///            provably add-only exactly like V1 (value only leaves through player swaps).
///
///         No fee-on-transfer tokens (reserve accounting assumes amountIn == received).
contract LocationPoolV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public factory;        // set on initialize; source of owner + gameSigner
    IERC20  public token0;
    IERC20  public token1;
    uint256 public location;       // hex id (q*1000+r) once placed; the kit id while unplaced
    uint16  public feeBps;         // swap fee in bps (e.g. 30 = 0.30%)
    uint256 public maxSwapIn;      // cap on amountIn per swap (0 = uncapped)
    uint32  public cooldown;       // seconds between swaps per player
    bool    public open;           // trading enabled (seasonal / siege toggle)
    bool    public placed;         // location is final; swaps refuse until true
    bool    public withdrawRenounced; // one-way: true = add-only forever
    bool    private _initialized;

    uint256 public reserve0;
    uint256 public reserve1;
    mapping(address => uint256) public lastSwap; // player => last swap timestamp

    event Initialized(address indexed factory, address token0, address token1, uint256 location, uint16 feeBps, bool placed);
    event Placed(uint256 indexed location);
    event Seeded(uint256 amount0, uint256 amount1);
    event Injected(bool side0, uint256 amount, uint256 reserve0, uint256 reserve1);
    event Swapped(address indexed player, bool zeroForOne, uint256 amountIn, uint256 amountOut);
    event OpenSet(bool open);
    event ParamsSet(uint16 feeBps, uint256 maxSwapIn, uint32 cooldown);
    event AdminWithdrawn(address indexed token, uint256 amount, address indexed to);
    event WithdrawRenounced();

    modifier onlyOwner() {
        require(msg.sender == ILocationFactoryV2(factory).owner(), "not owner");
        _;
    }

    /// @notice Clone initializer (called once by the factory).
    /// @param _location the real hex id if `_placed`, else the kit id (registry key only)
    /// @param _placed   true = location is final at create; false = an unplaced town kit
    function initialize(
        address _token0, address _token1, uint256 _location,
        uint16 _feeBps, uint256 _maxSwapIn, uint32 _cooldown, bool _placed
    ) external {
        require(!_initialized, "init");
        require(_token0 != address(0) && _token1 != address(0) && _token0 != _token1, "bad tokens");
        require(_feeBps <= 1000, "fee>10%");
        _initialized = true;
        factory = msg.sender;
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
        location = _location;
        feeBps = _feeBps;
        maxSwapIn = _maxSwapIn;
        cooldown = _cooldown;
        placed = _placed;
        open = true;
        emit Initialized(msg.sender, _token0, _token1, _location, _feeBps, _placed);
    }

    /// @notice Drop an unplaced kit onto its real hex. ONCE — the location locks forever.
    function placeAt(uint256 hexId) external onlyOwner {
        require(!placed, "placed");
        require(hexId != 0, "zero loc");
        location = hexId;
        placed = true;
        emit Placed(hexId);
    }

    // ───────────────── liquidity (owner = factory owner / treasury) ─────────────

    /// @notice Seed two-sided liquidity; the ratio sets the starting price.
    function seed(uint256 amount0, uint256 amount1) external onlyOwner nonReentrant {
        require(amount0 > 0 && amount1 > 0, "zero");
        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);
        reserve0 += amount0;
        reserve1 += amount1;
        emit Seeded(amount0, amount1);
    }

    /// @notice Single-sided injection — skews the price to create a location MISMATCH.
    ///         No shares minted; the tokens join the reserve (arb fuel).
    function inject(bool side0, uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "zero");
        if (side0) { token0.safeTransferFrom(msg.sender, address(this), amount); reserve0 += amount; }
        else       { token1.safeTransferFrom(msg.sender, address(this), amount); reserve1 += amount; }
        emit Injected(side0, amount, reserve0, reserve1);
    }

    // ─────────── build-phase escape hatch (one-way renounce → add-only forever) ───────────

    /// @notice Withdraw reserve during the BUILD phase only. Dead once renounced.
    ///         Reserve accounting stays true (a withdraw moves the book, never corrupts it).
    function adminWithdraw(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        require(!withdrawRenounced, "renounced");
        require(to != address(0) && amount > 0, "bad args");
        if (token == address(token0))      reserve0 -= amount; // underflow reverts
        else if (token == address(token1)) reserve1 -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit AdminWithdrawn(token, amount, to);
    }

    /// @notice ONE-WAY: permanently close the escape hatch. No un-set exists. After this the
    ///         pool is provably add-only — value only leaves through player swaps.
    function renounceAdminWithdraw() external onlyOwner {
        withdrawRenounced = true;
        emit WithdrawRenounced();
    }

    // ───────────────────────────── gated swap (players only) ─────────────────────────────

    /// @notice The message the game signs to attest the caller is at this location.
    function attestationHash(address player, uint256 expiry) public view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(address(this), player, location, expiry, block.chainid))
        );
    }

    /// @notice Swap, gated by a fresh game attestation (caller is at `location`, until `expiry`).
    /// @param zeroForOne true = token0 in / token1 out
    function swap(
        bool zeroForOne, uint256 amountIn, uint256 minOut,
        uint256 expiry, bytes calldata sig
    ) external nonReentrant returns (uint256 amountOut) {
        require(placed, "unplaced");
        require(open, "closed");
        require(amountIn > 0, "zero");
        require(maxSwapIn == 0 || amountIn <= maxSwapIn, "over cap");
        require(block.timestamp >= lastSwap[msg.sender] + cooldown, "cooldown");
        require(block.timestamp <= expiry, "expired");
        require(
            ECDSA.recover(attestationHash(msg.sender, expiry), sig) == ILocationFactoryV2(factory).gameSigner(),
            "bad attestation"
        );
        lastSwap[msg.sender] = block.timestamp;

        (IERC20 tin, IERC20 tout, uint256 rin, uint256 rout) = zeroForOne
            ? (token0, token1, reserve0, reserve1)
            : (token1, token0, reserve1, reserve0);
        require(rin > 0 && rout > 0, "no liquidity");

        tin.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 inAfterFee = amountIn * (10000 - feeBps) / 10000;   // x*y=k with fee
        amountOut = (rout * inAfterFee) / (rin + inAfterFee);
        require(amountOut >= minOut, "slippage");
        require(amountOut < rout, "insufficient liquidity");

        if (zeroForOne) { reserve0 = rin + amountIn; reserve1 = rout - amountOut; }
        else            { reserve1 = rin + amountIn; reserve0 = rout - amountOut; }

        tout.safeTransfer(msg.sender, amountOut);
        emit Swapped(msg.sender, zeroForOne, amountIn, amountOut);
    }

    /// @notice Quote (view) for a given input — handy for the client/keeper.
    function quote(bool zeroForOne, uint256 amountIn) external view returns (uint256) {
        (uint256 rin, uint256 rout) = zeroForOne ? (reserve0, reserve1) : (reserve1, reserve0);
        if (rin == 0 || rout == 0 || amountIn == 0) return 0;
        uint256 inAfterFee = amountIn * (10000 - feeBps) / 10000;
        return (rout * inAfterFee) / (rin + inAfterFee);
    }

    // ───────────────────────────────── admin (owner) ─────────────────────────────────────
    function setOpen(bool o) external onlyOwner { open = o; emit OpenSet(o); }
    function setParams(uint16 _feeBps, uint256 _maxSwapIn, uint32 _cooldown) external onlyOwner {
        require(_feeBps <= 1000, "fee>10%");
        feeBps = _feeBps; maxSwapIn = _maxSwapIn; cooldown = _cooldown;
        emit ParamsSet(_feeBps, _maxSwapIn, _cooldown);
    }
    function getReserves() external view returns (uint256, uint256) { return (reserve0, reserve1); }
}
