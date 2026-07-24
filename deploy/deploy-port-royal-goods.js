#!/usr/bin/env node
/**
 * deploy-port-royal-goods.js — PORT ROYAL market walls for the FOOD + GEM trade-goods
 * (already-deployed tokens). One-sided Uniswap V3 sell walls (token-only), priced at the
 * D&D book value in the item's native coin, lowest fee tier (0.01%) for micro-trades.
 *
 *   FOOD: copper-priced → COPPER wall · silver-priced → SILVER wall · gold-priced → GOLD wall
 *   GEMS: all gold-priced → GOLD wall
 *
 * Wall size = min(5,000,000, floor(treasuryBalance / 2)) per token — adapts to what we
 * actually hold (gems were partly seeded into the peg mesh, so balances vary). One-sided,
 * so NO coin is spent — players bring the coin, buy the good, the wall depletes + price climbs.
 *
 * Mirrors deploy-port-royal-walls.js (gear): explicit nonce + low fee + retryRead for the
 * flaky public RPC + resume-safe per-wall record. Coins + goods are all 18 dec (no adjust).
 *
 * Usage:  node deploy/deploy-port-royal-goods.js            (DRY RUN)
 *         node deploy/deploy-port-royal-goods.js --execute   (broadcasts to Base)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

const COIN = {
  copper: '0x0197896c617f20d61E73E06eC8b2A95eef176bee',
  silver: '0x36cF0ceDEee07b14C496f77C61d010268c31E0e9',
  gold:   '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004',
};
const NPM     = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const FEE = 100, SPACING = 1;
const MAX_TICK = Math.floor(887272 / SPACING) * SPACING, MIN_TICK = -MAX_TICK;
const PORT_ROYAL = 8003;
const WALL_CAP = 5_000_000n;     // hard cap; actual = min(cap, balance/2)

// id, symbol, token address, coin tier, price in that coin (D&D book value)
const GOODS = [
  // ── food (Arms & Equipment Guide p31) ──
  { id: 'salt',     sym: 'SALT',     addr: '0xdDCB77AA553718ACc88aA61ba1514EE267Cc6825', coin: 'copper', price: 1 },  // 1 cp
  { id: 'honey',    sym: 'HONEY',    addr: '0x92Cf60b74BD16aAb42f2C249e72E9860e83A765f', coin: 'silver', price: 1 },  // 1 sp
  { id: 'rations',  sym: 'RATIONS',  addr: '0x0867653716D37DC9F13c5347A8Ca8fFF6CA95926', coin: 'silver', price: 5 },  // 5 sp
  { id: 'apple',    sym: 'APPLE',    addr: '0xa7E88Ce1163e325Be877C54021da901A7DA8b170', coin: 'gold',   price: 1 },
  { id: 'cinnamon', sym: 'CINNAMON', addr: '0x69a8d4AA5a9ee7965E583bC97288e2B325231b49', coin: 'gold',   price: 1 },
  { id: 'cod',      sym: 'COD',      addr: '0xCdb48Fbea782D46b95426A6791cE9E1d2DDA7559', coin: 'gold',   price: 5 },
  { id: 'jerky',    sym: 'JERKY',    addr: '0xA34Ce4E86D00d63a847Ec122B7E94D94c2A0FCa0', coin: 'gold',   price: 7 },
  { id: 'ale',      sym: 'ALE',      addr: '0x102817fd347c1A8117dDB4f5a9A6D6E363D360F7', coin: 'gold',   price: 8 },
  { id: 'pepper',   sym: 'PEPPER',   addr: '0x27A6c9B2D29A5f1716fc64D6c4913F8501099CC5', coin: 'gold',   price: 30 },
  { id: 'wine',     sym: 'WINE',     addr: '0x796Ac66a177f0e18aaCd53D3Ac91c3329A48a7d1', coin: 'gold',   price: 40 },
  { id: 'saffron',  sym: 'SAFFRON',  addr: '0xc5e642378D39C24a549a5d6e9C8848771bBa2932', coin: 'gold',   price: 65 },
  // ── gems (value ladder, all priced in gold). gem:true → small 1M wall, hold the rest. ──
  { id: 'platinum', sym: 'PLATINUM', addr: '0x6722ef27d1854E73269b0abE42290C000D3EfddA', coin: 'gold', price: 10, gem: true },
  { id: 'amethyst', sym: 'AMETHYST', addr: '0xC5a9BC41936EF545DE210727FedCf8a43aEFa95F', coin: 'gold', price: 100, gem: true },
  { id: 'ruby',     sym: 'RUBY',     addr: '0xE78023faFb55e61dC4d28D13F623e32fE9a3Fe6A', coin: 'gold', price: 1000, gem: true },
  { id: 'emerald',  sym: 'EMERALD',  addr: '0x3220D7b78F0b3839248E624ed3c7c2c215389063', coin: 'gold', price: 1000, gem: true },
  { id: 'diamond',  sym: 'DIAMOND',  addr: '0x567c3EA4E2eB7fb0C55523162a248a5A25fD5Bb0', coin: 'gold', price: 10000, gem: true },
];
const GEM_CAP = 1_000_000n;      // gems: small 1M wall, hold the rest in treasury (founder)

const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const NPM_ABI = [
  'function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256,uint128,uint256,uint256)',
];

function isqrt(n){ if(n<0n) throw new Error('neg'); if(n<2n) return n; let x=n,y=(x+1n)/2n; while(y<x){x=y;y=(x+n/x)/2n;} return x; }
async function retryRead(fn, tries = 8) {
  for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { if (i === tries-1) throw e; await new Promise(r=>setTimeout(r,2500)); } }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  console.log('Wallet/treasury:', me);
  console.log('Fee/spacing:', FEE, '/', SPACING, ' Port Royal', PORT_ROYAL, ' wall cap', WALL_CAP.toLocaleString());
  console.log('Mode:', EXECUTE ? 'EXECUTE' : 'DRY RUN', '\n');

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);

  const plan = [];
  for (const g of GOODS) {
    const coinAddr = COIN[g.coin];
    const bal = await retryRead(() => new ethers.Contract(g.addr, ERC20_ABI, provider).balanceOf(me));
    const balWhole = bal / (10n ** 18n);
    const cap = g.gem ? GEM_CAP : WALL_CAP;                 // gems 1M (hold rest), food 5M
    const half = balWhole / 2n;                            // never wall more than half we hold
    const wallWhole = (half < cap ? half : cap);
    if (wallWhole <= 0n) { console.log(`${g.sym}: no balance — SKIP`); continue; }

    const tokIsT0 = g.addr.toLowerCase() < coinAddr.toLowerCase();
    const token0 = tokIsT0 ? g.addr : coinAddr, token1 = tokIsT0 ? coinAddr : g.addr;
    const pn = BigInt(Math.round(g.price * 1e9)), pd = 1_000_000_000n;     // price as fraction
    const numP = tokIsT0 ? pn : pd, denP = tokIsT0 ? pd : pn;              // token1/token0
    const sqrtPriceX96 = isqrt((numP << 192n) / denP);
    const P = Number(numP) / Number(denP);
    const tickCur = Math.floor(Math.log(P) / Math.log(1.0001));

    let tickLower, tickUpper;
    if (tokIsT0) { tickLower = (Math.floor(tickCur/SPACING)+1)*SPACING; tickUpper = MAX_TICK;
      if (tickLower <= tickCur) throw new Error(`${g.id}: tickLower not above current`); }
    else { tickUpper = Math.floor(tickCur/SPACING)*SPACING; if (tickUpper >= tickCur) tickUpper -= SPACING; tickLower = MIN_TICK;
      if (tickUpper >= tickCur) throw new Error(`${g.id}: tickUpper not below current`); }

    plan.push({ ...g, coinAddr, tokIsT0, token0, token1, sqrtPriceX96, tickCur, tickLower, tickUpper,
      wallWhole, wallRaw: wallWhole * (10n ** 18n) });
  }

  for (const x of plan)
    console.log(`${x.sym.padEnd(9)} ${String(x.price).padStart(5)} ${x.coin.padEnd(6)}/ea  token${x.tokIsT0?0:1}  tickCur=${x.tickCur}  wall ${x.wallWhole.toLocaleString()} (one-sided)`);
  console.log('');

  if (!EXECUTE) { console.log('DRY RUN complete. Re-run with --execute.'); return; }

  const outFile = path.join(__dirname, 'port-royal-goods-walls-deployed.json');
  const record = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8'))
    : { chain: 'base', chainId: 8453, owner: me, market: 'port_royal', locationId: PORT_ROYAL, fee: FEE, coins: COIN, walls: {} };
  if (!record.walls) record.walls = {};

  const fees = { maxFeePerGas: ethers.parseUnits('0.1','gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02','gwei') };
  let nextNonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await retryRead(() => provider.getTransactionCount(me, 'pending'));

  for (const x of plan) {
    if (record.walls[x.id]) { console.log(`Skipping ${x.sym} (recorded: ${record.walls[x.id].pool})`); continue; }
    console.log(`=== ${x.sym}/${x.coin.toUpperCase()} wall ===`);
    let pool = await retryRead(() => factory.getPool(x.addr, x.coinAddr, FEE));
    if (pool === ethers.ZeroAddress) {
      await (await npm.createAndInitializePoolIfNecessary(x.token0, x.token1, FEE, x.sqrtPriceX96, { ...fees, nonce: nextNonce++ })).wait();
      pool = await retryRead(() => factory.getPool(x.addr, x.coinAddr, FEE));
      console.log('  pool created:', pool);
    } else console.log('  pool exists:', pool);
    if (pool === ethers.ZeroAddress) throw new Error(`${x.id}: pool still zero`);

    // Approve exact if not already covered (reliable RPC → accurate allowance read).
    const erc = new ethers.Contract(x.addr, ERC20_ABI, wallet);
    if ((await retryRead(() => erc.allowance(me, NPM))) < x.wallRaw) {
      await (await erc.approve(NPM, x.wallRaw, { ...fees, nonce: nextNonce++ })).wait();
      console.log('  approved', x.wallWhole.toLocaleString(), x.sym);
    } else console.log('  allowance already set');
    const deadline = Math.floor(Date.now()/1000) + 1200;
    const rc = await (await npm.mint({
      token0: x.token0, token1: x.token1, fee: FEE, tickLower: x.tickLower, tickUpper: x.tickUpper,
      amount0Desired: x.tokIsT0 ? x.wallRaw : 0n, amount1Desired: x.tokIsT0 ? 0n : x.wallRaw,
      amount0Min: 0n, amount1Min: 0n, recipient: me, deadline,
    }, { ...fees, nonce: nextNonce++ })).wait();
    console.log('  wall minted:', rc.hash);
    record.walls[x.id] = { sym: x.sym, pool, token: x.addr, coin: x.coin, coinAddr: x.coinAddr,
      price: x.price, tokIsT0: x.tokIsT0, tickLower: x.tickLower, tickUpper: x.tickUpper, wall: x.wallWhole.toString() };
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  }
  console.log(`\nSaved to ${outFile} (${Object.keys(record.walls).length}/${GOODS.length} walls)`);
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
