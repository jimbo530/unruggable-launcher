// @ts-check
/**
 * land-journey.js — PURE walk-journey math for the PARTY's LAND FREE-ROAM on the Seize the Seas
 * hex world map. This is the FOOT twin of the ship voyage (location.js setSail/journeyOf) — the
 * walking party (crew/index.html sts_party + sts_party_leader) roams any LAND hex it can reach;
 * travel just TAKES TIME. "Can't crab if you can't walk to the beach — the path was never built."
 * This module IS the path's clock + reachability rule.
 *
 * WHY A SEPARATE MODULE (not just more code in map.html):
 *   The walk timing + reachability is the load-bearing logic, so it lives here as PURE functions
 *   (no localStorage, no DOM) that map.html imports AND land-journey.test.mjs can test under node.
 *   Storage (the actual party position + journey time-lock) is delegated to location.js's shared
 *   hex map (getHex / travelOverland / tryArrive / isAtSea) — map.html wires them together.
 *
 * WALK SPEED (founder 2026-07-06): SLOWER than sailing. Ships = 8h/hex; walking = 12h/hex, a flat
 * constant (WALK_HOURS_PER_HEX). Same MS_PER_HEX dev-scaling as ships so beta walks finish in a
 * testable time. This is DELIBERATELY simpler than location.js's terrain-summed foot travel (24h +
 * terrain multipliers) — the founder spec pinned a flat 12h/hex for the party walk, so we honor it.
 *
 * REACHABILITY (v1, no pathfinding): a walk is a STRAIGHT hex line from the party's hex to the
 * target. The target must be LAND, and NO hex on the straight line may be open sea — if the line
 * crosses water, the walk is blocked ("the sea is in the way — sail instead"). Islands are small
 * and mostly convex, so a straight line is enough for beta; real land pathfinding is a later pass.
 */

// ── DIALS ────────────────────────────────────────────────────────────────────────────────────
// Ships sail 8h/hex (location.js EIGHT_HOURS). The party WALKS at 12h/hex — 1.5× slower, flat.
export const WALK_HOURS_PER_HEX = 12;
// The entity id the party travels under in location.js's shared hex map (sts_hexpos). Distinct
// from any ship id so the party has its own position + its own foot journey (never a ship voyage).
export const PARTY_ENTITY = "party";

// ── HEX MATH (odd-q flat-top cube distance — MUST match location.js hexDistance exactly) ───────
function toCube(h) { const x = h.q, z = h.r - (h.q - (h.q & 1)) / 2, y = -x - z; return { x, y, z }; }
/** Hex grid distance (number of hexes between two cells). Mirrors location.js hexDistance. */
export function walkHexDistance(a, b) {
  const ac = toCube(a), bc = toCube(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
}
function cubeToOffset(c) { return { q: c.x, r: c.z + (c.x - (c.x & 1)) / 2 }; }
function cubeRound(c) {
  let rx = Math.round(c.x), ry = Math.round(c.y), rz = Math.round(c.z);
  const dx = Math.abs(rx - c.x), dy = Math.abs(ry - c.y), dz = Math.abs(rz - c.z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}
function cubeLerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; }
/**
 * The ordered hexes a STRAIGHT route from a→b passes through (inclusive of both ends).
 * Same line algorithm location.js uses for terrain-summed legs — kept here so reachability
 * checks the exact hexes the party would tread.
 */
export function walkLine(a, b) {
  const n = walkHexDistance(a, b);
  if (n === 0) return [{ q: a.q, r: a.r }];
  const ac = toCube(a), bc = toCube(b), out = [];
  for (let i = 0; i <= n; i++) out.push(cubeToOffset(cubeRound(cubeLerp(ac, bc, i / n))));
  return out;
}

// ── REACHABILITY ───────────────────────────────────────────────────────────────────────────────
/**
 * Is `terrain` a walkable LAND terrain? Anything the terrain source reports as open water
 * ("sea"/"water"/"ocean") is NOT walkable — a ship is needed there. Everything else (a port's
 * coast/plains, a headland, a beach, a future mine hex) is land the party can march.
 * @param {string} terrain
 */
export function isLandTerrain(terrain) {
  const t = String(terrain || "").toLowerCase();
  return !(t === "" || t === "sea" || t === "water" || t === "ocean");
}

/**
 * Can the party WALK from `fromHex` to `toHex` right now? PURE — the caller injects `terrainAt`
 * (q,r)->terrainType (location.js getTerrain) so this stays testable without storage.
 *   - target must be a different hex, on the chart, and LAND;
 *   - the straight hex line to it must not cross open sea (v1: no water-avoiding pathfinding).
 * Returns { ok, reason }. reason is player-facing plain text on a block.
 * @param {{q:number,r:number}} fromHex
 * @param {{q:number,r:number}} toHex
 * @param {(q:number,r:number)=>string} terrainAt
 * @param {{cols:number,rows:number}} [grid]
 */
export function canWalk(fromHex, toHex, terrainAt, grid = { cols: Infinity, rows: Infinity }) {
  if (!fromHex || !toHex) return { ok: false, reason: "no course" };
  if (toHex.q < 0 || toHex.q >= grid.cols || toHex.r < 0 || toHex.r >= grid.rows)
    return { ok: false, reason: "off the chart" };
  if (fromHex.q === toHex.q && fromHex.r === toHex.r) return { ok: false, reason: "already here" };
  if (!isLandTerrain(terrainAt(toHex.q, toHex.r)))
    return { ok: false, reason: "the sea is in the way — sail instead" };
  // walk the straight line — if ANY hex on it is open sea, the party can't march across it.
  const line = walkLine(fromHex, toHex);
  for (const h of line) {
    if (!isLandTerrain(terrainAt(h.q, h.r)))
      return { ok: false, reason: "the sea is in the way — sail instead" };
  }
  return { ok: true, reason: null };
}

// ── WALK PLAN (distance / fiction hours / real ms) ───────────────────────────────────────────
/**
 * Plan a walk fromHex→toHex: distance in hexes, fiction hours (distance × 12h), and the real
 * wall-clock lock in ms (dev-scaled by msPerHex, / speed — same shape as location.js setSail).
 * PURE math; does NOT check reachability (call canWalk first) or move anyone.
 * @param {{q:number,r:number}} fromHex
 * @param {{q:number,r:number}} toHex
 * @param {{msPerHex?:number, speed?:number}} [opts]
 * @returns {{ distance:number, hours:number, ms:number }}
 */
export function planWalk(fromHex, toHex, opts = {}) {
  const distance = walkHexDistance(fromHex, toHex);
  const hours = distance * WALK_HOURS_PER_HEX;
  const msPerHex = Number(opts.msPerHex) > 0 ? Number(opts.msPerHex) : 5000;
  const speed = Number(opts.speed) > 0 ? Number(opts.speed) : 1;
  // fiction hours → real ms, mirroring location.js: (hours / 8) * MS_PER_HEX / speed. A 12h walk
  // hex is 1.5× a ship's 8h hex, so it takes 1.5× the wall-clock — the "slower on foot" fiction.
  const EIGHT = 8;
  const ms = Math.round(((hours / EIGHT) * msPerHex) / speed);
  return { distance, hours, ms };
}
