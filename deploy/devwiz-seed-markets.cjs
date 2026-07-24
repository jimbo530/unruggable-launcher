#!/usr/bin/env node
/**
 * devwiz-seed-markets.cjs — the DEV-WIZARD kicks the Seize-the-Seas markets to life.
 *
 * WHAT: teleports the dev-wizard pawn (Redrum #1, owned by the ops wallet 0xE2a4) town-to-town via the
 * seas-server admin teleport, then buys goods with GOLD through each town's presence-gated LocationPool
 * — the FIRST real trades, so every market shows live volume + price discovery.
 *
 * PLAN (founder 2026-07-23): a FEW basic goods (apple, cinnamon, cod) in EACH of the 7 towns, plus a
 * LARGE fish buy at Port Royal. (Crabs have NO market to buy from — only the shelved harvest dispenser —
 * so they are intentionally skipped; flagged to the founder.)
 *
 * MECHANIC (honors the wall — we do NOT bypass it): for each buy we (1) teleport the dev-wiz pawn to the
 * town [admin, unlimited range], (2) ask the seas-server for a trade-attest that verifies the wallet OWNS
 * the pawn AND the pawn is AT the pool, (3) swap GOLD->good on-chain with that signature. The gameSigner
 * lives on the VPS; we never forge presence — we legitimately move a pawn we own.
 *
 * SAFETY: GOLD is internal game currency (we hold 917M); the only real cost is gas. Exact approvals only
 * (never MaxUint), Base-paced fees (0.15/0.02 gwei), explicit nonces, one tx at a time, real-or-nothing
 * (a revert is logged, never faked). DRY by default; broadcasts only with --execute.
 *
 * RUN:
 *   node deploy/devwiz-seed-markets.cjs                 # DRY plan (teleports are read-only-ish; NO swaps)
 *   node deploy/devwiz-seed-markets.cjs --execute       # LIVE (needs AGENT_PRIVATE_KEY + SEAS_ADMIN_SECRET)
 *   node deploy/devwiz-seed-markets.cjs --execute --only port_royal   # one town
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'mftusd-build', '.env') });

// ── config ──
const API = (process.env.SEAS_API_BASE || 'https://tasern.quest/seas-api/seas').replace(/\/$/, '');
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const SECRET = process.env.SEAS_ADMIN_SECRET || '';
const DEVWIZ = { collection: '0x4ECe491951B759363bCBAF75389a202Fe0584080', tokenId: '1' }; // Redrum #1
const PLAYER = '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10';                                   // ops wallet
const GOLD = '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004';

const BASICS = ['apple', 'cinnamon', 'cod']; // present in every town, gold-priced
const BASIC_GOLD = 15;    // gold spent per basic-good buy (a few units)
const FISH_GOLD = 3000;   // LARGE fish buy at Port Royal
const FISH_POOL = '0x48dBb4666d6d8A18ff596796b5720E30D85c682B'; // PR fish wall (loc 8003)
const SLIP_BPS = 300n;    // 3% slippage guard

const MAX_FEE = ethers.parseUnits('0.15', 'gwei');
const PRIORITY = ethers.parseUnits('0.02', 'gwei');
const EXECUTE = process.argv.includes('--execute');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? process.argv[i + 1] : null; })();

const POOL_ABI = [
  'function token0() view returns (address)',
  'function open() view returns (bool)',
  'function maxSwapIn() view returns (uint256)',
  'function quote(bool zeroForOne, uint256 amountIn) view returns (uint256)',
  'function swap(bool zeroForOne, uint256 amountIn, uint256 minOut, uint256 expiry, bytes sig) returns (uint256)',
];
const ERC20_ABI = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];

const provider = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true, batchMaxCount: 1 });
const human = (w) => Number(ethers.formatUnits(w, 18));
const decodeLoc = (id) => ({ q: Math.floor(Number(id) / 1000), r: Number(id) % 1000 });

async function api(route, body) {
  const r = await fetch(`${API}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false, error: 'non-JSON' }));
  return { status: r.status, ...j };
}
const teleport = (toHex) => api('teleport', { player: PLAYER, collection: DEVWIZ.collection, tokenId: DEVWIZ.tokenId, toHex, secret: SECRET });
const attest = (pool) => api('trade-attest', { player: PLAYER, collection: DEVWIZ.collection, tokenId: DEVWIZ.tokenId, pool });

function loadPlan() {
  const pk = JSON.parse(fs.readFileSync(path.join(__dirname, 'port-keyed-pools-deployed.json'), 'utf8'));
  const towns = {}; // port -> { loc, goods: { good: {pool, price} } }
  for (const v of Object.values(pk.pools)) {
    towns[v.port] = towns[v.port] || { loc: v.loc, goods: {} };
    towns[v.port].goods[v.good] = { pool: v.pool, price: v.price };
  }
  const order = ['port_royal', 'tortuga_cove', 'saltmarsh', 'beacon_isle', 'bonewater_atoll', 'kraken_deep', 'skull_reef'];
  const plan = [];
  for (const port of order) {
    if (!towns[port]) continue;
    if (ONLY && port !== ONLY) continue;
    const buys = [];
    for (const g of BASICS) if (towns[port].goods[g]) buys.push({ label: `${g}`, pool: towns[port].goods[g].pool, goldIn: BASIC_GOLD });
    if (port === 'port_royal') buys.push({ label: 'FISH (large)', pool: FISH_POOL, goldIn: FISH_GOLD });
    plan.push({ port, loc: towns[port].loc, hex: decodeLoc(towns[port].loc), buys });
  }
  return plan;
}

async function main() {
  console.log('=================================================================');
  console.log(' DEV-WIZARD market seeding — Seize the Seas');
  console.log(`   mode: ${EXECUTE ? '*** LIVE (broadcasts swaps) ***' : 'DRY (teleport+quote+attest; NO swaps)'}`);
  console.log(`   dev-wiz: ${DEVWIZ.collection}:${DEVWIZ.tokenId} (Redrum #1)  buyer: ${PLAYER}`);
  console.log(`   api: ${API}`);
  if (!SECRET) throw new Error('SEAS_ADMIN_SECRET not set (mftusd-build/.env) — needed for dev-wizard teleport');
  console.log('=================================================================');

  let wallet = null, nonce = null;
  if (EXECUTE) {
    const key = process.env.AGENT_PRIVATE_KEY;
    if (!key) throw new Error('AGENT_PRIVATE_KEY not set (mftusd-build/.env)');
    wallet = new ethers.Wallet(key.startsWith('0x') ? key : `0x${key}`, provider);
    if (wallet.address.toLowerCase() !== PLAYER.toLowerCase()) throw new Error(`key is ${wallet.address}, expected ops wallet ${PLAYER}`);
    const [eth, gold] = await Promise.all([provider.getBalance(PLAYER), new ethers.Contract(GOLD, ERC20_ABI, provider).balanceOf(PLAYER)]);
    console.log(`   wallet ETH=${ethers.formatEther(eth)}  GOLD=${human(gold)}`);
    nonce = await provider.getTransactionCount(PLAYER, 'pending');
  }

  const plan = loadPlan();
  let done = 0, failed = 0, spentGold = 0;

  for (const town of plan) {
    console.log(`\n───── ${town.port}  (loc ${town.loc}, hex ${town.hex.q},${town.hex.r}) ─────`);
    const tp = await teleport(town.hex);
    if (!tp.ok) { console.log(`  ✗ teleport failed (${tp.status}): ${tp.reason || tp.error}`); failed += town.buys.length; continue; }
    console.log(`  ✓ dev-wiz teleported here (${tp.location})`);

    for (const b of town.buys) {
      const goldInWei = ethers.parseUnits(String(b.goldIn), 18);
      try {
        const pool = new ethers.Contract(b.pool, POOL_ABI, wallet || provider);
        const [t0, open] = await Promise.all([pool.token0(), pool.open()]);
        if (!open) { console.log(`  ⏸ ${b.label}: pool closed — skip`); failed++; continue; }
        const zeroForOne = t0.toLowerCase() === GOLD.toLowerCase(); // gold IN
        const out = await pool.quote(zeroForOne, goldInWei);
        if (out === 0n) { console.log(`  ✗ ${b.label}: quote 0 (not filling) — skip`); failed++; continue; }
        const minOut = (out * (10000n - SLIP_BPS)) / 10000n;

        if (!EXECUTE) {
          console.log(`  • ${b.label.padEnd(12)} DRY: spend ${b.goldIn} gold -> ~${human(out).toFixed(3)} units (minOut ${human(minOut).toFixed(3)})  pool ${b.pool.slice(0, 10)}…`);
          spentGold += b.goldIn; done++;
          continue;
        }

        // LIVE: attest (proves dev-wiz presence) -> approve exact -> swap
        const at = await attest(b.pool);
        if (!at.ok || !at.sig) { console.log(`  ✗ ${b.label}: attest failed (${at.status}): ${at.reason || at.error}`); failed++; continue; }
        const gc = new ethers.Contract(GOLD, ERC20_ABI, wallet);
        const cur = await gc.allowance(PLAYER, b.pool);
        if (cur < goldInWei) {
          const atx = await gc.approve(b.pool, goldInWei, { nonce: nonce++, maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY, gasLimit: 70000 });
          await atx.wait();
        }
        const tx = await pool.swap(zeroForOne, goldInWei, minOut, at.expiry, at.sig, { nonce: nonce++, maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY, gasLimit: 260000 });
        const rc = await tx.wait();
        if (rc.status !== 1) { console.log(`  ✗ ${b.label}: swap REVERTED tx ${tx.hash}`); failed++; continue; }
        console.log(`  ✅ ${b.label.padEnd(12)} bought ~${human(out).toFixed(3)} for ${b.goldIn} gold — tx ${tx.hash}`);
        done++; spentGold += b.goldIn;
        await new Promise((r) => setTimeout(r, 4000)); // Base pacing
      } catch (e) {
        console.log(`  ✗ ${b.label}: ${e.shortMessage || e.reason || e.message}`);
        failed++;
        try { nonce = await provider.getTransactionCount(PLAYER, 'pending'); } catch {}
      }
    }
  }

  console.log('\n=================================================================');
  console.log(` DONE. buys ${EXECUTE ? 'fired' : 'planned'}=${done}  failed=${failed}  gold ${EXECUTE ? 'spent' : 'planned'}=${spentGold}`);
  console.log(' (crabs skipped — no crab market exists; flagged to founder.)');
  console.log('=================================================================');
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('[devwiz-seed] FATAL:', e.message || e); process.exit(1); });
