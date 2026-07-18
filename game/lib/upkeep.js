// @ts-check
// upkeep.js — pawn FOOD upkeep + MORALE (founder 2026-06-26 / UNIVERSAL EATING 2026-06-28). Every
// pawn burns ~1 lb of food/day (1 RATION = the staple daily ration), TOWN OR WILD — NO exceptions.
// A FED pawn is at full strength; an UNFED one STARVES: −1 to ALL stats per missed day, CUMULATIVE
// (stacks every day it goes without food). Higher-VALUE food raises MORALE, and morale grants PERKS
// (faster work, combat edge). Food/rations are dev-controlled token supplies → we can be generous
// handing them out as prizes; eating is the SINK that lets food production inflate safely.
//
// UNIVERSAL EATING (founder 2026-06-28: "we want all pawns to need to eat"): the OLD in-town /
// sheltered free-eat EXCLUDE is REMOVED. Every pawn eats 1 food/day wherever it is — IF it has food
// in its inventory, it AUTO-EATS (oldest-first); if not, it accrues hungryDays and the starvation
// debuff bites. (Eventually players own towns + stock food to feed garrisons — future.) The old
// isSheltered/atSea EXCLUDE model below is SUPERSEDED and kept only as a deprecated shim so existing
// callers don't crash; needsRations() now always returns true.
//
// "PLAYER-SIDE BURN, NOT A REAL TOKEN BURN" (founder 2026-06-26): consumed rations are NOT torched
// to 0xdead — on-chain they RETURN TO THE TREASURY (TREASURY_RECYCLE below), replenishing the 100B
// world-resource reserve we sell/restock with (resource-lever.js). Feeding crews is a recovery loop
// for us, never destruction (on-doctrine: no burns, just builds). A ship at sea with 100 crew = 100
// rations/day back to devs. Game-layer accounting here (localStorage); the food-token transfer→
// treasury wires in later via the relayer.

export const DAY_MS = 60_000;                 // dev-scaled "day" (raise toward 86_400_000 for real)
const MORALE_DECAY_PER_HUNGRY_DAY = 10;       // morale lost per day a pawn goes unfed
const MAX_MORALE = 100;
const FOOD_LB_PER_DAY = 1;                     // 1 lb feeds a pawn for 1 day (founder)
export const STARVE_PER_DAY = 1;              // −1 to ALL stats per day unfed (cumulative, founder 2026-06-28)
export const STARVE_STAT_FLOOR = 1;           // a starved stat floors at 1 — never 0/negative
// consumed rations RETURN here on-chain (player-side burn, not a 0xdead token burn) → replenishes the
// 100B reserve the resource-lever sells/restocks with. (treasury / GOLD_SINK — shared/gold.js.)
export const TREASURY_RECYCLE = "0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10";

/** Rations a crew of `n` consumes per day (1/pawn/day). A ship of 100 crew at sea = 100/day to devs. */
export function rationsPerDay(crew) { return Math.max(0, Math.floor(crew)) * FOOD_LB_PER_DAY; }

// morale bonus per food id — ∝ its gold value: staples keep you fed but dull; gourmet lifts spirits.
export const FOOD_MORALE = {
  salt: 0, rations: 0, honey: 1, apple: 1, cinnamon: 1,
  blackberry: 1, blueberry: 1, grapes: 1, wheat: 1,    // foraged/farmed staples (berries+grapes → wine)
  cod: 3, jerky: 3, fish: 3, crab: 3, ale: 4, pork: 4, // foraged/hunted/caught meat feeds the crew at sea
  elk: 5, bear: 5, pepper: 6, wine: 8, saffron: 12,
};

/**
 * A food's CONSUMPTION VALUE = its FOOD_MORALE rank (auto-eat burns the LOWEST first, founder
 * 2026-06-28). An UNKNOWN food (not in FOOD_MORALE) is treated as HIGH value (Infinity) so it is
 * preserved — auto-eat never silently torches an unrecognized/valuable good before known staples.
 */
export function foodValue(foodId) {
  return FOOD_MORALE[foodId] !== undefined ? FOOD_MORALE[foodId] : Infinity;
}

/**
 * The CHEAPEST food id available in `inv` (lowest foodValue, qty > 0), or null if none. Ties break
 * by insertion order (stable) — deterministic for tests. This is the auto-eat picker: preserve the
 * gourmet, spend the staples. (Manual feed() bypasses this — a player can pick a SPECIFIC good food.)
 */
export function cheapestFood(inv) {
  if (!inv) return null;
  let best = null, bestVal = Infinity;
  for (const k of Object.keys(inv)) {
    if ((inv[k] || 0) <= 0) continue;
    const v = foodValue(k);
    if (best === null || v < bestVal) { best = k; bestVal = v; } // strict < → first-seen wins ties
  }
  return best;
}

