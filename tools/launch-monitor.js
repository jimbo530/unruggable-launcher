#!/usr/bin/env node
/**
 * launch-monitor.js -- watches V5.2 factory for new token launches
 *
 * Read-only: no wallet needed. Polls Base every 60s for TokenLaunched events.
 * On detection:
 *   - Logs launch details to console
 *   - Writes agent bus notification (for Shark + all agents)
 *   - Persists last-seen block so restarts don't re-alert
 *
 * Usage:  node launch-monitor.js
 * PM2:   pm2 start launch-monitor.js --name launch-monitor
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// --- Config ---
const RPC_URL = 'https://mainnet.base.org';
const FACTORY = '0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51';
const ADOPTION = '0x013a1091108D50eF5F9cC3FDa38f9b2BA4D3F81d';
const POLL_MS = 60_000;  // 60 seconds
const CHUNK_SIZE = 9999; // max block range per queryFilter call

// --- Paths ---
const STATE_FILE = path.join(__dirname, 'launch-monitor-state.json');
const BUS_DIR = path.resolve(__dirname, '..', '..', '..', '.claude', 'agent-bus', 'messages');

// --- ABIs (read-only) ---
const FACTORY_ABI = [
  'event TokenLaunched(address indexed token, address indexed reactor, address indexed charReactor, address launcher, string name, string symbol, uint256 supply, uint256 seed)',
  'function launchCount() view returns (uint256)',
  'function launches(uint256) view returns (address token, address reactor, address charReactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)',
];

const ADOPTION_ABI = [
  'event TokenAdopted(address indexed token, address indexed reactor, address indexed adopter, address upstreamReactor, string name, string symbol)',
  'function adoptionCount() view returns (uint256)',
];

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
];

// --- Helpers ---
function ts() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function short(addr) { return addr.slice(0, 6) + '...' + addr.slice(-4); }

// --- State persistence ---
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error(`[${ts()}] Failed to load state: ${e.message}`);
  }
  return { lastBlock: 0, knownLaunchCount: 0, launches: {} };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error(`[${ts()}] Failed to save state: ${e.message}`);
  }
}

// --- Agent bus notification (adoption variant) ---
function writeAdoptionBusMessage(adoption) {
  try {
    fs.mkdirSync(BUS_DIR, { recursive: true });
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `${timestamp}-monitor-all.md`;
    const filepath = path.join(BUS_DIR, filename);

    const content = [
      '---',
      'from: monitor',
      'to: all',
      'type: adoption-alert',
      'priority: high',
      `timestamp: ${now.toISOString()}`,
      `subject: NEW ADOPTION -- ${adoption.symbol} (${adoption.name})`,
      '---',
      '',
      `# New Token Adoption Detected`,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Name | ${adoption.name} |`,
      `| Symbol | ${adoption.symbol} |`,
      `| Token | ${adoption.token} |`,
      `| Reactor | ${adoption.reactor} |`,
      `| Adopter | ${adoption.adopter} |`,
      `| Upstream | ${adoption.upstreamReactor} |`,
      `| Block | ${adoption.block} |`,
      `| TX | ${adoption.txHash} |`,
      '',
      `## Action Items`,
      '',
      `- **Shark**: Consider early buy (adopted token now has Unrugable reactor)`,
      `- **Marketer**: Celebrate new adoption — "Born anywhere. Made unrugable."`,
      `- **Guardian**: Verify reactor initialized + upstream connected`,
      '',
      `BaseScan: https://basescan.org/tx/${adoption.txHash}`,
    ].join('\n');

    fs.writeFileSync(filepath, content);
    console.log(`[${ts()}]   Bus alert written: ${filename}`);
  } catch (e) {
    console.error(`[${ts()}]   Failed to write adoption bus message: ${e.message}`);
  }
}

// --- Agent bus notification ---
function writeBusMessage(launch) {
  try {
    // Ensure bus directory exists
    fs.mkdirSync(BUS_DIR, { recursive: true });

    const now = new Date();
    const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `${timestamp}-monitor-all.md`;
    const filepath = path.join(BUS_DIR, filename);

    const content = [
      '---',
      'from: monitor',
      'to: all',
      'type: launch-alert',
      'priority: high',
      `timestamp: ${now.toISOString()}`,
      `subject: NEW LAUNCH -- ${launch.symbol} (${launch.name})`,
      '---',
      '',
      `# New Token Launch Detected`,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Name | ${launch.name} |`,
      `| Symbol | ${launch.symbol} |`,
      `| Token | ${launch.token} |`,
      `| Reactor | ${launch.reactor} |`,
      `| CHAR Reactor | ${launch.charReactor} |`,
      `| Launcher | ${launch.launcher} |`,
      `| Supply | ${launch.supply} |`,
      `| Seed | $${launch.seedUSDC} USDC |`,
      `| Block | ${launch.block} |`,
      `| TX | ${launch.txHash} |`,
      '',
      `## Action Items`,
      '',
      `- **Shark**: Consider early buy via MfT route (WETH -> MfT -> ${launch.symbol})`,
      `- **Marketer**: Prepare welcome/celebration post`,
      `- **Guardian**: Verify reactor is properly initialized`,
      '',
      `BaseScan: https://basescan.org/tx/${launch.txHash}`,
    ].join('\n');

    fs.writeFileSync(filepath, content);
    console.log(`[${ts()}]   Bus alert written: ${filename}`);
  } catch (e) {
    console.error(`[${ts()}]   Failed to write bus message: ${e.message}`);
  }
}

// --- Poll for new launches via events ---
async function poll(provider, factory, adoption, state) {
  try {
    const currentBlock = await provider.getBlockNumber();

    // First run: start from current block (only catch future launches)
    if (!state.lastBlock) {
      state.lastBlock = currentBlock;
      // Also store current launch count as baseline
      try {
        state.knownLaunchCount = Number(await factory.launchCount());
        console.log(`[${ts()}] Baseline: ${state.knownLaunchCount} existing launches, watching from block ${currentBlock}`);
      } catch (e) {
        console.error(`[${ts()}] Failed to get launchCount: ${e.message}`);
      }
      saveState(state);
      return;
    }

    if (currentBlock <= state.lastBlock) return;

    // Scan for TokenLaunched events in chunks
    const newLaunches = [];
    for (let from = state.lastBlock + 1; from <= currentBlock; from += CHUNK_SIZE + 1) {
      const to = Math.min(from + CHUNK_SIZE, currentBlock);
      try {
        const events = await factory.queryFilter('TokenLaunched', from, to);
        for (const ev of events) {
          const tokenAddr = ev.args.token;
          // Skip if we already processed this token
          if (state.launches[tokenAddr.toLowerCase()]) continue;

          newLaunches.push({
            token: tokenAddr,
            reactor: ev.args.reactor,
            charReactor: ev.args.charReactor,
            launcher: ev.args.launcher,
            name: ev.args.name,
            symbol: ev.args.symbol,
            supply: ethers.formatUnits(ev.args.supply, 18),
            seedUSDC: (Number(ev.args.seed) / 1e6).toFixed(2),
            block: ev.blockNumber,
            txHash: ev.transactionHash,
          });
        }
      } catch (e) {
        console.error(`[${ts()}] Event query ${from}-${to} failed: ${e.message.slice(0, 100)}`);
      }
    }

    state.lastBlock = currentBlock;

    // Process new launches
    for (const launch of newLaunches) {
      console.log('');
      console.log('='.repeat(60));
      console.log(`[${ts()}] NEW LAUNCH DETECTED`);
      console.log('='.repeat(60));
      console.log(`[${ts()}]   Name:     ${launch.name}`);
      console.log(`[${ts()}]   Symbol:   ${launch.symbol}`);
      console.log(`[${ts()}]   Token:    ${launch.token}`);
      console.log(`[${ts()}]   Reactor:  ${launch.reactor}`);
      console.log(`[${ts()}]   CHAR:     ${launch.charReactor}`);
      console.log(`[${ts()}]   Launcher: ${launch.launcher}`);
      console.log(`[${ts()}]   Supply:   ${launch.supply}`);
      console.log(`[${ts()}]   Seed:     $${launch.seedUSDC} USDC`);
      console.log(`[${ts()}]   Block:    ${launch.block}`);
      console.log(`[${ts()}]   TX:       ${launch.txHash}`);
      console.log('='.repeat(60));

      // Write agent bus notification
      writeBusMessage(launch);

      // Record in state so we don't re-alert
      state.launches[launch.token.toLowerCase()] = {
        symbol: launch.symbol,
        name: launch.name,
        seedUSDC: launch.seedUSDC,
        launcher: launch.launcher,
        block: launch.block,
        detectedAt: new Date().toISOString(),
      };
    }

    // Scan for TokenAdopted events from adoption contract
    try {
      for (let from = state.lastBlock + 1; from <= currentBlock; from += CHUNK_SIZE + 1) {
        const to = Math.min(from + CHUNK_SIZE, currentBlock);
        const events = await adoption.queryFilter('TokenAdopted', from, to);
        for (const ev of events) {
          const tokenAddr = ev.args.token.toLowerCase();
          if (state.launches[tokenAddr]) continue;

          const adopted = {
            token: ev.args.token,
            reactor: ev.args.reactor,
            adopter: ev.args.adopter,
            upstreamReactor: ev.args.upstreamReactor,
            name: ev.args.name,
            symbol: ev.args.symbol,
            block: ev.blockNumber,
            txHash: ev.transactionHash,
          };

          console.log('');
          console.log('='.repeat(60));
          console.log(`[${ts()}] NEW ADOPTION DETECTED`);
          console.log('='.repeat(60));
          console.log(`[${ts()}]   Name:     ${adopted.name}`);
          console.log(`[${ts()}]   Symbol:   ${adopted.symbol}`);
          console.log(`[${ts()}]   Token:    ${adopted.token}`);
          console.log(`[${ts()}]   Reactor:  ${adopted.reactor}`);
          console.log(`[${ts()}]   Adopter:  ${adopted.adopter}`);
          console.log(`[${ts()}]   Upstream: ${adopted.upstreamReactor}`);
          console.log(`[${ts()}]   Block:    ${adopted.block}`);
          console.log(`[${ts()}]   TX:       ${adopted.txHash}`);
          console.log('='.repeat(60));

          writeAdoptionBusMessage(adopted);

          state.launches[tokenAddr] = {
            symbol: adopted.symbol,
            name: adopted.name,
            seedUSDC: '0',
            launcher: adopted.adopter,
            block: adopted.block,
            detectedAt: new Date().toISOString(),
            type: 'adoption',
          };
        }
      }
    } catch (e) {
      console.error(`[${ts()}] Adoption event query failed: ${e.message.slice(0, 100)}`);
    }

    // Also check launchCount as a secondary signal
    try {
      const currentCount = Number(await factory.launchCount());
      if (currentCount > state.knownLaunchCount && newLaunches.length === 0) {
        // launchCount increased but we missed the event -- fetch via index
        console.log(`[${ts()}] launchCount increased ${state.knownLaunchCount} -> ${currentCount} but no events found, fetching by index...`);
        for (let i = state.knownLaunchCount; i < currentCount; i++) {
          try {
            const l = await factory.launches(i);
            const tokenAddr = (l.token || l[0]).toLowerCase();
            if (state.launches[tokenAddr]) continue;

            // Try to get name/symbol from ERC20
            let name = `Launch #${i}`;
            let symbol = 'UNKNOWN';
            try {
              const erc20 = new ethers.Contract(l.token || l[0], ERC20_ABI, provider);
              [name, symbol] = await Promise.all([erc20.name(), erc20.symbol()]);
            } catch (e) {
              console.warn(`[${ts()}]   Could not read ERC20 name/symbol: ${e.message.slice(0, 60)}`);
            }

            const fallbackLaunch = {
              token: l.token || l[0],
              reactor: l.reactor || l[1],
              charReactor: l.charReactor || l[2],
              launcher: l.launcher || l[3],
              name,
              symbol,
              supply: ethers.formatUnits(l.supply || l[4], 18),
              seedUSDC: (Number(l.seed || l[5]) / 1e6).toFixed(2),
              block: 0,
              txHash: 'unknown (detected via launchCount)',
            };

            console.log('');
            console.log(`[${ts()}] LAUNCH DETECTED (via index ${i}): ${symbol} (${name})`);
            console.log(`[${ts()}]   Token:    ${fallbackLaunch.token}`);
            console.log(`[${ts()}]   Seed:     $${fallbackLaunch.seedUSDC} USDC`);

            writeBusMessage(fallbackLaunch);

            state.launches[tokenAddr] = {
              symbol,
              name,
              seedUSDC: fallbackLaunch.seedUSDC,
              launcher: fallbackLaunch.launcher,
              block: 0,
              detectedAt: new Date().toISOString(),
            };
          } catch (e) {
            console.error(`[${ts()}]   Failed to fetch launch index ${i}: ${e.message.slice(0, 80)}`);
          }
        }
      }
      state.knownLaunchCount = currentCount;
    } catch (e) {
      console.error(`[${ts()}] launchCount check failed: ${e.message.slice(0, 80)}`);
    }

    saveState(state);
  } catch (e) {
    console.error(`[${ts()}] Poll error: ${e.message}`);
  }
}

// --- Main ---
async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const adoption = new ethers.Contract(ADOPTION, ADOPTION_ABI, provider);

  // Verify connection
  let blockNum;
  try {
    blockNum = await provider.getBlockNumber();
  } catch (e) {
    console.error(`FATAL: Cannot connect to Base RPC: ${e.message}`);
    process.exit(1);
  }

  let launchCount;
  try {
    launchCount = Number(await factory.launchCount());
  } catch (e) {
    console.error(`FATAL: Cannot read factory launchCount: ${e.message}`);
    process.exit(1);
  }

  let adoptionCount = 0;
  try {
    adoptionCount = Number(await adoption.adoptionCount());
  } catch (e) {
    console.warn(`[${ts()}] Could not read adoptionCount: ${e.message.slice(0, 60)}`);
  }

  const state = loadState();

  console.log('=== Launch Monitor ===');
  console.log(`[${ts()}] Factory:      ${short(FACTORY)}`);
  console.log(`[${ts()}] Adoption:     ${short(ADOPTION)}`);
  console.log(`[${ts()}] Chain:        Base (8453)`);
  console.log(`[${ts()}] Current block: ${blockNum}`);
  console.log(`[${ts()}] Launch count:  ${launchCount}`);
  console.log(`[${ts()}] Adoption count: ${adoptionCount}`);
  console.log(`[${ts()}] Resuming from: block ${state.lastBlock || 'current (first run)'}`);
  console.log(`[${ts()}] Known alerts:  ${Object.keys(state.launches).length}`);
  console.log(`[${ts()}] Bus dir:       ${BUS_DIR}`);
  console.log(`[${ts()}] Polling every ${POLL_MS / 1000}s...`);
  console.log('');

  // Initial poll
  await poll(provider, factory, adoption, state);

  // Keep polling
  setInterval(() => poll(provider, factory, adoption, state), POLL_MS);
}

// --- Global error handlers (PM2 safety) ---
process.on('unhandledRejection', (reason) => {
  console.error(`[${ts()}] Unhandled rejection:`, reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error(`[${ts()}] Uncaught exception:`, err?.message || err);
  process.exit(1);
});

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
