// Border-flood HSV-band keyer for the painterly Acorn NFT characters.
//
// THE HARD PART: the tan/linen background is textured + vignetted and shares its
// HUE with the cream face, so neither a global colour-distance key nor a local
// gradient walk is robust. Instead we classify each pixel as "linen" by its
// MEASURED HSV BAND (warm tan hue, the desaturated/dark weave), then border-flood
// across only linen pixels. The face is carved out of the band by a single rule:
// linen is never BOTH bright AND saturated (that combination is the peach face).
//
// Measured linen band (boy+girl, p02..p98):
//   hue 24..35, sat 0.25..0.52, value 113..210
//   face: sat 0.46..0.56 AND value 195..220  <-- excluded
//   dark outlines/figure detail: value < ~75 <-- excluded
//
// Pipeline: border-flood linen -> kill red seal -> despeckle to largest blob
//           -> hole-fill enclosed interior -> 1px erode (halo) -> feather -> trim.
//
// Usage: node key.js <in.png> <out.png> [erode]
// Env (tunables, all optional):
//   HUE_LO=18 HUE_HI=42  SAT_MAX=0.60  VAL_LO=60 VAL_HI=235
//   FACE_SAT=0.44 FACE_VAL=182   (pixels >= both are protected as face)
//   DEBUG=1  -> writes <out>.flood.png and <out>.mask.png

const fs = require('fs');
const { PNG } = require('C:/Users/bigji/Documents/MfT-Launch/node_modules/pngjs');

const inPath  = process.argv[2];
const outPath = process.argv[3];
const ERODE   = parseInt(process.argv[4] || '1', 10);
const DEBUG = process.env.DEBUG === '1';
const E = (k, def) => parseFloat(process.env[k] !== undefined ? process.env[k] : def);
const HUE_LO = E('HUE_LO', 18), HUE_HI = E('HUE_HI', 42);
const SAT_MAX = E('SAT_MAX', 0.60), VAL_LO = E('VAL_LO', 60), VAL_HI = E('VAL_HI', 235);
const FACE_SAT = E('FACE_SAT', 0.44), FACE_VAL = E('FACE_VAL', 182);

const png = PNG.sync.read(fs.readFileSync(inPath));
const W = png.width, H = png.height, d = png.data;
const idx = (x, y) => (y * W + x) << 2;

function hsv(i) {
  let r = d[i] / 255, g = d[i+1] / 255, b = d[i+2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
  let h = 0;
  if (c) { if (mx === r) h = ((g - b) / c + 6) % 6; else if (mx === g) h = (b - r) / c + 2; else h = (r - g) / c + 4; h *= 60; }
  return [h, mx === 0 ? 0 : c / mx, mx * 255];
}
function isReddish(i) { const [h, s] = hsv(i); const r = d[i], g = d[i+1], b = d[i+2]; return r > 120 && r > g + 25 && r > b + 25 && s > 0.30; }

// ---- local texture map (5x5 luma std-dev) ----
// THE KEY discriminator for the face: the cream face shares linen's colour but is
// SMOOTH, while the linen weave is high-frequency textured. Measured std-dev:
//   face ~3-8, linen ~13-23, cap ~12-23. We protect smooth band-coloured pixels
//   (the face/skin/smooth cloth) from being keyed as linen.
// TEX_MIN may be forced via env; otherwise it is computed ADAPTIVELY below from
// the actual linen weave texture (some crops have a much smoother weave than
// others, so a fixed threshold either leaves moth-eaten linen or eats the face).
let TEX_MIN = process.env.TEX_MIN !== undefined ? parseFloat(process.env.TEX_MIN) : null;
const texStd = new Float32Array(W * H);
{
  // integral images of luma and luma^2 for O(1) window std-dev
  const SI = new Float64Array((W + 1) * (H + 1));
  const SI2 = new Float64Array((W + 1) * (H + 1));
  const SW = W + 1;
  for (let y = 0; y < H; y++) {
    let rs = 0, rs2 = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) << 2;
      const L = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      rs += L; rs2 += L * L;
      SI[(y+1)*SW + (x+1)] = SI[y*SW + (x+1)] + rs;
      SI2[(y+1)*SW + (x+1)] = SI2[y*SW + (x+1)] + rs2;
    }
  }
  const R = 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(W - 1, x + R), y1 = Math.min(H - 1, y + R);
    const n = (x1 - x0 + 1) * (y1 - y0 + 1);
    const A = (yy, xx) => yy * SW + xx;
    const sum = SI[A(y1+1,x1+1)] - SI[A(y0,x1+1)] - SI[A(y1+1,x0)] + SI[A(y0,x0)];
    const sum2 = SI2[A(y1+1,x1+1)] - SI2[A(y0,x1+1)] - SI2[A(y1+1,x0)] + SI2[A(y0,x0)];
    const m = sum / n;
    texStd[y * W + x] = Math.sqrt(Math.max(0, sum2 / n - m * m));
  }
}

