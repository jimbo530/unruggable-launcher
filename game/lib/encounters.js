// @ts-check
// encounters.js — the DAILY ENCOUNTER layer for "Seize the Seas" (founder 2026-06-26). Each in-game
// DAY, every WORKING pawn (one holding a jobs-loop assignment) rolls a d20:
//
//   • 1–2  → a FIGHT triggers. A pawn on the BEACH / crabbing job draws a GIANT CRAB; other working
//            pawns draw a context foe (fishing → a circling shark; else a bilge-deck scrap). The
//            player is PINGED and has a 12-HOUR window (dev-scaled on upkeep.DAY_MS) to come PLAY it.
//            If they don't engage in time, the fight AUTO-RESOLVES (pawn stats + morale vs the foe).
//   • 20   → AIRDROP: the pawn earns DOUBLE that day's take (2× its job yield) — the +100% bonus is
//            credited via jobs-loop.creditTake.
//   • 3–19 → a normal working day (nothing special).
//
// THIN BY DESIGN — this is the ENCOUNTER layer ONLY. It does NOT reimplement combat: the playable
// fight hands a GIANT-CRAB encounter (SEA_BESTIARY id "giant_crab") to the EXISTING battle-grid
// (monster-bridge / game.js spawn the foe), and the auto-resolve simulation drives the EXISTING
// tot-engine combat (resolveAttack + the verbatim d20 math) on the EXISTING makeMonster() unit shape.
//
// Game-layer only: localStorage (in-memory shim under Node), injectable now+rng like jobs-loop.js /
// forage.js. NO chain, NO network, NO silent catches. Mirrors the lib module house style.

import { DAY_MS, morale, moralePerk } from "./upkeep.js";
import { assignmentOf, workingPawns, dayTake, creditTake, trainedStats } from "./jobs-loop.js";
import { resolveAttack, abilityMod } from "../seas/battle-grid/tot-engine.js";
import { SEA_BESTIARY, makeMonster } from "../seas/battle-grid/bestiary-sea.js";

// ── dials ────────────────────────────────────────────────────────────────────────────────
export const FIGHT_ROLL_MAX = 2;             // d20 1..2 → a fight triggers
export const DOUBLE_ROLL    = 20;            // d20 20 → double-take airdrop
export const FIGHT_WINDOW_MS = DAY_MS / 2;   // 12 HOURS to come play (DAY_MS = 24h dev-scaled)
const MAX_SIM_ROUNDS = 50;                   // auto-resolve safety cap (decide by HP if hit)
// untrained-pawn combat floor (the engine BattleUnit band: ~10–20 HP, AC ~10–12, dmg 4–9, hit +2..+5)
const BASE_PAWN_HP = 10, BASE_PAWN_DMG = 3, BASE_PAWN_ATK = 2, BASE_PAWN_AC = 10;

// ── storage (localStorage in browser; in-memory shim under Node) ─────────────────────────
const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
})();
const K_ROLLS  = "sts_enc_rolls";  // { [pawnId]: { day, result } }      one roll per in-game day
const K_FIGHTS = "sts_enc_fights"; // { [fightId]: <fight record> }
const K_PINGS  = "sts_enc_pings";  // [ <ping> ]  player notification queue

function readJSON(key, fb) { const r = store.getItem(key); if (r == null) return fb; try { return JSON.parse(r); } catch (e) { console.warn(`[encounters] bad JSON ${key}:`, e); return fb; } }
function writeJSON(key, v) { store.setItem(key, JSON.stringify(v)); }

const allRolls  = () => { const r = readJSON(K_ROLLS, {});  return r && typeof r === "object" ? r : {}; };
const allFights = () => { const f = readJSON(K_FIGHTS, {}); return f && typeof f === "object" ? f : {}; };
const allPings  = () => { const p = readJSON(K_PINGS, []);  return Array.isArray(p) ? p : []; };

// ── helpers ──────────────────────────────────────────────────────────────────────────────
/** The in-game DAY index for a timestamp (dev-scaled DAY_MS). One d20 roll per pawn per day index. */
export function dayIndex(now = Date.now()) { return Math.floor(now / DAY_MS); }

