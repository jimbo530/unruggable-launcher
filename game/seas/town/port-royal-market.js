// @ts-check
'use strict';
/**
 * port-royal-market.js — THE PORT ROYAL GOODS MARKET (UI / game-layer, one-sided).
 *
 * SINGLE SOURCE OF TRUTH for the goods shop. Founder course-correct (2026-06-27):
 *   "Port Royal trading is UI/game-layer NOW (not new on-chain pools — those come later, gated,
 *    seeded by buying some of each with GOLD). We should not need any gold for this at all yet …
 *    for now we build one sided market for every good."
 *
 * WHAT "ONE-SIDED MARKET" MEANS HERE (read before editing):
 *   We hold huge balances of every good. A one-sided market OFFERS the good FOR SALE at a set
 *   price; players bring COINS to BUY it. We seed NO GOLD/coin reserve — the core is the SELL-SIDE
 *   (good-only, coin → good). This is a game-layer SHOP, NOT an x*y=k pool. (The existing on-chain
 *   pattern is exactly this too: every wall pool is one-sided BUY-fills, the sell side reads
 *   near-zero — see gap-scan.js. So a coin-in / good-out shop matches the live market shape.)
 *   Selling back (good → coin) is NOT offered here: the existing market has no safe two-sided sell
 *   side (sellSafe:false everywhere but GOLD/Money), so a buy-back would be a near-zero drain trap.
 *
 * PRICING — the canonical GOLD-equivalent prices the founder set (price per 1 WHOLE good):
 *   1 GOLD = 100 SILVER = 10000 COPPER  ($0.01 / $0.001 / $0.0001).
 *   We charge in the SMALLEST coin tier that makes the price a whole, friendly number — the SAME
 *   convention port-market.csv / port-royal-goods-walls-deployed.json use (salt→copper, honey→
 *   silver, apple→gold, …). `goldPrice` is kept verbatim so this object can later SEED the on-chain
 *   gated LocationPool LPs at the identical numbers (see PORT-ROYAL-MARKET-MIGRATION.md).
 *
 * PRESENCE GATE: this market is gated to PORT ROYAL (on-chain location id 8003). The seas-server is
 *   the location authority — the UI asks GET /seas/location?player=… and only opens the buy buttons
 *   when location === 8003 (same trust boundary trade-attest uses). Never fakes presence.
 *
 * WHOLE NUMBERS ONLY: goods trade in whole units (game-layer rule). The UI rounds/clamps quantity to
 *   an integer ≥ 1 and rejects fractional input. The on-chain migration keeps this (whole-unit buys).
 *
 * SHIPPED AS: an ES module (browser <script type="module">) — the SAME shape battle-grid/items.js
 *   uses for the General Store. A node seed-script/test reads the same numbers via dynamic import()
 *   (exactly how seas-api.js loads the ESM map module). No chain, no network here.
 */

// ── coins (Base 8453, 18-dec). Verified against gap-scan.js COIN_ADDR + commodity-tokens.csv. ──
const COINS = {
  copper: { sym: 'COPPER', addr: '0x0197896c617f20d61E73E06eC8b2A95eef176bee', usd: 0.0001, perGold: 10000, emoji: '🟤' },
  silver: { sym: 'SILVER', addr: '0x36cF0ceDEee07b14C496f77C61d010268c31E0e9', usd: 0.001,  perGold: 100,   emoji: '⚪' },
  gold:   { sym: 'GOLD',   addr: '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004', usd: 0.01,   perGold: 1,     emoji: '🟡' },
};

// ── Port Royal on-chain location id (q*1000 + r). The presence gate compares the wallet's
//    server-authoritative location to this. (Matches port-royal-goods-walls-deployed.json.locationId.)
const PORT_ROYAL_LOCATION = 8003;

/**
 * Convert a founder GOLD-equivalent price into the canonical { coin, price } the market charges in.
 * Rule (matches the LIVE deployed market — port-market.csv / port-royal-goods-walls-deployed.json):
 * pick the LARGEST coin tier that still yields a WHOLE price ≥ 1 (gold first, then silver, then
 * copper). So apple 1g → 1 gold, pork 0.01g → 1 silver, honey 0.001g → 1 silver?-no: 0.001g = 0.1
 * silver (not whole) → 10 copper. The deployed walls price honey in silver@1 — but honey there is a
 * different (older) anchor; here honey is the founder's 0.001g, whose whole representation is 10
 * copper. We keep the founder's number exact and just express it in the largest whole tier.
 * @param {number} goldPrice price in GOLD per 1 whole good
 * @returns {{ coin:'copper'|'silver'|'gold', price:number }}
 */
function coinTierFor(goldPrice) {
  for (const coin of ['gold', 'silver', 'copper']) {
    const price = Math.round(goldPrice * COINS[coin].perGold * 1e8) / 1e8; // de-float
    if (price >= 1 && Number.isInteger(price)) return { coin, price };
  }
  // smaller than 1 copper should never happen with the founder table; surface it, never silent.
  throw new Error(`price ${goldPrice} GOLD has no whole-coin representation ≥ 1 (smallest tier is copper @ $${COINS.copper.usd})`);
}