// Adaptive TEX_MIN: sample the border-ring weave texture, set the threshold below
// the linen cluster (so all weave is keyed) but above the smooth face (face std is
// always far lower than its own image's linen). 0.6 * 25th-pct linen std, clamped.
if (TEX_MIN === null) {
  const m = Math.round(0.03 * Math.min(W, H));
  const vals = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (x > m && x < W - 1 - m && y > m && y < H - 1 - m) continue; // border ring only
    vals.push(texStd[y * W + x]);
  }
  vals.sort((a, b) => a - b);
  const p25 = vals[Math.floor(0.25 * (vals.length - 1))] || 10;
  TEX_MIN = Math.max(5.5, Math.min(11, p25 * 0.7));
  console.error(`  adaptive TEX_MIN=${TEX_MIN.toFixed(1)} (linen border std p25=${p25.toFixed(1)})`);
}

// ---- linen-membership test (absolute, per-pixel) ----
function isLinen(i) {
  const p = i >> 2;
  const [h, s, v] = hsv(i);
  if (h < HUE_LO || h > HUE_HI) return false;     // wrong hue (greens/blues/reds)
  if (s > SAT_MAX) return false;                   // too saturated for tan weave
  if (v < VAL_LO || v > VAL_HI) return false;      // too dark (outline) / too bright
  if (s >= FACE_SAT && v >= FACE_VAL) return false; // bright + saturated => peach face
  if (texStd[p] < TEX_MIN) return false;            // SMOOTH => face/skin/cloth, not weave
  return true;
}

// sample for logging only
{
  let n = 0, hs = 0, ss = 0, vs = 0;
  const m = Math.round(0.03 * Math.min(W, H));
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    if (x > m && x < W - 1 - m && y > m && y < H - 1 - m) continue;
    const i = idx(x, y); if (isReddish(i)) continue;
    const [h, s, v] = hsv(i); hs += h; ss += s; vs += v; n++;
  }
  console.error(`  border linen avg hsv(${(hs/n).toFixed(0)},${(ss/n).toFixed(2)},${(vs/n).toFixed(0)}); band hue[${HUE_LO},${HUE_HI}] sat<=${SAT_MAX} val[${VAL_LO},${VAL_HI}] faceCut(s>=${FACE_SAT}&v>=${FACE_VAL})`);
}

// ---- border flood across linen pixels ----
const bg = new Uint8Array(W * H);
const stack = new Int32Array(W * H);
let sp = 0;
function push(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = y * W + x; if (bg[p]) return;
  if (isLinen(p << 2)) { bg[p] = 1; stack[sp++] = p; }
}
for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
while (sp > 0) { const p = stack[--sp]; const x = p % W, y = (p - x) / W; push(x-1,y); push(x+1,y); push(x,y-1); push(x,y+1); }

