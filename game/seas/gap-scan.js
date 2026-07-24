// @ts-check
'use strict';
/**
 * gap-scan.js — SHARED, READ-ONLY market-gap scanner for Seize the Seas.
 *
 * Two consumers import this SAME file (stable contract — don't break the export shape):
 *   • the coordinator's Port Report (publishes the headline gaps), and
 *   • the First Citizen agent player's toolbelt (closes the gaps it can safely close).
 * Same module ⇒ the published headline and the bot's behaviour always agree.
 *
 *   import { scanGaps } from './gap-scan.js';
 *   const gaps = await scanGaps();   // Promise<Gap[]>, ranked by |gapPct| desc
 *
 * HOW IT PRICES (the lesson we proved on-chain — read before editing):
 *   Coins/goods sit behind ONE-SIDED "wall" pools. The BUY side (Money→coin, gold→good) fills at
 *   the intended anchor; the SELL side reads NEAR-ZERO (selling 1,000,000 COPPER yields ~$1, i.e.
 *   ~$0.000001/copper vs the $0.0001 anchor — a 99% drain trap). So we price + trade ONLY on the
 *   working BUY direction and flag the sell side as unsafe (sellSafe:false) until two-sided V2
 *   markets exist (founder's Phase-1 "second half"). GOLD/Money is the one genuinely two-sided
 *   market today (sellSafe:true). We NEVER price or trade through the near-zero sell side.
 *
 * USD anchor: Money ≈ $1 (USDC-1:1 receipt). Coin anchors: COPPER $0.0001 / SILVER $0.001 /
 * GOLD $0.01. Goods anchor = (book price in coins) × (coin USD). All prices come from LIVE
 * Uniswap V3 QuoterV2 quotes on the real fill route — no hardcoded token prices, no fakes.
 */

const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

// ── chain / contracts ───────────────────────────────────────────────────────────────────────
const RPC = process.env.CITIZEN_RPC || 'https://mainnet.base.org';
const CHAIN_ID = 8453;
const QUOTER = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'; // Uniswap V3 QuoterV2

const ADDR = {
  money:  '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072', // 6dec, USDC-1:1 receipt
  usdc:   '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // 6dec
  mftMeme:'0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3', // 18dec meme (no peg)
  copper: '0x0197896c617f20d61E73E06eC8b2A95eef176bee', // 18dec
  silver: '0x36cF0ceDEee07b14C496f77C61d010268c31E0e9', // 18dec
  gold:   '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004', // 18dec
};
const COIN_USD = { copper: 0.0001, silver: 0.001, gold: 0.01 };
const COIN_ADDR = { copper: ADDR.copper, silver: ADDR.silver, gold: ADDR.gold };
const FEE_WALL = 100;     // 0.01% — every coin/good wall is a fee-100 V3 pool
const FEE_MEME = 10000;   // MfT meme pool

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)',
];
// Custom self-add AMM (fish walls / mill LPs) — same shape as deploy/mill-keeper.js POOL_ABI.
const CUSTOM_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function quote(bool zeroForOne, uint256 amountIn) view returns (uint256)',
];

const DEPLOY = path.join(__dirname, '..', '..', 'deploy');
const ONE = 10n ** 18n;

let _provider = null;
function provider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: ethers.Network.from(CHAIN_ID) });
  return _provider;
}
const quoter = () => new ethers.Contract(QUOTER, QUOTER_ABI, provider());

