// ============================================================
//  render.js — the paper-doll COMPOSITOR for BASE crew NFTs.
//
//  renderCrew(look) -> { png: Buffer, traits: [...] } by stacking, in order:
//    layer 1  base sprite (boy|girl) + colour tint (the 9 colours)
//    layer 2  worn items   (gear -> neck -> feet -> face -> hat)
//    layer 0  stickers     (laminated sheet, painted ON TOP)
//    + top-left ship FLAG corner badge (dynamic per-crew, no re-mint)
//
//  This is a faithful port of crew-render-ref/render.js (the live Solana service)
//  with TWO build-friendly changes so it runs locally on Base WITHOUT the full VPS
//  asset tree:
//    1. The `alpha-repair` step (which patches the acorn art's 1-bit alpha holes)
//       is OPTIONAL — loaded only if ./alpha-repair.js exists, else we just
//       ensureAlpha(). The live service ships alpha-repair; this local build does
//       not need it to function.
//    2. If a base sprite PNG is missing, we render a clearly-labelled PLACEHOLDER
//       silhouette (never a silent blank) so the endpoint is testable before the
//       real acorn art is dropped into assets/base/. Production WILL have the art.
//
//  Flags: the Base flag badge is resolved from the local flags/ dir by a flag id
//  (a slug). Same geometry as the Solana service (small TOP-LEFT badge).
// ============================================================
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  colorDef, itemDef, itemBucket,
  parseVariant, SLOT_LAYOUT, WORN_DRAW_ORDER, STICKER_DEFAULT_W,
} = require('./cosmetics-config');
const { speciesId, speciesName, speciesBodyRel } = require('./asset-manifest');
const { speciesForCrewKey } = require('./ship-species');

// Optional alpha-repair (present on the live VPS; optional in this local build).
let repairAlphaHoles = null;
try {
  // eslint-disable-next-line global-require
  ({ repairAlphaHoles } = require('./alpha-repair'));
} catch (_) {
  repairAlphaHoles = null; // fall back to plain ensureAlpha (see loadBaseRepaired)
}

const ASSETS = path.join(__dirname, '..', 'assets');
// Ship-flag PNGs live in flags/, resolved by a per-crew `shipFlag` slug id.
const FLAGS = path.join(__dirname, '..', 'flags');
const FLAG_W = 0.22;       // fraction of canvas width
const FLAG_MARGIN = 0.024; // gap from top/left edges (fraction of canvas)

// Output canvas — square is ideal for EVM marketplaces (OpenSea/Blur/Zora).
const CANVAS = 1000;
const SPRITE_BOX_H = 940;
const SPRITE_TOP = CANVAS - SPRITE_BOX_H - 8;

// ---- small helpers ----
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// Recolour a sprite buffer to a colour id (mirrors the Base CSS-filter look).
// natural -> unchanged. sharp's .tint() maps luminance onto the target colour, so
// shading is preserved. Do NOT .greyscale() first (it makes .tint() a no-op).
async function applyTint(buf, colorId) {
  const cd = colorDef(colorId);
  if (!cd.tint) return buf; // 'natural'
  const { r, g, b } = hexToRgb(cd.tint);
  return sharp(buf).ensureAlpha().tint({ r, g, b }).png().toBuffer();
}

// Resolve the BASE BODY file for a gender (boy|girl) + SPECIES, with a safe
// fallback to the acorn body when the chosen species' art isn't dropped yet
// (asset-manifest.speciesBodyRel does the existence check + fallback). Returns the
// absolute path plus which species actually won, so the caller can label/log it.
function baseFile(base, species) {
  const r = speciesBodyRel(species, base, ASSETS, fs.existsSync);
  return { file: path.join(ASSETS, r.rel), species: r.species, fellBack: r.fellBack };
}

