// @ts-check
/**
 * balance.js — P0: the SINGLE SOURCE OF TRUTH for combat balance.
 *
 * Three exports, read by three callers (per COMBAT-PLAN.md):
 *   • GEAR_CAPS    — the ceiling on what GEAR may add over a unit's un-geared base stats.
 *                    Read by items.js clampGearContribution() (the cap clamp).
 *   • BRACKET_MULT — a per-weight-bracket power multiplier (feather .8 → god 1.1).
 *                    Read by threat() and the enemy budget.
 *   • threat()     — a single combat-power scalar (offense × effective-HP × bracket mult).
 *                    Read by the focus-fire SIM and the enemy-budget builder.
 *
 * PURE + SIDE-EFFECT FREE: no DOM, no localStorage, no engine import. Safe in browser AND
 * node (items.js, the sim, and the enemy budget all import it). ADDITIVE — it changes no
 * existing file's behaviour on its own; the clamp + sim wire it in.
 *
 * SCALE NOTE: the combat math is the VERBATIM Tales-of-Tasern d20 (tot-engine.js
 * resolveAttack): d20 + atkBonus vs AC, nat 20 = crit (×2 dmg) + auto-hit, nat 1 = auto-miss,
 * damage = the attacker's `attack` stat. threat()'s hit/EHP estimates mirror exactly that
 * rule so the sim's caps line up with the live engine.
 */

// ── GEAR_CAPS ────────────────────────────────────────────────────────────────────
// The MOST a unit's equipped gear (flat mods AND ability-score-derived bumps) may RAISE
// each combat field over its un-geared base. Penalties (negative gear) pass through; this
// is an UPPER bound only. `maxHp: "base"` is dynamic — gear may add at most +baseMaxHp
// (so HP can never more than double). abilityDelta/netDerived bound ability-score gear:
// no single item may swing a score past −4..+6, and the NET derived-stat bump that ability
// gear produces is held to +netDerived (the per-field caps below enforce the rest).
export const GEAR_CAPS = {
  toHit: 4,        // +to-hit (atkBonus) from gear
  attack: 6,       // +physical damage (attack stat) from gear
  ac: 8,           // +armor class from gear
  maxHp: "base",   // +HP from gear ≤ the unit's own baseMaxHp (never more than 2× HP)
  move: 3,         // +movement hexes from gear
  range: 3,        // +attack range (hexes) from gear
  castingMod: 4,   // +spell power (castingAbilityMod) from gear
  cover: 4,        // +cover AC from terrain/positioning (reserved for the fairness layer, P6)
  abilityDelta: { min: -4, max: 6 }, // a single ability-score item's legal swing
  netDerived: 4,   // net derived-stat bump ability gear may produce
};

// ── BRACKET_MULT ───────────────────────────────────────────────────────────────────
// Power multiplier per weight bracket (units.js view.bracket.id: feather…god, plus the
// "unranked" floor). Monotonic ramp feather .8 → god 1.1, with `middle` = 1.0 as the
// neutral reference the "×1.0 enemy budget" is measured against.
export const BRACKET_MULT = {
  unranked: 0.80,
  feather: 0.80,
  light: 0.90,
  middle: 1.00,
  heavy: 1.05,
  god: 1.10,
};

/** Resolve a bracket id/label (or a raw number) to its multiplier; unknown → 1.0. */
export function bracketMult(bracket) {
  if (typeof bracket === "number" && isFinite(bracket)) return bracket;
  const k = String(bracket || "").toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(BRACKET_MULT, k) ? BRACKET_MULT[k] : 1.0;
}

// ── threat() — combat-power scalar ───────────────────────────────────────────────────
// Reference yardsticks: threat() needs a stand-in opponent to estimate hit% and incoming
// damage. These are neutral mid-line values; only RATIOS of threat() matter (the sim + the
// enemy budget compare threats), so the absolute scale is irrelevant.
export const REF_AC = 14;
export const REF_ATK = 5;

/**
 * Count the d20 faces (out of 20) that HIT under the verbatim resolveAttack rule:
 * nat 20 always hits (crit), nat 1 always misses, else natural + atkBonus ≥ targetAC.
 */
export function hitFaceCount(atkBonus, targetAC) {
  let faces = 0;
  for (let n = 2; n <= 19; n++) if (n + atkBonus >= targetAC) faces++;
  return faces + 1; // nat 20 auto-hit (crit)
}

/** Probability a single swing lands (0.05–1.0), per the d20 rule above. */
export function hitChance(atkBonus, targetAC) {
  return hitFaceCount(atkBonus, targetAC) / 20;
}

/**
 * Expected flat damage per round vs `targetAC`, matching resolveAttack: each hitting
 * non-crit face deals `attack`, the nat-20 face deals 2×`attack` (crit).
 */
export function expectedDamagePerRound(u, targetAC = REF_AC) {
  const attack = (u && u.stats && Number(u.stats.attack)) || 0;
  const atkBonus = (u && u.stats && Number(u.stats.atkBonus)) || 0;
  let dmg = 0;
  for (let n = 2; n <= 19; n++) if (n + atkBonus >= targetAC) dmg += attack;
  dmg += 2 * attack; // nat-20 crit
  return dmg / 20;
}

/** Effective HP = raw HP scaled by how hard the unit is to hit (a REF attacker's miss rate). */
export function effectiveHp(u, attackerBonus = REF_ATK) {
  const ac = (u && u.stats && Number(u.stats.ac)) || 0;
  const hp = (u && Number(u.maxHp)) || 0;
  const p = hitChance(attackerBonus, ac);
  return p > 0 ? hp / p : hp * 20;
}

/**
 * threat — one scalar of combat power: offense (expected DPR) × survivability (effective HP)
 * × the unit's weight-bracket multiplier. Used to balance a fight: an enemy force at a
 * "×1.0 budget" has total threat ≈ the player squad's total threat.
 *
 * @param {{stats?:{attack?:number,atkBonus?:number,ac?:number}, maxHp?:number, bracket?:any, bracketId?:any}} u
 * @param {{bracket?:any, targetAC?:number, attackerBonus?:number}} [opts]
 */
export function threat(u, opts = {}) {
  if (!u || !u.stats) return 0;
  const mult = bracketMult(opts.bracket ?? u.bracketId ?? u.bracket);
  const dpr = expectedDamagePerRound(u, opts.targetAC ?? REF_AC);
  const ehp = effectiveHp(u, opts.attackerBonus ?? REF_ATK);
  return mult * dpr * ehp;
}
