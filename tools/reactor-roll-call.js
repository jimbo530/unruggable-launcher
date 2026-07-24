/**
 * Extended Reactor Roll Call — auto-discovers MycoPad launches + fires ALL reactors bottom-up
 *
 * 1. Scans ALL MycoPad factories for TokenLaunched events → gets all launched token reactors + CHAR reactors
 * 2. Fires launched CHAR reactors first (bottom), then launched primary reactors, then existing network
 * 3. Order: launched CHAR reactors → launched primary reactors → existing feeders → bands → MycoPad → main chain → Prime
 *
 * Usage: node reactor-roll-call.js
 * PM2:   pm2 start reactor-roll-call.js --cron "0 0,4,8,12,16,20 * * *"
 */

const path = require('path');
const fs = require('fs');
const localEnv = path.join(__dirname, '..', '..', 'Baselings', 'api', '.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '.env') });
const { ethers } = require('ethers');

const RPC = 'https://mainnet.base.org';
const PK = process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY;

// All MycoPad factories — scanned for auto-discovery (oldest first)
const FACTORIES = [
  { addr: '0x51eF41E0730c0e607950421e1EE113b089867d3e', deployBlock: 45523770, label: 'V4.3' },
  { addr: '0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51', deployBlock: 45639600, label: 'V5.2' },
];

const FACTORY_ABI = [
  'event TokenLaunched(address indexed token, address indexed reactor, address indexed charReactor, address launcher, string name, string symbol, uint256 supply, uint256 seed)'
];

const REACTOR_ABI = [
  'function execute()',
  'function poolCount() view returns (uint256)',
  'function lastExecute() view returns (uint256)',
  'function timeUntilExecute() view returns (uint256)',
  'function paused() view returns (bool)',
];

// Static network — existing reactors that predate MycoPad V4
// Order: bottom-up (feeders first, Prime last)
const STATIC_NETWORK = [
  // --- Feeder layer ---
  { name: 'ecowealth',    addr: '0xc7E739f223934C5F69EBA36BcDf808c4379b1985' },

  // --- BB/EB v5 (feed EB relay) ---
  { name: 'BB v5',        addr: '0x3b31B8c9338ebFE2e737e5dd6361cEf0Bdc431e3' },
  { name: 'EB v5',        addr: '0x2e06EB264dB2C7bcD8B9a216827b7D0eF3beACA2' },

  // --- EB relay (feeds MycoPad) ---
  { name: 'EB relay',     addr: '0xC28e64551816535d9ef06CE95844F2b5317353bA' },

  // --- Band reactors (feed MycoPad) ---
  { name: 'BTCband v1',   addr: '0x2879706E115150BBB9ffb5C432024264dEE0852F' },
  { name: 'ETHband v1',   addr: '0x7018660EFBd7CfE3219388322417D405fC15b23B' },
  { name: 'BTCband v2',   addr: '0x038B87f2Abc1dcE269FF7DE4d3e721b5b57eD8cf' },
  { name: 'ETHband v2',   addr: '0xeB02d1137342cD08C1c4bf61C188d86C5253b631' },
  { name: 'BB v3',        addr: '0x5375817c1798d43036d3b2DAAfaFB8e2247bAcF2' },
  { name: 'EB v3',        addr: '0x361A4E356847c5a0C60B510b2531b640aC51f090' },

  // --- MycoPad hub ---
  { name: 'MycoPad',      addr: '0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045' },

  // --- Main chain (Row 4 → Row 1) ---
  { name: 'TGN',          addr: '0xc3f09dAEF814177E52B4C04ec2872B564a36989D' },
  { name: 'AZUSD',        addr: '0xD8AFb7caD1f8A3Ddc4E16c1516a94949eb119281' },
  { name: 'AZUSD 2',      addr: '0x6888ef2f92e3073a378f7153548e9c7691c90d23' },
  { name: 'BURGERS',      addr: '0xc858026Ec5D30280137032BC6EA86F46ea23C2CA' },
  { name: 'CHAR',         addr: '0xc2eBe90fB9bC7897f06DC00666951Fa9a49A397A' },
  { name: 'EGP',          addr: '0x10A710fced92eB096F796F43BCCFb60884c13819' },
  { name: 'MfT V1 Prime', addr: '0xed3aE91b2bb22307c07438EEebA2500C18EABcFE' },
];

// Bricked reactors — skip these (clone _locked=0 bug, unfixable)
const BRICKED = new Set([
  '0xE9679341527B0e062F08c9efEa8764D46030Bfaf', // BRUH
  '0x885f90b0fcc10AD6d3257Df851eda4c78f38c5A4', // ILM
  '0x3FE916c7CB6354eAF8ee49427380740bEe2b061a', // RT
  '0xB7C5b050E0545b5b2b3015111E4f197641F0D3Fa', // SC
]);

const MAX_RETRIES = 2;
const RETRY_DELAY = 60_000;
const POST_FIRE_DELAY = 30_000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function ts() { return new Date().toISOString().slice(11, 19); }
function short(addr) { return addr.slice(0, 6) + '...' + addr.slice(-4); }

/**
 * Scan all factories for TokenLaunched events → return launched reactors
 * Chunks queries to stay under Base RPC's 10,000 block limit
 */
async function discoverLaunches(provider) {
  const currentBlock = await provider.getBlockNumber();
  const CHUNK = 9999;
  const launches = [];

  for (const f of FACTORIES) {
    const factory = new ethers.Contract(f.addr, FACTORY_ABI, provider);
    console.log('[' + ts() + '] Scanning ' + f.label + ' factory ' + short(f.addr) + ' blocks ' + f.deployBlock + '→' + currentBlock + '...');

    const events = [];
    for (let from = f.deployBlock; from <= currentBlock; from += CHUNK + 1) {
      const to = Math.min(from + CHUNK, currentBlock);
      // Pace + retry to stay under Base public RPC rate limit (-32016 "over rate limit")
      let chunk, attempt = 0;
      while (true) {
        try {
          chunk = await factory.queryFilter('TokenLaunched', from, to);
          break;
        } catch (e) {
          const msg = (e.message || '') + (e.error?.message || '');
          if (/rate limit|-32016|coalesce/i.test(msg) && attempt < 8) {
            attempt++;
            const backoff = 1000 * attempt;
            console.log('[' + ts() + '] rate-limited @ ' + from + ', backoff ' + backoff + 'ms (try ' + attempt + ')');
            await sleep(backoff);
            continue;
          }
          throw e;
        }
      }
      events.push(...chunk);
      await sleep(200); // gentle pacing between log queries
    }

    for (const ev of events) {
      const { token, reactor, charReactor, symbol } = ev.args;
      if (BRICKED.has(reactor)) continue;

      launches.push({
        name: symbol,
        token: token,
        reactor: reactor,
        charReactor: charReactor,
        block: ev.blockNumber,
        factory: f.label
      });
    }
  }

  console.log('[' + ts() + '] Found ' + launches.length + ' launched token(s)');
  for (const l of launches) {
    console.log('  ' + l.name.padEnd(10) + ' [' + l.factory + '] token=' + short(l.token) + ' reactor=' + short(l.reactor) + ' char=' + short(l.charReactor));
  }

  return launches;
}

/**
 * Build the full call line: launched CHAR reactors → launched primary → static network
 */
function buildCallLine(launches) {
  const line = [];

  // 1. All launched CHAR reactors (bottom of the chain — feed into MycoPad)
  for (const l of launches) {
    line.push({ name: l.name + ' CHAR', addr: l.charReactor, source: 'launched' });
  }

  // 2. All launched primary reactors (feed into their CHAR reactor)
  for (const l of launches) {
    line.push({ name: l.name + ' reactor', addr: l.reactor, source: 'launched' });
  }

  // 3. Static network (feeders → bands → MycoPad → main chain → Prime)
  for (const s of STATIC_NETWORK) {
    line.push({ name: s.name, addr: s.addr, source: 'static' });
  }

  return line;
}

async function checkCooldown(contract, name) {
  try {
    const remaining = await contract.timeUntilExecute();
    if (remaining > 0n) {
      return { ready: false, remaining: Number(remaining) };
    }
  } catch (e) { console.warn('checkCooldown: failed to read timeUntilExecute:', e.message || e); }
  return { ready: true };
}

async function fireReactor(contract) {
  // staticCall first
  try {
    await contract.execute.staticCall({ gasLimit: 5_000_000 });
  } catch (e) {
    return { status: 'sim_fail', reason: e.reason || (e.message || '').slice(0, 80) };
  }

  const tx = await contract.execute({ gasLimit: 5_000_000 });
  const receipt = await tx.wait();
  return { status: 'ok', gas: receipt.gasUsed.toString(), hash: tx.hash };
}

async function main() {
  if (!PK) { console.error('Set AGENT_PRIVATE_KEY in .env'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const bal = await provider.getBalance(wallet.address);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  MycoPad Extended Roll Call');
  console.log('═══════════════════════════════════════════════════════');
  console.log('[' + ts() + '] Wallet: ' + wallet.address);
  console.log('[' + ts() + '] ETH: ' + ethers.formatEther(bal));
  console.log('');

  // Auto-discover launched tokens
  const launches = await discoverLaunches(provider);
  console.log('');

  // Build full call line
  const callLine = buildCallLine(launches);
  console.log('[' + ts() + '] Call line: ' + callLine.length + ' reactors (' + launches.length + ' launched + ' + STATIC_NETWORK.length + ' static)');
  console.log('');

  // Print the map
  console.log('── Network Map ──');
  let section = '';
  for (let i = 0; i < callLine.length; i++) {
    const r = callLine[i];
    if (r.source !== section) {
      section = r.source;
      console.log(section === 'launched' ? '  [Launched Tokens]' : '  [Static Network]');
    }
    console.log('  ' + String(i + 1).padStart(2) + '. ' + r.name.padEnd(16) + ' ' + short(r.addr));
  }
  console.log('');

  // Fire em up
  let fired = 0, skipped = 0, failed = 0;

  for (let i = 0; i < callLine.length; i++) {
    const r = callLine[i];
    const contract = new ethers.Contract(r.addr, REACTOR_ABI, wallet);
    const num = String(i + 1).padStart(2);

    // Check cooldown
    const cd = await checkCooldown(contract, r.name);
    if (!cd.ready) {
      console.log('[' + ts() + '] ' + num + '. ' + r.name.padEnd(16) + ' COOLDOWN ' + cd.remaining + 's');
      skipped++;
      continue;
    }

    // Fire with retries
    let done = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await fireReactor(contract);

        if (result.status === 'sim_fail') {
          if (attempt < MAX_RETRIES) {
            console.log('[' + ts() + '] ' + num + '. ' + r.name.padEnd(16) + ' SIM_FAIL (' + attempt + '/' + MAX_RETRIES + '): ' + result.reason);
            await sleep(RETRY_DELAY);
            continue;
          }
          console.log('[' + ts() + '] ' + num + '. ' + r.name.padEnd(16) + ' SKIP: ' + result.reason);
          skipped++;
          done = true;
          break;
        }

        console.log('[' + ts() + '] ' + num + '. ' + r.name.padEnd(16) + ' FIRED gas=' + result.gas + ' tx=' + result.hash.slice(0, 14) + '...');
        fired++;
        done = true;
        break;

      } catch (e) {
        const msg = (e.reason || e.message || '').slice(0, 80);
        if (attempt < MAX_RETRIES) {
          console.log('[' + ts() + '] ' + num + '. ' + r.name.padEnd(16) + ' FAIL (' + attempt + '): ' + msg);
          await sleep(RETRY_DELAY);
        } else {
          console.log('[' + ts() + '] ' + num + '. ' + r.name.padEnd(16) + ' FAILED: ' + msg);
          failed++;
          done = true;
        }
      }
    }

    // Brief pause between fires
    if (done && i < callLine.length - 1) {
      await sleep(POST_FIRE_DELAY);
    }
  }

  const balAfter = await provider.getBalance(wallet.address);
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('[' + ts() + '] ROLL CALL COMPLETE');
  console.log('[' + ts() + '] Fired: ' + fired + ' | Skipped: ' + skipped + ' | Failed: ' + failed);
  console.log('[' + ts() + '] ETH spent: ' + ethers.formatEther(bal - balAfter));
  console.log('[' + ts() + '] Launched tokens in network: ' + launches.length);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
