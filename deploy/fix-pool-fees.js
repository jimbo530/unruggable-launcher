#!/usr/bin/env node
/**
 * fix-pool-fees.js — set EVERY gated LocationPool to 0.01% fee (feeBps=1) AND remove the swap cap
 * (maxSwapIn=0) via owner setParams (founder 2026-06-26: keyed in-game LPs should be 0.01% for
 * microtransactions, wrongly deployed at 0.30%; and "i did not ask for swap caps, this should be
 * handled by encumberance not us" — so caps come OFF, limits live in the game's carry capacity).
 * NO redeploy, NO new liquidity.
 *
 * CRITICAL: setParams(feeBps, maxSwapIn, cooldown) sets all three. We set feeBps=1, maxSwapIn=0
 * (uncapped — encumbrance governs), and PRESERVE each pool's cooldown unchanged (read live). The
 * user asked for neither caps nor cooldown changes beyond removing the cap.
 *
 * SAFE PROBE: each pool is tested with feeBps()/maxSwapIn()/cooldown(). If it answers → LocationPool
 * → fix it. If it reverts → it's a public V3 wall (fee baked at creation, not changeable) → SKIP +
 * report (never sends a doomed tx). Idempotent (skips pools already at feeBps=1) + resume-safe.
 *
 *   node deploy/fix-pool-fees.js                  (DRY RUN — counts only, no spend)
 *   BASE_RPC=<alchemy> node deploy/fix-pool-fees.js --execute
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');
const TARGET_FEE = 1;                       // 0.01% = 1 bps
const MIN_ETH_WEI = 10n ** 18n / 1000n;     // 0.001 ETH floor — stop before running dry
const OUT = path.join(__dirname, 'fee-fix-done.json');

const POOL_ABI = [
  'function feeBps() view returns (uint16)', 'function maxSwapIn() view returns (uint256)',
  'function cooldown() view returns (uint32)', 'function location() view returns (uint256)',
  'function setParams(uint16,uint256,uint32)',
];
async function retryRead(fn, t = 6) { for (let i = 0; i < t; i++) { try { return await fn(); } catch (e) { if (i === t-1) throw e; await new Promise(r=>setTimeout(r,2000)); } } }

// gather every distinct pool address across all *deployed*.json
function allPools() {
  const found = new Map(); // addr -> source label
  for (const f of fs.readdirSync(__dirname)) {
    if (!/deployed.*\.json$/i.test(f)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); } catch { continue; }
    const walk = (o, src) => {
      if (!o || typeof o !== 'object') return;
      if (typeof o.pool === 'string' && o.pool.startsWith('0x')) { if (!found.has(o.pool.toLowerCase())) found.set(o.pool.toLowerCase(), { addr: o.pool, src: f }); return; }
      for (const k in o) walk(o[k], src);
    };
    walk(j, f);
  }
  return [...found.values()];
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const pools = allPools();
  console.log(`Scanning ${pools.length} distinct pool addresses across deploy/*deployed.json …\n`);

  const loc = [], already = [], v3 = [];
  for (const p of pools) {
    const c = new ethers.Contract(p.addr, POOL_ABI, provider);
    let fee;
    try { fee = await c.feeBps(); }                 // single call — a revert = not a LocationPool
    catch {                                          // one quick retry to rule out a transient RPC blip
      try { await new Promise(r => setTimeout(r, 800)); fee = await c.feeBps(); }
      catch { v3.push(p); continue; }                // genuinely not a LocationPool (V3 wall) → skip
    }
    try {
      const [cap, cd] = [await c.maxSwapIn(), await c.cooldown()];
      if (Number(fee) === TARGET_FEE && cap === 0n) already.push(p);   // fee right AND no cap
      else loc.push({ ...p, fee: Number(fee), cap, cd });
    } catch { v3.push(p); }
  }
  console.log(`LocationPools to fix (feeBps→1, cap→0): ${loc.length}`);
  console.log(`already 0.01% & uncapped:        ${already.length}`);
  console.log(`V3 walls / not-a-LocationPool (skipped): ${v3.length}`);
  if (v3.length) console.log('  skipped:', v3.map(x => x.src).filter((v,i,a)=>a.indexOf(v)===i).join(', '));
  console.log(`\nWill send ${loc.length} setParams txs: fee→0.01%, cap→0 (uncapped), cooldown preserved.`);
  if (!EXECUTE) { console.log('\nDRY RUN — re-run with --execute (BASE_RPC=<alchemy>) to apply.'); return; }

  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const fees = { maxFeePerGas: ethers.parseUnits('0.12','gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02','gwei') };
  const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT,'utf8')) : {};
  let nonce = await retryRead(() => provider.getTransactionCount(wallet.address, 'pending'));
  let n = 0;
  for (const p of loc) {
    if (done[p.addr.toLowerCase()]) continue;
    if (await retryRead(() => provider.getBalance(wallet.address)) <= MIN_ETH_WEI) { console.log(`\nETH floor hit — stopping at ${n} fixed. Re-run after top-up (resume-safe).`); break; }
    const c = new ethers.Contract(p.addr, POOL_ABI, wallet);
    const rc = await (await c.setParams(TARGET_FEE, 0n, p.cd, { ...fees, nonce: nonce++, gasLimit: 90000 })).wait();  // cap→0 (encumbrance governs), cooldown preserved
    done[p.addr.toLowerCase()] = { loc: undefined, tx: rc.hash };
    fs.writeFileSync(OUT, JSON.stringify(done, null, 2));
    n++; if (n % 20 === 0) console.log(`  …${n}/${loc.length}`);
  }
  console.log(`\nDone. ${n} pools set to 0.01%. (${Object.keys(done).length} total recorded.)`);
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