function readJson(rel) {
  const p = path.join(DEPLOY, rel);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ── registry: what we price + where the working route is ──────────────────────────────────────
/**
 * @typedef {Object} TokenEntry
 * @property {string} id   stable id (lowercased symbol/good name)
 * @property {string} sym
 * @property {string} token  address
 * @property {string} role   coin|gem|food|fish|lumber|meme
 * @property {number|null} anchorUsd
 * @property {boolean} buySafe   buy side fills correctly (true for every wall here)
 * @property {boolean} sellSafe  sell side is a real two-sided market (NOT a near-zero drain)
 * @property {Object} route      how we price/trade it (no near-zero walls)
 */

/** Build the token registry from the on-chain deploy records (single source of truth). */
function loadRegistry() {
  /** @type {TokenEntry[]} */
  const reg = [];

  // 1) Coins — Money→coin fee-100 wall (buy side). GOLD is the lone two-sided market.
  reg.push({ id: 'gold', sym: 'GOLD', token: ADDR.gold, role: 'coin', anchorUsd: COIN_USD.gold,
    buySafe: true, sellSafe: true,
    route: { type: 'v3-single', via: 'money', tokenIn: ADDR.money, fee: FEE_WALL, twoSided: true } });
  reg.push({ id: 'silver', sym: 'SILVER', token: ADDR.silver, role: 'coin', anchorUsd: COIN_USD.silver,
    buySafe: true, sellSafe: false,
    route: { type: 'v3-single', via: 'money', tokenIn: ADDR.money, fee: FEE_WALL, twoSided: false } });
  reg.push({ id: 'copper', sym: 'COPPER', token: ADDR.copper, role: 'coin', anchorUsd: COIN_USD.copper,
    buySafe: true, sellSafe: false,
    route: { type: 'v3-single', via: 'money', tokenIn: ADDR.money, fee: FEE_WALL, twoSided: false } });

  // 2) Goods (food/gem/weapon) — coin→good fee-100 walls, deduped by token address.
  const ports = readJson('port-keyed-pools-deployed.json');
  if (ports && ports.pools) {
    const seen = new Set();
    for (const p of Object.values(ports.pools)) {
      const addr = (p.goodAddr || '').toLowerCase();
      if (!addr || seen.has(addr)) continue;
      seen.add(addr);
      const coin = p.coin; // 'copper' | 'silver' | 'gold'
      if (!COIN_USD[coin]) continue;
      const anchorUsd = Number(p.price) * COIN_USD[coin];
      reg.push({
        id: p.good, sym: String(p.good).toUpperCase(), token: p.goodAddr, role: p.kind || 'good',
        anchorUsd, buySafe: true, sellSafe: false,
        route: { type: 'v3-single', via: coin, tokenIn: COIN_ADDR[coin], fee: FEE_WALL, twoSided: false,
                 bookPrice: Number(p.price), coin },
      });
    }
  }

  // 3) FISH — custom self-add wall at Port Royal (gold-priced). sellSafe unverified ⇒ conservative.
  const ocean = readJson('ocean-deployed.json');
  if (ocean && ocean.portRoyal) {
    reg.push({ id: 'fish', sym: 'FISH', token: ocean.fish, role: 'fish',
      anchorUsd: Number(ocean.portRoyal.price) * COIN_USD.gold,
      buySafe: true, sellSafe: false,
      route: { type: 'custom-pool', pool: ocean.portRoyal.pool, quoteToken: ADDR.gold, quoteUsd: COIN_USD.gold,
               note: 'Port Royal fish wall (custom AMM quote())' } });
  }

  // 4) LUMBER — custom mill LP (gold-priced). Price off the first mill; sellSafe unverified.
  const mill = readJson('mill-lp-deployed.json');
  if (mill && mill.mills) {
    const m = Object.values(mill.mills)[0];
    if (m) reg.push({ id: 'lumber', sym: 'LUMBER', token: m.lumber, role: 'lumber',
      anchorUsd: Number(m.price) * COIN_USD.gold,
      buySafe: true, sellSafe: false,
      route: { type: 'custom-pool', pool: m.pool, quoteToken: ADDR.gold, quoteUsd: COIN_USD.gold,
               note: 'mill LP (custom AMM quote())' } });
  }

  // 5) MfT meme — informational only (no peg ⇒ no anchor, never a trade target).
  reg.push({ id: 'mft', sym: 'MfT', token: ADDR.mftMeme, role: 'meme', anchorUsd: null,
    buySafe: false, sellSafe: false,
    route: { type: 'v3-single', via: 'money', tokenIn: ADDR.money, fee: FEE_MEME, twoSided: true } });

  return reg;
}

// ── live quoting (read-only) ────────────────────────────────────────────────────────────────
/** Single-hop V3 quote (BUY side): amountIn(in token) → amountOut(out token). Returns bigint or null. */
async function quoteSingle(tokenIn, tokenOut, fee, amountIn) {
  try {
    const r = await quoter().quoteExactInputSingle.staticCall({
      tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
    });
    return r[0];
  } catch (_) { return null; }
}

/** Custom self-add AMM quote: 1 token (18dec) → quoteToken out (18dec). Returns bigint or null. */
async function quoteCustom(poolAddr, tokenAddr) {
  try {
    const pool = new ethers.Contract(poolAddr, CUSTOM_POOL_ABI, provider());
    const t0 = (await pool.token0()).toLowerCase();
    const zeroForOne = t0 === tokenAddr.toLowerCase(); // selling tokenAddr in
    return await pool.quote(zeroForOne, ONE);
  } catch (_) { return null; }
}

const moneyWei = (usd) => ethers.parseUnits(usd.toFixed(6), 6);   // Money ≈ $1, 6dec
const goldWei  = (g) => ethers.parseUnits(String(g), 18);
const human    = (wei, d = 18) => Number(ethers.formatUnits(wei, d));

/**
 * Price ONE token in USD via its working BUY route. Coin USD prices are passed in so goods can be
 * priced off a live coin price (full real quote chain, no hardcoded token prices).
 * @returns {Promise<{priceUsd:number|null, routeDesc:string, note:string}>}
 */
async function priceToken(t, coinUsdLive) {
  const r = t.route;

  if (r.type === 'v3-single' && r.via === 'money') {
    // Money → token (buy side). Input ≈ $0.02 worth, kept tiny so a one-sided range reads ~spot.
    const usdIn = 0.02;
    const out = await quoteSingle(ADDR.money, t.token, r.fee, moneyWei(usdIn));
    if (out === null || out === 0n) return { priceUsd: null, routeDesc: `Money→${t.sym} fee${r.fee}`, note: 'no quote (route empty/reverted)' };
    const priceUsd = usdIn / human(out, 18);
    return { priceUsd, routeDesc: `Money→${t.sym} fee${r.fee}`, note: '' };
  }

  if (r.type === 'v3-single') {
    // coin → good (buy side). Price the good in USD via the LIVE coin price.
    const coinUsd = coinUsdLive[r.coin] ?? COIN_USD[r.coin];
    // size the coin input so output is meaningful: ~ a few cents of coin
    const coinIn = Math.max(r.bookPrice * 2, 1);              // a couple book-units of coin
    const out = await quoteSingle(r.tokenIn, t.token, r.fee, goldWei(coinIn)); // all coins are 18dec
    if (out === null || out === 0n) return { priceUsd: null, routeDesc: `${r.coin}→${t.sym} fee${r.fee}`, note: 'no open route (likely LocationPool-gated only)' };
    const priceUsd = (coinIn * coinUsd) / human(out, 18);
    return { priceUsd, routeDesc: `${r.coin}→${t.sym} fee${r.fee} (coin@$${coinUsd})`, note: '' };
  }

  if (r.type === 'custom-pool') {
    const out = await quoteCustom(r.pool, t.token); // 1 token → quoteToken
    if (out === null || out === 0n) return { priceUsd: null, routeDesc: `${t.sym} custom pool ${r.pool.slice(0, 10)}…`, note: 'custom pool quote() unavailable' };
    const priceUsd = human(out, 18) * r.quoteUsd;
    return { priceUsd, routeDesc: `${t.sym}→gold @custom ${r.pool.slice(0, 10)}…`, note: r.note || '' };
  }

  return { priceUsd: null, routeDesc: 'unknown', note: 'unhandled route type' };
}

/** Resolve live coin USD prices (copper/silver/gold) from the walls. Falls back to anchor on miss. */
async function liveCoinUsd() {
  const out = { ...COIN_USD };
  for (const coin of ['copper', 'silver', 'gold']) {
    const o = await quoteSingle(ADDR.money, COIN_ADDR[coin], FEE_WALL, moneyWei(0.02));
    if (o && o > 0n) out[coin] = 0.02 / human(o, 18);
  }
  return out;
}

/**
 * scanGaps — the public contract. Read-only. Returns ranked Gap[].
 * @typedef {Object} Gap
 * @property {string} id @property {string} sym @property {string} token @property {string} role
 * @property {number|null} anchorUsd @property {number|null} priceUsd @property {number|null} gapPct
 * @property {'buy'|'sell'|'none'} direction   buy=underpriced (close by buying); sell=overpriced
 * @property {boolean} buySafe @property {boolean} sellSafe
 * @property {boolean} actionable  there is a SAFE trade in `direction` right now
 * @property {string} route @property {string} note
 * @returns {Promise<Gap[]>}
 */
async function scanGaps() {
  const reg = loadRegistry();
  const coinUsd = await liveCoinUsd();

  const gaps = [];
  for (const t of reg) {
    const { priceUsd, routeDesc, note } = await priceToken(t, coinUsd);
    let gapPct = null, direction = 'none', actionable = false;
    if (priceUsd !== null && t.anchorUsd) {
      gapPct = ((priceUsd - t.anchorUsd) / t.anchorUsd) * 100;
      if (gapPct < -0.5) direction = 'buy';        // underpriced → buy to push toward anchor
      else if (gapPct > 0.5) direction = 'sell';   // overpriced → sell toward anchor
      actionable = (direction === 'buy' && t.buySafe) || (direction === 'sell' && t.sellSafe);
    }
    gaps.push({
      id: t.id, sym: t.sym, token: t.token, role: t.role,
      anchorUsd: t.anchorUsd, priceUsd, gapPct,
      direction, buySafe: t.buySafe, sellSafe: t.sellSafe, actionable,
      route: routeDesc, note,
    });
  }

  // Rank: actionable first, then by |gapPct| desc; null-priced sink to the bottom.
  gaps.sort((a, b) => {
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    const ga = a.gapPct === null ? -1 : Math.abs(a.gapPct);
    const gb = b.gapPct === null ? -1 : Math.abs(b.gapPct);
    return gb - ga;
  });
  return gaps;
}

module.exports = { scanGaps, loadRegistry, priceToken, liveCoinUsd, quoteSingle, ADDR, COIN_USD, COIN_ADDR, FEE_WALL, RPC, CHAIN_ID, QUOTER };
