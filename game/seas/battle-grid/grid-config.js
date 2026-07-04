// @ts-check
/**
 * grid-config.js — P4: the GRID-CONFIG SHADOW.
 *
 * tot-engine.js is the VERBATIM Tales-of-Tasern port and is OFF-LIMITS — its grid is a
 * hard-coded 9×7. To run ship-scale / multi-ship decks WITHOUT touching the engine, this
 * module is a byte-for-byte COPY of the four grid-READING functions, with the only change
 * being that they read a MUTABLE `GRID = {cols, rows}` instead of the engine's frozen
 * GRID_COLS / GRID_ROWS constants:
 *
 *   allHexes · hexNeighbors · hexesInRange · gridPixelDimensions
 *
 * The EVEN_Q / ODD_Q neighbor tables, the flat-top odd-q offset math, the BFS in
 * hexesInRange, and the pixel-dimension formula are IDENTICAL to tot-engine.js (verified by
 * grid-parity.mjs: at the default 9×7 every output matches the engine exactly). game.js
 * imports these four from HERE; everything else (hexToPixel, hexDistance, combat, spells)
 * still comes straight from the verbatim engine.
 *
 * SCALE: 1 hex = 5 ft (D&D space). A ship deck ≈ 100 ft long (~20 hexes) × 20–40 ft wide
 * (~4–8 hexes). Size ladder via setGrid()/GRID_PRESETS:
 *   duel 9×7 (1v1 training/PVP, the verbatim size) → squad 16×9 (early multi-pawn deck) →
 *   ship 20×6 (full single deck) → boarding 20×14 (two decks joined — needs the camera, P7).
 *
 * pixel-math note: hexToPixel (imported from the engine) depends only on (q, r, size), NOT
 * on grid size, so reusing it keeps the pixel layout byte-identical at any GRID.
 */

import { HEX_SIZE, hexToPixel } from "./tot-engine.js";

// SQRT3 — same constant the engine uses for the flat-top vertical pitch (hexGrid.ts).
const SQRT3 = Math.sqrt(3);

// ── MUTABLE GRID ─────────────────────────────────────────────────────────────────────
// Defaults to the engine's 9×7 so an un-set board behaves EXACTLY like tot-engine.js.
export const GRID = { cols: 9, rows: 7 };

/** Set the live board size. Returns a snapshot. Ignores non-positive/NaN args (keeps prior). */
export function setGrid(cols, rows) {
  if (Number.isFinite(cols) && cols > 0) GRID.cols = Math.floor(cols);
  if (Number.isFinite(rows) && rows > 0) GRID.rows = Math.floor(rows);
  return { cols: GRID.cols, rows: GRID.rows };
}

// Named board sizes for the deck ladder (1 hex = 5 ft). ship/boarding need the camera (P7).
export const GRID_PRESETS = {
  duel: { cols: 9, rows: 7 },        // 1v1 training / PVP — the VERBATIM tot-engine size
  squad: { cols: 16, rows: 9 },      // early squad deck (headroom toward ship-scale)
  ship: { cols: 20, rows: 6 },       // full single deck (~100 ft × ~30 ft @ 5 ft/hex)
  boarding: { cols: 20, rows: 14 },  // two decks joined by a gangplank/water gap (P7 camera)
};

/** Switch the board to a named preset. THROWS on an unknown name (never a silent no-op). */
export function useGridPreset(name) {
  const p = GRID_PRESETS[name];
  if (!p) throw new Error(`grid-config: unknown preset "${name}" (have: ${Object.keys(GRID_PRESETS).join(", ")})`);
  return setGrid(p.cols, p.rows);
}

// ── hexGrid.ts neighbor tables — COPIED BYTE-FOR-BYTE from tot-engine.js ───────────────
const EVEN_Q_NEIGHBORS = [
  { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: -1 }, { dq: -1, dr: 0 }, { dq: 0, dr: +1 },
];
const ODD_Q_NEIGHBORS = [
  { dq: +1, dr: +1 }, { dq: +1, dr: 0 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
];

// ── The 4 grid-reading fns — verbatim bodies, GRID_COLS/GRID_ROWS → GRID.cols/GRID.rows ──

export function hexNeighbors(hex) {
  const offsets = (hex.q & 1) === 0 ? EVEN_Q_NEIGHBORS : ODD_Q_NEIGHBORS;
  return offsets
    .map((d) => ({ q: hex.q + d.dq, r: hex.r + d.dr }))
    .filter((h) => h.q >= 0 && h.q < GRID.cols && h.r >= 0 && h.r < GRID.rows);
}

export function hexesInRange(center, range, occupied = new Set()) {
  const visited = new Set();
  const key = (h) => `${h.q},${h.r}`;
  visited.add(key(center));
  let frontier = [center];
  const result = [];
  for (let step = 0; step < range; step++) {
    const next = [];
    for (const hex of frontier) {
      for (const n of hexNeighbors(hex)) {
        const k = key(n);
        if (visited.has(k) || occupied.has(k)) continue;
        visited.add(k);
        next.push(n);
        result.push(n);
      }
    }
    frontier = next;
  }
  return result;
}

export function gridPixelDimensions(size = HEX_SIZE) {
  const last = hexToPixel({ q: GRID.cols - 1, r: GRID.rows - 1 }, size);
  return { width: last.x + size + 8, height: last.y + size * SQRT3 * 0.5 + 8 };
}

export function allHexes() {
  const hexes = [];
  for (let q = 0; q < GRID.cols; q++)
    for (let r = 0; r < GRID.rows; r++) hexes.push({ q, r });
  return hexes;
}
