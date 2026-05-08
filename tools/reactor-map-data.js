#!/usr/bin/env node
/**
 * reactor-map-data.js — builds static JSON for the reactor map
 * Scans all factories, reads pool tags + upstream for each reactor.
 * Output: /var/www/tasern/launcher/api/reactor-map.json
 *
 * PM2: pm2 start reactor-map-data.js --name reactor-map-data --cron "0 0,3,6,9,12,15,18,21 * * *" --no-autorestart
 */

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { ethers } = require("ethers");

const RPC = process.env.ALCHEMY_RPC || "https://mainnet.base.org";
const OUT = process.env.MAP_JSON_PATH || "/var/www/tasern/launcher/api/reactor-map.json";

const FACTORIES = [
  { addr: "0x51eF41E0730c0e607950421e1EE113b089867d3e", deployBlock: 45523770 },
  { addr: "0xb74fe5fA2D030706B4A0C901fDC42C5244695A6e", deployBlock: 45570000 },
  { addr: "0x2e0b20a4FFEaCAcB8D3CD0cF6b9bBE6660c4262e", deployBlock: 45700000 },
  { addr: "0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51", deployBlock: 45639600 },
];
const CHUNK = 9999;

const FACTORY_ABI = [
  "event TokenLaunched(address indexed token, address indexed reactor, address indexed charReactor, address launcher, string name, string symbol, uint256 supply, uint256 seed)",
];
const REACTOR_ABI = [
  "function poolCount() view returns (uint256)",
  "function timeUntilExecute() view returns (uint256)",
  "function upstreamReactor() view returns (address)",
  "function pools(uint256) view returns (uint256 tokenId, address xToken, address poolAddress, uint24 fee, bool tokenIsToken0, bool disabled)",
  "function admin() view returns (address)",
  "function token() view returns (address)",
  "function paused() view returns (bool)",
];
const ERC20_ABI = ["function symbol() view returns (string)"];

const BRICKED = new Set([
  "0xE9679341527B0e062F08c9efEa8764D46030Bfaf",
  "0x885f90b0fcc10AD6d3257Df851eda4c78f38c5A4",
  "0x3FE916c7CB6354eAF8ee49427380740bEe2b061a",
  "0xB7C5b050E0545b5b2b3015111E4f197641F0D3Fa",
]);

const KNOWN_SYMBOLS = {
  "0x20b048fa035d5763685d695e66adf62c5d9f5055": "CHAR",
  "0xbd0cc3b0aaf91b80c862dbcaf39faa4705ee2d7a": "TGN",
  "0xa2a61fd7816951a0bcf8c67ea8f153c1ab5de288": "BURGERS",
  "0x3595ca37596d5895b70efab592ac315d5b9809b2": "AZUSD",
  "0x8fb87d13b40b1a67b22ed1a17e2835fe7e3a9ba3": "MfT",
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": "cbBTC",
  "0x4200000000000000000000000000000000000006": "WETH",
  "0xa5528d1fbd69791b7c6951ef1797dbc2c0e4024b": "EARTH",
  "0x126555aecbac290b25644e4b7f29c016ae95f4dc": "POOP",
  "0xf967bf3dccf8b6826f82de1781c98e61bda3b106": "BB",
  "0x17a176ab2379b86f1e65d79b03bd8c75981244d8": "EB",
  "0xc1ba76771bbf0dd841347630e57c793f9d5accee": "EGP",
  "0x532f27101965dd16442e59d40670faf5ebb142e4": "BRETT",
  "0x4ed4e862860bed51a9570b96d89af5e1b0efefed": "DEGEN",
};

const provider = new ethers.JsonRpcProvider(RPC);
const symCache = { ...KNOWN_SYMBOLS };