const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
})();
const KEY = "sts_pawn_food"; // { [pawnId]: { fedUntil, morale } }
function read() { try { return JSON.parse(store.getItem(KEY) || "{}") || {}; } catch (e) { console.warn("[upkeep] bad JSON:", e); return {}; } }
function write(v) { store.setItem(KEY, JSON.stringify(v)); }

// settle morale: a pawn hungry since fedUntil loses MORALE_DECAY per hungry day.
function settle(p, now) {
  if (!p || !p.fedUntil || now <= p.fedUntil) return p ? (p.morale || 0) : 0;
  const hungryDays = Math.floor((now - p.fedUntil) / DAY_MS);
  return Math.max(0, (p.morale || 0) - hungryDays * MORALE_DECAY_PER_HUNGRY_DAY);
}

/**
 * Feed a pawn 1 lb (1 unit) of `foodId` → +1 day fed, +morale by the food's value. Caller spends the
 * food token.
 * @param {boolean} [backfill=false]  CATCH-UP semantic (used by autoEat): advance fedUntil from its
 *   CURRENT value (+1 day) even if that's still in the past, so eating 1 of N owed days clears exactly
 *   ONE day of the backlog (the rest stay hungry). Default false = eat-FRESH-now (fedUntil jumps to
 *   now+1 day regardless of how long it starved) — the manual / jobs-loop feeding semantic, unchanged.
 */
export function feed(pawnId, foodId, now = Date.now(), backfill = false) {
  const st = read(); const p = st[pawnId] || { fedUntil: 0, morale: 0 };
  p.morale = settle(p, now);                                            // apply any hunger decay first
  p.morale = Math.min(MAX_MORALE, p.morale + (FOOD_MORALE[foodId] ?? 0));
  const from = backfill ? (p.fedUntil || now) : (p.fedUntil > now ? p.fedUntil : now);
  p.fedUntil = from + DAY_MS * FOOD_LB_PER_DAY;                          // +1 day from the chosen anchor
  st[pawnId] = p; write(st);
  return { pawnId, food: foodId, fedUntil: p.fedUntil, morale: p.morale };
}

/** Is the pawn fed by packed rations (fedUntil in the future)? Raw food status. */
export function isFed(pawnId, now = Date.now()) { const p = read()[pawnId]; return !!p && (p.fedUntil || 0) > now; }

// ── UNIVERSAL STARVATION (founder 2026-06-28) ───────────────────────────────────────────────
/**
 * Whole DAYS a pawn has gone WITHOUT food = days since fedUntil (0 if still fed, or never tracked).
 * Cumulative: a pawn unfed for 3 days returns 3. This is the magnitude of the all-stats debuff.
 */
export function hungryDays(pawnId, now = Date.now()) {
  const p = read()[pawnId];
  return hungryDaysFrom(p ? p.fedUntil : 0, now);     // delegates to the pure core (ONE implementation)
}

/** The all-stats penalty for a starving pawn: −STARVE_PER_DAY × hungryDays (≤ 0). −3 = unfed 3 days. */
export function starvationPenalty(pawnId, now = Date.now()) {
  return -STARVE_PER_DAY * hungryDays(pawnId, now);
}

// ── STORE-AGNOSTIC PURE CORE (the ONE source of truth, reused by the SERVER) ────────────────────
// The localStorage-keyed wrappers above (hungryDays/starvationPenalty/autoEat) read this game's
// per-pawn { fedUntil } record from localStorage. The SERVER holds the SAME shape in its own
// state.rations[pawnKey] = { fedUntil, foodInv } authority map. These pure functions take the
// fedUntil/inventory DIRECTLY (no store), so seas-server.js can import upkeep.js and run the EXACT
// same −1/day math + cheapest-first batched consumption against its own map — no duplicated logic.

/** Whole unfed days from a raw fedUntil (0 if still fed/untracked). Pure — the core hungryDays does. */
export function hungryDaysFrom(fedUntil, now = Date.now()) {
  if (!fedUntil || now <= fedUntil) return 0;
  return Math.floor((now - fedUntil) / DAY_MS);
}

/** All-stats penalty (≤ 0) from a raw fedUntil. Pure — the core starvationPenalty delegates to this. */
export function starvationPenaltyFrom(fedUntil, now = Date.now()) {
  return -STARVE_PER_DAY * hungryDaysFrom(fedUntil, now);
}

