// @ts-check
/**
 * monster-bridge.js — the ONE place that turns an encounter's monster *id* into a placed,
 * engine-ready BattleUnit, regardless of which bestiary it lives in. ADDITIVE: it does NOT
 * edit the engine or the bestiaries — it DELEGATES to each bestiary's own makeMonster()
 * (both already emit the full buildUnit() shape: qualified/engineStats/endowment/equipped/
 * base* + the ToT combat fields), so game.js showStats() and tot-engine combat never throw.
 *
 * WHY A BRIDGE
 *   area-encounters.js references monsters by snake_case id (bilge_rat, goblin_spearman,
 *   kraken_tentacle). The two bestiaries key them DIFFERENTLY:
 *     • bestiary-sea.js  SEA_BESTIARY      → Title-Case keys ("Bilge Rat", "Kraken Tentacle")
 *                        makeMonster(tpl, position, idx, groupN)
 *     • bestiary-dungeon.js DUNGEON_BESTIARY → snake_case keys (goblin_spear, hobgoblin_boss)
 *                        makeMonster(def, opts)
 *   resolveMonster() maps an encounter id → the right bestiary key (alias table + fallbacks),
 *   and makeMonsterById() dispatches to the matching maker with a unified call. Unknown ids
 *   THROW loudly (never a silent no-spawn).
 *
 * EXPORTS
 *   resolveMonster(id, bestiary?)         → { kind:"sea"|"dungeon", key, tpl }   (throws if unknown)
 *   makeMonsterById(id, position, opts?)  → one placed BattleUnit
 *   enemySpawnHexes(count, taken?)        → distinct on-board hexes on the enemy (right) side
 *   spawnMonsterGroup(refs, taken?)       → BattleUnit[] for the monster refs in an encounter group
 *
 * node --check clean. ESM. Imports the two bestiaries + the grid constants only.
 */

import { GRID_COLS, GRID_ROWS } from "./tot-engine.js";
import { SEA_BESTIARY, makeMonster as makeSeaMonster } from "./bestiary-sea.js";
import { DUNGEON_BESTIARY, makeMonster as makeDungeonMonster } from "./bestiary-dungeon.js";

// ── ID ALIASES: area-encounters snake_case id → bestiary key ─────────────────────────
// SEA keys are Title-Case; these encounter ids don't title-case cleanly, so map explicitly.
const SEA_ALIAS = {
  bilge_rat: "Bilge Rat",
  shark: "Shark",
  giant_crab: "Giant Crab",
  merfolk_raider: "Merfolk Raider",
  skeleton_boarder: "Skeleton Crew",   // area id ≠ bestiary key
  navy_marine: "Navy Marine",
  sea_serpent: "Sea Serpent",
  kraken_tentacle: "Kraken Tentacle",
  kraken_eye: "Kraken Eye",
  // ── CR0–5 sea fill (2026-07-01). Most title-case cleanly via titleFromId, but map the
  //    natural encounter ids explicitly so an encounter table never depends on the fallback. ──
  dolphin: "Dolphin",
  sea_cat: "Sea Cat",
  great_shark: "Great Shark",
  pirate_deckhand: "Pirate Deckhand",
  pirate_cutthroat: "Pirate Cutthroat",
};
// DUNGEON keys are snake_case already; only the spear name differs. The CR0–5 dungeon fill
// (cat, rat, bat, dretch, mephit_fire, brown_bear, gelatinous_cube, dragon_wyrmling_*, …)
// all resolve by their direct snake_case key via resolveMonster() step 2 — no alias needed.
const DUNGEON_ALIAS = {
  goblin_spearman: "goblin_spear",     // area id ≠ bestiary key
};

/** snake_case / kebab → "Title Case" (for a sea-bestiary key fallback). */
function titleFromId(id) {
  return String(id).split(/[_\s-]+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : "")).join(" ");
}

