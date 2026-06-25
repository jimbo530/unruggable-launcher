// game/lib/coins.js — THE one true coin denomination for the whole game.
//
// GOLD, SILVER, and COPPER are THREE REAL on-chain ERC20 tokens (Base, all 18 decimals).
// They are pegged in the in-game economy by their supplies (10B : 100B : 1T):
//
//     1 gold = 10 silver = 100 copper
//
// They are NOT a display trick over one token — each denomination is its own token that a
// game contract actually transfers. A payout of 3.45 gold-equivalent = 3 GOLD + 4 SILVER +
// 5 COPPER tokens sent, rendered "3g 4s 5c".
//
// Display rule: GOLD and SILVER are always shown WHOLE; COPPER is the ONLY denomination shown
// fractionally (it's the smallest coin). So 0.075 gold → "7.5c", 10,000 gold → "10,000g".
//
// Payout rule: convert any gold-equivalent value to whole GOLD + whole SILVER + (fractional)
// COPPER token amounts via payoutSplit/splitCoins — each denomination maps 1:1 to its token.
//
// Single source of truth — import this everywhere (store, jobs, crew, hold payouts) so the
// coin convention never drifts between screens.

export const SILVER_PER_GOLD   = 10;
export const COPPER_PER_GOLD    = 100;
export const COPPER_PER_SILVER  = 10;

// The three real on-chain coin tokens (Base, all 18 decimals), VERIFIED 2026-06-25.
// Pegged in the in-game economy 1 gold : 10 silver : 100 copper (supplies confirm it:
// 10B : 100B : 1T). perGold = how many of this token equal one gold.
export const TOKENS = {
  gold:   { address: "0x2065d87b3a1facc9a4fe037d7a58bc069f597004", symbol: "GOLD",   perGold: 1   },
  silver: { address: "0x36cf0cedeee07b14c496f77c61d010268c31e0e9", symbol: "SILVER", perGold: 10  },
  copper: { address: "0x0197896c617f20d61e73e06ec8b2a95eef176bee", symbol: "COPPER", perGold: 100 },
};

// Combine the three token balances (as decimal numbers) into one gold-equivalent purse total.
export function purseToGold({ gold = 0, silver = 0, copper = 0 }) {
  return Number(gold) + Number(silver) / SILVER_PER_GOLD + Number(copper) / COPPER_PER_GOLD;
}

const grp  = n => n.toLocaleString("en-US");
const trim = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

// Split a GOLD value into { gold, silver, copper }. gold/silver are whole; copper may be fractional.
export function splitCoins(value) {
  let totalCopper = Math.round((Number(value) || 0) * COPPER_PER_GOLD * 100) / 100; // 2-dec copper precision
  if (totalCopper < 0) totalCopper = 0;
  const gold   = Math.floor(totalCopper / COPPER_PER_GOLD);
  const silver = Math.floor((totalCopper - gold * COPPER_PER_GOLD) / COPPER_PER_SILVER);
  const copper = Math.round((totalCopper - gold * COPPER_PER_GOLD - silver * COPPER_PER_SILVER) * 100) / 100;
  return { gold, silver, copper };
}

// "12,345g 6s 7c" — omits zero denominations; copper carries any fraction; 0 → "0g".
export function coins(value) {
  const { gold, silver, copper } = splitCoins(value);
  const parts = [];
  if (gold)   parts.push(grp(gold) + "g");
  if (silver) parts.push(silver + "s");
  if (copper) parts.push(trim(copper) + "c");
  return parts.length ? parts.join(" ") : "0g";
}

// What a contract actually pays for a given gold value: the whole-GOLD + whole-SILVER +
// fractional-COPPER token amounts to send. This IS splitCoins (gold/silver whole, copper
// fractional) — each denomination maps 1:1 to its own token.
export const payoutSplit = splitCoins;
