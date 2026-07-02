// @ts-check
// game/lib/location.js — THE one true HEX-WORLD map + voyage clock for "Seize the Seas".
//
// WHAT THIS IS
//   The location/journey layer that EVERY other system reads to know "where is this
//   pawn / ship, and is it free to act?" It is the spatial twin of coins.js (money) and
//   weight.js (carry): a single source of truth, game-layer, localStorage only. NO chain,
//   NO network — voyages are a pure client-side TIME-LOCK, just like a job shift.
//
// THE WORLD IS A HEX MAP (free-float, not a graph)
//   The backdrop is the hand-drawn sea-map art (game/art/world-map.jpg). A flat-top, odd-q
//   hex grid is CALIBRATED to the drawn hexes (see CALIBRATION below). Every PORT sits on a
//   hex on its island. Ships FREE-FLOAT: they may sail to ANY hex — open water or an island —
//   not just along charted lanes. Geography is the art itself.
//
// EACH HEX = 8 HOURS of travel
//   A voyage covers hexDistance(from,to) hexes; in fiction that is hexes * EIGHT_HOURS hours.
//   The real wall-clock lock is scaled down by MS_PER_HEX so testing is fast (same idea as the
//   old MS_PER_DISTANCE dial). Bump MS_PER_HEX toward EIGHT_HOURS' real ms to make voyages long.
//
// A VOYAGE IS A TIME-LOCK (the heart of this module)
//   setSail() stamps departAt=now and arriveAt=now + travel time. While now < arriveAt the
//   ship isAtSea() — LOCKED. tryArrive() is the poll: once the clock passes arriveAt it flips
//   the ship's hex to the target (and its crew with it), clears the journey, returns true.
//   No timer/daemon — callers poll tryArrive() on load / tick, same as job shifts.
//
// ── THE LOCK RULE (callers MUST honor this) ─────────────────────────────────────────────
//   While isAtSea(ship) is true, that ship AND its crew are "at sea" — in transit, unable to
//   fight, work, trade, or be press-ganged. areCoLocated() enforces it (anyone at sea is
//   co-located with no one). Pass a ship's crew ids to setSail() (4th arg) and isAtSea() is
//   true for them too; tryArrive() lands them at the destination — the whole deck moves as one.
//
// ── DOCKED vs OPEN WATER (preserves the port-based hold/warehouse logic) ─────────────────
//   getLocation(entityId) returns the PORT id when the entity sits on a port's hex (DOCKED),
//   otherwise null (OPEN WATER). The cargo-hold / warehouse logic is port-based, so a ship in
//   open water = its hold is unreachable (locked) — which is exactly correct.
//
// ENCOUNTERS — ALL PVE FOR NOW
//   Every setSail() rolls ONE possible PVE encounter for the leg, weighted by the waters'
//   danger (open ocean far from the hub, and waters near perilous ports, are dangerous). When
//   it fires you get encounter = { type:'pve', danger, routeId, enemy } shaped EXACTLY like a
//   PVP opponent snapshot (see seas/battle-grid/pvp.html + items.js) so the battle-grid fights
//   it with zero translation. No encounter → encounter:null.
//   PVP ship-raiding is PINNED — see the clearly-marked stub at the bottom; do NOT build it yet.

// ── storage (localStorage in the browser; in-memory shim under Node so tests run) ────────
const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  };
})();

const K = {
  loc: "sts_hexpos",        // { [entityId]: {q,r} }  — pawns AND ships share this map (free-float hex)
  journeys: "sts_journeys", // { [shipId]: { fromHex,toHex,fromPort,toPort,departAt,arriveAt,sailSpeed,crewIds,distance,hours,encounter,mode,medium } }
  terrain: "sts_terrain",   // { "q,r": terrainType }  — per-hex land terrain overrides (default 'sea'; islands derive from region)
};

