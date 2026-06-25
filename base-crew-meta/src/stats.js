// ============================================================
//  stats.js — class / level / stats for a Base crew member.
//
//  The FeeShareDistributor itself stores NOTHING but ownership + the fee-share
//  accounting (accPerShare/rewardDebt). It has no class or level on-chain. So crew
//  "class/level/stats" are an OFF-CHAIN derivation, surfaced as NFT attributes.
//
//  v1 derivation (deterministic, no external calls):
//    - class  : a stable role drawn from the token id (every ship has a captain,
//               then a spread of deckhands/gunners/etc.). Deterministic so it never
//               flickers between metadata fetches.
//    - level  : starts at 1; an OPTIONAL override may be supplied by a game/keeper
//               via setStats() (e.g. WoW progression). Stored in the closet's stats
//               side-table when set; defaults to 1.
//    - stats  : a small STR/DEX/etc. block, also deterministic from the id, with the
//               same optional override hook.
//
//  This keeps attributes meaningful TODAY (so marketplaces show class/level/stats)
//  while leaving a clean seam to plug a real on-chain/keeper stat source in later.
// ============================================================
const fs = require('fs');
const path = require('path');
const { crewKey, tokenIdOf } = require('./closet');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

// The captain is token id 0 of each ship (mutiny quorum is 51/100, but id 0 reads
// nicely as "the captain" for display). The rest cycle through crew roles.
const CLASSES = ['First Mate', 'Gunner', 'Navigator', 'Bosun', 'Cook', 'Lookout', 'Deckhand', 'Carpenter', 'Quartermaster', 'Surgeon'];

function classFor(id) {
  if (id === 0) return 'Captain';
  return CLASSES[(id - 1) % CLASSES.length];
}

// Deterministic small stat block from the id (stable, 3..18 D&D-ish range).
function baseStatsFor(id) {
  const seed = (n) => 3 + ((id * 2654435761 + n * 40503) % 16); // cheap stable hash -> 3..18
  return { STR: seed(1), DEX: seed(2), CON: seed(3), INT: seed(4), WIS: seed(5), CHA: seed(6) };
}

// ---- optional override store (game/keeper can push real progression) ----
function loadStore() {
  try { return fs.existsSync(STATS_FILE) ? JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) : {}; }
  catch (e) { throw new Error('stats.json is unreadable: ' + e.message); }
}
function saveStore(s) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(s, null, 2));
}

// Set a crew's level and/or stat overrides (e.g. from a WoW progression keeper).
// Partial: only the fields you pass are overridden; the rest stay derived.
function setStats(a, b, patch) {
  let key; let p;
  if (patch === undefined) { key = crewKey(a); p = b; } else { key = crewKey(a, b); p = patch; }
  const store = loadStore();
  const cur = store[key] || {};
  if (p.level != null) cur.level = Math.max(1, Math.floor(Number(p.level)));
  if (p.class) cur.class = String(p.class);
  if (p.stats && typeof p.stats === 'object') cur.stats = { ...(cur.stats || {}), ...p.stats };
  store[key] = cur;
  saveStore(store);
  return cur;
}

// Resolve the effective class/level/stats for a crew (override wins, else derived).
function getStats(a, b) {
  const key = crewKey(a, b);
  const id = tokenIdOf(key);
  const store = loadStore();
  const o = store[key] || {};
  return {
    class: o.class || classFor(id),
    level: o.level != null ? o.level : 1,
    stats: { ...baseStatsFor(id), ...(o.stats || {}) },
  };
}

// As metadata attributes (trait_type/value pairs), EVM marketplace friendly.
function statsToAttributes(a, b) {
  const s = getStats(a, b);
  const out = [
    { trait_type: 'Class', value: s.class },
    { trait_type: 'Level', value: s.level },
  ];
  for (const k of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
    out.push({ trait_type: k, value: s.stats[k] });
  }
  return out;
}

module.exports = { classFor, baseStatsFor, getStats, setStats, statsToAttributes };
