// Mirror the run + jump frames horizontally so they face right (match idle).
const fs = require('fs');
const { PNG } = require('pngjs');
const DIR = 'C:/Users/bigji/Documents/MfT-Launch/site/games/art/acorn/';
const FILES = ['acornboy-run.png', 'acorngirl-run.png', 'acornboy-jump.png', 'acorngirl-jump.png'];
for (const f of FILES) {
  const fp = DIR + f;
  if (!fs.existsSync(fp)) { console.log('skip ' + f); continue; }
  const png = PNG.sync.read(fs.readFileSync(fp));
  const w = png.width, h = png.height, d = png.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < (w >> 1); x++) {
    const l = (y * w + x) * 4, r = (y * w + (w - 1 - x)) * 4;
    for (let k = 0; k < 4; k++) { const t = d[l + k]; d[l + k] = d[r + k]; d[r + k] = t; }
  }
  fs.writeFileSync(fp, PNG.sync.write(png));
  console.log('mirrored ' + f + ' ' + w + 'x' + h);
}
console.log('done');
