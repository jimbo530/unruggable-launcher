# Seize the Seas — World-Map Vision (voyage layer)

Distinct from **battle fog** (`battle-grid/los.js`, COMBAT-PLAN P8). This is the **world / sailing map** (`map.html`).

## The rule (founder)
- **The map is always visible** — terrain, ports, routes. Geography is never hidden.
- **Other players / crews are hidden** unless within your ship's **SIGHT** range.
- **Sight = 1 hex** (the hex you're on + the ring around it) by default; **2 hexes on OPEN terrain (sea, grasslands)**. Rough/closed terrain (forest, mountain, fog) stays tight (1, or less later).
- **Sight is shared across your ships** — a ship on each front widens what you see (same "spread out to see more" as the battle fog). → a real reason to keep a crew on each ship / front.

## Status — captured + ready math built, NOT yet wired
`world-vision.js` (+ `world-vision.test.mjs`) ships the pure logic: `sightRange(terrain)` (sea/grass → 2, else 1), `isHexScouted(hex, myShips, terrainAt)`, `visibleOthers(myShips, others, terrainAt)` (shared across ships). It changes nothing on its own.

**Two world-map prerequisites are needed before it can hide/show anyone in `map.html`:**
1. ✅ **DONE — per-hex terrain type.** `world-terrain.js` adds `terrainAt(q,r,PORTS)` (open **SEA** default; **PORT** hexes = COAST; founder paints rough hexes — forest/mountain/reef — into `TERRAIN_OVERRIDE` and sight tightens to 1 there). `location.js` untouched. **Wired into `map.html`:** your ship's **sight ring now renders** — **2 hexes on open sea/grass, 1 on rough** — so the rule is visible today (even pre-multiplayer).
2. **Other-player positions.** A feed/store of other crews' `{id,q,r}` on the shared world — the map is **single-player** today (renders only your ship + ports).

Once both exist, wiring is small: in `map.html` render, draw other-crew markers only for `visibleOthers(myShips, otherCrews, terrainAt, LOC.hexDistance)`; leave the map terrain fully drawn. No change to combat, sailing, or the encounter bridge.