/** Roll a d20 (1..20) off an injectable rng. THROWS (never silent) on a bad rng. */
function rollD20(rng) {
  const v = rng();
  if (typeof v !== "number" || Number.isNaN(v)) throw new Error("encounters: rng() must return a number in [0,1).");
  const clamped = v <= 0 ? 0 : v >= 1 ? 0.999999 : v;
  return 1 + Math.floor(clamped * 20);
}

/** Which foe a working pawn meets on a fight roll. Beach/crabbing → GIANT CRAB; else a context foe. */
function foeForAssignment(a) {
  if (a && a.jobId === "crabbing") return { monsterId: "giant_crab", monsterKey: "Giant Crab", name: "Giant Crab", scene: "beach" };
  if (a && a.jobId === "fishing")  return { monsterId: "shark",      monsterKey: "Shark",      name: "Circling Shark", scene: "ocean" };
  return { monsterId: "bilge_rat", monsterKey: "Bilge Rat", name: "Bilge Rat", scene: "deck" };   // generic working-day scrap
}

let _pingSeq = 0;
function pushPing(kind, pawnId, fightId, title, body, now) {
  const pings = allPings();
  pings.push({ id: `ping_${now}_${++_pingSeq}`, kind, pawnId, fightId, title, body, at: now, read: false });
  writeJSON(K_PINGS, pings);
}

// ── THE DAILY ROLL ───────────────────────────────────────────────────────────────────────
/**
 * Roll the day's d20 for ONE working pawn. Idempotent per in-game day (a second call the same day
 * returns the cached result with repeat:true). THROWS if the pawn isn't working — never silent.
 *
 * @param {string} pawnId
 * @param {{now?: number, rng?: () => number}} [opts]  rng injectable for tests (default Math.random)
 * @returns {{ok:true, result:"fight"|"double"|"normal", roll:number, day:number, pawnId:string,
 *            repeat?:boolean, fightId?:string, foe?:object, take?:object}}
 */
export function dailyRoll(pawnId, opts = {}) {
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? Math.random;
  const a = assignmentOf(pawnId);
  if (!a) throw new Error(`encounters.dailyRoll: ${pawnId} is not working (no job assignment) — only working pawns roll.`);

  const day = dayIndex(now);
  const rolls = allRolls();
  const prior = rolls[pawnId];
  if (prior && prior.day === day) return { ...prior.result, repeat: true };   // already rolled today

  const roll = rollD20(rng);
  let out;
  if (roll <= FIGHT_ROLL_MAX) {
    // ── FIGHT: open a pending fight + ping the player (12h window) ──
    const foe = foeForAssignment(a);
    const fightId = `fight_${pawnId}_${day}_${now}`;
    const fights = allFights();
    fights[fightId] = {
      fightId, pawnId, day,
      monsterId: foe.monsterId, monsterKey: foe.monsterKey, monsterName: foe.name, scene: foe.scene,
      jobId: a.jobId, settlementId: a.settlementId,
      createdAt: now, windowMs: FIGHT_WINDOW_MS, expiresAt: now + FIGHT_WINDOW_MS,
      status: "pending", engagedAt: null, resolvedAt: null, outcome: null,
    };
    writeJSON(K_FIGHTS, fights);
    pushPing("fight", pawnId, fightId,
      `${foe.name} attacks!`,
      `${pawnId} ran into a ${foe.name} on the ${foe.scene}. Come fight within ${Math.round(FIGHT_WINDOW_MS / 1000)}s or it auto-resolves.`, now);
    out = { ok: true, result: "fight", roll, day, pawnId, fightId, foe };
  } else if (roll >= DOUBLE_ROLL) {
    // ── DOUBLE-TAKE AIRDROP: credit +100% of the day's take (so the day pays 2×) ──
    const take = dayTake(pawnId);
    if (take) creditTake(pawnId, take);
    pushPing("airdrop", pawnId, null,
      "Lucky haul — double take!",
      `${pawnId} rolled a natural 20: double pay today (+${take ? take.wage + " " + take.coin : "0"}${take && take.produce ? `, +${take.produce.qty} ${take.produce.good}` : ""}).`, now);
    out = { ok: true, result: "double", roll, day, pawnId, take };
  } else {
    out = { ok: true, result: "normal", roll, day, pawnId };
  }

  rolls[pawnId] = { day, result: out };
  writeJSON(K_ROLLS, rolls);
  return out;
}

