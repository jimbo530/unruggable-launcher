// @ts-check
/**
 * gear-overlay.js — paint a crew unit's EQUIPPED gear onto its paper-doll, client-side.
 *
 * The doll itself is the hosted render (base + tint + cosmetics). This layers the battle
 * gear (from units.equipped) ON TOP using per-item anchors, so what you equip at the
 * Decks shows on the pawn. Gear cut-outs live at ../art/gear/<id>.png (keyed transparent).
 *
 * Anchors are fractions of the SQUARE doll canvas (the render is 1000x1000, the acorn
 * bottom-centred). Tuned in art/gear/_preview.cjs. The same map can later feed the
 * server render for baked NFT images. boy/girl share the layout for now.
 */

// center (x,y) + max box (w,h) as fractions of the square doll canvas
export const GEAR_LAYOUT = {
  torso:   { x: 0.50, y: 0.62, w: 0.44, h: 0.34 }, // body armor
  head:    { x: 0.50, y: 0.24, w: 0.38, h: 0.26 }, // helm, on the acorn cap
  shield:  { x: 0.33, y: 0.58, w: 0.28, h: 0.30 }, // off-arm
  weapon:  { x: 0.66, y: 0.55, w: 0.26, h: 0.52 }, // held, right side
  trinket: { x: 0.37, y: 0.72, w: 0.17, h: 0.20 }, // belt / held
};

// item id -> anchor slot (note: helm & shield are "armor" slot items but sit elsewhere)
export const GEAR_ANCHOR = {
  scimitar: 'weapon', mace: 'weapon', pike: 'weapon', rapier: 'weapon', crossbow: 'weapon',
  shield: 'shield', helm: 'head',
  leather: 'torso', chainmail: 'torso', breastplate: 'torso',
  spyglass: 'trinket', lantern: 'trinket', potion: 'trinket', relic: 'trinket',
};

// back -> front
export const GEAR_DRAW_ORDER = ['torso', 'shield', 'head', 'trinket', 'weapon'];

/** Path to a keyed gear cut-out (works from any depth-1 page). */
export const gearImg = (id) => `../art/gear/${id}.png`;

const _cache = new Map();
function loadImg(src) {
  if (_cache.has(src)) return _cache.get(src);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null); // missing art shouldn't break the doll
    im.src = src;
  });
  _cache.set(src, p);
  return p;
}

/**
 * Paint the doll + equipped gear into a <canvas>.
 * @param {HTMLCanvasElement} canvas
 * @param {string} dollUrl  hosted /crew/render/<id>.png (or null for gear-only)
 * @param {Record<string,string>} equipped  {weapon,armor,trinket} -> item ids
 */
export async function paintDoll(canvas, dollUrl, equipped) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const doll = dollUrl ? await loadImg(dollUrl) : null;
  if (doll) ctx.drawImage(doll, 0, 0, W, H);

  const ids = Object.values(equipped || {}).filter(Boolean);
  // load all gear first so draw order is deterministic
  const imgs = {};
  await Promise.all(ids.map(async (id) => { imgs[id] = await loadImg(gearImg(id)); }));

  for (const slot of GEAR_DRAW_ORDER) {
    for (const id of ids) {
      if (GEAR_ANCHOR[id] !== slot) continue;
      const im = imgs[id]; if (!im) continue;
      const a = GEAR_LAYOUT[slot];
      const boxW = a.w * W, boxH = a.h * H;
      const s = Math.min(boxW / im.width, boxH / im.height);
      const dw = im.width * s, dh = im.height * s;
      ctx.drawImage(im, a.x * W - dw / 2, a.y * H - dh / 2, dw, dh);
    }
  }
}
