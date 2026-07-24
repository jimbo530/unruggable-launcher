// Fix Acorn sprite art: (1) fill ENCLOSED transparent holes left by background-key cutting
// (real edges + cracks that reach the silhouette are border-connected => preserved),
// (2) mirror the run frames horizontally so they face the same way as idle/jump.
// Backs up each file to <name>.bak2 first. Reversible.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const DIR = 'C:/Users/bigji/Documents/MfT-Launch/site/games/art/acorn';
const TARGETS = [
  { file: 'acornboy-run.png',  mirror: true },
  { file: 'acorngirl-run.png', mirror: true },
  { file: 'statue-1.png', mirror: false },
  { file: 'statue-2.png', mirror: false },
  { file: 'statue-3.png', mirror: false },
  { file: 'barrel.png',   mirror: false },
];
const A = 16; // alpha < A counts as transparent

function fillHoles(png) {
  const w = png.width, h = png.height, data = png.data;
  const ai = (x, y) => (y * w + x) * 4 + 3;
  const isT = (x, y) => data[ai(x, y)] < A;
  const outside = new Uint8Array(w * h);
  const st = [];
  for (let x = 0; x < w; x++) { if (isT(x, 0)) st.push(x, 0); if (isT(x, h - 1)) st.push(x, h - 1); }
  for (let y = 0; y < h; y++) { if (isT(0, y)) st.push(0, y); if (isT(w - 1, y)) st.push(w - 1, y); }
  while (st.length) {
    const y = st.pop(), x = st.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const o = y * w + x;
    if (outside[o] || !isT(x, y)) continue;
    outside[o] = 1;
    st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  let holes = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (isT(x, y) && !outside[y * w + x]) holes.push([x, y]);
  }
  const total = holes.length;
  let guard = 0;
  while (holes.length && guard++ < 100000) {
    const next = [];
    for (const [x, y] of holes) {
      let s = -1;
      const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [a, b] of nb) {
        if (a < 0 || b < 0 || a >= w || b >= h) continue;
        if (data[ai(a, b)] >= A) { s = (b * w + a) * 4; break; }
      }
      if (s >= 0) {
        const d = (y * w + x) * 4;
        data[d] = data[s]; data[d + 1] = data[s + 1]; data[d + 2] = data[s + 2]; data[d + 3] = 255;
      } else next.push([x, y]);
    }
    if (next.length === holes.length) break; // no progress
    holes = next;
  }
  return total;
}

function mirrorX(png) {
  const w = png.width, h = png.height, data = png.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < (w >> 1); x++) {
    const l = (y * w + x) * 4, r = (y * w + (w - 1 - x)) * 4;
    for (let k = 0; k < 4; k++) { const t = data[l + k]; data[l + k] = data[r + k]; data[r + k] = t; }
  }
}

for (const t of TARGETS) {
  const fp = path.join(DIR, t.file);
  if (!fs.existsSync(fp)) { console.log('SKIP (missing): ' + t.file); continue; }
  const bak = fp + '.bak2';
  if (!fs.existsSync(bak)) fs.copyFileSync(fp, bak);
  const png = PNG.sync.read(fs.readFileSync(fp));
  const holes = fillHoles(png);
  if (t.mirror) mirrorX(png);
  fs.writeFileSync(fp, PNG.sync.write(png));
  console.log(t.file + ': ' + png.width + 'x' + png.height + '  holes_filled=' + holes + (t.mirror ? '  +mirrored' : ''));
}
console.log('done');
