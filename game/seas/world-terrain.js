// @ts-check
/**
 * world-terrain.js — per-hex TERRAIN TYPE for the Seize the Seas world map.
 * Prerequisite #1 for the world-vision 2-hex sight rule (see WORLD-MAP-VISION.md).
 *
 * location.js exposes only hexDanger(q,r); this adds terrainAt(q,r). It does NOT edit
 * location.js (that's the encounter bridge) — map.html imports this as a sibling.
 *
 * v1 is honest + coarse: the hand-drawn world is open SEA, and PORT hexes are COAST (land you
 * resupply at). Both sea + coast/grass are OPEN terrain -> 2-hex sight (world-vision OPEN_TERRAIN),
 * so the 2-hex rule is live across the open water now. ROUGH terrain (forest / mountain / reef /
 * fog -> 1-hex sight) is FOUNDER-AUTHORED: paint hexes into TERRAIN_OVERRIDE and sight tightens
 * there automatically. (A later region-painter can replace the override map.)
 */

export const TERRAIN = {
  SEA: 'sea', COAST: 'coast', GRASS: 'grass',     // OPEN -> 2-hex sight
  FOREST: 'forest', MOUNTAIN: 'mountain', REEF: 'reef', FOG: 'fog', // ROUGH -> 1-hex sight
};

// Founder-painted exceptions: "q,r" -> terrain type. Empty in v1 (open sea everywhere). Add rough
// hexes here (e.g. '12,7': TERRAIN.FOREST) and world-vision sight contracts to 1 on them.
export const TERRAIN_OVERRIDE = {};

const key = (q, r) => q + ',' + r;

/**
 * The terrain type of a world hex.
 *   1) a founder override wins; 2) a PORT hex is COAST; 3) otherwise open SEA.
 * @param {number} q
 * @param {number} r
 * @param {object} [ports]  location.js PORTS ({id:{q,r,...}}) so coast hexes are known
 * @returns {string}
 */
export function terrainAt(q, r, ports) {
  const o = TERRAIN_OVERRIDE[key(q, r)];
  if (o) return o;
  if (ports) {
    for (const id in ports) {
      const p = ports[id];
      if (p && p.q === q && p.r === r) return TERRAIN.COAST;
    }
  }
  return TERRAIN.SEA;
}
