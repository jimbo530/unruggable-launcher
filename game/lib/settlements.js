// @ts-check
// settlements.js — the SETTLEMENTS + JOBS + BUNKS model for Seize the Seas (game-layer, no chain).
// Encodes the production/labor doctrine (see memory project_seas_production): which jobs exist,
// what stat each trains, how fast (wild-low / town-high), how many BUNKS each offers (the labor
// market), and which jobs are UNLIMITED (the prize-pool "commons" work). Sits beside location.js
// (hexes) + world-features.js (terrain/buildings). EXTENSIBLE: add JOBS + SETTLEMENTS rows as the
// world grows — Port Royal (the capital) gets one of every CITY job we design.
//
// CORE RULES (founder 2026-06-25):
//  • Bunks are FINITE everywhere (incl. Port Royal) → looking for work is real; you hunt/travel for slots.
//  • EXCEPTION: prize-pool-filling jobs (the "commons", e.g. Mayor) have UNLIMITED bunks — a public good.
//  • A job trains its tagged STAT via its own water (direct XP grant — NOT the funded charity cause-tokens).
//  • STAT GAIN scales by tier: WILD (camp/mill/mine) = low · TOWN = higher · CITY/CAPITAL = highest →
//    the reason to build towns/cities is to TRAIN pawns faster.

export const TIER = { MILL: "mill", CAMP: "camp", MINE: "mine", TOWN: "town", CITY: "city", CAPITAL: "capital" };

// stat-XP multiplier by settlement tier (the wild-low / town-high lever)
export const STAT_RATE = {
  [TIER.CAMP]: 1, [TIER.MILL]: 1, [TIER.MINE]: 1,   // WILD — rough work, low training
  [TIER.TOWN]: 3,                                     // proper facilities
  [TIER.CITY]: 5, [TIER.CAPITAL]: 5,                  // best training grounds
};

// default bunk caps by tier (per the settlement-tiers table; capital is bespoke per-job below)
export const BUNK_CAP = { [TIER.MILL]: 20, [TIER.CAMP]: 20, [TIER.MINE]: 20, [TIER.TOWN]: 40, [TIER.CITY]: 80 };

// ── JOB ROSTER ───────────────────────────────────────────────────────────────────────────
// id, name, stat (trained), kind: "dock"(town/city service) | "production"(wild) | "prize"(commons).
// `unlimited:true` → uncapped bunks (the prize-pool/commons jobs). Add rows over time.
export const JOBS = {
  // ── dock / city service jobs (the six stat trainers) ──
  haul_cargo:    { id: "haul_cargo",    name: "Haul Cargo",    stat: "STR", kind: "dock" },
  mend_nets:     { id: "mend_nets",     name: "Mend Nets",     stat: "DEX", kind: "dock" },
  stock_rations: { id: "stock_rations", name: "Stock Rations", stat: "CON", kind: "dock" },
  tend_beacon:   { id: "tend_beacon",   name: "Tend Beacon",   stat: "INT", kind: "dock" },
  sea_rites:     { id: "sea_rites",     name: "Sea-Rites",     stat: "WIS", kind: "dock" },
  barter:        { id: "barter",        name: "Barter",        stat: "CHA", kind: "dock" },
  // ── prize-pool "commons" job — UNLIMITED slots (funds the noble-rank/dungeon pools for everyone) ──
  guard_port:    { id: "guard_port",    name: "Guard the Port", stat: "CON", kind: "prize", unlimited: true },
  // ── GOVERNMENT OFFICE — SINGULAR seat (1 bunk). Feudal: holder's pawn takes 20% in GOLD, passes the
  //    rest UP the noble chain (Mayor→Lord→PettyKing→HighKing→Emperor=global pool). The coveted top of
  //    the labor market: prestige + power + income, and the pipe that funds the global commons pool. ──
  mayor:         { id: "mayor",         name: "Mayor", stat: "CHA", kind: "government", office: true, goldCut: 0.20, nobleTier: "mayor" },
  // ── wild production jobs (live at camps/mills/mines/farms, not in a city). `produces` = the good
  //    token a shift yields; a FOOD produce can be auto-routed to feed the crew (jobs-loop autoFeed). ──
  logging:       { id: "logging",       name: "Logging",       stat: "STR", kind: "production", produces: "logs" },
  milling:       { id: "milling",       name: "Milling",       stat: "CON", kind: "production", produces: "lumber" },
  // fishing/crabbing — WATER jobs; the catch IS a ration (founder 2026-06-26: route the yield to feed
  // the crew for the duration → "makes fishing and crabbing real in game jobs players can do").
  fishing:       { id: "fishing",       name: "Fishing",       stat: "WIS", kind: "production", produces: "fish" },
  crabbing:      { id: "crabbing",      name: "Crabbing",      stat: "DEX", kind: "production", produces: "crab" },
  // farming/vinekeeping — PRODUCE jobs (founder 2026-06-26: "vinyards and farms for difrent produce").
  farming:       { id: "farming",       name: "Farming",       stat: "CON", kind: "production", produces: "wheat" },
  vinekeeping:   { id: "vinekeeping",   name: "Vinekeeping",   stat: "WIS", kind: "production", produces: "grapes" },
};

