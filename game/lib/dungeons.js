// @ts-check
// dungeons.js — Seize the Seas DUNGEONS: templates + per-pawn grind/cooldown state + the
// JOB-YIELD REROUTE rule. Game-layer, localStorage only (the spatial/economic twin of
// location.js + coins). NO chain here — the on-chain payout is the PrizePool contract; this
// module decides WHO ran WHAT, WHEN they can run again, and WHERE a grinder's job stream feeds.
//
// THE LOOP (founder 2026-06-25):
//   • A dungeon is a short multi-ROOM run (each room = one battle). Clearing it lets the pawns
//     claim 1% of the dungeon's on-chain PRIZE POOL (gold/silver/copper) — see PrizePool.sol.
//   • Each dungeon has a per-(pawn,dungeon) COOLDOWN before the SAME pawn can re-run it.
//   • While a pawn is on a dungeon's cooldown, its JOB yield stream reroutes 100% into THAT
//     dungeon's pool (forfeit job income to grind for gold) — the self-funding "feed". The
//     keeper reads jobRerouteTarget(pawnId) to know where to send that pawn's harvested yield.
//   • Emergent: high-endowment pawns forfeit a bigger stream, so grinding a low dungeon's thin
//     pool isn't worth it → they move on to richer dungeons. The economy gates itself.
//
// Cooldown is enforced game-side (the backend signer won't sign a completion for a pawn still
// cooling down) — so only cooldown-respecting clears ever reach an on-chain payout.

// ── storage (localStorage in browser; in-memory shim under Node for tests) ───────────────
const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
})();
const K_CD = "sts_dungeon_cd"; // { [pawnId]: { [dungeonId]: { until, poolId, runId } } }