function creamCount() { let c = 0; for (let p = 0; p < W*H; p++) { if (bg[p]) continue; const i = p<<2; const r=d[i],g=d[i+1],b=d[i+2]; if (r>175&&g>120&&g<185&&b>70&&b<150&&r>g&&g>b) c++; } return c; }
if (DEBUG) console.error(`    [DEBUG] cream after FLOOD: ${creamCount()}`);

// ---- morphological OPEN on the bg mask (radius R) ----
// The acorn cap's brown weave shares the linen band, so the flood can thread thin
// tendrils up into the cap. Erode the bg mask by R, keep only erosion-survivors
// connected to the border, then dilate back by R. Tendrils thinner than ~2R are
// pinched off and returned to the figure, leaving the cap solid; the wide true
// background is unaffected. R=0 disables.
const OPEN_R = parseInt(process.env.OPEN_R !== undefined ? process.env.OPEN_R : '3', 10);
if (OPEN_R > 0) {
  // distance-from-non-bg via simple multi-pass erosion to depth R
  let er = bg.slice();
  for (let it = 0; it < OPEN_R; it++) {
    const nx = er.slice();
    for (let p = 0; p < W * H; p++) {
      if (!er[p]) continue;
      const x = p % W, y = (p - x) / W;
      if ((x>0 && !er[p-1]) || (x<W-1 && !er[p+1]) || (y>0 && !er[p-W]) || (y<H-1 && !er[p+W])) nx[p] = 0;
    }
    er = nx;
  }
  // keep only eroded bg connected to the border (drops pinched-off interior bg seeds)
  const keep = new Uint8Array(W * H); const q = new Int32Array(W * H); let t = 0;
  function pk(x, y) { if (x<0||y<0||x>=W||y>=H) return; const p = y*W+x; if (keep[p]||!er[p]) return; keep[p]=1; q[t++]=p; }
  for (let x = 0; x < W; x++) { pk(x,0); pk(x,H-1); }
  for (let y = 0; y < H; y++) { pk(0,y); pk(W-1,y); }
  for (let h2 = 0; h2 < t; h2++) { const p = q[h2]; const x = p%W, y=(p-x)/W; pk(x-1,y);pk(x+1,y);pk(x,y-1);pk(x,y+1); }
  // dilate the kept core back by R (only into pixels that were bg originally)
  let dl = keep;
  for (let it = 0; it < OPEN_R; it++) {
    const nx = dl.slice();
    for (let p = 0; p < W * H; p++) {
      if (dl[p]) continue; if (!bg[p]) continue;
      const x = p % W, y = (p - x) / W;
      if ((x>0 && dl[p-1]) || (x<W-1 && dl[p+1]) || (y>0 && dl[p-W]) || (y<H-1 && dl[p+W])) nx[p] = 1;
    }
    dl = nx;
  }
  let reclaimed = 0;
  for (let p = 0; p < W * H; p++) { if (bg[p] && !dl[p]) { bg[p] = 0; reclaimed++; } }
  bg.set(dl);
  console.error(`  morph-open R=${OPEN_R}: reclaimed ${reclaimed}px of figure from linen tendrils`);
}

if (DEBUG) {
  const o = new PNG({ width: W, height: H });
  for (let p = 0; p < W*H; p++) { const i = p<<2; if (bg[p]) { o.data[i]=255;o.data[i+1]=0;o.data[i+2]=0;o.data[i+3]=255; } else { o.data[i]=d[i];o.data[i+1]=d[i+1];o.data[i+2]=d[i+2];o.data[i+3]=255; } }
  fs.writeFileSync(outPath + '.flood.png', PNG.sync.write(o));
  let c=0; for (let p=0;p<W*H;p++) if (bg[p]) c++;
  console.error(`  [DEBUG] flood marked ${c}px (${(100*c/(W*H)).toFixed(1)}%) -> ${outPath}.flood.png`);
}

