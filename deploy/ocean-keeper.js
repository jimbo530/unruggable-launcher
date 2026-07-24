#!/usr/bin/env node
/**
 * RETIRED / DEAD — DO NOT USE. Replaced by deploy/ocean-water-keeper.js.
 *
 * WHY RETIRED (founder 2026-06-27: "the keeper is wrong and not what i said to do"):
 *   This keeper just DUMPED FREE TREASURY FISH (single-sided inject, no funds, no buy) into the ocean
 *   LP. That is NOT the design. The CANONICAL fishing back end (project_seas_endowment_engine.md
 *   "CANONICAL FISHING SYSTEM — END TO END") is:
 *     FISH water vault yield -> BUY fish at Port Royal (spends GOLD) -> INJECT fish into the ocean (free).
 *   The YIELD (our funds) fuels the buy-dear/dump-cheap gap. NEVER free treasury fish.
 *
 *   The correct keeper is:  deploy/ocean-water-keeper.js
 *   The FISH water vault is: mftusd-build/deploy-ocean-water.cjs (WaterV2 payout=GOLD, "FISH water")
 *
 * The inject path below is DISABLED so this can never dump free treasury fish again. `quote`
 * (read-only) is left intact for reference. Use ocean-water-keeper.js for everything.
 *
 * ── original (WRONG) header kept for the record ──
 * ocean-keeper.js — the OCEAN IMBALANCE keeper (founder 2026-06-26: "we do want the keeper that buys
 * fish and puts them in the ocean, it helps maintain the imbalance" + "we dont need gold for this at
 * all"). We already hold 100B fish, so the keeper "buys" nothing with gold — it INJECTS treasury fish
 * (single-sided, owner-only) straight into an ocean LP, keeping it CHEAP so the Port-Royal↔ocean trade
 * route never closes. Pure fish in; NO GOLD, no swap, no signer (mirror of mill-keeper.js `produce`).
 *
 * As players buy ocean fish the price drifts up toward Port Royal's 1g; a cycle dumps fish back so the
 * ocean snaps back to ~0.1g and the 10× route reopens. Run it on a cadence (or after the gap narrows).
 *
 *   node deploy/ocean-keeper.js quote [site]                     — show fish prices (read-only)
 *   BASE_RPC=<alchemy> node deploy/ocean-keeper.js inject [site] [units] --execute   — dump fish into the ocean
 *
 * `site` defaults to `ocean`; any key in deploy/ocean-deployed.json works (more ocean/shore zones
 * added there over time — founder: "we also will need more ocean and shore zones in time").
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });

const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const ONE = 10n ** 18n;
const FISH = '0x907D043d33A243cd9818d6e2ccd5b3C9ef9905B5';
const DEFAULT_UNITS = 1_000_000n;   // fish dumped per cycle (the restock dial; tune to player traffic)
const OUT = path.join(__dirname, 'ocean-deployed.json');

const POOL_ABI = [
  'function token0() view returns (address)', 'function getReserves() view returns (uint256,uint256)',
  'function quote(bool,uint256) view returns (uint256)', 'function inject(bool,uint256)',
];
const ERC20_ABI = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
const FEES = { maxFeePerGas: ethers.parseUnits('0.1', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };

function sites() {
  if (!fs.existsSync(OUT)) { console.error(`no ${path.basename(OUT)} — run deploy/deploy-ocean-fish-pools.js first`); process.exit(1); }
  return JSON.parse(fs.readFileSync(OUT, 'utf8'));
}
const fishPrice = async (pool) => {
  const fishIsT0 = (await pool.token0()).toLowerCase() === FISH.toLowerCase();
  return Number(ethers.formatUnits(await pool.quote(fishIsT0, ONE), 18));   // 1 fish -> gold (read only)
};

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--execute');
  const EXECUTE = process.argv.includes('--execute');
  const cmd = args[0];
  const cfg = sites();

  if (cmd === 'quote') {
    const provider = new ethers.JsonRpcProvider(RPC);
    for (const key of Object.keys(cfg)) {
      if (!cfg[key] || !cfg[key].pool) continue;
      const price = await fishPrice(new ethers.Contract(cfg[key].pool, POOL_ABI, provider));
      console.log(`  ${key.padEnd(11)} loc ${cfg[key].loc}  fish = ${price.toFixed(4)} gold`);
    }
    return;
  }

  if (cmd === 'inject') {
    console.error('RETIRED: free-treasury-fish inject is DISABLED. This keeper is dead — it dumped free');
    console.error('fish (the bug). Use deploy/ocean-water-keeper.js: yield -> buy fish @ Port Royal -> inject ocean.');
    process.exit(2);
  }

  if (cmd === '__never__') {
    const site = (args[1] && isNaN(Number(args[1]))) ? args[1] : 'ocean';
    const unitsArg = args.find((a, i) => i > 0 && !isNaN(Number(a)));
    const units = BigInt(unitsArg || DEFAULT_UNITS), amt = units * ONE;
    const s = cfg[site];
    if (!s || !s.pool) { console.error(`unknown site '${site}'; known:`, Object.keys(cfg).filter(k => cfg[k]?.pool).join(', ')); process.exit(1); }
    const provider = new ethers.JsonRpcProvider(RPC);
    const pool = new ethers.Contract(s.pool, POOL_ABI, provider);
    const before = await fishPrice(pool);
    console.log(`OCEAN RESTOCK: inject ${units} fish into ${site} (${s.pool}) — no gold, treasury stock`);
    console.log(`  fish price BEFORE: ${before.toFixed(4)} gold`);
    if (!EXECUTE) { console.log('  DRY — add --execute (BASE_RPC=<alchemy>). Guardian gate: needs explicit approval.'); return; }

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    let nonce = await provider.getTransactionCount(wallet.address, 'pending');
    const fishIsT0 = (await pool.token0()).toLowerCase() === FISH.toLowerCase();
    await (await new ethers.Contract(FISH, ERC20_ABI, wallet).approve(s.pool, amt, { ...FEES, nonce: nonce++, gasLimit: 100000 })).wait();
    await (await pool.connect(wallet).inject(fishIsT0, amt, { ...FEES, nonce: nonce++, gasLimit: 200000 })).wait();
    const after = await fishPrice(pool);
    console.log(`  fish price AFTER:  ${after.toFixed(4)} gold  (cheaper by ${((1 - after / before) * 100).toFixed(1)}% → route reopened)`);
    return;
  }

  console.log('RETIRED keeper. usage: ocean-keeper.js quote [site] (read-only only).');
  console.log('inject is DISABLED. Use deploy/ocean-water-keeper.js (yield -> buy @ Port Royal -> inject ocean).');
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
