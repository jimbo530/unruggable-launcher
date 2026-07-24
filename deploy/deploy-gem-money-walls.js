#!/usr/bin/env node
/**
 * deploy-gem-money-walls.js — one-sided Money pegs for the gem trade-good tokens, at
 * authentic D&D values (gold=$0.01): DIAMOND $100, RUBY/EMERALD $10, AMETHYST $1,
 * PLATINUM $0.10 per gem. Same trick as the coin/coin-money walls: a one-sided gem
 * sell wall vs Money on a fee-100 pool sets the in-game peg; USDC→Money→gem is the buy.
 *
 * Handles BOTH token orderings (gem may sort above or below Money): the wall is always
 * placed on the gem-only side of the start price (above if gem=token0, below if token1).
 *
 * Usage:  node deploy/deploy-gem-money-walls.js            (DRY RUN)
 *         node deploy/deploy-gem-money-walls.js --execute   (broadcasts to Base)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }

const RPC = process.env.BASE_RPC || process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

const MONEY   = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072'; // mftUSD receipt, ~$1, 6 decimals
const NPM     = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const FEE = Number(process.env.WALL_FEE || 100);       // 0.01% peg pool
const SPACING = Number(process.env.WALL_SPACING || 1);
const MAX_TICK = Math.floor(887272 / SPACING) * SPACING;

// $ price per gem (Money per gem) = D&D gold value × $0.01.
const GEM_PRICE_USD = { DIAMOND: 100, RUBY: 10, EMERALD: 10, AMETHYST: 1, PLATINUM: 0.10 };
const GEMS = ['DIAMOND', 'RUBY', 'EMERALD', 'AMETHYST', 'PLATINUM'];
const WALL_PCT = 20n; // % of supply into the wall

const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const NPM_ABI = [
  'function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
];
const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

function isqrt(n){ if(n<0n) throw new Error('neg'); if(n<2n) return n; let x=n,y=(x+1n)/2n; while(y<x){x=y;y=(x+n/x)/2n;} return x; }

async function main() {
  const gems = require(path.join(__dirname, 'gems-deployed.json')).coins;
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  const moneyDec = Number(await new ethers.Contract(MONEY, ERC20_ABI, provider).decimals());
  console.log('Treasury:', me, '| Money', MONEY, `(${moneyDec} dec) | fee ${FEE} spacing ${SPACING}`);
  console.log('Mode    :', EXECUTE ? 'EXECUTE (broadcasting)' : 'DRY RUN (nothing sent)', '\n');

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);

  const plan = [];
  for (const sym of GEMS) {
    const g = gems[sym];
    if (!g) throw new Error(`${sym} not in gems-deployed.json`);
    const gemAddr = g.address, gemDec = g.decimals;
    const supplyWhole = BigInt(g.whole);
    const priceUsd = GEM_PRICE_USD[sym];
    const cents = BigInt(Math.round(priceUsd * 100)); // exact for $0.10
    const gemIsT0 = gemAddr.toLowerCase() < MONEY.toLowerCase();

    // raw price P = token1/token0
    let num, den;
    if (gemIsT0) { num = cents * 10n ** BigInt(moneyDec);  den = 100n * 10n ** BigInt(gemDec); }   // money/gem
    else         { num = 100n * 10n ** BigInt(gemDec);     den = cents * 10n ** BigInt(moneyDec); } // gem/money
    const sqrtPriceX96 = isqrt((num << 192n) / den);
    const P = Number(num) / Number(den);
    const tickCur = Math.floor(Math.log(P) / Math.log(1.0001));

    const wallRaw = (supplyWhole * WALL_PCT / 100n) * 10n ** BigInt(gemDec);
    const wallWhole = supplyWhole * WALL_PCT / 100n;
    let tickLower, tickUpper, amount0, amount1;
    if (gemIsT0) { // gem appreciates as price↑ → wall ABOVE current, gem is amount0
      tickLower = (Math.floor(tickCur / SPACING) + 1) * SPACING; tickUpper = MAX_TICK;
      amount0 = wallRaw; amount1 = 0n;
    } else {       // gem appreciates as price↓ → wall BELOW current, gem is amount1
      tickLower = -MAX_TICK; tickUpper = (Math.ceil(tickCur / SPACING) - 1) * SPACING;
      amount0 = 0n; amount1 = wallRaw;
    }
    plan.push({ sym, gemAddr, gemIsT0, token0: gemIsT0 ? gemAddr : MONEY, token1: gemIsT0 ? MONEY : gemAddr,
      priceUsd, sqrtPriceX96, tickCur, tickLower, tickUpper, amount0, amount1, wallRaw, wallWhole });
  }

  for (const x of plan) {
    console.log(`${x.sym}  $${x.priceUsd}/gem  gem=token${x.gemIsT0 ? 0 : 1}`);
    console.log(`  sqrtPriceX96=${x.sqrtPriceX96}  tickCur=${x.tickCur}  wall ticks [${x.tickLower} .. ${x.tickUpper}]`);
    console.log(`  wall ${x.wallWhole.toLocaleString()} ${x.sym} (20% of supply), one-sided`);
    if (x.gemIsT0 && x.tickLower <= x.tickCur) { console.error('  !! tickLower<=cur — ABORT'); process.exit(1); }
    if (!x.gemIsT0 && x.tickUpper >= x.tickCur) { console.error('  !! tickUpper>=cur — ABORT'); process.exit(1); }
    console.log('');
  }

  if (!EXECUTE) { console.log('DRY RUN complete. Re-run with --execute to create walls.'); return; }

  for (const x of plan) {
    const bal = await new ethers.Contract(x.gemAddr, ERC20_ABI, provider).balanceOf(me);
    if (bal < x.wallRaw) throw new Error(`Insufficient ${x.sym}: have ${bal}, need ${x.wallRaw}`);
  }

  const out = [];
  for (const x of plan) {
    console.log(`=== ${x.sym}/Money wall ===`);
    let pool = await factory.getPool(x.token0, x.token1, FEE);
    if (pool === ethers.ZeroAddress) {
      await (await npm.createAndInitializePoolIfNecessary(x.token0, x.token1, FEE, x.sqrtPriceX96)).wait();
      pool = await factory.getPool(x.token0, x.token1, FEE);
      console.log('  pool created:', pool);
    } else console.log('  pool exists, reusing:', pool);

    const erc = new ethers.Contract(x.gemAddr, ERC20_ABI, wallet);
    if ((await erc.allowance(me, NPM)) < x.wallRaw) { await (await erc.approve(NPM, x.wallRaw)).wait(); console.log('  approved', x.wallWhole.toLocaleString(), x.sym); }

    const deadline = Math.floor(Date.now() / 1000) + 1200;
    const rc = await (await npm.mint({ token0: x.token0, token1: x.token1, fee: FEE, tickLower: x.tickLower, tickUpper: x.tickUpper,
      amount0Desired: x.amount0, amount1Desired: x.amount1, amount0Min: 0n, amount1Min: 0n, recipient: me, deadline })).wait();
    console.log('  wall minted, tx:', rc.hash);
    out.push({ sym: x.sym, pool, gem: x.gemAddr, money: MONEY, fee: FEE, gemIsToken0: x.gemIsT0,
      tickLower: x.tickLower, tickUpper: x.tickUpper, wall: x.wallWhole.toString(), priceUsd: x.priceUsd });
    console.log('');
  }
  fs.writeFileSync(path.join(__dirname, 'gem-money-walls-deployed.json'),
    JSON.stringify({ chain: 'base', chainId: 8453, owner: me, money: MONEY, deployedAt: new Date().toISOString(), walls: out }, null, 2));
  console.log('Saved to deploy/gem-money-walls-deployed.json');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
