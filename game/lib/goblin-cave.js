// @ts-check
// goblin-cave.js — THE GOBLIN CAVE: a foot-reachable PVE DUNGEON one hex EAST of Port Royal. Game-layer
// + localStorage only (the economic twin of bilge-rats.js). NO new COMBAT — the goblin fight runs through
// the HARDENED resolver (battle-grid/resolver.js resolveEncounter): deterministic from a server-issued
// seed, enemy AI re-computed server-side, replay-verified before any payout (project_seas_combat_settlement).
//
// HARDENED to the BILGE-RATS model (founder 2026-06-27 "do goblin cave, fights and prize pool"): the cave
// is the day-out sibling of the in-town bilge arena — harder (a 3–4 goblin pack incl. a slinger, on the
// chokepoint cave deck), gated by a WEEKLY per-pawn cooldown, and paying from a REAL deployed LootPool.
//
// THIS MODULE OWNS (everything else is reused):
//   1) THE CAVE SITE — a LAND hex EAST of the harbour (the cave painted ~1 hex out of the city). Its area
//      id ("goblin-cave") rolls a guaranteed small goblin pack (area-encounters.js single combat row).
//   2) WEEKLY PER-PAWN COOLDOWN — each pawn may RUN the cave once per 7 days (a real week by design; the
//      day-out dungeon cadence, vs bilge's 1h in-town arena). Surfaced as "Ready in Xd Xh".
//   3) DETERMINISTIC TEAMS — buildGoblinEnemies(seed, takenHexes) rebuilds the EXACT goblin squad (ids +
//      hexes) from the seed alone, so the seas-server can RECONSTRUCT the foes for verify-fight WITHOUT
//      trusting a client-supplied enemy list (closes the "submit weak goblins" hole) — exactly like bilge.
//   4) WIN → PENDING CLAIM — on a SERVER-VERIFIED win we record a PENDING claim the keeper settles by
//      calling the goblin-cave LootPool's payout(collection, tokenId). The pool pays, per the founder's
//      loot spec, 1% of EACH coin/good (COPPER floor + RICE + FLOUR + PORK) + the 100%-floor weapon
//      JACKPOTS (wooden/iron/steel long swords + a crossbow) to ownerOf(tokenId). NO fake payout here.
//
// SEPARATE, HUMAN-REVIEWED (DONE 2026-06-27 — addresses wired below):
//   • The goblin-cave LootPool is DEPLOYED + SEEDED (LOOT_POOL below). Record: mftusd-build/
//     goblin-lootpool-deployed.json. RICE + FLOUR ERC20s deployed (mftusd-build/rice-flour-deployed.json).
//   • The payout keeper (mftusd-build/goblin-payout-keeper.cjs) reads pendingClaims() and would call
//     payout() gaslessly on the agent key — DRY-run only until the founder opens the gate.
//
// no silent catches — bad JSON warns loudly and resets; unknown inputs throw.

import { rollEncounter, mulberry32 } from "../seas/battle-grid/area-encounters.js";
import { spawnMonsterGroup } from "../seas/battle-grid/monster-bridge.js";
import { hashSeed } from "../seas/battle-grid/resolver.js";
import caveMap from "../seas/battle-grid/maps/sea-cave.js"; // id "sea-cave", aliases ["cave","sea-caves"]

// ── storage (localStorage in browser; in-memory shim under Node for tests) ───────────────
const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  };
})();
const K_CD = "sts_goblincave_cd";       // { [pawnId]: { until, runId } }  — weekly per-pawn cooldown
const K_CLAIMS = "sts_goblincave_claims"; // [ claim … ]  — PENDING reward claims for the keeper to settle

