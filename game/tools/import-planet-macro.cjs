// node tools/import-planet-macro.cjs — THE PLANET IMPORTER (founder 2026-07-08:
// "ok so this would be all 100 of those maps all put together… world the size of the
// earth all together").
//
// Takes the founder's whole-planet painting (art/planet-map.jpg, 2048x2048 — Tern,
// Lanice, Blabek, Greyhills, Londa, Stralia, the Icey Waste, the Isles of 1,000
// Kingdoms…) and turns it into the MACRO LAYER for lib/terrain.js: a 512x512 class
// grid (ocean / land / ridge / ice) covering the 10x10-sheet planet — hexes
// cols -1280..1279, rows -960..959, equator through the middle (row 0), so the Icey
// Waste sits near the north pole and the southern seas run cold.
//
// The macro answers WHERE continents, ranges, and ice are; procgen paints the texture
// inside the strokes (fractal coastlines via domain warp, biomes from climate); the
// founder's regional maps overlay on top as sheet-level PAINT (import-map-paint.cjs).
//
// CLEANUP: one 3x3 mode-filter pass eats the map's text labels, grid lines, and
// coastline glow rings; ice additionally requires an 8-neighbor ice majority so white
// LETTERING never becomes glaciers.
//
// Output: seas/planet-macro.json (RLE rows) + seas/planet-macro-preview.png (eyeball).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art', 'planet-map.jpg');
const W = 512, H = 512;
// planet footprint in hex space: 10x10 sheets, equator through the middle
const COLS = 2560, ROWS = 1920, COL_OFF = -1280, ROW_OFF = -960;

const CLASSES = ['ocean', 'land', 'ridge', 'ice'];
const ANCHORS = [
  // gray-blue seas (incl. coast glow + grid lines over water)
  [[140, 160, 160], 0], [[120, 140, 160], 0], [[140, 140, 160], 0], [[120, 140, 140], 0],
  [[100, 120, 140], 0], [[140, 160, 180], 0], [[120, 120, 140], 0], [[160, 175, 185], 0],
  // tan land
  [[160, 140, 80], 1], [[140, 120, 80], 1], [[140, 140, 80], 1], [[120, 120, 60], 1],
  [[160, 140, 100], 1], [[140, 120, 60], 1], [[175, 155, 105], 1],
  // dark ridge/forest strokes (drawn ranges + tree glyphs -> elevation seeds)
  [[100, 80, 40], 2], [[80, 60, 40], 2], [[120, 100, 60], 2], [[60, 50, 35], 2],
  // ice / parchment white (Icey Waste, snowfields, white text — text gets eroded)
  [[240, 220, 200], 3], [[250, 245, 235], 3], [[225, 215, 205], 3],
];
const PREVIEW_COLORS = [[46, 100, 140], [176, 154, 91], [107, 82, 55], [240, 238, 230]];

// TEXT/DECORATION handling: labels are NEUTRAL-bright (white letters, r~g~b) or
// NEUTRAL-dark (black outlines) — real terrain is always WARM (tan land, brown ridge,
// cream ice) or blue (sea). So at FULL resolution we DROP text-signature pixels and
// vote each macro cell from what remains; cells that were pure text inpaint from
// neighbors. No hand-drawn boxes needed except the two big sea decorations.
const SCRUB_BOXES = [
  [0.10, 0.770, 0.20, 0.840], // sea-rune monsters (SW decoration) -> inpaint (open sea)
  [0.49, 0.740, 0.58, 0.810], // ghost castle (southern sea decoration) -> inpaint
];
// land-label residue (dark-blue drop shadows -> fake inland water) is removed by the
// THIN-LAKE pass below instead: water components not connected to the world ocean that
// are small AND skinny (letter strokes) become land; real inland lakes (Blabek's holes,
// Greyhills' lake) are blobby/big and survive.

