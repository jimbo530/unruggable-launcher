// DeFiLlama TVL Adapter for Unrugable Launcher (Base)
// Submit via PR to https://github.com/DefiLlama/DefiLlama-Adapters
// Folder: projects/unrugable-launcher/

const { sumTokens2 } = require('../helper/unwrapLPs');

// All Unrugable factory contracts on Base (8453)
// Each factory creates token + reactor + charReactor per launch
// Reactors hold Uniswap V3 LP positions with NO withdraw function
const FACTORIES = [
  { addr: '0x73dA1ac6f2f83291acbe2eBCA9Ab4BF970f9dE29', label: 'V4.2' },
  { addr: '0x51eF41E0730c0e607950421e1EE113b089867d3e', label: 'V4.3' },
  { addr: '0xb74fe5fA2D030706B4A0C901fDC42C5244695A6e', label: 'V5' },
  { addr: '0x2e0b2d7c9b0680F3050BB3Da460F9B4E16BB5F3d', label: 'V5.1' },
  { addr: '0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51', label: 'V5.2' },
  { addr: '0x65F8227f37932e1aF1771398DFA76B4079fbDb21', label: 'V5.3' },
  { addr: '0xb1fE1deeA42F85F124E7cB166B2f52a1D7f1d054', label: 'V5.4' },
  { addr: '0x9FCE6fF019570dC09678C6Fcd513bDF5cf766fC9', label: 'V5.5' },
];

const ZERO = '0x0000000000000000000000000000000000000000';

async function tvl(api) {
  // Each factory exposes launchCount() and launches(i) to enumerate all launches.
  // Each launch returns (token, reactor, charReactor, launcher, supply, seed, timestamp).
  // Reactors hold Uniswap V3 NFT positions. There is no withdraw/remove function —
  // liquidity is permanently locked by the absence of withdrawal code in the contract.

  const reactors = [];

  for (const factory of FACTORIES) {
    let count;
    try {
      count = await api.call({
        target: factory.addr,
        abi: 'function launchCount() view returns (uint256)',
      });
    } catch (e) {
      // Factory may not support launchCount (very old version) — skip
      continue;
    }

    count = Number(count);
    if (count === 0) continue;

    // Build index array for batch call — all calls target the same factory
    const indices = Array.from({ length: count }, (_, i) => i);

    let launches;
    try {
      launches = await api.multiCall({
        target: factory.addr,
        abi: 'function launches(uint256) view returns (address token, address reactor, address charReactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)',
        calls: indices,
        permitFailure: true,
      });
    } catch (e) {
      // Older factories use getLaunch() instead of launches()
      try {
        launches = await api.multiCall({
          target: factory.addr,
          abi: 'function getLaunch(uint256 index) view returns (address token, address reactor, address charReactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)',
          calls: indices,
          permitFailure: true,
        });
      } catch (e2) {
        // Factory incompatible — skip
        continue;
      }
    }

    for (const launch of launches) {
      if (!launch) continue; // permitFailure may return null
      if (launch.reactor && launch.reactor !== ZERO) {
        reactors.push(launch.reactor);
      }
      if (launch.charReactor && launch.charReactor !== ZERO) {
        reactors.push(launch.charReactor);
      }
    }
  }

  // Sum the value of all Uniswap V3 positions held by reactor contracts.
  // resolveUniV3 instructs the helper to look up NFT positions owned by
  // each address and value the underlying token amounts.
  await sumTokens2({ api, owners: reactors, resolveUniV3: true });
}

module.exports = {
  methodology: 'TVL counts the total value of Uniswap V3 LP positions permanently locked inside reactor contracts deployed by the Unrugable Launcher factories on Base. Reactor contracts have no withdraw, transfer, or remove function — liquidity is locked forever by the absence of withdrawal code. Each token launch creates 8 LP positions across 2 reactors (primary + CHAR carbon reactor).',
  start: 1742169600, // 2025-03-17 (first factory deploy on Base)
  base: { tvl },
};
