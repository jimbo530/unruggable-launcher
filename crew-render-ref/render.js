// ============================================================
//  render.js — the paper-doll COMPOSITOR (the dynamic-NFT image engine)
//  renderCrew(look) -> PNG Buffer, by stacking layers in order:
//
//    layer 1  base sprite (boy|girl)  +  colour tint (the 9 colours)
//    layer 2  worn items   (gear -> neck -> feet -> face -> hat)
//    layer 0  stickers     (laminated sheet, painted ON TOP — NFT-only decoration)
//
//  Ported from the Base Acorn cosmetics system. On Base the tint is a live CSS
//  filter in the browser; a server render can't run CSS, so we reproduce the same
//  "monochrome -> recolour" look with sharp: desaturate the base, then tint it
//  toward the colour's target. `natural` = the original art untouched.
// ============================================================
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  colorDef, itemDef, itemBucket,
  parseVariant, SLOT_LAYOUT, WORN_DRAW_ORDER, STICKER_DEFAULT_W,
} = require('./cosmetics-config');
// The base art ships with a hard 1-bit alpha matte that punched see-through
// "holes" through the acorn cap + face (the RGB under them is real art; only the
// alpha was zeroed). Repair the alpha once per base sprite before compositing.
const { repairAlphaHoles } = require('./alpha-repair');

const ASSETS = path.join(__dirname, '..', 'assets');
// Ship-flag PNGs (the corner sticker) live alongside the SPL token logos in /token,
// served publicly at /crew/token/<flag>.png. Resolved by the per-crew `shipFlag` id.
const TOKENS = path.join(__dirname, '..', 'token');
// Flag corner-sticker geometry (a small TOP-LEFT badge, kept off the centered face).
const FLAG_W = 0.22;     // fraction of canvas width
const FLAG_MARGIN = 0.024; // fraction of canvas, gap from the top/left edges

// Output canvas. Square is ideal for NFT marketplaces; the tall acorn art is
// bottom-anchored inside it with side padding so hats/feet never clip.
const CANVAS = 1000;
// The base sprite is drawn into a box this tall, centered horizontally, sitting
// near the canvas bottom. Items are positioned relative to THIS box (not the
// full canvas), so the slot layout stays correct whatever the canvas size.
const SPRITE_BOX_H = 940; // px of canvas height the sprite occupies
const SPRITE_TOP = CANVAS - SPRITE_BOX_H - 8; // 8px breathing room at the bottom

// ---- small helpers ----
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// Recolour a sprite buffer to a colour id (mirrors the CSS-filter look).
// natural -> unchanged. Otherwise sharp's .tint() maps the image's luminance onto
// the target colour (so shading is kept and highlights read as the colour) — the
// same monochrome->recolour effect as the Base game's CSS filter. NOTE: do NOT
// chain .greyscale() first; that collapses to 1 channel and .tint() becomes a
// no-op (image stays grey). .tint() already greyscales internally.
async function applyTint(buf, colorId) {
  const cd = colorDef(colorId);
  if (!cd.tint) return buf; // 'natural'
  const { r, g, b } = hexToRgb(cd.tint);
  return sharp(buf)
    .ensureAlpha()
    .tint({ r, g, b })
    .png()
    .toBuffer();
}

// Resolve a base id ('boy'|'girl') to its file, with a clear error if missing.
function baseFile(base) {
  const name = base === 'girl' ? 'acorngirl' : 'acornboy';
  return path.join(ASSETS, 'base', name + '.png');
}

// Load a base sprite with its alpha holes repaired. The repair (seal-and-flood
// morphology) is deterministic, so we cache the result per base id and only run
// it once per process — every render reuses the clean RGBA buffer. Throws (never
// returns the holed original) if the source asset can't be read.
const _baseCache = new Map();
async function loadBaseRepaired(base) {
  if (_baseCache.has(base)) return _baseCache.get(base);
  const file = baseFile(base);
  const raw = await sharp(file).ensureAlpha().png().toBuffer();
  const { png, filled } = await repairAlphaHoles(raw); // fills cap/face dropouts
  if (process.env.CREW_RENDER_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`[render] base "${base}" alpha-repaired: filled ${filled} interior px`);
  }
  _baseCache.set(base, png);
  return png;
}