// ---- kill the red seal stamp ----
// The seal sits on the linen in the bottom-right corner, isolated from the figure.
// The border flood already strips the linen around it, leaving the seal as a small
// non-bg blob that despeckle would drop anyway. To be safe we also explicitly mark
// it bg, but ONLY within the bottom-right corner box and only for true red-ink
// pixels — never the warm CREAM FACE (which is a broad reddish hue too). The old
// global isReddish()+linen expansion ate the whole face; this is corner-scoped.
{
  const SEAL_X = Math.round(W * 0.66), SEAL_Y = Math.round(H * 0.72); // bottom-right box origin
  function isSealInk(i) {
    const r = d[i], g = d[i+1], b = d[i+2];
    // deep red ink: red clearly dominant, green & blue both suppressed
    return r > 110 && r - g > 38 && r - b > 38 && g < 120 && b < 105;
  }
  let removed = 0;
  for (let y = SEAL_Y; y < H; y++) for (let x = SEAL_X; x < W; x++) {
    const p = y * W + x; if (bg[p]) continue;
    if (isSealInk(p << 2)) { bg[p] = 1; removed++; }
  }
  // grow the marked seal into immediately adjacent linen within the same box (clean its halo)
  if (removed) {
    const sealStack = []; for (let y = SEAL_Y; y < H; y++) for (let x = SEAL_X; x < W; x++) { const p = y*W+x; if (bg[p]) sealStack.push(p); }
    let gi = 0;
    while (gi < sealStack.length) {
      const p = sealStack[gi++]; const x = p % W, y = (p - x) / W;
      if (x < SEAL_X || y < SEAL_Y) continue;
      const nb = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
      for (const [nx, ny] of nb) { if (nx < SEAL_X || ny < SEAL_Y || nx >= W || ny >= H) continue; const np = ny*W+nx; if (bg[np]) continue; if (isLinen(np << 2)) { bg[np] = 1; sealStack.push(np); } }
    }
  }
  if (DEBUG) console.error(`    [DEBUG] seal: removed ${removed} ink px (corner box); cream now ${creamCount()}`);
}

// ---- despeckle: keep the largest NON-bg component AND every other component
//      big enough to be a real figure part. The soft cheek/jaw edge can make a
//      flooded ring that disconnects the cream FACE from the body, so dropping
//      all-but-largest would delete the face. Keeping all components >= KEEP_MIN
//      preserves the face/limbs while still removing tiny linen specks. (Safe
//      because, with a clean flood, the background is one border-connected mass
//      that is already bg — every NON-bg component is part of the figure.) ----
{
  const comp = new Int32Array(W * H).fill(-1); const q = new Int32Array(W * H);
  const sizeOf = [];
  let best = -1, bestSize = 0, label = 0;
  for (let p0 = 0; p0 < W * H; p0++) {
    if (bg[p0] || comp[p0] !== -1) continue;
    let head = 0, tail = 0, size = 0; q[tail++] = p0; comp[p0] = label;
    while (head < tail) {
      const p = q[head++]; size++; const x = p % W, y = (p - x) / W;
      const nb = [[x-1,y],[x+1,y],[x,y-1],[x,y+1],[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]];
      for (const [nx, ny] of nb) { if (nx<0||ny<0||nx>=W||ny>=H) continue; const np = ny*W+nx; if (bg[np]||comp[np]!==-1) continue; comp[np]=label; q[tail++]=np; }
    }
    sizeOf[label] = size;
    if (size > bestSize) { bestSize = size; best = label; }
    label++;
  }
  const KEEP_MIN = parseInt(process.env.KEEP_MIN !== undefined ? process.env.KEEP_MIN : '2000', 10);
  let dropped = 0, keptComps = 0;
  for (let p = 0; p < W * H; p++) {
    if (bg[p]) continue;
    const c = comp[p];
    if (c === best || sizeOf[c] >= KEEP_MIN) continue; // keep figure parts
    bg[p] = 1; dropped++;                              // drop tiny specks
  }
  for (let l = 0; l < label; l++) if (l === best || sizeOf[l] >= KEEP_MIN) keptComps++;
  console.error(`  despeckle: ${label} comps, kept ${keptComps} (>=${KEEP_MIN}px; largest=${bestSize}px), dropped ${dropped}px`);
  if (DEBUG) {
    let cr = 0; for (let p = 0; p < W*H; p++) { if (bg[p]) continue; const i = p<<2; const r=d[i],g=d[i+1],b=d[i+2]; if (r>175&&g>120&&g<185&&b>70&&b<150&&r>g&&g>b) cr++; }
    console.error(`    [DEBUG] cream px after despeckle: ${cr}`);
    const o = new PNG({ width: W, height: H }); for (let p=0;p<W*H;p++){const i=p<<2;if(bg[p]){o.data[i]=128;o.data[i+1]=128;o.data[i+2]=128;}else{o.data[i]=d[i];o.data[i+1]=d[i+1];o.data[i+2]=d[i+2];}o.data[i+3]=255;} fs.writeFileSync(outPath+'.despeckle.png', PNG.sync.write(o));
  }
}

