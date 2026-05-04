// DeFiLlama TVL Adapter for Unruggable Launcher
// Submit via PR to https://github.com/DefiLlama/DefiLlama-Adapters
// Folder: projects/unruggable-launcher/

const { sumTokens2 } = require('../helper/unwrapLPs');

// V4.3 Factory on Base
const FACTORY = '0x51eF41E0730c0e607950421e1EE113b089867d3e';
const FACTORY_DEPLOY_BLOCK = 45523780;

const FACTORY_ABI = [
  'event TokenLaunched(address indexed token, address indexed reactor, address indexed charReactor, address launcher, string name, string symbol, uint256 supply, uint256 seed)'
];

// Uniswap V3 NonfungiblePositionManager on Base
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

async function tvl(api) {
  // All liquidity is locked in Uniswap V3 positions held by reactor contracts
  // We track the factory's launched reactors and sum their V3 position values
  const logs = await api.getLogs({
    target: FACTORY,
    fromBlock: FACTORY_DEPLOY_BLOCK,
    eventAbi: FACTORY_ABI[0],
  });

  // Collect all reactor addresses (primary + CHAR)
  const reactors = [];
  for (const log of logs) {
    reactors.push(log.reactor);
    reactors.push(log.charReactor);
  }

  // Sum token balances held by all reactors via their V3 positions
  await sumTokens2({ api, owners: reactors, resolveUniV3: true });
}

module.exports = {
  methodology: 'TVL is the total value of Uniswap V3 LP positions permanently locked in reactor contracts. There is no withdraw function — liquidity is locked by the absence of code.',
  base: { tvl },
};