/**
 * Resolve an encounter monster id (+ optional bestiary hint "sea"|"dungeon") to the
 * bestiary it lives in, its real key, and its template. THROWS (never silent) if unknown.
 *
 * @param {string} monsterId
 * @param {"sea"|"dungeon"} [bestiary]
 * @returns {{ kind:"sea"|"dungeon", key:string, tpl:object }}
 */
export function resolveMonster(monsterId, bestiary) {
  const id = String(monsterId);
  // 1) explicit alias tables (the documented contract)
  if (SEA_ALIAS[id] && SEA_BESTIARY[SEA_ALIAS[id]]) return { kind: "sea", key: SEA_ALIAS[id], tpl: SEA_BESTIARY[SEA_ALIAS[id]] };
  if (DUNGEON_ALIAS[id] && DUNGEON_BESTIARY[DUNGEON_ALIAS[id]]) return { kind: "dungeon", key: DUNGEON_ALIAS[id], tpl: DUNGEON_BESTIARY[DUNGEON_ALIAS[id]] };
  // 2) direct key hit, honouring the bestiary hint when given
  if ((!bestiary || bestiary === "dungeon") && DUNGEON_BESTIARY[id]) return { kind: "dungeon", key: id, tpl: DUNGEON_BESTIARY[id] };
  if ((!bestiary || bestiary === "sea") && SEA_BESTIARY[id]) return { kind: "sea", key: id, tpl: SEA_BESTIARY[id] };
  // 3) fallbacks: Title-Case for sea, lower_snake for dungeon
  const tc = titleFromId(id);
  if ((!bestiary || bestiary === "sea") && SEA_BESTIARY[tc]) return { kind: "sea", key: tc, tpl: SEA_BESTIARY[tc] };
  const lc = id.toLowerCase();
  if ((!bestiary || bestiary === "dungeon") && DUNGEON_BESTIARY[lc]) return { kind: "dungeon", key: lc, tpl: DUNGEON_BESTIARY[lc] };
  throw new Error(
    `monster-bridge: cannot resolve monster "${monsterId}"${bestiary ? ` (bestiary "${bestiary}")` : ""}. ` +
    `Known sea: ${Object.keys(SEA_BESTIARY).join(", ")} | dungeon: ${Object.keys(DUNGEON_BESTIARY).slice(0, 8).join(", ")}…`,
  );
}

/**
 * Build ONE placed BattleUnit from an encounter monster id, delegating to the right
 * bestiary maker. Both makers already return the full display+combat shape; we only
 * place it, optionally rename/re-id it, and stamp the behaviour flags an encounter ref
 * carries (lead / severable / telegraph) so the §5 objective hooks can read them later.
 *
 * @param {string} monsterId
 * @param {{q:number,r:number}} position   MUST be unique on the board (use enemySpawnHexes)
 * @param {object} [opts] { bestiary, name, id, idx, groupN, lead, severable, telegraph, boss, hpBonus }
 * @returns {object} BattleUnit
 */
export function makeMonsterById(monsterId, position, opts = {}) {
  const { kind, key, tpl } = resolveMonster(monsterId, opts.bestiary);
  let unit;
  if (kind === "sea") {
    // sea maker: (tpl, position, idx, groupN) — numbers the name when groupN>1
    unit = makeSeaMonster(tpl, position, opts.idx || 0, opts.groupN || 1);
  } else {
    // dungeon maker: (def, opts) — accepts position/name/id/boss/hpBonus
    unit = makeDungeonMonster(tpl, {
      position, monsterId: key, id: opts.id, name: opts.name, boss: opts.boss, hpBonus: opts.hpBonus,
    });
  }
  // Stamp the canonical monsterId on BOTH kinds so the server kill-tracker can key on it. The
  // DUNGEON maker already sets unit.monsterId = its snake_case key (which is exactly the achievements
  // ROSTER id). The SEA maker sets NO monsterId, and the achievements ROSTER slugs sea keys
  // ("Bilge Rat" → "bilge_rat"). So for a sea foe we stamp the SLUGGED key — the SAME id the
  // KILL_LADDERS / bestiary lore are keyed under — or a slain sea monster would be untrackable.
  // We only set it when absent, so a dungeon unit's (already-correct) monsterId is never clobbered.
  if (!unit.monsterId) unit.monsterId = String(key).trim().toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (opts.name) unit.name = opts.name;
  if (opts.id) unit.id = opts.id;
  if (opts.lead) unit.lead = true;
  if (opts.severable) unit.severable = true;
  if (opts.telegraph && !unit.telegraph) unit.telegraph = tpl.telegraph || { tell: `${unit.name} winds up…`, windupRounds: 1 };
  return unit;
}