// Build a labelled placeholder sprite when the real base art is missing. This is
// deliberately VISIBLE (a tinted rounded body + a label), never a silent blank —
// so a missing asset is obvious in dev and never ships unnoticed.
async function placeholderBase(base) {
  const w = Math.round(SPRITE_BOX_H * 0.56);
  const h = SPRITE_BOX_H;
  const fill = base === 'girl' ? '#caa45a' : '#7fae7f';
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
       <defs><clipPath id="r"><rect x="0" y="0" width="${w}" height="${h}" rx="${Math.round(w * 0.22)}"/></clipPath></defs>
       <g clip-path="url(#r)">
         <rect width="${w}" height="${h}" fill="${fill}"/>
         <circle cx="${w / 2}" cy="${Math.round(h * 0.22)}" r="${Math.round(w * 0.34)}" fill="#0d1b12" opacity="0.18"/>
       </g>
       <text x="${w / 2}" y="${Math.round(h * 0.54)}" font-family="Verdana,sans-serif" font-size="${Math.round(w * 0.11)}"
             fill="#0b1622" text-anchor="middle" font-weight="bold">${base === 'girl' ? 'ACORN GIRL' : 'ACORN BOY'}</text>
       <text x="${w / 2}" y="${Math.round(h * 0.60)}" font-family="Verdana,sans-serif" font-size="${Math.round(w * 0.06)}"
             fill="#0b1622" text-anchor="middle">placeholder — drop base art in assets/base/</text>
     </svg>`
  );
  return sharp(svg).ensureAlpha().png().toBuffer();
}

// Load a base sprite with alpha holes repaired (when alpha-repair is available),
// cached per base id. Falls back to the placeholder if the asset is missing.
// Cached by "<species>:<gender>" (post-fallback species, so the acorn body is
// shared across any species that fell back to it).
const _baseCache = new Map();
async function loadBaseRepaired(base, species) {
  const { file, species: resolved, fellBack } = baseFile(base, species);
  if (fellBack) {
    console.warn('[render] species "' + speciesId(species) + '" body missing — falling back to acorn for', base);
  }
  const cacheKey = resolved + ':' + base;
  if (_baseCache.has(cacheKey)) return { png: _baseCache.get(cacheKey), species: resolved };
  let png;
  if (!fs.existsSync(file)) {
    png = await placeholderBase(base); // visible placeholder, never a silent blank
  } else {
    const raw = await sharp(file).ensureAlpha().png().toBuffer();
    if (repairAlphaHoles) {
      const out = await repairAlphaHoles(raw);
      png = out.png;
    } else {
      png = raw; // local build without alpha-repair: plain RGBA
    }
  }
  _baseCache.set(cacheKey, png);
  return { png, species: resolved };
}

// Load + scale a worn/sticker PNG to fit INSIDE a target box (px), keeping aspect.
// Throws (never silently skips) on a bad asset — a missing worn item is a visible error.
async function loadScaled(file, targetW, targetH) {
  const meta = await sharp(file).metadata();
  if (!meta.width || !meta.height) throw new Error('asset has no dimensions: ' + file);
  const w = Math.max(1, Math.round(targetW));
  const h = Math.max(1, Math.round(targetH || targetW * 2));
  const buffer = await sharp(file)
    .ensureAlpha()
    .resize({ width: w, height: h, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const m2 = await sharp(buffer).metadata();
  return { buffer, width: m2.width, height: m2.height };
}

// Place an element centered on a normalized (x,y) inside the SPRITE box.
function placeInSpriteBox(el, nx, ny) {
  const cx = Math.round(nx * CANVAS);
  const cy = Math.round(SPRITE_TOP + ny * SPRITE_BOX_H);
  let left = cx - Math.round(el.width / 2);
  let top = cy - Math.round(el.height / 2);
  left = Math.max(0, Math.min(CANVAS - el.width, left));
  top = Math.max(0, Math.min(CANVAS - el.height, top));
  return { input: el.buffer, left, top };
}

// Resolve a ship-flag id to its PNG in flags/. Reject path separators so a look
// can't escape the flags dir.
function flagFile(flagId) {
  if (!/^[a-z0-9_-]+$/i.test(flagId)) throw new Error('bad shipFlag id: ' + flagId);
  return path.join(FLAGS, flagId + '.png');
}

// Build the TOP-LEFT flag composite for a shipFlag id, or null if none. Throws if
// the id is set but the PNG is missing — a broken flag must be visible, not hidden.
async function buildFlag(flagId) {
  if (!flagId || flagId === 'none') return null;
  const file = flagFile(flagId);
  if (!fs.existsSync(file)) throw new Error('shipFlag asset not found: ' + file);
  const w = Math.round(FLAG_W * CANVAS);
  const el = await loadScaled(file, w, w * 2);
  const m = Math.round(FLAG_MARGIN * CANVAS);
  return { input: el.buffer, left: m, top: m, flagId };
}

/**
 * renderCrew(look) -> { png: Buffer, traits: [...] }
 * look = { base, color, items:{hat,face,neck,feet,gear}, stickers:[...], shipFlag,
 *          crewKey?, species? }
 *
 * SPECIES (per-ship crew body) selection, in priority order:
 *   1. look.species  — explicit override (e.g. preview tooling)
 *   2. look.crewKey  — the ship (distributor address half of the key) -> species
 *                       via ship-species.js (Redrum Raiders -> goblin, etc.)
 *   3. acorn         — default / no mapping.
 * The chosen species falls back to the acorn BODY ART if its sprite sheet isn't
 * present yet (asset-manifest.speciesBodyRel); selection above is unaffected.
 */
async function renderCrew(look = {}) {
  const base = look.base === 'girl' ? 'girl' : 'boy';
  const color = look.color || 'natural';
  const items = look.items || {};
  const stickers = Array.isArray(look.stickers) ? look.stickers : [];
  const layout = SLOT_LAYOUT[base];
  const traits = [];

  // species: explicit override, else mapped from the ship (crewKey), else acorn.
  const species = look.species
    ? speciesId(look.species)
    : (look.crewKey ? speciesForCrewKey(look.crewKey) : speciesId(undefined));

  // ---- layer 1: base sprite + tint, fitted into the sprite box ----
  const loaded = await loadBaseRepaired(base, species);
  let baseBuf = loaded.png;
  baseBuf = await applyTint(baseBuf, color);
  baseBuf = await sharp(baseBuf)
    .resize({ height: SPRITE_BOX_H, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const baseMeta = await sharp(baseBuf).metadata();
  const baseLeft = Math.round((CANVAS - baseMeta.width) / 2);
  const baseTop = SPRITE_TOP + Math.round((SPRITE_BOX_H - baseMeta.height) / 2);

  const composites = [{ input: baseBuf, left: baseLeft, top: Math.max(0, baseTop) }];
  // Species trait reflects the SELECTED species (look-level), not the post-fallback
  // body — a goblin crew is still a goblin crew even before its art lands.
  traits.push({ trait_type: 'Species', value: speciesName(species) });
  traits.push({ trait_type: 'Base', value: base === 'girl' ? 'Girl' : 'Boy' });
  traits.push({ trait_type: 'Color', value: colorDef(color).name });

  // ---- layer 2: worn items (back-to-front) ----
  for (const slot of WORN_DRAW_ORDER) {
    const raw = items[slot];
    if (!raw) continue;
    const { itemId, color: icolor } = parseVariant(raw);
    const def = itemDef(itemId);
    if (!def) throw new Error('unknown item in slot "' + slot + '": ' + raw);
    const anchor = layout[slot] || layout.hat;
    const file = path.join(ASSETS, itemBucket(def.kind), def.art);
    // worn-item art may not be present in this local build; skip-with-trait rather
    // than throw on a MISSING cosmetic file, but still surface it on stderr.
    if (!fs.existsSync(file)) {
      console.warn('[render] worn art missing (trait only):', file);
      traits.push({
        trait_type: slot.charAt(0).toUpperCase() + slot.slice(1),
        value: (icolor && icolor !== 'natural' ? colorDef(icolor).name + ' ' : '') + def.name,
      });
      continue;
    }
    let el = await loadScaled(file, anchor.w * CANVAS, (anchor.h || anchor.w) * CANVAS);
    if (icolor && icolor !== 'natural') {
      const tinted = await applyTint(el.buffer, icolor);
      el = { buffer: tinted, width: el.width, height: el.height };
    }
    composites.push(placeInSpriteBox(el, anchor.x, anchor.y));
    traits.push({
      trait_type: slot.charAt(0).toUpperCase() + slot.slice(1),
      value: (icolor && icolor !== 'natural' ? colorDef(icolor).name + ' ' : '') + def.name,
    });
  }

  // ---- layer 0: laminated stickers, painted on top ----
  let stickerCount = 0;
  for (const s of stickers) {
    const entry = typeof s === 'string' ? { id: s } : (s || {});
    const { itemId, color: scolor } = parseVariant(entry.id);
    const def = itemDef(itemId);
    if (!def) throw new Error('unknown sticker: ' + entry.id);
    const file = path.join(ASSETS, itemBucket(def.kind), def.art);
    if (!fs.existsSync(file)) { console.warn('[render] sticker art missing (skipped):', file); stickerCount++; continue; }
    const sw = (entry.scale ? entry.scale : 1) * STICKER_DEFAULT_W * CANVAS;
    let el = await loadScaled(file, sw);
    if (scolor && scolor !== 'natural') {
      const tinted = await applyTint(el.buffer, scolor);
      el = { buffer: tinted, width: el.width, height: el.height };
    }
    const nx = entry.x != null ? entry.x : (0.22 + (stickerCount % 3) * 0.28);
    const ny = entry.y != null ? entry.y : (0.30 + Math.floor(stickerCount / 3) * 0.22);
    composites.push(placeInSpriteBox(el, nx, ny));
    stickerCount++;
  }
  if (stickerCount) traits.push({ trait_type: 'Stickers', value: stickerCount });

  // ---- top-left ship flag (painted ON TOP; dynamic per-crew, no re-mint) ----
  const flag = await buildFlag(look.shipFlag);
  if (flag) {
    composites.push({ input: flag.input, left: flag.left, top: flag.top });
    traits.push({ trait_type: 'Ship Flag', value: flag.flagId });
  }

  // ---- flatten onto a transparent canvas ----
  const png = await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(composites).png().toBuffer();

  return { png, traits };
}

module.exports = { renderCrew, CANVAS };