/**
 * THE shared consumption step (founder 2026-06-28: once-per-day, batched, cheapest-first). Pure over
 * a plain { fedUntil } record + a food inventory — NO store, NO localStorage. Advances fedUntil one
 * day per food eaten, picking the CHEAPEST available food (cheapestFood) each day, for as many of the
 * elapsed/uncovered days as the inventory can cover; remaining days stay hungry. MUTATES `foodInv` in
 * place (caller persists it). This is the single implementation both autoEat (game) and the server's
 * serverAutoEat reuse, so the model can never drift between client and referee.
 *
 * @param {{fedUntil:number}} rec  the pawn's upkeep record (fedUntil advanced in the returned value)
 * @param {Object.<string, number>} foodInv  { foodId: qty } (mutated as food is consumed)
 * @param {number} [now]
 * @returns {{fedUntil:number, ate:number, foods:string[], hungryDays:number}}
 */
export function eatBatch(rec, foodInv, now = Date.now()) {
  let fedUntil = (rec && rec.fedUntil) || 0;
  let ate = 0; const foods = [];
  let uncovered = fedUntil >= now ? 0 : Math.ceil((now - (fedUntil || now)) / DAY_MS); // BATCH size
  while (uncovered > 0) {
    const foodId = cheapestFood(foodInv);                 // LOWEST-VALUE available (preserve gourmet)
    if (!foodId) break;                                   // dry → remaining days go hungry
    foodInv[foodId] -= 1; if (foodInv[foodId] <= 0) delete foodInv[foodId];
    fedUntil = (fedUntil || now) + DAY_MS * FOOD_LB_PER_DAY; // CATCH-UP: +1 day from the backlog
    ate++; foods.push(foodId); uncovered--;
  }
  return { fedUntil, ate, foods, hungryDays: hungryDaysFrom(fedUntil, now) };
}

/**
 * Apply the starvation debuff to a raw D&D ability-score map → a NEW score map with every stat
 * lowered by |starvationPenalty|, floored at STARVE_STAT_FLOOR (never 0/negative). Pure: does not
 * mutate the input. The ONE place combat math should fold hunger into a pawn's effective scores.
 * @param {{STR:number,DEX:number,CON:number,INT:number,WIS:number,CHA:number}} scores raw D&D scores
 */
export function applyStarvation(scores, pawnId, now = Date.now()) {
  const pen = starvationPenalty(pawnId, now);        // ≤ 0
  if (pen === 0 || !scores) return { ...scores };
  const out = {};
  for (const k in scores) out[k] = Math.max(STARVE_STAT_FLOOR, (scores[k] || 0) + pen);
  return out;
}

/**
 * AUTO-EAT from a food inventory: for each ELAPSED day the pawn isn't covered, consume 1 food unit
 * (oldest-first by inventory key order) to advance fedUntil by a day. Stops when the inventory runs
 * dry — any remaining elapsed days accrue as hungryDays (the debuff then bites). MUTATES `inv` in
 * place (caller persists it / spends the food token), and advances the pawn's fedUntil.
 *
 * CONSUMPTION MODEL (founder 2026-06-28):
 *   • LOWEST-VALUE FIRST — auto-eat burns the CHEAPEST food (by FOOD_MORALE value) before any
 *     valuable/morale food, so players keep their gourmet stores. Ascending FOOD_MORALE: salt/
 *     rations 0 → apple/honey 1 → cod/jerky/fish/crab 3 → ale/pork 4 → … (manual feed() still lets
 *     a player spend a SPECIFIC good food for the morale buff — that path is untouched).
 *   • ONCE PER DAY, BATCHED — a pawn eats exactly ONE food per elapsed day. N days elapsed → ONE
 *     batched catch-up of N foods (cheapest-first, so the N may span several cheap items).
 *
 * @param {string} pawnId
 * @param {Object.<string, number>} inv  the pawn's food inventory { foodId: qty } (mutated)
 * @param {number} [now]
 * @returns {{ate:number, foods:string[], hungryDays:number, fedUntil:number}} ate = days fed this call
 */
export function autoEat(pawnId, inv, now = Date.now()) {
  const st = read(); const p = st[pawnId] || { fedUntil: 0, morale: 0 };
  let ate = 0; const foods = [];
  // how many whole days are currently UNCOVERED (from fedUntil up to now) — the BATCH size
  let uncovered = (p.fedUntil || 0) >= now ? 0 : Math.ceil((now - (p.fedUntil || now)) / DAY_MS);
  while (uncovered > 0) {
    const foodId = cheapestFood(inv);                    // LOWEST-VALUE available food (preserve gourmet)
    if (!foodId) break;                                  // no food left → remaining days go hungry
    inv[foodId] -= 1; if (inv[foodId] <= 0) delete inv[foodId];
    feed(pawnId, foodId, now, true);                     // CATCH-UP: +1 day from the backlog, applies morale
    ate++; foods.push(foodId); uncovered--;
  }
  return { ate, foods, hungryDays: hungryDays(pawnId, now), fedUntil: read()[pawnId]?.fedUntil || 0 };
}