if (!fs.existsSync(SRC)) throw new Error('planet art not found: ' + SRC);
// full-resolution read (2048x2048) — we classify at native res so text pixels can be
// recognized and DROPPED before each macro cell votes
const FW = 2048, FH = 2048;
const tmp = path.join(ROOT, 'pm-import.ppm');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', SRC, '-vf', 'scale=' + FW + ':' + FH, '-frames:v', '1', '-pix_fmt', 'rgb24', tmp]);
const buf = fs.readFileSync(tmp);
let i = 0; const fields = [];
while (fields.length < 4) {
  let s = '';
  while (buf[i] === 32 || buf[i] === 10 || buf[i] === 13 || buf[i] === 9) i++;
  if (buf[i] === 35) { while (buf[i] !== 10) i++; continue; }
  while (i < buf.length && buf[i] !== 32 && buf[i] !== 10 && buf[i] !== 13 && buf[i] !== 9) { s += String.fromCharCode(buf[i]); i++; }
  fields.push(s);
}
i++;
if (+fields[1] !== FW || +fields[2] !== FH) throw new Error('ppm dims mismatch');

// pass 1: per-pixel classify at full res, dropping text-signature pixels
// (terrain is warm or blue; text is NEUTRAL bright/dark)
const UNK = 255;
const SUB = FW / W; // 4 subpixels per macro cell edge
const raw = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const votes = [0, 0, 0, 0];
    let kept = 0;
    for (let sy = 0; sy < SUB; sy++) for (let sx = 0; sx < SUB; sx++) {
      const p = (y * SUB + sy) * FW + (x * SUB + sx);
      const r = buf[i + p * 3], g = buf[i + p * 3 + 1], b = buf[i + p * 3 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const neutral = mx - mn < 28;
      // drop text signatures: white lettering + its gray antialiasing (sea base grays
      // sit at mn~140 and survive; the glow ring may drop but sea still wins the vote)
      // and black outlines
      if (neutral && (mn > 150 || mx < 75)) continue;
      let best = 0, bd = Infinity;
      for (const [[ar, ag, ab], cls] of ANCHORS) {
        const d = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2;
        if (d < bd) { bd = d; best = cls; }
      }
      votes[best]++; kept++;
    }
    if (!kept) { raw[y * W + x] = UNK; continue; }
    let cls = 0, most = -1;
    for (let c = 0; c < 4; c++) if (votes[c] > most) { most = votes[c]; cls = c; }
    raw[y * W + x] = cls;
  }
}
// decoration scrub: mark boxes UNKNOWN then inpaint from real neighbors (open-sea art)
for (const [x0, y0, x1, y1] of SCRUB_BOXES) {
  for (let y = Math.floor(y0 * H); y < Math.ceil(y1 * H); y++)
    for (let x = Math.floor(x0 * W); x < Math.ceil(x1 * W); x++) raw[y * W + x] = UNK;
}
let unknowns = 1, guard = 0;
while (unknowns > 0 && guard++ < 200) {
  unknowns = 0;
  const next = new Uint8Array(raw);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (raw[y * W + x] !== UNK) continue;
    const votes = [0, 0, 0, 0];
    let known = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = Math.min(H - 1, Math.max(0, y + dy)), xx = Math.min(W - 1, Math.max(0, x + dx));
      const c = raw[yy * W + xx];
      if (c !== UNK) { votes[c]++; known++; }
    }
    if (!known) { unknowns++; continue; }
    let cls2 = 0, most = -1;
    for (let c = 0; c < 4; c++) if (votes[c] > most) { most = votes[c]; cls2 = c; }
    next[y * W + x] = cls2;
  }
  raw.set(next);
  // recount remaining unknowns
  unknowns = 0;
  for (let p = 0; p < W * H; p++) if (raw[p] === UNK) unknowns++;
}
if (unknowns) throw new Error('inpaint did not converge: ' + unknowns + ' unknown cells');
// ice gate: any ice south of y=0.34 (below the polar band + Tern's snowcap) is text residue -> land
for (let y = Math.floor(0.34 * H); y < H; y++)
  for (let x = 0; x < W; x++) if (raw[y * W + x] === 3) raw[y * W + x] = 1;