// ── the goods catalog. The 11 PRIORITY goods (bilge/goblin prize goods) are the founder's table.
//    goldPrice = canonical value (verbatim). token = on-chain ERC20 (commodity-tokens.csv). emoji =
//    UI only. The on-chain wall (if one exists today) is noted in `legacyPool` so the migration doc
//    + future seed script can find it; the UI does NOT route through it (game-layer only). ──────────
const GOODS_RAW = [
  // sym, name, goldPrice, token, emoji, legacyPool(optional)
  ['SALT',     'Salt',     0.0001, '0xdDCB77AA553718ACc88aA61ba1514EE267Cc6825', '🧂', '0x6f8a1989789C1383518E28392D585091Ae10eE38'],
  ['RICE',     'Rice',     0.0002, '0x00e466Fb90C8eF2e7BA1AA662a7c79C595906041', '🍚', null],
  ['FLOUR',    'Flour',    0.0004, '0x111c5a52C3e631bf43e2e44DB001F08d20a9Ee73', '🌾', null],
  ['HONEY',    'Honey',    0.001,  '0x92Cf60b74BD16aAb42f2C249e72E9860e83A765f', '🍯', '0x81BE99EF0Ff61E4C05C64A8095121212D28bCCeA'],
  ['RATIONS',  'Rations',  0.005,  '0x0867653716D37DC9F13c5347A8Ca8fFF6CA95926', '🥡', '0x04B5C35a8f95e03099af7461b781f32D73E3f265'],
  ['PORK',     'Pork',     0.01,   '0x676d5a1C8438A9955bbA636e496aebddA4c49a2D', '🥓', null],
  ['APPLE',    'Apple',    1,      '0xa7E88Ce1163e325Be877C54021da901A7DA8b170', '🍎', '0xB341B8e945a6297bAC1760482e8108250d1e15d3'],
  ['CINNAMON', 'Cinnamon', 1,      '0x69a8d4AA5a9ee7965E583bC97288e2B325231b49', '🟫', '0x91d42f303cB85616deAF6dd1c7EA8430E0BC09a3'],
  ['COD',      'Cod',      5,      '0xCdb48Fbea782D46b95426A6791cE9E1d2DDA7559', '🐟', '0x798D3E1eFEaA1a2E0D66da550EA480d8b5327A66'],
  ['JERKY',    'Jerky',    7,      '0xA34Ce4E86D00d63a847Ec122B7E94D94c2A0FCa0', '🥩', '0xE8Ecd9f128B41933E3123DB556f13770A7a48F1c'],
  ['ALE',      'Ale',      8,      '0x102817fd347c1A8117dDB4f5a9A6D6E363D360F7', '🍺', '0xf8EbaA85d7BF450d0EF1f50d85Afa3331A0E0F8F'],
];

/** Build the priced goods list (price split into coin tier + whole-coin price). */
function buildGoods() {
  return GOODS_RAW.map(([sym, name, goldPrice, token, emoji, legacyPool]) => {
    const { coin, price } = coinTierFor(goldPrice);
    return {
      id: sym.toLowerCase(),
      sym, name, emoji,
      token,                       // on-chain ERC20 (the good we sell)
      goldPrice,                   // canonical GOLD-equivalent per 1 whole good (seeds on-chain later)
      coin,                        // 'copper'|'silver'|'gold' — the tier we CHARGE in
      coinAddr: COINS[coin].addr,
      price,                       // whole-coin price per 1 whole good (in `coin`)
      usdEach: goldPrice * COINS.gold.usd, // info only (NOT shown — crypto hidden in game UI)
      legacyPool: legacyPool || null,      // legacy on-chain V3 wall (do NOT unwind; UI ignores it)
    };
  });
}

const GOODS = buildGoods();

/**
 * Validate + normalize a requested buy quantity. WHOLE NUMBERS ONLY (game-layer rule). Rejects
 * fractional / non-positive / non-finite. Returns { ok, qty } or { ok:false, reason }.
 * @param {number|string} raw
 * @returns {{ ok:true, qty:number } | { ok:false, reason:string }}
 */
function normalizeQty(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, reason: 'enter a whole number of units' };
  if (n <= 0) return { ok: false, reason: 'buy at least 1 unit' };
  if (!Number.isInteger(n)) return { ok: false, reason: 'goods trade in whole units only — no fractions' };
  return { ok: true, qty: n };
}

/** Total coin cost for `qty` WHOLE units of a good (in the good's coin tier). Throws on bad qty. */
function totalCost(good, qty) {
  const v = normalizeQty(qty);
  if (!v.ok) throw new Error(v.reason);
  return good.price * v.qty; // whole-coin × whole-units = whole coins
}

/** Is the server-reported location Port Royal? (the presence gate). */
function isAtPortRoyal(serverLocation) { return Number(serverLocation) === PORT_ROYAL_LOCATION; }

// ES module export (browser <script type="module"> + node dynamic import()).
export { COINS, GOODS, PORT_ROYAL_LOCATION, coinTierFor, normalizeQty, totalCost, isAtPortRoyal };
export default { COINS, GOODS, PORT_ROYAL_LOCATION, coinTierFor, normalizeQty, totalCost, isAtPortRoyal };
