#!/usr/bin/env node
/**
 * deploy-mill-lp.js — each MILL's own LOCAL keyed LP, on the hex the mill sits on (founder
 * 2026-06-25: "a local LP on the place the mill sits ... low level short arb trips"). A thin
 * LUMBER/GOLD LocationPool keyed to the mill's hex (NOT the port) — production dumps lumber in
 * → it off-balances FAST → players must SAIL to the mill (gated) to buy cheap lumber + haul it.
 * 8 hrs/hex travel means a busy mill regenerates its arb before a round-trip finishes.
 *
 * EXTRA-thin seed (200 lumber + 200×5 gold) + tiny maxSwapIn so it swings hard. Uses the live
 * LocationLPFactory. Resume-safe, gasLimit-explicit (skip stale-allowance estimateGas), Alchemy.
 *
 *   node deploy/deploy-mill-lp.js            (DRY RUN)
 *   BASE_RPC=<alchemy> node deploy/deploy-mill-lp.js --execute
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

const FACTORY = '0x54868729015F0050B364729454a018f1FF7a2d01';
const LUMBER  = '0x7a97e5e76C93267e1FF2EBc38DCC7C7B6f40fF4c';
const GOLD    = '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004';
const ONE = 10n ** 18n;
const LUMBER_PRICE = 5n;            // gold per lumber
const SEED_LUMBER = 200n;          // EXTRA thin → off-balance fast
const FEE_BPS = 30, MAX_SWAP_IN = 50n * ONE, COOLDOWN = 0;

// the mills (game/lib/world-features.js) — hex → loc id (q*1000+r)
const MILLS = [
  { id: 'mill-saltmarsh-1', loc: 13001 },
  { id: 'mill-saltmarsh-2', loc: 14003 },
];

const FACTORY_ABI = [
  'function createPool(uint256,address,address,uint16,uint256,uint32) returns (address)',
  'function getPool(uint256,address,address) view returns (address)',
];
const POOL_ABI = ['function token0() view returns (address)', 'function seed(uint256,uint256)'];
const ERC20_ABI = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
async function retryRead(fn, t = 8) { for (let i = 0; i < t; i++) { try { return await fn(); } catch (e) { if (i === t-1) throw e; await new Promise(r=>setTimeout(r,2500)); } } }
async function pollPool(fn, t = 12) { for (let i = 0; i < t; i++) { try { const a = await fn(); if (a && a !== ethers.ZeroAddress) return a; } catch (e) {} await new Promise(r=>setTimeout(r,2500)); } return ethers.ZeroAddress; }

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);
  console.log('Mill LPs:', MILLS.length, '| LUMBER/GOLD @ each mill hex | seed', SEED_LUMBER.toString(), 'lumber +', (SEED_LUMBER*LUMBER_PRICE).toString(), 'gold | maxSwapIn 50');
  console.log('Mode:', EXECUTE ? 'EXECUTE' : 'DRY RUN');
  for (const m of MILLS) console.log(`  ${m.id}  loc ${m.loc}`);
  if (!EXECUTE) { console.log('\nDRY RUN — re-run with --execute (BASE_RPC=<alchemy>).'); return; }

  const outFile = path.join(__dirname, 'mill-lp-deployed.json');
  const rec = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { chain: 'base', chainId: 8453, owner: me, factory: FACTORY, mills: {} };
  if (!rec.mills) rec.mills = {};
  const fees = { maxFeePerGas: ethers.parseUnits('0.1','gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02','gwei') };
  let nonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await retryRead(() => provider.getTransactionCount(me, 'pending'));
  const lumberAmt = SEED_LUMBER * ONE, goldAmt = SEED_LUMBER * LUMBER_PRICE * ONE;

  for (const m of MILLS) {
    if (rec.mills[m.id]) { console.log(`skip ${m.id} (recorded)`); continue; }
    let pool = await retryRead(() => factory.getPool(BigInt(m.loc), LUMBER, GOLD));
    if (pool === ethers.ZeroAddress) {
      try { await (await factory.createPool(BigInt(m.loc), LUMBER, GOLD, FEE_BPS, MAX_SWAP_IN, COOLDOWN, { ...fees, nonce: nonce++, gasLimit: 600000 })).wait(); }
      catch (e) { if (!/pool exists/i.test(e.message || '')) throw e; }
      pool = await pollPool(() => factory.getPool(BigInt(m.loc), LUMBER, GOLD));
    }
    if (pool === ethers.ZeroAddress) throw new Error(`${m.id}: pool not created`);
    // exact approvals to the clone, then seed (gasLimit skips the stale-allowance estimateGas)
    for (const [tok, amt] of [[LUMBER, lumberAmt], [GOLD, goldAmt]])
      await (await new ethers.Contract(tok, ERC20_ABI, wallet).approve(pool, amt, { ...fees, nonce: nonce++, gasLimit: 100000 })).wait();
    const p = new ethers.Contract(pool, POOL_ABI, wallet);
    const lumberIsT0 = (await retryRead(() => p.token0())).toLowerCase() === LUMBER.toLowerCase();
    const a0 = lumberIsT0 ? lumberAmt : goldAmt, a1 = lumberIsT0 ? goldAmt : lumberAmt;
    const rc = await (await p.seed(a0, a1, { ...fees, nonce: nonce++, gasLimit: 400000 })).wait();
    console.log(`  ${m.id} LP -> ${pool}  (200 lumber + 1000 gold)  ${rc.hash}`);
    rec.mills[m.id] = { id: m.id, loc: m.loc, pool, lumber: LUMBER, gold: GOLD, seedLumber: SEED_LUMBER.toString(), price: Number(LUMBER_PRICE) };
    fs.writeFileSync(outFile, JSON.stringify(rec, null, 2));
  }
  console.log(`\nSaved ${Object.keys(rec.mills).length}/${MILLS.length} mill LPs to ${path.basename(outFile)}`);
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
