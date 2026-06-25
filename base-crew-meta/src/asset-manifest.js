// ============================================================
//  asset-manifest.js — maps the compositor's expected asset paths onto the REAL
//  Grok art at D:\grok-sprites\acorn\, and flags which sources still need a
//  colorkey cutout before they can composite.
//
//  WHY THIS EXISTS (reconcile, don't duplicate):
//    The compositor (render.js + cosmetics-config.js) loads art from
//        assets/<bucket>/<art>      (bucket = base | items | gear | stickers)
//    e.g. assets/items/crown.png, assets/base/acornboy.png. The Grok art lives in
//    a DIFFERENT layout (items/cut/, stickers/cut/, gear/, layers/, char/, and a
//    few loose base PNGs). This manifest is the single source of truth that:
//      - records the canonical compositor path each catalog id maps to,
//      - records the BEST Grok source file for it,
//      - flags `needsCutout: true` when that source is still on a magenta bg /
//        dark rounded corners (so it CANNOT composite until cut), and
//      - notes when a richer Grok source EXTENDS the catalog (new hats, robes…).
//
//  It does NO image processing. `npm run stage-assets` (stage-assets.js) reads it
//  to COPY the already-clean sources into assets/ and to print the exact list of
//  files that still need the INVENTORY.md cutout pass. Cutout is left to the art
//  pipeline (ffmpeg colorkey / processSprite), per the task instruction.
//
//  Probed status (src/probe-art.js + src/probe-bg.js, 2026-06-22):
//    items/cut/*    -> RGBA, corners fully transparent  => READY
//    stickers/cut/* -> RGBA, corners fully transparent  => READY
//    gear/*         -> RGB, magenta bg (#a63b67..#ae4d68) + dark rounded corners
//                      (#050505/#141414)                => NEEDS CUTOUT
//    nft-base.png / girl-clean.png / acornboy-new-raw.png / layers/*-base-*
//                   -> RGB, opaque tan/scene bg         => NEEDS CUTOUT (base)
// ============================================================
const path = require('path');

// Root of the Grok art drop.
const GROK = 'D:\\grok-sprites\\acorn';
const g = (...p) => path.join(GROK, ...p);

// Cutout recipe to apply to a NEEDS-CUTOUT source (from INVENTORY.md). Carried as
// data so stage-assets / the art pipeline can print/run it; we never run it here.
const CUTOUT = {
  magenta: {
    note: 'magenta bg + dark rounded corners (grok capture)',
    // crop ~3-5% to drop rounded corners, then colorkey the pink gradient.
    ffmpeg: (inFile, outFile, key = '0xa63b67') =>
      `ffmpeg -y -i "${inFile}" -vf "crop=iw*0.94:ih*0.94,colorkey=${key}:0.36:0.10,format=rgba" "${outFile}"`,
  },
  tan: {
    note: 'opaque tan/wood portrait bg (no magenta) — key the tan or hand-mask',
    ffmpeg: (inFile, outFile, key = '0xa18368') =>
      `ffmpeg -y -i "${inFile}" -vf "colorkey=${key}:0.30:0.08,format=rgba" "${outFile}"`,
  },
};

// ── BASE (the acorn body, boy/girl) ──────────────────────────────────────────
// The compositor wants assets/base/acornboy.png + acorngirl.png (transparent,
// then alpha-repaired). The cleanest Grok candidates still need a cutout.
// PREFERRED long-term: reuse the live crew-render-ref base art if it is already
// the transparent acorn (it is the same character) — see REPORT. These Grok bases
// are alternates that must be cut first.
const BASE = {
  boy: {
    dest: 'assets/base/acornboy.png',
    src: g('acornboy-new-raw.png'),     // 335x500, opaque — NEEDS CUTOUT
    alt: [g('nft-base.png'), g('layers', 'acornboy-base-short.png')],
    needsCutout: true, cutout: 'tan',
    note: 'best full-body boy; alt nft-base is square framed art, base-short is layer-art',
  },
  girl: {
    dest: 'assets/base/acorngirl.png',
    src: g('girl-clean.png'),           // 224x224, opaque "clean" but still no alpha
    alt: [g('char', 'acorngirl-idle-final.png')],
    needsCutout: true, cutout: 'tan',
    note: 'girl-clean is the tidied girl portrait; char/acorngirl-idle-final is the run-set idle',
  },
};

