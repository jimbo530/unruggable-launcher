#!/usr/bin/env node
/**
 * deploy-coin-money-walls.js — One-sided full-range SELL WALLS for the
 * Copper / Silver / Gold game coins, priced against Money (mftUSD, ~$1).
 *
 * Each coin opens at a $10,000 market cap (FDV = price x total supply) and the
 * wall is a single one-sided position holding ONLY the coin, spanning from the
 * start price all the way up. As buyers spend Money they eat through the wall
 * and the price (and market cap) rises; treasury collects the Money.
 *
 *   COPPER  $1e-8 each   FDV $10k   wall 200B (20% of 1T)
 *   SILVER  $1e-7 each   FDV $10k   wall  20B (20% of 100B)
 *   GOLD    $1e-6 each   FDV $10k   wall   2B (20% of 10B)
 *
 * Money has 6 DECIMALS (coins have 18) — the raw price carries a 10^(6-18)
 * adjustment, handled below. Coin is token0, Money is token1 for all three, so
 * coin appreciation = price (Money/coin) UP = ticks ABOVE current. The wall is
 * therefore a position from just above the start tick up to MAX_TICK (100% coin).
 *
 * Usage:  node deploy/deploy-coin-money-walls.js            (DRY RUN)
 *         node deploy/deploy-coin-money-walls.js --execute   (broadcasts to Base)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }

const RPC = process.env.BASE_RPC || process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

const MONEY = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072'; // mftUSD receipt, ~$1, 6 decimals
const NPM     = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const FEE = Number(process.env.WALL_FEE || 10000);    // default 1%; pass WALL_FEE=100 for 0.01%
const SPACING = Number(process.env.WALL_SPACING || 200); // 1%->200, 0.01%->1
const MAX_TICK = Math.floor(887272 / SPACING) * SPACING;

const MCAP_USD = Number(process.env.WALL_MCAP || 10000); // target FDV per coin; WALL_MCAP=100000000 -> gold $0.01
const WALL_PCT = 20n;         // % of total supply put in the wall

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
  const coins = require(path.join(__dirname, 'coins-deployed.json')).coins;
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;

  const moneyDecimals = Number(await new ethers.Contract(MONEY, ERC20_ABI, provider).decimals());
  console.log('Wallet/treasury:', me);
  console.log('Money:', MONEY, `(${moneyDecimals} decimals)`);
  console.log('Mode  :', EXECUTE ? 'EXECUTE (broadcasting)' : 'DRY RUN (nothing sent)');
  console.log('');

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);

  const plan = [];
  for (const sym of ['COPPER', 'SILVER', 'GOLD']) {
    const c = coins[sym];
    const coinAddr = c.address;
    const coinDec = c.decimals;                       // 18
    const supplyWhole = BigInt(c.whole);
    if (coinAddr.toLowerCase() >= MONEY.toLowerCase()) throw new Error(`${sym} not token0 — script assumes coin<Money`);

    // $ price per coin (Money per coin, display) = MCAP / totalSupply
    const priceUsd = MCAP_USD / Number(supplyWhole);

    // raw price P (token1/token0) = priceUsd * 10^(moneyDec - coinDec)
    // expressed as integer fraction num/den for exact sqrtPriceX96:
    //   P = (MCAP_USD * 10^moneyDec) / (supplyWhole * 10^coinDec)
    const num = BigInt(MCAP_USD) * (10n ** BigInt(moneyDecimals));
    const den = supplyWhole * (10n ** BigInt(coinDec));
    const sqrtPriceX96 = isqrt((num << 192n) / den);

    // current tick from P (float is fine for snapping)
    const P = Number(num) / Number(den);
    const tickCur = Math.floor(Math.log(P) / Math.log(1.0001));
    // wall starts one spacing above current so the position is 100% coin (token0)
    const tickLower = (Math.floor(tickCur / SPACING) + 1) * SPACING;
    const tickUpper = MAX_TICK;

    const wallRaw = (supplyWhole * WALL_PCT / 100n) * (10n ** BigInt(coinDec));
    const wallWhole = supplyWhole * WALL_PCT / 100n;

    plan.push({ sym, coinAddr, priceUsd, num, den, sqrtPriceX96, P, tickCur, tickLower, tickUpper, wallRaw, wallWhole });
  }

  for (const x of plan) {
    console.log(`${x.sym}`);
    console.log(`  price        = $${x.priceUsd}   (FDV = $${MCAP_USD.toLocaleString()})`);
    console.log(`  sqrtPriceX96 = ${x.sqrtPriceX96}`);
    console.log(`  tickCurrent  = ${x.tickCur}   wall ticks [${x.tickLower} .. ${x.tickUpper}]  (one-sided, 100% ${x.sym})`);
    console.log(`  wall size    = ${x.wallWhole.toLocaleString()} ${x.sym} (20% of supply)`);
    if (x.tickLower <= x.tickCur) { console.error('  !! tickLower not above current — would need Money. ABORT.'); process.exit(1); }
    console.log('');
  }

  if (!EXECUTE) { console.log('DRY RUN complete. Re-run with --execute to create walls.'); return; }

  // balance check
  for (const x of plan) {
    const bal = await new ethers.Contract(x.coinAddr, ERC20_ABI, provider).balanceOf(me);
    if (bal < x.wallRaw) throw new Error(`Insufficient ${x.sym}: have ${bal}, need ${x.wallRaw}`);
  }

  const out = [];
  for (const x of plan) {
    console.log(`=== ${x.sym}/Money wall ===`);
    let pool = await factory.getPool(x.coinAddr, MONEY, FEE);
    if (pool === ethers.ZeroAddress) {
      const tx = await npm.createAndInitializePoolIfNecessary(x.coinAddr, MONEY, FEE, x.sqrtPriceX96);
      await tx.wait();
      pool = await factory.getPool(x.coinAddr, MONEY, FEE);
      console.log('  pool created:', pool);
    } else {
      console.log('  pool exists, reusing:', pool);
    }

    const erc = new ethers.Contract(x.coinAddr, ERC20_ABI, wallet);
    if ((await erc.allowance(me, NPM)) < x.wallRaw) {
      await (await erc.approve(NPM, x.wallRaw)).wait();
      console.log('  approved', x.wallWhole.toLocaleString(), x.sym);
    }

    const deadline = Math.floor(Date.now() / 1000) + 1200;
    const params = {
      token0: x.coinAddr, token1: MONEY, fee: FEE,
      tickLower: x.tickLower, tickUpper: x.tickUpper,
      amount0Desired: x.wallRaw, amount1Desired: 0n,   // one-sided: coin only
      amount0Min: 0n, amount1Min: 0n,
      recipient: me, deadline,
    };
    const rc = await (await npm.mint(params)).wait();
    console.log('  wall minted, tx:', rc.hash);
    out.push({ sym: x.sym, pool, coin: x.coinAddr, money: MONEY, fee: FEE,
               tickLower: x.tickLower, tickUpper: x.tickUpper, wall: x.wallWhole.toString(), priceUsd: x.priceUsd });
    console.log('');
  }

  fs.writeFileSync(path.join(__dirname, 'coin-money-walls-deployed.json'),
    JSON.stringify({ chain: 'base', chainId: 8453, owner: me, money: MONEY,
      deployedAt: new Date().toISOString(), walls: out }, null, 2));
  console.log('Saved to deploy/coin-money-walls-deployed.json');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
