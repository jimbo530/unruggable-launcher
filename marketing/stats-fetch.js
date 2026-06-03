/**
 * stats-fetch.js — pulls live on-chain stats for MfT/Unrugable network tweets
 * Reads burn balances, launch count, reactor count from Base mainnet
 */

const { ethers } = require('ethers');

const RPC = 'https://mainnet.base.org';
const BURN = '0xfd780B0aE569e15e514B819ecFDF46f804953a4B';
const FACTORY = '0x5c11fd8D7BB21EE6d012a2c50F4b03870fA9f5F7';
const FACTORY_DEPLOY_BLOCK = 46600000;

// Only tokens that get sent to the burn address (others burn via reactor swaps)
const TOKENS = [
  { symbol: 'MfT', addr: '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3', decimals: 18 },
  { symbol: 'CHAR', addr: '0x20b048fA035D5763685D695e66aDF62c5D9F5055', decimals: 18 },
  { symbol: 'BB', addr: '0xf967bf3dccF8b6826F82de1781C98E61Bda3b106', decimals: 18 },
  { symbol: 'EB', addr: '0x17a176Ab2379b86F1E65D79b03bD8c75981244D8', decimals: 18 },
];

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
const FACTORY_ABI = [
  'function launchCount() view returns (uint256)',
  'event TokenLaunched(address indexed token, address indexed reactor, address indexed charReactor, address launcher, string name, string symbol, uint256 supply, uint256 seed)'
];

// Static network reactors (from reactor-roll-call.js)
const STATIC_REACTORS = 17;

async function fetchStats() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);

  // Launch count
  const launchCount = Number(await factory.launchCount());

  // Total reactors = static network + 2 per launch (primary + CHAR)
  const totalReactors = STATIC_REACTORS + (launchCount * 2);

  // Burn balances for key tokens
  const burns = {};
  for (const t of TOKENS) {
    const contract = new ethers.Contract(t.addr, ERC20_ABI, provider);
    try {
      const bal = await contract.balanceOf(BURN);
      const formatted = Number(ethers.formatUnits(bal, t.decimals));
      burns[t.symbol] = formatted;
    } catch (err) {
      console.error(`[!] Failed to fetch ${t.symbol} burn balance:`, err.message);
      burns[t.symbol] = 0;
    }
  }

  // Total seed raised from launch events
  let totalSeed = 0n;
  const currentBlock = await provider.getBlockNumber();
  for (let from = FACTORY_DEPLOY_BLOCK; from <= currentBlock; from += 10000) {
    const to = Math.min(from + 9999, currentBlock);
    try {
      const events = await factory.queryFilter('TokenLaunched', from, to);
      for (const ev of events) {
        totalSeed += ev.args.seed;
      }
    } catch (err) {
      console.error(`[!] Failed to fetch events block ${from}-${to}:`, err.message);
    }
  }
  const seedUSDC = Number(ethers.formatUnits(totalSeed, 6));

  return { launchCount, totalReactors, burns, seedUSDC };
}

function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  if (n >= 1) return Math.floor(n).toLocaleString();
  if (n > 0) return n.toFixed(4);
  return '0';
}

