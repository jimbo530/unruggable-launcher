// @ts-check
/**
 * stat-derive.js — the ONE source of the player stat-bridge math (lifted VERBATIM from
 * units.js buildUnit() ~L150-168 as of 2026-06-25). ADDITIVE: this file does NOT edit
 * the engine. units.js calls it so buildUnit() and items.js applyEquipment() derive
 * combat stats from ability scores THE SAME WAY — so a +2 STR ring really raises to-hit
 * and damage, and removing it returns the unit to exactly its un-geared numbers.
 *
 * CONVENTION (load-bearing — must match class-engine + tot-engine):
 *   • `scores` are RAW D&D ability scores (STR 20 = 20), the shape units.js view.stats
 *     and a monster's engineStats use.
 *   • ability mod = floor((score - 10) / 2)  — IDENTICAL to class-engine resolver.js
 *     abilityMod(score) (NOT clamped at 0), so the derived numbers match buildUnit()
 *     for every score, including sub-10 (a STR-8 melee still gets its -1).
 *   • rawAbilities (the ToT save shape) = max(0, score - 10): tot-engine resolveSpellCast
 *     reads target.rawAbilities and runs abilityMod = floor(max(0,x)/2).
 *
 * NOTE: maxHp is intentionally NOT derived here. buildUnit() takes HP straight from the
 * class-engine (view.hp), not a formula, so applyEquipment() adjusts maxHp from the
 * unit's stored baseMaxHp by the CON-mod delta instead (see items.js). This file only
 * owns the formula-derived fields (attack / atkBonus / ac / mAtk / def / mDef / speed).
 */

/** class-engine abilityMod, copied EXACTLY (resolver.js ~L49): floor((score-10)/2), unclamped. */
export function engineMod(score) {
  return Math.floor(((Number(score) || 0) - 10) / 2);
}

/**
 * Derive the formula-based combat stats from ability SCORES (raw D&D), the way
 * units.js buildUnit() does. Returns the derived fields PLUS the mods used (so the
 * caller can reuse strMod/conMod/etc. for HP and casting math without recomputing).
 *
 * @param {object} a
 * @param {{STR:number,DEX:number,CON:number,INT:number,WIS:number,CHA:number}} a.scores  raw D&D scores
 * @param {"melee"|"caster"} a.role
 * @param {number} [a.charLevel=1]  bracket-derived level (caps BAB via min(3, level))
 * @returns {{attack:number, atkBonus:number, ac:number, mAtk:number, def:number, mDef:number,
 *   speed:number, strMod:number, dexMod:number, intMod:number, conMod:number,
 *   rawAbilities:{str:number,dex:number,con:number,int:number,wis:number,cha:number}}}
 */
export function deriveCombatStats({ scores, role, charLevel = 1 }) {
  const S = scores;
  const strMod = engineMod(S.STR);
  const dexMod = engineMod(S.DEX);
  const intMod = engineMod(S.INT);
  const conMod = engineMod(S.CON);
  const isCaster = role === "caster";
  return {
    // melee hits harder (STR), caster weak in melee — VERBATIM from buildUnit()
    attack: isCaster ? Math.max(1, 1 + intMod) : Math.max(1, 4 + strMod),
    // to-hit = ability mod + a SMALL BAB (bracket-derived, capped +3)
    atkBonus: (isCaster ? intMod : strMod) + Math.min(3, charLevel),
    ac: 10 + dexMod,                       // battleStats: 10 + dexMod (unarmored)
    mAtk: S.INT,
    def: S.DEX,
    mDef: S.WIS,
    speed: Math.max(15, 25 + dexMod * 5),  // ft; /5 → hexes of move
    strMod, dexMod, intMod, conMod,
    rawAbilities: {
      str: Math.max(0, S.STR - 10), dex: Math.max(0, S.DEX - 10), con: Math.max(0, S.CON - 10),
      int: Math.max(0, S.INT - 10), wis: Math.max(0, S.WIS - 10), cha: Math.max(0, S.CHA - 10),
    },
  };
}