function readJSON(key, fallback) {
  const raw = store.getItem(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch (e) { console.warn(`[goblin-cave] bad JSON in ${key}, resetting:`, e); return fallback; }
}
function writeJSON(key, val) { store.setItem(key, JSON.stringify(val)); }

// ── dials ────────────────────────────────────────────────────────────────────────────────
// Weekly per-pawn cooldown — the day-out dungeon cadence (vs the bilge arena's 1h). Fiction is HOURS;
// COOLDOWN_MS_PER_HOUR maps fiction hours → real wall-clock. Default = a real hour → 168h = 7 real days.
// QA can lower COOLDOWN_MS_PER_HOUR to shrink the wait without changing the 168h cadence.
export const COOLDOWN_HOURS = 168;            // 7 days
export const COOLDOWN_MS_PER_HOUR = 3_600_000; // real hour (set to 60_000 to dev-scale like dungeons.js)
const COOLDOWN_MS = COOLDOWN_HOURS * COOLDOWN_MS_PER_HOUR;

// GUARANTEED copper floor: 1% of the copper held in the cave's LootPool, in BPS (matches the on-chain
// dropBps for COPPER and the bilge "copper floor" convention). The floor is just one of the pool's tokens.
export const COPPER_FLOOR_BPS = 100; // 1% = 100 BPS
export const COPPER_COIN = "copper"; // the floor pays in copper (copper-water feeds the pool)

// The DEPLOYED goblin-cave LootPool (Base) the keeper pays from. payout(collection,tokenId) onlyAdmin pays
// floor(bal × bps/1e4) of EACH stocked token to ownerOf(tokenId). Record: goblin-lootpool-deployed.json.
export const LOOT_POOL = "0xf917d1660c72F2D48141a965c82CCBE8a2A175A6";
export const AREA_ID = "goblin-cave";
export const GROUP_ID = "cave_goblins_starter";
export const DANGER = 1; // the cave's danger tier (the AREAS entry; combat is the only row)
// The squad deck the goblin fight renders on (matches maps/sea-cave.js grid + game.js squad auto-select).
export const SQUAD_GRID = { cols: 16, rows: 9 };

// ITEM-LOOT candidates (the cave's "what drops besides coin" list). The cave's LootPool stocks these;
// which are LOOTABLE right now depends on the pool's recharge state (the keeper reports availability).
// Per the founder's loot spec (2026-06-27): RICE + FLOUR + PORK at 1% each (replaces the old ROPE/PLANK/
// TORCH/LANTERN placeholders). FLOUR = milled wheat (a NEW token — NOT the WHEAT produce token).
// Addresses VERIFIED on-chain 2026-06-27 (PORK existing; RICE/FLOUR newly deployed, see rice-flour-deployed.json).
export const LOOT_TABLE = [
  { symbol: "RICE",  label: "Sack of Rice",  token: "0x00e466Fb90C8eF2e7BA1AA662a7c79C595906041" },
  { symbol: "FLOUR", label: "Sack of Flour", token: "0x111c5a52C3e631bf43e2e44DB001F08d20a9Ee73" }, // milled wheat
  { symbol: "PORK",  label: "Salt Pork",     token: "0x676d5a1C8438A9955bbA636e496aebddA4c49a2D" },
];
const LOOT_SYMBOLS = LOOT_TABLE.map((t) => t.symbol);

// ── THE CAVE SITE (a day-out march EAST of the harbour) ───────────────────────────────────
// The cave is painted on the world map ~ONE HEX EAST of Port Royal (founder 2026-06-27: "there's a cave
// on the map about 1 HEX OUT (east) — that's where the goblin cave goes"). Port Royal is the harbour town
// at hex (8,3) → on-chain loc 8003 (q*1000+r). One hex EAST of (8,3) on the axial grid is (9,3) → loc 9003,
// a LAND headland hex reachable on foot (location.js travelOverland at 24h/hex, 3× sea). The cave is bored
// into that headland. areaId = the guaranteed-goblin area. FOUNDER: nudge to the painted art if needed, but
// keep it a LAND hex adjacent to port_royal (8,3) — DON'T collide with the shared OCEAN hex (8,4)=loc 8004.
export const CAVE = {
  id: "goblin-cave",
  name: "Goblin Cave",
  blurb: "A goblin warren bored into the headland a short march EAST of Port Royal. The pack is small but well-dug-in — a fitting day-out dungeon for a young crew.",
  hex: { q: 9, r: 3 },         // LAND headland hex, 1 EAST of port_royal (8,3) → loc 9003 (foot-reachable)
  port: "port_royal",          // the island/region this cave belongs to (location.js PORTS key)
  areaId: AREA_ID,             // area-encounters.js AREAS key → guaranteed cave_goblins_starter roll
  groupId: GROUP_ID,
  map: "cave",                 // battle-grid deck art id (resolves to maps/sea-cave.js)
  lootPool: LOOT_POOL,         // the deployed pool the keeper pays from on a verified win
  // reward wiring — both the copper floor and item loot pay from the SAME unified LootPool (bilge model):
  copperPoolId: LOOT_POOL,     // the copper floor is one token in the cave LootPool
  itemPoolId: LOOT_POOL,       // the item loot (rice/flour/pork + jackpots) is the same pool
};

// ── SEED → numeric roller ─────────────────────────────────────────────────────────────────
/** Map a (string OR number) fight seed → a SEEDED mulberry32 rng. Used on BOTH client + server so the
 *  goblin COMPOSITION (count + ids) is identical from the one seed (mirrors bilge-rats.bilgeRng). */
export function goblinRng(seed) { return mulberry32(hashSeed(seed)); }

// ── ENCOUNTER ROLL (reuses area-encounters.js — NO new combat) ──────────────────────────
/**
 * Roll the cave's goblin encounter (always the small goblin starter pack — the "goblin-cave" area has a
 * SINGLE combat row). DETERMINISTIC from `seed`. Returns the area-encounters PVE result (with a `group`
 * array + foe ids), the exact shape encounter.js armVoyageEncounterGroup() / units.js makeSquadBattle()
 * consume. Tags routeId so a return-trip can credit the reward.
 * @param {number|string} seed  the fight seed (server-issued for a real fight; any value in tests)
 * @returns {object} a PVE encounter { type:"pve", group:[…], objective:"wipe", map:"cave", … }
 */
export function rollCaveEncounter(seed) {
  const enc = rollEncounter(AREA_ID, DANGER, goblinRng(seed));
  if (!enc || enc.type !== "pve" || !Array.isArray(enc.group) || !enc.group.length)
    throw new Error("[goblin-cave] cave roll did not produce a goblin group (check area-encounters 'goblin-cave').");
  enc.routeId = CAVE.id;       // tag so the map can recognise a cave win on return
  return enc;
}

/**
 * Rebuild the EXACT goblin enemy squad from the seed alone — the SAME ids + hexes the client's
 * makeSquadBattle() produces (both go id:ref.id → stable rolled ids; both place via enemySpawnHexes on
 * the squad grid). This lets the seas-server reconstruct the foes for verify-fight WITHOUT trusting a
 * client enemy list. Pass the player unit hexes as `takenHexes` so spawn placement matches the client.
 * (The direct analogue of bilge-rats.buildBilgeEnemies.)
 * @param {number|string} seed
 * @param {{q:number,r:number}[]} [takenHexes]  player/occupied hexes to avoid (default: none)
 * @returns {object[]} engine-ready enemy BattleUnits (deterministic ids + positions)
 */
export function buildGoblinEnemies(seed, takenHexes = []) {
  const enc = rollCaveEncounter(seed);
  const taken = new Set(takenHexes.filter(Boolean).map((h) => `${h.q},${h.r}`));
  return spawnMonsterGroup(enc.group, taken, SQUAD_GRID);
}

/** The terrain cells for the cave deck (cover/chokepoint-wall/hazard) — passed to resolveEncounter so the
 *  server replays cover/LOS/hazard EXACTLY as the client deck rendered them (mirrors bilge-rats.bilgeTerrain). */
export function caveTerrain() { return caveMap.terrain.map((c) => ({ ...c })); }

// ── WEEKLY PER-PAWN COOLDOWN ────────────────────────────────────────────────────────────
// ⚠️ DISPLAY MIRROR ONLY (server migration 2026-06-27). The AUTHORITATIVE goblin-cave cooldown now
// lives SERVER-SIDE (seas-server.js startCooldown/cooldownLeft, action key "goblin-cave", 168h on the
// SERVER clock). The localStorage entry below is a UI MIRROR for instant display — it is NEVER the
// gate. issue-seed { fight:"goblin-cave", collection, tokenId } 429s a cooling pawn server-side, and
// verify-fight STARTS the cooldown on a conclusive run, so editing K_CD in localStorage can no longer
// buy a free run (the old localStorage-edit hole, now closed). Keep this mirror in sync from the
// server's /seas/cooldown?action=goblin-cave response when you can; treat the server's secsLeft as truth.
function allCd() { const j = readJSON(K_CD, {}); return j && typeof j === "object" ? j : {}; }

/** ms timestamp this pawn can next run the cave (0 = ready now). */
export function cooldownUntil(pawnId) {
  const e = allCd()[pawnId];
  return e ? Number(e.until) || 0 : 0;
}
/** Seconds left on this pawn's weekly cooldown (0 = ready). */
export function cooldownLeftSecs(pawnId, now = Date.now()) {
  return Math.max(0, Math.ceil((cooldownUntil(pawnId) - now) / 1000));
}
/** Can this pawn run the cave right now? { ok, reason, secsLeft }. */
export function canEnter(pawnId, now = Date.now()) {
  if (!pawnId) return { ok: false, reason: "no pawn", secsLeft: 0 };
  const left = cooldownLeftSecs(pawnId, now);
  if (left > 0) return { ok: false, reason: "cooldown", secsLeft: left };
  return { ok: true, reason: null, secsLeft: 0 };
}
/** Player-facing readiness label: "Ready" or "Ready in 6d 3h" (rounds up to the next hour). */
export function readyInLabel(pawnId, now = Date.now()) {
  const secs = cooldownLeftSecs(pawnId, now);
  if (secs <= 0) return "Ready";
  const totalH = Math.ceil(secs / 3600);
  const d = Math.floor(totalH / 24), h = totalH % 24;
  if (d > 0 && h > 0) return `Ready in ${d}d ${h}h`;
  if (d > 0) return `Ready in ${d}d`;
  return `Ready in ${h}h`;
}

/**
 * Start a cave RUN for a pawn: enforce the weekly cooldown, then STAMP it (the run consumes the weekly
 * slot win-or-lose, like bilge/dungeons — a re-entry is blocked for 7 days). Returns the run handle; the
 * caller then issues a server seed, builds the goblins from it, plays, and verifies the win.
 * @param {string} pawnId   the party leader's crewId (the pawn taking the field)
 * @returns {{ runId:string, cave:object, until:number }}
 */
export function enterCave(pawnId, now = Date.now()) {
  const can = canEnter(pawnId, now);
  if (!can.ok) throw new Error(`[goblin-cave] cannot enter: ${can.reason} (${can.secsLeft}s left)`);
  const until = now + COOLDOWN_MS;
  const runId = `gcave-p${pawnId}-t${now}`;
  const cd = allCd();
  cd[pawnId] = { until, runId };
  writeJSON(K_CD, cd);
  return { runId, cave: CAVE, until };
}

// ── CHRONO ORB — cooldown SKIP consumable ─────────────────────────────────────────────────
// ⚠️ SERVER-AUTHORITATIVE SKIP (migration 2026-06-27). The REAL orb-skip is now the seas-server endpoint
//   POST /seas/use-chrono-orb { player, collection, tokenId, action:"goblin-cave" }
// — the server verifies pawn ownership, holds the tamper-proof attributed orb balance (reconciled
// against the on-chain CHRONO ORB ERC20), DEBITs 1 orb, and clearCooldown()s the SERVER cooldown. That
// is the only skip that actually frees a server-gated run. Call it (citizen/lib/seas-api.useChronoOrb).
//
// The functions below are a GAME-LAYER DISPLAY MIRROR: they keep a local "sts_orbs" count + can clear the
// localStorage mirror for instant UI feedback, but they DO NOT free the server cooldown by themselves —
// after a successful /seas/use-chrono-orb call, mirror the result here so the UI updates immediately.
//
// Spend semantics are unchanged: the orb buys the WAIT ONLY — clearing the cooldown does NOT grant a win
// or any loot; the pawn still has to RUN the cave and WIN (server-verified). REAL-OR-NOTHING: a cooldown
// is NEVER cleared unless an orb is actually debited (debit-then-clear, mirroring boat-craft.craftBoat).
// CHRONO_ORB holds the live token address once deployed (null until then; the mirror works without it).
const K_ORBS = "sts_orbs"; // whole CHRONO ORB units the player holds (game-layer mirror of the on-chain bal)
// Live CHRONO ORB ERC20 address (Base) — null until deploy-chrono-orb.js --execute runs; wire it then.
// (Recorded in MfT-Launch/deploy/orb-deployed.json under orbs["chrono-orb"].address.)
export const CHRONO_ORB = null;

/** Read the player's whole CHRONO ORB balance (game-layer). 0 if none / no storage. */
export function getOrbs() {
  const v = Number(store.getItem(K_ORBS) || "0");
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}
/** Set the player's whole CHRONO ORB balance (game-layer). Whole-number, never negative. */
export function setOrbs(units) {
  store.setItem(K_ORBS, String(Math.max(0, Math.floor(Number(units) || 0))));
}

/** Does this pawn currently HAVE the option to skip with an orb? { ok, reason, secsLeft, orbs }.
 *  Only TRUE when the pawn IS on cooldown AND the player holds >=1 orb (the UI gate — does not mutate). */
export function canSkipCooldown(pawnId, now = Date.now()) {
  const orbs = getOrbs();
  if (!pawnId) return { ok: false, reason: "no pawn", secsLeft: 0, orbs };
  const left = cooldownLeftSecs(pawnId, now);
  if (left <= 0) return { ok: false, reason: "not on cooldown", secsLeft: 0, orbs };
  if (orbs < 1) return { ok: false, reason: "no orb", secsLeft: left, orbs };
  return { ok: true, reason: null, secsLeft: left, orbs };
}

/**
 * SPEND 1 CHRONO ORB to clear this pawn's weekly cooldown (game-layer settlement). Debit-then-clear:
 * the orb is debited FIRST, and ONLY if that succeeds is the pawn's `sts_goblincave_cd` entry removed —
 * so a cooldown is NEVER cleared without an orb actually being spent (real-or-nothing). Returns
 * { ok:true, … } on success or { ok:false, reason } if the pawn isn't on cooldown / holds no orb
 * (the caller shows the message — never silently no-ops).
 *
 * GUARDRAIL: this skips the WAIT only. It clears the cooldown so the pawn may ENTER again immediately;
 * it does NOT grant a win, record a claim, or pay any loot. The pawn still has to RUN the cave (enterCave
 * → play) and WIN (server-verified) to earn anything. No win/loot is ever bought.
 *
 * @param {string} pawnId   the party leader's crewId on cooldown
 * @returns {{ ok:true, pawnId:string, orbsLeft:number, clearedUntil:number } | { ok:false, reason:string }}
 */
export function spendChronoOrbToSkip(pawnId, now = Date.now()) {
  if (!pawnId) return { ok: false, reason: "no pawn" };
  const left = cooldownLeftSecs(pawnId, now);
  if (left <= 0) return { ok: false, reason: "not on cooldown" }; // nothing to skip — don't waste an orb
  const have = getOrbs();
  if (have < 1) return { ok: false, reason: "no orb" };

  // debit FIRST (real-or-nothing) — only clear the cooldown once the orb is actually spent.
  setOrbs(have - 1);
  const cd = allCd();
  const clearedUntil = cd[pawnId] ? Number(cd[pawnId].until) || 0 : 0;
  delete cd[pawnId];          // CLEAR this pawn's cooldown entry → canEnter() now returns ok
  writeJSON(K_CD, cd);
  return { ok: true, pawnId, orbsLeft: have - 1, clearedUntil };
}

// ── WIN → PENDING REWARD CLAIM (recorded, NOT paid — the keeper settles via LootPool.payout) ──

/**
 * Pick the BONUS item loot the game-layer INTENDS this win to drop: 1 whole of a RANDOM currently-
 * AVAILABLE item token, or null if nothing's recharged. `availableSymbols` is what the loot pool reports
 * as lootable RIGHT NOW (the keeper's truth); default = all candidates (optimistic — the keeper RE-
 * VALIDATES at settle, and the on-chain floor-to-whole is the final gate). rng is injectable/testable.
 * NOTE: this is advisory only — the actual on-chain payout pays 1% of EACH stocked token (the unified
 * LootPool model), so the keeper does NOT have to honour this single pick; it's the game-layer's
 * "what we expect dropped" record. Kept for parity with the old claim shape + UI hints.
 * @param {string[]} [availableSymbols]
 * @param {() => number} [rng]
 * @returns {{ symbol:string, label:string, token:string|null, amount:number } | null}
 */
export function rollItemLoot(availableSymbols = LOOT_SYMBOLS, rng = Math.random) {
  const avail = LOOT_TABLE.filter((t) => availableSymbols.includes(t.symbol));
  if (!avail.length) return null; // nothing recharged → no item drop this run (the "sometimes")
  const r = rng();
  if (typeof r !== "number" || Number.isNaN(r)) throw new Error("[goblin-cave] rng() must return a number in [0,1).");
  const pick = avail[Math.min(avail.length - 1, Math.floor((r <= 0 ? 0 : r >= 1 ? 0.999999 : r) * avail.length))];
  return { symbol: pick.symbol, label: pick.label, token: pick.token, amount: 1 }; // 1 WHOLE unit
}

function allClaims() { const j = readJSON(K_CLAIMS, []); return Array.isArray(j) ? j : []; }
/** All PENDING reward claims (the keeper reads these → LootPool.payout(collection, tokenId)). */
export function pendingClaims() { return allClaims().filter((c) => c && c.status === "pending"); }

/**
 * Record a PENDING, REAL reward claim for a SERVER-VERIFIED cave WIN. Settles NOTHING here (no fake
 * transfer) — it captures the (collection, tokenId) the keeper pays the LootPool to. On settle the pool
 * pays 1% of EACH coin/good (the COPPER floor + RICE + FLOUR + PORK) plus the 100%-floor weapon JACKPOTS
 * (long swords + crossbow) to ownerOf(tokenId), per-pawn cooldown-gated.
 *
 * HARDENED like bilge: REQUIRES a server-verified player win — never records a claim from a client-claimed
 * win (the seas-server replay must agree the player won BEFORE this is called).
 *
 * @param {string} pawnId   the party leader's crewId (the pawn that won)
 * @param {{ collection?:string, tokenId?:string|number, seed?:string, nonce?:string, runId?:string,
 *           verifiedWinner?:string, availableSymbols?:string[], rng?:()=>number, now?:number }} [opts]
 * @returns {object} the recorded pending claim
 */
export function completeCave(pawnId, opts = {}) {
  if (!pawnId) throw new Error("[goblin-cave] completeCave: missing pawnId");
  if (opts.verifiedWinner !== "player")
    throw new Error(`[goblin-cave] completeCave requires a SERVER-VERIFIED player win (got ${JSON.stringify(opts.verifiedWinner)}) — never record a claim from a client-claimed win.`);
  const now = opts.now ?? Date.now();
  const runId = opts.runId || (allCd()[pawnId] && allCd()[pawnId].runId) || `gcave-p${pawnId}-t${now}`;
  const itemLoot = rollItemLoot(opts.availableSymbols ?? LOOT_SYMBOLS, opts.rng ?? Math.random);
  const claim = {
    site: CAVE.id,
    pawnId,
    runId,
    status: "pending",                    // "pending" → keeper sets "settled" once payout() lands
    wonAt: now,
    lootPool: LOOT_POOL,
    // the keeper calls payout(collection, tokenId) — the NFT whose ownerOf receives the loot:
    collection: opts.collection || null,  // the pawn's NFT collection (founder/keeper resolves)
    tokenId: opts.tokenId ?? null,         // the pawn's tokenId
    // GUARANTEED floor — always present (one token in the unified pool):
    copperFloor: { coin: COPPER_COIN, bps: COPPER_FLOOR_BPS, poolId: CAVE.copperPoolId },
    // BONUS item loot the game-layer expects (advisory; the pool pays 1% of ALL goods on settle):
    itemLoot: itemLoot ? { ...itemLoot, poolId: CAVE.itemPoolId } : null,
    // provenance of the verified win (the seas-server replay that authorised this claim):
    seed: opts.seed || null,
    nonce: opts.nonce || null,
    verifiedWinner: "player",
  };
  const claims = allClaims();
  claims.push(claim);
  writeJSON(K_CLAIMS, claims);
  return claim;
}

/** Mark a recorded claim settled (the keeper calls this after payout() lands on-chain). */
export function markClaimSettled(runId, txNote = null) {
  const claims = allClaims();
  let hit = false;
  for (const c of claims) if (c && c.runId === runId && c.status === "pending") { c.status = "settled"; c.settledAt = Date.now(); if (txNote) c.txNote = txNote; hit = true; }
  if (hit) writeJSON(K_CLAIMS, claims);
  return hit;
}