/**
 * Roll the daily d20 for EVERY working pawn (the once-a-day sweep). Skips pawns already rolled today.
 * @param {{now?: number, rng?: () => number, pawnIds?: string[]}} [opts]
 * @returns {{day:number, rolled:object[], fights:string[], doubles:string[]}}
 */
export function sweepDailyRolls(opts = {}) {
  const now = opts.now ?? Date.now();
  const ids = opts.pawnIds || workingPawns();
  const day = dayIndex(now);
  const rolled = [], fights = [], doubles = [];
  for (const pid of ids) {
    const r = dailyRoll(pid, { now, rng: opts.rng });
    if (r.repeat) continue;
    rolled.push(r);
    if (r.result === "fight") fights.push(r.fightId);
    if (r.result === "double") doubles.push(pid);
  }
  return { day, rolled, fights, doubles };
}

// ── PENDING-FIGHT QUERIES (UI) ─────────────────────────────────────────────────────────────
/** A fight record by id (null if unknown). */
export function fightById(fightId) { return allFights()[fightId] || null; }

/** Seconds left on a fight's 12h window (0 = lapsed). 0 also if already resolved. */
export function fightTimeLeftSecs(fightId, now = Date.now()) {
  const f = allFights()[fightId];
  if (!f || f.status !== "pending") return 0;
  return Math.max(0, Math.ceil((f.expiresAt - now) / 1000));
}

/** All fights still awaiting the player (status pending), each with secsLeft + a lapsed flag. */
export function pendingFights(now = Date.now()) {
  const f = allFights();
  return Object.values(f)
    .filter((x) => x.status === "pending")
    .map((x) => ({ ...x, secsLeft: Math.max(0, Math.ceil((x.expiresAt - now) / 1000)), lapsed: now >= x.expiresAt }));
}

// ── PINGS (notification queue) ──────────────────────────────────────────────────────────────
/** The player ping queue. @param {{unreadOnly?: boolean}} [opts] */
export function pings(opts = {}) {
  const list = allPings();
  return opts.unreadOnly ? list.filter((p) => !p.read) : list.slice();
}
/** Mark one ping read. @returns true if found. */
export function markPingRead(pingId) {
  const list = allPings(); let hit = false;
  for (const p of list) if (p.id === pingId) { p.read = true; hit = true; }
  if (hit) writeJSON(K_PINGS, list);
  return hit;
}
/** Drop all read pings (housekeeping). @returns count removed. */
export function clearReadPings() {
  const list = allPings(); const kept = list.filter((p) => !p.read);
  writeJSON(K_PINGS, kept); return list.length - kept.length;
}

// ── PLAYABLE FIGHT (hand off to the EXISTING battle-grid) ────────────────────────────────────
/**
 * Engage a pending fight by hand: marks it ENGAGED (so it won't auto-resolve while the player is in
 * it) and returns a battle-grid-ready PVE encounter descriptor — the SAME shape area-encounters.js
 * emits, so monster-bridge.spawnMonsterGroup() / game.js build the GIANT CRAB with the existing
 * engine. Call resolvePlayerFight() when the existing combat reports win/lose. THROWS on a bad/closed id.
 *
 * @param {string} fightId
 * @param {number} [now]
 * @returns {{type:"pve", fightId:string, pawnId:string, areaId:string, map:string, objective:"wipe",
 *            groupName:string, group:object[], enemy:object}}
 */
