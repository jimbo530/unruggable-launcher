// @ts-check
// bilge-rats.js — THE FIRST REAL FIGHT: the in-town "Bilge Rats" Arena scrap (Port Royal). Game-layer
// + localStorage only (the economic twin of goblin-cave.js). NO new COMBAT — the fight runs through
// the HARDENED resolver (battle-grid/resolver.js resolveEncounter): deterministic from a server-issued
// seed, enemy AI re-computed server-side, replay-verified before any payout (project_seas_combat_settlement).
//
// THIS MODULE OWNS (everything else is reused):
//   1) THE ARENA SITE — an in-TOWN fight (no travel, unlike the day-out goblin cave). Its area id
//      ("bilge-rats") rolls a guaranteed winnable rat swarm (area-encounters.js single combat row).
//   2) PER-PAWN COOLDOWN — mirrors the deployed bilge LootPool's on-chain per-pawn cooldown (3600s)
//      so the game-layer gate and the contract agree (a pawn can win the loot once per cooldown).
//   3) DETERMINISTIC TEAMS — buildBilgeEnemies(seed, takenHexes) rebuilds the EXACT rat squad (ids +
//      hexes) from the seed alone, so the seas-server can RECONSTRUCT the foes for verify-fight
//      WITHOUT trusting a client-supplied enemy list (closes the "submit weak rats" hole).
//   4) WIN → PENDING CLAIM — on a SERVER-VERIFIED win we record a PENDING claim the keeper settles by
//      calling the LootPool's payout(collection, tokenId). NO fake payout here; we record WHAT is owed.
//
// SEPARATE, HUMAN-REVIEWED (do NOT build/deploy here):
//   • The bilge LootPool is DEPLOYED + SEEDED (0xE07CE9Ec…, COPPER @ 1%); food/gem stocking + the
//     water-routing self-funding are a per-item founder walkthrough (project_seas_prize_loot).
//   • The payout keeper (mftusd-build/bilge-payout-keeper.cjs) reads pendingClaims() and would call
//     payout() gaslessly on the agent key — DRY-run only until the founder opens the gate.
//
// no silent catches — bad JSON warns loudly and resets; unknown inputs throw.

import { rollEncounter, mulberry32 } from "../seas/battle-grid/area-encounters.js";
import { spawnMonsterGroup } from "../seas/battle-grid/monster-bridge.js";
import { hashSeed } from "../seas/battle-grid/resolver.js";
import bilgeMap from "../seas/battle-grid/maps/bilge.js";

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
const K_CD = "sts_bilge_cd";        // { [pawnId]: { until, runId } } — per-pawn cooldown
const K_CLAIMS = "sts_bilge_claims"; // [ claim … ] — PENDING reward claims for the keeper to settle

