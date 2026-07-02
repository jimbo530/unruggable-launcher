// @ts-check
// world-features.js — the WORLD layer that sits ON TOP of the hex grid (game/lib/location.js):
// TERRAIN (what a hex IS — forest / mountain / sand / water / town) and BUILDINGS (what's been
// placed on it — mills, mines, …). This is WORLD config (founder-authored, like PORTS), NOT
// per-player state. It's the geography that drives PRODUCTION → which feeds the location-keyed
// trade pools (a mill's lumber gets injected into its port's pool → price imbalance → arb).
//
// Hex coords match location.js (flat-top odd-q; PORTS give each island's anchor hex). Terrain is
// estimated from the painted map (game/art/world-map.jpg) — FOUNDER: nudge the hex lists below to
// match the art exactly.
//
//   NE island = SALTMARSH (port hex 13,2) — the FORESTED isle (founder 2026-06-25: "land to the
//   north east has trees"). MILLS go on its forest squares; each mill produces LUMBER that will
//   feed the Saltmarsh keyed pool (loc 13002).

/** Terrain kinds. forest→mills(lumber)+forage(berries/elk/bear) · mountain→mines(ore/metal) ·
 *  plains→forage(berries/pork) · water→fish · sand/town non-forageable. (forage.js FORAGE_TABLES.) */
export const TERRAIN = { FOREST: "forest", MOUNTAIN: "mountain", PLAINS: "plains", SAND: "sand", WATER: "water", TOWN: "town" };

const key = (q, r) => `${q},${r}`;

// ── TERRAIN MAP (hex → kind). Only non-water hexes need listing; everything else = open water. ──
// Seeded for the NE/Saltmarsh forest isle + the central Port Royal mountain (for future mines).
// FOUNDER: confirm/adjust these hex lists against the map art.
const TERRAIN_DEFS = [
  // ── Saltmarsh isle (NE) — forested ──
  { q: 13, r: 1, kind: TERRAIN.FOREST },
  { q: 12, r: 2, kind: TERRAIN.FOREST },
  { q: 13, r: 2, kind: TERRAIN.TOWN },     // Saltmarsh port sits here
  { q: 14, r: 2, kind: TERRAIN.FOREST },
  { q: 14, r: 3, kind: TERRAIN.FOREST },
  // ── Port Royal isle (centre) — mountain (future mines) ──
  { q: 8, r: 2, kind: TERRAIN.MOUNTAIN },
  { q: 8, r: 3, kind: TERRAIN.TOWN },      // Port Royal hub sits here
  { q: 9, r: 3, kind: TERRAIN.SAND },
];

const TERRAIN_MAP = (() => { const m = {}; for (const t of TERRAIN_DEFS) m[key(t.q, t.r)] = t.kind; return m; })();

/** Terrain kind at a hex (defaults to open water). */
export function terrainAt(q, r) { return TERRAIN_MAP[key(q, r)] || TERRAIN.WATER; }
/** All hexes of a given terrain kind → [{q,r}]. */
export function hexesOfTerrain(kind) {
  return TERRAIN_DEFS.filter((t) => t.kind === kind).map((t) => ({ q: t.q, r: t.r }));
}

// ── TILE → ON-CHAIN LOCATION ID ────────────────────────────────────────────────────────────
// The keyed pools are keyed to a location NUMBER; the game decides which tiles map to it. Founder
// 2026-06-26: "all open ocean tiles are just same location." So EVERY open-water hex resolves to the
// single OCEAN location (8004 = the one ocean pool) — the ocean is as big as the sea, one market,
// editable for free (no new pools). Land tiles key individually (q*1000+r). This is the mapping the
// presence-signer uses: a pawn on ANY water tile is "at the ocean".
export const OCEAN_LOC = 8004;   // all open water → the ocean location (fishing)
export const BEACH_LOC = 9003;   // all sandy beach → the beach location (crab collecting, founder 2026-06-26)
/** The on-chain location id for a hex: open water → OCEAN_LOC; sandy beach → BEACH_LOC; land → q*1000+r. */
export function locationIdForHex(q, r) {
  const t = terrainAt(q, r);
  if (t === TERRAIN.WATER) return OCEAN_LOC;   // whole open ocean = one location (fish)
  if (t === TERRAIN.SAND)  return BEACH_LOC;   // all sandy beach = one location (crabs)
  return q * 1000 + r;                          // land tiles keyed individually
}
/** Is this hex part of the open ocean (the shared ocean location)? */
export function isOcean(q, r) { return terrainAt(q, r) === TERRAIN.WATER; }
/** Is this hex a sandy beach (the shared crab-collecting location)? */
export function isBeach(q, r) { return terrainAt(q, r) === TERRAIN.SAND; }

