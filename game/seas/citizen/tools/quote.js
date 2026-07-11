#!/usr/bin/env node
'use strict';
/**
 * quote.js — quote ONE route (read-only) and print JSON. The agent's "what would I get?" tool.
 *
 * TWO PRICING RAILS (they are DIFFERENT venues — this is the whole point):
 *   • COIN↔COIN / COIN↔MONEY  → a Uniswap V3 single-hop wall (money/usdc/gold/silver/copper/mft).
 *     GOLD↔COPPER etc. fill here. This is the old behaviour, unchanged.
 *   • A TRADE GOOD (salt, cod, rations, apple, gems, gear…) → it does NOT trade in a V3 pool. Goods
 *     trade in LOCATION-KEYED custom LocationPools (presence-gated, single-venue per town). The truth
 *     for a good's price is the game's OWN posted book price at a town (port-keyed-pools-deployed.json:
 *     each `port:good` row carries loc + coin + price + the pool address), and the LIVE on-chain
 *     LocationPool.quote() confirms it. If the good isn't sold at the player's CURRENT location, we
 *     return an HONEST "no live venue for SALT where you are" and name the ports that DO sell it —
 *     never a bare failure. FISH's Port Royal wall (ocean-deployed.json) is a goods venue too.
 *
 * Accepts token SYMBOLS (money, usdc, gold, silver, copper, mft, or any good id like emerald/salt)
 * or raw 0x addresses. Never trades.
 *
 *   node citizen/tools/quote.js money gold 0.02        # coin/money V3 wall
 *   node citizen/tools/quote.js salt copper 10         # goods venue (location-keyed) at your port
 *   node citizen/tools/quote.js cod gold 5             # goods venue
 */
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const gs = require('../../gap-scan.js');
const chain = require('../lib/chain.js');
const seas = require('../lib/seas-api.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

const DEPLOY = path.join(__dirname, '..', '..', '..', '..', 'deploy');
const COIN_USD = gs.COIN_USD; // { copper, silver, gold }
const COIN_SYMS = new Set(['gold', 'silver', 'copper']);
const human = (wei, d = 18) => Number(ethers.formatUnits(wei, d));

function readDeploy(rel) {
  const p = path.join(DEPLOY, rel);
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }
  catch (e) { throw new Error(`failed to read deploy record ${rel}: ${e.message}`); }
}

// ── the GOODS VENUE INDEX: good id → [ { port, loc, coin, price, pool, goodAddr } ] ───────────────
// Built from the on-chain deploy records that ARE the game's posted goods market. This is the same
// source gap-scan.js reads; we mirror the game's truth, we do not invent a price.
let _venuesById = null;
function goodsVenues() {
  if (_venuesById) return _venuesById;
  const idx = {};
  const add = (goodId, v) => { (idx[String(goodId).toLowerCase()] = idx[String(goodId).toLowerCase()] || []).push(v); };

  // port-keyed goods (food/gem/weapon/gear) — the 7-town gated LocationPools.
  const ports = readDeploy('port-keyed-pools-deployed.json');
  if (ports && ports.pools) {
    for (const p of Object.values(ports.pools)) {
      if (!p.good || !p.pool || !p.coin) continue;
      add(p.good, { port: p.port, loc: Number(p.loc), coin: p.coin, price: Number(p.price), pool: p.pool, goodAddr: p.goodAddr });
    }
  }
  // FISH — its dear buyer is the Port Royal wall (custom LocationPool, gold-priced).
  const ocean = readDeploy('ocean-deployed.json');
  if (ocean && ocean.portRoyal && ocean.fish) {
    add('fish', { port: 'port_royal', loc: Number(ocean.portRoyal.loc || 8003), coin: 'gold', price: Number(ocean.portRoyal.price), pool: ocean.portRoyal.pool, goodAddr: ocean.fish });
  }
  _venuesById = idx;
  return idx;
}

// symbol → {addr, dec, sym, kind:'coin'|'money'|'good'}
function resolve(sym) {
  const s = String(sym).toLowerCase();
  if (s.startsWith('0x') && s.length === 42) return { addr: ethers.getAddress(s), dec: 18, sym, kind: 'raw' };
  const known = {
    money: { addr: gs.ADDR.money, dec: 6, kind: 'money' }, usdc: { addr: gs.ADDR.usdc, dec: 6, kind: 'money' },
    mft: { addr: gs.ADDR.mftMeme, dec: 18, kind: 'money' },
    gold: { addr: gs.COIN_ADDR.gold, dec: 18, kind: 'coin' }, silver: { addr: gs.COIN_ADDR.silver, dec: 18, kind: 'coin' }, copper: { addr: gs.COIN_ADDR.copper, dec: 18, kind: 'coin' },
  };
  if (known[s]) return { ...known[s], sym: s };
  // goods from the live registry (has the token address; a good if it's not a coin role)
  const reg = gs.loadRegistry();
  const hit = reg.find(t => t.id === s || t.sym.toLowerCase() === s);
  if (hit) return { addr: hit.token, dec: 18, sym: hit.id, kind: hit.role === 'coin' ? 'coin' : 'good' };
  // last resort: any good in the venue index (covers goods without a registry entry)
  if (goodsVenues()[s]) return { addr: goodsVenues()[s][0].goodAddr, dec: 18, sym: s, kind: 'good' };
  throw new Error(`unknown token "${sym}" — use money|usdc|gold|silver|copper|mft, a good id (salt, cod, rations, apple, emerald…), or a 0x address`);
}

