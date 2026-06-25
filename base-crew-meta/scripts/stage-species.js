// ============================================================
//  scripts/stage-species.js — cut the green/magenta screen off the real species
//  body art (from Downloads) and write clean transparent PNGs into the crew render
//  service's species asset dir (assets/base/<species>/<species>boy.png ... and the
//  default human/dwarf etc.). One-shot art-pipeline step; safe to re-run.
//
//  Each source is a full-body front-facing paper-doll on a flat key-out background:
//      human  -> bright GREEN screen   (key green)
//      dwarf  -> MAGENTA               (key magenta)
//      elf    -> MAGENTA               (key magenta)
//      goblin -> MAGENTA               (key magenta)  [Redrum Raiders]
//      orc    -> MAGENTA               (key magenta)
//
//  We chroma-key by distance from a sampled background color (corner pixel) in RGB,
//  with a tolerance + a soft edge band, then write RGBA. The goblin/orc skins are
//  green-ish but the background is MAGENTA, so keying magenta never touches skin.
//  The human background is bright green and the human has NO green on the body, so
//  keying green is clean. This is the same "cut the screen clean" requirement the
//  acorn base has — done here in-pipeline instead of left as a TODO.
// ============================================================
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DOWNLOADS = 'C:\\Users\\bigji\\Downloads';
const ASSETS = path.join(__dirname, '..', 'assets');

// species -> { src jpg, key background ('green'|'magenta'), genders it fills }.
// These dolls are a single body; we write it as BOTH boy + girl for now (one art
// per species) so the gender-split layout still resolves. Drop a girl variant
// later and point body.girl at it in asset-manifest.js + here.
const JOBS = [
  { species: 'human',  src: 'eDQQl.jpg', key: 'green' },
  { species: 'dwarf',  src: '6Wpnn.jpg', key: 'magenta' },
  { species: 'elf',    src: 'U6fAf.jpg', key: 'magenta' },
  { species: 'goblin', src: 'gha1D.jpg', key: 'magenta' },
  { species: 'orc',        src: 'cuXiQ.jpg', key: 'magenta' },
  { species: 'dragonborn', src: 'xrp6v.jpg', key: 'magenta' },
];

// chroma-key: make pixels near `bg` transparent. tol = hard cut radius, soft = the
// extra band that fades alpha 1->0 (anti-aliased edge). Distance is plain RGB L2.
// `key` ('green'|'magenta') drives a DESPILL on edge pixels: the screen's dominant
// channel(s) get clamped toward the others, killing the coloured fringe halo.
async function keyOut(srcFile, bg, key, tol = 70, soft = 55) {
  const { data, info } = await sharp(srcFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels; // 4
  const out = Buffer.from(data);
  const [br, bgc, bb] = bg;
  for (let i = 0; i < out.length; i += ch) {
    const dr = out[i] - br, dg = out[i + 1] - bgc, db = out[i + 2] - bb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= tol) {
      out[i + 3] = 0;                 // fully background -> transparent
      continue;
    }
    if (dist <= tol + soft) {
      out[i + 3] = Math.round(((dist - tol) / soft) * out[i + 3]); // edge fade
      // despill the residual screen colour on this semi-transparent edge pixel
      const r = out[i], g = out[i + 1], b = out[i + 2];
      if (key === 'green') {
        // clamp green spill: green can't exceed the max of red/blue
        const cap = Math.max(r, b);
        if (g > cap) out[i + 1] = cap;
      } else { // magenta = high red + high blue, low green -> clamp red & blue to green-ish
        const cap = Math.max(g, Math.round((r + b) / 2) - 30);
        if (r > cap && b > cap) { out[i] = Math.min(r, cap + 20); out[i + 2] = Math.min(b, cap + 20); }
      }
    }
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: ch } }).png().toBuffer();
}

// Sample a robust background color = median of the 4 corners.
async function sampleBg(srcFile) {
  const { data, info } = await sharp(srcFile).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const at = (x, y) => { const k = (y * info.width + x) * ch; return [data[k], data[k + 1], data[k + 2]]; };
  const pts = [at(3, 3), at(info.width - 4, 3), at(3, info.height - 4), at(info.width - 4, info.height - 4)];
  const med = (j) => pts.map(p => p[j]).sort((a, b) => a - b)[1];
  return [med(0), med(1), med(2)];
}

(async () => {
  const report = [];
  for (const job of JOBS) {
    const src = path.join(DOWNLOADS, job.src);
    if (!fs.existsSync(src)) { report.push(`MISSING source ${job.src} for ${job.species}`); continue; }
    const bg = await sampleBg(src);
    const png = await keyOut(src, bg, job.key);
    const dir = path.join(ASSETS, 'base', job.species);
    fs.mkdirSync(dir, { recursive: true });
    // write the single doll as both boy + girl (one art per species for now)
    for (const g of ['boy', 'girl']) {
      fs.writeFileSync(path.join(dir, job.species + g + '.png'), png);
    }
    const hex = bg.map(v => v.toString(16).padStart(2, '0')).join('');
    report.push(`${job.species}: keyed ${job.key} (bg #${hex}) -> assets/base/${job.species}/${job.species}{boy,girl}.png`);
  }
  console.log(report.join('\n'));
})().catch(e => { console.error('stage-species FAILED:', e); process.exit(1); });
