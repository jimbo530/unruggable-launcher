// ============================================================
//  closet.js — the BASE crew "closet" (per-NFT look + per-owner inventory).
//
//  Adapted from crew-render-ref/closet.js. The ONE difference is the crew id
//  scheme. On Solana a crew id == the NFT mint address (one global collection).
//  On BASE every ship deploys its OWN FeeShareDistributor (a 100-NFT ERC-721,
//  ids 0..99), so a crew member is uniquely identified by:
//
//        crewKey = "<distributorAddressLowercased>:<tokenId>"     e.g.
//                  "0xabc...def:7"
//
//  This module accepts EITHER a full crewKey or a {distributor, tokenId} pair and
//  canonicalises to that string. Everything else (look store, inventory, names,
//  ship flag) is identical to the Solana service so the compositor + metadata
//  reuse it unchanged.
//
//  STORAGE: a local JSON file (data/closet.json). PRODUCTION should swap this for
//  the same Supabase tables the Base Acorn cosmetics use (cosmetics_look /
//  cosmetics_inventory) — same shapes, same variant id scheme.
// ============================================================
const fs = require('fs');
const path = require('path');
const { itemDef, parseVariant } = require('./cosmetics-config');
const { validateName, normalizeForUniqueness } = require('./names');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'closet.json');

const SLOTS = ['hat', 'face', 'neck', 'feet', 'gear']; // worn-item slots (layer 2)

// ---- crew id canonicalisation (Base: distributor + tokenId) ----
// Accepts:
//   crewKey("0xDist", 7)            -> "0xdist:7"
//   crewKey("0xDist:7")             -> "0xdist:7"   (already a key)
//   crewKey({distributor, tokenId}) -> "0xdist:7"
// A bare numeric/string id is allowed too (kept for parity / single-collection use).
function crewKey(a, b) {
  if (a && typeof a === 'object') return crewKey(a.distributor, a.tokenId);
  let s = String(a);
  if (b !== undefined && b !== null) s = s + ':' + String(b);
  const i = s.lastIndexOf(':');
  if (i > 0 && /^0x[0-9a-fA-F]{40}$/.test(s.slice(0, i))) {
    // distributor:tokenId -> lowercase the address half (EVM addresses are case-insensitive)
    return s.slice(0, i).toLowerCase() + ':' + s.slice(i + 1);
  }
  return s; // bare id (no distributor prefix)
}

