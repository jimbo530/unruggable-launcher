// @ts-check
/**
 * los.js — P8: VISION · LINE-OF-SIGHT · FOG OF WAR. "Your crew are your eyes."
 *
 * ADDITIVE + DATA-DRIVEN. PURE / node-safe: no DOM, no localStorage, no chain, no dice. It
 * answers three questions the battle driver (game.js) + the attack chokepoint (combat-helpers.js)
 * wire in WITHOUT touching the verbatim engine:
 *
 *   • hexLine(a, b)              → the hex walk between two hexes (cube-lerp + cube-round), built
 *                                  on the SAME odd-q flat-top math tot-engine.js / grid-config.js
 *                                  use (toCube is replicated here byte-for-byte so distances agree).
 *   • losClear(from, to, ix)    → FALSE when a WALL / blocking terrain tile interrupts the line
 *                                  (reuses terrain-effects.isBlocked + the maps/index.js terrain
 *                                  index). ENDPOINTS never block: you always see your own hex and
 *                                  the wall face / target hex itself — only tiles BETWEEN block.
 *   • visibleHexes(units,side,ix)→ the fog-of-war reveal set for a side = the UNION over that side's
 *                                  CONSCIOUS pawns of their LOS-limited sight. Because it's a UNION,
 *                                  spreading pawns reveals more — one crew on each ship lights that
 *                                  ship (the founder payoff) emerges with NO special-case code.
 *
 * SIGHT RANGE (per-unit, extendable):
 *   sightRangeOf(unit) = (unit.baseSightRange ?? SIGHT_BASE) + sightBonusOf(unit), min 1.
 *   sightBonusOf reads, data-driven, any of: unit.sightBonus, unit.stats.sight, and a `sight` mod
 *   on ANY equipped item — so a SPYGLASS / relic trinket lights up the moment its gear data carries
 *   `mods:{ sight:N }` (gear-ext.js), with zero code change here. A keen-eyed monster can also just
 *   set unit.baseSightRange directly. Default ~4 hexes.
 *
 * RANGED LINE-OF-SIGHT (the chokepoint completes the cut "cover blocks ranged line" rule):
 *   combat-helpers.js calls losClear() so a shot/spell at distance ≥ 2 cannot fire THROUGH a wall.
 *   Melee (adjacent, distance 1) is unaffected — there is no hex between two adjacent hexes.
 *
 * Back-compat: a missing/empty terrain index (every duel + training fight) → losClear is always
 * true and fog never engages, so the 9×7 board behaves EXACTLY as before. node --check clean. ESM.
 */

import { hexDistance, isConscious } from "./tot-engine.js";
import { allHexes, GRID, GRID_PRESETS } from "./grid-config.js";
import { isBlocked } from "./terrain-effects.js";
import { ITEMS, SLOTS } from "./items.js";

const K = (h) => `${h.q},${h.r}`;

