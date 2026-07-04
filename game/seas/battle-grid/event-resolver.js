// @ts-check
/**
 * event-resolver.js — NON-COMBAT VOYAGE EVENTS for "Seize the Seas" (the choice + outcome layer).
 *
 * WHAT THIS IS
 *   area-encounters.js already ROLLS non-combat EVENT rows (calm seas, flotsam, peddler, convoy,
 *   black market, squall, storm wall, derelict, message bottle, whales, buried cache) and
 *   rollEncounter() can RETURN one as { type:"event", eventId, event, areaId, danger, map }. Until
 *   now those events were DATA ONLY — nothing resolved them. THIS file is the missing handler:
 *   it turns each rolled event into a PLAYER CHOICE with real, game-layer OUTCOMES.
 *
 *   AREA-MAP.md "still needs an engineer" item 5 is exactly this: "Event handlers (trade / hazard /
 *   salvage / board)". Terrain (the other half of that item) is already wired; this closes the rest.
 *
 * THE FOUR FAMILIES (each a CHOICE with consequences)
 *   • TRADE   (peddler / convoy / black market) → BUY a featured good or SELL your best cargo for
 *               GOLD. Black market pays a premium. Decline freely.
 *   • SALVAGE (flotsam) → take the wreckage: a little GOLD + a salvage material into your pack, or
 *               leave it untouched.
 *   • BOARD   (derelict hulk / buried cache) → RAID it for loot (gold + cargo) — but boarding a dead
 *               ship or digging a guarded cache can spring an AMBUSH (escalates to a real fight via
 *               the existing combat bridge), or pass it by.
 *   • WEATHER (squall / storm wall) → REEF the sails / HOLD FAST (safe, lose time) or RUN / PUSH
 *               THROUGH (save time, risk the deck: cargo swept overboard + repairs).
 *   Plus FLAVOR/LORE (calm seas, whales, message-in-a-bottle) — a beat of morale or a lore line.
 *
 * GAME-LAYER ONLY — localStorage, no chain, no network. It reads/writes the SAME stores the rest of
 * the seas game uses, so outcomes show up everywhere:
 *   • sts_gold        — the ONE in-game currency (a raw number; same key shipyard/rooms.html uses).
 *   • sts_inv_pawn    — the active pawn's pack [{id,qty}] (same key + shape hold.html uses; ids are
 *                       trade-good ids from hold.html TRADE_GOODS or gear ids from items.js ITEMS).
 *   • sts_voyage_state— a small voyage ledger { morale, fatigue, timeLostSecs, repairsPaid, log[] }.
 *   • sts_voyage_event— the PENDING event blob the map arms before showing the choice (mirrors the
 *                       sts_encounter pattern in encounter.js).
 *
 * DETERMINISTIC: pass your own rng (a function → [0,1)) to resolveEventChoice / rollVoyageEvent and
 * every branch (loot rolls, ambush chance, damage) is reproducible. mulberry32 is re-exported from
 * area-encounters.js for tests/demos. Throws LOUDLY on a bad event/choice id — never a silent no-op.
 *
 * NODE-SAFE: no DOM. localStorage is used when present; otherwise an in-memory store stands in (so
 * `node --check` + the smoke test run headless). node --check clean.
 */

import { EVENTS, AREAS, rollEncounter, mulberry32 } from "./area-encounters.js";

export { mulberry32 };

// ───────────────────────────────────────────────────────────────────────────────────────────
// STORE — raw-string localStorage (browser) or an in-memory map (Node). We keep RAW get/set so we
// control the on-disk format per key: sts_gold is a bare number string (what rooms.html reads);
// the JSON keys are JSON. setStore() lets the smoke test inject a clean, isolated store.
// ───────────────────────────────────────────────────────────────────────────────────────────
export const STORE_KEYS = {
  GOLD: "sts_gold",            // raw number string (shared with shipyard/rooms.html)
  PACK: "sts_inv_pawn",        // JSON [{id,qty}] (shared with hold.html)
  VOYAGE: "sts_voyage_state",  // JSON voyage ledger (new, additive)
  PENDING: "sts_voyage_event", // JSON pending-event blob (new, mirrors encounter.js sts_encounter)
};

