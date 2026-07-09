// @ts-check
// jobs-loop.js — the LABOR MARKET loop for Seize the Seas: apply for work → fill a BUNK → work a
// SHIFT (time-lock) → collect COIN wage + STAT XP. Game-layer (localStorage), reads settlements.js
// (jobs / bunk caps / training rates). Mirrors location.js voyages + dungeons.js: a shift is a pure
// client-side time-lock, polled on collect — no daemon. Single-player VIEW (your pawns); GLOBAL bunk
// competition across all players is a server/chain layer later (occupancy here counts your own pawns).
//
// XP RULE (founder, corrected): a job's water "just adds to a stat" DIRECTLY — internal XP, NOT the
// funded charity cause-tokens. Gain = XP_PER_SHIFT × statRate(settlement). statRate is the wild-low /
// town-high lever (camp/mill 1× · town 3× · city/capital 5×) → towns train pawns faster.

import { getJob, getSettlement, bunkCap, statRate } from "./settlements.js";
import { feed, FOOD_MORALE } from "./upkeep.js";
import { record as journalRecord } from "./journal.js";
import { skillForJob, addSkillXp } from "./skills.js";

// ── storage (localStorage in browser; in-memory shim under Node) ─────────────────────────
const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
})();
const K_ASSIGN  = "sts_jobs";    // { [pawnId]: { settlementId, jobId, startedAt, shiftUntil, autoFeed } }
const K_XP      = "sts_pawn_xp"; // { [pawnId]: { STR,DEX,CON,INT,WIS,CHA } }  trained-stat XP
const K_WAGES   = "sts_wages";   // { [pawnId]: { copper, silver, gold } }  earned (pending on-chain payout)
const K_PRODUCE = "sts_produce"; // { [pawnId]: { fish, crab, grapes, wheat, logs, lumber, … } }  gathered goods

function readJSON(key, fb) { const r = store.getItem(key); if (r == null) return fb; try { return JSON.parse(r); } catch (e) { console.warn(`[jobs] bad JSON ${key}:`, e); return fb; } }
function writeJSON(key, v) { store.setItem(key, JSON.stringify(v)); }

// ── dials ────────────────────────────────────────────────────────────────────────────────
export const SHIFT_MS = 5000;         // dev-scaled shift length (raise toward 8*3600*1000 for real hrs)
export const XP_PER_SHIFT = 1;        // base stat points per shift, before statRate
export const PRODUCE_PER_SHIFT = 1;   // units of the job's `produces` good yielded per shift
// base coin wage per shift, by job kind (the on-chain coin mint wires in later via the WaterV2 vault)
const WAGE = { dock: { coin: "silver", amt: 5 }, production: { coin: "copper", amt: 10 }, prize: { coin: "copper", amt: 2 }, government: { coin: "gold", amt: 10 } };

// ── assignment / occupancy ────────────────────────────────────────────────────────────────
function allAssign() { const j = readJSON(K_ASSIGN, {}); return j && typeof j === "object" ? j : {}; }
export function assignmentOf(pawnId) { return allAssign()[pawnId] || null; }
/** Pawns (yours) currently assigned to (settlement, job). Global count needs the server/chain. */
export function occupancy(settlementId, jobId) {
  const a = allAssign(); let n = 0;
  for (const p in a) if (a[p].settlementId === settlementId && a[p].jobId === jobId) n++;
  return n;
}
/** Open bunks at (settlement, job): cap − occupancy (Infinity for unlimited/prize jobs). */
export function openBunks(settlementId, jobId) {
  const cap = bunkCap(settlementId, jobId);
  return cap === Infinity ? Infinity : Math.max(0, cap - occupancy(settlementId, jobId));
}

/**
 * Apply a pawn to an open bunk and start its first shift.
 * @param {{autoFeed?: boolean}} [opts] autoFeed: route a FOOD produce (fish/crab/…) into the crew's
 *   belly each shift instead of inventory — the "flow choice for the duration" (founder 2026-06-26).
 */
