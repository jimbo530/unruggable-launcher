// ============================================================
//  cosmetics-config.js — the catalog + colors + slot layout
//  PORTED 1:1 from the Base Acorn system (grove-app.html STORE_ITEMS + COMMON_COLORS).
//  Same id scheme so a wallet's Base closet maps straight onto a Solana crew NFT:
//    variant id = "<itemId>:<colorId>"  e.g.  item-beanie:blue
//  Colors are a CSS-filter recolor on Base; here we replicate them server-side
//  (grayscale -> tint toward a target colour). See render.js.
// ============================================================

// ---- The 9 colors (mirrors COMMON_COLORS in grove-app.html) ----
// `sw` = swatch dot (also the server-side tint target). `cssFilter` is kept
// verbatim so the in-browser store and the rendered NFT stay visually aligned.
const COLORS = [
  { id: 'natural', name: 'Natural', sw: '#cdbfa0', cssFilter: '', tint: null },
  { id: 'red', name: 'Red', sw: '#d24b4b', cssFilter: 'grayscale(1) sepia(1) saturate(7) hue-rotate(-28deg)', tint: '#d24b4b' },
  { id: 'orange', name: 'Orange', sw: '#e08a3c', cssFilter: 'grayscale(1) sepia(1) saturate(6) hue-rotate(-6deg)', tint: '#e08a3c' },
  { id: 'yellow', name: 'Yellow', sw: '#e8c547', cssFilter: 'grayscale(1) sepia(1) saturate(6) hue-rotate(18deg) brightness(1.1)', tint: '#e8c547' },
  { id: 'green', name: 'Green', sw: '#5bbf4a', cssFilter: 'grayscale(1) sepia(1) saturate(4) hue-rotate(60deg)', tint: '#5bbf4a' },
  { id: 'blue', name: 'Blue', sw: '#4a86d2', cssFilter: 'grayscale(1) sepia(1) saturate(6) hue-rotate(170deg)', tint: '#4a86d2' },
  { id: 'purple', name: 'Purple', sw: '#9b5bd2', cssFilter: 'grayscale(1) sepia(1) saturate(6) hue-rotate(220deg)', tint: '#9b5bd2' },
  { id: 'brown', name: 'Brown', sw: '#8a5a3c', cssFilter: 'grayscale(1) sepia(1) saturate(3) hue-rotate(-12deg) brightness(0.82)', tint: '#8a5a3c' },
  { id: 'gray', name: 'Gray', sw: '#9aa0a6', cssFilter: 'grayscale(1) brightness(1.12)', tint: '#9aa0a6' },
];
const colorDef = (id) => COLORS.find((c) => c.id === id) || COLORS[0];

// ---- The catalog (mirrors STORE_ITEMS, extended with the rest of the cut art) ----
// kind: 'hat' | 'neck' | 'feet'  (worn items, layer 2)  |  'sticker' (layer 0)  |  'gear' (premium worn)
// art:  filename inside assets/<bucket>/   (bucket derived from kind below)
// gold: price in the Base store (sats of cbBTC). Carried over for parity; not charged here.
const ITEMS = [
  // hats
  { id: 'item-beanie', kind: 'hat', name: 'Beanie', gold: 15, art: 'beanie.png' },
  { id: 'item-crown', kind: 'hat', name: 'Crown', gold: 60, art: 'crown.png' },
  { id: 'item-wizard-hat', kind: 'hat', name: 'Wizard Hat', gold: 40, art: 'wizard-hat.png' },
  { id: 'item-party-hat', kind: 'hat', name: 'Party Hat', gold: 25, art: 'party-hat.png' },
  // neck
  { id: 'item-scarf', kind: 'neck', name: 'Scarf', gold: 20, art: 'scarf.png' },
  { id: 'item-bowtie', kind: 'neck', name: 'Bow Tie', gold: 25, art: 'bowtie.png' },
  { id: 'item-cape', kind: 'neck', name: 'Cape', gold: 45, art: 'cape.png' },
  // face (rendered in the hat/face band; kept as its own slot for clarity)
  { id: 'item-sunglasses', kind: 'face', name: 'Sunglasses', gold: 18, art: 'sunglasses.png' },
  { id: 'item-monocle', kind: 'face', name: 'Monocle', gold: 22, art: 'monocle.png' },
  // feet
  { id: 'item-boots', kind: 'feet', name: 'Boots', gold: 30, art: 'boots.png' },
  // gear (premium, 1-of-a-kind feel) — note crown-king.png ships without alpha; see render.js
  { id: 'gear-crown-king', kind: 'gear', name: "King's Crown", gold: 500, art: 'crown-king.png' },
  { id: 'gear-cape-royal', kind: 'gear', name: 'Royal Cape', gold: 500, art: 'cape-royal.png' },
  // stickers (layer 0, laminated — NFT-only)
  { id: 'sticker-acorn', kind: 'sticker', name: 'Acorn Sticker', gold: 5, art: 'acorn.png' },
  { id: 'sticker-coin', kind: 'sticker', name: 'Coin Sticker', gold: 5, art: 'coin.png' },
  { id: 'sticker-flower', kind: 'sticker', name: 'Flower Sticker', gold: 8, art: 'flower.png' },
  { id: 'sticker-gem', kind: 'sticker', name: 'Gem Sticker', gold: 10, art: 'gem.png' },
  { id: 'sticker-heart', kind: 'sticker', name: 'Heart Sticker', gold: 6, art: 'heart.png' },
  { id: 'sticker-leaf', kind: 'sticker', name: 'Leaf Sticker', gold: 3, art: 'leaf.png' },
  { id: 'sticker-mushroom', kind: 'sticker', name: 'Mushroom Sticker', gold: 5, art: 'mushroom.png' },
  { id: 'sticker-star', kind: 'sticker', name: 'Star Sticker', gold: 8, art: 'star.png' },
  { id: 'sticker-water', kind: 'sticker', name: 'Water Sticker', gold: 4, art: 'water.png' },
];
const itemDef = (id) => ITEMS.find((x) => x.id === id) || null;
const itemBucket = (kind) =>
  kind === 'sticker' ? 'stickers' : kind === 'gear' ? 'gear' : 'items';