function readJSON(key, fallback) {
  const raw = store.getItem(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch (e) { console.warn(`[bilge-rats] bad JSON in ${key}, resetting:`, e); return fallback; }
}
function writeJSON(key, val) { store.setItem(key, JSON.stringify(val)); }

// ── dials ────────────────────────────────────────────────────────────────────────────────
// Cooldown MIRRORS the deployed LootPool's per-pawn cooldown (bilge-lootpool-deployed.json:
// cooldown 3600s = 1h). Keep the game-layer gate == the contract so the UI never offers a fight
// the chain will refuse to pay. QA can dev-scale COOLDOWN_MS_PER_SEC without changing the cadence.
export const COOLDOWN_SECS = 3600;            // 1 hour, == the on-chain per-pawn cooldown
export const COOLDOWN_MS_PER_SEC = 1000;      // real second (set lower to dev-scale)
const COOLDOWN_MS = COOLDOWN_SECS * COOLDOWN_MS_PER_SEC;

// The deployed bilge LootPool (Base) the keeper pays from. payout(collection,tokenId) onlyAdmin pays
// floor(bal × bps/1e4) of EACH stocked token to ownerOf(tokenId). See bilge-lootpool-deployed.json.
export const LOOT_POOL = "0xE07CE9Ec642d42C5c8A0068203068BAc6042bF57";
export const AREA_ID = "bilge-rats";
export const GROUP_ID = "bilge_rats_starter";
export const DANGER = 1;                       // the area's danger tier (single combat row)
// The squad deck the bilge fight renders on (matches maps/bilge.js grid + game.js squad auto-select).
export const SQUAD_GRID = { cols: 16, rows: 9 };

// ── THE ARENA SITE (in-town, no travel) ──────────────────────────────────────────────────
export const ARENA = {
  id: "bilge-rats",
  name: "Bilge Rats",
  blurb: "The Arena's flooded under-hold, in the heart of Port Royal. No voyage needed — your first REAL fight is a few steps away. A swarm of bilge rats boils up; clear them and the Rogue Network pays your cut.",
  port: "port_royal",
  areaId: AREA_ID,
  groupId: GROUP_ID,
  map: "bilge",
  lootPool: LOOT_POOL,            // the deployed pool the keeper pays from on a verified win
};

// ── SEED → numeric roller ─────────────────────────────────────────────────────────────────
/** Map a (string OR number) fight seed → a SEEDED mulberry32 rng. Used on BOTH client + server so
 *  the rat COMPOSITION (count + ids) is identical from the one seed. */
export function bilgeRng(seed) { return mulberry32(hashSeed(seed)); }

// ── ENCOUNTER ROLL (reuses area-encounters.js — NO new combat) ──────────────────────────
/**
 * Roll the bilge encounter (always the rat swarm — the "bilge-rats" area has a single combat row).
 * Deterministic from `seed`. Returns the area-encounters PVE result (with a `group` array + foe ids).
 * @param {number|string} seed  the fight seed (server-issued for a real fight; any value in tests)
 * @returns {object} a PVE encounter { type:"pve", group:[…], objective:"wipe", map:"bilge", … }
 */
export function rollBilgeEncounter(seed) {
  const enc = rollEncounter(AREA_ID, DANGER, bilgeRng(seed));
  if (!enc || enc.type !== "pve" || !Array.isArray(enc.group) || !enc.group.length)
    throw new Error("[bilge-rats] roll did not produce a rat group (check area-encounters 'bilge-rats').");
  enc.routeId = ARENA.id;        // tag so a win can be credited to this site
  return enc;
}

/**
 * Rebuild the EXACT rat enemy squad from the seed alone — the SAME ids + hexes the client's
 * makeSquadBattle() produces (both go id:ref.id → stable rolled ids; both place via enemySpawnHexes
 * on the squad grid). This lets the seas-server reconstruct the foes for verify-fight WITHOUT
 * trusting a client enemy list. Pass the player unit hexes as `takenHexes` so spawn placement
 * matches the client (which seeds `taken` with the player's hex).
 *
 * @param {number|string} seed
 * @param {{q:number,r:number}[]} [takenHexes]  player/occupied hexes to avoid (default: none)
 * @returns {object[]} engine-ready enemy BattleUnits (deterministic ids + positions)
 */
export function buildBilgeEnemies(seed, takenHexes = []) {
  const enc = rollBilgeEncounter(seed);
  const taken = new Set(takenHexes.filter(Boolean).map((h) => `${h.q},${h.r}`));
  return spawnMonsterGroup(enc.group, taken, SQUAD_GRID);
}

/** The terrain cells for the bilge deck (cover/hazard/wall) — passed to resolveEncounter so the
 *  server replays cover/LOS/hazard EXACTLY as the client deck rendered them. */
export function bilgeTerrain() { return bilgeMap.terrain.map((c) => ({ ...c })); }

// ── PER-PAWN COOLDOWN ──────────────────────────────────────────────────────────────────────
function allCd() { const j = readJSON(K_CD, {}); return j && typeof j === "object" ? j : {}; }

/** ms timestamp this pawn can next earn the loot (0 = ready now). */
export function cooldownUntil(pawnId) {
  const e = allCd()[pawnId];
  return e ? Number(e.until) || 0 : 0;
}
/** Seconds left on this pawn's cooldown (0 = ready). */
export function cooldownLeftSecs(pawnId, now = Date.now()) {
  return Math.max(0, Math.ceil((cooldownUntil(pawnId) - now) / 1000));
}
/** Can this pawn fight the bilge rats for loot right now? { ok, reason, secsLeft }. */
export function canEnter(pawnId, now = Date.now()) {
  if (!pawnId) return { ok: false, reason: "no pawn", secsLeft: 0 };
  const left = cooldownLeftSecs(pawnId, now);
  if (left > 0) return { ok: false, reason: "cooldown", secsLeft: left };
  return { ok: true, reason: null, secsLeft: 0 };
}
/** Player-facing readiness label. */
export function readyInLabel(pawnId, now = Date.now()) {
  const secs = cooldownLeftSecs(pawnId, now);
  if (secs <= 0) return "Ready";
  const m = Math.ceil(secs / 60);
  if (m >= 60) { const h = Math.floor(m / 60), mm = m % 60; return mm ? `Ready in ${h}h ${mm}m` : `Ready in ${h}h`; }
  return `Ready in ${m}m`;
}

/**
 * Start a bilge RUN for a pawn: enforce the per-pawn cooldown, then STAMP it (the run consumes the
 * slot win-or-lose, like goblin-cave/dungeons). Returns the run handle; the caller then arms the
 * fight (issue a server seed, build the rats from it, play, then verify the win).
 * @param {string} pawnId  the party leader's crewId (the pawn taking the field)
 * @returns {{ runId:string, arena:object, until:number }}
 */
export function enterBilge(pawnId, now = Date.now()) {
  const can = canEnter(pawnId, now);
  if (!can.ok) throw new Error(`[bilge-rats] cannot enter: ${can.reason} (${can.secsLeft}s left)`);
  const until = now + COOLDOWN_MS;
  const runId = `bilge-p${pawnId}-t${now}`;
  const cd = allCd();
  cd[pawnId] = { until, runId };
  writeJSON(K_CD, cd);
  return { runId, arena: ARENA, until };
}

// ── WIN → PENDING REWARD CLAIM (recorded, NOT paid — the keeper settles via LootPool.payout) ──
function allClaims() { const j = readJSON(K_CLAIMS, []); return Array.isArray(j) ? j : []; }
/** All PENDING reward claims (the keeper reads these → LootPool.payout(collection, tokenId)). */
export function pendingClaims() { return allClaims().filter((c) => c && c.status === "pending"); }

/**
 * Record a PENDING, REAL reward claim for a SERVER-VERIFIED bilge win. Settles NOTHING here — it
 * captures the (collection, tokenId) the keeper pays the LootPool to. The pool pays 1% of EACH
 * stocked token (copper now; foods/gems as stocked) to ownerOf(tokenId), per-pawn cooldown-gated.
 *
 * @param {string} pawnId   the party leader's crewId (the pawn that won)
 * @param {{ collection?:string, tokenId?:string|number, seed?:string, nonce?:string, runId?:string, verifiedWinner?:string, now?:number }} opts
 * @returns {object} the recorded pending claim
 */
export function completeBilge(pawnId, opts = {}) {
  if (!pawnId) throw new Error("[bilge-rats] completeBilge: missing pawnId");
  if (opts.verifiedWinner !== "player")
    throw new Error(`[bilge-rats] completeBilge requires a SERVER-VERIFIED player win (got ${JSON.stringify(opts.verifiedWinner)}) — never record a claim from a client-claimed win.`);
  const now = opts.now ?? Date.now();
  const runId = opts.runId || (allCd()[pawnId] && allCd()[pawnId].runId) || `bilge-p${pawnId}-t${now}`;
  const claim = {
    site: ARENA.id,
    pawnId,
    runId,
    status: "pending",                  // "pending" → keeper sets "settled" once payout() lands
    wonAt: now,
    lootPool: LOOT_POOL,
    // the keeper calls payout(collection, tokenId) — the NFT whose ownerOf receives the loot:
    collection: opts.collection || null,   // the pawn's NFT collection (founder/keeper resolves)
    tokenId: opts.tokenId ?? null,          // the pawn's tokenId
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
