#!/usr/bin/env node
/**
 * deploy-boats.js — BOAT OWNERSHIP item tokens for "Seize the Seas" (founder 2026-06-27).
 *
 *   Rowboat / Sloop / Schooner / Brigantine / Galleon / Man-o-War  =  6 ERC20s.
 *
 * ONE ownership token per HULL — the same gear/commodity item-token pattern as deploy-gear.js
 * (LaunchToken.sol: fixed supply, NO owner/mint/burn, immutable, 18-dec; 100% to the treasury/game
 * wallet). A boat token is the HULL-OWNERSHIP item. It is CRAFTED in-game by burning LUMBER equal to
 * HALF the hull's gold cost (see the boat-craft recipe in game/seas/boat-craft.js). Gold price here is
 * METADATA for the Port Royal sell walls (same as gear) — it is NOT charged at deploy.
 *
 * PRICES come from the ONE TRUE catalog: game/lib/ship-catalog.js priceGold. We import it so this
 * deploy can never drift from the store/launch ladder.
 *
 * WHY MIRROR deploy-gear.js (LaunchToken.sol) AND NOT ItemTokenFactory.sol:
 *   The brief referenced mftusd-build/ItemTokenFactory.sol as "the proven item-token pattern", but a
 *   grep of MfT-Launch shows the factory is NEVER deployed and NEVER referenced here — every live item
 *   token (gear-deployed.json: ~150 tokens) was minted by deploy-gear.js via LaunchToken.sol with a
 *   direct ContractFactory.deploy(). To stay consistent with what is actually live (and drop straight
 *   into the existing sell-wall / Port-Royal toolchain), this script mirrors deploy-gear.js byte-for-
 *   byte. Switching to the factory would be a divergence from the proven path — flagged for the founder.
 *
 * Usage:  node deploy/deploy-boats.js            (DRY RUN — prints the plan, sends nothing)
 *         node deploy/deploy-boats.js --execute   (broadcasts to Base mainnet — COORDINATOR runs this)
 *
 * The DRY/EXECUTE flag name (--execute) matches deploy-gear.js exactly. The agent NEVER runs --execute;
 * the Coordinator does, after Ethics review + with the peg bot paused.
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Pull the hull prices from the ONE TRUE catalog so this never drifts from the store/launch ladder.
// ship-catalog.js is an ESM module; we read+parse it without importing (this file is CommonJS, like
// deploy-gear.js). The catalog is a plain object literal, so a tiny eval-in-sandbox is overkill —
// instead we require a CJS shim if present, else parse the priceGold/crewCount fields by regex.
const CATALOG_PATH = path.join(__dirname, '..', 'game', 'lib', 'ship-catalog.js');

/** Parse SHIP_CATALOG entries (key, name, crewCount, priceGold) straight from the source file. */
function loadCatalog() {
  const src = fs.readFileSync(CATALOG_PATH, 'utf8');
  // Match each "key: { ... }" block inside SHIP_CATALOG and pull the fields we need.
  const order = (src.match(/SHIP_ORDER\s*=\s*\[([^\]]+)\]/) || [])[1];
  if (!order) throw new Error('could not find SHIP_ORDER in ship-catalog.js');
  const keys = order.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const ships = [];
  for (const key of keys) {
    // grab the block for this key up to the next "key: {" or end
    const re = new RegExp(`["']?${key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}["']?\\s*:\\s*\\{([\\s\\S]*?)\\},`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`could not find catalog block for hull "${key}"`);
    const block = m[1];
    const name = (block.match(/name\s*:\s*["']([^"']+)["']/) || [])[1];
    const priceGold = Number((block.match(/priceGold\s*:\s*([\d.]+)/) || [])[1]);
    const crewCount = Number((block.match(/crewCount\s*:\s*([\d.]+)/) || [])[1]);
    if (!name || !Number.isFinite(priceGold)) throw new Error(`bad catalog data for hull "${key}" (name=${name} priceGold=${priceGold})`);
    ships.push({ key, name, priceGold, crewCount });
  }
  return ships;
}

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found in env'); process.exit(1); }

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

const DECIMALS = 18n;
const ONE = 10n ** DECIMALS;

// SUPPLY — boats are RARER than gear. Gear is a uniform 100B (deploy-gear.js); a hull is the player's
// whole BUSINESS, not a throwaway consumable, so it gets a much smaller fixed float. 1,000,000,000 (1B)
// whole tokens per hull = still plenty for an ERC20 sell-wall to price against (the Port Royal walls
// quote in fractions), but 100x scarcer than a gear token — it reads as "ownership", not "ammo".
// Same number for every hull so the symbol/price (not the supply) is what distinguishes them. The
// founder can bump this in one place if they want per-hull scarcity (e.g. fewer Man-o-Wars).
const SUPPLY = 1_000_000_000n;

// Per-hull ERC20 symbol — short, stable, BOAT-prefixed so they cluster in wallets/explorers next to
// each other and never collide with a gear symbol (gear uses item-prefixes like SWW/SHI).
const SYMBOL = {
  rowboat:     'BOATROW',
  sloop:       'BOATSLP',
  schooner:    'BOATSCH',
  brigantine:  'BOATBRG',
  galleon:     'BOATGAL',
  'man-o-war': 'BOATMOW',
};

const EMOJI = {
  rowboat: '🛶', sloop: '⛵', schooner: '🚤', brigantine: '🚢', galleon: '🛳️', 'man-o-war': '🏴‍☠️',
};

const OUT = path.join(__dirname, 'boats-deployed.json');
const CSV = path.join(__dirname, '..', 'game', 'seas', 'commodity-tokens.csv'); // appended (created if absent)

