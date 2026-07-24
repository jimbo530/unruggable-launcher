#!/usr/bin/env node
/**
 * deploy-port-royal-gear-keyed.js — make ALL Port Royal gear UNIFORM, location-keyed (founder
 * 2026-06-26: "make them all uniform location keyed LPs"). Deploys a gated x*y=k LocationPool
 * (via the live LocationLPFactory) for every gear token at Port Royal (loc 8003), GEAR/GOLD,
 * replacing the public Uniswap-V3 gear walls. In-game-gated (the signer attests presence), so
 * gear trades the same way as the food/gem keyed pools.
 *
 * Seed: 2000 gear + 2000×goldPrice gold (moderate anchor depth) + small maxSwapIn so the hub
 * price stays near book. Skips the ~6 signature weapons already keyed at PR (factory "pool exists").
 * Resume-safe, gasLimit-explicit, always-approve, pollPool, MIN_ETH floor. Use Alchemy.
 *
 *   node deploy/deploy-port-royal-gear-keyed.js            (DRY RUN)
 *   BASE_RPC=<alchemy> node deploy/deploy-port-royal-gear-keyed.js --execute
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
const GOLD = '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004';
const PORT_ROYAL = 8003;
const ONE = 10n ** 18n;
const SEED_GEAR = 2000n;            // anchor depth (deeper than islands' 1000); price held by maxSwapIn
const FEE_BPS = 30, MAX_SWAP_IN = 100n * ONE, COOLDOWN = 0;
const MIN_ETH_WEI = (s => 10n ** 18n / 1000n * BigInt(Math.round(parseFloat(s) * 1000)))(process.env.MIN_ETH || '0.0008');

const FACTORY_ABI = ['function createPool(uint256,address,address,uint16,uint256,uint32) returns (address)', 'function getPool(uint256,address,address) view returns (address)'];
const POOL_ABI = ['function token0() view returns (address)', 'function seed(uint256,uint256)'];
const ERC20_ABI = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
async function retryRead(fn, t = 8) { for (let i = 0; i < t; i++) { try { return await fn(); } catch (e) { if (i === t-1) throw e; await new Promise(r=>setTimeout(r,2500)); } } }
async function pollPool(fn, t = 12) { for (let i = 0; i < t; i++) { try { const a = await fn(); if (a && a !== ethers.ZeroAddress) return a; } catch (e) {} await new Promise(r=>setTimeout(r,2500)); } return ethers.ZeroAddress; }

async function main() {
  const gear = require(path.join(__dirname, 'gear-deployed.json')).gear;
  const list = Object.values(gear).filter(g => g.address && g.gold > 0);
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);

  console.log('Keyed gear @ Port Royal (loc', PORT_ROYAL + '):', list.length, 'gear · seed', SEED_GEAR.toString(), 'gear + gold @ book · gated · fee', FEE_BPS);
  console.log('Mode:', EXECUTE ? 'EXECUTE' : 'DRY RUN', '\n');
  if (!EXECUTE) { console.log('DRY RUN — re-run with --execute (BASE_RPC=<alchemy>).'); return; }

  const outFile = path.join(__dirname, 'port-royal-gear-keyed-deployed.json');
  const rec = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { chain: 'base', chainId: 8453, owner: me, factory: FACTORY, loc: PORT_ROYAL, pools: {} };
  if (!rec.pools) rec.pools = {};
  const fees = { maxFeePerGas: ethers.parseUnits('0.1','gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02','gwei') };
  let nonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await retryRead(() => provider.getTransactionCount(me, 'pending'));

  for (const g of list) {
    if (rec.pools[g.id]) continue;                                  // resume-safe
    const bal = await retryRead(() => provider.getBalance(me));
    if (bal <= MIN_ETH_WEI) { console.log(`\nETH floor (${ethers.formatEther(bal)}) — stopping. ${Object.keys(rec.pools).length} keyed. Re-run after top-up.`); break; }

    let pool = await retryRead(() => factory.getPool(BigInt(PORT_ROYAL), g.address, GOLD));
    if (pool === ethers.ZeroAddress) {
      try { await (await factory.createPool(BigInt(PORT_ROYAL), g.address, GOLD, FEE_BPS, MAX_SWAP_IN, COOLDOWN, { ...fees, nonce: nonce++, gasLimit: 600000 })).wait(); }
      catch (e) { if (!/pool exists/i.test(e.message || '')) throw e; }
      pool = await pollPool(() => factory.getPool(BigInt(PORT_ROYAL), g.address, GOLD));
    }
    if (pool === ethers.ZeroAddress) throw new Error(`${g.id}: pool not created`);
    const gearAmt = SEED_GEAR * ONE, goldAmt = SEED_GEAR * BigInt(Math.round(g.gold * 1e9)) * ONE / 1_000_000_000n;
    for (const [tok, amt] of [[g.address, gearAmt], [GOLD, goldAmt]])
      await (await new ethers.Contract(tok, ERC20_ABI, wallet).approve(pool, amt, { ...fees, nonce: nonce++, gasLimit: 100000 })).wait();
    const p = new ethers.Contract(pool, POOL_ABI, wallet);
    const gearIsT0 = (await retryRead(() => p.token0())).toLowerCase() === g.address.toLowerCase();
    const a0 = gearIsT0 ? gearAmt : goldAmt, a1 = gearIsT0 ? goldAmt : gearAmt;
    const rc = await (await p.seed(a0, a1, { ...fees, nonce: nonce++, gasLimit: 400000 })).wait();
    console.log(`  ${g.id.padEnd(18)} -> ${pool}  (${SEED_GEAR} + ${g.gold * Number(SEED_GEAR)} gold)`);
    rec.pools[g.id] = { id: g.id, pool, gear: g.address, gold: GOLD, price: g.gold, loc: PORT_ROYAL, tx: rc.hash };
    fs.writeFileSync(outFile, JSON.stringify(rec, null, 2));
  }
  console.log(`\nSaved ${Object.keys(rec.pools).length}/${list.length} keyed gear pools to ${path.basename(outFile)}`);
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