function makeStore() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      const ls = localStorage;
      return {
        get: (k) => ls.getItem(k),
        set: (k, v) => ls.setItem(k, v),
        del: (k) => ls.removeItem(k),
      };
    }
  } catch (e) { /* fall through to memory (private mode / node) */ }
  const mem = Object.create(null);
  return {
    get: (k) => (k in mem ? mem[k] : null),
    set: (k, v) => { mem[k] = String(v); },
    del: (k) => { delete mem[k]; },
  };
}
let store = makeStore();

/** Inject a store (tests / a custom host). Must expose get/set/del of RAW strings. */
export function setStore(s) { if (s && s.get && s.set && s.del) store = s; }

function readRaw(key) { try { return store.get(key); } catch (e) { console.warn("event-resolver store get failed:", key, e); return null; } }
function writeRaw(key, v) { try { store.set(key, v); } catch (e) { console.warn("event-resolver store set failed:", key, e); } }
function readJSON(key, fallback) {
  const raw = readRaw(key);
  if (raw == null) return fallback;
  try { const v = JSON.parse(raw); return v == null ? fallback : v; }
  catch (e) { console.warn("event-resolver JSON parse failed:", key, e); return fallback; }   // visible, not silent
}
function writeJSON(key, v) { writeRaw(key, JSON.stringify(v)); }

// ── GOLD (raw number) ──────────────────────────────────────────────────────────────────────
/** Current game-layer gold balance (integer ≥ 0). */
export function getGold() { const n = Number(readRaw(STORE_KEYS.GOLD) || 0); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; }
function setGold(n) { writeRaw(STORE_KEYS.GOLD, String(Math.max(0, Math.floor(n)))); }
/** Add (or subtract) gold, clamped at 0. Returns the new balance. */
export function addGold(delta) { const v = getGold() + Math.floor(delta || 0); setGold(v); return getGold(); }

// ── PACK ({id,qty}[]) — mirrors hold.html add/remove EXACTLY so the cargo hold reads it back. ──
/** The active pawn's pack as [{id,qty}] (a fresh array copy). */
export function getPack() { const a = readJSON(STORE_KEYS.PACK, []); return Array.isArray(a) ? a : []; }
function writePack(list) { writeJSON(STORE_KEYS.PACK, list.filter((e) => e && e.qty > 0)); }
function packAdd(id, n = 1) { const list = getPack(); const e = list.find((x) => x.id === id); if (e) e.qty += n; else list.push({ id, qty: n }); writePack(list); }
function packRemove(id, n = 1) { const list = getPack(); const e = list.find((x) => x.id === id); if (!e) return 0; const took = Math.min(e.qty, n); e.qty -= took; writePack(list); return took; }
/** How many of `id` are in the pack. */
export function packCount(id) { const e = getPack().find((x) => x.id === id); return e ? e.qty : 0; }

