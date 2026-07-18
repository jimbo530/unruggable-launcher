// @ts-check
// forage.js — WILD GATHERING (founder 2026-06-26: "work an empty grass or forest space to get some
// of these tokens when out on an adventure"). A pawn standing on a forageable WILD hex (forest /
// plains / water — NOT a town) can FORAGE/HUNT to gather raw goods: berries, fish, and game meat.
//
// This is the supply faucet for the GATED wild-economy: forageables (and everything crafted FROM
// them — wine, RP goods, player-made magic items) have IN-GAME-ONLY supply. You don't buy berries,
// you pick them; you don't buy wine, someone presses it from berries someone picked. Forage output
// also FEEDS the crew on expedition (upkeep food), closing the rations-at-sea loop.
//
// Game-layer (localStorage), injectable now+rng like jobs-loop.js — the on-chain token grant
// (treasury → pawn owner, gated) wires in later via the relayer. Mirrors location.js/jobs-loop.js.

// What each WILD terrain yields. forest = berries + big game; plains = berries + boar; water = fish.
// (Matches deploy-forageables.js terrain tags + world-features.js TERRAIN kinds.)
export const FORAGE_TABLES = {
  forest: ["blackberry", "blueberry", "elk", "bear"],
  plains: ["blackberry", "blueberry", "pork"],
  water:  ["fish"],            // open ocean → fishing
  sand:   ["crab"],            // sandy beach → crab collecting (founder 2026-06-26)
};
export const FORAGE_COOLDOWN_MS = 30_000;   // dev-scaled; a pawn can gather again after this
const YIELD_MIN = 1, YIELD_MAX = 3;          // units gathered per successful forage

const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
})();
const KEY = "sts_forage"; // { [pawnId]: { lastAt } }
function read() { try { return JSON.parse(store.getItem(KEY) || "{}") || {}; } catch (e) { console.warn("[forage] bad JSON:", e); return {}; } }
function write(v) { store.setItem(KEY, JSON.stringify(v)); }

/** Is this terrain forageable at all? (towns/mountains/sand are not.) */
export function canForage(terrain) { return Array.isArray(FORAGE_TABLES[terrain]) && FORAGE_TABLES[terrain].length > 0; }
/** What a hex of this terrain can yield. */
export function forageTable(terrain) { return FORAGE_TABLES[terrain] ? [...FORAGE_TABLES[terrain]] : []; }

/** Seconds until this pawn can forage again (0 = ready). */
export function forageCooldownLeft(pawnId, now = Date.now()) {
  const last = read()[pawnId]?.lastAt || 0;
  return Math.max(0, Math.ceil((last + FORAGE_COOLDOWN_MS - now) / 1000));
}

/**
 * Is the pawn actively FORAGING (within the post-gather work window)? Foraging counts as WORK
 * (founder 2026-06-26: "make while foraging excluded like any other job"), so callers OR this into
 * upkeep.isUseful's `working` flag → a forager is sheltered (no rations) like any employed pawn.
 */
export function isForaging(pawnId, now = Date.now()) { return forageCooldownLeft(pawnId, now) > 0; }

/**
 * FORAGE/HUNT the hex the pawn is standing on. Returns { item, qty } on success.
 * @param {string} pawnId
 * @param {string} terrain   terrain kind at the pawn's hex (from world-features.terrainAt)
 * @param {{now?: number, rng?: () => number}} [opts]  rng injectable for tests (default Math.random)
 * @throws if the terrain isn't forageable or the pawn is still on cooldown — NO silent failures.
 */
export function forage(pawnId, terrain, opts = {}) {
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? Math.random;
  const table = FORAGE_TABLES[terrain];
  if (!table || !table.length) throw new Error(`forage: nothing to gather on ${terrain} (try forest/plains/water)`);
  const left = forageCooldownLeft(pawnId, now);
  if (left > 0) throw new Error(`forage: ${pawnId} still resting (${left}s)`);

  const item = table[Math.floor(rng() * table.length) % table.length];
  const qty = YIELD_MIN + Math.floor(rng() * (YIELD_MAX - YIELD_MIN + 1));
  const st = read(); st[pawnId] = { lastAt: now }; write(st);
  // NOTE: caller credits `qty` of `item` to the pawn's owner (game-layer inventory now; gated
  // on-chain grant from treasury later). Forageables are food → can be fed via upkeep.feed().
  return { pawnId, item, qty, terrain };
}