export function startPlayableFight(fightId, now = Date.now()) {
  const fights = allFights();
  const f = fights[fightId];
  if (!f) throw new Error(`encounters.startPlayableFight: unknown fight "${fightId}".`);
  if (f.status !== "pending") throw new Error(`encounters.startPlayableFight: fight "${fightId}" is ${f.status}, not pending.`);
  f.status = "engaged"; f.engagedAt = now; writeJSON(K_FIGHTS, fights);

  const enemy = {
    id: `pve-${f.monsterId}-${f.fightId}`,
    name: f.monsterName,
    build: "monster",
    monsterId: f.monsterId,   // SEA_BESTIARY id (monster-bridge resolves it)
    bestiary: "sea",
    role: "boss",
    lead: true,
  };
  return {
    type: "pve",
    fightId: f.fightId, pawnId: f.pawnId,
    areaId: f.scene === "beach" ? "coastal-shallows" : "open-sea",
    map: f.scene === "beach" ? "shoals" : "open-deck",
    objective: "wipe",
    groupName: f.monsterName,
    group: [enemy],
    enemy,
  };
}

/**
 * Record the result of a PLAYED fight (the existing combat engine reports win/lose).
 * @param {string} fightId
 * @param {{won: boolean}} outcome
 * @param {number} [now]
 * @returns {{ok:true, status:"won"|"lost"}}
 */
export function resolvePlayerFight(fightId, outcome, now = Date.now()) {
  const fights = allFights();
  const f = fights[fightId];
  if (!f) throw new Error(`encounters.resolvePlayerFight: unknown fight "${fightId}".`);
  if (f.status === "won" || f.status === "lost" || f.status === "auto-won" || f.status === "auto-lost")
    throw new Error(`encounters.resolvePlayerFight: fight "${fightId}" already resolved (${f.status}).`);
  if (!outcome || typeof outcome.won !== "boolean") throw new Error("encounters.resolvePlayerFight: outcome.won (boolean) required.");
  const status = outcome.won ? "won" : "lost";
  f.status = status; f.resolvedAt = now; f.outcome = { won: outcome.won, mode: "played" };
  writeJSON(K_FIGHTS, fights);
  pushPing("result", f.pawnId, fightId,
    outcome.won ? `${f.pawnId} won the fight` : `${f.pawnId} was beaten`,
    `${f.monsterName} ${outcome.won ? "defeated" : "got the better of " + f.pawnId}.`, now);
  return { ok: true, status };
}

// ── AUTO-RESOLVE (drive the EXISTING tot-engine combat) ──────────────────────────────────────
/**
 * Build the pawn's BattleUnit (the shape tot-engine.resolveAttack reads) from its trained-stat XP +
 * live morale perk. Untrained pawns sit on the combat floor; trained + high-morale pawns scale up
 * (D&D-style mods via the engine's abilityMod, capped to keep numbers in the deck band).
 */
function pawnBattleUnit(pawnId, now) {
  const t = trainedStats(pawnId) || {};
  const m = morale(pawnId, now);
  const perk = moralePerk(m);
  const cap = (mod) => Math.min(8, mod);                 // keep a grinder's mod in-band
  const strMod = cap(abilityMod(t.STR || 0));
  const dexMod = cap(abilityMod(t.DEX || 0));
  const conMod = cap(abilityMod(t.CON || 0));
  const maxHp = BASE_PAWN_HP + conMod * 2;               // CON pads HP
  return {
    id: `pawn_${pawnId}`, name: pawnId, isPlayer: true,
    stats: {
      attack: BASE_PAWN_DMG + strMod,                    // flat damage (resolveAttack reads this)
      atkBonus: BASE_PAWN_ATK + strMod + perk.combatBonus, // to-hit (+ morale combat edge)
      ac: BASE_PAWN_AC + dexMod,
    },
    currentHp: maxHp, maxHp, activeEffects: [],
    morale: m, moraleTier: perk.tier,
  };
}

/**
 * Simulate pawn vs foe on the EXISTING engine: alternate resolveAttack() swings (pawn first) until
 * one side drops to <=0 HP, or the round cap (then HP-fraction decides). Deterministic under a
 * seeded rng. Returns the outcome + a short log. THROWS if the foe template is unknown.
 *
 * @param {string} pawnId
 * @param {string} monsterKey  a SEA_BESTIARY key (e.g. "Giant Crab")
 * @param {{now?: number, rng?: () => number}} [opts]
 * @returns {{won:boolean, rounds:number, pawnHp:number, foeHp:number, log:string[]}}
 */