// public Base RPC lags read-after-write; retry transient 0x/BAD_DATA reads (same as deploy-gear.js).
async function retryRead(fn, label, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 2500));
    }
  }
}

/** Append a commodity-tokens.csv row (header written if the file does not exist yet). */
function appendCsvRow({ id, name, symbol, address, gold, whole }) {
  const header = 'id,category,name,symbol,address,decimals,goldPrice,supplyWhole\n';
  if (!fs.existsSync(CSV)) fs.writeFileSync(CSV, header);
  fs.appendFileSync(CSV, `${id},boat,${name},${symbol},${address},18,${gold},${whole}\n`);
}

async function main() {
  const ships = loadCatalog();

  // Build the 6 boat-token specs from the catalog. lumberToCraft = priceGold / 2 (UNITS) — recorded
  // here for reference + for the recipe to read; the deploy itself charges NOTHING (gold is metadata).
  const BOATS = ships.map((s) => {
    const symbol = SYMBOL[s.key];
    if (!symbol) throw new Error(`no BOAT symbol mapped for hull "${s.key}" — add it to SYMBOL`);
    return {
      id: `boat-${s.key}`,                 // token id scheme: boat-<hullKey>
      hull: s.key,
      name: `${s.name} (Boat)`,            // ERC20 name; the (Boat) tag marks it as the OWNERSHIP token
      symbol,
      gold: s.priceGold,                    // catalog priceGold — sell-wall metadata
      lumberToCraft: s.priceGold / 2,       // recipe cost in LUMBER UNITS (priceGold/2) — see boat-craft.js
      crewCount: s.crewCount,
      whole: SUPPLY,
      emoji: EMOJI[s.key] || '🚢',
    };
  });

  const artifact = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'LaunchToken.sol', 'LaunchToken.json'));
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const treasury = wallet.address;

  const bal = await provider.getBalance(treasury);
  console.log('Treasury / deployer:', treasury);
  console.log('ETH balance        :', ethers.formatEther(bal), 'ETH');
  console.log('Mode               :', EXECUTE ? 'EXECUTE (broadcasting)' : 'DRY RUN (nothing sent)');
  console.log('Catalog            :', CATALOG_PATH);
  console.log('Supply per hull    :', SUPPLY.toLocaleString(), '(boats are 100x scarcer than gear)');
  console.log('');
  console.log('Planned boat ownership tokens (6):');
  for (const b of BOATS) {
    console.log(`  ${b.emoji} ${b.symbol.padEnd(8)} ${b.name.padEnd(20)} ${String(b.gold).padStart(6)}g  craft=${String(b.lumberToCraft).padStart(6)} LUMBER  supply ${b.whole.toLocaleString()}`);
  }
  console.log('');

  if (!EXECUTE) { console.log('DRY RUN complete. Re-run with --execute to deploy (Coordinator only).'); return; }
  if (bal < ethers.parseEther('0.0004')) { console.error('Refusing to deploy: ETH too low for 6 deploys.'); process.exit(1); }

  // resume: load any already-deployed ids so a re-run only fills the gaps (idempotent, crash-safe).
  const record = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8'))
    : { chain: 'base', chainId: 8453, treasury, deployedAt: new Date().toISOString(), catalog: 'game/lib/ship-catalog.js', supplyPerHull: SUPPLY.toString(), boats: {} };
  if (!record.boats) record.boats = {};

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const fees = { maxFeePerGas: ethers.parseUnits('0.1', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  let nextNonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await provider.getTransactionCount(treasury, 'pending');

  for (const b of BOATS) {
    if (record.boats[b.id]) { console.log(`Skipping ${b.symbol} (already in ${path.basename(OUT)}: ${record.boats[b.id].address})`); continue; }
    const supply = b.whole * ONE;
    console.log(`Deploying ${b.symbol} (${b.name}) ... (nonce ${nextNonce})`);
    const token = await factory.deploy(b.name, b.symbol, supply, treasury, '', { ...fees, nonce: nextNonce });
    nextNonce++;
    await token.waitForDeployment();
    const addr = await token.getAddress();

    const t = new ethers.Contract(addr, [
      'function totalSupply() view returns (uint256)',
      'function balanceOf(address) view returns (uint256)',
    ], provider);
    const ts = await retryRead(() => t.totalSupply(), `${b.symbol}.totalSupply`);
    const tb = await retryRead(() => t.balanceOf(treasury), `${b.symbol}.balanceOf`);
    if (ts !== supply || tb !== supply) throw new Error(`Supply mismatch for ${b.symbol}: total=${ts} treasury=${tb} expected=${supply}`);
    console.log(`  ${b.symbol} -> ${addr}  (verified ${b.whole.toLocaleString()})`);

    record.boats[b.id] = {
      id: b.id, hull: b.hull, name: b.name, symbol: b.symbol, address: addr, decimals: 18,
      gold: b.gold, lumberToCraft: b.lumberToCraft, crewCount: b.crewCount,
      whole: b.whole.toString(), supplyWei: supply.toString(),
    };
    fs.writeFileSync(OUT, JSON.stringify(record, null, 2));   // write after EACH (crash-safe)
    appendCsvRow({ id: b.id, name: b.name, symbol: b.symbol, address: addr, gold: b.gold, whole: b.whole.toString() });
  }

  console.log('\nSaved addresses to', OUT, `(${Object.keys(record.boats).length}/6 recorded)`);
  console.log('Appended rows to ', CSV);
  console.log('\nNEXT (Coordinator): paste each boat address into game/lib/ship-catalog.js tokenAddr (or run the');
  console.log('sync helper noted in boat-craft.js) so the store/recipe can read the live ownership token.');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
