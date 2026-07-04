// @ts-check
/**
 * combat-ext.js — WEAPON-DICE upgrade as an ADDITIVE wrapper. Keeps tot-engine.js VERBATIM
 * (resolveAttack reads attacker.stats.attack as FLAT damage; we never edit that port).
 *
 * HOW IT WORKS
 *   resolveAttackExt() is a drop-in replacement for resolveAttack() at game.js's two call
 *   sites (onHexClick attack branch + aiAct). If the attacker's equipped weapon declares a
 *   dice expression, we roll it for THIS swing and add it on top of the unit's base attack,
 *   then DELEGATE to the verbatim resolveAttack (so crit/miss/AC/buff math is unchanged).
 *   If the weapon has no dice, it falls through to plain resolveAttack — byte-for-byte the
 *   current behaviour. So enabling dice is a per-ITEM opt-in, never an engine change.
 *
 * WHICH WEAPONS ROLL DICE (opt-in, no double-count)
 *   A weapon rolls dice when ITEMS[weaponId] carries EITHER:
 *     • dmgDice: "1d8"          — an explicit dice expression (preferred), OR
 *     • diceRoll: true + dice:"longsword"  — a gear-ext WEAPON_DICE key resolved via
 *                                            weaponDamageExpr() (e.g. "longsword" → "1d8").
 *   IMPORTANT: a dice weapon should OMIT (or zero) its flat `mods.attack` so STR-base + die
 *   is counted ONCE. Today's armory + gear-ext weapons keep their flat `mods.attack` and set
 *   NEITHER opt-in flag, so resolveAttackExt is INERT for all current gear (the flat-damage
 *   smoke stays green). Founder enables a real pirate weapon by adding `dmgDice` (or the
 *   diceRoll flag) and dropping its flat `mods.attack` — a content toggle, not code.
 *
 * node --check clean. ESM. Imports the verbatim engine + the item table only.
 */

import { resolveAttack, rollDice } from "./tot-engine.js";
import { ITEMS } from "./items.js";
import { weaponDamageExpr } from "./gear-ext.js";

/** The dice expression an equipped weapon should roll, or null (→ flat-damage fallback). */
export function weaponDiceExpr(weaponId) {
  if (!weaponId) return null;
  const it = ITEMS[weaponId];
  if (!it) return null;
  if (it.dmgDice) return String(it.dmgDice);                 // explicit expr wins
  if (it.diceRoll && it.dice) return weaponDamageExpr(it.dice) || null; // gear-ext WEAPON_DICE key
  return null;
}

/**
 * resolveAttack + optional weapon-die roll. Identical to resolveAttack when the weapon has
 * no dice (the current path). When it does, rolls the die ONCE and adds it to the swing's
 * base attack before delegating, so the verbatim engine still owns hit/crit/AC/buff math.
 *
 * @param {object} attacker
 * @param {object} target
 * @param {number} natural   the d20 the caller already rolled (kept external for testability)
 * @param {number} [distance=1]
 * @param {() => number} [rng=Math.random]  DETERMINISM HOOK: seeded rng for the weapon-die roll
 *        (default Math.random → byte-for-byte unchanged for every existing caller). resolver.js
 *        passes a seeded rng so the same fight replays identically in browser + server.
 * @returns {ReturnType<typeof resolveAttack> & { diceBreakdown?: string }}
 */
export function resolveAttackExt(attacker, target, natural, distance = 1, rng = Math.random) {
  const wid = attacker && attacker.equipped && attacker.equipped.weapon;
  const expr = weaponDiceExpr(wid);
  if (!expr) return resolveAttack(attacker, target, natural, distance); // unchanged path

  const roll = rollDice(expr, 1, rng);
  // Layer the rolled damage onto a SHALLOW COPY so we never mutate the live unit's stats.
  const swing = { ...attacker, stats: { ...attacker.stats, attack: (attacker.stats.attack || 0) + roll.total } };
  const res = resolveAttack(swing, target, natural, distance);
  if (res && res.hit) res.diceBreakdown = `${expr}=${roll.total}`;
  return res;
}