// THIN-LAKE pass: flood the world ocean from the map border, then examine every
// unconnected water component — small AND skinny ones are label-shadow residue -> land
{
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
  for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (seen[p] || raw[p] !== 0) continue;
    seen[p] = 1;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }
  let filled = 0;
  for (let p0 = 0; p0 < W * H; p0++) {
    if (raw[p0] !== 0 || seen[p0]) continue;
    // collect this inland component
    const comp = [p0]; seen[p0] = 1;
    let minX = W, maxX = 0, minY = H, maxY = 0;
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k], x = p % W, y = (p / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H) continue;
        if (Math.abs((q % W) - x) > 1) continue;
        if (!seen[q] && raw[q] === 0) { seen[q] = 1; comp.push(q); }
      }
    }
    const minDim = Math.min(maxX - minX + 1, maxY - minY + 1);
    // skinny strokes only — blobby inland lakes (Blabek!) must survive. Remaining bold-letter
    // ghosts disappear when the founder's LABEL-FREE export replaces art/planet-map.jpg.
    if (comp.length <= 14 && minDim <= 2) { for (const p of comp) raw[p] = 1; filled += comp.length; }
  }
  console.log('thin-lake pass: filled ' + filled + ' letter-residue water cells');
}

// pass 2: 3x3 mode filter (kills text, grid lines, glow rings)
const smooth = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const votes = [0, 0, 0, 0];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const yy = Math.min(H - 1, Math.max(0, y + dy)), xx = Math.min(W - 1, Math.max(0, x + dx));
    votes[raw[yy * W + xx]]++;
  }
  let cls = 0, most = -1;
  for (let c = 0; c < 4; c++) if (votes[c] > most) { most = votes[c]; cls = c; }
  smooth[y * W + x] = cls;
}

// pass 3: ice erosion — ice survives only with >=6 ice neighbors (letters die, glaciers live)
const cls = new Uint8Array(smooth);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (smooth[y * W + x] !== 3) continue;
  let icey = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const yy = Math.min(H - 1, Math.max(0, y + dy)), xx = Math.min(W - 1, Math.max(0, x + dx));
    if (smooth[yy * W + xx] === 3) icey++;
  }
  if (icey < 6) cls[y * W + x] = 0; // stray white over sea = sea; over land the mode filter already voted
}

// RLE encode rows: "class:runlength," (tiny + human-checkable)
const rows = [];
for (let y = 0; y < H; y++) {
  let row = '', cur = cls[y * W], run = 0;
  for (let x = 0; x < W; x++) {
    if (cls[y * W + x] === cur) { run++; continue; }
    row += cur + ':' + run + ','; cur = cls[y * W + x]; run = 1;
  }
  rows.push(row + cur + ':' + run);
}

const counts = [0, 0, 0, 0];
for (let p = 0; p < W * H; p++) counts[cls[p]]++;
fs.writeFileSync(path.join(ROOT, 'seas', 'planet-macro.json'), JSON.stringify({
  note: 'PLANET macro from art/planet-map.jpg — classes ocean/land/ridge/ice, RLE rows. Regenerate: node tools/import-planet-macro.cjs',
  W, H, cols: COLS, rows: ROWS, colOff: COL_OFF, rowOff: ROW_OFF,
  classes: CLASSES, importedAt: new Date().toISOString(), rle: rows,
}));

// preview png
const out = Buffer.alloc(W * H * 3);
for (let p = 0; p < W * H; p++) {
  const c = PREVIEW_COLORS[cls[p]];
  out[p * 3] = c[0]; out[p * 3 + 1] = c[1]; out[p * 3 + 2] = c[2];
}
const outPpm = path.join(ROOT, 'pm-classified.ppm');
fs.writeFileSync(outPpm, Buffer.concat([Buffer.from('P6\n' + W + ' ' + H + '\n255\n'), out]));
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', outPpm, '-vf', 'scale=1024:1024:flags=neighbor', path.join(ROOT, 'seas', 'planet-macro-preview.png')]);
fs.unlinkSync(tmp); fs.unlinkSync(outPpm);

console.log('classes %:', CLASSES.map((c, k) => c + ' ' + (counts[k] / (W * H) * 100).toFixed(1)).join(' | '));
const kb = Math.round(fs.statSync(path.join(ROOT, 'seas', 'planet-macro.json')).size / 1024);
console.log('wrote seas/planet-macro.json (' + kb + 'KB) + seas/planet-macro-preview.png');
