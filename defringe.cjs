// Erase border-connected near-WHITE fringe/remnants left by background cutting.
// Floods from the image edge through transparent pixels; whenever it touches an
// opaque near-white pixel adjacent to that bg, it erases it and keeps going inward,
// stopping at real object colors (wood/stone/moss). Interior light pixels (hoops,
// highlights, moss) are NOT border-connected so they survive. Backs up to .bak3.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const DIR = 'C:/Users/bigji/Documents/MfT-Launch/site/games/art/acorn';
const FILES = ['barrel.png', 'statue-1.png', 'statue-2.png', 'statue-3.png'];
const A = 16;           // alpha < A = transparent
const MINCH = 200;      // near-white: every channel >= this
const MAXSAT = 38;      // and low saturation (max-min <= this) => whitish/grey, not colored

for (const f of FILES) {
  const fp = path.join(DIR, f);
  if (!fs.existsSync(fp)) { console.log('skip (missing): ' + f); continue; }
  const bak = fp + '.bak3';
  if (!fs.existsSync(bak)) fs.copyFileSync(fp, bak);
  const png = PNG.sync.read(fs.readFileSync(fp));
  const w = png.width, h = png.height, d = png.data;
  const ix = (x, y) => (y * w + x) * 4;
  const clear = (i) => d[i + 3] < A;
  const white = (i) => {
    if (d[i + 3] < A) return false;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= MINCH && (mx - mn) <= MAXSAT;
  };
  const seen = new Uint8Array(w * h);
  const q = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = y * w + x; if (seen[o]) return; seen[o] = 1; q.push(x, y); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  let removed = 0, head = 0;
  while (head < q.length) {
    const x = q[head++], y = q[head++], i = ix(x, y);
    if (clear(i)) {
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    } else if (white(i)) {
      d[i + 3] = 0; removed++;
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    } // else real object color: stop spreading here
  }
  fs.writeFileSync(fp, PNG.sync.write(png));
  console.log(f + ': ' + w + 'x' + h + '  near-white fringe removed=' + removed);
}
console.log('done');
