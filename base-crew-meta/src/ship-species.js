// ============================================================
//  ship-species.js — per-SHIP crew species (CAPTAIN'S CHOICE, settable + stored).
//
//  In "Seize the Seas" the CAPTAIN picks the sprite set (species) that crews their
//  ship AT LAUNCH. A whole crew is ONE species = that ship's identity. So species
//  is a STORED, SETTABLE value keyed by the SHIP — NOT a hardcoded rule.
//
//  The SHIP is the crew-collection address: on Base every ship is its own
//  FeeShareDistributor (a 100-NFT ERC-721), and a crew member is keyed
//  "<distributorAddress>:<tokenId>" (see closet.js crewKey). The ship is the
//  distributor-address half. A plain ship slug (e.g. "redrum-raiders") also works
//  before an on-chain distributor exists.
//
//  STORAGE: a local JSON file (data/ship-species.json), mirroring closet.js's
//  store. PRODUCTION should swap this for the same Supabase/localStorage the other
//  ship-launch pages use — same get/set shape. setShipSpecies / getShipSpecies are
//  the API the launch UI + render call.
//
//  SEEDS below are EXAMPLE DEFAULTS only (Redrum Raiders -> goblin), applied when a
//  ship has no stored choice. Any captain can pick any species; a stored choice
//  always overrides the seed.
// ============================================================
const fs = require('fs');
const path = require('path');
const { speciesId, SPECIES } = require('./asset-manifest');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'ship-species.json');

// Default when a ship has neither a stored choice nor a seed. Human is the default
// LIVE species (real art); acorn remains the ultimate art fallback in render.js.
const DEFAULT_SHIP_SPECIES = 'human';

// The species a captain may choose at launch (acorn kept selectable as fallback).
const SPECIES_OPTIONS = ['human', 'dwarf', 'elf', 'goblin', 'orc', 'dragonborn', 'acorn'];

// EXAMPLE seed defaults (NOT a fixed rule). Keyed by ship slug or distributor
// address (lowercased). A stored captain choice always wins over these.
const SHIP_SPECIES_SEED = {
  'redrum-raiders': 'goblin',
  'black-tide': 'acorn',
};

// ---- ship id from a crewKey ----
// crewKey is "<distributor>:<tokenId>" (closet.js) — the ship is the part before
// the LAST ':'. A bare slug/id (no distributor prefix) is returned as-is.
function shipOf(crewKey) {
  const s = String(crewKey || '');
  const i = s.lastIndexOf(':');
  const ship = i > 0 ? s.slice(0, i) : s; // strip ":tokenId"
  return ship.toLowerCase();
}

// ---- persistent store (data/ship-species.json: { "<ship>": "<speciesId>" }) ----
function load() {
  try {
    if (!fs.existsSync(DB_FILE)) return {};
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) || {};
  } catch (e) {
    // never silently swallow — surface corruption so it gets fixed
    throw new Error('ship-species.json is unreadable: ' + e.message);
  }
}
function save(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// SET a ship's species (captain's choice at launch). shipKey = a crewKey, a bare
// ship slug, or a distributor address — all normalised to the ship id. Throws on
// an unknown species so a bad choice is visible, never silently coerced.
function setShipSpecies(shipKey, species) {
  const ship = shipOf(shipKey);
  if (!ship) throw new Error('ship id is required');
  const s = String(species || '').toLowerCase();
  if (!SPECIES[s]) throw new Error('unknown species "' + species + '" (use ' + SPECIES_OPTIONS.join('/') + ')');
  const db = load();
  db[ship] = s;
  save(db);
  return { ship, species: s };
}

// GET a ship's species id: stored captain choice -> seed default -> global default.
// Always normalised + fallback-safe via speciesId().
function getShipSpecies(shipKey) {
  const ship = shipOf(shipKey);
  const stored = load()[ship];
  return speciesId(stored || SHIP_SPECIES_SEED[ship] || DEFAULT_SHIP_SPECIES);
}

// Resolve a full crewKey ("0xdist:7" or a slug) to its ship's species id. This is
// what render.js / metadata.js call.
function speciesForCrewKey(crewKey) {
  return getShipSpecies(crewKey);
}

module.exports = {
  DB_FILE, DEFAULT_SHIP_SPECIES, SPECIES_OPTIONS, SHIP_SPECIES_SEED,
  shipOf, setShipSpecies, getShipSpecies, speciesForCrewKey,
};
