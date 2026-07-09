// node tools/import-map-paint.cjs [--src art/world-map.jpg] [--sheet 0,0]
//
// THE MAP IMPORTER — turns the founder's hand-drawn map art into terrain PAINT
// (founder 2026-07-08: "what about using my world map as a base for this generation?").
//
// HOW: ffmpeg downsamples the painting to SHEET_W x SHEET_H (256x192) so 1 pixel = 1 hex
// (world-map.jpg is 2048x1536 = exactly 8px per hex), then every pixel is classified to
// the nearest ANCHOR color -> biome. Output:
//   seas/world-paint.json          { sheet, hexes: { "col,row": { biome } } }  (paint layer)
//   seas/world-paint-preview.png   the classified map rendered in biome colors (eyeball it
//                                  next to the painting; tune ANCHORS and re-run)
// Ocean hexes are OMITTED from the paint (procgen ocean under them is ocean anyway and it
// keeps the file small) — only land/shallows/reef/lake hexes are pinned.
//
// This scales the painted archipelago UP to subcontinent scale: 1 hex = 1 day on foot,
// so the drawn islands become genuinely days apart — the "bigger tutorial" for free.
// Re-runnable any time the founder repaints; the paint file is canon the day we ship it.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SRC = path.join(ROOT, arg('--src', 'art/world-map.jpg'));
const [SX, SY] = arg('--sheet', '0,0').split(',').map(Number);
const W = 256, H = 192;

// ── color anchors: nearest RGB wins. TUNE THESE against world-paint-preview.png ──────
const ANCHORS = [
  // waters (his seas run dark->light toward coasts)
  [[20, 60, 110], 'deep-ocean'], [[24, 80, 150], 'deep-ocean'], [[40, 95, 160], 'deep-ocean'],
  [[48, 110, 185], 'deep-ocean'],
  [[70, 135, 205], 'shallows'], [[90, 155, 220], 'shallows'], [[120, 175, 230], 'shallows'],
  // island ground: parchment golds = dry grass, richer tans = beach sand
  [[205, 185, 130], 'beach'], [[225, 205, 150], 'beach'],
  [[170, 145, 55], 'grassland'], [[150, 125, 55], 'grassland'], [[185, 160, 80], 'grassland'],
  // olives and greens
  [[100, 100, 50], 'savanna'], [[80, 80, 45], 'savanna'],
  [[55, 75, 30], 'forest'], [[40, 60, 25], 'forest'], [[70, 95, 40], 'forest'],
  [[30, 75, 45], 'jungle'],
  // browns up the slopes
  [[120, 95, 50], 'hills'], [[140, 115, 70], 'hills'],
  [[95, 75, 45], 'mountains'], [[75, 60, 40], 'mountains'],
  [[230, 230, 225], 'peaks'], // snowcaps if painted
  [[60, 70, 65], 'swamp'],
];
const COLORS = { // render colors for the preview png (match terrain-preview.html)
  'deep-ocean': [22, 64, 95], 'shallows': [46, 127, 174], 'reef': [70, 181, 164], 'lake': [63, 143, 191],
  'beach': [229, 217, 168], 'grassland': [169, 196, 108], 'savanna': [205, 189, 106], 'forest': [75, 122, 61],
  'jungle': [46, 107, 52], 'desert': [221, 201, 138], 'swamp': [93, 114, 99], 'hills': [176, 154, 91],
  'mountains': [135, 125, 112], 'peaks': [236, 234, 228], 'volcanic': [107, 63, 58], 'pillars': [196, 164, 132],
};

if (!fs.existsSync(SRC)) throw new Error('source art not found: ' + SRC);
const tmp = path.join(ROOT, 'wm-import.ppm');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', SRC, '-vf', 'scale=' + W + ':' + H, '-frames:v', '1', '-pix_fmt', 'rgb24', tmp]);
const buf = fs.readFileSync(tmp);

// parse P6
let i = 0; const fields = [];
while (fields.length < 4) {
  let s = '';
  while (buf[i] === 32 || buf[i] === 10 || buf[i] === 13 || buf[i] === 9) i++;
  if (buf[i] === 35) { while (buf[i] !== 10) i++; continue; }
  while (i < buf.length && buf[i] !== 32 && buf[i] !== 10 && buf[i] !== 13 && buf[i] !== 9) { s += String.fromCharCode(buf[i]); i++; }
  fields.push(s);
}
i++;
if (+fields[1] !== W || +fields[2] !== H) throw new Error('ppm dims mismatch');

function classify(r, g, b) {
  let best = null, bd = Infinity;
  for (const [[ar, ag, ab], biome] of ANCHORS) {
    const d = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2;
    if (d < bd) { bd = d; best = biome; }
  }
  return best;
}

const hexes = {}; const counts = {};
const out = Buffer.alloc(W * H * 3);
for (let p = 0; p < W * H; p++) {
  const r = buf[i + p * 3], g = buf[i + p * 3 + 1], b = buf[i + p * 3 + 2];
  const biome = classify(r, g, b);
  counts[biome] = (counts[biome] || 0) + 1;
  const col = SX * W + (p % W), row = SY * H + Math.floor(p / W);
  if (biome !== 'deep-ocean') hexes[col + ',' + row] = { biome }; // ocean = procgen's anyway
  const c = COLORS[biome];
  out[p * 3] = c[0]; out[p * 3 + 1] = c[1]; out[p * 3 + 2] = c[2];
}

const paintPath = path.join(ROOT, 'seas', 'world-paint.json');
fs.writeFileSync(paintPath, JSON.stringify({
  note: 'PAINT imported from ' + path.basename(SRC) + ' — 1px = 1 hex, sheet (' + SX + ',' + SY + '). Founder art is canon; regenerate with tools/import-map-paint.cjs.',
  sheet: { sx: SX, sy: SY }, importedAt: new Date().toISOString(), hexes,
}));

const outPpm = path.join(ROOT, 'wm-classified.ppm');
fs.writeFileSync(outPpm, Buffer.concat([Buffer.from('P6\n' + W + ' ' + H + '\n255\n'), out]));
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', outPpm, '-vf', 'scale=1024:768:flags=neighbor', path.join(ROOT, 'seas', 'world-paint-preview.png')]);
fs.unlinkSync(tmp); fs.unlinkSync(outPpm);

const total = W * H;
const pct = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, +(n / total * 100).toFixed(1)]));
console.log('classified:', JSON.stringify(pct));
console.log('painted hexes (non-deep-ocean):', Object.keys(hexes).length, 'of', total);
console.log('wrote seas/world-paint.json + seas/world-paint-preview.png');