export function simulateFight(pawnId, monsterKey, opts = {}) {
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? Math.random;
  const tpl = SEA_BESTIARY[monsterKey];
  if (!tpl) throw new Error(`encounters.simulateFight: unknown foe "${monsterKey}" (sea bestiary).`);
  const pawn = pawnBattleUnit(pawnId, now);
  const foe = makeMonster(tpl, { q: 0, r: 0 });          // EXISTING maker → full engine BattleUnit
  const log = [];
  let rounds = 0;
  while (rounds < MAX_SIM_ROUNDS) {
    rounds++;
    // pawn swings (engine d20 supplied externally for determinism)
    const pa = resolveAttack(pawn, foe, rollD20(rng));
    if (pa.hit) foe.currentHp -= pa.damage;
    log.push(`R${rounds} ${pawn.name}: ${pa.breakdown}`);
    if (foe.currentHp <= 0) break;
    // foe swings back
    const fa = resolveAttack(foe, pawn, rollD20(rng));
    if (fa.hit) pawn.currentHp -= fa.damage;
    log.push(`R${rounds} ${foe.name}: ${fa.breakdown}`);
    if (pawn.currentHp <= 0) break;
  }
  const won = foe.currentHp <= 0
    ? true
    : pawn.currentHp <= 0
      ? false
      : pawn.currentHp / pawn.maxHp >= foe.currentHp / foe.maxHp;   // round-cap tiebreak by HP fraction
  return { won, rounds, pawnHp: pawn.currentHp, foeHp: foe.currentHp, log };
}

/**
 * Auto-resolve ONE pending (lapsed) fight via the simulation. Sets status auto-won / auto-lost and
 * pings the player with the outcome. No reward/penalty is applied beyond recording the outcome
 * (founder did not define fight loot/penalties). THROWS on a bad/closed id.
 *
 * @param {string} fightId
 * @param {{now?: number, rng?: () => number}} [opts]
 * @returns {{ok:true, status:"auto-won"|"auto-lost", sim:object}}
 */
export function autoResolveFight(fightId, opts = {}) {
  const now = opts.now ?? Date.now();
  const fights = allFights();
  const f = fights[fightId];
  if (!f) throw new Error(`encounters.autoResolveFight: unknown fight "${fightId}".`);
  if (f.status !== "pending") throw new Error(`encounters.autoResolveFight: fight "${fightId}" is ${f.status}, not pending.`);
  const sim = simulateFight(f.pawnId, f.monsterKey, { now, rng: opts.rng });
  const status = sim.won ? "auto-won" : "auto-lost";
  f.status = status; f.resolvedAt = now; f.outcome = { won: sim.won, mode: "auto", rounds: sim.rounds, pawnHp: sim.pawnHp, foeHp: sim.foeHp };
  writeJSON(K_FIGHTS, fights);
  pushPing("auto-resolved", f.pawnId, fightId,
    sim.won ? `${f.pawnId} fought off the ${f.monsterName}` : `${f.pawnId} lost to the ${f.monsterName}`,
    `You didn't make it in time — the fight auto-resolved after ${sim.rounds} rounds (${sim.won ? "win" : "loss"}).`, now);
  return { ok: true, status, sim };
}

/**
 * Sweep every PENDING fight whose 12h window has LAPSED and auto-resolve it. Call this on a timer /
 * on game load. Fights the player is actively ENGAGED in are left alone (status "engaged").
 * @param {{now?: number, rng?: () => number}} [opts]
 * @returns {{resolved: Array<{fightId:string, status:string}>}}
 */
export function resolveExpiredFights(opts = {}) {
  const now = opts.now ?? Date.now();
  const fights = allFights();
  const resolved = [];
  for (const id in fights) {
    const f = fights[id];
    if (f.status === "pending" && now >= f.expiresAt) {
      const r = autoResolveFight(id, { now, rng: opts.rng });
      resolved.push({ fightId: id, status: r.status });
    }
  }
  return { resolved };
}
