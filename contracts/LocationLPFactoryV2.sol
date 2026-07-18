// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LocationPoolV2} from "./LocationPoolV2.sol";

/// @title LocationLPFactoryV2 — deploys droppable, position-gated trade-route pools.
/// @notice V2 of the Seas location-pool factory. Clones LocationPoolV2 per (key, token pair).
///         The key is EITHER a real hex id (pool trades immediately) OR a kit id for an
///         UNPLACED town kit — a pre-built market dropped onto its hex later via the pool's
///         one-time placeAt(). Kit ids live at >= KIT_BASE so they can never collide with hex
///         ids (q*1000+r stays far below it). Holds the shared gameSigner + owner exactly like
///         V1; the factory never holds or moves pool funds.
contract LocationLPFactoryV2 {
    /// @dev Registry keys at/above this are town-kit ids, never real hexes.
    uint256 public constant KIT_BASE = 9_000_000;

    address public owner;
    address public gameSigner;            // signs {pool, player, location, expiry} attestations
    address public immutable implementation;

    mapping(uint256 => mapping(bytes32 => address)) public pools; // key (hex or kit id) => pairKey => pool
    address[] public allPools;

    event PoolCreated(uint256 indexed key, address indexed token0, address indexed token1, address pool, uint16 feeBps, bool placed);
    event SignerSet(address signer);
    event OwnerSet(address owner);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address _implementation, address _gameSigner) {
        require(_implementation != address(0) && _gameSigner != address(0), "zero");
        owner = msg.sender;
        implementation = _implementation;
        gameSigner = _gameSigner;
    }

    function pairKey(address a, address b) public pure returns (bytes32) {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encodePacked(t0, t1));
    }

    /// @notice Create a pool. `key` < KIT_BASE = a real hex id, pool trades once seeded.
    ///         `key` >= KIT_BASE = an unplaced town-kit pool; it refuses swaps until the
    ///         owner drops it with pool.placeAt(hexId).
    function createPool(
        uint256 key, address tokenA, address tokenB,
        uint16 feeBps, uint256 maxSwapIn, uint32 cooldown
    ) external onlyOwner returns (address pool) {
        require(tokenA != address(0) && tokenB != address(0) && tokenA != tokenB, "bad tokens");
        require(key != 0, "zero key");
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 k = pairKey(t0, t1);
        require(pools[key][k] == address(0), "pool exists");
        bool placedAtCreate = key < KIT_BASE;
        pool = Clones.clone(implementation);
        LocationPoolV2(pool).initialize(t0, t1, key, feeBps, maxSwapIn, cooldown, placedAtCreate);
        pools[key][k] = pool;
        allPools.push(pool);
        emit PoolCreated(key, t0, t1, pool, feeBps, placedAtCreate);
    }

    function getPool(uint256 key, address tokenA, address tokenB) external view returns (address) {
        return pools[key][pairKey(tokenA, tokenB)];
    }
    function poolCount() external view returns (uint256) { return allPools.length; }

    function setSigner(address s) external onlyOwner { require(s != address(0), "zero"); gameSigner = s; emit SignerSet(s); }
    function setOwner(address o) external onlyOwner { require(o != address(0), "zero"); owner = o; emit OwnerSet(o); }
}