// ---- hole-fill: restore bg regions NOT connected to the border (figure interior) ----
// Enclosed bg falls in two classes:
//   (a) tiny scattered pockets = linen-coloured speckles trapped inside a textured
//       mass (the acorn cap) that the flood couldn't reach -> these are CAP and
//       must be filled, else the cap reads moth-eaten/horn-shaped.
//   (b) one large pocket = a genuine background gap sealed off by the figure
//       (between the legs / under an arm) -> keep transparent.
// We label enclosed-bg components and keep a component transparent ONLY if it is
// large (>= POCKET_MIN). Everything smaller is filled back into the figure.
{
  const reach = new Uint8Array(W * H); const q = new Int32Array(W * H); let t = 0;
  function pr(x, y) { if (x<0||y<0||x>=W||y>=H) return; const p = y*W+x; if (reach[p]||!bg[p]) return; reach[p]=1; q[t++]=p; }
  for (let x = 0; x < W; x++) { pr(x,0); pr(x,H-1); }
  for (let y = 0; y < H; y++) { pr(0,y); pr(W-1,y); }
  for (let h2 = 0; h2 < t; h2++) { const p = q[h2]; const x = p%W, y=(p-x)/W; pr(x-1,y);pr(x+1,y);pr(x,y-1);pr(x,y+1); }

  const POCKET_MIN = parseInt(process.env.POCKET_MIN !== undefined ? process.env.POCKET_MIN : '900', 10);
  const comp = new Int32Array(W * H).fill(-1); const q2 = new Int32Array(W * H);
  let filled = 0, keptPocket = 0, keptComps = 0, label = 0;
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!bg[p0] || reach[p0] || comp[p0] !== -1) continue; // only enclosed bg
    let head = 0, tail = 0, size = 0; q2[tail++] = p0; comp[p0] = label; const members = [];
    while (head < tail) {
      const p = q2[head++]; size++; members.push(p);
      const x = p % W, y = (p - x) / W;
      const nb = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
      for (const [nx, ny] of nb) { if (nx<0||ny<0||nx>=W||ny>=H) continue; const np = ny*W+nx; if (!bg[np]||reach[np]||comp[np]!==-1) continue; comp[np]=label; q2[tail++]=np; }
    }
    if (size >= POCKET_MIN) { keptPocket += size; keptComps++; }       // real gap -> keep transparent
    else { for (const p of members) bg[p] = 0; filled += size; }        // cap speckle etc -> fill
    label++;
  }
  console.error(`  hole-fill: restored ${filled}px interior (small pockets), kept ${keptComps} large gaps (${keptPocket}px) transparent`);
}

