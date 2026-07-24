// ============================================================
//  closet.js — the crew "closet" (per-NFT look + per-owner inventory)
//  Mirrors the Base cosmetics tables (cosmetics-schema.sql):
//    cosmetics_inventory  -> inv   (owner -> { item_id: {kind, qty} })
//    cosmetics_look       -> looks (crewId -> { base, color, items, stickers })
//    cosmetics_purchases  -> purchases (audit log)
//
//  STORAGE: a local JSON file (data/closet.json). This is the dev/start store.
//  PRODUCTION: swap this module for the Supabase REST calls in
//  MfT-Launch/memetree-meta/cosmetics.cjs (same shapes, same id scheme) once
//  SUPABASE_URL / SUPABASE_KEY are set. The crewId here == the NFT mint address
//  in production (we use a plain string id now since nothing is minted yet).
// ============================================================
const fs = require('fs');
const path = require('path');
const { itemDef, parseVariant } = require('./cosmetics-config');
const { validateName, normalizeForUniqueness } = require('./names');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'closet.json');

const SLOTS = ['hat', 'face', 'neck', 'feet', 'gear']; // worn-item slots (layer 2)

function emptyDb() {
  // names:     crewId -> display name (owner-set; absent => "Crew #N")
  // nameIndex: normalizedName -> crewId  (the UNIQUE claim registry)
  return { inv: {}, looks: {}, purchases: [], names: {}, nameIndex: {} };
}
function load() {
  try {
    if (!fs.existsSync(DB_FILE)) return emptyDb();
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw);
    return {
      inv: db.inv || {},
      looks: db.looks || {},
      purchases: db.purchases || [],
      names: db.names || {},
      nameIndex: db.nameIndex || {},
    };
  } catch (e) {
    // never silently swallow — surface the corruption so it gets fixed
    throw new Error('closet.json is unreadable: ' + e.message);
  }
}
function save(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// A crew starts natural colour, nothing equipped. Default gender is DETERMINISTIC
// by crew id (see genderFor): odd id -> boy, even id -> girl (a stable ~50/50 split;
// crew-1 stays a boy). An owner can still deliberately switch via setBase().
function defaultLook(crewId) {
  return { base: genderFor(crewId), color: 'natural', items: {}, stickers: [], shipFlag: null };
}

// Deterministic DEFAULT gender for a crew, STABLE by id and exactly ~50/50:
//   odd  numeric id -> 'boy'   (so crew-1, crew-3, ... are boys)
//   even numeric id -> 'girl'  (so crew-2, crew-4, ... are girls)
// A non-numeric / unparseable id falls back to 'boy'. This is the DEFAULT only:
// a look whose base was deliberately chosen (baseChosen=true) overrides it.
function genderFor(crewId) {
  const m = String(crewId).match(/(\d+)/);
  if (!m) return 'boy';
  return (parseInt(m[1], 10) % 2 === 0) ? 'girl' : 'boy';
}

// ---- LOOK (per crew NFT) ----
// Resolves the stored look (or a default) AND applies the deterministic gender
// split: unless the owner deliberately picked a gender (baseChosen), `base` is set
// from genderFor(crewId). This single resolution point keeps the render, the
// metadata "Base" trait, and the look API all consistent.
function getLook(crewId) {
  const db = load();
  const stored = db.looks[crewId];
  if (!stored) return defaultLook(crewId);
  const look = { ...stored };
  if (!look.baseChosen) look.base = genderFor(crewId);
  return look;
}
function setLook(crewId, look) {
  const db = load();
  const cur = db.looks[crewId] || defaultLook(crewId);
  db.looks[crewId] = {
    base: look.base || cur.base,
    // a base passed here is a deliberate choice; preserve any prior deliberate flag
    baseChosen: look.base ? true : (cur.baseChosen || false),
    color: look.color || cur.color,
    items: look.items || cur.items,
    stickers: look.stickers || cur.stickers,
    shipFlag: look.shipFlag !== undefined ? look.shipFlag : (cur.shipFlag || null),
  };
  save(db);
  return db.looks[crewId];
}

// pick the base sprite (boy|girl) for a crew. This is a DELIBERATE owner choice, so
// it sets baseChosen=true and from now on overrides the genderFor() default split.
function setBase(crewId, base) {
  if (base !== 'boy' && base !== 'girl') throw new Error('base must be "boy" or "girl"');
  const db = load();
  const cur = db.looks[crewId] || defaultLook(crewId);
  cur.base = base;
  cur.baseChosen = true;
  db.looks[crewId] = cur;
  save(db);
  return cur;
}

// set the body colour tint (one of the 9 colour ids)
function setColor(crewId, color) {
  const db = load();
  const cur = db.looks[crewId] || defaultLook(crewId);
  cur.color = color || 'natural';
  db.looks[crewId] = cur;
  save(db);
  return cur;
}

// EQUIP / UNEQUIP a worn item slot. variant = "<itemId>:<colorId>" (or null to clear).
// Mirrors the Base /cosmetics/equip endpoint (items are NOT consumed when worn).
function equip(crewId, slot, variant) {
  if (!SLOTS.includes(slot)) throw new Error('bad slot "' + slot + '" (use ' + SLOTS.join('/') + ')');
  const db = load();
  const cur = db.looks[crewId] || defaultLook(crewId);
  cur.items = { ...(cur.items || {}) };
  if (variant) {
    const { itemId } = parseVariant(variant);
    const def = itemDef(itemId);
    if (!def) throw new Error('unknown item: ' + variant);
    // slot/kind sanity: a hat goes in the hat slot, etc. ('gear' may sit in gear)
    const okKind = def.kind === slot || (slot === 'gear' && def.kind === 'gear');
    if (!okKind) throw new Error('item "' + itemId + '" (' + def.kind + ') cannot go in slot "' + slot + '"');
    cur.items[slot] = variant;
  } else {
    delete cur.items[slot];
  }
  db.looks[crewId] = cur;
  save(db);
  return cur;
}

// SET the laminated sticker sheet (layer 0). stickers = array of
// "<stickerId>:<colorId>" or { id, x, y, scale }. Mirrors the laminate concept.
function setStickers(crewId, stickers) {
  if (!Array.isArray(stickers)) throw new Error('stickers must be an array');
  const db = load();
  const cur = db.looks[crewId] || defaultLook(crewId);
  cur.stickers = stickers;
  db.looks[crewId] = cur;
  save(db);
  return cur;
}

// SET (or clear) a crew's ship flag — the TOP-LEFT corner badge on the render.
// flag = a slug like 'laroyal' | 'tide' (resolves to /token/<flag>.png), or null
// to remove it. Dynamic: changing this re-renders the NFT with NO re-mint.
function setShipFlag(crewId, flag) {
  if (flag != null && !/^[a-z0-9_-]+$/i.test(flag)) throw new Error('bad shipFlag id: ' + flag);
  const db = load();
  const cur = db.looks[crewId] || defaultLook(crewId);
  cur.shipFlag = flag || null;
  db.looks[crewId] = cur;
  save(db);
  return cur;
}

// ---- INVENTORY (per owner) — what cosmetics a wallet owns to equip ----
function getInventory(owner) {
  const db = load();
  return db.inv[owner] || {};
}
// grant N of an item to an owner (dev helper; production grants come from verified buys)
function grant(owner, variant, qty = 1) {
  const { itemId } = parseVariant(variant);
  const def = itemDef(itemId);
  if (!def) throw new Error('unknown item: ' + variant);
  const db = load();
  db.inv[owner] = db.inv[owner] || {};
  const cur = db.inv[owner][variant] || { kind: def.kind, qty: 0 };
  cur.qty += qty;
  db.inv[owner][variant] = cur;
  save(db);
  return db.inv[owner];
}

// ---- NAMES (per crew NFT) — owner-set after mint, UNIQUE across all crews ----
// A crew has no stored name until its owner sets one; getName returns null then
// and getDisplayName falls back to "Crew #N" (mirrors the Acorn default-name
// pattern). The `nameIndex` is the claim registry: a normalized name maps to at
// most ONE crewId, which is how uniqueness is enforced.

// the raw owner-chosen name, or null if unnamed
function getName(crewId) {
  const db = load();
  return db.names[crewId] || null;
}

// the name to render in metadata: the owner's name, else "Crew #<id>"
function getDisplayName(crewId) {
  const db = load();
  return db.names[crewId] || `Crew #${crewId}`;
}

// which crew (if any) currently holds a given name (post-normalization)
function nameOwner(name) {
  const db = load();
  return db.nameIndex[normalizeForUniqueness(name)] || null;
}

// SET or RENAME a crew's name. First name is free; renames are allowed but the
// new name must be unique + pass every check. Renaming releases the old name.
// `force` is a no-op placeholder for future admin/moderation use; not used here.
function setName(crewId, rawName) {
  if (!crewId) throw new Error('crewId is required');
  const display = validateName(rawName);          // length + charset + profanity
  const key = normalizeForUniqueness(display);

  const db = load();

  // UNIQUENESS: if the normalized name is already claimed by a DIFFERENT crew,
  // reject. (If it's claimed by THIS crew, it's a casing/spacing-only edit and
  // we allow it — e.g. "bob" -> "Bob".)
  const holder = db.nameIndex[key];
  if (holder && holder !== crewId) {
    throw new Error(`name "${display}" is already taken`);
  }

  // RENAME: release this crew's previous name from the registry (if any and if
  // it maps to a different key) so the old name returns to the pool.
  const prev = db.names[crewId];
  if (prev) {
    const prevKey = normalizeForUniqueness(prev);
    if (prevKey !== key && db.nameIndex[prevKey] === crewId) {
      delete db.nameIndex[prevKey];
    }
  }

  db.names[crewId] = display;
  db.nameIndex[key] = crewId;
  save(db);
  return { id: crewId, name: display };
}

// clear a crew's name (returns it to "Crew #N"); frees the name from the pool.
function clearName(crewId) {
  const db = load();
  const prev = db.names[crewId];
  if (prev) {
    const prevKey = normalizeForUniqueness(prev);
    if (db.nameIndex[prevKey] === crewId) delete db.nameIndex[prevKey];
    delete db.names[crewId];
    save(db);
  }
  return { id: crewId, name: null };
}

module.exports = {
  DB_FILE, SLOTS,
  defaultLook, getLook, setLook,
  setBase, setColor, equip, setStickers, setShipFlag,
  getInventory, grant,
  getName, getDisplayName, nameOwner, setName, clearName,
};
