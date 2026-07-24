#!/usr/bin/env node
/**
 * deploy-port-royal-walls.js — PORT ROYAL market: one-sided SELL WALLS for the gear
 * tokens, priced in GOLD at the authentic D&D book price (founder 2026-06-25).
 *
 * Port Royal (market id 8003 — the hub) is the price ANCHOR: it SELLS gear at book
 * price. Each wall is a single one-sided Uniswap V3 position holding ONLY the gear
 * token (zero gold deposited). Players bring GOLD, buy gear at book price; as the wall
 * is eaten the price climbs. 5,000,000 gear per wall holds the price for a long time.
 *
 *   FEE = 100 (0.01% — lowest tier, for the micro-transactions)   SPACING = 1
 *   quote token = GOLD coin (18 dec, same as gear → no decimal adjustment)
 *   price = gold-per-gear = the gear token's `gold` field (book price x material mult)
 *
 * Gear may sort either side of GOLD by address, so the wall side is chosen per token:
 *   gear = token0  -> 100% token0, ticks ABOVE current (price gold/gear rises as bought)
 *   gear = token1  -> 100% token1, ticks BELOW current (same economics, inverted price)
 *
 * Usage:  node deploy/deploy-port-royal-walls.js            (DRY RUN)
 *         node deploy/deploy-port-royal-walls.js --execute   (broadcasts to Base)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

const GOLD = '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004'; // Gold Coin, 18 dec
const NPM     = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const FEE = Number(process.env.WALL_FEE || 100);       // 0.01% lowest tier
const SPACING = Number(process.env.WALL_SPACING || 1);
const MAX_TICK = Math.floor(887272 / SPACING) * SPACING;
const MIN_TICK = -MAX_TICK;
const PORT_ROYAL = 8003;
const WALL_WHOLE = BigInt(process.env.WALL_WHOLE || 5_000_000); // gear per wall

const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const NPM_ABI = [
  'function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
];
const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];

function isqrt(n){ if(n<0n) throw new Error('neg'); if(n<2n) return n; let x=n,y=(x+1n)/2n; while(y<x){x=y;y=(x+n/x)/2n;} return x; }

// public Base RPC flakes on reads (CALL_EXCEPTION / 0x) — retry transient failures.
async function retryRead(fn, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { if (i === tries - 1) throw e; await new Promise(r => setTimeout(r, 2500)); }
  }
}

async function main() {
  const gear = require(path.join(__dirname, 'gear-deployed.json')).gear;
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;

  console.log('Wallet/treasury:', me);
  console.log('Quote coin     : GOLD', GOLD, '(18 dec)');
  console.log('Fee / spacing  :', FEE, '/', SPACING, '  Port Royal market id', PORT_ROYAL);
  console.log('Wall size      :', WALL_WHOLE.toLocaleString(), 'gear each (one-sided, gear-only)');
  console.log('Mode           :', EXECUTE ? 'EXECUTE (broadcasting)' : 'DRY RUN (nothing sent)');
  console.log('');

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const goldLc = GOLD.toLowerCase();

  const plan = [];
  for (const id of Object.keys(gear)) {
    const g = gear[id];
    const gearAddr = g.address;
    const gearIsToken0 = gearAddr.toLowerCase() < goldLc;
    const token0 = gearIsToken0 ? gearAddr : GOLD;
    const token1 = gearIsToken0 ? GOLD : gearAddr;

    // gold-per-gear as exact fraction (handles the 7.5 case); both tokens 18 dec.
    const goldNum = BigInt(Math.round(g.gold * 1e9));
    const goldDen = 1_000_000_000n;
    // raw price P = token1/token0
    //   gear=token0: P = gold/gear = goldNum/goldDen
    //   gear=token1: P = gear/gold = goldDen/goldNum
    const numP = gearIsToken0 ? goldNum : goldDen;
    const denP = gearIsToken0 ? goldDen : goldNum;
    const sqrtPriceX96 = isqrt((numP << 192n) / denP);
    const P = Number(numP) / Number(denP);
    const tickCur = Math.floor(Math.log(P) / Math.log(1.0001));

    let tickLower, tickUpper;
    if (gearIsToken0) {                       // 100% token0 -> ticks strictly ABOVE current
      tickLower = (Math.floor(tickCur / SPACING) + 1) * SPACING;
      tickUpper = MAX_TICK;
      if (tickLower <= tickCur) throw new Error(`${id}: tickLower not above current`);
    } else {                                  // 100% token1 -> ticks strictly BELOW current
      tickUpper = Math.floor(tickCur / SPACING) * SPACING;
      if (tickUpper >= tickCur) tickUpper -= SPACING;
      tickLower = MIN_TICK;
      if (tickUpper >= tickCur) throw new Error(`${id}: tickUpper not below current`);
    }

    const wallRaw = WALL_WHOLE * (10n ** 18n);
    plan.push({ id, sym: g.symbol, gearAddr, gearIsToken0, token0, token1, material: g.material || null,
      gold: g.gold, sqrtPriceX96, P, tickCur, tickLower, tickUpper, wallRaw });
  }

  // PRIORITY: wall the most common gear first — WOODEN tier, then common base/leather items,
  // then iron/bronze/steel (founder: "start with wood levels"). With the ETH floor below, a
  // partial run walls the wood tier first and stops cleanly (resume-safe after a top-up).
  const MATPRI = { wooden: 0, leather: 1, iron: 2, bronze: 3, steel: 4 };
  const pri = (x) => (x.material ? (MATPRI[x.material] ?? 5) : 1); // base/no-material = common (1)
  plan.sort((a, b) => pri(a) - pri(b) || a.gold - b.gold);

  for (const x of plan) {
    console.log(`${x.sym.padEnd(4)} ${x.id.padEnd(14)} ${String(x.gold).padStart(5)} gold/ea`);
    console.log(`     gear is token${x.gearIsToken0 ? 0 : 1}  tickCur=${x.tickCur}  wall[${x.tickLower}..${x.tickUpper}]  amount${x.gearIsToken0 ? 0 : 1}=${WALL_WHOLE.toLocaleString()} gear`);
  }
  console.log('');

  if (!EXECUTE) { console.log('DRY RUN complete. Re-run with --execute to build walls.'); return; }

  // budget floor — stop walling when ETH dips here (V3 pool creates aren't free); resume after top-up.
  const MIN_ETH_WEI = (s => 10n ** 18n / 1000n * BigInt(Math.round(parseFloat(s) * 1000)))(process.env.MIN_ETH || '0.0006');

  const outFile = path.join(__dirname, 'port-royal-walls-deployed.json');
  const record = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8'))
    : { chain: 'base', chainId: 8453, owner: me, gold: GOLD, market: 'port_royal', locationId: PORT_ROYAL,
        fee: FEE, deployedAt: new Date().toISOString(), walls: {} };
  if (!record.walls) record.walls = {};

  // explicit nonce + low fee — public RPC pending-nonce reads lag between sequential txs.
  const fees = { maxFeePerGas: ethers.parseUnits('0.1', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  let nextNonce = process.env.START_NONCE ? Number(process.env.START_NONCE)
    : await retryRead(() => provider.getTransactionCount(me, 'pending'));

  for (const x of plan) {
    if (record.walls[x.id]) { continue; }   // already walled — skip quietly
    const curBal = await retryRead(() => provider.getBalance(me));
    if (curBal <= MIN_ETH_WEI) { console.log(`\nETH floor reached (${ethers.formatEther(curBal)}) — stopping. ${Object.keys(record.walls).length} walls done. Re-run after a top-up.`); break; }
    console.log(`=== ${x.sym} (${x.id}) /GOLD wall  [${x.material||'base'}] ===`);
    let pool = await retryRead(() => factory.getPool(x.gearAddr, GOLD, FEE));
    if (pool === ethers.ZeroAddress) {
      await (await npm.createAndInitializePoolIfNecessary(x.token0, x.token1, FEE, x.sqrtPriceX96, { ...fees, nonce: nextNonce++ })).wait();
      pool = await retryRead(() => factory.getPool(x.gearAddr, GOLD, FEE));
      console.log('  pool created:', pool);
    } else { console.log('  pool exists, reusing:', pool); }
    if (pool === ethers.ZeroAddress) throw new Error(`${x.id}: pool still zero after create`);

    const erc = new ethers.Contract(x.gearAddr, ERC20_ABI, wallet);
    if ((await retryRead(() => erc.allowance(me, NPM))) < x.wallRaw) {
      await (await erc.approve(NPM, x.wallRaw, { ...fees, nonce: nextNonce++ })).wait();
      console.log('  approved', WALL_WHOLE.toLocaleString(), x.sym);
    }

    const deadline = Math.floor(Date.now() / 1000) + 1200;
    const params = {
      token0: x.token0, token1: x.token1, fee: FEE,
      tickLower: x.tickLower, tickUpper: x.tickUpper,
      amount0Desired: x.gearIsToken0 ? x.wallRaw : 0n,
      amount1Desired: x.gearIsToken0 ? 0n : x.wallRaw,
      amount0Min: 0n, amount1Min: 0n,
      recipient: me, deadline,
    };
    const rc = await (await npm.mint({ ...params }, { ...fees, nonce: nextNonce++ })).wait();
    console.log('  wall minted, tx:', rc.hash);
    record.walls[x.id] = { sym: x.sym, pool, gear: x.gearAddr, gold: GOLD, fee: FEE,
      gearIsToken0: x.gearIsToken0, tickLower: x.tickLower, tickUpper: x.tickUpper,
      wall: WALL_WHOLE.toString(), goldPrice: x.gold };
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  }

  console.log('\nSaved to', outFile, `(${Object.keys(record.walls).length}/12 walls)`);
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
