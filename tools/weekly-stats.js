#!/usr/bin/env node
/**
 * weekly-stats.js — Weekly impact summary for marketing
 *
 * Aggregates:
 * - Total reactor fires (from leaderboard index)
 * - CHAR burned this week
 * - Active pool count across all reactors
 *
 * Posts one formatted metric tweet to stdout suitable for X posting.
 *
 * Usage: node weekly-stats.js
 * PM2:   pm2 start weekly-stats.js --name weekly-stats --cron "0 9 * * 1"  (Monday 9am UTC)
 */

const path = require('path');
const fs = require('fs');
const localEnv = path.join(__dirname, '..', '..', 'Baselings', 'api', '.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '.env') });
const { ethers } = require('ethers');

const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';

// Network token addresses
const CHAR_TOKEN = '0x20b048fA035D5763685D695e66aDF62c5D9F5055';
const BURN_ADDRESS = '0xfd780B0aE569e15e514B819ecFDF46f804953a4B';

// All reactor factory addresses (discover launches from these)
const FACTORIES = [
  '0x51eF41E0730c0e607950421e1EE113b089867d3e',  // Original V5.2
  '0xb74fe5fA2D030706B4A0C901fDC42C5244695A6e',  // Alternate V5.2
  '0x2e0b20a4FFEaCAcB8D3CD0cF6b9bBE6660c4262e',  // Branch 1
  '0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51',  // V5.2 Prime
];

const FACTORY_ABI = [
  'event TokenLaunched(address indexed token, address indexed reactor, address indexed charReactor, address launcher, string name, string symbol, uint256 supply, uint256 seed)',
];

const REACTOR_ABI = [
  'function poolCount() view returns (uint256)',
  'function ExecuteCall(uint256 blockNumber, address caller) view returns (bool)',
  'event ExecuteCall(indexed uint256 blockNumber, indexed address caller)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const provider = new ethers.JsonRpcProvider(RPC);

function ts() { return new Date().toISOString().slice(0, 19); }
function short(a) { return a.slice(0, 6) + '...' + a.slice(-4); }

/**
 * Get all ReactorExecuted events from the past 7 days (leaderboard data)
 * Each ExecuteCall event = one reactor fire
 */
async function getReactorFiresThisWeek() {
  const currentBlock = await provider.getBlockNumber();
  const weekBlocks = 302400; // ~7 days at 2s/block on Base
  const fromBlock = Math.max(currentBlock - weekBlocks, 0);

  console.log(`[${ts()}] Scanning for reactor fires from block ${fromBlock} → ${currentBlock}...`);

  let totalFires = 0;
  const callerSet = new Set();

  // Scan each factory for TokenLaunched events to get all reactors
  for (const factoryAddr of FACTORIES) {
    try {
      const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);
      const launches = [];

      // Get all TokenLaunched events (assume factory has existed for ~120 days)
      const scanFromBlock = Math.max(fromBlock - 1728000, 1); // Extra buffer
      const chunk = 9999;

      for (let from = scanFromBlock; from < currentBlock; from += chunk + 1) {
        const to = Math.min(from + chunk, currentBlock);
        try {
          const events = await factory.queryFilter('TokenLaunched', from, to);
          launches.push(...events);
        } catch (e) {
          console.warn(`[${ts()}] chunk scan ${from}-${to} failed:`, e.message || e);
        }
      }

      console.log(`[${ts()}] Found ${launches.length} launched tokens from ${short(factoryAddr)}`);

      // For each reactor, scan for ExecuteCall events this week
      for (const launch of launches) {
        const reactorAddr = launch.args.reactor;
        const charReactorAddr = launch.args.charReactor;

        // Try main reactor
        try {
          const logs = await provider.getLogs({
            address: reactorAddr,
            topics: [ethers.id('ExecuteCall(uint256,address)')],
            fromBlock: fromBlock,
            toBlock: currentBlock,
          });

          totalFires += logs.length;

          // Try to extract caller from ExecuteCall event (indexed uint256, indexed address)
          // Topic[2] = caller address
          for (const log of logs) {
            if (log.topics.length > 2) {
              const caller = '0x' + log.topics[2].slice(-40);
              callerSet.add(caller);
            }
          }
        } catch (e) {
          console.warn(`[${ts()}] reactor ${short(reactorAddr)} ExecuteCall query failed:`, e.message || e);
        }

        // Try CHAR reactor
        try {
          const logs = await provider.getLogs({
            address: charReactorAddr,
            topics: [ethers.id('ExecuteCall(uint256,address)')],
            fromBlock: fromBlock,
            toBlock: currentBlock,
          });

          totalFires += logs.length;

          for (const log of logs) {
            if (log.topics.length > 2) {
              const caller = '0x' + log.topics[2].slice(-40);
              callerSet.add(caller);
            }
          }
        } catch (e) {
          console.warn(`[${ts()}] CHAR reactor ${short(charReactorAddr)} query failed:`, e.message || e);
        }
      }
    } catch (e) {
      console.error(`[${ts()}] Error scanning factory ${short(factoryAddr)}: ${e.message.slice(0, 80)}`);
    }
  }

  return { fires: totalFires, uniqueCallers: callerSet.size };
}

/**
 * Get CHAR burned this week
 */
async function getCHARBurnedThisWeek() {
  const currentBlock = await provider.getBlockNumber();
  const weekBlocks = 302400;
  const fromBlock = Math.max(currentBlock - weekBlocks, 0);

  console.log(`[${ts()}] Scanning CHAR burns from block ${fromBlock} → ${currentBlock}...`);

  const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
  const BURN_TOPIC = ethers.zeroPadValue(BURN_ADDRESS, 32).toLowerCase();

  let totalBurned = 0n;
  const chunk = 9999;

  try {
    const checksumAddr = ethers.getAddress(CHAR_TOKEN.toLowerCase());

    for (let from = fromBlock; from <= currentBlock; from += chunk + 1) {
      const to = Math.min(from + chunk, currentBlock);
      try {
        const logs = await provider.getLogs({
          address: checksumAddr,
          topics: [TRANSFER_TOPIC, null, BURN_TOPIC],
          fromBlock: from,
          toBlock: to,
        });

        for (const log of logs) {
          // data field is the uint256 value transferred
          totalBurned += BigInt(log.data);
        }
      } catch (e) {
        console.error(`[${ts()}] Log scan error ${from}-${to}: ${e.message.slice(0, 60)}`);
      }
    }
  } catch (e) {
    console.error(`[${ts()}] Error scanning CHAR burns: ${e.message}`);
  }

  return ethers.formatUnits(totalBurned, 18); // CHAR has 18 decimals
}

/**
 * Count active pools across all reactors
 * (Approximation: get pool count from each reactor that's been launched)
 */
async function getActivePools() {
  console.log(`[${ts()}] Counting active pools...`);

  let totalPools = 0;
  let reactorCount = 0;

  for (const factoryAddr of FACTORIES) {
    try {
      const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);

      // Scan all launch events to get all reactors ever created
      const currentBlock = await provider.getBlockNumber();
      const chunk = 9999;

      const launches = [];
      for (let from = 1; from < currentBlock; from += chunk + 1) {
        const to = Math.min(from + chunk, currentBlock);
        try {
          const events = await factory.queryFilter('TokenLaunched', from, to);
          launches.push(...events);
        } catch (e) {
          console.warn(`[${ts()}] pool-count chunk scan failed:`, e.message || e);
        }
      }

      // Get pool count from each reactor
      for (const launch of launches) {
        const reactorAddr = launch.args.reactor;
        const charReactorAddr = launch.args.charReactor;

        try {
          const reactor = new ethers.Contract(reactorAddr, REACTOR_ABI, provider);
          const count = await reactor.poolCount();
          totalPools += Number(count);
          reactorCount++;
        } catch (e) {
          console.warn(`[${ts()}] poolCount failed for reactor ${short(reactorAddr)}:`, e.message || e);
        }

        try {
          const charReactor = new ethers.Contract(charReactorAddr, REACTOR_ABI, provider);
          const count = await charReactor.poolCount();
          totalPools += Number(count);
          reactorCount++;
        } catch (e) {
          console.warn(`[${ts()}] poolCount failed for CHAR reactor ${short(charReactorAddr)}:`, e.message || e);
        }
      }
    } catch (e) {
      console.error(`[${ts()}] Error counting pools from ${short(factoryAddr)}: ${e.message.slice(0, 80)}`);
    }
  }

  return { pools: totalPools, reactors: reactorCount };
}

