// ============================================================
//  stage-assets.js — copy the READY Grok art into assets/, and print the exact
//  list of sources that still need a colorkey CUTOUT before they composite.
//
//  Run: node src/stage-assets.js          (copies ready art, prints TODO)
//       node src/stage-assets.js --dry     (prints only, copies nothing)
//
//  It NEVER does image processing. "Ready" = the manifest marked it ready AND a
//  fresh alpha check confirms it has real transparency (so a mislabelled opaque
//  file can't slip through and paint a solid rectangle on the crew). Anything that
//  needs a cutout is reported with the INVENTORY.md ffmpeg recipe to run.
// ============================================================
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const M = require('./asset-manifest');

const ROOT = path.join(__dirname, '..');
const DRY = process.argv.includes('--dry');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

// Confirm a file actually has transparency (corners transparent + a decent
// transparent-pixel share). Guards against copying an opaque mislabel.
async function hasRealAlpha(file) {
  if (!fs.existsSync(file)) return false;
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const a = (x, y) => data[(y * W + x) * C + 3];
  const cornersClear = a(1, 1) < 16 && a(W - 2, 1) < 16 && a(1, H - 2) < 16 && a(W - 2, H - 2) < 16;
  let clear = 0; for (let i = 3; i < data.length; i += C) if (data[i] < 16) clear++;
  return cornersClear && clear / (W * H) > 0.05;
}

async function copyReady(destRel, src) {
  const dest = path.join(ROOT, destRel);
  ensureDir(path.dirname(dest));
  if (!fs.existsSync(src)) return { destRel, src, status: 'MISSING_SRC' };
  const ok = await hasRealAlpha(src);
  if (!ok) return { destRel, src, status: 'NOT_TRANSPARENT' }; // refuse to stage
  if (!DRY) fs.copyFileSync(src, dest);
  return { destRel, src, status: DRY ? 'WOULD_COPY' : 'COPIED' };
}

(async () => {
  const copied = [];
  const cutout = [];
  const problems = [];

  // ITEMS (ready)
  for (const [art, info] of Object.entries(M.ITEMS)) {
    const r = await copyReady(path.join('assets', 'items', art), info.src);
    (r.status === 'COPIED' || r.status === 'WOULD_COPY' ? copied : problems).push(r);
  }
  // STICKERS (ready)
  for (const [art, info] of Object.entries(M.STICKERS)) {
    const r = await copyReady(path.join('assets', 'stickers', art), info.src);
    (r.status === 'COPIED' || r.status === 'WOULD_COPY' ? copied : problems).push(r);
  }
  // GEAR (need cutout) — report only
  for (const [art, info] of Object.entries(M.GEAR)) {
    cutout.push({
      dest: path.join('assets', 'gear', art), src: info.src, kind: info.cutout, inCatalog: info.inCatalog,
      cmd: M.CUTOUT[info.cutout].ffmpeg(info.src, path.join(ROOT, 'assets', 'gear', art)),
    });
  }
  // BASE (need cutout) — report only
  for (const [k, b] of Object.entries(M.BASE)) {
    cutout.push({
      dest: b.dest, src: b.src, kind: b.cutout, base: k,
      cmd: M.CUTOUT[b.cutout].ffmpeg(b.src, path.join(ROOT, b.dest)),
      note: b.note + '  (also run alpha-repair after cutout — acorn cap/face matte)',
    });
  }

  console.log(`\n=== STAGED (ready, copied to assets/) ${DRY ? '[DRY RUN]' : ''} ===`);
  for (const r of copied) console.log(`  ${r.status.padEnd(11)} ${r.destRel}`);

  if (problems.length) {
    console.log('\n=== PROBLEMS (manifest said ready but failed alpha check) ===');
    for (const r of problems) console.log(`  ${r.status.padEnd(15)} ${r.destRel}  <- ${r.src}`);
  }

  console.log('\n=== NEEDS CUTOUT (do NOT composite until cut; INVENTORY.md method) ===');
  for (const c of cutout) {
    const tag = c.base ? `base:${c.base}` : (c.inCatalog ? 'gear(in-catalog)' : 'gear(extra)');
    console.log(`  [${tag}] ${c.dest}`);
    console.log(`      src : ${c.src}  (${c.kind} bg)`);
    if (c.note) console.log(`      note: ${c.note}`);
    console.log(`      cut : ${c.cmd}`);
  }

  console.log('\nSummary: staged ' + copied.length + ' ready / ' + cutout.length + ' need cutout / ' + problems.length + ' problems.');
  console.log('After cutting gear+base into assets/, the compositor uses them with no code change.');
})().catch((e) => { console.error('stage-assets failed:', e.message); process.exit(1); });
