#!/usr/bin/env node
/**
 * deploy-port-keyed-pools.js — GATED, location-keyed trade pools at the 6 NON-hub ports
 * (founder 2026-06-25). Each port gets thin x*y=k LocationPool clones (via LocationLPFactory)
 * for the 11 "basic boring goods" (food) + ONE signature weapon — geographic scarcity, so you
 * must SAIL to a port to buy its weapon. Per-port pools = independent prices the owner inject()s
 * (mills/mines) to imbalance → traveling, position-GATED players arb them = the "keyed arb".
 *
 * Why LocationPool not V3: V3 pools are GLOBAL per token-pair+fee (one price, no per-port markets)
 * AND public (bots flatten routes). LocationPool clones are per-(location,pair) AND gated by a
 * signed game attestation (in-game players only) — see contracts/LocationPool.sol.
 *
 * THIN seed (founder "only like 1000 in each"): 1000 units of the good + 1000*price coin (sets the
 * book starting price); small reserves → prices swing → arb. maxSwapIn caps a single arb bite.
 *
 * Resume-safe (skips recorded pools), budget floor (MIN_ETH), Alchemy RPC, low fee, exact approvals.
 * Usage:  node deploy/deploy-port-keyed-pools.js              (DRY RUN — prints the plan)
 *         BASE_RPC=<alchemy> node deploy/deploy-port-keyed-pools.js --execute
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

const FACTORY = '0x54868729015F0050B364729454a018f1FF7a2d01'; // LocationLPFactory (deployed this session)
const COIN = {
  copper: '0x0197896c617f20d61E73E06eC8b2A95eef176bee',
  silver: '0x36cF0ceDEee07b14C496f77C61d010268c31E0e9',
  gold:   '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004',
};
const ONE = 10n ** 18n;
const SEED_GOOD = 1000n;            // units of the good per pool (founder)
const FEE_BPS = 30;                 // 0.30% swap fee
const MAX_SWAP_IN = 200n * ONE;     // cap one arb bite so a thin pool can't be one-shot drained
const COOLDOWN = 0;                 // per-player swap cooldown (s); 0 = none (pace via maxSwapIn)
const MIN_ETH_WEI = (s => 10n ** 18n / 1000n * BigInt(Math.round(parseFloat(s) * 1000)))(process.env.MIN_ETH || '0.0006');

// 11 food "basic boring goods" — id, token, native coin, book price in that coin
const FOOD = [
  { id: 'salt',     addr: '0xdDCB77AA553718ACc88aA61ba1514EE267Cc6825', coin: 'copper', price: 1 },
  { id: 'honey',    addr: '0x92Cf60b74BD16aAb42f2C249e72E9860e83A765f', coin: 'silver', price: 1 },
  { id: 'rations',  addr: '0x0867653716D37DC9F13c5347A8Ca8fFF6CA95926', coin: 'silver', price: 5 },
  { id: 'apple',    addr: '0xa7E88Ce1163e325Be877C54021da901A7DA8b170', coin: 'gold',   price: 1 },
  { id: 'cinnamon', addr: '0x69a8d4AA5a9ee7965E583bC97288e2B325231b49', coin: 'gold',   price: 1 },
  { id: 'cod',      addr: '0xCdb48Fbea782D46b95426A6791cE9E1d2DDA7559', coin: 'gold',   price: 5 },
  { id: 'jerky',    addr: '0xA34Ce4E86D00d63a847Ec122B7E94D94c2A0FCa0', coin: 'gold',   price: 7 },
  { id: 'ale',      addr: '0x102817fd347c1A8117dDB4f5a9A6D6E363D360F7', coin: 'gold',   price: 8 },
  { id: 'pepper',   addr: '0x27A6c9B2D29A5f1716fc64D6c4913F8501099CC5', coin: 'gold',   price: 30 },
  { id: 'wine',     addr: '0x796Ac66a177f0e18aaCd53D3Ac91c3329A48a7d1', coin: 'gold',   price: 40 },
  { id: 'saffron',  addr: '0xc5e642378D39C24a549a5d6e9C8848771bBa2932', coin: 'gold',   price: 65 },
];
// gems (gold-priced luxury goods) — stocked at the Port Royal hub
const GEMS = [
  { id: 'platinum', addr: '0x6722ef27d1854E73269b0abE42290C000D3EfddA', coin: 'gold', price: 10 },
  { id: 'amethyst', addr: '0xC5a9BC41936EF545DE210727FedCf8a43aEFa95F', coin: 'gold', price: 100 },
  { id: 'ruby',     addr: '0xE78023faFb55e61dC4d28D13F623e32fE9a3Fe6A', coin: 'gold', price: 1000 },
  { id: 'emerald',  addr: '0x3220D7b78F0b3839248E624ed3c7c2c215389063', coin: 'gold', price: 1000 },
  { id: 'diamond',  addr: '0x567c3EA4E2eB7fb0C55523162a248a5A25fD5Bb0', coin: 'gold', price: 10000 },
];

// 6 non-hub ports — location id (q*1000+r from game/lib/location.js) + signature weapon (gold-priced)
const PORTS = [
  { port: 'tortuga_cove',    loc: 2002,  weapon: { id: 'scimitar-iron',  addr: '0xE75b9A1eFae7D006e2BF249Bddf57E770659ad62', price: 15 } },
  { port: 'saltmarsh',       loc: 13002, weapon: { id: 'spear-iron',     addr: '0xe9B1e898b3233c949f4b6D96Cc6ae44eCfA9ec0f', price: 2 } },
  { port: 'beacon_isle',     loc: 14005, weapon: { id: 'longsword-iron', addr: '0x0fFEb9da4B2d1a0362058d9b277473401eFcF6F4', price: 15 } },
  { port: 'bonewater_atoll', loc: 2006,  weapon: { id: 'warhammer-iron', addr: '0x43f1669678f027E62170E02493df43DdFDAfb814', price: 12 } },
  { port: 'kraken_deep',     loc: 5009,  weapon: { id: 'greataxe-iron',  addr: '0x1fB369983d286Db644125871A3AdC96622792faB', price: 20 } },
  { port: 'skull_reef',      loc: 12009, weapon: { id: 'battleaxe-iron', addr: '0xfbeCaf8247a220a6F9839C4C3Edeb979281246c5', price: 10 } },
];

const FACTORY_ABI = [
  'function createPool(uint256 location, address tokenA, address tokenB, uint16 feeBps, uint256 maxSwapIn, uint32 cooldown) returns (address)',
  'function getPool(uint256 location, address tokenA, address tokenB) view returns (address)',
];
const POOL_ABI = ['function token0() view returns (address)', 'function token1() view returns (address)', 'function seed(uint256 amount0, uint256 amount1)'];
const ERC20_ABI = ['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)'];

async function retryRead(fn, tries = 8) { for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { if (i === tries - 1) throw e; await new Promise(r => setTimeout(r, 2500)); } } }
// poll a getPool() until it returns a non-zero address (the registry read lags after createPool)
async function pollPool(fn, tries = 12) {
  for (let i = 0; i < tries; i++) { try { const a = await fn(); if (a && a !== ethers.ZeroAddress) return a; } catch (e) {} await new Promise(r => setTimeout(r, 2500)); }
  return ethers.ZeroAddress;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);

  // build the work list. PORT ROYAL (hub, loc 8003) = the comprehensive market: all food + all
  // gems + EVERY signature weapon. The 6 islands = the boring food + their ONE weapon (scarcity).
  const jobs = [];
  for (const g of FOOD) jobs.push({ port: 'port_royal', loc: 8003, ...g, kind: 'food' });
  for (const g of GEMS) jobs.push({ port: 'port_royal', loc: 8003, ...g, kind: 'gem' });
  for (const p of PORTS) jobs.push({ port: 'port_royal', loc: 8003, ...p.weapon, coin: 'gold', kind: 'weapon' });
  for (const p of PORTS) {
    for (const g of FOOD) jobs.push({ port: p.port, loc: p.loc, ...g, kind: 'food' });
    jobs.push({ port: p.port, loc: p.loc, ...p.weapon, coin: 'gold', kind: 'weapon' });
  }

  console.log('Factory:', FACTORY, ' owner/treasury:', me);
  console.log('Ports:', PORTS.length, ' goods/port:', FOOD.length + 1, ' total keyed pools:', jobs.length);
  console.log('Seed: 1000 good + 1000*price coin · fee', FEE_BPS, 'bps · maxSwapIn 200 · GATED (signed-attestation swaps)');
  console.log('Mode:', EXECUTE ? 'EXECUTE' : 'DRY RUN', '\n');
  for (const p of PORTS) console.log(`  ${p.port.padEnd(16)} loc ${String(p.loc).padEnd(6)} weapon ${p.weapon.id} (${p.weapon.price}g)`);
  console.log('');
  if (!EXECUTE) { console.log('DRY RUN — re-run with --execute (BASE_RPC=<alchemy>) after ETH top-up.'); return; }

  const outFile = path.join(__dirname, 'port-keyed-pools-deployed.json');
  const rec = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { chain: 'base', chainId: 8453, owner: me, factory: FACTORY, pools: {} };
  if (!rec.pools) rec.pools = {};
  const fees = { maxFeePerGas: ethers.parseUnits('0.1', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  let nonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await retryRead(() => provider.getTransactionCount(me, 'pending'));

  for (const j of jobs) {
    const key = `${j.port}:${j.id}`;
    if (rec.pools[key]) continue;                                   // resume-safe
    const bal = await retryRead(() => provider.getBalance(me));
    if (bal <= MIN_ETH_WEI) { console.log(`\nETH floor reached (${ethers.formatEther(bal)}) — stopping. ${Object.keys(rec.pools).length} pools done. Re-run after top-up.`); break; }

    const coinAddr = COIN[j.coin];
    // reuse if already created (resume / lagged prior run), else create — then poll the registry
    // until it shows the clone (getPool lags right after createPool; a zero read is NOT a failure).
    let poolAddr = await retryRead(() => factory.getPool(BigInt(j.loc), j.addr, coinAddr));
    if (poolAddr === ethers.ZeroAddress) {
      try {
        await (await factory.createPool(BigInt(j.loc), j.addr, coinAddr, FEE_BPS, MAX_SWAP_IN, COOLDOWN, { ...fees, nonce: nonce++, gasLimit: 600000 })).wait();
      } catch (e) { if (!/pool exists/i.test(e.message || '')) throw e; } // tolerate already-created (lag)
      poolAddr = await pollPool(() => factory.getPool(BigInt(j.loc), j.addr, coinAddr));
    }
    if (poolAddr === ethers.ZeroAddress) throw new Error(`${key}: pool not created`);

    // seed amounts: 1000 good + 1000*price coin, mapped to sorted token0/token1
    const goodAmt = SEED_GOOD * ONE;
    const coinAmt = SEED_GOOD * BigInt(j.price) * ONE;
    const pool = new ethers.Contract(poolAddr, POOL_ABI, wallet);
    const t0 = await retryRead(() => pool.token0());
    const goodIsT0 = t0.toLowerCase() === j.addr.toLowerCase();
    const amount0 = goodIsT0 ? goodAmt : coinAmt;
    const amount1 = goodIsT0 ? coinAmt : goodAmt;

    // exact approvals to the pool clone (good + coin), then seed. ALWAYS approve — the public/
    // Alchemy allowance read lags and a stale read once skipped approve → seed "allowance exceeded".
    for (const [tok, amt] of [[j.addr, goodAmt], [coinAddr, coinAmt]]) {
      const erc = new ethers.Contract(tok, ERC20_ABI, wallet);
      await (await erc.approve(poolAddr, amt, { ...fees, nonce: nonce++, gasLimit: 100000 })).wait();
    }
    // explicit gasLimit → skip estimateGas (its eth_call reads stale allowance on a lagging node)
    const rc = await (await pool.seed(amount0, amount1, { ...fees, nonce: nonce++, gasLimit: 400000 })).wait();
    console.log(`  ${key.padEnd(28)} -> ${poolAddr}  (1000 ${j.id} + ${SEED_GOOD * BigInt(j.price)} ${j.coin})`);
    rec.pools[key] = { port: j.port, loc: j.loc, good: j.id, kind: j.kind, coin: j.coin, price: j.price, pool: poolAddr, goodAddr: j.addr, tx: rc.hash };
    fs.writeFileSync(outFile, JSON.stringify(rec, null, 2));
  }
  console.log(`\nSaved ${Object.keys(rec.pools).length}/${jobs.length} keyed pools to ${path.basename(outFile)}`);
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