function buildStatsTweet(stats) {
  const templates = [
    // Launch + burn focus
    () => {
      const lines = [];
      lines.push(`${stats.launchCount} tokens launched on the Unrugable Launcher`);
      lines.push(`${stats.totalReactors} reactors burning supply 24/7`);
      if (stats.burns.CHAR > 0) lines.push(`${formatNum(stats.burns.CHAR)} CHAR carbon credits retired forever`);
      if (stats.burns.MfT > 0) lines.push(`${formatNum(stats.burns.MfT)} $MfT burned by the network`);
      lines.push('');
      lines.push('No withdraw function. Liquidity locked forever.');
      lines.push('');
      lines.push('tasern.quest/unrugable.html');
      return lines.join('\n');
    },

    // Carbon focus
    () => {
      const lines = [];
      lines.push('Every trade through reactor pools retires carbon.');
      lines.push('');
      if (stats.burns.CHAR > 0) lines.push(`CHAR burned: ${formatNum(stats.burns.CHAR)}`);
      lines.push(`Active reactors: ${stats.totalReactors}`);
      lines.push(`Tokens launched: ${stats.launchCount}`);
      lines.push('');
      lines.push('Meme coins that help the planet. Permanently locked liquidity.');
      lines.push('');
      lines.push('$MfT tasern.quest/unrugable.html');
      return lines.join('\n');
    },

    // Network strength
    () => {
      const lines = [];
      lines.push(`The MfT reactor network: ${stats.totalReactors} reactors.`);
      lines.push('');
      lines.push('Every launch adds 2 more reactors.');
      lines.push('Every reactor burns supply and compounds floors.');
      lines.push('Every burn makes every other token stronger.');
      lines.push('');
      if (stats.burns.MfT > 0) lines.push(`$MfT burned so far: ${formatNum(stats.burns.MfT)}`);
      lines.push('');
      lines.push('The heartbeat gets louder with every launch.');
      return lines.join('\n');
    },

    // Unrugable pitch
    () => {
      const lines = [];
      lines.push('What makes a token unrugable?');
      lines.push('');
      lines.push('- No withdraw function in the contract');
      lines.push('- 0% to anyone. 100% in LP pools from block 1');
      lines.push('- Locked TOKEN/Money + TOKEN/Meme pools');
      lines.push('- Reactor burns supply every 2 hours');
      lines.push('- Carbon credits retired from every trade');
      lines.push('');
      lines.push(`${stats.launchCount} tokens live. 0 rugs possible.`);
      lines.push('');
      lines.push('$MfT tasern.quest/unrugable.html');
      return lines.join('\n');
    },

    // Burn leaderboard mini
    () => {
      const lines = [];
      lines.push('Burn report:');
      lines.push('');
      const sorted = Object.entries(stats.burns)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      for (const [sym, amt] of sorted) {
        lines.push(`  ${sym}: ${formatNum(amt)} burned`);
      }
      lines.push('');
      lines.push(`${stats.totalReactors} reactors. ${stats.launchCount} tokens. All unrugable.`);
      lines.push('');
      lines.push('$MfT $CHAR tasern.quest/unrugable.html');
      return lines.join('\n');
    },

    // Seed raised
    () => {
      const lines = [];
      lines.push(`$${formatNum(stats.seedUSDC)} USDC seeded into unrugable tokens.`);
      lines.push('');
      lines.push('Every launch creates (free, just gas):');
      lines.push('  1 TOKEN/Money pool (70%)');
      lines.push('  1 TOKEN/Meme pool (30%)');
      lines.push('  1 reactor (50% burned / 50% to launcher)');
      lines.push('  All locked forever. 0% to anyone.');
      lines.push('');
      lines.push('No keys. No multisig. No rug.');
      lines.push('');
      lines.push('$MfT');
      return lines.join('\n');
    },

    // Simple hype
    () => {
      const lines = [];
      if (stats.burns.MfT > 0) lines.push(`${formatNum(stats.burns.MfT)} $MfT burned.`);
      if (stats.burns.CHAR > 0) lines.push(`${formatNum(stats.burns.CHAR)} carbon credits retired.`);
      lines.push(`${stats.launchCount} tokens launched.`);
      lines.push(`${stats.totalReactors} reactors firing.`);
      lines.push('');
      lines.push('Liquidity locked forever. Supply only goes down.');
      lines.push('');
      lines.push('tasern.quest/unrugable.html');
      return lines.join('\n');
    },
  ];

  const idx = Math.floor(Math.random() * templates.length);
  return templates[idx]();
}

module.exports = { fetchStats, buildStatsTweet, formatNum };