// no silent catches — warn loudly on bad data, never swallow
function readJSON(key, fallback) {
  const raw = store.getItem(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch (e) { console.warn(`[location] bad JSON in ${key}, resetting:`, e); return fallback; }
}
function writeJSON(key, val) { store.setItem(key, JSON.stringify(val)); }

// ── CALIBRATION ─────────────────────────────────────────────────────────────────────────
// Tuned to the drawn hexes on game/art/world-map.jpg by overlaying this exact grid math on the
// art and nudging until the red outlines sat on the painted hexes. APPROXIMATE — nudge these
// if the art is re-exported. Flat-top, odd-q offset (verified against the painted hexes).
//   hexToPixel(q,r): x = HEX_SIZE*1.5*q + ORIGIN_X
//                    y = HEX_SIZE*SQRT3*(r + 0.5*(q&1)) + ORIGIN_Y
// CALIBRATED 2026-06-25 to the 2048×1536 hand-drawn art (re-drawn with BIGGER hexes than the
// old 1168×880 export — fewer, larger cells). Column pitch 1.5·SIZE≈140px, row pitch √3·SIZE≈161px.
export const WORLD_W = 2048;   // world-map.jpg natural width  (px)
export const WORLD_H = 1536;   // world-map.jpg natural height (px)
export const HEX_SIZE = 93;    // center→vertex px of ONE drawn hex
export const ORIGIN_X = 35;    // pixel x of hex (0,0)'s center
export const ORIGIN_Y = 18;    // pixel y of hex (0,0)'s center
export const GRID_COLS = 16;   // hex columns that cover the image width
export const GRID_ROWS = 11;   // hex rows that cover the image height
const SQRT3 = Math.sqrt(3);

// ── HEX MATH (ported from seas/battle-grid/tot-engine.js → hexGrid.ts, world-scaled) ─────
/** Hex (q,r) → pixel center on the world-map image. */
export function hexToPixel(hex, size = HEX_SIZE, ox = ORIGIN_X, oy = ORIGIN_Y) {
  const x = size * 1.5 * hex.q + ox;
  const y = size * SQRT3 * (hex.r + 0.5 * (hex.q & 1)) + oy;
  return { x, y };
}
/** SVG points string for a flat-top hex outline centered at (cx,cy). */
export function hexPolygonPoints(cx, cy, size = HEX_SIZE) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push(`${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}
function toCube(hex) {
  const x = hex.q;
  const z = hex.r - (hex.q - (hex.q & 1)) / 2;
  const y = -x - z;
  return { x, y, z };
}
/** Hex grid distance (number of hexes between two cells). */
export function hexDistance(a, b) {
  const ac = toCube(a), bc = toCube(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
}
const EVEN_Q_NEIGHBORS = [
  { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: -1 }, { dq: -1, dr: 0 }, { dq: 0, dr: +1 },
];
const ODD_Q_NEIGHBORS = [
  { dq: +1, dr: +1 }, { dq: +1, dr: 0 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
];
/** The 6 neighbours of a hex (odd-q), clamped to the world grid. */
export function hexNeighbors(hex) {
  const offsets = (hex.q & 1) === 0 ? EVEN_Q_NEIGHBORS : ODD_Q_NEIGHBORS;
  return offsets
    .map((d) => ({ q: hex.q + d.dq, r: hex.r + d.dr }))
    .filter((h) => h.q >= 0 && h.q < GRID_COLS && h.r >= 0 && h.r < GRID_ROWS);
}
/** Pixel → nearest hex (robust: picks the closest center among local candidates). */
export function pixelToHex(px, py, size = HEX_SIZE, ox = ORIGIN_X, oy = ORIGIN_Y) {
  const approxQ = Math.round((px - ox) / (size * 1.5));
  let best = { q: 0, r: 0 }, bestD = Infinity;
  for (let q = approxQ - 1; q <= approxQ + 1; q++) {
    const approxR = Math.round((py - oy) / (size * SQRT3) - 0.5 * (q & 1));
    for (let r = approxR - 1; r <= approxR + 1; r++) {
      const c = hexToPixel({ q, r }, size, ox, oy);
      const d = (c.x - px) ** 2 + (c.y - py) ** 2;
      if (d < bestD) { bestD = d; best = { q, r }; }
    }
  }
  return best;
}
/** Are two hexes the same cell? */
export function sameHex(a, b) { return !!a && !!b && a.q === b.q && a.r === b.r; }

// ── THE PORTS (now placed on the painted islands by HEX) ─────────────────────────────────
// Each port keeps its original id/name/region/danger; q,r place it on its island in the art.
// x/y (0..100 %) are DERIVED from the hex center for any legacy reader — single source of truth.
// Each port sits on its island's visible DOCK/pier (or harbour town) hex on the 2048×1536 art.
const PORT_DEFS = [
  // id,                name,             q,  r,  region,                danger
  ["port_royal",      "Port Royal",       8,  3, "Crown Waters",        0], // central isle hub @ hex (8,3) = ON-CHAIN loc 8003 (q*1000+r); matches world-features.js TOWN + settlements.js loc:8003 (immutable anchor)
  ["tortuga_cove",    "Tortuga Cove",     2,  2, "Buccaneer Shallows",  1], // top-left forest isle, south harbour
  ["saltmarsh",       "Saltmarsh",       12,  2, "Saltmarsh Reach",     1], // top-right isle, south dock
  ["beacon_isle",     "Beacon Isle",     11,  5, "Beacon Light",        1], // lighthouse isle, west dock
  ["bonewater_atoll", "Bonewater Atoll",  2,  6, "Bonewater Atolls",    2], // left-middle isle, harbour town (pier at 3,6)
  ["kraken_deep",     "Kraken Deep",      5,  8, "The Maw",             3], // bottom-left isle, harbour town (pier at 6,9)
  ["skull_reef",      "Skull Reef",      10,  8, "The Black Reach",     3], // bottom-right ruins isle, dock
];
export const PORTS = (() => {
  const out = {};
  for (const [id, name, q, r, region, danger] of PORT_DEFS) {
    const c = hexToPixel({ q, r });
    out[id] = {
      id, name, q, r, region, danger,
      x: Math.round((c.x / WORLD_W) * 1000) / 10,   // 0..100 % of image width  (legacy/back-compat)
      y: Math.round((c.y / WORLD_H) * 1000) / 10,   // 0..100 % of image height
    };
  }
  return out;
})();

/** The port whose hex this entity is standing on, or null (open water). */
function portAtHex(hex) {
  if (!hex) return null;
  for (const id in PORTS) if (PORTS[id].q === hex.q && PORTS[id].r === hex.r) return id;
  return null;
}

// Suggested sea-lanes between ports — now MAP FLAVOUR ONLY (lines to draw), NOT a travel
// restriction (free-float lets you sail anywhere). distance/danger are recomputed live.
export const ROUTES = [
  { from: "port_royal", to: "tortuga_cove" },
  { from: "port_royal", to: "saltmarsh" },
  { from: "port_royal", to: "beacon_isle" },
  { from: "port_royal", to: "bonewater_atoll" },
  { from: "port_royal", to: "kraken_deep" },
  { from: "tortuga_cove", to: "bonewater_atoll" },
  { from: "saltmarsh", to: "beacon_isle" },
  { from: "beacon_isle", to: "skull_reef" },
  { from: "bonewater_atoll", to: "kraken_deep" },
  { from: "skull_reef", to: "kraken_deep" },
];

// ── dials ────────────────────────────────────────────────────────────────────────────────
export const HUB_PORT = "port_royal";
export const DEFAULT_SAIL_SPEED = 10;
// Fiction: ONE hex of travel = EIGHT_HOURS in-game hours. UI shows hexes * 8h.
export const EIGHT_HOURS = 8;
// Real wall-clock dial: ms in transit = hexDistance * MS_PER_HEX / sailSpeed. Small for fast
// dev voyages (a 5-hex run at speed 10 = 2,500ms). Raise toward 8*3600*1000 to make hexes real.
export const MS_PER_HEX = 5000;

const HUB_HEX = { q: PORTS[HUB_PORT].q, r: PORTS[HUB_PORT].r };

// The LIVE ships, by stable key. Seeded at the hub (Port Royal) on first use → fresh ships
// start DOCKED at Port Royal (ensureSeed places them on HUB_HEX = the hub port's hex, so
// getLocation() returns the hub port and the map shows them in port, ready to sail).
// ADDITIVE: the original three keep their ids/names; species fields added for the Harbor's Log
// (founder memory). Sol del Mar is the founder's gold-market test launch — its full ship card
// (ticker/crewDist/species/hull/crewSize) is game-layer metadata only (no on-chain use here).
export const SHIPS = {
  ship_black_tide: { id: "ship_black_tide", name: "The Black Tide", species: "orc", crewSize: 100 },     // big ship (founder)
  ship_harbor_guard: { id: "ship_harbor_guard", name: "Harbor Guard", species: "human", crewSize: 100 }, // fee-share default (confirm)
  ship_redrum_raiders: { id: "ship_redrum_raiders", name: "Redrum Raiders", species: "goblin", crewSize: 100 }, // founder: ~same as Black Tide
  ship_sol_del_mar: { id: "ship_sol_del_mar", name: "Sol del Mar", ticker: "SOLM", species: "elf", hull: "schooner", crewSize: 12, crewDist: "0x9500880DEC9B310b4a728C75A271a25615A2443E" },
};

// ── DANGER FIELD (per hex) ───────────────────────────────────────────────────────────────
// "Distance from safe waters": open ocean far from the hub is rough, and waters near a
// perilous port stay perilous a few hexes out. clamp 0..3 → drives encounter weight + colour.
export function hexDanger(q, r) {
  const here = { q, r };
  // open-ocean tier: the further from the calm hub, the rougher
  const hub = hexDistance(here, HUB_HEX);
  let base = hub <= 2 ? 0 : hub <= 4 ? 1 : hub <= 5 ? 2 : 3;
  // port influence: a danger-3 port radiates 3 at its hex, 2 one hex away, 1 two hexes away…
  let influence = 0;
  for (const id in PORTS) {
    const p = PORTS[id];
    influence = Math.max(influence, (p.danger || 0) - hexDistance(here, { q: p.q, r: p.r }));
  }
  return Math.max(0, Math.min(3, Math.max(base, influence)));
}

// ── ENEMY TEMPLATES (PVE snapshots, shaped like a PVP opponent: pvp.html) ────────────────
// endowment uses REAL cause keys (burgers/tgn/egp/pump/char/ccc/bluechip) → class-engine stats.
// loadout gear ids are REAL armory ids (items.js / gear-data.js). Tougher tier = higher danger.
const ENEMY_POOL = {
  1: [
    { slug: "reef-scavenger", name: "Reef Scavenger", endowment: { burgers: 8 },
      loadout: { weapon: "handaxe-iron", armor: "armor", trinket: null } },
    { slug: "tide-cutpurse", name: "Tide Cutpurse", endowment: { egp: 8 },
      loadout: { weapon: "dagger-iron", armor: "armor-studded", trinket: null } },
  ],
  2: [
    { slug: "brineblade-marauder", name: "Brineblade Marauder", endowment: { burgers: 16, egp: 4 },
      loadout: { weapon: "scimitar-iron", armor: "armor-chain-shirt", trinket: "lantern" } },
    { slug: "gravewater-conjurer", name: "Gravewater Conjurer", endowment: { pump: 14, char: 4 },
      loadout: { weapon: "dagger-iron", armor: "armor", trinket: "lantern" } },
  ],
  3: [
    { slug: "black-reach-reaver", name: "Black Reach Reaver", endowment: { burgers: 28 },
      loadout: { weapon: "greataxe-steel", armor: "armor-chainmail", trinket: "relic" } },
    { slug: "maw-leviathan-caller", name: "Maw Leviathan-Caller", endowment: { pump: 22, ccc: 6 },
      loadout: { weapon: "warhammer-steel", armor: "armor-breastplate", trinket: "relic" } },
    { slug: "kraken-corsair", name: "Kraken Corsair", endowment: { bluechip: 26 },
      loadout: { weapon: "longsword-steel", armor: "armor-chainmail", trinket: "spyglass" } },
  ],
};

// ── seeding ──────────────────────────────────────────────────────────────────────────────
// Default-place the live ships at the hub hex if they have no recorded position yet. Also
// MIGRATES the old { [id]: portId } string format → { [id]: {q,r} } hexes. Idempotent.
function ensureSeed() {
  let map = readJSON(K.loc, null);
  if (map && typeof map === "object") {
    let changed = false;
    for (const id of Object.keys(map)) {
      const v = map[id];
      if (typeof v === "string") {              // legacy: a portId → that port's hex (or hub)
        const p = PORTS[v] || PORTS[HUB_PORT];
        map[id] = { q: p.q, r: p.r }; changed = true;
      }
    }
    for (const id of Object.keys(SHIPS)) if (!(id in map)) { map[id] = { ...HUB_HEX }; changed = true; }
    if (changed) writeJSON(K.loc, map);
    return map;
  }
  const fresh = {};
  for (const id of Object.keys(SHIPS)) fresh[id] = { ...HUB_HEX };
  writeJSON(K.loc, fresh);
  return fresh;
}

// ── free-float hex position (works for any entityId — a pawn id OR a ship id) ─────────────
/** An entity's free-float hex. Defaults to the hub hex if never set. */
export function getHex(entityId) {
  const map = ensureSeed();
  const h = map[entityId];
  return h && typeof h === "object" ? { q: h.q, r: h.r } : { ...HUB_HEX };
}
/** Move an entity to a hex (instant — the voyage clock is handled by setSail/tryArrive). */
export function setHex(entityId, q, r) {
  const map = ensureSeed();
  map[entityId] = { q, r };
  writeJSON(K.loc, map);
}

// ── port-based location (preserves the original public API) ──────────────────────────────
/** The PORT id this entity is docked at, or null if it's in open water. */
export function getLocation(entityId) {
  return portAtHex(getHex(entityId));
}
/** Move an entity to a PORT (instant) — sets its hex to that port's hex. */
export function setLocation(entityId, portId) {
  const p = PORTS[portId];
  if (!p) { console.warn(`[location] setLocation: unknown port "${portId}"`); return; }
  setHex(entityId, p.q, p.r);
}

// ── route lookup (ANY hex/port → ANY hex/port, computed) ─────────────────────────────────
// Accepts a portId string OR a {q,r} hex for either end. distance = hexDistance; danger = the
// rougher of the two endpoints' hexDanger. Free-float: there are no forbidden lanes.
function asHex(target) {
  if (target && typeof target === "object" && Number.isFinite(target.q) && Number.isFinite(target.r)) {
    return { q: target.q, r: target.r };
  }
  const p = PORTS[target];
  return p ? { q: p.q, r: p.r } : null;
}
/** Public route lookup → { distance, danger, hours } | null. ANY-to-ANY (portId or {q,r}). */
export function routeBetween(from, to) {
  const a = asHex(from), b = asHex(to);
  if (!a || !b || sameHex(a, b)) return null;
  const distance = hexDistance(a, b);
  const danger = Math.max(hexDanger(a.q, a.r), hexDanger(b.q, b.r));
  return { distance, danger, hours: distance * EIGHT_HOURS };
}

// ── journeys (the time-lock) ─────────────────────────────────────────────────────────────
function allJourneys() { const j = readJSON(K.journeys, {}); return j && typeof j === "object" ? j : {}; }
function writeJourneys(j) { writeJSON(K.journeys, j); }
function rawJourney(shipId) { return allJourneys()[shipId] || null; }

/** True while a ship is in transit (now < arriveAt) — OR for any pawn aboard a sailing ship. */
export function isAtSea(shipId) {
  const now = Date.now();
  const journeys = allJourneys();
  const own = journeys[shipId];
  if (own && now < own.arriveAt) return true;
  for (const j of Object.values(journeys)) {
    if (now < j.arriveAt && Array.isArray(j.crewIds) && j.crewIds.includes(shipId)) return true;
  }
  return false;
}

/** The active voyage for a ship → { from,to,fromHex,toHex,departAt,arriveAt,secsLeft,distance,hours } | null. */
export function journeyOf(shipId) {
  const j = rawJourney(shipId);
  if (!j) return null;
  const now = Date.now();
  if (now >= j.arriveAt) return null; // arrived (or past) — tryArrive() finalizes it
  return {
    from: j.fromPort ?? null,   // PORT id if departed from a port, else null (open water)
    to: j.toPort ?? null,       // PORT id if bound for a port, else null (open water)
    fromHex: j.fromHex,
    toHex: j.toHex,
    departAt: j.departAt,
    arriveAt: j.arriveAt,
    secsLeft: Math.max(0, Math.ceil((j.arriveAt - now) / 1000)),
    distance: j.distance,
    hours: j.hours,
    mode: j.mode || "ship",
    medium: j.medium || "sea",
  };
}

/** True while an entity is in transit by ANY mode (sea OR land) — alias of isAtSea, read for
 *  land travel where "at sea" reads wrong. In transit = locked: can't fight/work/trade/be reached. */
export function isTraveling(entityId) { return isAtSea(entityId); }

/** Two entities can interact iff same hex AND neither is at sea. */
export function areCoLocated(idA, idB) {
  if (isAtSea(idA) || isAtSea(idB)) return false;
  return sameHex(getHex(idA), getHex(idB));
}

/** Can this ship sail to the target right now? Free-float: any hex/port except its own cell. */
export function canSetSail(shipId, target) {
  if (isAtSea(shipId)) return { ok: false, reason: "already at sea" };
  const dest = asHex(target);
  if (!dest) return { ok: false, reason: "unknown destination" };
  if (dest.q < 0 || dest.q >= GRID_COLS || dest.r < 0 || dest.r >= GRID_ROWS)
    return { ok: false, reason: "off the chart" };
  if (sameHex(getHex(shipId), dest)) return { ok: false, reason: "already here" };
  return { ok: true, reason: null };
}

// ═════════════════════════════════════════════════════════════════════════════════════════
//  LAND TRAVEL + TERRAIN (caravans : land :: ships : sea)
//  Travel time per hex by mode: ship 8h (sea), MOUNT 8h (land), FOOT 24h (a full day on foot).
//  ROUGH TERRAIN slows the WALK: each land hex costs base × TERRAIN_COST. So a man on foot
//  crossing a mountain = 24h × 2.5 = 60h; on a mount = 8h × 2.5 = 20h. Sea is flat 8h/hex.
// ═════════════════════════════════════════════════════════════════════════════════════════

export const TRAVEL = {
  ship:  { hoursPerHex: 8,  land: false, sea: true  }, // a rigged ship — open water only
  mount: { hoursPerHex: 8,  land: true,  sea: false }, // horse / caravan team — back to 8h/hex
  foot:  { hoursPerHex: 24, land: true,  sea: false }, // a pawn on foot — ONE DAY per hex
};

// terrain → walk-time multiplier (sea is the ship baseline). Rough ground (forest/hills/
// mountain/swamp) makes the FOOT/MOUNT clock climb; a road is faster than open plains.
export const TERRAIN_COST = {
  sea: 1, road: 0.6, plains: 1, grass: 1, beach: 1.1, desert: 1.4,
  jungle: 1.7, forest: 1.6, hills: 1.8, swamp: 2.2, mountain: 2.5,
};
// Default land terrain of each port's island (by region) — islands are walkable, the sea is not.
const REGION_TERRAIN = {
  "Crown Waters": "plains", "Buccaneer Shallows": "jungle", "Saltmarsh Reach": "swamp",
  "Beacon Light": "hills", "Bonewater Atolls": "beach", "The Maw": "mountain", "The Black Reach": "mountain",
};

/** Terrain of a hex. Override registry wins; else a port hex / its neighbours are that island's
 *  land; everything else is open 'sea'. setTerrain() lets future inland maps paint real ground. */
function terrainAt(q, r) {
  const ov = readJSON(K.terrain, {}) || {};
  const key = `${q},${r}`;
  if (ov[key]) return ov[key];
  for (const id in PORTS) {
    const p = PORTS[id];
    if (hexDistance({ q, r }, { q: p.q, r: p.r }) <= 1) return REGION_TERRAIN[p.region] || "plains";
  }
  return "sea";
}
export function getTerrain(q, r) { return terrainAt(q, r); }
export function setTerrain(q, r, type) {
  if (!(type in TERRAIN_COST)) throw new Error(`[location] setTerrain: unknown terrain "${type}"`);
  const ov = readJSON(K.terrain, {}) || {};
  ov[`${q},${r}`] = type;
  writeJSON(K.terrain, ov);
}

// ── cube helpers for a straight hex line (so per-hex terrain is summed along the real path) ──
function cubeToOffset(c) { return { q: c.x, r: c.z + (c.x - (c.x & 1)) / 2 }; }
function cubeRound(c) {
  let rx = Math.round(c.x), ry = Math.round(c.y), rz = Math.round(c.z);
  const dx = Math.abs(rx - c.x), dy = Math.abs(ry - c.y), dz = Math.abs(rz - c.z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}
function cubeLerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; }
/** The ordered hexes a straight route from a→b passes through (inclusive). */
function hexLine(a, b) {
  const n = hexDistance(a, b);
  if (n === 0) return [{ q: a.q, r: a.r }];
  const ac = toCube(a), bc = toCube(b), out = [];
  for (let i = 0; i <= n; i++) out.push(cubeToOffset(cubeRound(cubeLerp(ac, bc, i / n))));
  return out;
}
/** Fiction hours for one leg by mode. Ship = flat 8h/hex; land = Σ per-hex (base × terrain). */
function legHours(fromHex, toHex, mode) {
  const m = TRAVEL[mode] || TRAVEL.ship;
  if (!m.land) return hexDistance(fromHex, toHex) * m.hoursPerHex;
  const line = hexLine(fromHex, toHex);
  let h = 0;
  for (let i = 1; i < line.length; i++) h += m.hoursPerHex * (TERRAIN_COST[terrainAt(line[i].q, line[i].r)] || 1);
  return Math.round(h);
}

// ── LAND foes (bandits / brigands), shaped like the sea pool — the FALLBACK for land legs ────
const LAND_ENEMY_POOL = {
  1: [
    { slug: "road-cutpurse", name: "Road Cutpurse", endowment: { egp: 8 },
      loadout: { weapon: "dagger-iron", armor: "armor", trinket: null } },
    { slug: "hedge-bandit", name: "Hedge Bandit", endowment: { burgers: 8 },
      loadout: { weapon: "handaxe-iron", armor: "armor", trinket: null } },
  ],
  2: [
    { slug: "highwayman", name: "Highwayman", endowment: { egp: 14, burgers: 4 },
      loadout: { weapon: "scimitar-iron", armor: "armor-studded", trinket: "lantern" } },
    { slug: "forest-stalker", name: "Forest Stalker", endowment: { burgers: 14 },
      loadout: { weapon: "dagger-iron", armor: "armor-chain-shirt", trinket: null } },
  ],
  3: [
    { slug: "brigand-captain", name: "Brigand Captain", endowment: { burgers: 24, egp: 6 },
      loadout: { weapon: "greataxe-steel", armor: "armor-chainmail", trinket: "relic" } },
    { slug: "mountain-reaver", name: "Mountain Reaver", endowment: { bluechip: 22 },
      loadout: { weapon: "warhammer-steel", armor: "armor-breastplate", trinket: "relic" } },
  ],
};

// ── rich-bestiary wiring (the "encounter depth" hook) ───────────────────────────────────────
// area-encounters.js was BUILT to be location.js's roll source. Load it LAZILY + non-blocking so
// a concurrent edit there can never break the map's load — until/unless it resolves, the inline
// pools above stand in. Failure is logged (never silent).
let _areaRoll = null, _areaHints = null;
import("../seas/battle-grid/area-encounters.js")
  .then((m) => { if (typeof m.rollEncounter === "function") { _areaRoll = m.rollEncounter; _areaHints = m.AREA_HINTS || null; } })
  .catch((e) => console.warn("[location] area-encounters not loaded — using inline foe pools:", e.message));

// pick the themed area id for a leg (sea: by danger; land: jungle landfall / caves in the deep).
function pickArea(medium, danger, fromHex) {
  if (medium === "land") return danger >= 3 ? "sea-caves" : "island-jungle";
  const byD = _areaHints && _areaHints.byPortDanger;
  return (byD && byD[Math.min(3, Math.max(0, danger))]) || "open-sea";
}

// roll ONE possible PVE encounter for a leg, weighted by danger + medium (sea raiders / land
// bandits). Tries the rich bestiary first; falls back to the inline pool. danger 0 sea → calm.
function rollLegEncounter(danger, routeId, medium, fromHex) {
  if (danger <= 0 && medium === "sea") return null;
  const chance = Math.min(0.85, Math.max(1, danger) * 0.22); // 1→22% 2→44% 3→66%
  if (Math.random() >= chance) return null;
  if (_areaRoll) {
    try {
      const enc = _areaRoll(pickArea(medium, danger, fromHex), danger + 1);
      // accept the FULL rich result — raider leads (endowment) AND monster squads (group blob,
      // built by units.js from monsterId). encounter.js routes group encs to the squad path.
      if (enc && enc.type === "pve" && (enc.enemy || (Array.isArray(enc.group) && enc.group.length)))
        return { ...enc, danger, routeId, medium };
    } catch (e) { console.warn("[location] area roll failed — inline fallback:", e.message); }
  }
  const pool = (medium === "land" ? LAND_ENEMY_POOL : ENEMY_POOL)[danger] || (medium === "land" ? LAND_ENEMY_POOL[1] : ENEMY_POOL[3]);
  const t = pool[Math.floor(Math.random() * pool.length)];
  return {
    type: "pve", danger, routeId, medium,
    enemy: { id: `pve-${t.slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: t.name, endowment: { ...t.endowment }, loadout: { ...t.loadout } },
  };
  // ── PINNED: PVP raiding — an open leg could instead roll { type:'pvp', enemy:<ship snapshot> }
  //    against ships sharing/adjacent to a hex. PVE only for now.
}

