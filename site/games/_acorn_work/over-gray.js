// Composite a transparent PNG over a neutral gray background so the Read tool
// shows the true silhouette/alpha (not the deceptive transparency checkerboard).
// Usage: node over-gray.js <in.png> <out.png> [grayLevel]
const fs = require('fs');
const { PNG } = require('C:/Users/bigji/Documents/MfT-Launch/node_modules/pngjs');
const inP = process.argv[2], outP = process.argv[3];
const G = parseInt(process.argv[4] || '128', 10);
const p = PNG.sync.read(fs.readFileSync(inP));
const o = new PNG({ width: p.width, height: p.height });
for (let i = 0; i < p.data.length; i += 4) {
  const a = p.data[i + 3] / 255;
  o.data[i]   = Math.round(p.data[i]   * a + G * (1 - a));
  o.data[i+1] = Math.round(p.data[i+1] * a + G * (1 - a));
  o.data[i+2] = Math.round(p.data[i+2] * a + G * (1 - a));
  o.data[i+3] = 255;
}
fs.writeFileSync(outP, PNG.sync.write(o));
console.error('wrote', outP, p.width + 'x' + p.height);
