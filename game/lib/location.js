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
  journeys: "sts_journeys", // { [shipId]: { fromHex,toHex,fromPort,toPort,departAt,arriveAt,sailSpeed,crewIds,distance,hours,encounter } }
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
  ["port_royal",      "Port Royal",       7,  4, "Crown Waters",        0], // central isle, big SOUTH dock / harbour town
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

// The three LIVE ships, by stable key. Seeded at the hub on first use.
export const SHIPS = {
  ship_black_tide: { id: "ship_black_tide", name: "The Black Tide" },
  ship_harbor_guard: { id: "ship_harbor_guard", name: "Harbor Guard" },
  ship_redrum_raiders: { id: "ship_redrum_raiders", name: "Redrum Raiders" },
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
  };
}

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

// roll a PVE encounter for a leg, weighted by the crossing's danger. danger 0 → always null.
function rollEncounter(danger, routeId) {
  if (danger <= 0) return null;
  const chance = Math.min(0.85, danger * 0.22); // 1→22%, 2→44%, 3→66%
  if (Math.random() >= chance) return null;
  const pool = ENEMY_POOL[danger] || ENEMY_POOL[3];
  const t = pool[Math.floor(Math.random() * pool.length)];
  const enemy = {
    id: `pve-${t.slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: t.name,
    endowment: { ...t.endowment },
    loadout: { ...t.loadout },
  };
  return { type: "pve", danger, routeId, enemy };
  // ── PINNED: PVP ship-raiding hook ──────────────────────────────────────────────────────
  // When PVP is unpinned, this is where an open-water leg could instead roll a { type:'pvp',
  // enemy:<another player's ship snapshot> } against ships sharing/adjacent to a hex. ALL PVE
  // for now — do NOT build PVP raiding here yet.
}

/**
 * Start a voyage — stamps the time-lock. The ship FREE-FLOATS to ANY hex (open water) or port.
 * Optionally pass the ship's crew ids so they lock + land with the ship (the deck sails as one).
 * @param {string} shipId
 * @param {string|{q:number,r:number}} target  a portId OR a free-float {q,r} hex
 * @param {number} [sailSpeed=DEFAULT_SAIL_SPEED]
 * @param {string[]} [crewIds=[]]  pawn ids aboard — locked at sea, auto-moved on arrival
 * @returns {{ journey: object, encounter: object|null }}
 */
export function setSail(shipId, target, sailSpeed = DEFAULT_SAIL_SPEED, crewIds = []) {
  const can = canSetSail(shipId, target);
  if (!can.ok) throw new Error(`[location] cannot set sail: ${can.reason}`); // visible, never silent

  const fromHex = getHex(shipId);
  const toHex = asHex(target);
  if (!toHex) throw new Error(`[location] unknown destination ${JSON.stringify(target)}`);
  const speed = Number(sailSpeed) > 0 ? Number(sailSpeed) : DEFAULT_SAIL_SPEED;

  const distance = hexDistance(fromHex, toHex);                 // hexes
  const hours = distance * EIGHT_HOURS;                         // fiction: 8h per hex
  const danger = Math.max(hexDanger(fromHex.q, fromHex.r), hexDanger(toHex.q, toHex.r));
  const fromPort = portAtHex(fromHex), toPort = portAtHex(toHex);

  const departAt = Date.now();
  const arriveAt = departAt + Math.round((distance * MS_PER_HEX) / speed); // dev-scaled wall clock
  const routeId = `${fromPort || `${fromHex.q},${fromHex.r}`}__${toPort || `${toHex.q},${toHex.r}`}`;
  const encounter = rollEncounter(danger, routeId);

  const journeys = allJourneys();
  journeys[shipId] = {
    fromHex, toHex, fromPort, toPort, departAt, arriveAt, sailSpeed: speed,
    crewIds: Array.isArray(crewIds) ? [...crewIds] : [],
    distance, hours, encounter,
  };
  writeJourneys(journeys);

  return {
    journey: {
      from: fromPort, to: toPort, fromHex, toHex, departAt, arriveAt,
      secsLeft: Math.max(0, Math.ceil((arriveAt - departAt) / 1000)),
      distance, hours,
    },
    encounter,
  };
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