// ── SPECIES (per-ship crew body) ─────────────────────────────────────────────
// A SPECIES swaps the BASE BODY sprite for a whole crew (one ship = one species =
// ship identity). It does NOT touch SLOT_LAYOUT — that is keyed by gender
// (boy/girl) and is species-independent: the compositor fits whatever body PNG it
// gets into SPRITE_BOX_H and centers it, so a differently-sized species sprite
// just works. Worn items / stickers / flags are unchanged across species.
//
// Each species points at its boy/girl body PNGs RELATIVE TO assets/ (the dir the
// compositor already loads from, see render.js ASSETS). For acorn this is the
// existing default: assets/base/acornboy.png + acorngirl.png — so acorn requires
// NO new art and is always the safe fallback.
//
// Species art lives under assets/base/<species>/<species>{boy,girl}.png and is
// produced by `node scripts/stage-species.js`, which chroma-keys the green/magenta
// screen off the raw Downloads art and writes clean transparent PNGs. The current
// real dolls are a SINGLE body each, written as BOTH boy + girl until per-gender
// art lands. `ready:true` means the cut PNG is present; if a body PNG is missing
// at render time, render.js still falls back to acorn (see speciesBodyRel) so a
// render NEVER breaks. acorn is the ultimate fallback and needs no new art.
const SPECIES_FALLBACK = 'acorn'; // the species used when a chosen one has no art

const SPECIES = {
  // ULTIMATE FALLBACK — existing acorn body. Always present, never falls back.
  acorn: {
    name: 'Acorn',
    ready: true,
    body: {
      boy: 'base/acornboy.png',
      girl: 'base/acorngirl.png',
    },
  },
  // DEFAULT live species — green-screen keyed (#17e10f). Real art, ready.
  human: {
    name: 'Human',
    ready: true,
    body: {
      boy: 'base/human/humanboy.png',
      girl: 'base/human/humangirl.png',
    },
  },
  // Redrum Raiders crew — magenta keyed. Real art, ready.
  goblin: {
    name: 'Goblin',
    ready: true,
    body: {
      boy: 'base/goblin/goblinboy.png',
      girl: 'base/goblin/goblingirl.png',
    },
  },
  dwarf: {
    name: 'Dwarf',
    ready: true,
    body: {
      boy: 'base/dwarf/dwarfboy.png',
      girl: 'base/dwarf/dwarfgirl.png',
    },
  },
  elf: {
    name: 'Elf',
    ready: true,
    body: {
      boy: 'base/elf/elfboy.png',
      girl: 'base/elf/elfgirl.png',
    },
  },
  orc: {
    name: 'Orc',
    ready: true,
    body: {
      boy: 'base/orc/orcboy.png',
      girl: 'base/orc/orcgirl.png',
    },
  },
  dragonborn: {
    name: 'Dragonborn',
    ready: true,
    body: {
      boy: 'base/dragonborn/dragonbornboy.png',
      girl: 'base/dragonborn/dragonborngirl.png',
    },
  },
  // Art not dropped yet — selectable, falls back to acorn body until present.
  skeleton: {
    name: 'Skeleton',
    ready: false,
    body: {
      boy: 'base/skeleton/skeletonboy.png',
      girl: 'base/skeleton/skeletongirl.png',
    },
  },
};

// Normalise any species id -> a known species id (or the fallback).
function speciesId(id) {
  const s = String(id || SPECIES_FALLBACK).toLowerCase();
  return SPECIES[s] ? s : SPECIES_FALLBACK;
}

// Human-readable display name for a species id (for NFT traits).
function speciesName(id) {
  return SPECIES[speciesId(id)].name;
}

// Return the body PNG path (relative to assets/) for a species + gender, with a
// SAFE FALLBACK chain so render.js never needs to know the art layout:
//   1. the requested species' body for that gender, IF the PNG exists on disk;
//   2. else the acorn body for that gender (always present in production).
// `assetsDir` is render.js's ASSETS path; `exists` is fs.existsSync (injected so
// this module does no fs/IO of its own and stays pure/testable).
function speciesBodyRel(id, gender, assetsDir, exists) {
  const g = gender === 'girl' ? 'girl' : 'boy';
  const want = speciesId(id);
  const rel = SPECIES[want] && SPECIES[want].body[g];
  if (rel && (!exists || exists(path.join(assetsDir, rel)))) {
    return { species: want, rel, fellBack: false };
  }
  const fb = SPECIES[SPECIES_FALLBACK].body[g];
  return { species: SPECIES_FALLBACK, rel: fb, fellBack: want !== SPECIES_FALLBACK };
}

// ── ITEMS (worn, layer 2) — items/cut/* are READY (RGBA, transparent) ─────────
// catalogArt = the filename cosmetics-config.js asks for in assets/items/.
const ITEMS = {
  'beanie.png': { src: g('items', 'cut', 'beanie.png'), ready: true },
  'crown.png': { src: g('items', 'cut', 'crown.png'), ready: true },
  'wizard-hat.png': { src: g('items', 'cut', 'wizard-hat.png'), ready: true },
  'party-hat.png': { src: g('items', 'cut', 'party-hat.png'), ready: true },
  'scarf.png': { src: g('items', 'cut', 'scarf.png'), ready: true },
  'bowtie.png': { src: g('items', 'cut', 'bowtie.png'), ready: true },
  'cape.png': { src: g('items', 'cut', 'cape.png'), ready: true },
  'sunglasses.png': { src: g('items', 'cut', 'sunglasses.png'), ready: true },
  'monocle.png': { src: g('items', 'cut', 'monocle.png'), ready: true },
  'boots.png': { src: g('items', 'cut', 'boots.png'), ready: true },
};