// ── VOYAGE LEDGER — morale / fatigue / time-lost / repairs + a short rolling log. ──────────────
function blankVoyage() { return { morale: 0, fatigue: 0, timeLostSecs: 0, repairsPaid: 0, log: [], updatedAt: 0 }; }
/** The voyage ledger (a fresh copy). */
export function getVoyageState() {
  const s = readJSON(STORE_KEYS.VOYAGE, null);
  if (!s || typeof s !== "object") return blankVoyage();
  return { ...blankVoyage(), ...s, log: Array.isArray(s.log) ? s.log : [] };
}
function patchVoyage(patch, logLine) {
  const s = getVoyageState();
  if (patch) {
    if (patch.morale) s.morale += patch.morale;
    if (patch.fatigue) s.fatigue += patch.fatigue;
    if (patch.timeLostSecs) s.timeLostSecs += patch.timeLostSecs;
    if (patch.repairsPaid) s.repairsPaid += patch.repairsPaid;
  }
  if (logLine) { s.log.unshift({ t: Date.now(), text: logLine }); s.log = s.log.slice(0, 30); }
  s.updatedAt = Date.now();
  writeJSON(STORE_KEYS.VOYAGE, s);
  return s;
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// RNG helpers (deterministic when a seeded rng is supplied)
// ───────────────────────────────────────────────────────────────────────────────────────────
function rf(rng) { const v = rng(); if (typeof v !== "number" || Number.isNaN(v)) throw new Error("event-resolver: rng() must return a number in [0,1)."); return v <= 0 ? 0 : v >= 1 ? 0.9999999 : v; }
function ri(min, max, rng) { if (max < min) { const t = min; min = max; max = t; } return min + Math.floor(rf(rng) * (max - min + 1)); }
function pick(arr, rng) { return arr[ri(0, arr.length - 1, rng)]; }

// ───────────────────────────────────────────────────────────────────────────────────────────
// TUNING — sensible defaults; pure data, safe to edit. All gold/qty are GAME-LAYER (no chain).
// ───────────────────────────────────────────────────────────────────────────────────────────
export const TUNING = {
  // SALVAGE (flotsam)
  salvageGold: [5, 20],
  salvageItems: ["timber", "iron_ingot", "silk_bolt", "grain_sack", "salt_fish"],
  salvageQty: [1, 2],
  // BOARD — derelict hulk
  derelictGold: [20, 60],
  derelictLoot: ["spice_crate", "silk_bolt", "iron_ingot", "tea_chest"],
  derelictAmbushChance: 0.35,
  // BOARD — buried cache
  cacheGold: [40, 120],
  cacheLoot: ["spice_crate", "tea_chest", "silk_bolt", "rum_barrel"],
  cacheAmbushChance: 0.30,
  // WEATHER
  reefTimeLostSecs: 8 * 3600,    // reefing the sails costs ~one hex (8h) of progress (a tracked stat)
  holdTimeLostSecs: 16 * 3600,   // holding fast through a storm wall costs ~two hexes
  runDamageChance: 0.5,          // running before a squall risks a soaking
  pushDamageChance: 0.6,         // pushing the storm wall risks worse
  damageCargoLoss: [1, 2],       // items swept overboard on a bad weather roll
  repairGold: [10, 30],          // repairs after a knockdown
  runFatigue: 1,
  // FLAVOR / LORE
  whalesMorale: 2,
  bottleMorale: 1,
  calmMorale: 0,
};

// TRADE — game-layer prices in GOLD per trade-good id (mirrors hold.html TRADE_GOODS ids).
// buy = what the player PAYS to acquire one; sell = what the player RECEIVES for one.
export const TRADE_PRICES = {
  rum_barrel:  { buy: 60, sell: 40 },
  spice_crate: { buy: 80, sell: 55 },
  silk_bolt:   { buy: 50, sell: 35 },
  timber:      { buy: 20, sell: 12 },
  iron_ingot:  { buy: 30, sell: 20 },
  grain_sack:  { buy: 18, sell: 11 },
  salt_fish:   { buy: 16, sell: 10 },
  tea_chest:   { buy: 70, sell: 48 },
};
const GOOD_NAMES = {
  rum_barrel: "Barrel of Rum", spice_crate: "Crate of Spice", silk_bolt: "Bolt of Silk", timber: "Timber",
  iron_ingot: "Iron Ingot", grain_sack: "Sack of Grain", salt_fish: "Salt Fish", tea_chest: "Chest of Tea",
};
function goodName(id) { return GOOD_NAMES[id] || id; }

// Per shop tier: the FEATURED good offered to buy + a price multiplier on what they pay you to sell.
const SHOPS = {
  small:       { featured: "silk_bolt",   buyMult: 1.0,  sellMult: 1.0,  label: "Peddler's Dhow" },
  large:       { featured: "spice_crate", buyMult: 0.95, sellMult: 1.1,  label: "Merchant Convoy" },
  blackmarket: { featured: "rum_barrel",  buyMult: 1.0,  sellMult: 1.5,  label: "Black-Market Buyer", contraband: true },
};

// ───────────────────────────────────────────────────────────────────────────────────────────
// NORMALIZE — accept a rollEncounter event result, a raw EVENTS entry, or an eventId string.
// Computes a stable shape { id, name, kind, sub, text, areaId, danger } the choice builder reads.
// ───────────────────────────────────────────────────────────────────────────────────────────
function eventDef(id) { const e = EVENTS[id]; if (!e) throw new Error(`event-resolver: unknown event "${id}" (known: ${Object.keys(EVENTS).join(", ")}).`); return e; }

function normalizeEvent(input) {
  let id, areaId = null, danger = null, mapId = null;
  if (typeof input === "string") { id = input; }
  else if (input && typeof input === "object") {
    if (input.type === "event") { id = input.eventId; areaId = input.areaId ?? null; danger = input.danger ?? null; mapId = input.map ?? null; }
    else if (input.id && EVENTS[input.id]) { id = input.id; }
    else if (input.eventId) { id = input.eventId; areaId = input.areaId ?? null; danger = input.danger ?? null; mapId = input.map ?? null; }
  }
  if (!id) throw new Error("event-resolver: could not read an eventId from the input.");
  const e = eventDef(id);
  // sub-kind from the EVENTS hook fields (shop / hazard / explore / loot).
  const sub = e.shop || e.hazard || e.explore || e.loot || (e.lore ? "lore" : null) || (e.buff ? "buff" : null) || null;
  return { id, name: e.name, kind: e.kind, sub, text: e.text, areaId, danger, map: mapId, raw: e };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// CHOICES — the player-facing options per event. Read-only; pure (no store writes). Each option:
// { id, label, hint, disabled?, reason? }. disabled options still resolve (to a clear "couldn't"
// outcome) so a wired UI can grey them without special-casing.
// ───────────────────────────────────────────────────────────────────────────────────────────
function bestSellable(shopTier) {
  const shop = SHOPS[shopTier] || SHOPS.small;
  let best = null;
  for (const e of getPack()) {
    const p = TRADE_PRICES[e.id];
    if (!p) continue;
    const px = Math.round(p.sell * shop.sellMult);
    if (!best || px > best.price) best = { id: e.id, price: px, qty: e.qty };
  }
  return best;
}

function tradeChoices(ev) {
  const shopTier = ev.sub && SHOPS[ev.sub] ? ev.sub : "small";
  const shop = SHOPS[shopTier];
  const featured = shop.featured;
  const buyPrice = Math.round((TRADE_PRICES[featured]?.buy || 0) * shop.buyMult);
  const gold = getGold();
  const sell = bestSellable(shopTier);
  const canBuy = gold >= buyPrice;
  return [
    { id: "buy",  label: `Buy ${goodName(featured)} — ${buyPrice}g`, hint: shop.contraband ? "Rare contraband, cash up front" : "Add it to your pack",
      disabled: !canBuy, reason: canBuy ? null : `Need ${buyPrice}g (you have ${gold}g)`, meta: { good: featured, price: buyPrice } },
    { id: "sell", label: sell ? `Sell ${goodName(sell.id)} — ${sell.price}g` : "Sell (nothing aboard)", hint: shop.contraband ? "They pay a premium" : "Turn cargo into coin",
      disabled: !sell, reason: sell ? null : "No tradeable cargo in your pack", meta: sell ? { good: sell.id, price: sell.price } : null },
    { id: "leave", label: "Wave them off", hint: "Trade nothing, sail on" },
  ];
}

/** The choices for an event (normalized input accepted). Pure read-only render model. */
export function eventChoices(input) {
  const ev = normalizeEvent(input);
  switch (ev.kind) {
    case "trade": return tradeChoices(ev);
    case "loot": return [
      { id: "take",  label: "Salvage the wreckage", hint: "Rope, planks & a few coins" },
      { id: "leave", label: "Leave it adrift", hint: "Touch nothing, hold your course" },
    ];
    case "explore": {
      const dig = ev.sub === "cache";
      return [
        { id: dig ? "dig" : "board", label: dig ? "Dig for the cache" : "Board the hulk", hint: "Raid it for loot — there may be guards" },
        { id: "pass", label: "Pass it by", hint: "Not worth the risk" },
      ];
    }
    case "hazard": {
      const wave = ev.sub === "wave";
      return wave ? [
        { id: "hold", label: "Hold fast",     hint: "Ride it out — slow but safe" },
        { id: "push", label: "Push through",  hint: "Save time, risk the deck" },
      ] : [
        { id: "reef", label: "Reef the sails", hint: "Lose time, keep your footing" },
        { id: "run",  label: "Run before it",  hint: "Save time, risk a soaking" },
      ];
    }
    case "lore": return [
      { id: "read",   label: "Open the bottle", hint: "Read what's inside" },
      { id: "ignore", label: "Let it bob past", hint: "Leave it be" },
    ];
    case "flavor":
    default: return [
      { id: "continue", label: "Sail on", hint: "Nothing to do but enjoy it" },
    ];
  }
}

/** Full render model: the event + its choices + the live purse, for a deck/map panel. */
export function buildEventModel(input) {
  const ev = normalizeEvent(input);
  return {
    id: ev.id, name: ev.name, kind: ev.kind, sub: ev.sub, text: ev.text,
    areaId: ev.areaId, danger: ev.danger, map: ev.map,
    choices: eventChoices(ev),
    gold: getGold(),
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// RESOLVE — apply a chosen option's outcome to the stores. Deterministic with opts.rng. Returns
//   { ok, eventId, choiceId, outcome:{ text, goldDelta, items:[{id,qty,dir}], morale, fatigue,
//     timeLostSecs, repairs }, escalate:{ reason, areaId, danger } | null, gold, state }.
// escalate (board/dig ambush) is a DESCRIPTOR only — the caller rolls the fight via rollAmbush()
// and the existing combat bridge, so NO combat code lives here.
// ───────────────────────────────────────────────────────────────────────────────────────────
function commit(parts) {
  const items = [];
  let goldDelta = 0;
  if (parts.goldDelta) { addGold(parts.goldDelta); goldDelta = parts.goldDelta; }
  if (Array.isArray(parts.items)) {
    for (const it of parts.items) {
      if (it.dir === "remove") { const took = packRemove(it.id, it.qty || 1); if (took) items.push({ id: it.id, qty: took, dir: "remove" }); }
      else { packAdd(it.id, it.qty || 1); items.push({ id: it.id, qty: it.qty || 1, dir: "add" }); }
    }
  }
  const vp = { morale: parts.morale || 0, fatigue: parts.fatigue || 0, timeLostSecs: parts.timeLostSecs || 0, repairsPaid: parts.repairs || 0 };
  const state = patchVoyage(vp, parts.text);
  return {
    text: parts.text || "",
    goldDelta, items,
    morale: vp.morale, fatigue: vp.fatigue, timeLostSecs: vp.timeLostSecs, repairs: vp.repairsPaid,
    state,
  };
}

function resolveTrade(ev, choiceId, rng) {
  const shopTier = ev.sub && SHOPS[ev.sub] ? ev.sub : "small";
  const shop = SHOPS[shopTier];
  if (choiceId === "buy") {
    const featured = shop.featured;
    const price = Math.round((TRADE_PRICES[featured]?.buy || 0) * shop.buyMult);
    if (getGold() < price) return { parts: { text: `Not enough gold for ${goodName(featured)} (need ${price}g).`, goldDelta: 0 } };
    return { parts: { text: `Bought ${goodName(featured)} for ${price}g.`, goldDelta: -price, items: [{ id: featured, qty: 1, dir: "add" }] } };
  }
  if (choiceId === "sell") {
    const best = bestSellable(shopTier);
    if (!best) return { parts: { text: "Nothing in your pack worth trading.", goldDelta: 0 } };
    return { parts: { text: `Sold ${goodName(best.id)} for ${best.price}g${shop.contraband ? " (premium)" : ""}.`, goldDelta: best.price, items: [{ id: best.id, qty: 1, dir: "remove" }] } };
  }
  return { parts: { text: "You wave the trader off and sail on." } };
}

function resolveLoot(ev, choiceId, rng) {
  if (choiceId !== "take") return { parts: { text: "You leave the flotsam adrift." } };
  const gold = ri(TUNING.salvageGold[0], TUNING.salvageGold[1], rng);
  const item = pick(TUNING.salvageItems, rng);
  const qty = ri(TUNING.salvageQty[0], TUNING.salvageQty[1], rng);
  return { parts: { text: `Salvaged ${qty}× ${goodName(item)} and ${gold}g from the wreckage.`, goldDelta: gold, items: [{ id: item, qty, dir: "add" }] } };
}

function resolveExplore(ev, choiceId, rng) {
  const dig = ev.sub === "cache";
  if (choiceId === "pass") return { parts: { text: dig ? "You leave the cache buried." : "You give the hulk a wide berth." } };
  const ambushChance = dig ? TUNING.cacheAmbushChance : TUNING.derelictAmbushChance;
  if (rf(rng) < ambushChance) {
    // Sprung a guard. NO loot; the caller escalates to a real fight via rollAmbush().
    const text = dig ? "You dig in — and the cache's guardians burst from the sand!" : "You climb aboard — and the hulk's crew were only playing dead!";
    return { parts: { text, fatigue: 1 }, escalate: { reason: dig ? "cache-guardians" : "derelict-ambush", areaId: ev.areaId, danger: ev.danger } };
  }
  const gold = dig ? ri(TUNING.cacheGold[0], TUNING.cacheGold[1], rng) : ri(TUNING.derelictGold[0], TUNING.derelictGold[1], rng);
  const item = dig ? pick(TUNING.cacheLoot, rng) : pick(TUNING.derelictLoot, rng);
  return { parts: { text: `${dig ? "The cache yields" : "You strip the hulk of"} ${goodName(item)} and ${gold}g.`, goldDelta: gold, items: [{ id: item, qty: 1, dir: "add" }] } };
}

function resolveHazard(ev, choiceId, rng) {
  const wave = ev.sub === "wave";
  // SAFE arm: lose time (a tracked stat — the real voyage clock lives in location.js, untouched).
  if (choiceId === "reef" || choiceId === "hold") {
    const lost = wave ? TUNING.holdTimeLostSecs : TUNING.reefTimeLostSecs;
    return { parts: { text: wave ? "You hold fast and let the storm wall pass — slow, but the deck stays dry." : "You reef the sails and ride out the squall — time lost, footing kept.", timeLostSecs: lost } };
  }
  // RISKY arm: save the time, but maybe take damage (cargo overboard + repairs + fatigue).
  const damageChance = wave ? TUNING.pushDamageChance : TUNING.runDamageChance;
  if (rf(rng) < damageChance) {
    const pack = getPack().filter((e) => e.qty > 0);
    const items = [];
    if (pack.length) {
      const loseN = ri(TUNING.damageCargoLoss[0], TUNING.damageCargoLoss[1], rng);
      for (let i = 0; i < loseN; i++) { const e = pick(getPack().filter((x) => x.qty > 0), rng); if (e) items.push({ id: e.id, qty: 1, dir: "remove" }); }
    }
    const repairs = ri(TUNING.repairGold[0], TUNING.repairGold[1], rng);
    const lostMsg = items.length ? ` ${items.length} crate(s) go overboard and` : " The hull takes a beating and";
    return { parts: { text: `You drive on through the weather.${lostMsg} ${repairs}g of repairs.`, items, goldDelta: -repairs, repairs, fatigue: TUNING.runFatigue } };
  }
  return { parts: { text: wave ? "You punch through the storm wall clean — time saved, no harm done." : "You run before the squall and slip past untouched.", fatigue: TUNING.runFatigue } };
}

function resolveLoreFlavor(ev, choiceId, rng) {
  if (ev.kind === "lore") {
    if (choiceId === "ignore") return { parts: { text: "You let the bottle bob away unopened." } };
    return { parts: { text: "Inside: a brittle map-fragment and a warning in a stranger's hand. The crew murmurs.", morale: TUNING.bottleMorale } };
  }
  // flavor (calm seas / whales)
  const morale = ev.id === "pod_of_whales" ? TUNING.whalesMorale : TUNING.calmMorale;
  return { parts: { text: ev.id === "pod_of_whales" ? "The pod breaches alongside; the crew's spirits lift." : "Fair winds and a quiet watch. You sail on.", morale } };
}

/**
 * Resolve a player's CHOICE for an event. Applies the outcome to the game-layer stores.
 * @param {string|object} input  an eventId, a raw EVENTS entry, or a rollEncounter event result.
 * @param {string} choiceId      one of eventChoices(input)[].id
 * @param {{ rng?: () => number }} [opts]
 * @returns {{ ok:boolean, eventId:string, choiceId:string, outcome:object, escalate:object|null, gold:number, state:object }}
 */
export function resolveEventChoice(input, choiceId, opts = {}) {
  const ev = normalizeEvent(input);
  const valid = eventChoices(ev).some((c) => c.id === choiceId);
  if (!valid) throw new Error(`event-resolver: choice "${choiceId}" is not valid for event "${ev.id}" (valid: ${eventChoices(ev).map((c) => c.id).join(", ")}).`);
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;

  let res;
  switch (ev.kind) {
    case "trade":   res = resolveTrade(ev, choiceId, rng); break;
    case "loot":    res = resolveLoot(ev, choiceId, rng); break;
    case "explore": res = resolveExplore(ev, choiceId, rng); break;
    case "hazard":  res = resolveHazard(ev, choiceId, rng); break;
    case "lore":
    case "flavor":
    default:        res = resolveLoreFlavor(ev, choiceId, rng); break;
  }
  const outcome = commit(res.parts);
  return { ok: true, eventId: ev.id, choiceId, outcome, escalate: res.escalate || null, gold: getGold(), state: outcome.state };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// ROLLERS — wrap area-encounters.rollEncounter() so the map can get a guaranteed EVENT (peaceful
// leg interlude) or a guaranteed COMBAT (a board/dig ambush). Both are bounded + deterministic.
// ───────────────────────────────────────────────────────────────────────────────────────────
function eventFromRow(areaId, danger, eventId) {
  const area = AREAS[areaId];
  const d = Number.isFinite(danger) ? danger : (area ? area.dangerTier : 0);
  const e = eventDef(eventId);
  return { type: "event", areaId, area: area ? area.name : areaId, danger: d, map: area ? area.map : null, eventId, event: { id: eventId, ...e } };
}

/** Roll a non-combat EVENT for an area (uses rollEncounter; loops past combat rows, then falls back
 *  to a guaranteed event row). Returns a { type:"event", … } result, or null if the area has none. */
export function rollVoyageEvent(areaId, danger, rng = Math.random) {
  const area = AREAS[areaId];
  if (!area) throw new Error(`event-resolver: unknown area "${areaId}" (known: ${Object.keys(AREAS).join(", ")}).`);
  for (let i = 0; i < 16; i++) { const r = rollEncounter(areaId, danger, rng); if (r && r.type === "event") return r; }
  const row = area.table.find((x) => x.kind === "event" && (x.minDanger ?? 0) <= (Number.isFinite(danger) ? danger : area.dangerTier));
  return row ? eventFromRow(areaId, danger, row.eventId) : null;
}

/** Roll a COMBAT encounter for an area (uses rollEncounter; loops past event rows, then falls back
 *  to a guaranteed combat row). Returns a { type:"pve", group:[…], … } result, or null if none.
 *  Used to realise a board/dig AMBUSH through the existing encounter.js → battle-grid bridge. */
export function rollAmbush(areaId, danger, rng = Math.random) {
  const area = AREAS[areaId];
  if (!area) throw new Error(`event-resolver: unknown area "${areaId}" (known: ${Object.keys(AREAS).join(", ")}).`);
  for (let i = 0; i < 16; i++) { const r = rollEncounter(areaId, danger, rng); if (r && r.type === "pve") return r; }
  // Fallback: directly expand the first allowed combat row via a forced rollEncounter pass.
  const d = Number.isFinite(danger) ? danger : area.dangerTier;
  for (let s = 1; s <= 64; s++) { const r = rollEncounter(areaId, d, mulberry32(s)); if (r && r.type === "pve") return r; }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// PENDING-EVENT ARMING — mirrors encounter.js's sts_encounter pattern so the map can arm an event,
// navigate/render the choice, then resolve + clear. (The map can also just hold it in memory; this
// is here for parity + cross-page resume.)
// ───────────────────────────────────────────────────────────────────────────────────────────
/** Arm a rolled event as the pending voyage event (with where to return). Returns the stored blob. */
export function armVoyageEvent(input, opts = {}) {
  const ev = normalizeEvent(input);
  const blob = {
    active: true, status: "pending", eventId: ev.id, name: ev.name, kind: ev.kind, sub: ev.sub, text: ev.text,
    areaId: ev.areaId, danger: ev.danger, map: ev.map,
    returnTo: opts.returnTo ?? null, startedAt: Date.now(),
  };
  writeJSON(STORE_KEYS.PENDING, blob);
  return blob;
}
/** Read the pending voyage event (or null). */
export function readVoyageEvent() { const b = readJSON(STORE_KEYS.PENDING, null); return b && b.active ? b : null; }
/** Clear the pending voyage event. */
export function clearVoyageEvent() { try { store.del(STORE_KEYS.PENDING); } catch (e) { console.warn("event-resolver clear failed:", e); } }

/** QA/dev: wipe the game-layer voyage ledger + pending event (does NOT touch gold or the pack). */
export function resetVoyageLedger() { try { store.del(STORE_KEYS.VOYAGE); store.del(STORE_KEYS.PENDING); } catch (e) { console.warn("event-resolver reset failed:", e); } }
