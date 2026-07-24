#!/usr/bin/env node
/**
 * deploy-gem-peg-pools.js — the in-game barter web. Two-sided thin-band Uniswap V3 peg
 * pools wiring the gem/coin value ladder together (NO Money — in-game only). Persona-
 * pruned + copper↔diamond loop-closer. Pegs priced ONLY against each other (the ratio
 * IS the price). Each pool value-balanced, seeded from treasury within a 10% reserve.
 *
 * Coin triangle (copper/silver, silver/gold, copper/gold) ALREADY LIVE — skipped here.
 *
 * Usage:  node deploy/deploy-gem-peg-pools.js            (DRY RUN)
 *         node deploy/deploy-gem-peg-pools.js --execute   (broadcasts to Base)
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }
const RPC = process.env.BASE_RPC || process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');
const START_NONCE = process.env.START_NONCE ? Number(process.env.START_NONCE) : null;

const NPM     = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const FEE = 100, SPACING = 1;          // 0.01% pool, fine ticks
const BAND = 0.003;                    // ±0.3% thin band
const RESERVE_PCT = 0.10;              // keep 10% of each token's SUPPLY
const ONE = 10n ** 18n;
// minimal fee that still clears Base basefee (~0.005 gwei) — keepers are stopped so no
// contention; ~10 pool creations are gas-heavy, keep effective price low to fit the ETH.
const FEES = { maxFeePerGas: ethers.parseUnits('0.04', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.01', 'gwei') };

// token: [address, valueCp (copper-equiv units), supplyWhole]
const TOK = {
  COPPER:   ['0x0197896c617f20d61E73E06eC8b2A95eef176bee', 1n,        1_000_000_000_000n],
  SILVER:   ['0x36cF0ceDEee07b14C496f77C61d010268c31E0e9', 10n,         100_000_000_000n],
  GOLD:     ['0x2065d87b3a1FACc9A4fE037D7a58bC069F597004', 100n,         10_000_000_000n],
  PLATINUM: ['0x6722ef27d1854E73269b0abE42290C000D3EfddA', 1_000n,        1_000_000_000n],
  AMETHYST: ['0xC5a9BC41936EF545DE210727FedCf8a43aEFa95F', 10_000n,         100_000_000n],
  RUBY:     ['0xE78023faFb55e61dC4d28D13F623e32fE9a3Fe6A', 100_000n,         10_000_000n],
  EMERALD:  ['0x3220D7b78F0b3839248E624ed3c7c2c215389063', 100_000n,         10_000_000n],
  DIAMOND:  ['0x567c3EA4E2eB7fb0C55523162a248a5A25fD5Bb0', 1_000_000n,         1_000_000n],
};
// NEW pools (coin triangle already live)
const POOLS = [
  ['GOLD','PLATINUM'], ['PLATINUM','AMETHYST'], ['AMETHYST','RUBY'], ['AMETHYST','EMERALD'],
  ['RUBY','DIAMOND'], ['EMERALD','DIAMOND'], ['RUBY','EMERALD'],
  ['GOLD','AMETHYST'], ['AMETHYST','DIAMOND'], ['COPPER','DIAMOND'],
];

const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const NPM_ABI = [
  'function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256,uint128,uint256,uint256)',
];
const ERC20_ABI = ['function approve(address,uint256) returns (bool)','function allowance(address,address) view returns (uint256)','function balanceOf(address) view returns (uint256)'];
function isqrt(n){ if(n<2n) return n; let x=n,y=(x+1n)/2n; while(y<x){x=y;y=(x+n/x)/2n;} return x; }
const sqrtPriceX96 = (v0,v1) => isqrt((v0 << 192n) / v1);   // price token1/token0 = v0/v1, both 18-dec
const tickAt = (P) => Math.log(P)/Math.log(1.0001);

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  console.log('Treasury:', me, '| mode:', EXECUTE ? 'EXECUTE' : 'DRY RUN', '\n');

  // per-token budget = treasury balance - 10% of supply; split equally across its pools
  const poolCount = {}; for (const [a,b] of POOLS) { poolCount[a]=(poolCount[a]||0)+1; poolCount[b]=(poolCount[b]||0)+1; }
  const bal = {}, avail = {}, allocUnits = {};
  for (const sym of Object.keys(TOK)) {
    if (!poolCount[sym]) continue;
    const [addr,, supply] = TOK[sym];
    const b = await new ethers.Contract(addr, ERC20_ABI, provider).balanceOf(me);
    bal[sym] = b;
    const reserve = supply * BigInt(Math.round(RESERVE_PCT*100)) / 100n * ONE;
    const av = b > reserve ? b - reserve : 0n;
    avail[sym] = av;
    allocUnits[sym] = av / BigInt(poolCount[sym]); // wei units per pool
  }

  const plan = [];
  for (const [A,B] of POOLS) {
    const [addrA,vA] = TOK[A], [addrB,vB] = TOK[B];
    // value-balance: seed value (in copper-wei) = min(allocA*vA, allocB*vB); amounts back out
    const valA = allocUnits[A] * vA, valB = allocUnits[B] * vB;
    const seedVal = valA < valB ? valA : valB;
    const amtA = seedVal / vA, amtB = seedVal / vB;
    // order token0/token1 by address
    const aFirst = addrA.toLowerCase() < addrB.toLowerCase();
    const t0 = aFirst ? A : B, t1 = aFirst ? B : A;
    const addr0 = TOK[t0][0], addr1 = TOK[t1][0], v0 = TOK[t0][1], v1 = TOK[t1][1];
    const amt0 = t0===A ? amtA : amtB, amt1 = t1===A ? amtA : amtB;
    const sp = sqrtPriceX96(v0, v1);
    const P = Number(v0)/Number(v1);
    const cur = tickAt(P);
    const tickLower = Math.floor(tickAt(P*(1-BAND)));
    const tickUpper = Math.ceil(tickAt(P*(1+BAND)));
    plan.push({ A,B,t0,t1,addr0,addr1,sp,P,cur,tickLower,tickUpper,amt0,amt1,
      ratio: `${Number(TOK[A][1])>=Number(TOK[B][1])?Number(TOK[A][1])/Number(TOK[B][1]):Number(TOK[B][1])/Number(TOK[A][1])}:1` });
  }

  console.log('Per-token budget (avail = bal - 10% reserve), split across pools:');
  for (const sym of Object.keys(allocUnits)) console.log(`  ${sym.padEnd(9)} pools ${poolCount[sym]}  avail ${ethers.formatUnits(avail[sym],18)}  alloc/pool ${ethers.formatUnits(allocUnits[sym],18)}`);
  console.log('\nPools:');
  for (const x of plan) {
    console.log(`  ${x.A}/${x.B}  (${x.ratio})  seed ${ethers.formatUnits(x.t0===x.A?x.amt0:x.amt1,18)} ${x.A} + ${ethers.formatUnits(x.t0===x.A?x.amt1:x.amt0,18)} ${x.B}  ticks[${x.tickLower},${x.tickUpper}]`);
    if (x.amt0 <= 0n || x.amt1 <= 0n) { console.error('   !! zero seed — check budgets'); process.exit(1); }
  }

  if (!EXECUTE) { console.log('\nDRY RUN complete. --execute to build.'); return; }

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  let nonce = START_NONCE != null ? START_NONCE : await provider.getTransactionCount(me, 'pending');
  const out = [];
  for (const x of plan) {
    console.log(`\n=== ${x.A}/${x.B} ===`);
    let pool = await factory.getPool(x.addr0, x.addr1, FEE);
    if (pool === ethers.ZeroAddress) {
      await (await npm.createAndInitializePoolIfNecessary(x.addr0, x.addr1, FEE, x.sp, { ...FEES, nonce: nonce++ })).wait();
      pool = await factory.getPool(x.addr0, x.addr1, FEE);
      console.log('  pool created:', pool);
    } else console.log('  pool exists:', pool);
    for (const [addr, amt, sym] of [[x.addr0,x.amt0,x.t0],[x.addr1,x.amt1,x.t1]]) {
      const erc = new ethers.Contract(addr, ERC20_ABI, wallet);
      if ((await erc.allowance(me, NPM)) < amt) { await (await erc.approve(NPM, amt, { ...FEES, nonce: nonce++ })).wait(); }
    }
    const rc = await (await npm.mint({ token0: x.addr0, token1: x.addr1, fee: FEE, tickLower: x.tickLower, tickUpper: x.tickUpper,
      amount0Desired: x.amt0, amount1Desired: x.amt1, amount0Min: 0n, amount1Min: 0n, recipient: me, deadline: Math.floor(Date.now()/1000)+1200 }, { ...FEES, nonce: nonce++ })).wait();
    console.log('  seeded, tx:', rc.hash);
    out.push({ pair: `${x.A}/${x.B}`, pool, token0: x.addr0, token1: x.addr1, fee: FEE, tickLower: x.tickLower, tickUpper: x.tickUpper });
  }
  fs.writeFileSync(path.join(__dirname,'gem-peg-pools-deployed.json'), JSON.stringify({ chain:'base', owner:me, deployedAt:new Date().toISOString(), pools:out }, null, 2));
  console.log('\nSaved to deploy/gem-peg-pools-deployed.json');
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