export function applyForWork(pawnId, settlementId, jobId, now = Date.now(), opts = {}) {
  if (!getSettlement(settlementId)) return { ok: false, reason: "unknown settlement" };
  if (!getJob(jobId)) return { ok: false, reason: "unknown job" };
  if (bunkCap(settlementId, jobId) <= 0) return { ok: false, reason: "job not offered here" };
  if (assignmentOf(pawnId)) return { ok: false, reason: "already working (leave first)" };
  if (openBunks(settlementId, jobId) <= 0) return { ok: false, reason: "no open bunks — look elsewhere" };
  const a = allAssign();
  a[pawnId] = { settlementId, jobId, startedAt: now, shiftUntil: now + SHIFT_MS, autoFeed: !!opts.autoFeed };
  writeJSON(K_ASSIGN, a);
  // journal: one line per HIRE (not per shift — it's a memoir, not a timesheet)
  const jj = getJob(jobId), ss = getSettlement(settlementId);
  journalRecord(pawnId, "job", { job: (jj && jj.name) || jobId, place: (ss && ss.name) || settlementId }, now);
  return { ok: true, reason: null, shiftUntil: a[pawnId].shiftUntil };
}

/** Set the yield→ration flow route for the duration (founder: "just route flow choice for the duration"). */
export function setFeedRoute(pawnId, on) {
  const a = allAssign(); if (!a[pawnId]) return false;
  a[pawnId].autoFeed = !!on; writeJSON(K_ASSIGN, a); return true;
}

/** Seconds left on the current shift (0 = ready to collect). */
export function shiftLeftSecs(pawnId, now = Date.now()) {
  const a = assignmentOf(pawnId); if (!a) return 0;
  return Math.max(0, Math.ceil((a.shiftUntil - now) / 1000));
}

/**
 * Collect a finished shift → grant STAT XP (the job's stat × the settlement's training rate) + a
 * COIN wage, then auto-start the next shift (the pawn keeps working until you leaveWork). No-op if
 * the shift isn't done yet. @returns {{ok, stat, xp, coin, wage}|{ok:false,reason}}
 */
export function collectShift(pawnId, now = Date.now()) {
  const a = assignmentOf(pawnId); if (!a) return { ok: false, reason: "not working" };
  if (now < a.shiftUntil) return { ok: false, reason: "shift not done", secsLeft: shiftLeftSecs(pawnId, now) };
  const job = getJob(a.jobId);
  // STAT XP — the job's stat × the settlement training rate (wild-low / town-high)
  const stat = job.stat, gain = XP_PER_SHIFT * statRate(a.settlementId);
  const xp = readJSON(K_XP, {}); xp[pawnId] = xp[pawnId] || {};
  xp[pawnId][stat] = (xp[pawnId][stat] || 0) + gain; writeJSON(K_XP, xp);
  // SKILL XP — if the job declares a CRAFT (skills.js JOB_SKILL map), ALSO accrue that skill's water at
  // the same rate as the stat XP. Unskilled/copper labor returns null here → stat-only (founder doctrine).
  const skill = skillForJob(job);
  if (skill) addSkillXp(pawnId, skill, gain);
  // COIN wage
  const w = WAGE[job.kind] || WAGE.dock;
  const wages = readJSON(K_WAGES, {}); wages[pawnId] = wages[pawnId] || {};
  wages[pawnId][w.coin] = (wages[pawnId][w.coin] || 0) + w.amt; writeJSON(K_WAGES, wages);
  // PRODUCE yield (fishing→fish, milling→lumber, vinekeeping→grapes, …). FLOW ROUTE: if autoFeed is on
  // AND the produce is a FOOD, route the catch into the crew's belly (morale) for the duration; else
  // bank it as gated in-game supply (inventory → on-chain grant later). NO silent drop.
  let produce = null, fed = false;
  if (job.produces) {
    produce = { good: job.produces, qty: PRODUCE_PER_SHIFT };
    if (a.autoFeed && FOOD_MORALE[job.produces] !== undefined) {
      feed(pawnId, job.produces, now); fed = true;           // route yield → ration (auto-provision)
    } else {
      const inv = readJSON(K_PRODUCE, {}); inv[pawnId] = inv[pawnId] || {};
      inv[pawnId][job.produces] = (inv[pawnId][job.produces] || 0) + PRODUCE_PER_SHIFT; writeJSON(K_PRODUCE, inv);
    }
  }
  // start the next shift
  a.startedAt = now; a.shiftUntil = now + SHIFT_MS;
  const all = allAssign(); all[pawnId] = a; writeJSON(K_ASSIGN, all);
  return { ok: true, stat, xp: gain, coin: w.coin, wage: w.amt, produce, fed, skill: skill || null, skillXp: skill ? gain : 0 };
}

