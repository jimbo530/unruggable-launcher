// grid-parity.mjs — P4 PARITY: the grid-config SHADOW must read the board IDENTICALLY to the
// verbatim tot-engine.js at the default 9×7 (so repointing game.js's 4 grid imports changed
// nothing), AND stay correct + independent when the board is resized for ship-scale.
//
// Run: node game/seas/battle-grid/grid-parity.mjs
import * as TOT from "./tot-engine.js";
import {
  GRID, setGrid, allHexes, hexNeighbors, hexesInRange, gridPixelDimensions, GRID_PRESETS,
} from "./grid-config.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1) default GRID == the engine's frozen 9×7 ───────────────────────────────────────
setGrid(TOT.GRID_COLS, TOT.GRID_ROWS); // explicit so the test is order-independent
ok(GRID.cols === TOT.GRID_COLS && GRID.rows === TOT.GRID_ROWS,
  `default grid ${GRID.cols}×${GRID.rows} == engine ${TOT.GRID_COLS}×${TOT.GRID_ROWS}`);

// ── 2) allHexes() byte-parity ─────────────────────────────────────────────────────────
ok(eq(allHexes(), TOT.allHexes()), `allHexes() parity (${allHexes().length} hexes)`);

// ── 3) NEIGHBOR-TABLE parity — every hex, both q-parities (EVEN_Q / ODD_Q) ────────────
let nbrMismatch = 0;
for (const h of TOT.allHexes()) if (!eq(hexNeighbors(h), TOT.hexNeighbors(h))) nbrMismatch++;
ok(nbrMismatch === 0,
  `hexNeighbors() parity across all ${TOT.allHexes().length} hexes (EVEN_Q/ODD_Q tables identical)`);

// ── 4) hexesInRange() (BFS) parity — many centers/ranges, with + without occupied ─────
const centers = [{ q: 0, r: 0 }, { q: 4, r: 3 }, { q: 8, r: 6 }, { q: 3, r: 5 }, { q: 7, r: 1 }];
let rangeMismatch = 0;
for (const c of centers) for (const R of [1, 2, 3, 4, 5]) {
  if (!eq(hexesInRange(c, R), TOT.hexesInRange(c, R))) rangeMismatch++;
}
const occ = ["4,2", "5,3", "3,3"];
for (const c of centers) {
  if (!eq(hexesInRange(c, 3, new Set(occ)), TOT.hexesInRange(c, 3, new Set(occ)))) rangeMismatch++;
}
ok(rangeMismatch === 0, "hexesInRange() BFS parity (5 centers × ranges 1–5, with + without occupied)");

// ── 5) gridPixelDimensions() parity ───────────────────────────────────────────────────
ok(eq(gridPixelDimensions(), TOT.gridPixelDimensions()),
  `gridPixelDimensions() parity ${JSON.stringify(gridPixelDimensions())}`);

// ── 6) CONFIG-AWARE: resize to the squad board; the shadow tracks it, the engine does not ─
setGrid(GRID_PRESETS.squad.cols, GRID_PRESETS.squad.rows);
ok(allHexes().length === 16 * 9, `squad board allHexes() = ${allHexes().length} (expect 16×9=144)`);
const corner = hexNeighbors({ q: 15, r: 8 });
ok(corner.every((h) => h.q >= 0 && h.q < 16 && h.r >= 0 && h.r < 9),
  "resized neighbors respect NEW bounds (no q=16 / r=9 leak)");
ok(TOT.allHexes().length === 9 * 7, "engine allHexes() STILL 9×7 (shadow resize is independent)");
const big = gridPixelDimensions(), small = TOT.gridPixelDimensions();
ok(big.width > small.width && big.height > small.height, "resized gridPixelDimensions grew vs 9×7");

// ── 7) ship-scale preset reachable (camera wires it later, P7) ─────────────────────────
setGrid(GRID_PRESETS.ship.cols, GRID_PRESETS.ship.rows);
ok(allHexes().length === 20 * 6, `ship preset allHexes() = ${allHexes().length} (expect 20×6=120)`);

// ── 8) restore default so any later importer sees the verbatim board ──────────────────
setGrid(TOT.GRID_COLS, TOT.GRID_ROWS);
ok(eq(allHexes(), TOT.allHexes()), "restored to 9×7 → byte-parity again");

console.log(fails === 0 ? "\nGRID PARITY: ALL PASS ✅" : `\n${fails} GRID PARITY CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