// Extract a numeric token id from a crewKey for the deterministic gender split.
function tokenIdOf(key) {
  const m = String(key).match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

function emptyDb() {
  return { inv: {}, looks: {}, purchases: [], names: {}, nameIndex: {} };
}
function load() {
  try {
    if (!fs.existsSync(DB_FILE)) return emptyDb();
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      inv: db.inv || {}, looks: db.looks || {}, purchases: db.purchases || [],
      names: db.names || {}, nameIndex: db.nameIndex || {},
    };
  } catch (e) {
    // never silently swallow — surface corruption so it gets fixed
    throw new Error('closet.json is unreadable: ' + e.message);
  }
}
function save(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Deterministic DEFAULT gender by token id (stable, ~50/50): even -> girl, odd -> boy.
function genderFor(key) {
  return (tokenIdOf(key) % 2 === 0) ? 'girl' : 'boy';
}
function defaultLook(key) {
  return { base: genderFor(key), color: 'natural', items: {}, stickers: [], shipFlag: null };
}

// ---- LOOK (per crew NFT) ----
function getLook(a, b) {
  const key = crewKey(a, b);
  const db = load();
  const stored = db.looks[key];
  if (!stored) return defaultLook(key);
  const look = { ...stored };
  if (!look.baseChosen) look.base = genderFor(key); // default split unless deliberately chosen
  return look;
}
function setLook(a, b, look) {
  // setLook(key, look) OR setLook(distributor, tokenId, look)
  let key; let l;
  if (look === undefined) { key = crewKey(a); l = b; } else { key = crewKey(a, b); l = look; }
  const db = load();
  const cur = db.looks[key] || defaultLook(key);
  db.looks[key] = {
    base: l.base || cur.base,
    baseChosen: l.base ? true : (cur.baseChosen || false),
    color: l.color || cur.color,
    items: l.items || cur.items,
    stickers: l.stickers || cur.stickers,
    shipFlag: l.shipFlag !== undefined ? l.shipFlag : (cur.shipFlag || null),
  };
  save(db);
  return db.looks[key];
}

function setBase(a, b, base) {
  let key; let v;
  if (base === undefined) { key = crewKey(a); v = b; } else { key = crewKey(a, b); v = base; }
  if (v !== 'boy' && v !== 'girl') throw new Error('base must be "boy" or "girl"');
  const db = load();
  const cur = db.looks[key] || defaultLook(key);
  cur.base = v; cur.baseChosen = true;
  db.looks[key] = cur; save(db);
  return cur;
}

function setColor(a, b, color) {
  let key; let v;
  if (color === undefined) { key = crewKey(a); v = b; } else { key = crewKey(a, b); v = color; }
  const db = load();
  const cur = db.looks[key] || defaultLook(key);
  cur.color = v || 'natural';
  db.looks[key] = cur; save(db);
  return cur;
}

// EQUIP / UNEQUIP a worn slot. variant = "<itemId>:<colorId>" (or null to clear).
function equip(key, slot, variant) {
  key = crewKey(key);
  if (!SLOTS.includes(slot)) throw new Error('bad slot "' + slot + '" (use ' + SLOTS.join('/') + ')');
  const db = load();
  const cur = db.looks[key] || defaultLook(key);
  cur.items = { ...(cur.items || {}) };
  if (variant) {
    const { itemId } = parseVariant(variant);
    const def = itemDef(itemId);
    if (!def) throw new Error('unknown item: ' + variant);
    const okKind = def.kind === slot || (slot === 'gear' && def.kind === 'gear');
    if (!okKind) throw new Error('item "' + itemId + '" (' + def.kind + ') cannot go in slot "' + slot + '"');
    cur.items[slot] = variant;
  } else {
    delete cur.items[slot];
  }
  db.looks[key] = cur; save(db);
  return cur;
}

function setStickers(key, stickers) {
  key = crewKey(key);
  if (!Array.isArray(stickers)) throw new Error('stickers must be an array');
  const db = load();
  const cur = db.looks[key] || defaultLook(key);
  cur.stickers = stickers;
  db.looks[key] = cur; save(db);
  return cur;
}

// SET (or clear) a crew's ship flag — the TOP-LEFT corner badge. Dynamic: changing
// this re-renders the NFT with NO re-mint.
function setShipFlag(key, flag) {
  key = crewKey(key);
  if (flag != null && !/^[a-z0-9_-]+$/i.test(flag)) throw new Error('bad shipFlag id: ' + flag);
  const db = load();
  const cur = db.looks[key] || defaultLook(key);
  cur.shipFlag = flag || null;
  db.looks[key] = cur; save(db);
  return cur;
}

// ---- INVENTORY (per owner wallet) ----
function getInventory(owner) {
  const db = load();
  return db.inv[String(owner).toLowerCase()] || {};
}
function grant(owner, variant, qty = 1) {
  owner = String(owner).toLowerCase();
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

// ---- NAMES (per crew NFT) ----
function getName(key) { return load().names[crewKey(key)] || null; }
function getDisplayName(key) {
  key = crewKey(key);
  return load().names[key] || `Crew #${tokenIdOf(key)}`;
}
function nameOwner(name) { return load().nameIndex[normalizeForUniqueness(name)] || null; }

function setName(key, rawName) {
  key = crewKey(key);
  if (!key) throw new Error('crew id is required');
  const display = validateName(rawName);
  const norm = normalizeForUniqueness(display);
  const db = load();
  const holder = db.nameIndex[norm];
  if (holder && holder !== key) throw new Error(`name "${display}" is already taken`);
  const prev = db.names[key];
  if (prev) {
    const prevKey = normalizeForUniqueness(prev);
    if (prevKey !== norm && db.nameIndex[prevKey] === key) delete db.nameIndex[prevKey];
  }
  db.names[key] = display;
  db.nameIndex[norm] = key;
  save(db);
  return { id: key, name: display };
}
function clearName(key) {
  key = crewKey(key);
  const db = load();
  const prev = db.names[key];
  if (prev) {
    const prevKey = normalizeForUniqueness(prev);
    if (db.nameIndex[prevKey] === key) delete db.nameIndex[prevKey];
    delete db.names[key];
    save(db);
  }
  return { id: key, name: null };
}

module.exports = {
  DB_FILE, SLOTS, crewKey, tokenIdOf,
  defaultLook, getLook, setLook,
  setBase, setColor, equip, setStickers, setShipFlag,
  getInventory, grant,
  getName, getDisplayName, nameOwner, setName, clearName,
};