/** The player's CURRENT server-authoritative location id (or null if unreachable / no wallet). */
async function currentLoc() {
  const addr = chain.walletAddress();
  if (!addr) return { addr: null, loc: null, note: 'no wallet — cannot presence-gate the goods venue' };
  const l = await seas.location(addr).catch((e) => ({ ok: false, transport: 'unreachable', error: e.message }));
  const loc = (l && (l.location !== undefined && l.location !== null)) ? Number(l.location) : null;
  return { addr, loc, atSea: !!(l && l.atSea), raw: l };
}

/**
 * Quote a GOOD → COIN (or COIN → GOOD) through its location-keyed venue. `good` is the resolved good,
 * `coinSym` is the coin the other side is (gold|silver|copper). Returns an honest price at the player's
 * current location, or an honest "no venue here" that names where it IS sold. Never a bare failure.
 */
async function quoteGood(good, coinSym, amountHuman, sellingGood) {
  const venues = goodsVenues()[good.sym] || [];
  if (!venues.length) {
    return out({ ok: false, tool: 'quote', route: 'goods', tokenIn: good.sym,
      error: `no goods venue exists anywhere for "${good.sym}" — it is not a posted trade good in any town's market`,
      hint: 'valid goods have a row in the port market (salt, honey, rations, apple, cinnamon, cod, jerky, ale, pepper, wine, saffron, gems, gear).' });
  }
  // Where is the player? Match a venue at the current location.
  const here = await currentLoc();
  const atHere = here.loc != null ? venues.filter((v) => v.loc === here.loc) : [];
  const soldPorts = venues.map((v) => ({ port: v.port, loc: v.loc, coin: v.coin, bookPrice: v.price }));

  if (here.loc == null) {
    return out({ ok: false, tool: 'quote', route: 'goods', tokenIn: good.sym,
      error: `cannot price "${good.sym}": your location is unknown (${here.raw && here.raw.transport === 'unreachable' ? 'seas-server unreachable' : 'no server location'}) and goods are location-gated`,
      soldAt: soldPorts,
      hint: 'goods only trade at the town that hosts their LocationPool — sail to one of soldAt (e.g. Port Royal loc 8003) then quote there.' });
  }
  if (!atHere.length) {
    return out({ ok: false, tool: 'quote', route: 'goods', tokenIn: good.sym, yourLocation: here.loc,
      error: `no live venue for "${good.sym.toUpperCase()}" at your location (${here.loc}) — this good is not sold here`,
      soldAt: soldPorts,
      hint: `sail to a town that hosts it (${soldPorts.map((s) => `${s.port} loc ${s.loc}`).join(', ')}), then quote there.` });
  }
  // Pick the venue at this location. If the caller named a specific coin, prefer the matching one.
  const venue = atHere.find((v) => v.coin === coinSym) || atHere[0];
  if (coinSym && venue.coin !== coinSym) {
    return out({ ok: false, tool: 'quote', route: 'goods', tokenIn: good.sym, yourLocation: here.loc,
      error: `"${good.sym.toUpperCase()}" is priced in ${venue.coin.toUpperCase()} here, not ${coinSym.toUpperCase()} — its posted book price is ${venue.price} ${venue.coin} per unit`,
      venue: { port: venue.port, loc: venue.loc, coin: venue.coin, bookPrice: venue.price, pool: venue.pool },
      hint: `quote against its real coin: node citizen/tools/quote.js ${good.sym} ${venue.coin} ${amountHuman}` });
  }

  // Honest price = the game's POSTED BOOK price (coin per whole unit), confirmed by a LIVE on-chain
  // LocationPool.quote() when the pool answers. bookPrice is the game's own truth; the live quote is
  // the on-chain confirmation (may differ slightly with pool depth/fee — we report BOTH, never fake).
  const coinUsd = COIN_USD[venue.coin];
  const bookTotalCoin = venue.price * Number(amountHuman);
  const result = {
    ok: true, tool: 'quote', route: 'goods',
    tokenIn: good.sym, tokenOut: venue.coin, direction: sellingGood ? `${good.sym.toUpperCase()} → ${venue.coin.toUpperCase()}` : `${venue.coin.toUpperCase()} → ${good.sym.toUpperCase()}`,
    venue: { port: venue.port, loc: venue.loc, pool: venue.pool, presenceGated: true },
    yourLocation: here.loc, atVenue: true,
    amountIn: Number(amountHuman),
    bookPrice: { perUnit: venue.price, coin: venue.coin, totalCoin: bookTotalCoin, usdEach: venue.price * coinUsd },
  };
  // Try the LIVE on-chain quote for the exact direction (best effort — the book price stands regardless).
  try {
    const pool = await chain.readLocationPool(venue.pool);
    const goodIsT0 = pool.token0.toLowerCase() === good.addr.toLowerCase();
    // selling the good = good IN; buying the good = coin IN.
    const zeroForOne = sellingGood ? goodIsT0 : !goodIsT0;
    const amtInWei = ethers.parseUnits(String(amountHuman), 18);
    const capped = pool.maxSwapIn > 0n && amtInWei > pool.maxSwapIn;
    const liveOutWei = capped ? null : await chain.quoteLocationPool(venue.pool, zeroForOne, amtInWei);
    result.live = {
      poolOpen: pool.open, feeBps: pool.feeBps,
      maxSwapIn: pool.maxSwapIn > 0n ? human(pool.maxSwapIn) : 'uncapped',
      amountOut: liveOutWei != null ? human(liveOutWei) : null,
      note: capped ? `amount ${amountHuman} exceeds the pool's maxSwapIn — book price still applies, split the trade`
        : (liveOutWei != null && liveOutWei === 0n ? 'on-chain quote returned 0 (this side is not filling — the one-sided wall may only buy, not sell; the BOOK price is the posted truth)' : 'live on-chain confirmation'),
    };
  } catch (e) {
    result.live = { amountOut: null, note: `live pool read failed (book price still applies): ${e.message}` };
  }
  return out(result);
}