// Extra ITEMS the Grok cut set provides BEYOND the current catalog. Wiring these
// is a one-line add to cosmetics-config.js ITEMS (kind+slot+art). Listed so the
// art isn't "lost"; not auto-added to avoid silently changing the catalog.
const ITEMS_EXTRA = {
  'backpack.png': { src: g('items', 'cut', 'backpack.png'), ready: true, suggestSlot: 'neck' },
  'cowboy-hat.png': { src: g('items', 'cut', 'cowboy-hat.png'), ready: true, suggestSlot: 'hat' },
  'flower-crown.png': { src: g('items', 'cut', 'flower-crown.png'), ready: true, suggestSlot: 'hat' },
  'headphones.png': { src: g('items', 'cut', 'headphones.png'), ready: true, suggestSlot: 'hat' },
  'fishing-rod.png': { src: g('items', 'cut', 'fishing-rod.png'), ready: true, suggestSlot: 'gear' },
  'pickaxe.png': { src: g('items', 'cut', 'pickaxe.png'), ready: true, suggestSlot: 'gear' },
  'wand.png': { src: g('items', 'cut', 'wand.png'), ready: true, suggestSlot: 'gear' },
  'watering-can.png': { src: g('items', 'cut', 'watering-can.png'), ready: true, suggestSlot: 'gear' },
};

// ── GEAR (premium worn) — all on magenta bg + dark corners => NEED CUTOUT ──────
// The catalog uses crown-king.png + cape-royal.png today. The Grok gear/ folder is
// a RICHER set (a whole "mayor"/"royal"/"reeve" wardrobe) — wire the extras into
// cosmetics-config.js when cut. dest = assets/gear/<file>.
const GEAR = {
  'crown-king.png': { src: g('gear', 'crown-king.png'), needsCutout: true, cutout: 'magenta', inCatalog: true },
  'cape-royal.png': { src: g('gear', 'cape-royal.png'), needsCutout: true, cutout: 'magenta', inCatalog: true },
  // extras (richer set; add to catalog after cutout)
  'monocle.png': { src: g('gear', 'monocle.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
  'hat-mayor.png': { src: g('gear', 'hat-mayor.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
  'chain-mayor.png': { src: g('gear', 'chain-mayor.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
  'coin-purse.png': { src: g('gear', 'coin-purse.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
  'hair-leaf-tuft.png': { src: g('gear', 'hair-leaf-tuft.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
  'hair-mop.png': { src: g('gear', 'hair-mop.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
  'ledger-tax.png': { src: g('gear', 'ledger-tax.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
  'robe-reeve.png': { src: g('gear', 'robe-reeve.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
  'robe-royal.png': { src: g('gear', 'robe-royal.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
  'scepter-king.png': { src: g('gear', 'scepter-king.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
  'seal-stamp.png': { src: g('gear', 'seal-stamp.png'), needsCutout: true, cutout: 'magenta', inCatalog: false },
};

// ── STICKERS (layer 0) — stickers/cut/* are READY (RGBA, transparent) ─────────
const STICKERS = {
  'acorn.png': { src: g('stickers', 'cut', 'acorn.png'), ready: true },
  'coin.png': { src: g('stickers', 'cut', 'coin.png'), ready: true },
  'flower.png': { src: g('stickers', 'cut', 'flower.png'), ready: true },
  'gem.png': { src: g('stickers', 'cut', 'gem.png'), ready: true },
  'heart.png': { src: g('stickers', 'cut', 'heart.png'), ready: true },
  'leaf.png': { src: g('stickers', 'cut', 'leaf.png'), ready: true },
  'mushroom.png': { src: g('stickers', 'cut', 'mushroom.png'), ready: true },
  'star.png': { src: g('stickers', 'cut', 'star.png'), ready: true },
  'water.png': { src: g('stickers', 'cut', 'water.png'), ready: true },
};
// NOTE: the catalog references water.png; if stickers/cut/water.png is the only
// "water" art, it is READY. (Probed: present + RGBA.)

module.exports = {
  GROK, CUTOUT, BASE, ITEMS, ITEMS_EXTRA, GEAR, STICKERS,
  SPECIES, SPECIES_FALLBACK, speciesId, speciesName, speciesBodyRel,
};
