#!/usr/bin/env node
/**
 * deploy-ocean-fish-pools.js — two FISH/GOLD SELL-WALL pools (founder 2026-06-26: "both LPs can just
 * be sell walls, port royal is 1G and the ocean is .1G let players close this gap in game, put 10 mil
 * at port royal and put 100 mil in the ocean LP"). The 10× gap is BAKED INTO THE SEED — no keeper to
 * create it; PLAYERS close it (buy cheap fish at the ocean, carry it port-ward, sell dear at Port
 * Royal). The deep 100M ocean wall means the route lasts. Both gated LocationPools.
 *   • Port Royal (loc 8003): 10,000,000 fish @ 1 gold     — the DEAR end (sell here)
 *   • Ocean grounds (loc 8004, open water S of PR; on-chain loc is just a remappable label):
 *                            100,000,000 fish @ 0.1 gold  — the CHEAP end (buy here)
 *
 * Resume-safe, pollPool, always-approve, explicit gasLimit, Alchemy. Writes deploy/ocean-deployed.json.
 *   node deploy/deploy-ocean-fish-pools.js                 (DRY RUN)
 *   BASE_RPC=<alchemy> node deploy/deploy-ocean-fish-pools.js --execute
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
const FISH = '0x907D043d33A243cd9818d6e2ccd5b3C9ef9905B5';
const ONE = 10n ** 18n;
const FEE_BPS = 30, MAX_SWAP_IN = 10_000n * ONE, COOLDOWN = 0;  // 10k/swap cap → gap takes many trips to close
const OUT = path.join(__dirname, 'ocean-deployed.json');

// fish = wall size; gold = fish * priceNum/priceDen (PR 1 gold, ocean 0.1 gold). The 10× gap = the route.
const SITES = [
  { key: 'portRoyal', name: 'Port Royal fish wall',  loc: 8003, fish: 10_000_000n,  priceNum: 1n, priceDen: 1n  },
  { key: 'ocean',     name: 'Ocean fishing grounds', loc: 8004, fish: 100_000_000n, priceNum: 1n, priceDen: 10n },
];

const FACTORY_ABI = ['function createPool(uint256,address,address,uint16,uint256,uint32) returns (address)', 'function getPool(uint256,address,address) view returns (address)'];
const POOL_ABI = ['function token0() view returns (address)', 'function seed(uint256,uint256)'];
const ERC20_ABI = ['function approve(address,uint256) returns (bool)'];
async function retryRead(fn, t = 8) { for (let i = 0; i < t; i++) { try { return await fn(); } catch (e) { if (i === t-1) throw e; await new Promise(r=>setTimeout(r,2500)); } } }
async function pollPool(fn, t = 12) { for (let i = 0; i < t; i++) { try { const a = await fn(); if (a && a !== ethers.ZeroAddress) return a; } catch (e) {} await new Promise(r=>setTimeout(r,2500)); } return ethers.ZeroAddress; }

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);
  const rec = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { chain: 'base', chainId: 8453, owner: me, factory: FACTORY, fish: FISH, gold: GOLD };

  console.log('Ocean fish SELL WALLS:', SITES.map(s => `${s.key}@${s.loc} ${s.fish}fish@${Number(s.priceNum)/Number(s.priceDen)}g`).join('  ·  '), `| gated · fee ${FEE_BPS} · cap 10k/swap`);
  console.log('Mode:', EXECUTE ? 'EXECUTE' : 'DRY RUN', '\n');

  let totGold = 0n; for (const s of SITES) totGold += s.fish * s.priceNum / s.priceDen;
  console.log(`  total seed: ${SITES.reduce((a,s)=>a+s.fish,0n)} fish + ${totGold} gold`);
  if (!EXECUTE) { console.log('\nDRY RUN — re-run with --execute (BASE_RPC=<alchemy>).'); return; }

  const fees = { maxFeePerGas: ethers.parseUnits('0.1','gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02','gwei') };
  let nonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await retryRead(() => provider.getTransactionCount(me, 'pending'));

  for (const s of SITES) {
    if (rec[s.key]) { console.log(`  ${s.key} exists -> ${rec[s.key].pool}`); continue; }
    const fishAmt = s.fish * ONE, goldAmt = s.fish * s.priceNum * ONE / s.priceDen;
    let pool = await retryRead(() => factory.getPool(BigInt(s.loc), FISH, GOLD));
    if (pool === ethers.ZeroAddress) {
      try { await (await factory.createPool(BigInt(s.loc), FISH, GOLD, FEE_BPS, MAX_SWAP_IN, COOLDOWN, { ...fees, nonce: nonce++, gasLimit: 600000 })).wait(); }
      catch (e) { if (!/pool exists/i.test(e.message || '')) throw e; }
      pool = await pollPool(() => factory.getPool(BigInt(s.loc), FISH, GOLD));
    }
    if (pool === ethers.ZeroAddress) throw new Error(`${s.key}: pool not created`);
    for (const [tok, amt] of [[FISH, fishAmt], [GOLD, goldAmt]])
      await (await new ethers.Contract(tok, ERC20_ABI, wallet).approve(pool, amt, { ...fees, nonce: nonce++, gasLimit: 100000 })).wait();
    const p = new ethers.Contract(pool, POOL_ABI, wallet);
    const fishIsT0 = (await retryRead(() => p.token0())).toLowerCase() === FISH.toLowerCase();
    const [a0, a1] = fishIsT0 ? [fishAmt, goldAmt] : [goldAmt, fishAmt];
    const rc = await (await p.seed(a0, a1, { ...fees, nonce: nonce++, gasLimit: 400000 })).wait();
    console.log(`  ${s.key.padEnd(10)} -> ${pool}  (${s.fish} fish + ${s.fish * s.priceNum / s.priceDen} gold @ loc ${s.loc}, price ${Number(s.priceNum)/Number(s.priceDen)}g)`);
    rec[s.key] = { name: s.name, pool, loc: s.loc, fish: FISH, gold: GOLD, price: Number(s.priceNum)/Number(s.priceDen), wallFish: s.fish.toString(), tx: rc.hash };
    fs.writeFileSync(OUT, JSON.stringify(rec, null, 2));
  }
  console.log(`\nSaved ocean fish pools to ${path.basename(OUT)}. Next: ocean-keeper.js quote / cycle.`);
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