(async () => {
  const [inArg, outArg, amtArg, feeArg] = process.argv.slice(2);
  if (!inArg || !outArg || !amtArg) throw new Error('usage: quote.js <tokenIn> <tokenOut> <amountHuman> [fee]');
  const tin = resolve(inArg), tout = resolve(outArg);

  // ── GOODS RAIL: if either side is a trade good, route through its location-keyed venue ──
  if (tin.kind === 'good' || tout.kind === 'good') {
    const good = tin.kind === 'good' ? tin : tout;
    const other = tin.kind === 'good' ? tout : tin;
    const sellingGood = tin.kind === 'good'; // good is the INPUT ⇒ selling it
    if (tin.kind === 'good' && tout.kind === 'good') {
      // good ↔ good is a two-hop route (sell to coin, buy the other) — not a single posted venue.
      out({ ok: false, tool: 'quote', route: 'goods', tokenIn: tin.sym, tokenOut: tout.sym,
        error: `good→good (${tin.sym}→${tout.sym}) has no single venue — goods only trade against a COIN at a town`,
        hint: `quote each leg vs its coin: node citizen/tools/quote.js ${tin.sym} <coin> ${amtArg}, then <coin> ${tout.sym}.` });
      process.exit(1);
    }
    const coinSym = COIN_SYMS.has(other.sym) ? other.sym : null; // the coin the player named (or null → use the venue's)
    await quoteGood(good, coinSym, amtArg, sellingGood);
    return;
  }

  // ── COIN / MONEY RAIL: the Uniswap V3 single-hop wall (unchanged) ──
  const amountIn = ethers.parseUnits(String(amtArg), tin.dec);
  const fees = feeArg ? [Number(feeArg)] : [100, 500, 3000, 10000];
  for (const fee of fees) {
    const o = await gs.quoteSingle(tin.addr, tout.addr, fee, amountIn);
    if (o && o > 0n) {
      const amountOut = Number(ethers.formatUnits(o, tout.dec));
      const inHuman = Number(amtArg);
      out({
        ok: true, tool: 'quote', route: 'v3',
        tokenIn: tin.sym, tokenInAddr: tin.addr, tokenOut: tout.sym, tokenOutAddr: tout.addr,
        fee, amountIn: inHuman, amountOut,
        pricePerOut: amountOut > 0 ? inHuman / amountOut : null,
        route: `${tin.sym}→${tout.sym} fee${fee}`,
      });
      return;
    }
  }
  out({ ok: false, tool: 'quote', route: 'v3', error: `no V3 pool filled for ${tin.sym}→${tout.sym} at fees [${fees}]`, hint: 'coin/money pairs trade on a V3 wall; if you meant a trade good, name the good directly (e.g. `quote salt copper 10`) so it routes to its location-keyed venue.' });
  process.exit(1);
})().catch(e => { out({ ok: false, tool: 'quote', error: e.message || String(e), hint: 'usage: quote.js <tokenIn> <tokenOut> <amountHuman> [fee] — coins/money route to a V3 wall; goods route to their location-keyed town venue.' }); process.exit(1); });
