// Smoke test: the maps/ terrain loader validates + resolves the authored decks, and every area
// `map` id this content covers resolves to a real map. Run:
//   node game/seas/battle-grid/maps/smoke-maps.mjs
import { getMap, listMaps, terrainIndex, deployHexes, TERRAIN_TYPES, validateMap } from "./index.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };

// 1) registry loaded + validated at import (validateMap throws on bad data → import would have thrown)
const all = listMaps();
ok(all.length === 3, `3 maps registered (got ${all.length}): ${all.map((m) => m.id).join(", ")}`);

// 2) canonical ids resolve
for (const id of ["bilge", "sea-cave", "open-sea-kraken"]) ok(!!getMap(id), `getMap("${id}") resolves`);

// 3) the area `map` ids area-encounters.js emits for these decks resolve via aliases
for (const alias of ["ship-bilge", "cave", "sea-caves", "kraken-sea", "open-deck", "deep-sea", "open-sea"])
  ok(!!getMap(alias), `alias "${alias}" resolves`);

// 4) an un-authored deck → null (renderer falls back to the plain deck, no throw)
ok(getMap("reef") === null && getMap(null) === null && getMap("nope") === null, "unknown / null map id → null (graceful)");

// 5) every terrain cell is in-bounds + a known type, and unique per hex (validateMap re-run)
for (const m of [getMap("bilge"), getMap("sea-cave"), getMap("open-sea-kraken")]) {
  let bad = null;
  for (const c of m.terrain) {
    if (c.q < 0 || c.q >= m.grid.cols || c.r < 0 || c.r >= m.grid.rows) bad = `(${c.q},${c.r}) off-grid`;
    if (!TERRAIN_TYPES[c.type]) bad = `bad type "${c.type}"`;
  }
  ok(!bad, `${m.id}: ${m.terrain.length} terrain cells all in-bounds + known type${bad ? " — " + bad : ""}`);
  const ix = terrainIndex(m);
  ok(ix.size === m.terrain.length, `${m.id}: terrainIndex has no collisions (${ix.size} cells)`);
}

// 6) deploy zones expand to concrete hexes (player left, enemy right / water edge)
const k = getMap("open-sea-kraken");
const pz = deployHexes(k, "player"), ez = deployHexes(k, "enemy");
ok(pz.length > 0 && ez.length > 0, `kraken deploy zones expand (player ${pz.length}, enemy ${ez.length})`);
ok(Math.max(...pz.map((h) => h.q)) < Math.min(...ez.map((h) => h.q)), "player muster is left of the enemy/water-edge band");

// 7) the kraken deck marks a water-edge band on the seaward rim (where the arms rise = spawn side)
const we = k.terrain.filter((c) => c.type === "water-edge");
ok(we.length >= 9 && we.every((c) => c.q >= 14), `kraken water-edge band on the seaward rim (${we.length} cells, all q≥14)`);

// 8) validateMap throws loudly on a malformed map (no silent bad data)
let threw = false;
try { validateMap({ id: "x", grid: { cols: 4, rows: 4 }, terrain: [{ q: 9, r: 9, type: "cover" }] }); } catch (e) { threw = true; }
ok(threw, "validateMap THROWS on an off-grid terrain cell (loud, never silent)");

console.log(fails === 0 ? "\nALL MAP CHECKS PASS ✅" : `\n${fails} MAP CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