// ── SERVICES (goods/services a settlement offers — the town-UI tiles) ──────────────────────
// One town UI template renders a settlement's `services` (+ its jobs). Port Royal (capital) gets
// the FULL set; smaller player-built towns list only what's been built → "same UI, fewer options".
export const SERVICE_META = {
  market:    { label: "Market",      icon: "⚖️", href: "../market/",      desc: "Buy provisions & gems at the keyed walls" },
  store:     { label: "General Store", icon: "🏪", href: "../store/",      desc: "Gear & cosmetics" },
  shipyard:  { label: "Shipyard",    icon: "⚓", href: "../shipyard/",    desc: "Buy ships with gold" },
  tavern:    { label: "Tavern",      icon: "🍺", href: "../tavern/",      desc: "Sign on crew" },
  crew:      { label: "Your Crew",   icon: "👥", href: "../crew/",        desc: "Gear & manage your crew" },
  craft:     { label: "Smithy",      icon: "🔨", href: "../craft/",       desc: "Forge & enchant gear" },
  decks:     { label: "The Decks",   icon: "⚔️", href: "../battle-grid/", desc: "Train / spar" },
  map:       { label: "World Map",   icon: "🗺️", href: "../map/",         desc: "Chart a course & set sail" },
};

// ── SETTLEMENTS ──────────────────────────────────────────────────────────────────────────
// id, name, tier, loc (location.js key), jobs: { jobId: bunks }. Port Royal = the CAPITAL: one of
// every city job, ~100 bunks each (flush), Mayor unlimited. Islands flesh out over time.
export const SETTLEMENTS = {
  port_royal: {
    id: "port_royal", name: "Port Royal", tier: TIER.CAPITAL, loc: 8003,
    jobs: { haul_cargo: 100, mend_nets: 100, stock_rations: 100, tend_beacon: 100, sea_rites: 100, barter: 100, guard_port: Infinity, mayor: 1 },
    services: ["market", "store", "shipyard", "tavern", "crew", "craft", "decks"], // map is a standing TAB, not a tile
  },
  // NOTE: the map is PLAYER-BUILT (founder 2026-06-26) — only Port Royal is dev-seeded. Players (+ the
  // founder) raise camps/mills/towns/cities on the hexes via the CampMillFactory build system; settlements
  // are ADDED here at runtime (or read from chain), NOT pre-placed by devs. So no tortuga/saltmarsh rows —
  // they fill in through play. REGIONAL noble offices (Lord→PettyKing→HighKing) emerge as players hit pop
  // goals; Emperor = the global achievement pool (never a player seat). [[reference_prize_pool_system]]
};

// ── NOBLE OFFICES unlock by POPULATION (founder 2026-06-25) ────────────────────────────────
// Players CREATE an office by growing a settlement to its pop threshold ("they make the job"); the
// bigger the settlement, the higher the rank it can host. Each holder skims goldCut (20%) and feeds
// the rest up the chain. EMPEROR is never a player seat — it's the global achievement pool.
export const NOBLE_RANKS = [
  { rank: "mayor",     minPop: 40,  goldCut: 0.20 },   // town
  { rank: "lord",      minPop: 80,  goldCut: 0.20 },   // city
  { rank: "pettyking", minPop: 100, goldCut: 0.20 },   // dense city
  { rank: "highking",  minPop: 200, goldCut: 0.20 },   // great city — the top PLAYER seat
];
/** Highest noble office a settlement of `population` can host (null if too small). */
export function highestOfficeFor(population) {
  let best = null;
  for (const r of NOBLE_RANKS) if (population >= r.minPop) best = r;
  return best;
}

// ── queries ──────────────────────────────────────────────────────────────────────────────
export function getSettlement(id) { return SETTLEMENTS[id] || null; }
export function getJob(id) { return JOBS[id] || null; }
/** Jobs offered at a settlement → [{ job, bunks, unlimited }]. */
export function settlementJobs(id) {
  const s = SETTLEMENTS[id]; if (!s) return [];
  return Object.entries(s.jobs).map(([jid, bunks]) => ({ job: JOBS[jid], bunks, unlimited: JOBS[jid]?.unlimited || bunks === Infinity }));
}
/** Goods/services a settlement offers → [{ key, label, icon, href, desc }] (the town-UI tiles). */
export function settlementServices(id) {
  const s = SETTLEMENTS[id];
  if (!s || !s.services) return [];
  return s.services.map((k) => ({ key: k, ...(SERVICE_META[k] || {}) })).filter((x) => x.label);
}
/** Bunk cap for (settlement, job): the settlement's explicit count, Infinity for unlimited/prize jobs. */
export function bunkCap(settlementId, jobId) {
  const s = SETTLEMENTS[settlementId]; if (!s) return 0;
  if (JOBS[jobId]?.unlimited) return Infinity;
  const b = s.jobs[jobId];
  return b == null ? 0 : b;
}
/** Stat-XP multiplier for a job at a settlement = the tier's training rate. */
export function statRate(settlementId) {
  const s = SETTLEMENTS[settlementId];
  return s ? (STAT_RATE[s.tier] ?? 1) : 1;
}
