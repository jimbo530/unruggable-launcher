// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LocationPool} from "./LocationPool.sol";

/// @title LocationLPFactory — deploys location-keyed, position-gated trade-route pools.
/// @notice Clones a LocationPool template per (location, token pair) — cheap, small per-tx
///         gas. Holds the shared gameSigner (the key that attests player position) and the
///         owner (treasury/coordinator who seeds/injects + tunes pools). Add-only registry;
///         the factory never holds or moves pool funds.
contract LocationLPFactory {
    address public owner;
    address public gameSigner;            // signs {pool, player, location, expiry} attestations
    address public immutable implementation;

    mapping(uint256 => mapping(bytes32 => address)) public pools; // location => pairKey => pool
    address[] public allPools;

    event PoolCreated(uint256 indexed location, address indexed token0, address indexed token1, address pool, uint16 feeBps);
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

    /// @notice Create a location pool for a token pair. Sorted token0<token1.
    function createPool(
        uint256 location, address tokenA, address tokenB,
        uint16 feeBps, uint256 maxSwapIn, uint32 cooldown
    ) external onlyOwner returns (address pool) {
        require(tokenA != address(0) && tokenB != address(0) && tokenA != tokenB, "bad tokens");
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 k = pairKey(t0, t1);
        require(pools[location][k] == address(0), "pool exists");
        pool = Clones.clone(implementation);
        LocationPool(pool).initialize(t0, t1, location, feeBps, maxSwapIn, cooldown);
        pools[location][k] = pool;
        allPools.push(pool);
        emit PoolCreated(location, t0, t1, pool, feeBps);
    }

    function getPool(uint256 location, address tokenA, address tokenB) external view returns (address) {
        return pools[location][pairKey(tokenA, tokenB)];
    }
    function poolCount() external view returns (uint256) { return allPools.length; }

    function setSigner(address s) external onlyOwner { require(s != address(0), "zero"); gameSigner = s; emit SignerSet(s); }
    function setOwner(address o) external onlyOwner { require(o != address(0), "zero"); owner = o; emit OwnerSet(o); }
}