/** Quit the current job, freeing the bunk for someone else. */
export function leaveWork(pawnId) { const a = allAssign(); if (a[pawnId]) { delete a[pawnId]; writeJSON(K_ASSIGN, a); return true; } return false; }

/** Every pawn currently holding a job assignment — i.e. a WORKING pawn. Drives the daily encounter
 *  sweep (encounters.js: each working pawn rolls a d20 per in-game day). */
export function workingPawns() { return Object.keys(allAssign()); }

/**
 * ONE day's TAKE for a working pawn: the coin wage + produce its current job yields per cycle.
 * Mirrors collectShift's WAGE + PRODUCE_PER_SHIFT so there's ONE source of truth for "what a day of
 * this job pays" — used by the encounter nat-20 DOUBLE-take airdrop. @returns null if not working.
 */
export function dayTake(pawnId) {
  const a = assignmentOf(pawnId); if (!a) return null;
  const job = getJob(a.jobId); if (!job) return null;
  const w = WAGE[job.kind] || WAGE.dock;
  return { coin: w.coin, wage: w.amt, produce: job.produces ? { good: job.produces, qty: PRODUCE_PER_SHIFT } : null };
}

/**
 * Credit a TAKE (e.g. the nat-20 DOUBLE-take airdrop bonus) into a pawn's earned wages + produce.
 * A windfall is BANKED to inventory (never auto-fed — collectShift owns the autoFeed flow route).
 * THROWS on a malformed take (no silent failure). @returns true.
 */
export function creditTake(pawnId, take) {
  if (!take || typeof take !== "object") throw new Error("creditTake: a take object is required");
  if (take.coin && take.wage) {
    const wages = readJSON(K_WAGES, {}); wages[pawnId] = wages[pawnId] || {};
    wages[pawnId][take.coin] = (wages[pawnId][take.coin] || 0) + take.wage; writeJSON(K_WAGES, wages);
  }
  if (take.produce && take.produce.good) {
    const inv = readJSON(K_PRODUCE, {}); inv[pawnId] = inv[pawnId] || {};
    inv[pawnId][take.produce.good] = (inv[pawnId][take.produce.good] || 0) + take.produce.qty; writeJSON(K_PRODUCE, inv);
  }
  return true;
}

/** A pawn's accumulated trained-stat XP → { STR, DEX, ... }. */
export function trainedStats(pawnId) { return readJSON(K_XP, {})[pawnId] || {}; }
/** A pawn's earned (un-cashed) coin wages → { copper, silver, gold }. */
export function wages(pawnId) { return readJSON(K_WAGES, {})[pawnId] || {}; }
/** A pawn's gathered produce → { fish, crab, grapes, lumber, … } (gated supply, pending on-chain grant). */
export function produceInv(pawnId) { return readJSON(K_PRODUCE, {})[pawnId] || {}; }
/** Is this pawn's yield→ration route on? */
export function feedRoute(pawnId) { return !!assignmentOf(pawnId)?.autoFeed; }