// ── PRODUCTION BUILDING TYPES (founder 2026-06-26: "vinyards and farms for difrent produce"). Each
//    type sits on a required TERRAIN and makes a base `produces` good. Farms SPECIALIZE: a farm row
//    can override `produces` (wheat / corn / …) so "different produce" = different farms. The output
//    is GATED supply (made-in-game only) → feeds the location-keyed pools + the craft chain
//    (grapes→wine, wheat→bread/ale). Add types as the world grows. ──
export const PRODUCTION_TYPES = {
  mill:     { terrain: TERRAIN.FOREST,   produces: "lumber" },  // logs → planks (shipyard)
  mine:     { terrain: TERRAIN.MOUNTAIN, produces: "ore" },     // ore → metal (smith)
  vineyard: { terrain: TERRAIN.PLAINS,   produces: "grapes" },  // grapes → WINE
  farm:     { terrain: TERRAIN.PLAINS,   produces: "wheat" },   // wheat (override per farm: corn, …)
  // founder 2026-06-26: ocean/fishing areas are production engines too — a FISHERY on WATER lands
  // the day's catch; its FISH/CRAB feed a location-keyed pool, and a fishing water-vault BUYS that
  // catch from the lowest-cost source → the same arb imbalance the mills drive (two-key logistics).
  fishery:  { terrain: TERRAIN.WATER,    produces: "fish" },    // fish (override per ground: crab)
};

// ── BUILDINGS (placed on hexes). Each MUST sit on its type's required terrain (mill→forest,
//    mine→mountain, vineyard/farm→plains). Each is tied to a PORT (its produce feeds that port's
//    location-keyed pool, loc = q*1000+r). ──
//    `produces` = the good token id it makes; `ratePerHour` = units/hour (dev-scaled by the keeper).
const BUILDING_DEFS = [
  // founder 2026-06-25: "put some mills on the island in the forest squares" (NE = Saltmarsh)
  { id: "mill-saltmarsh-1", type: "mill", q: 13, r: 1, port: "saltmarsh", produces: "lumber", ratePerHour: 50 },
  { id: "mill-saltmarsh-2", type: "mill", q: 14, r: 3, port: "saltmarsh", produces: "lumber", ratePerHour: 50 },
];

/** All buildings (optionally filtered by type). */
export function buildings(type = null) {
  return BUILDING_DEFS.filter((b) => !type || b.type === type).map((b) => ({ ...b, loc: b.q * 1000 + b.r }));
}
/** Buildings on a specific hex. */
export function buildingsAt(q, r) { return buildings().filter((b) => b.q === q && b.r === r); }
/** Buildings tied to a port (their production feeds that port's keyed pool). */
export function buildingsForPort(portId) { return buildings().filter((b) => b.port === portId); }

/** Validate every building sits on the right terrain (mill→forest, mine→mountain). Returns problems. */
export function validatePlacements() {
  const need = { mill: TERRAIN.FOREST, mine: TERRAIN.MOUNTAIN };
  const bad = [];
  for (const b of BUILDING_DEFS) {
    const want = need[b.type];
    if (want && terrainAt(b.q, b.r) !== want) bad.push(`${b.id} on ${terrainAt(b.q, b.r)} (wants ${want})`);
  }
  return bad;
}