/**
 * Distinct, on-board enemy hexes packed on the right (enemy / water-edge) side of the deck,
 * spilling left and then scanning the whole board on overflow. Never returns a hex already in
 * `taken` (seed it with the player's hex) and never stacks two units — the only real N-vs-N
 * gotcha (game.js occupiedSet()/drawUnit() key off position; two on one hex breaks move math).
 *
 * BOARD-AWARE (P4/P5): pass the `grid` the fight will RENDER on so foes spread to the full width
 * of the actual board (a squad group uses the wider 16×9 deck; a duel stays 9×7). DEFAULTS to the
 * verbatim engine 9×7 so any caller that passes no grid — including the smoke test — is byte-for-
 * byte unchanged. tot-engine.js stays untouched (its GRID_COLS/GRID_ROWS are only the fallback).
 *
 * @param {number} count
 * @param {Set<string>} [taken]  "q,r" keys already occupied (mutated as hexes are claimed)
 * @param {{cols:number,rows:number}} [grid]  board size to spawn within (default engine 9×7)
 * @returns {{q:number,r:number}[]}
 */
export function enemySpawnHexes(count, taken = new Set(), grid) {
  const cols = Number.isFinite(grid && grid.cols) && grid.cols > 0 ? Math.floor(grid.cols) : GRID_COLS;
  const rows = Number.isFinite(grid && grid.rows) && grid.rows > 0 ? Math.floor(grid.rows) : GRID_ROWS;
  const out = [];
  const claim = (q, r) => {
    const k = `${q},${r}`;
    if (taken.has(k)) return;
    taken.add(k); out.push({ q, r });
  };
  // right-side columns first (enemy boarding / water-edge side), top-down by row
  const colList = [cols - 1, cols - 2, cols - 3, cols - 4].filter((q) => q >= 0);
  for (const q of colList) { for (let r = 0; r < rows && out.length < count; r++) claim(q, r); if (out.length >= count) break; }
  // overflow: scan the rest of the board so we ALWAYS return `count` distinct hexes
  for (let q = cols - 1; q >= 0 && out.length < count; q--)
    for (let r = 0; r < rows && out.length < count; r++) claim(q, r);
  return out;
}

/**
 * Spawn the MONSTER refs of an encounter group as placed units. Accepts the `group` array
 * shape area-encounters.js emits (each ref: { build, monsterId, bestiary, name, id, telegraph,
 * severable, lead, … }) — raider refs (build:"raider") are SKIPPED here (units.js builds those
 * from an endowment). Returns engine-ready BattleUnits on distinct hexes.
 *
 * @param {object[]} refs
 * @param {Set<string>} [taken]  occupied "q,r" keys (seed with the player hex)
 * @param {{cols:number,rows:number}} [grid]  board size to spawn within (default engine 9×7)
 * @returns {object[]}
 */
export function spawnMonsterGroup(refs, taken = new Set(), grid) {
  const list = (refs || []).filter((r) => (r.build || "monster") === "monster");
  const hexes = enemySpawnHexes(list.length, taken, grid);
  return list.map((r, i) => makeMonsterById(r.monsterId || r.id, hexes[i], {
    bestiary: r.bestiary, name: r.name, id: r.id, idx: i, groupN: list.length,
    telegraph: r.telegraph, severable: r.severable, lead: r.lead, boss: r.boss, hpBonus: r.hpBonus,
  }));
}
