// @ts-check
/**
 * effects.js — SHARED AoE SHAPES + CONDITIONS (one truth for game.js AND resolver.js).
 *
 * WHY ONE MODULE: the security model is "client plays, server replays" — every rule that
 * consumes rng or changes unit state MUST be byte-identical on both sides. So the shape
 * membership tests and the condition dice live HERE, and both engines call them at the
 * SAME points in the turn (splash right after the primary hit, in units-array order;
 * condition ticks right after the activeEffects filter at turn start; on-hit riders right
 * after a landed strike). Change this file → deploy client + server TOGETHER.
 *
 * AoE SHAPES (spell.battle):
 *   hexArea:  n                      → RADIUS: hexes within n of the STRUCK hex (existing rule)
 *   hexShape: "cone", hexLength: n   → CONE from the CASTER through the struck hex: a hex h
 *                                      is in the cone iff dC(h) ≤ n AND d(h, struck) ≤ dC(h) − 1
 *                                      (a widening wedge anchored on the aim direction — pure
 *                                      hex-metric, no trig, deterministic).
 *   hexShape: "line", hexLength: n   → LINE through caster→struck extended to n: h is on the
 *                                      corridor iff dC(h) ≤ n AND h is metric-colinear with the
 *                                      aim (triangle equality in hex distance). Hex geodesics
 *                                      aren't unique, so the corridor can be 1-2 hexes thick in
 *                                      some directions — reads as a crackling bolt, not a wire.
 *   Friendly fire is SPARED (existing squad-play rule): only the caster's foes are struck.
 *
 * CONDITIONS (unit.conditions = [{ id, rounds, ... }]):
 *   poison { dmg, save:"con", dc } — save-ends each turn start; on a failed save takes dmg.
 *   burn   { dmg }                — takes dmg each turn start for `rounds` (no save; short).
 *   stun   {}                     — loses move + action for `rounds` (daze's missing wiring).
 *   Ticks return EVENTS — the caller applies damage through ITS OWN applyDamage (downed /
 *   mortality bookkeeping stays engine-side). No silent catches; unknown condition ids THROW.
 *
 * ON-HIT RIDERS: a monster def may carry `applies` ({ id, save, dc, rounds, dmg, name }) —
 *   e.g. spider venom. tryApplyOnHit rolls the target's save; a fail attaches the condition.
 */

import { hexDistance, rollD20, abilityMod } from "./tot-engine.js";

// ── tiny dice ("1d3", "1d4+1", or a plain number) — rng-driven, deterministic ─────────
function rollDice(expr, rng) {
  if (typeof expr === "number") return Math.max(0, Math.floor(expr));
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(String(expr).trim());
  if (!m) throw new Error(`effects: bad dice expression "${expr}"`);
  const n = +m[1], d = +m[2], mod = m[3] ? +m[3] : 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += 1 + Math.floor(rng() * d);
  return Math.max(0, sum + mod);
}

// ── AoE shape membership ───────────────────────────────────────────────────────────────
function inShape(spell, casterPos, struckPos, hex) {
  const b = spell.battle || {};
  const dC = hexDistance(casterPos, hex);
  if (b.hexShape === "cone") {
    const L = b.hexLength ?? 2;
    if (dC < 1 || dC > L) return false;
    return hexDistance(hex, struckPos) <= dC - 1;
  }
  if (b.hexShape === "line") {
    const L = b.hexLength ?? 4;
    if (dC < 1 || dC > L) return false;
    const dS = hexDistance(casterPos, struckPos);
    const hS = hexDistance(hex, struckPos);
    // metric-colinear: on the caster→struck segment, or beyond struck on the same ray
    return (dS === dC + hS) || (dC === dS + hS);
  }
  const area = b.hexArea;
  if (area && area > 0) return hexDistance(struckPos, hex) <= area;
  return false;
}

/**
 * The spell's SECONDARY victims: the caster's other foes caught in the shape, in
 * units-array order (rng-consumption parity depends on this order — do not sort).
 * @param {any} spell  a SPELLS entry { battle:{ hexArea? | hexShape?, hexLength? } }
 * @param {any} caster
 * @param {any} struck  the primary target (already resolved — never re-hit here)
 * @param {any[]} units the full board array
 * @param {(u:any)=>boolean} isAliveFn
 */
export function aoeSecondaryTargets(spell, caster, struck, units, isAliveFn) {
  const b = spell.battle || {};
  if (!b.hexArea && !b.hexShape) return [];
  const out = [];
  for (const u of units) {
    if (!isAliveFn(u) || u === struck || u.isPlayer === caster.isPlayer) continue;
    if (inShape(spell, caster.position, struck.position, u.position)) out.push(u);
  }
  return out;
}

// ── conditions ─────────────────────────────────────────────────────────────────────────
const KNOWN_CONDITIONS = ["poison", "burn", "stun"];