// ── CARAVANS (land cargo haulers — caravans : land :: ships : sea) ───────────────────────────
// A caravan is just an entity in the shared hex map; it travels by 'mount' (8h/hex). Cargo
// tonnage gates how much it hauls (weight.js), exactly like a ship's hold.
export const CARAVANS = {
  caravan_mule:  { id: "caravan_mule",  name: "Mule Train", cargoTons: 2,  mount: true },
  caravan_wagon: { id: "caravan_wagon", name: "Ox Wagon",   cargoTons: 6,  mount: true },
  caravan_train: { id: "caravan_train", name: "Trade Train", cargoTons: 14, mount: true },
};

/**
 * Start a journey by ANY mode — the generalized time-lock under both ships AND land travel.
 * Sea ('ship') = flat 8h/hex over open water. Land ('foot' 24h/hex, 'mount' 8h/hex) sums the
 * per-hex terrain cost (mountains/forests slow the walk). Rolls one PVE encounter for the leg
 * (sea raiders / land bandits). The party (crewIds) locks + lands together.
 * @param {string} entityId  ship / pawn / caravan id
 * @param {string|{q,r}} target  portId OR free-float {q,r}
 * @param {{mode?:'ship'|'foot'|'mount', speed?:number, partyIds?:string[]}} [opts]
 * @returns {{ journey: object, encounter: object|null }}
 */