// variant helpers (identical scheme to the Base game)
const variantId = (itemId, color) => itemId + ':' + color;
function parseVariant(vid) {
  if (!vid) return { itemId: null, color: 'natural' };
  const i = vid.lastIndexOf(':');
  if (i < 0) return { itemId: vid, color: 'natural' };
  return { itemId: vid.slice(0, i), color: vid.slice(i + 1) };
}

// ---- Slot layout (paper-doll anchor points) ----
// Coords are NORMALIZED to the base-sprite canvas (0..1). Each worn item is scaled
// to `w` (fraction of canvas width) keeping its own aspect ratio, then centered on
// (x,y). This is the design-mode layout: a saved per-NFT override always wins over
// these defaults (never hardcode over a saved layout). Tuned to the ~530x900 acorn art.
// Separate boy/girl in case the girl's proportions need a nudge later (same for now).
// Tuned to the acorn anatomy (measured from the silhouette): the pointed acorn
// cap is y~0.00-0.17, the round head/face ~y0.17-0.30, shoulders/neck ~y0.30-0.34,
// feet ~y0.90-0.99. Items are kept modest so they sit ON the character, not float.
// w = max width, h = max height (both fractions of the canvas). The item fits
// INSIDE the w*h box keeping its aspect ratio — so a tall scarf is bounded by h
// and a wide pair of sunglasses by w. Tune these in design mode; saved per-NFT
// overrides always win.
const SLOT_LAYOUT = {
  boy: {
    hat: { x: 0.50, y: 0.150, w: 0.30, h: 0.16 }, // beanie/crown caps the head, just over the brow
    face: { x: 0.50, y: 0.235, w: 0.24, h: 0.10 }, // sunglasses/monocle across the face
    neck: { x: 0.50, y: 0.350, w: 0.34, h: 0.13 }, // scarf/cape at the shoulder line
    feet: { x: 0.50, y: 0.930, w: 0.34, h: 0.10 }, // boots at the bottom
    gear: { x: 0.50, y: 0.150, w: 0.40, h: 0.24 }, // premium piece, larger, around the crown/shoulders
  },
  girl: {
    hat: { x: 0.50, y: 0.160, w: 0.30, h: 0.16 },
    face: { x: 0.50, y: 0.245, w: 0.24, h: 0.10 },
    neck: { x: 0.50, y: 0.360, w: 0.34, h: 0.13 },
    feet: { x: 0.50, y: 0.935, w: 0.34, h: 0.10 },
    gear: { x: 0.50, y: 0.160, w: 0.40, h: 0.24 },
  },
};

// The order worn items are painted (lower = further back). Stickers (layer 0) and
// the base+tint (layer 1) are handled separately in render.js; this is layer 2.
const WORN_DRAW_ORDER = ['gear', 'neck', 'feet', 'face', 'hat'];

// Default sticker size when one has no saved {x,y,scale} (fraction of canvas width).
const STICKER_DEFAULT_W = 0.16;

module.exports = {
  COLORS, colorDef,
  ITEMS, itemDef, itemBucket,
  variantId, parseVariant,
  SLOT_LAYOUT, WORN_DRAW_ORDER, STICKER_DEFAULT_W,
};
