// @ts-check
/**
 * world-vision.js — WORLD-MAP (voyage) vision rules for "Seize the Seas".
 *
 * RULE (founder): on the world map the MAP is always visible (terrain, ports, routes),
 * but OTHER PLAYERS/CREWS are only seen when within your ship's SIGHT range:
 *   - base sight = 1 hex (the hex you're on + the ring around it)
 *   - OPEN terrain (sea, grasslands) extends sight to 2 hexes
 * Sight is SHARED across all your ships (a ship on each front widens what you see — the
 * same "spread out to see more" idea as the battle-grid fog in battle-grid/los.js, P8).
 *
 * This is the PURE math — it changes NOTHING on its own. Two world-map prerequisites must
 * exist first for it to hide/show anyone in map.html:
 *   (1) per-hex TERRAIN TYPE — location.js exposes only hexDanger(q,r) today; add a
 *       terrainAt(q,r) -> 'sea'|'grass'|'forest'|... so OPEN-vs-closed is known; and
 *   (2) OTHER-PLAYER POSITIONS — a feed/store of other crews' {id,q,r} on the shared world.
 * Until both exist, the map stays single-player + fully visible (no regression).
 */

export const WORLD_SIGHT = { base: 1, open: 2 };

// Terrain that lets you see farther (open sightlines). Everything else uses base sight.
export const OPEN_TERRAIN = new Set(['sea', 'water', 'ocean', 'grass', 'grassland', 'grasslands', 'plain', 'plains', 'shallows', 'coast']);

/** Sight radius (in hexes) for the terrain a ship sits on. Unknown/closed terrain -> base. */
export function sightRange(terrainType) {
  return OPEN_TERRAIN.has(String(terrainType || '').toLowerCase()) ? WORLD_SIGHT.open : WORLD_SIGHT.base;
}

// odd-q flat-top cube distance (project hex convention; matches tot-engine / the seas hex family).
function toCube(h) { const x = h.q, z = h.r - (h.q - (h.q & 1)) / 2, y = -x - z; return { x, y, z }; }
export function worldHexDistance(a, b) {
  const ac = toCube(a), bc = toCube(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
}

/**
 * Is `hex` within sight of ANY of my ships? Each ship's reach depends on the terrain it sits
 * on (open -> 2, else 1). hexDist defaults to the project odd-q cube distance; pass
 * location.js's hexDistance to use the world map's exact calibration when wiring this in.
 * @param {{q:number,r:number}} hex
 * @param {Array<{q:number,r:number}>} myShips
 * @param {(q:number,r:number)=>string} terrainAt
 * @param {(a:any,b:any)=>number} [hexDist]
 */
export function isHexScouted(hex, myShips, terrainAt, hexDist = worldHexDistance) {
  for (const s of (myShips || [])) {
    const range = sightRange(terrainAt ? terrainAt(s.q, s.r) : null);
    if (hexDist(s, hex) <= range) return true;
  }
  return false;
}

/** The other crews you can currently SEE — those within any of your ships' shared sight. */
export function visibleOthers(myShips, others, terrainAt, hexDist = worldHexDistance) {
  return (others || []).filter((o) => isHexScouted(o, myShips, terrainAt, hexDist));
}