function readJSON(key, fallback) {
  const raw = store.getItem(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch (e) { console.warn(`[dungeons] bad JSON in ${key}, resetting:`, e); return fallback; }
}
function writeJSON(key, val) { store.setItem(key, JSON.stringify(val)); }

// ── dials ────────────────────────────────────────────────────────────────────────────────
// Fiction: cooldowns are in HOURS. Real wall-clock is scaled down for dev (like location.js
// MS_PER_HEX) so testing isn't an 8-hour wait. Raise toward 3_600_000 to make hours real.
export const COOLDOWN_MS_PER_HOUR = 60_000; // dev: 1 "hour" = 60s (a tier-3 8h dungeon = 8 min)

// Reward coins a pool pays, by tier (the pool is fed in these coins via the reroute).
const TIER_COINS = { 1: ["copper", "silver"], 2: ["silver", "gold"], 3: ["gold"] };

// ── dungeon templates ───────────────────────────────────────────────────────────────────
// Each: id, name, port (location.js port id), tier(1-3), cooldownHours, poolId (PrizePool id),
// blurb, rooms[] — each room an enemy snapshot shaped EXACTLY like a PVE/PVP opponent
// (location.js ENEMY_POOL / battle-grid pvp.html): { slug, name, endowment:{cause:usd},
// loadout:{weapon,armor,trinket} } using REAL armory ids + cause keys, so the battle-grid
// fights a dungeon room with zero translation.
const DUNGEON_DEFS = [
  { id: 1, name: "Harbor Cellars", port: "port_royal", tier: 1, cooldownHours: 4, blurb: "Rats and cutpurses in the bonded warehouses under Port Royal.",
    rooms: [
      { slug: "cellar-rat", name: "Cellar Rat Pack", endowment: { burgers: 6 }, loadout: { weapon: "dagger-wooden", armor: "armor", trinket: null } },
      { slug: "wharf-cutpurse", name: "Wharf Cutpurse", endowment: { egp: 8 }, loadout: { weapon: "dagger-iron", armor: "armor-studded", trinket: null } },
    ] },
  { id: 2, name: "Tortuga Bilge", port: "tortuga_cove", tier: 1, cooldownHours: 4, blurb: "A scuttled hull turned smugglers' den in the shallows.",
    rooms: [
      { slug: "bilge-thug", name: "Bilge Thug", endowment: { burgers: 9 }, loadout: { weapon: "club-iron", armor: "armor-studded", trinket: null } },
      { slug: "smuggler-boss", name: "Smuggler Boss", endowment: { burgers: 8, egp: 4 }, loadout: { weapon: "shortsword-iron", armor: "armor-chain-shirt", trinket: "lantern" } },
    ] },
  { id: 3, name: "Saltmarsh Sunkenhold", port: "saltmarsh", tier: 2, cooldownHours: 6, blurb: "A drowned keep; brine-logged guardians still hold the vault.",
    rooms: [
      { slug: "brine-guard", name: "Brine Guard", endowment: { burgers: 16 }, loadout: { weapon: "scimitar-iron", armor: "armor-chain-shirt", trinket: null } },
      { slug: "tide-conjurer", name: "Tide Conjurer", endowment: { pump: 14, char: 4 }, loadout: { weapon: "dagger-iron", armor: "armor", trinket: "lantern" } },
      { slug: "sunken-castellan", name: "Sunken Castellan", endowment: { burgers: 20, egp: 4 }, loadout: { weapon: "longsword-bronze", armor: "armor-chainmail", trinket: "relic" } },
    ] },
  { id: 4, name: "Bonewater Crypt", port: "bonewater_atoll", tier: 2, cooldownHours: 6, blurb: "Coral-choked ossuary on the atoll; the dead don't share.",
    rooms: [
      { slug: "reef-wight", name: "Reef Wight", endowment: { pump: 16 }, loadout: { weapon: "battleaxe-iron", armor: "armor-chainmail", trinket: null } },
      { slug: "bone-piper", name: "Bone Piper", endowment: { pump: 14, ccc: 4 }, loadout: { weapon: "dagger-bronze", armor: "armor", trinket: "lantern" } },
      { slug: "crypt-warden", name: "Crypt Warden", endowment: { bluechip: 18 }, loadout: { weapon: "warhammer-bronze", armor: "armor-breastplate", trinket: "relic" } },
    ] },
  { id: 5, name: "Kraken Trench", port: "kraken_deep", tier: 3, cooldownHours: 8, blurb: "The Maw's black trench — only the well-armed come back up.",
    rooms: [
      { slug: "trench-reaver", name: "Trench Reaver", endowment: { burgers: 28 }, loadout: { weapon: "greataxe-steel", armor: "armor-chainmail", trinket: "relic" } },
      { slug: "leviathan-caller", name: "Leviathan-Caller", endowment: { pump: 22, ccc: 6 }, loadout: { weapon: "warhammer-steel", armor: "armor-breastplate", trinket: "relic" } },
      { slug: "kraken-corsair", name: "Kraken Corsair", endowment: { bluechip: 26 }, loadout: { weapon: "longsword-steel", armor: "armor-chainmail", trinket: "spyglass" } },
    ] },
  { id: 6, name: "Skull Reef Vault", port: "skull_reef", tier: 3, cooldownHours: 8, blurb: "The Black Reach's ruin-vault — the deepest pool, the meanest guards.",
    rooms: [
      { slug: "reach-reaver", name: "Black Reach Reaver", endowment: { burgers: 30 }, loadout: { weapon: "greatsword-steel", armor: "armor-chainmail", trinket: "relic" } },
      { slug: "reef-sorcerer", name: "Reef Sorcerer", endowment: { pump: 26, char: 6 }, loadout: { weapon: "dagger-steel", armor: "armor", trinket: "relic" } },
      { slug: "vault-tyrant", name: "Vault Tyrant", endowment: { bluechip: 30 }, loadout: { weapon: "maul-steel", armor: "armor-breastplate", trinket: "spyglass" } },
    ] },
];

export const DUNGEONS = (() => { const o = {}; for (const d of DUNGEON_DEFS) o[d.id] = { ...d, poolId: d.id, rewardCoins: TIER_COINS[d.tier] }; return o; })();
export function listDungeons() { return Object.values(DUNGEONS); }
export function getDungeon(id) { return DUNGEONS[id] || null; }

// ── per-pawn cooldown state ─────────────────────────────────────────────────────────────
function allCd() { const j = readJSON(K_CD, {}); return j && typeof j === "object" ? j : {}; }

/** ms timestamp this pawn can next run this dungeon (0 = ready now). */
export function cooldownUntil(pawnId, dungeonId) {
  const e = allCd()[pawnId] && allCd()[pawnId][dungeonId];
  return e ? Number(e.until) || 0 : 0;
}
/** Seconds left on this pawn's cooldown for this dungeon (0 = ready). */
export function cooldownLeftSecs(pawnId, dungeonId, now = Date.now()) {
  return Math.max(0, Math.ceil((cooldownUntil(pawnId, dungeonId) - now) / 1000));
}
/** Can this pawn run this dungeon right now? */
export function canRun(pawnId, dungeonId, now = Date.now()) {
  if (!DUNGEONS[dungeonId]) return { ok: false, reason: "unknown dungeon", secsLeft: 0 };
  const left = cooldownLeftSecs(pawnId, dungeonId, now);
  if (left > 0) return { ok: false, reason: "cooldown", secsLeft: left };
  return { ok: true, reason: null, secsLeft: 0 };
}

/**
 * Start a dungeon run: stamps the cooldown + the reroute window for this pawn. Returns the
 * run (the dungeon + its rooms to fight + a unique runId). Does NOT touch chain.
 * @returns {{dungeon:object, rooms:object[], runId:string}}
 */
export function startRun(pawnId, dungeonId, now = Date.now()) {
  const d = DUNGEONS[dungeonId];
  if (!d) throw new Error(`[dungeons] unknown dungeon ${dungeonId}`);
  const can = canRun(pawnId, dungeonId, now);
  if (!can.ok) throw new Error(`[dungeons] cannot run: ${can.reason} (${can.secsLeft}s)`);
  const until = now + d.cooldownHours * COOLDOWN_MS_PER_HOUR;
  const runId = `d${dungeonId}-p${pawnId}-t${now}`;
  const cd = allCd();
  cd[pawnId] = cd[pawnId] || {};
  cd[pawnId][dungeonId] = { until, poolId: d.poolId, runId };
  writeJSON(K_CD, cd);
  return { dungeon: d, rooms: d.rooms.map((r) => ({ ...r })), runId };
}

/**
 * The pool a pawn's JOB yield should feed RIGHT NOW (the active grind = the dungeon whose
 * cooldown is still running, latest first), or null if the pawn isn't grinding. The keeper
 * reads this to reroute that pawn's harvested coin into PrizePool.fund(poolId, coin, amount).
 * @returns {{dungeonId:number, poolId:number, until:number}|null}
 */
export function jobRerouteTarget(pawnId, now = Date.now()) {
  const byD = allCd()[pawnId];
  if (!byD) return null;
  let best = null;
  for (const dId of Object.keys(byD)) {
    const e = byD[dId];
    if (Number(e.until) > now && (!best || e.until > best.until))
      best = { dungeonId: Number(dId), poolId: Number(e.poolId), until: Number(e.until) };
  }
  return best;
}
/** Is this pawn currently grinding (job stream rerouted)? */
export function isGrinding(pawnId, now = Date.now()) { return jobRerouteTarget(pawnId, now) != null; }

/**
 * Finish a cleared run → a CLAIM INTENT for the backend signer to authorize against PrizePool.
 * (The backend verifies the clear, signs claim(completionId, poolId, winner, coins, expiry).)
 * @returns {{poolId:number, dungeonId:number, pawnId:string, winner:string, runId:string, coins:string[]}}
 */
export function finishRun(pawnId, dungeonId, winnerAddress) {
  const d = DUNGEONS[dungeonId];
  if (!d) throw new Error(`[dungeons] unknown dungeon ${dungeonId}`);
  const e = (allCd()[pawnId] || {})[dungeonId];
  const runId = e ? e.runId : `d${dungeonId}-p${pawnId}-t${Date.now()}`;
  return { poolId: d.poolId, dungeonId, pawnId, winner: winnerAddress || null, runId, coins: d.rewardCoins };
}