// Load + scale a worn/sticker PNG to fit INSIDE a target box (px), keeping aspect
// ratio. Fitting by BOTH width and height stops tall items (e.g. a 121x200 scarf)
// from blowing up vertically when only a width is given. If maxH is omitted it
// defaults generously so wide items still scale by width.
// Returns { buffer, width, height }. Throws (never silently skips) on a bad asset.
async function loadScaled(file, targetW, targetH) {
  const meta = await sharp(file).metadata();
  if (!meta.width || !meta.height) throw new Error('asset has no dimensions: ' + file);
  const w = Math.max(1, Math.round(targetW));
  const h = Math.max(1, Math.round(targetH || targetW * 2)); // generous height if unspecified
  const buffer = await sharp(file)
    .ensureAlpha() // some gear art (e.g. crown-king.png) ships without alpha — force RGBA so it composites cleanly
    .resize({ width: w, height: h, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const m2 = await sharp(buffer).metadata();
  return { buffer, width: m2.width, height: m2.height };
}

// Place an element centered on a normalized (x,y) inside the SPRITE box.
// Returns the composite descriptor { input, left, top } clamped to the canvas.
function placeInSpriteBox(el, nx, ny) {
  const cx = Math.round(nx * CANVAS);
  const cy = Math.round(SPRITE_TOP + ny * SPRITE_BOX_H);
  let left = cx - Math.round(el.width / 2);
  let top = cy - Math.round(el.height / 2);
  left = Math.max(0, Math.min(CANVAS - el.width, left));
  top = Math.max(0, Math.min(CANVAS - el.height, top));
  return { input: el.buffer, left, top };
}

// Resolve a ship-flag id ('laroyal'|'tide'|...) to its PNG in /token. A flag id is
// a simple slug; reject anything with path separators so a look can't escape /token.
function flagFile(flagId) {
  if (!/^[a-z0-9_-]+$/i.test(flagId)) throw new Error('bad shipFlag id: ' + flagId);
  return path.join(TOKENS, flagId + '.png');
}

// Build the TOP-LEFT flag composite descriptor for a shipFlag id, or null if none.
// Scaled to FLAG_W of the canvas (height free), pinned FLAG_MARGIN from the top-left
// corner so it never reaches the centered face. Throws (never silently skips) if the
// flag id is set but its PNG is missing — a broken flag must be visible, not hidden.
async function buildFlag(flagId) {
  if (!flagId || flagId === 'none') return null;
  const file = flagFile(flagId);
  if (!fs.existsSync(file)) throw new Error('shipFlag asset not found: ' + file);
  const w = Math.round(FLAG_W * CANVAS);
  const el = await loadScaled(file, w, w * 2); // fit inside w x 2w, keeps aspect
  const m = Math.round(FLAG_MARGIN * CANVAS);
  return { input: el.buffer, left: m, top: m, flagId };
}

/**
 * renderCrew(look) -> { png: Buffer, traits: [...] }
 * look = {
 *   base: 'boy' | 'girl',
 *   color: 'natural' | 'red' | ... ,
 *   items: { hat?, face?, neck?, feet?, gear? }   // each = variant id "<itemId>:<colorId>" or itemId
 *   stickers: [ "sticker-star:gold" | { id, x, y, scale } ]   // laminated layer-0 sheet
 * }
 */
async function renderCrew(look = {}) {
  const base = look.base === 'girl' ? 'girl' : 'boy';
  const color = (look.color || 'natural');
  const items = look.items || {};
  const stickers = Array.isArray(look.stickers) ? look.stickers : [];
  const layout = SLOT_LAYOUT[base];
  const traits = []; // collected for NFT metadata attributes

  // ---- layer 1: base sprite + tint, fitted into the sprite box ----
  // loadBaseRepaired() returns the base with its 1-bit-matte alpha holes filled
  // (cap + face), cached per base id. Tint is applied AFTER (a no-op for natural).
  let baseBuf = await loadBaseRepaired(base);
  baseBuf = await applyTint(baseBuf, color);
  baseBuf = await sharp(baseBuf)
    .resize({ height: SPRITE_BOX_H, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const baseMeta = await sharp(baseBuf).metadata();
  const baseLeft = Math.round((CANVAS - baseMeta.width) / 2);
  const baseTop = SPRITE_TOP + Math.round((SPRITE_BOX_H - baseMeta.height) / 2);

  const composites = [{ input: baseBuf, left: baseLeft, top: Math.max(0, baseTop) }];
  traits.push({ trait_type: 'Base', value: base === 'girl' ? 'Acorn Girl' : 'Acorn Boy' });
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
    const sw = (entry.scale ? entry.scale : 1) * STICKER_DEFAULT_W * CANVAS;
    let el = await loadScaled(file, sw);
    if (scolor && scolor !== 'natural') {
      const tinted = await applyTint(el.buffer, scolor);
      el = { buffer: tinted, width: el.width, height: el.height };
    }
    // stickers carry their own normalized position; default to a tidy spot if absent
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
  })
    .composite(composites)
    .png()
    .toBuffer();

  return { png, traits };
}

module.exports = { renderCrew, CANVAS };