/**
 * Format the weekly impact summary for X
 */
function formatTweet(fires, uniqueCallers, charBurned, poolCount, reactorCount) {
  const charNum = Math.round(parseFloat(charBurned) * 1000) / 1000;

  return `This week in the MfT reactor network:

${fires} reactor fires
${charNum} CHAR burned for carbon retirement
${poolCount} locked LP positions live
${reactorCount} total reactors

The network never stops.

tasern.quest/leaderboard/`;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  WEEKLY IMPACT STATS');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`[${ts()}] Starting weekly stats run...`);
  console.log('');

  try {
    const fireData = await getReactorFiresThisWeek();
    const charBurned = await getCHARBurnedThisWeek();
    const poolData = await getActivePools();

    console.log('');
    console.log('RESULTS:');
    console.log(`  Reactor fires this week: ${fireData.fires}`);
    console.log(`  Unique callers: ${fireData.uniqueCallers}`);
    console.log(`  CHAR burned: ${Number(charBurned).toLocaleString()}`);
    console.log(`  Total pools: ${poolData.pools}`);
    console.log(`  Total reactors: ${poolData.reactors}`);
    console.log('');

    const tweet = formatTweet(
      fireData.fires,
      fireData.uniqueCallers,
      charBurned,
      poolData.pools,
      poolData.reactors
    );

    console.log('FORMATTED TWEET:');
    console.log('─'.repeat(60));
    console.log(tweet);
    console.log('─'.repeat(60));
    console.log('');
    console.log(`[${ts()}] Stats run complete. Ready to post.`);

    // Save to JSON for retrieval by poster
    const report = {
      timestamp: new Date().toISOString(),
      fires: fireData.fires,
      unique_callers: fireData.uniqueCallers,
      char_burned: charBurned,
      total_pools: poolData.pools,
      total_reactors: poolData.reactors,
      tweet_text: tweet,
    };

    const outPath = process.env.STATS_JSON_PATH || '/var/www/tasern/launcher/api/weekly-stats.json';
    const outDir = path.dirname(outPath);

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`[${ts()}] Report saved to ${outPath}`);

  } catch (e) {
    console.error(`[${ts()}] FATAL ERROR: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`[${ts()}] Uncaught error: ${e.message}`);
  process.exit(1);
});
