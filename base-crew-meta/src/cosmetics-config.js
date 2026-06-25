// ============================================================
//  cosmetics-config.js — the catalog + colours + slot layout (BASE variant)
//
//  PORTED 1:1 from crew-render-ref (the Solana paper-doll service), which in turn
//  ported it from the Base Acorn system (grove-app.html STORE_ITEMS / COMMON_COLORS).
//  Keeping the SAME id scheme is the whole point: a wallet's Base Acorn closet and a
//  Base ship-crew NFT use identical variant ids ("<itemId>:<colorId>"), so gear
//  bought in GearStore1155 (or the Acorn store) maps straight onto a crew's look.
//
//  Nothing here is chain-specific — it is pure catalog data + paper-doll geometry,
//  shared verbatim with the Solana render so the two ecosystems stay visually aligned.
// ============================================================

// ---- The 9 colours (mirrors COMMON_COLORS in grove-app.html) ----
// `sw` = swatch dot (also the server-side tint target). `cssFilter` is kept verbatim
// so the in-browser store and the server-rendered NFT read as the same colour.
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

// ---- The catalog (mirrors STORE_ITEMS) ----
// kind: 'hat' | 'face' | 'neck' | 'feet' (worn, layer 2) | 'sticker' (layer 0) | 'gear' (premium worn)
// art:  filename inside assets/<bucket>/   (bucket derived from kind below)
// gearId: the on-chain GearStore1155 token id that grants this look (see gear-hook.js).
//         Only the basic gameplay gear is wired to GearStore1155; cosmetic hats/stickers
//         are granted by the off-chain cosmetics store. null => not a GearStore1155 item.
const ITEMS = [
  // hats
  { id: 'item-beanie', kind: 'hat', name: 'Beanie', gold: 15, art: 'beanie.png', gearId: null },
  { id: 'item-crown', kind: 'hat', name: 'Crown', gold: 60, art: 'crown.png', gearId: null },
  { id: 'item-wizard-hat', kind: 'hat', name: 'Wizard Hat', gold: 40, art: 'wizard-hat.png', gearId: null },
  { id: 'item-party-hat', kind: 'hat', name: 'Party Hat', gold: 25, art: 'party-hat.png', gearId: null },
  // neck
  { id: 'item-scarf', kind: 'neck', name: 'Scarf', gold: 20, art: 'scarf.png', gearId: null },
  { id: 'item-bowtie', kind: 'neck', name: 'Bow Tie', gold: 25, art: 'bowtie.png', gearId: null },
  { id: 'item-cape', kind: 'neck', name: 'Cape', gold: 45, art: 'cape.png', gearId: null },
  // face
  { id: 'item-sunglasses', kind: 'face', name: 'Sunglasses', gold: 18, art: 'sunglasses.png', gearId: null },
  { id: 'item-monocle', kind: 'face', name: 'Monocle', gold: 22, art: 'monocle.png', gearId: null },
  // feet
  { id: 'item-boots', kind: 'feet', name: 'Boots', gold: 30, art: 'boots.png', gearId: null },
  // gear (premium worn) — these are the slots GearStore1155 ids drive. The gearId is
  // an EXAMPLE mapping; the real ids come from GearStore1155.registerGear() at deploy
  // and should be filled in here (or loaded from a config) once gear is registered.
  { id: 'gear-crown-king', kind: 'gear', name: "King's Crown", gold: 500, art: 'crown-king.png', gearId: 1 },
  { id: 'gear-cape-royal', kind: 'gear', name: 'Royal Cape', gold: 500, art: 'cape-royal.png', gearId: 2 },
  // stickers (layer 0, laminated — NFT-only)
  { id: 'sticker-acorn', kind: 'sticker', name: 'Acorn Sticker', gold: 5, art: 'acorn.png', gearId: null },
  { id: 'sticker-coin', kind: 'sticker', name: 'Coin Sticker', gold: 5, art: 'coin.png', gearId: null },
  { id: 'sticker-flower', kind: 'sticker', name: 'Flower Sticker', gold: 8, art: 'flower.png', gearId: null },
  { id: 'sticker-gem', kind: 'sticker', name: 'Gem Sticker', gold: 10, art: 'gem.png', gearId: null },
  { id: 'sticker-heart', kind: 'sticker', name: 'Heart Sticker', gold: 6, art: 'heart.png', gearId: null },
  { id: 'sticker-leaf', kind: 'sticker', name: 'Leaf Sticker', gold: 3, art: 'leaf.png', gearId: null },
  { id: 'sticker-mushroom', kind: 'sticker', name: 'Mushroom Sticker', gold: 5, art: 'mushroom.png', gearId: null },
  { id: 'sticker-star', kind: 'sticker', name: 'Star Sticker', gold: 8, art: 'star.png', gearId: null },
  { id: 'sticker-water', kind: 'sticker', name: 'Water Sticker', gold: 4, art: 'water.png', gearId: null },
];
const itemDef = (id) => ITEMS.find((x) => x.id === id) || null;
// Reverse lookup: GearStore1155 token id -> the cosmetics item it equips (gear-hook).
const itemByGearId = (gearId) => ITEMS.find((x) => x.gearId != null && Number(x.gearId) === Number(gearId)) || null;
const itemBucket = (kind) =>
  kind === 'sticker' ? 'stickers' : kind === 'gear' ? 'gear' : 'items';

// variant helpers (identical scheme to the Base game + Solana crew)
const variantId = (itemId, color) => itemId + ':' + color;
function parseVariant(vid) {
  if (!vid) return { itemId: null, color: 'natural' };
  const i = vid.lastIndexOf(':');
  if (i < 0) return { itemId: vid, color: 'natural' };
  return { itemId: vid.slice(0, i), color: vid.slice(i + 1) };
}

// ---- Slot layout (paper-doll anchor points) ----
// Coords NORMALIZED to the sprite canvas (0..1). Tuned to the acorn art (see ref).
// A saved per-NFT override always wins over these defaults (design-mode rule).
const SLOT_LAYOUT = {
  boy: {
    hat: { x: 0.50, y: 0.150, w: 0.30, h: 0.16 },
    face: { x: 0.50, y: 0.235, w: 0.24, h: 0.10 },
    neck: { x: 0.50, y: 0.350, w: 0.34, h: 0.13 },
    feet: { x: 0.50, y: 0.930, w: 0.34, h: 0.10 },
    gear: { x: 0.50, y: 0.150, w: 0.40, h: 0.24 },
  },
  girl: {
    hat: { x: 0.50, y: 0.160, w: 0.30, h: 0.16 },
    face: { x: 0.50, y: 0.245, w: 0.24, h: 0.10 },
    neck: { x: 0.50, y: 0.360, w: 0.34, h: 0.13 },
    feet: { x: 0.50, y: 0.935, w: 0.34, h: 0.10 },
    gear: { x: 0.50, y: 0.160, w: 0.40, h: 0.24 },
  },
};

// Order worn items are painted (lower = further back). Layer 2 only.
const WORN_DRAW_ORDER = ['gear', 'neck', 'feet', 'face', 'hat'];

// Default sticker size when one has no saved {x,y,scale} (fraction of canvas width).
const STICKER_DEFAULT_W = 0.16;

module.exports = {
  COLORS, colorDef,
  ITEMS, itemDef, itemByGearId, itemBucket,
  variantId, parseVariant,
  SLOT_LAYOUT, WORN_DRAW_ORDER, STICKER_DEFAULT_W,
};
