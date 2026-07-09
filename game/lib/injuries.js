// @ts-check
// game/lib/injuries.js — WOUNDS + BATTLE ENERGY (founder 2026-07-08: "injuries should
// not insta heal if after a battle… should take time to heal not as slow as IRL but not
// fast" + "have a battle energy limit, so will be resource management of time making
// demand for crono orbs yet to clear and carry a haul out").
//
// TWO METERS, both real-time clocks (game-layer, localStorage, the house pattern):
//
//   WOUNDS — a pawn leaves a fight carrying its HP DEFICIT. The deficit heals at
//   HEAL_HP_PER_HOUR real hours; a fight started while wounded starts AT the reduced HP
//   (the team builder subtracts currentDeficit). Potions/healers call healWound() to
//   close the gap instantly — that's what the cave merchant sells.
//
//   BATTLE ENERGY — each pawn holds an energy pool; every fight SPENDS 1. Energy
//   regenerates on a real clock. An empty pool = no fight until it ticks back (or a
//   chrono orb refills it — grantEnergy is the orb's seam). This is the cave's
//   resource-management crank: every battle burns time AND energy while node recharge
//   clocks tick — hauling a full clear out is a real logistics feat.
//
// DIALS below are launch-tunable; the SHAPE (real-time regen, spend-per-fight,
// deficit-carry) is the founder's design. Server-side enforcement rides the existing
// issue-seed path later (the server can check energy before issuing a fight seed);
// this ledger is the playable seam TODAY.
//
// no silent catches — bad JSON warns loudly and resets; bad amounts throw.

const K_WOUNDS = "seas:wounds";  // { [pawnId]: { deficit, updatedAt } }
const K_ENERGY = "seas:energy";  // { [pawnId]: { spent, updatedAt } }  (pool = MAX_ENERGY - spent + regen)

// ── dials ────────────────────────────────────────────────────────────────────────────
export const HEAL_HP_PER_HOUR = 2;      // wounds close 2 HP per real hour ("not IRL-slow, not fast")
export const MAX_ENERGY = 3;            // fights a rested pawn can take before resting
export const ENERGY_REGEN_HOURS = 4;    // one energy back per 4 real hours

const HOUR = 3600 * 1000;

const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  };
})();

function readJSON(key, fb) {
  const r = store.getItem(key);
  if (r == null) return fb;
  try { return JSON.parse(r); } catch (e) { console.warn("[injuries] bad JSON " + key + ": " + e.message + " — resetting"); store.removeItem(key); return fb; }
}
function writeJSON(key, v) { store.setItem(key, JSON.stringify(v)); }
function posInt(n, what) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) throw new Error("[injuries] bad " + what + ": " + n);
  return v;
}

// ── WOUNDS ───────────────────────────────────────────────────────────────────────────
/** The pawn's CURRENT hp deficit after real-time healing (0 = fully mended). */
export function currentDeficit(pawnId, now = Date.now()) {
  const all = readJSON(K_WOUNDS, {});
  const w = all[String(pawnId)];
  if (!w) return 0;
  const healed = ((now - w.updatedAt) / HOUR) * HEAL_HP_PER_HOUR;
  return Math.max(0, w.deficit - healed);
}

/** Record damage carried OUT of a fight (call at settle with maxHp - currentHp, min 0). */
export function recordBattleDamage(pawnId, hpLost, now = Date.now()) {
  const lost = posInt(hpLost, "hpLost");
  if (lost === 0) return currentDeficit(pawnId, now);
  const all = readJSON(K_WOUNDS, {});
  const cur = currentDeficit(pawnId, now);
  all[String(pawnId)] = { deficit: cur + lost, updatedAt: now };
  writeJSON(K_WOUNDS, all);
  return cur + lost;
}

/** Close `hp` of the wound instantly (potion / healer / temple). Returns the new deficit. */
export function healWound(pawnId, hp, now = Date.now()) {
  const amt = posInt(hp, "heal hp");
  const all = readJSON(K_WOUNDS, {});
  const cur = currentDeficit(pawnId, now);
  const next = Math.max(0, cur - amt);
  if (next === 0) delete all[String(pawnId)];
  else all[String(pawnId)] = { deficit: next, updatedAt: now };
  writeJSON(K_WOUNDS, all);
  return next;
}

/** Hours until fully mended at the natural rate (0 = mended). */
export function hoursToMend(pawnId, now = Date.now()) {
  return currentDeficit(pawnId, now) / HEAL_HP_PER_HOUR;
}

// ── BATTLE ENERGY ────────────────────────────────────────────────────────────────────
/** Current energy (0..MAX_ENERGY) after real-time regen. */
export function energyOf(pawnId, now = Date.now()) {
  const all = readJSON(K_ENERGY, {});
  const e = all[String(pawnId)];
  if (!e) return MAX_ENERGY;
  const regen = (now - e.updatedAt) / (ENERGY_REGEN_HOURS * HOUR);
  return Math.min(MAX_ENERGY, Math.max(0, MAX_ENERGY - e.spent + regen));
}

/** Spend 1 energy to enter a fight. THROWS when the pool is empty — the caller shows
 *  "rest or crack a chrono orb"; it never silently lets the fight happen. */
export function spendEnergy(pawnId, now = Date.now()) {
  const cur = energyOf(pawnId, now);
  if (cur < 1) throw new Error("[injuries] " + pawnId + " is exhausted — no battle energy (rest or use a chrono orb)");
  const all = readJSON(K_ENERGY, {});
  all[String(pawnId)] = { spent: MAX_ENERGY - (cur - 1), updatedAt: now };
  writeJSON(K_ENERGY, all);
  return cur - 1;
}

/** Refill energy (CHRONO ORB seam — the orb burn calls this after the on-chain spend). */
export function grantEnergy(pawnId, amount = MAX_ENERGY, now = Date.now()) {
  const amt = posInt(amount, "energy grant");
  const cur = energyOf(pawnId, now);
  const next = Math.min(MAX_ENERGY, cur + amt);
  const all = readJSON(K_ENERGY, {});
  all[String(pawnId)] = { spent: MAX_ENERGY - next, updatedAt: now };
  writeJSON(K_ENERGY, all);
  return next;
}

/** Hours until the next whole point of energy ticks back (0 = full or ticking now). */
export function hoursToNextEnergy(pawnId, now = Date.now()) {
  const cur = energyOf(pawnId, now);
  if (cur >= MAX_ENERGY) return 0;
  const frac = cur - Math.floor(cur);
  return (1 - frac) * ENERGY_REGEN_HOURS;
}