/** Attach a condition (stacking refreshes duration rather than duplicating the id). */
export function applyCondition(unit, cond) {
  if (!cond || !KNOWN_CONDITIONS.includes(cond.id)) throw new Error(`effects: unknown condition "${cond && cond.id}"`);
  unit.conditions = unit.conditions || [];
  const existing = unit.conditions.find((c) => c.id === cond.id);
  if (existing) existing.rounds = Math.max(existing.rounds, cond.rounds ?? 1);
  else unit.conditions.push({ rounds: 1, ...cond });
  return unit.conditions;
}

/** A save roll: d20 + abilityMod(raw ability) vs dc. Consumes ONE rng draw. */
export function rollSave(unit, ability, dc, rng) {
  const nat = rollD20(rng);
  const mod = abilityMod((unit && unit.rawAbilities && unit.rawAbilities[ability]) || 0);
  return { saved: nat + mod >= dc, nat, mod, total: nat + mod, dc };
}

/**
 * Turn-start condition tick. Call at the SAME point in both engines: right after the
 * activeEffects duration filter, before the unit plans/acts. Returns events — the caller
 * applies `damage` through its own applyDamage and honors `skip` (stunned: no move/action).
 * rng draws (in order): per poison, one save d20 (+ dmg dice on a fail); per burn, dmg dice.
 */
export function tickConditions(unit, rng) {
  const events = [];
  let skip = false;
  if (!unit.conditions || !unit.conditions.length) return { events, skip };
  const keep = [];
  for (const c of unit.conditions) {
    if (c.id === "poison") {
      const save = rollSave(unit, c.save === "dex" ? "dex" : "con", c.dc ?? 12, rng);
      if (save.saved) {
        events.push({ kind: "condition-end", id: c.id, text: `${unit.name} fights off the ${c.name || "poison"} (save ${save.total} vs DC ${save.dc}).` });
        continue; // save ends it
      }
      const dmg = rollDice(c.dmg ?? "1d3", rng);
      events.push({ kind: "condition-dot", id: c.id, damage: dmg, text: `${unit.name} suffers ${dmg} from ${c.name || "poison"} (save ${save.total} vs DC ${save.dc}).` });
    } else if (c.id === "burn") {
      const dmg = rollDice(c.dmg ?? "1d4", rng);
      events.push({ kind: "condition-dot", id: c.id, damage: dmg, text: `${unit.name} burns for ${dmg}.` });
    } else if (c.id === "stun") {
      skip = true;
      events.push({ kind: "condition-skip", id: c.id, text: `${unit.name} is stunned — no move, no action.` });
    }
    c.rounds -= 1;
    if (c.rounds > 0) keep.push(c);
    else events.push({ kind: "condition-end", id: c.id, text: `${unit.name} shakes off ${c.name || c.id}.` });
  }
  unit.conditions = keep;
  return { events, skip };
}

/**
 * On-hit rider (spider venom & kin): if the attacker's def carries `applies`, the target
 * saves or gains the condition. Call ONLY after a LANDED strike, in both engines.
 * Consumes ONE rng draw when the attacker has a rider, zero otherwise.
 */
export function tryApplyOnHit(attacker, target, rng) {
  const a = attacker && attacker.applies;
  if (!a) return null;
  const save = rollSave(target, a.save === "dex" ? "dex" : "con", a.dc ?? 12, rng);
  if (save.saved) {
    return { applied: false, save, text: `${target.name} resists ${attacker.name}'s ${a.name || a.id} (save ${save.total} vs DC ${save.dc}).` };
  }
  applyCondition(target, { id: a.id, rounds: a.rounds ?? 3, dmg: a.dmg, save: a.save, dc: a.dc, name: a.name });
  return { applied: true, save, text: `${target.name} is afflicted by ${attacker.name}'s ${a.name || a.id}!` };
}

/**
 * CONTROL spells (daze — "skip target's next action"): the verbatim engine has no control
 * branch, so the save + stun attach live here. Consumes ONE rng draw. Returns the outcome
 * for logging; on a failed save the stun condition is attached (ticked at turn start).
 */
export function resolveControl(caster, target, spell, rng) {
  const b = spell.battle || {};
  if (b.type !== "control") return null;
  const dc = 10 + (spell.level ?? 0) + ((caster && caster.castingAbilityMod) || 0);
  const save = rollSave(target, b.save === "ref" ? "dex" : "wis", dc, rng);
  if (!save.saved) applyCondition(target, { id: "stun", rounds: b.durationRounds ?? 1, name: spell.name });
  return { stunned: !save.saved, save, text: save.saved
    ? `${target.name} shakes off ${spell.name} (save ${save.total} vs DC ${dc}).`
    : `${target.name} is stunned by ${spell.name} (save ${save.total} vs DC ${dc})!` };
}
