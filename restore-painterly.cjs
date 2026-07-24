// After flood-cutting the painterly run frames, reuse them for jump and mirror all 4 to face right.
const fs = require('fs');
const { PNG } = require('pngjs');
const G = 'C:/Users/bigji/Documents/MfT-Launch/site/games/art/acorn/';
fs.copyFileSync(G + 'acornboy-run.png', G + 'acornboy-jump.png');
fs.copyFileSync(G + 'acorngirl-run.png', G + 'acorngirl-jump.png');
function mirror(fp) {
  const png = PNG.sync.read(fs.readFileSync(fp));
  const w = png.width, h = png.height, d = png.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < (w >> 1); x++) {
    const l = (y * w + x) * 4, r = (y * w + (w - 1 - x)) * 4;
    for (let k = 0; k < 4; k++) { const t = d[l + k]; d[l + k] = d[r + k]; d[r + k] = t; }
  }
  fs.writeFileSync(fp, PNG.sync.write(png));
  console.log('mirrored ' + fp.split('/').pop() + ' ' + w + 'x' + h);
}
['acornboy-run.png', 'acorngirl-run.png', 'acornboy-jump.png', 'acorngirl-jump.png'].forEach(f => mirror(G + f));
console.log('painterly restored');
