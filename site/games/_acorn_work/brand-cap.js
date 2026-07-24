// Composite a keyed logo onto the FRONT of a keyed cap, centered, sized to a
// fraction of the cap width. Optionally crop the cap to a top fraction first
// (used to turn the full blue acorn into a cap dome).
// Usage:
//   node brand-cap.js <cap.png> <logo.png> <out.png> [logoFracW=0.46] [logoCY=0.50] [cropTopFrac=1.0]
// All coords are fractions of the (post-crop) cap box.
const fs = require('fs');
const { PNG } = require('C:/Users/bigji/Documents/MfT-Launch/node_modules/pngjs');
const capP = process.argv[2], logoP = process.argv[3], outP = process.argv[4];
const FRACW = parseFloat(process.argv[5] || '0.46');
const CY    = parseFloat(process.argv[6] || '0.50');
const CROP  = parseFloat(process.argv[7] || '1.0');

let cap = PNG.sync.read(fs.readFileSync(capP));
// optional crop to top CROP fraction (keep [0 .. CROP*H))
if (CROP < 0.999) {
  const nh = Math.max(1, Math.round(cap.height * CROP));
  const c2 = new PNG({ width: cap.width, height: nh });
  for (let p = 0; p < cap.width * nh; p++) { const i = p<<2; c2.data[i]=cap.data[i];c2.data[i+1]=cap.data[i+1];c2.data[i+2]=cap.data[i+2];c2.data[i+3]=cap.data[i+3]; }
  // re-trim vertically after crop
  cap = c2;
}
const CW = cap.width, CH = cap.height, cd = cap.data;
const logo = PNG.sync.read(fs.readFileSync(logoP));
const LW = logo.width, LH = logo.height, ld = logo.data;

// target logo size
const tw = Math.round(CW * FRACW);
const th = Math.round(tw * LH / LW);
const ox = Math.round(CW * 0.5 - tw / 2);
const oy = Math.round(CH * CY - th / 2);

// nearest-neighbour sample of logo, alpha-over onto cap
for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
  const dx = ox + x, dy = oy + y;
  if (dx < 0 || dy < 0 || dx >= CW || dy >= CH) continue;
  const sx = Math.min(LW-1, Math.floor(x * LW / tw)), sy = Math.min(LH-1, Math.floor(y * LH / th));
  const si = (sy*LW+sx)<<2; const a = ld[si+3]/255;
  if (a <= 0.02) continue;
  // only draw the logo where the cap is solid (so it stays ON the cap, not floating in air)
  const di = (dy*CW+dx)<<2;
  if (cd[di+3] < 24) continue;
  cd[di]   = Math.round(ld[si]   * a + cd[di]   * (1-a));
  cd[di+1] = Math.round(ld[si+1] * a + cd[di+1] * (1-a));
  cd[di+2] = Math.round(ld[si+2] * a + cd[di+2] * (1-a));
  cd[di+3] = 255;
}

fs.writeFileSync(outP, PNG.sync.write(cap));
console.error(`  branded ${outP}: cap ${CW}x${CH}, logo ${tw}x${th} @ (${ox},${oy})`);