// ---- scrub residual weave ----
// Any figure pixel that still satisfies isLinen() is, by definition, TEXTURED tan
// weave (the smooth face/skin/cloth fail the texture gate and are safe). These are
// leftover background that got sealed off from the flood (e.g. the linen wedge
// between the diagonal staff and the leg) and re-attached to the figure. Remove
// them. We run this BEFORE morph-close so the cap is re-solidified afterwards.
// Scoped to skip the cap band (top SCRUB_SKIP_TOP of the figure) so the cap's
// textured surface is never re-opened. SCRUB=0 disables.
const SCRUB = parseInt(process.env.SCRUB !== undefined ? process.env.SCRUB : '1', 10);
if (SCRUB) {
  // figure vertical extent
  let fyMin = H, fyMax = -1;
  for (let p = 0; p < W * H; p++) if (!bg[p]) { const y = (p / W) | 0; if (y < fyMin) fyMin = y; if (y > fyMax) fyMax = y; }
  const SKIP = parseFloat(process.env.SCRUB_SKIP_TOP !== undefined ? process.env.SCRUB_SKIP_TOP : '0.34');
  const yStart = fyMin + Math.round((fyMax - fyMin) * SKIP); // below the cap
  let scrubbed = 0;
  for (let y = yStart; y <= fyMax; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; if (bg[p]) continue;
    if (isLinen(p << 2)) { bg[p] = 1; scrubbed++; }
  }
  console.error(`  scrub-weave: removed ${scrubbed}px residual textured linen below cap (rows >= ${yStart})`);
}

// ---- morphological CLOSE on the figure (radius C) ----
// The acorn cap has a fuzzy bristled edge that interleaves with linen, so the
// flood leaves concave bites and gaps between bristles. Closing (dilate the
// figure by C, then erode by C) fills those bites/gaps so the cap reads as a
// solid mass, at the cost of slightly rounding the finest bristle tips — a good
// trade for a game character. C=0 disables. Operates on the figure (= !bg).
const CLOSE_C = parseInt(process.env.CLOSE_C !== undefined ? process.env.CLOSE_C : '4', 10);
if (CLOSE_C > 0) {
  // fg = 1 where figure
  let fg = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) fg[p] = bg[p] ? 0 : 1;
  // dilate C
  for (let it = 0; it < CLOSE_C; it++) {
    const nx = fg.slice();
    for (let p = 0; p < W * H; p++) {
      if (fg[p]) continue; const x = p % W, y = (p - x) / W;
      if ((x>0&&fg[p-1])||(x<W-1&&fg[p+1])||(y>0&&fg[p-W])||(y<H-1&&fg[p+W])) nx[p] = 1;
    }
    fg = nx;
  }
  // erode C
  for (let it = 0; it < CLOSE_C; it++) {
    const nx = fg.slice();
    for (let p = 0; p < W * H; p++) {
      if (!fg[p]) continue; const x = p % W, y = (p - x) / W;
      if ((x>0&&!fg[p-1])||(x<W-1&&!fg[p+1])||(y>0&&!fg[p-W])||(y<H-1&&!fg[p+W])) nx[p] = 0;
    }
    fg = nx;
  }
  // Apply close, but only RECLAIM a bg pixel into the figure if its underlying
  // colour is plausibly cap material (not bright clean linen) — otherwise closing
  // would smear a tan halo around the silhouette. We never turn figure->bg here.
  let added = 0;
  const CLOSE_VAL_MAX = parseFloat(process.env.CLOSE_VAL_MAX !== undefined ? process.env.CLOSE_VAL_MAX : '170');
  for (let p = 0; p < W * H; p++) {
    if (fg[p] && bg[p]) { // close wants this as figure; it's currently bg
      const v = hsv(p << 2)[2];
      if (v <= CLOSE_VAL_MAX) { bg[p] = 0; added++; } // dark enough to be cap, fill it
    }
  }
  console.error(`  morph-close C=${CLOSE_C}: filled ${added}px of cap bites/gaps (val<=${CLOSE_VAL_MAX})`);
}