async function getSymbol(addr) {
  const k = addr.toLowerCase();
  if (symCache[k]) return symCache[k];
  try {
    const c = new ethers.Contract(addr, ERC20_ABI, provider);
    const s = await c.symbol();
    symCache[k] = s;
    return s;
  } catch {
    return addr.slice(0, 6) + "..." + addr.slice(-4);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function ts() { return new Date().toISOString().slice(11, 19); }

async function discoverLaunches() {
  const currentBlock = await provider.getBlockNumber();
  console.log(`[${ts()}] Current block: ${currentBlock}`);
  const launches = [];
  const seen = new Set();

  for (const f of FACTORIES) {
    const factory = new ethers.Contract(f.addr, FACTORY_ABI, provider);
    for (let from = f.deployBlock; from <= currentBlock; from += CHUNK + 1) {
      const to = Math.min(from + CHUNK, currentBlock);
      try {
        const events = await factory.queryFilter("TokenLaunched", from, to);
        for (const ev of events) {
          if (BRICKED.has(ev.args.reactor) || seen.has(ev.args.reactor)) continue;
          seen.add(ev.args.reactor);
          launches.push({
            name: ev.args.symbol,
            fullName: ev.args.name,
            token: ev.args.token,
            reactor: ev.args.reactor,
            charReactor: ev.args.charReactor,
            seed: ev.args.seed.toString(),
          });
        }
      } catch (e) {
        console.error(`[${ts()}] Chunk ${from}-${to} failed: ${e.message.slice(0, 60)}`);
      }
    }
    await sleep(500);
  }

  console.log(`[${ts()}] Found ${launches.length} launches`);
  return launches;
}

async function readReactor(addr, attempt = 1) {
  const c = new ethers.Contract(addr, REACTOR_ABI, provider);
  const info = { addr, pools: 0, cooldown: null, status: "unknown", upstream: null, tags: [], paused: false };

  try {
    const [poolCount, cd, paused] = await Promise.all([
      c.poolCount(),
      c.timeUntilExecute().catch(() => null),
      c.paused().catch(() => false),
    ]);

    info.pools = Number(poolCount);
    info.cooldown = cd !== null ? Number(cd) : null;
    info.status = cd !== null ? (Number(cd) === 0 ? "ready" : "cooldown") : "unknown";
    info.paused = !!paused;
  } catch (e) {
    // poolCount failed — likely RPC timeout, retry once
    if (attempt < 3) {
      console.log(`[${ts()}]   Retry ${attempt} for ${addr.slice(0, 10)}...`);
      await sleep(2000);
      return readReactor(addr, attempt + 1);
    }
    console.error(`[${ts()}] Read ${addr.slice(0, 10)} failed after retries: ${e.message.slice(0, 60)}`);
    return info;
  }

  // Read upstream separately
  try {
    const upstream = await c.upstreamReactor();
    if (upstream && upstream !== ethers.ZeroAddress) {
      info.upstream = upstream;
    }
  } catch {}

  // Read pool tags (batched)
  const readCount = Math.min(info.pools, 8);
  if (readCount > 0) {
    const poolResults = await Promise.all(
      Array.from({ length: readCount }, (_, i) => c.pools(i).catch(() => null))
    );
    const validPools = poolResults.filter(Boolean);
    const syms = await Promise.all(
      validPools.map(p => getSymbol(p.xToken))
    );
    for (let i = 0; i < validPools.length; i++) {
      const p = validPools[i];
      info.tags.push({ sym: syms[i], addr: p.xToken, disabled: p.disabled, fee: Number(p.fee), nftId: p.tokenId.toString() });
    }
  }
  if (info.pools > readCount) info.tags.push({ sym: `+${info.pools - readCount}`, addr: null, disabled: false });

  return info;
}

const HUB = "0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045";
const TRIGGER = process.env.MAP_TRIGGER_PATH || "/tmp/reactor-map-trigger";
const COOLDOWN_MS = 2 * 60_000;  // 2min min between rebuilds
const POLL_MS = 15_000;          // check trigger every 15s

async function rebuild() {
  console.log(`[${ts()}] === Rebuilding Reactor Map ===`);

  const launches = await discoverLaunches();

  const allAddrs = [HUB];
  for (const l of launches) allAddrs.push(l.reactor, l.charReactor);

  const uniqueAddrs = [...new Set(allAddrs)];
  const BATCH = 3;
  const reactors = {};
  for (let i = 0; i < uniqueAddrs.length; i += BATCH) {
    const batch = uniqueAddrs.slice(i, i + BATCH);
    console.log(`[${ts()}] Reading ${i + 1}-${Math.min(i + BATCH, uniqueAddrs.length)}/${uniqueAddrs.length}...`);
    const results = await Promise.all(batch.map(addr => readReactor(addr)));
    for (let j = 0; j < batch.length; j++) reactors[batch[j]] = results[j];
    if (i + BATCH < uniqueAddrs.length) await sleep(300);
  }

  const output = { updatedAt: new Date().toISOString(), hub: HUB, launches, reactors };

  const dir = path.dirname(OUT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(OUT, JSON.stringify(output, null, 2));
  console.log(`[${ts()}] Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB) — ${launches.length} launches, ${Object.keys(reactors).length} reactors`);
}

async function addBranch(launch) {
  console.log(`[${ts()}] Adding branch: ${launch.name} (${launch.reactor.slice(0, 10)}...)`);

  // Load existing JSON
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));

  // Skip if already present
  if (data.launches.some(l => l.reactor === launch.reactor)) {
    console.log(`[${ts()}] Already in map, skipping`);
    return;
  }

  // Read only the 2 new reactors
  const [primary, char] = await Promise.all([
    readReactor(launch.reactor),
    readReactor(launch.charReactor),
  ]);

  data.launches.push({
    name: launch.name,
    fullName: launch.fullName || launch.name,
    token: launch.token,
    reactor: launch.reactor,
    charReactor: launch.charReactor,
    seed: launch.seed,
  });
  data.reactors[launch.reactor] = primary;
  data.reactors[launch.charReactor] = char;
  data.updatedAt = new Date().toISOString();

  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(`[${ts()}] Added ${launch.name} — now ${data.launches.length} launches, ${Object.keys(data.reactors).length} reactors`);
}

async function main() {
  console.log(`[${ts()}] === Reactor Map Service ===`);
  console.log(`[${ts()}] Trigger: ${TRIGGER} | Cooldown: ${COOLDOWN_MS / 1000}s`);

  // Initial build only if JSON doesn't exist yet
  if (!fs.existsSync(OUT)) {
    await rebuild();
  } else {
    console.log(`[${ts()}] Existing JSON found (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB), waiting for triggers`);
  }
  let lastBuild = Date.now();

  setInterval(async () => {
    if (!fs.existsSync(TRIGGER)) return;
    if (Date.now() - lastBuild < COOLDOWN_MS) {
      console.log(`[${ts()}] Trigger seen, cooldown active (${Math.ceil((COOLDOWN_MS - (Date.now() - lastBuild)) / 1000)}s left)`);
      return;
    }

    let triggerData;
    try {
      triggerData = fs.readFileSync(TRIGGER, "utf8").trim();
      fs.unlinkSync(TRIGGER);
    } catch (e) { console.error(`[${ts()}] Could not read trigger: ${e.message}`); return; }

    try {
      // Try to parse as launch JSON for incremental add
      const launch = JSON.parse(triggerData);
      if (launch.reactor && launch.charReactor) {
        await addBranch(launch);
        lastBuild = Date.now();
        return;
      }
    } catch (e) {
      // Not JSON — treat as full rebuild signal
    }

    console.log(`[${ts()}] Full rebuild triggered`);
    try {
      await rebuild();
      lastBuild = Date.now();
    } catch (e) {
      console.error(`[${ts()}] Rebuild failed: ${e.message}`);
    }
  }, POLL_MS);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