/**
 * Auto-eat a WHOLE CREW in ONE daily op (founder 2026-06-28: a ship's 100 crew eat once/day from the
 * ship's stores). Each pawn batch-catches-up cheapest-first (autoEat). Food source can be:
 *   • a SHARED store (one inventory object) → pass the same inv object → crew eats communally, and
 *     the SHARED inv is drained across all of them (a ship's mess). When the store runs dry, the
 *     remaining hungry pawns accrue their debuff. OR
 *   • PER-PAWN inventories → pass a map { [pawnId]: invForThatPawn }.
 * Detection: if `sharedOrPerPawnInv` has a key that IS one of the pawnIds, it's treated as PER-PAWN;
 * otherwise it's a SHARED store. Pass `{shared:true}`/`{perPawn:true}` in opts to force the mode.
 *
 * @param {string[]} pawnIds
 * @param {Object} sharedOrPerPawnInv  one shared { foodId:qty } OR a per-pawn map { pawnId:{foodId:qty} }
 * @param {number} [now]
 * @param {{shared?:boolean, perPawn?:boolean}} [opts]
 * @returns {{fed:number, totalAte:number, perPawn:Object.<string,{ate:number,foods:string[],hungryDays:number}>}}
 */
export function autoEatCrew(pawnIds, sharedOrPerPawnInv, now = Date.now(), opts = {}) {
  if (!Array.isArray(pawnIds)) throw new Error("autoEatCrew: pawnIds array required");
  const inv = sharedOrPerPawnInv || {};
  const ids = new Set(pawnIds.map(String));
  // mode: explicit opt wins; else PER-PAWN iff any inv key matches a pawnId, else SHARED store.
  const perPawn = opts.perPawn === true ? true
    : opts.shared === true ? false
    : Object.keys(inv).some((k) => ids.has(k));
  const out = { fed: 0, totalAte: 0, perPawn: {} };
  for (const pawnId of pawnIds) {
    const pawnInv = perPawn ? (inv[pawnId] || {}) : inv;   // SHARED: every pawn drains the SAME object
    const r = autoEat(pawnId, pawnInv, now);
    out.perPawn[pawnId] = { ate: r.ate, foods: r.foods, hungryDays: r.hungryDays };
    if (r.ate > 0) out.fed++;
    out.totalAte += r.ate;
  }
  return out;
}

/**
 * DEPRECATED (founder 2026-06-28 — UNIVERSAL EATING): there is no longer a "sheltered / free-eat"
 * context. EVERY pawn eats 1 food/day, town or wild. This shim now ALWAYS returns false so any
 * remaining caller of the old EXCLUDE model treats every pawn as needing to eat. Do not add new
 * callers — gate on isFed()/hungryDays() instead. Kept only so legacy imports don't break.
 */
export function isSheltered(_ctx = {}) { return false; }      // universal eating: nothing is free-fed
/**
 * Is the pawn USEFUL right now? Under universal eating an UNFED pawn is NOT removed from play — it
 * still works/fights, just WEAKER (the starvationPenalty all-stats debuff). So "useful" now means
 * fed-at-full-strength; an unfed pawn returns false to flag it's degraded, but combat still runs it.
 */
export function isUseful(pawnId, _ctx = {}, now = Date.now()) {
  return isFed(pawnId, now);             // fed → full strength; unfed → degraded (debuffed, still plays)
}
/** Under universal eating EVERY pawn needs rations, always. (Was: false when sheltered.) */
export function needsRations(_ctx = {}) { return true; }
/** Seconds of food left (0 = hungry now). */
export function fedSecsLeft(pawnId, now = Date.now()) { const p = read()[pawnId]; return p ? Math.max(0, Math.ceil(((p.fedUntil || 0) - now) / 1000)) : 0; }
/** Live morale (0–100), with hunger decay applied. */
export function morale(pawnId, now = Date.now()) { return settle(read()[pawnId], now); }

/** Morale → perks. Low morale slows work; high morale speeds work + adds a combat edge. */
export function moralePerk(m) {
  if (m >= 80) return { tier: "High Spirits", workXpMult: 1.25, combatBonus: 2 };
  if (m >= 50) return { tier: "Content",      workXpMult: 1.10, combatBonus: 1 };
  if (m >= 25) return { tier: "Steady",       workXpMult: 1.00, combatBonus: 0 };
  return { tier: "Grumbling", workXpMult: 0.90, combatBonus: 0 };       // hungry/unhappy crew drags
}