export function setCourse(entityId, target, opts = {}) {
  const mode = TRAVEL[opts.mode] ? opts.mode : "ship";
  const speed = Number(opts.speed) > 0 ? Number(opts.speed) : DEFAULT_SAIL_SPEED;
  const partyIds = Array.isArray(opts.partyIds) ? [...opts.partyIds] : [];

  if (isAtSea(entityId)) throw new Error("[location] cannot depart: already in transit");
  const fromHex = getHex(entityId);
  const toHex = asHex(target);
  if (!toHex) throw new Error(`[location] unknown destination ${JSON.stringify(target)}`);
  if (toHex.q < 0 || toHex.q >= GRID_COLS || toHex.r < 0 || toHex.r >= GRID_ROWS) throw new Error("[location] destination off the chart");
  if (sameHex(fromHex, toHex)) throw new Error("[location] already here");

  const medium = TRAVEL[mode].sea ? "sea" : "land";
  const distance = hexDistance(fromHex, toHex);
  const hours = legHours(fromHex, toHex, mode);                 // fiction hours (terrain-aware on land)
  const danger = Math.max(hexDanger(fromHex.q, fromHex.r), hexDanger(toHex.q, toHex.r));
  const fromPort = portAtHex(fromHex), toPort = portAtHex(toHex);

  const departAt = Date.now();
  // wall-clock scales with the fiction hours (so a 24h foot hex takes 3× a ship hex), / speed.
  const arriveAt = departAt + Math.round(((hours / EIGHT_HOURS) * MS_PER_HEX) / speed);
  const routeId = `${fromPort || `${fromHex.q},${fromHex.r}`}__${toPort || `${toHex.q},${toHex.r}`}`;
  const encounter = rollLegEncounter(danger, routeId, medium, fromHex);

  const journeys = allJourneys();
  journeys[entityId] = {
    fromHex, toHex, fromPort, toPort, departAt, arriveAt, sailSpeed: speed,
    crewIds: partyIds, distance, hours, encounter, mode, medium,
  };
  writeJourneys(journeys);

  return {
    journey: {
      from: fromPort, to: toPort, fromHex, toHex, departAt, arriveAt, mode, medium,
      secsLeft: Math.max(0, Math.ceil((arriveAt - departAt) / 1000)),
      distance, hours,
    },
    encounter,
  };
}

