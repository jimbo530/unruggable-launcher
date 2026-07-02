// @ts-check
/**
 * maps/index.js — TERRAIN-DATA LOADER for the "Seize the Seas" battle deck.
 *
 * WHAT THIS IS
 *   A tiny, engine-free registry of per-area MAP/TERRAIN data (cover · hazard · water ·
 *   water-edge · wall · difficult ground · deploy zones) for the named battle decks. It is
 *   PURE DATA + a loader — it does NOT touch tot-engine.js, the grid, or combat. game.js can
 *   read a map by id and paint a COSMETIC terrain layer (legibility); nothing here changes a
 *   single combat formula. If a fight's map id is unknown, getMap() returns null and the deck
 *   renders exactly as before.
 *
 * WHY IT EXISTS (the contract gap it fills)
 *   area-encounters.js tags every encounter with a `map` id ("bilge" / "cave" / "kraken-sea" /
 *   "open-deck" …) and AREA-MAP.md describes what each deck should "do" in a fight, but no
 *   terrain DATA or consumer existed. This module defines a clean, render-friendly SHAPE for that
 *   terrain and resolves the area `map` ids onto it (via per-map `aliases`).
 *
 * THE SHAPE (what each maps/<id>.js default-exports)
 *   {
 *     id:        string,                       // canonical id
 *     name:      string,                       // display name
 *     aliases:   string[],                     // area `map` ids that resolve here (e.g. "kraken-sea","open-deck")
 *     grid:      { cols, rows },               // the board these coords are AUTHORED for (squad 16×9)
 *     recommended: "duel"|"squad"|"ship"|"boarding",
 *     blurb:     string,
 *     deploy:    { player: ZoneSpec, enemy: ZoneSpec },   // muster zones (advisory + visual)
 *     terrain:   TerrainCell[],                // the physical features
 *   }
 *   ZoneSpec    = { cols:number[] } | { hexes:{q,r}[] }    // a column band OR explicit hexes
 *   TerrainCell = { q, r, type, prop?, label?, mod? }
 *     type ∈ TERRAIN_TYPES (cover | hazard | water | water-edge | wall | difficult)
 *     mod  is an OPTIONAL advisory hint (e.g. cover {ac:+2}) — NOT applied by the engine here.
 *
 * node --check clean. ESM. No DOM, no localStorage, no chain. Imports only the data modules.
 */

import bilge from "./bilge.js";
import seaCave from "./sea-cave.js";
import openSeaKraken from "./open-sea-kraken.js";

/**
 * The terrain vocabulary + a consistent RENDER STYLE (so any consumer paints them the same way).
 * `cover`/`hazard` etc. are the FEEL described in AREA-MAP.md / CONTENT-WISHLIST.md §2. The style
 * fields are pure cosmetics (SVG fill/stroke + a glyph); a renderer may ignore them.
 */
export const TERRAIN_TYPES = {
  cover:        { glyph: "▮", fill: "rgba(120,82,45,0.45)",  stroke: "#b07b3a", label: "Cover (+AC)" },
  hazard:       { glyph: "⚠", fill: "rgba(200,60,50,0.22)",  stroke: "#e07a6a", label: "Hazard" },
  water:        { glyph: "≈", fill: "rgba(40,110,150,0.30)", stroke: "#3a86a8", label: "Deep water" },
  "water-edge": { glyph: "🌊", fill: "rgba(46,160,235,0.18)", stroke: "#2ea0eb", label: "Water edge (foes rise)" },
  wall:         { glyph: "▦", fill: "rgba(20,16,10,0.55)",   stroke: "#5a4a32", label: "Blocking" },
  difficult:    { glyph: "▒", fill: "rgba(90,120,60,0.28)",  stroke: "#7e9c4e", label: "Difficult ground" },
};

// ── REGISTRY ──────────────────────────────────────────────────────────────────────────────
const MAPS = [bilge, seaCave, openSeaKraken];
const BY_ID = new Map();
for (const m of MAPS) {
  validateMap(m);
  for (const alias of [m.id, ...(m.aliases || [])]) {
    if (BY_ID.has(alias)) throw new Error(`maps: duplicate map id/alias "${alias}".`); // loud, never silent
    BY_ID.set(String(alias), m);
  }
}

/** Validate one map module — THROWS loudly on malformed data (never a silent bad map). */
function validateMap(m) {
  if (!m || typeof m !== "object") throw new Error("maps: a map module must export an object.");
  if (typeof m.id !== "string" || !m.id) throw new Error("maps: map.id must be a non-empty string.");
  const g = m.grid;
  if (!g || !(g.cols > 0) || !(g.rows > 0)) throw new Error(`maps: map "${m.id}" needs grid {cols>0,rows>0}.`);
  if (!Array.isArray(m.terrain)) throw new Error(`maps: map "${m.id}" terrain must be an array.`);
  const seen = new Set();
  for (const c of m.terrain) {
    if (!Number.isFinite(c.q) || !Number.isFinite(c.r)) throw new Error(`maps: "${m.id}" terrain cell needs finite q,r.`);
    if (c.q < 0 || c.q >= g.cols || c.r < 0 || c.r >= g.rows)
      throw new Error(`maps: "${m.id}" terrain cell (${c.q},${c.r}) is off its ${g.cols}×${g.rows} grid.`);
    if (!TERRAIN_TYPES[c.type]) throw new Error(`maps: "${m.id}" terrain cell (${c.q},${c.r}) has unknown type "${c.type}".`);
    const k = `${c.q},${c.r}`;
    if (seen.has(k)) throw new Error(`maps: "${m.id}" has two terrain cells on (${k}).`);
    seen.add(k);
  }
  return m;
}

/** Resolve a map by canonical id OR any alias (the area `map` ids). Returns null if unknown. */
export function getMap(id) {
  return (id != null && BY_ID.get(String(id))) || null;
}

/** Compact list of every registered map (id, name, grid, aliases). */
export function listMaps() {
  return MAPS.map((m) => ({ id: m.id, name: m.name, grid: m.grid, aliases: m.aliases || [] }));
}

/** Build an O(1) "q,r" → TerrainCell index for a map (or an empty Map for null). */
export function terrainIndex(map) {
  const ix = new Map();
  if (map && Array.isArray(map.terrain)) for (const c of map.terrain) ix.set(`${c.q},${c.r}`, c);
  return ix;
}

/** Expand a deploy ZoneSpec ({cols:[…]} band OR {hexes:[…]}) into concrete {q,r} hexes for a map. */
export function deployHexes(map, side) {
  if (!map || !map.deploy || !map.deploy[side]) return [];
  const z = map.deploy[side];
  if (Array.isArray(z.hexes)) return z.hexes.map((h) => ({ q: h.q, r: h.r }));
  const out = [];
  if (Array.isArray(z.cols)) for (const q of z.cols) for (let r = 0; r < map.grid.rows; r++) out.push({ q, r });
  return out;
}

export { validateMap };
export default { getMap, listMaps, terrainIndex, deployHexes, TERRAIN_TYPES };
