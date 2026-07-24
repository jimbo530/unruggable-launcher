#!/usr/bin/env node
/**
 * deploy-coin-pools.js — Create the three thin-band Uniswap V3 peg pools for the
 * Copper / Silver / Gold in-game currencies, and seed concentrated liquidity.
 *
 * Pools (all 0.01% fee tier, tickSpacing = 1), priced ONLY against each other —
 * no oracle, no USD, no live price call. The ratio IS the price:
 *
 *   Copper / Silver  10 copper = 1 silver   seed 250B copper + 25B  silver
 *   Silver / Gold    10 silver = 1 gold     seed  25B silver +  2.5B gold
 *   Copper / Gold   100 copper = 1 gold     seed 250B copper +  2.5B gold
 *
 * Per-token totals into LPs = exactly HALF of each supply; the other half stays
 * in treasury for game building. Liquidity is concentrated in a ±0.2% band so
 * the internal peg holds hard; the three pools form an arbitrage triangle
 * (10 x 10 = 100) so they defend each other.
 *
 * Usage:  node deploy/deploy-coin-pools.js            (DRY RUN — prints plan, sends nothing)
 *         node deploy/deploy-coin-pools.js --execute   (broadcasts to Base mainnet)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found in env'); process.exit(1); }

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

// Base mainnet Uniswap V3
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const NPM     = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1'; // NonfungiblePositionManager
const FEE = 100;          // 0.01%
const TICK_SPACING = 1;
const BAND = 0.002;       // +/-0.2%

const ONE = 10n ** 18n;

// Relative value in copper-equivalents — defines the peg, nothing external.
const VALUE = { COPPER: 1n, SILVER: 10n, GOLD: 100n };

// Pools and the whole-coin seed amounts (1/4 of each token's supply per pool).
const POOLS = [
  { a: 'COPPER', b: 'SILVER', seed: { COPPER: 250_000_000_000n, SILVER: 25_000_000_000n } },
  { a: 'SILVER', b: 'GOLD',   seed: { SILVER:  25_000_000_000n, GOLD:    2_500_000_000n } },
  { a: 'COPPER', b: 'GOLD',   seed: { COPPER: 250_000_000_000n, GOLD:    2_500_000_000n } },
];

const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const NPM_ABI = [
  'function createAndInitializePoolIfNecessary(address token0,address token1,uint24 fee,uint160 sqrtPriceX96) payable returns (address pool)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
];
const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
];

// integer sqrt (BigInt)
function isqrt(n) {
  if (n < 0n) throw new Error('isqrt negative');
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
// sqrtPriceX96 for price P = v0/v1 (token1 per token0), tokens equal decimals
function sqrtPriceX96(v0, v1) {
  // sqrt(v0/v1) * 2^96 = isqrt( (v0 << 192) / v1 )
  return isqrt((v0 << 192n) / v1);
}
function tickAtPrice(P) { return Math.log(P) / Math.log(1.0001); }

async function main() {
  const coinsPath = path.join(__dirname, 'coins-deployed.json');
  if (!fs.existsSync(coinsPath)) {
    console.error('coins-deployed.json not found — run deploy-coins.js --execute first.');
    process.exit(1);
  }
  const { coins, treasury: recordedTreasury } = JSON.parse(fs.readFileSync(coinsPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  console.log('Treasury / LP owner:', me);
  console.log('Mode               :', EXECUTE ? 'EXECUTE (broadcasting)' : 'DRY RUN (nothing sent)');
  if (recordedTreasury && recordedTreasury.toLowerCase() !== me.toLowerCase()) {
    console.error(`Treasury mismatch: tokens minted to ${recordedTreasury}, but wallet is ${me}`);
    process.exit(1);
  }
  console.log('');

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);

  const plan = [];
  for (const p of POOLS) {
    const A = coins[p.a], B = coins[p.b];
    // Sort by address -> token0/token1
    const aLower = A.address.toLowerCase() < B.address.toLowerCase();
    const t0 = aLower ? p.a : p.b;
    const t1 = aLower ? p.b : p.a;
    const addr0 = coins[t0].address, addr1 = coins[t1].address;

    const sp = sqrtPriceX96(VALUE[t0], VALUE[t1]);             // price token1/token0 = v0/v1
    const P = Number(VALUE[t0]) / Number(VALUE[t1]);
    const curTick = tickAtPrice(P);
    const tickLower = Math.floor(tickAtPrice(P * (1 - BAND)));
    const tickUpper = Math.ceil(tickAtPrice(P * (1 + BAND)));

    const amt0 = p.seed[t0] * ONE;
    const amt1 = p.seed[t1] * ONE;

    plan.push({ pair: `${p.a}/${p.b}`, t0, t1, addr0, addr1, sp, P, curTick, tickLower, tickUpper, amt0, amt1,
                seed0: p.seed[t0], seed1: p.seed[t1] });
  }

  for (const x of plan) {
    console.log(`Pool ${x.pair}`);
    console.log(`  token0=${x.t0} (${x.addr0})`);
    console.log(`  token1=${x.t1} (${x.addr1})`);
    console.log(`  price token1/token0 = ${x.P}   curTick=${x.curTick.toFixed(3)}`);
    console.log(`  band ticks [${x.tickLower}, ${x.tickUpper}]  (~+/-0.2%)`);
    console.log(`  seed: ${x.seed0.toLocaleString()} ${x.t0} + ${x.seed1.toLocaleString()} ${x.t1}`);
    console.log(`  sqrtPriceX96 = ${x.sp}`);
    console.log('');
  }

  if (!EXECUTE) {
    console.log('DRY RUN complete. Re-run with --execute to create pools and seed liquidity.');
    return;
  }

  // Sanity: confirm treasury holds enough of each token
  const need = {};
  for (const x of plan) { need[x.t0] = (need[x.t0] || 0n) + x.amt0; need[x.t1] = (need[x.t1] || 0n) + x.amt1; }
  for (const sym of Object.keys(need)) {
    const erc = new ethers.Contract(coins[sym].address, ERC20_ABI, provider);
    const bal = await erc.balanceOf(me);
    if (bal < need[sym]) throw new Error(`Insufficient ${sym}: have ${bal}, need ${need[sym]}`);
  }

  const out = [];
  for (const x of plan) {
    console.log(`=== ${x.pair} ===`);
    // 1) create + init pool at exact peg
    let pool = await factory.getPool(x.addr0, x.addr1, FEE);
    if (pool === ethers.ZeroAddress) {
      console.log('  creating + initializing pool...');
      const tx = await npm.createAndInitializePoolIfNecessary(x.addr0, x.addr1, FEE, x.sp);
      await tx.wait();
      pool = await factory.getPool(x.addr0, x.addr1, FEE);
    } else {
      console.log('  pool already exists, reusing');
    }
    console.log('  pool:', pool);

    // 2) approve NPM for both tokens (exact amounts only — no MaxUint approvals)
    for (const [sym, addr, amt] of [[x.t0, x.addr0, x.amt0], [x.t1, x.addr1, x.amt1]]) {
      const erc = new ethers.Contract(addr, ERC20_ABI, wallet);
      const cur = await erc.allowance(me, NPM);
      if (cur < amt) {
        const tx = await erc.approve(NPM, amt);
        await tx.wait();
        console.log(`  approved ${amt} ${sym}`);
      }
    }

    // 3) mint concentrated position in the thin band
    const deadline = Math.floor(new Date().getTime() / 1000) + 1200;
    const params = {
      token0: x.addr0, token1: x.addr1, fee: FEE,
      tickLower: x.tickLower, tickUpper: x.tickUpper,
      amount0Desired: x.amt0, amount1Desired: x.amt1,
      amount0Min: 0n, amount1Min: 0n,           // fresh self-init pool, no external LPs/traders yet
      recipient: me, deadline,
    };
    const tx = await npm.mint(params);
    const rc = await tx.wait();
    console.log('  minted liquidity, tx:', rc.hash);
    out.push({ pair: x.pair, pool, token0: x.addr0, token1: x.addr1, fee: FEE,
               tickLower: x.tickLower, tickUpper: x.tickUpper });
    console.log('');
  }

  const outPath = path.join(__dirname, 'coin-pools-deployed.json');
  fs.writeFileSync(outPath, JSON.stringify({ chain: 'base', chainId: 8453, owner: me,
    deployedAt: new Date().toISOString(), pools: out }, null, 2));
  console.log('Saved pool info to', outPath);
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