/**
 * Sail a ship (sea) — the original API, now a thin wrapper over setCourse(mode:'ship').
 * @returns {{ journey: object, encounter: object|null }}
 */
export function setSail(shipId, target, sailSpeed = DEFAULT_SAIL_SPEED, crewIds = []) {
  return setCourse(shipId, target, { mode: "ship", speed: sailSpeed, partyIds: crewIds });
}

/**
 * Travel overland — a pawn or caravan. On FOOT by default (24h/hex); pass mounted:true (or a
 * caravan) for 8h/hex. Rough terrain still slows it. Rolls a land (bandit) encounter for the leg.
 * @param {string} entityId
 * @param {string|{q,r}} target
 * @param {{mounted?:boolean, speed?:number, partyIds?:string[]}} [opts]
 */
export function travelOverland(entityId, target, opts = {}) {
  return setCourse(entityId, target, { mode: opts.mounted ? "mount" : "foot", speed: opts.speed, partyIds: opts.partyIds });
}

/**
 * Poll an arrival. If the ship's clock has passed arriveAt: flip the ship's hex to the
 * destination, MOVE ITS CREW with it (crewIds recorded at setSail + any extra ids passed here),
 * clear the journey, and return true. Otherwise return false (still sailing / no journey).
 * @param {string} shipId
 * @param {string[]} [extraCrewIds=[]] additional pawn ids to land with the ship
 */
export function tryArrive(shipId, extraCrewIds = []) {
  const j = rawJourney(shipId);
  if (!j) return false;
  if (Date.now() < j.arriveAt) return false; // still in transit — locked

  setHex(shipId, j.toHex.q, j.toHex.r);
  const crew = new Set([...(Array.isArray(j.crewIds) ? j.crewIds : []), ...(Array.isArray(extraCrewIds) ? extraCrewIds : [])]);
  for (const cid of crew) setHex(cid, j.toHex.q, j.toHex.r);

  const journeys = allJourneys();
  delete journeys[shipId];
  writeJourneys(journeys);
  return true;
}