// ---- ground-shadow cleaner ----
// The painterly cast shadow under the feet is darker linen (hue~30, val 78-175)
// so it dodges the linen flood (too dark) and gets re-attached to the boots by
// the close. It always lives in the bottom slab of the figure and spreads WIDER
// than the feet. Flood it from the bottom edge with a relaxed value floor, but
// cap the climb to the lowest GROUND_FRAC of the figure so the cap is untouched.
const GROUND_FRAC = parseFloat(process.env.GROUND_FRAC !== undefined ? process.env.GROUND_FRAC : '0.10');
if (GROUND_FRAC > 0) {
  // figure bbox bottom
  let fyMax = -1, fyMin = H;
  for (let p = 0; p < W * H; p++) if (!bg[p]) { const y = (p / W) | 0; if (y > fyMax) fyMax = y; if (y < fyMin) fyMin = y; }
  if (fyMax >= 0) {
    const limit = fyMax - Math.round((fyMax - fyMin) * GROUND_FRAC); // don't climb above this row
    function isGroundShadow(i) {
      const [h, s, v] = hsv(i);
      if (h < 16 || h > 44) return false;   // tan/brown family only
      if (v < 70 || v > 182) return false;  // ground strip value range (measured 79-116)
      if (s > 0.58) return false;           // very saturated boot leather -> spare it
      return true;
    }
    // Seed from the figure's actual bottom band (the full-frame bottom rows are
    // transparent, so seed across the lowest few opaque rows of the figure).
    let gsp = 0;
    for (let y = fyMax; y > fyMax - 4 && y >= 0; y--) {
      for (let x = 0; x < W; x++) { const p = y * W + x; if (!bg[p] && isGroundShadow(p << 2)) { bg[p] = 1; stack[gsp++] = p; } }
    }
    let removed = 0;
    while (gsp > 0) {
      const p = stack[--gsp]; removed++; const x = p % W, y = (p - x) / W;
      const nb = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
      for (const [nx, ny] of nb) {
        if (nx<0||ny<0||nx>=W||ny>=H) continue; if (ny < limit) continue; // height cap
        const np = ny*W+nx; if (bg[np]) continue;
        if (isGroundShadow(np << 2)) { bg[np] = 1; stack[gsp++] = np; }
      }
    }
    if (removed) console.error(`  ground-shadow: removed ${removed}px in bottom ${(GROUND_FRAC*100).toFixed(0)}% (rows >= ${limit})`);
  }
}

// ---- final cleanup: drop thin-thread appendages (stray linen specks) ----
// A small residual linen fragment can survive by hanging off the figure through a
// thread only a few px wide (e.g. a corner speck touching the hair). Erode the
// figure by PRUNE_R, keep only large eroded cores, dilate back by PRUNE_R: the
// thread is severed during erosion so the speck's core (too small) is dropped,
// while the solid body/cap survive. Thin REAL features (staff, sprig) survive
// because they connect to a large core that re-dilates over them. PRUNE_R=0 off.
const PRUNE_R = parseInt(process.env.PRUNE_R !== undefined ? process.env.PRUNE_R : '2', 10);
const PRUNE_MIN = parseInt(process.env.PRUNE_MIN !== undefined ? process.env.PRUNE_MIN : '1500', 10);
if (PRUNE_R > 0) {
  let fg = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) fg[p] = bg[p] ? 0 : 1;
  // erode PRUNE_R
  let er = fg.slice();
  for (let it = 0; it < PRUNE_R; it++) {
    const nx = er.slice();
    for (let p = 0; p < W * H; p++) { if (!er[p]) continue; const x = p % W, y = (p - x) / W; if ((x>0&&!er[p-1])||(x<W-1&&!er[p+1])||(y>0&&!er[p-W])||(y<H-1&&!er[p+W])) nx[p] = 0; }
    er = nx;
  }
  // keep only large eroded components
  const comp = new Int32Array(W * H).fill(-1); const q = new Int32Array(W * H); const sz = []; let label = 0;
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!er[p0] || comp[p0] !== -1) continue;
    let head = 0, tail = 0, s = 0; q[tail++] = p0; comp[p0] = label;
    while (head < tail) { const p = q[head++]; s++; const x = p % W, y = (p - x) / W; const nb = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]; for (const [nx,ny] of nb) { if (nx<0||ny<0||nx>=W||ny>=H) continue; const np = ny*W+nx; if (!er[np]||comp[np]!==-1) continue; comp[np]=label; q[tail++]=np; } }
    sz[label++] = s;
  }
  const core = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (er[p] && sz[comp[p]] >= PRUNE_MIN) core[p] = 1;
  // dilate cores back by PRUNE_R, but only over original figure pixels
  let dl = core;
  for (let it = 0; it < PRUNE_R; it++) {
    const nx = dl.slice();
    for (let p = 0; p < W * H; p++) { if (dl[p] || !fg[p]) continue; const x = p % W, y = (p - x) / W; if ((x>0&&dl[p-1])||(x<W-1&&dl[p+1])||(y>0&&dl[p-W])||(y<H-1&&dl[p+W])) nx[p] = 1; }
    dl = nx;
  }
  let pruned = 0;
  for (let p = 0; p < W * H; p++) { if (fg[p] && !dl[p]) { bg[p] = 1; pruned++; } }
  if (pruned) console.error(`  prune-threads: removed ${pruned}px of thin-thread appendages`);
}

