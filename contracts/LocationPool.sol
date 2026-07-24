// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILocationFactory {
    function gameSigner() external view returns (address);
    function owner() external view returns (address);
}

/// @title LocationPool — a location-keyed, position-gated x*y=k AMM (clone template).
/// @notice Seize the Seas trade-route pool. Swaps require a SIGNED ATTESTATION from the
///         game that the caller is physically at this pool's location (so only travelling
///         PLAYERS can arb, never bots). The treasury creates price MISMATCHES between
///         locations via inject() (single-sided, permanent); players discover + arb them.
///
///         ADD-ONLY by design: liquidity can be seeded/injected but NEVER withdrawn by an
///         admin — value only leaves through player swaps. Owner = the factory's owner.
///         No fee-on-transfer tokens (reserve accounting assumes amountIn == received).
contract LocationPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public factory;        // set on initialize; source of owner + gameSigner
    IERC20  public token0;
    IERC20  public token1;
    uint256 public location;       // hex id this pool is keyed to
    uint16  public feeBps;         // swap fee in bps (e.g. 30 = 0.30%)
    uint256 public maxSwapIn;      // cap on amountIn per swap (0 = uncapped)
    uint32  public cooldown;       // seconds between swaps per player
    bool    public open;           // trading enabled (seasonal / siege toggle)
    bool    private _initialized;

    uint256 public reserve0;
    uint256 public reserve1;
    mapping(address => uint256) public lastSwap; // player => last swap timestamp

    event Initialized(address indexed factory, address token0, address token1, uint256 location, uint16 feeBps);
    event Seeded(uint256 amount0, uint256 amount1);
    event Injected(bool side0, uint256 amount, uint256 reserve0, uint256 reserve1);
    event Swapped(address indexed player, bool zeroForOne, uint256 amountIn, uint256 amountOut);
    event OpenSet(bool open);
    event ParamsSet(uint16 feeBps, uint256 maxSwapIn, uint32 cooldown);

    modifier onlyOwner() {
        require(msg.sender == ILocationFactory(factory).owner(), "not owner");
        _;
    }

    /// @notice Clone initializer (called once by the factory).
    function initialize(
        address _token0, address _token1, uint256 _location,
        uint16 _feeBps, uint256 _maxSwapIn, uint32 _cooldown
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
        open = true;
        emit Initialized(msg.sender, _token0, _token1, _location, _feeBps);
    }

    // ───────────────── liquidity (add-only; owner = factory owner / treasury) ─────────────

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
    ///         No shares minted; the tokens become permanent reserve (arb fuel).
    function inject(bool side0, uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "zero");
        if (side0) { token0.safeTransferFrom(msg.sender, address(this), amount); reserve0 += amount; }
        else       { token1.safeTransferFrom(msg.sender, address(this), amount); reserve1 += amount; }
        emit Injected(side0, amount, reserve0, reserve1);
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
        require(open, "closed");
        require(amountIn > 0, "zero");
        require(maxSwapIn == 0 || amountIn <= maxSwapIn, "over cap");
        require(block.timestamp >= lastSwap[msg.sender] + cooldown, "cooldown");
        require(block.timestamp <= expiry, "expired");
        require(
            ECDSA.recover(attestationHash(msg.sender, expiry), sig) == ILocationFactory(factory).gameSigner(),
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
