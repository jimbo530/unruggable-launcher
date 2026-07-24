// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LocationLPFactory} from "./LocationLPFactory.sol";

interface ILocationPool {
    function seed(uint256 amount0, uint256 amount1) external;
    function inject(bool side0, uint256 amount) external;
    function setParams(uint16 feeBps, uint256 maxSwapIn, uint32 cooldown) external;
    function setOpen(bool open) external;
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @title BankrLPOperator — isolated co-admin wrapper for gated location pools.
/// @notice The live LocationLPFactory (0x54868729…) is SINGLE-OWNER and owns every existing
///         gated pool, so it can never take a co-admin. To let the Bankr agent wallet build
///         and seed real gated pools (for Bankr-ecosystem points + exposure) WITHOUT touching
///         our live factory, this wrapper deploys and owns its OWN fresh LocationLPFactory in
///         the constructor. That fresh factory is completely isolated from the live one.
///
///         Powers are split:
///           • owner (treasury) — full control: rotate the game-signer, hand the fresh factory
///             off / reclaim it, tune pools, add/remove operators.
///           • operator (Bankr wallet) — may ONLY create pools and seed/inject liquidity into
///             them. Operators can never change the signer, change ownership, or withdraw.
///
///         Custody is net-zero and transient: seed/inject pull tokens from the calling operator
///         into this contract, forceApprove the pool, and the pool pulls them straight out. This
///         contract never holds pool value at rest, and the pools remain ADD-ONLY (no withdraw
///         function exists anywhere in the stack — value only leaves through player swaps).
contract BankrLPOperator is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The fresh, isolated factory this contract deploys and owns. Never the live one.
    LocationLPFactory public immutable factory;

    address public owner;                       // treasury / coordinator (full control)
    mapping(address => bool) public operators;  // Bankr wallet(s): create + seed/inject only

    event OwnerSet(address indexed owner);
    event OperatorSet(address indexed operator, bool allowed);
    event PoolCreatedBy(address indexed operator, uint256 indexed location, address pool);
    event PoolSeededBy(address indexed operator, address indexed pool, uint256 amount0, uint256 amount1);
    event PoolInjectedBy(address indexed operator, address indexed pool, bool side0, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }
    modifier onlyOperator() {
        require(msg.sender == owner || operators[msg.sender], "not operator");
        _;
    }

    /// @param impl        the shared LocationPool implementation to clone (existing deploy).
    /// @param gameSigner  the position-attestation signer (SAME key the live factory uses).
    /// @param _owner      treasury address that will control this wrapper.
    constructor(address impl, address gameSigner, address _owner) {
        require(impl != address(0) && gameSigner != address(0) && _owner != address(0), "zero");
        // Deploy a FRESH factory owned by THIS contract (msg.sender in the factory ctor == this).
        // Isolated from the live factory — the live factory is never referenced or touched.
        factory = new LocationLPFactory(impl, gameSigner);
        owner = _owner;
        emit OwnerSet(_owner);
    }

    // ─────────────────────────── owner-only administration ────────────────────────────

    /// @notice Add or remove an operator (e.g. the Bankr wallet). Owner only.
    function setOperator(address op, bool allowed) external onlyOwner {
        require(op != address(0), "zero");
        operators[op] = allowed;
        emit OperatorSet(op, allowed);
    }

    /// @notice Transfer control of THIS wrapper. Owner only.
    function setOwner(address o) external onlyOwner {
        require(o != address(0), "zero");
        owner = o;
        emit OwnerSet(o);
    }

    /// @notice Rotate the fresh factory's game-signer. Owner only (operators must NEVER do this).
    function factorySetSigner(address s) external onlyOwner {
        factory.setSigner(s);
    }

    /// @notice Hand the fresh factory to a new owner (e.g. reclaim it directly to treasury, or
    ///         move it under different infra). Owner only. After this, this wrapper can no longer
    ///         act as the pools' owner — the new factory owner does. One-way handoff.
    function factorySetOwner(address o) external onlyOwner {
        factory.setOwner(o);
    }

    /// @notice Tune a pool (fee / cap / cooldown) as the factory-owner. Owner only.
    function setPoolParams(address pool, uint16 feeBps, uint256 maxSwapIn, uint32 cooldown) external onlyOwner {
        ILocationPool(pool).setParams(feeBps, maxSwapIn, cooldown);
    }

    /// @notice Open / close a pool (siege toggle) as the factory-owner. Owner only.
    function setPoolOpen(address pool, bool open) external onlyOwner {
        ILocationPool(pool).setOpen(open);
    }

    // ──────────────────────── operator powers (create + fund only) ─────────────────────

    /// @notice Create a fresh gated pool via the isolated factory. Operator (or owner).
    function createPool(
        uint256 location, address tokenA, address tokenB,
        uint16 feeBps, uint256 maxSwapIn, uint32 cooldown
    ) external onlyOperator returns (address pool) {
        pool = factory.createPool(location, tokenA, tokenB, feeBps, maxSwapIn, cooldown);
        emit PoolCreatedBy(msg.sender, location, pool);
    }

    /// @notice Seed two-sided liquidity into a pool. Pulls token0+token1 from the CALLER,
    ///         approves the pool, and the pool pulls them out (net-zero transient custody).
    ///         This contract is the pool's owner (via the fresh factory), so seed() passes.
    ///         Operator (or owner).
    function seedPool(address pool, uint256 amount0, uint256 amount1) external onlyOperator nonReentrant {
        require(amount0 > 0 && amount1 > 0, "zero");
        IERC20 t0 = IERC20(ILocationPool(pool).token0());
        IERC20 t1 = IERC20(ILocationPool(pool).token1());
        t0.safeTransferFrom(msg.sender, address(this), amount0);
        t1.safeTransferFrom(msg.sender, address(this), amount1);
        t0.forceApprove(pool, amount0);
        t1.forceApprove(pool, amount1);
        ILocationPool(pool).seed(amount0, amount1);
        emit PoolSeededBy(msg.sender, pool, amount0, amount1);
    }

    /// @notice Single-sided injection into a pool (creates a location price mismatch). Pulls the
    ///         chosen side from the CALLER, approves the pool, the pool pulls it out. Operator
    ///         (or owner).
    function injectPool(address pool, bool side0, uint256 amount) external onlyOperator nonReentrant {
        require(amount > 0, "zero");
        IERC20 tok = IERC20(side0 ? ILocationPool(pool).token0() : ILocationPool(pool).token1());
        tok.safeTransferFrom(msg.sender, address(this), amount);
        tok.forceApprove(pool, amount);
        ILocationPool(pool).inject(side0, amount);
        emit PoolInjectedBy(msg.sender, pool, side0, amount);
    }
}
