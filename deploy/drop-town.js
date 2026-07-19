#!/usr/bin/env node
/**
 * drop-town.js — DROP a pre-built town kit onto a real hex the moment players explore it.
 *
 * Calls placeAt(hexId) on every pool in the kit (one-time per pool; the location then locks
 * forever) and records the placement in town-kits-deployed.json. Idempotent / resume-safe:
 * already-placed pools are verified + skipped, so a crashed run just re-runs.
 *
 * After the drop, the seas-server location-signer will attest players AT that hex for these
 * pools with no code change (the attestation reads pool.location() — same signer as V1).
 * Remember to add the town to the game-side market/location config so the pages render it.
 *
 * Usage:
 *   node deploy/drop-town.js --town saltcreek --hex 14007            (DRY RUN)
 *   node deploy/drop-town.js --town saltcreek --hex 14007 --execute  (LIVE)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

const RECORD = path.join(__dirname, 'town-kits-deployed.json');
const FEES = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? null) : null; }

// public-RPC reads rate-limit mid-run — retry with backoff, loudly.
async function retryRead(fn, label, tries = 10) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === tries - 1) throw new Error(`${label}: ${e.shortMessage || e.message}`);
      console.log(`  (read retry ${i + 1}/${tries} ${label})`);
      await sleep(3000 * (i + 1));
    }
  }
}

const POOL_ABI = [
  'function placed() view returns (bool)',
  'function location() view returns (uint256)',
  'function placeAt(uint256)',
];

async function main() {
  const town = (flag('--town') || '').toLowerCase();
  const hex = Number(flag('--hex'));
  if (!town || !Number.isInteger(hex) || hex <= 0) { console.error('--town <name> --hex <q*1000+r> required'); process.exit(1); }
  // hex ids live far below KIT_BASE; refuse anything that smells like a kit id
  const rec = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  if (hex >= (rec.kitBase || 9_000_000)) { console.error(`--hex ${hex} is in kit-id space — pass a real hex id (q*1000+r)`); process.exit(1); }
  const kit = rec.kits[town];
  if (!kit) { console.error(`unknown kit "${town}" — kits: ${Object.keys(rec.kits).join(', ') || '(none)'}`); process.exit(1); }
  if (kit.hex && kit.hex !== hex) { console.error(`kit "${town}" already dropped at hex ${kit.hex} — a placement is forever`); process.exit(1); }
  // one town per hex: refuse a hex another kit already claimed
  for (const [otherName, other] of Object.entries(rec.kits)) {
    if (otherName !== town && other.hex === hex) { console.error(`hex ${hex} already holds kit "${otherName}"`); process.exit(1); }
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`[drop-town] ${EXECUTE ? 'LIVE' : 'DRY RUN'} | kit="${town}" (${kit.size}) -> hex ${hex} | pools=${Object.keys(kit.pools).length}`);

  let nonce = EXECUTE ? await provider.getTransactionCount(wallet.address, 'pending') : 0;
  let placedNow = 0, already = 0;

  for (const [g, p] of Object.entries(kit.pools)) {
    if (!p.pool || !p.seeded) { console.error(`  ${g}: pool missing/unseeded — finish deploy-town-kit.js first`); process.exit(1); }
    const pool = new ethers.Contract(p.pool, POOL_ABI, wallet);
    const isPlaced = await retryRead(() => pool.placed(), `placed ${g}`);
    if (isPlaced) {
      const loc = await retryRead(() => pool.location(), `location ${g}`);
      if (loc !== BigInt(hex)) { console.error(`  ${g}: ALREADY placed at ${loc} (expected ${hex}) — investigate before proceeding`); process.exit(1); }
      already++;
      continue;
    }
    if (!EXECUTE) { console.log(`  would place ${g} (${p.pool}) at ${hex}`); continue; }
    const tx = await pool.placeAt(hex, { nonce: nonce++, gasLimit: 80000, ...FEES });
    await tx.wait();
    const loc = await retryRead(() => pool.location(), `post-place location ${g}`);
    if (loc !== BigInt(hex)) { console.error(`  ${g}: post-place location=${loc} != ${hex} — STOP`); process.exit(1); }
    p.placeTx = tx.hash;
    placedNow++;
    console.log(`  placed ${g} at ${hex} (${tx.hash})`);
    await sleep(4000);
  }

  if (EXECUTE) {
    kit.hex = hex;
    kit.placedAt = new Date().toISOString();
    fs.writeFileSync(RECORD, JSON.stringify(rec, null, 2));
    console.log(`[drop-town] DONE — ${placedNow} placed now, ${already} were already placed. Kit "${town}" lives at hex ${hex}.`);
    console.log('[drop-town] NEXT: add the town to the game-side location/market config so pages + signer surface it.');
  } else {
    console.log(`[drop-town] DRY RUN — ${already} already placed, ${Object.keys(kit.pools).length - already} would be placed.`);
  }
}

main().catch((e) => { console.error('[drop-town] FAILED:', e.shortMessage || e.message); process.exit(1); });