// ---- erode foreground along bg edge (kills tan halo / AA fringe) ----
for (let ring = 0; ring < ERODE; ring++) {
  const edge = [];
  for (let p = 0; p < W * H; p++) {
    if (bg[p]) continue; const x = p % W, y = (p - x) / W;
    const touch = (x>0&&bg[p-1])||(x<W-1&&bg[p+1])||(y>0&&bg[p-W])||(y<H-1&&bg[p+W]);
    if (touch && isLinen(p << 2)) edge.push(p); // only erode linen-ish fringe
  }
  for (const p of edge) bg[p] = 1;
}

// ---- apply alpha + 1px feather ----
for (let p = 0; p < W * H; p++) {
  const i = p << 2;
  if (bg[p]) { d[i + 3] = 0; continue; }
  const x = p % W, y = (p - x) / W;
  const nearBg = (x>0&&bg[p-1])||(x<W-1&&bg[p+1])||(y>0&&bg[p-W])||(y<H-1&&bg[p+W]);
  if (nearBg && isLinen(i)) d[i + 3] = 128; // soften only linen-ish boundary pixels
}

if (DEBUG) {
  const o = new PNG({ width: W, height: H });
  for (let p = 0; p < W*H; p++) { const i = p<<2; const a = d[i+3]/255; o.data[i]=Math.round(d[i]*a+128*(1-a)); o.data[i+1]=Math.round(d[i+1]*a+128*(1-a)); o.data[i+2]=Math.round(d[i+2]*a+128*(1-a)); o.data[i+3]=255; }
  fs.writeFileSync(outPath + '.mask.png', PNG.sync.write(o));
}

// ---- auto-trim to bbox ----
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[idx(x, y) + 3] > 16) { if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y; }
if (maxX < 0) { console.error('  !! nothing left after key — aborting'); process.exit(2); }
const PAD = 6;
minX = Math.max(0, minX-PAD); minY = Math.max(0, minY-PAD); maxX = Math.min(W-1, maxX+PAD); maxY = Math.min(H-1, maxY+PAD);
const cw = maxX-minX+1, ch = maxY-minY+1;
const out = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const si = idx(minX+x, minY+y); const di = (y*cw+x)<<2; out.data[di]=d[si]; out.data[di+1]=d[si+1]; out.data[di+2]=d[si+2]; out.data[di+3]=d[si+3]; }
fs.writeFileSync(outPath, PNG.sync.write(out));
let opaque = 0; for (let p = 0; p < cw*ch; p++) if (out.data[(p<<2)+3] > 16) opaque++;
console.error(`  wrote ${outPath} ${cw}x${ch} (from ${W}x${H}); opaque=${(100*opaque/(cw*ch)).toFixed(1)}%`);