// ── odd-q offset ↔ cube — REPLICATED from tot-engine.js toCube() so the line walk lands on the
// SAME hexes the engine's hexDistance measures (the port is OFF-LIMITS, so we copy, not import). ──
function toCube(h) {
  const x = h.q;
  const z = h.r - (h.q - (h.q & 1)) / 2;
  return { x, y: -x - z, z };
}
function fromCube(c) {
  return { q: c.x, r: c.z + (c.x - (c.x & 1)) / 2 };
}
/** Round fractional cube coords to the nearest hex (keeps x+y+z=0). */
function cubeRound(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

/**
 * hexLine — the ordered list of hexes from `a` to `b` inclusive (length = hexDistance+1). Cube
 * linear-interpolation + cube rounding, with a tiny symmetric epsilon nudge (sums to 0, so the
 * cube constraint is preserved) that breaks vertex-grazing ties consistently (Red Blob Games).
 *
 * @param {{q:number,r:number}} a
 * @param {{q:number,r:number}} b
 * @returns {{q:number,r:number}[]}
 */
export function hexLine(a, b) {
  const N = hexDistance(a, b);
  const ac = toCube(a), bc = toCube(b);
  const out = [];
  const E = 1e-6;                       // (E, 2E, -3E) sums to 0 → keeps x+y+z=0 while de-tying
  for (let i = 0; i <= N; i++) {
    const t = N === 0 ? 0 : i / N;
    const x = ac.x + (bc.x - ac.x) * t + E;
    const y = ac.y + (bc.y - ac.y) * t + 2 * E;
    const z = ac.z + (bc.z - ac.z) * t - 3 * E;
    out.push(fromCube(cubeRound(x, y, z)));
  }
  return out;
}

/**
 * losClear — is the line of sight from `from` to `to` UNBROKEN by a wall/blocking tile? Only tiles
 * STRICTLY BETWEEN the endpoints block: you always see your own hex (from) and the target/wall face
 * (to). A null/empty terrain index (duels/training) → always clear (no regression).
 *
 * @param {{q:number,r:number}} from
 * @param {{q:number,r:number}} to
 * @param {Map<string,any>|null|undefined} terrainIx  maps/index.js terrainIndex (the "q,r"→cell Map)
 * @returns {boolean}
 */
export function losClear(from, to, terrainIx) {
  if (!terrainIx || !from || !to) return true;
  const line = hexLine(from, to);
  for (let i = 1; i < line.length - 1; i++) {   // skip BOTH endpoints
    if (isBlocked(terrainIx, line[i])) return false;
  }
  return true;
}

// ── SIGHT RANGE (per-unit, data-driven + extendable) ────────────────────────────────────────────
/** Default crew sight radius in hexes (a roomy deck read of ~4 hexes / ~20 ft @ 5 ft per hex). */
export const SIGHT_BASE = 4;

/**
 * A unit's sight BONUS from a sight stat and/or spyglass-style gear — read straight off the unit,
 * fully data-driven so new sources just work:
 *   • unit.sightBonus        — a flat per-unit bonus (any system may set it)
 *   • unit.stats.sight       — a derived "sight" stat (if stat-derive ever adds one)
 *   • equipped `mods.sight`  — a SPYGLASS / relic trinket: add `mods:{ sight:N }` to any gear in
 *                              gear-ext.js and it extends vision here with ZERO code change.
 * @param {any} unit
 * @returns {number}
 */
export function sightBonusOf(unit) {
  if (!unit) return 0;
  let bonus = 0;
  if (Number.isFinite(unit.sightBonus)) bonus += Number(unit.sightBonus);
  if (unit.stats && Number.isFinite(unit.stats.sight)) bonus += Number(unit.stats.sight);
  if (unit.equipped) {
    for (const slot of SLOTS) {
      const it = ITEMS[unit.equipped[slot]];
      if (it && it.mods && Number.isFinite(it.mods.sight)) bonus += Number(it.mods.sight);
    }
  }
  return bonus;
}

/**
 * The sight radius (in hexes) for a unit: a base (SIGHT_BASE, or unit.baseSightRange for a keen-eyed
 * monster) plus every sight bonus, floored to ≥ 1.
 * @param {any} unit
 * @returns {number}
 */
export function sightRangeOf(unit) {
  const base = unit && Number.isFinite(unit.baseSightRange) ? Number(unit.baseSightRange) : SIGHT_BASE;
  return Math.max(1, Math.floor(base + sightBonusOf(unit)));
}

/**
 * sightField — the set of "q,r" keys ONE pawn can actually see: every on-board hex within its sight
 * range that has a CLEAR line to it (walls block). Always includes the pawn's own hex.
 * @param {any} unit
 * @param {Map<string,any>|null|undefined} terrainIx
 * @returns {Set<string>}
 */
export function sightField(unit, terrainIx) {
  const seen = new Set();
  if (!unit || !unit.position) return seen;
  const here = unit.position;
  const range = sightRangeOf(unit);
  for (const h of allHexes()) {
    if (hexDistance(here, h) > range) continue;
    if (losClear(here, h, terrainIx)) seen.add(K(h));
  }
  return seen;
}

/**
 * visibleHexes — the FOG reveal set for a side: the UNION of every CONSCIOUS pawn's sightField. A
 * downed (unconscious) lookout sees nothing. Because it's a union, spreading the crew reveals more
 * ground — one pawn per ship lights that ship — with no special-case code.
 *
 * @param {any[]} units               the whole board
 * @param {boolean} side              the unit.isPlayer value to compute vision FOR (true = player)
 * @param {Map<string,any>|null|undefined} terrainIx
 * @returns {Set<string>}
 */
export function visibleHexes(units, side, terrainIx) {
  const out = new Set();
  for (const u of units || []) {
    if (!u || u.isPlayer !== side || !isConscious(u)) continue;
    for (const k of sightField(u, terrainIx)) out.add(k);
  }
  return out;
}

/**
 * fogActiveForGrid — fog of war engages on any board BIGGER than the verbatim 9×7 duel (the squad /
 * ship / boarding decks). The 1v1 training + PVP DUEL board stays fully visible — no regression.
 * Shared by game.js (render gate) and the smoke test so the rule has one home.
 * @param {{cols:number,rows:number}} [grid]  defaults to the live grid-config GRID
 * @returns {boolean}
 */
export function fogActiveForGrid(grid = GRID) {
  const duel = GRID_PRESETS.duel;
  return grid.cols > duel.cols || grid.rows > duel.rows;
}

export default {
  hexLine, losClear, sightRangeOf, sightBonusOf, sightField, visibleHexes, fogActiveForGrid, SIGHT_BASE,
};
