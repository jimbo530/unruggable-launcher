// @ts-check
/**
 * combat-helpers.js — P6 FAIRNESS LAYER. The SINGLE attack/cast CHOKEPOINT.
 *
 * Every swing and every spell in the battle now flows through THIS module, so the
 * driver (game.js) never calls the raw engine resolvers directly. That gives one place
 * to add the fairness/legibility layer the COMBAT-PLAN calls for:
 *
 *   • forecast(attacker, target)  → a NO-MUTATION, EXACT { hitPct, flatDmg, critPct, hpAfter }
 *                                   read-out (the XCOM-style HUD numbers). Pure: it rolls
 *                                   no dice and touches no unit.
 *   • strike(attacker, target)    → the ONE weapon-attack resolver. Delegates to the verbatim
 *                                   engine (via resolveAttackExt) and then layers PER-WEAPON
 *                                   CRIT RANGES on top (gear-ext WEAPON_DICE.crit).
 *   • castWrapped(caster, target) → the ONE spell resolver. Thin pass-through to the verbatim
 *                                   resolveSpellCast so game.js's spell paths route through here.
 *   • planIntent(unit, ctx)       → the squad AI BRAIN + the Into-the-Breach TELEGRAPH source:
 *                                   focus-fire the lowest-effHp foe, casters/ranged KITE to
 *                                   max-range, melee SCREEN their own caster. Returns the move
 *                                   hex + strike hex(es) so game.js can paint the intent ghost
 *                                   BEFORE the enemy phase resolves, then act on the same plan.
 *   • chooseTarget(unit, foes)    → exported so the AI can RE-VALIDATE its target after a kill.
 *
 * ── THE CRIT-RANGE FIX (load-bearing — guarded by a unit test) ───────────────────────
 * The verbatim engine (tot-engine.js resolveAttack) hard-codes ONE crit rule: natural 20 →
 * ×2 damage. Real SRD weapons crit on a RANGE (longsword 19-20, scimitar 18-20) and/or a
 * different MULTIPLIER (warhammer/greataxe ×3). To honour the weapon WITHOUT editing the
 * engine, strike() must, on a weapon-crit:
 *      1. take the engine's hit result,
 *      2. DIVIDE OUT the engine's hard-coded nat-20 ×2 to recover the ×1 base damage,
 *      3. THEN apply the weapon's own critMult (×2 / ×3) to that base.
 * Skipping step 2 on a nat 20 would DOUBLE-APPLY (×2 then ×3 = ×6). Because every damage
 * component here is an integer (stats.attack, spell dmgBuff, and any rolled die total), the
 * engine's `round(base×2)` is exactly `base×2`, so dividing by 2 is loss-less. crit-ranges.mjs
 * asserts a ×3 weapon on a nat 20 deals 3× (not 2×, not 6×) and a 19-20 weapon crits on a
 * nat 19 the bare engine would treat as an ordinary hit.
 *
 * PURE / NODE-SAFE: no DOM, no localStorage. Imports the verbatim engine, the weapon-dice
 * wrapper (combat-ext.js), the gear-ext crit table, and balance.js's hit-chance helper only.
 * node --check clean. ESM.
 */

import { rollD20, resolveSpellCast, hexDistance, isConscious, abilityMod } from "./tot-engine.js";
import { resolveAttackExt, weaponDiceExpr } from "./combat-ext.js";
import { WEAPON_DICE, weaponBaseKey } from "./gear-ext.js";
import { hitChance } from "./balance.js";
// P8 RANGED LINE-OF-SIGHT: the chokepoint asks los.js whether a wall blocks the shot/cast, so a
// ranged attack or spell can't fire THROUGH cover (the previously-cut "cover blocks ranged line").
import { losClear } from "./los.js";

// ── effect sums (mirror tot-engine.js sumEffects so forecast() matches the engine exactly) ──
const sumEff = (u, k) => (u && u.activeEffects ? u.activeEffects : []).reduce((s, e) => s + ((e && e[k]) || 0), 0);

/**
 * Parse a WEAPON_DICE crit field into a normalized { lo, mult }:
 *   undefined / ""  → { lo: 20, mult: 2 }   (SRD default: ×2 on a natural 20)
 *   "19-20"         → { lo: 19, mult: 2 }   (extended threat range, ×2)
 *   "18-20"         → { lo: 18, mult: 2 }
 *   "×3" / "x3"     → { lo: 20, mult: 3 }   (nat 20 only, but ×3)
 *   "19-20/×3"      → { lo: 19, mult: 3 }   (defensive: combined form, never in current data)
 * A crit triggers when a HITTING swing's natural d20 is in [lo, 20].
 *
 * @param {string|undefined|null} critStr
 * @returns {{lo:number, mult:number}}
 */
export function parseCrit(critStr) {
  let lo = 20, mult = 2;
  if (critStr == null) return { lo, mult };
  for (const part of String(critStr).split("/")) {
    const s = part.trim();
    const mMul = s.match(/^[x×*]\s*(\d+)$/i);            // "×3" / "x3"
    if (mMul) { mult = parseInt(mMul[1], 10) || mult; continue; }
    const mRange = s.match(/^(\d+)\s*-\s*(\d+)$/);       // "19-20"
    if (mRange) { lo = parseInt(mRange[1], 10) || lo; continue; }
  }
  if (!(lo >= 2 && lo <= 20)) lo = 20;                    // guard nonsense
  if (!(mult >= 1)) mult = 2;
  return { lo, mult };
}

/** The crit profile { lo, mult } for whatever weapon a unit has equipped (default ×2/20). */
export function weaponCritFor(unit) {
  const wid = unit && unit.equipped && unit.equipped.weapon;
  if (!wid) return { lo: 20, mult: 2 };
  const entry = WEAPON_DICE[weaponBaseKey(wid)];
  return parseCrit(entry && entry.crit);
}

/** Average of a dice expression "XdY", "XdY+Z" (level-1 weapon roll), else 0. Used by forecast(). */
function diceAverage(expr) {
  if (!expr) return 0;
  const m = String(expr).replace("/level", "").trim().match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
  if (!m) return 0;
  const n = parseInt(m[1], 10), die = parseInt(m[2], 10), bonus = m[3] ? parseInt(m[3], 10) : 0;
  return n * (die + 1) / 2 + bonus;                       // E[1dY] = (Y+1)/2
}

/**
 * forecast — the EXACT, NO-MUTATION attack read-out for the HUD (XCOM-style). Rolls no dice
 * and mutates nothing; every number is computed directly from the verbatim resolveAttack rule
 * (d20 + atkBonus vs AC, nat 20 auto-hit, nat 1 auto-miss) plus the equipped weapon's crit range.
 *
 *   hitPct  — P(the swing lands)         = (hitting d20 faces) / 20
 *   critPct — P(the swing crits)         = (hitting faces within the weapon crit range) / 20
 *   flatDmg — a NORMAL (non-crit) hit's damage = attack(+dmg buffs)(+avg weapon die), engine-rounded
 *   hpAfter — target.currentHp − flatDmg (what the HP bar shows after a normal hit; may be ≤0)
 *
 * TERRAIN: an optional `opts.coverAC` (the +AC the target gains from a COVER tile, supplied by
 * game.js from terrain-effects.coverACAt) is added to the target's effective AC so the HUD's
 * hit%/crit% reflect cover EXACTLY as the real swing will — same chokepoint, one formula.
 *
 * LINE-OF-SIGHT (P8): an optional `opts.terrainIx` lets the HUD read 0% when a wall blocks a RANGED
 * shot (distance ≥ 2) — you can't fire/cast through cover. Melee (adjacent) is never gated.
 *
 * @param {object} attacker
 * @param {object} target
 * @param {{coverAC?:number, terrainIx?:Map<string,any>}} [opts]
 * @returns {{hitPct:number, flatDmg:number, critPct:number, hpAfter:number, critDmg:number, crit:{lo:number,mult:number}, blocked?:boolean}}
 */
export function forecast(attacker, target, opts = {}) {
  const atkBuff = sumEff(attacker, "buffAtk") + sumEff(attacker, "debuffAtk");
  const dmgBuff = sumEff(attacker, "buffDmg") + sumEff(attacker, "debuffDmg");
  const acBuff = sumEff(target, "buffAC") + sumEff(target, "debuffAC");
  const coverAC = Math.max(0, Number(opts.coverAC) || 0);
  const atkMod = ((attacker.stats && attacker.stats.atkBonus) || 0) + atkBuff;
  const effAC = ((target.stats && target.stats.ac) || 0) + acBuff + coverAC;
  const { lo, mult } = weaponCritFor(attacker);

  // count hitting faces (2..19 by the rule; nat 20 always hits) and the subset that crit
  let hitFaces = 1;            // nat 20 auto-hit
  let critFaces = 1;          // nat 20 always within [lo,20]
  for (let n = 2; n <= 19; n++) {
    if (n + atkMod >= effAC) { hitFaces++; if (n >= lo) critFaces++; }
  }
  const hitPct = hitFaces / 20;
  const critPct = critFaces / 20;

  const flatBase = ((attacker.stats && attacker.stats.attack) || 0) + dmgBuff
    + diceAverage(weaponDiceExpr(attacker.equipped && attacker.equipped.weapon));
  const flatDmg = Math.max(1, Math.round(flatBase));
  const critDmg = Math.max(1, Math.round(flatBase * mult));
  const hpAfter = (Number(target.currentHp) || 0) - flatDmg;

  // P8 RANGED LINE-OF-SIGHT: a shot/cast at distance ≥ 2 can't fire THROUGH a wall → the HUD reads
  // 0% (blocked). Melee (adjacent) is never gated. Only engaged when game.js passes a terrain index
  // AND both units have positions → every duel/training forecast is byte-for-byte unchanged.
  if (opts.terrainIx && attacker.position && target.position
    && hexDistance(attacker.position, target.position) >= 2
    && !losClear(attacker.position, target.position, opts.terrainIx)) {
    return { hitPct: 0, flatDmg, critPct: 0, hpAfter: Number(target.currentHp) || 0, critDmg, crit: { lo, mult }, blocked: true };
  }
  return { hitPct, flatDmg, critPct, hpAfter, critDmg, crit: { lo, mult } };
}

/**
 * strike — THE single weapon-attack resolver (the chokepoint game.js calls). Rolls the d20
 * (or uses an injected nat for tests), delegates hit/AC/buff/dice math to the VERBATIM engine
 * via resolveAttackExt, then applies the equipped weapon's crit RANGE + MULTIPLIER on top —
 * dividing out the engine's hard-coded nat-20 ×2 first (see the header). Returns the engine's
 * result object with `damage` corrected and `crit` set; it does NOT apply HP (the caller does).
 *
 * TERRAIN: an optional `opts.coverAC` (the +AC the target gains from a COVER tile) is layered
 * onto a SHALLOW COPY of the target's stats — exactly the no-mutation pattern combat-ext uses
 * for weapon dice — so the verbatim engine still owns the hit/AC math and the live unit is never
 * touched. Zero coverAC (every duel/training fight) → the byte-for-byte current path.
 *
 * LINE-OF-SIGHT (P8): an optional `opts.terrainIx` makes a RANGED swing (distance ≥ 2) REQUIRE a
 * clear line — a wall between attacker and target REJECTS the shot (no hit, no damage, `blocked`).
 * Melee (adjacent, distance 1) is never gated. No terrain index → the byte-for-byte current path.
 *
 * DETERMINISM HOOK (seas combat-settlement): `opts.rng` (a seeded float-in-[0,1) fn) drives the
 * d20 AND the weapon-die roll. It DEFAULTS to Math.random, so every existing caller/test (which
 * inject `nat` and pass no rng) is byte-for-byte unchanged. resolver.js + the live game pass a
 * per-fight seeded rng so the same seed+actions replay identically in the browser AND the server.
 *
 * @param {object} attacker
 * @param {object} target
 * @param {{nat?:number, distance?:number, coverAC?:number, terrainIx?:Map<string,any>, rng?:()=>number}} [opts]  nat injectable for deterministic tests
 * @returns {ReturnType<typeof resolveAttackExt> & { crit?:boolean, nat?:number, blocked?:boolean }}
 */
export function strike(attacker, target, opts = {}) {
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
  const nat = Number.isFinite(opts.nat) ? Number(opts.nat) : rollD20(rng);
  const distance = opts.distance ?? 1;
  // P8 RANGED LINE-OF-SIGHT (chokepoint): a shot/throw/cast at distance ≥ 2 cannot pass THROUGH a
  // wall. Melee (adjacent, distance 1) is unaffected — there is no hex between two adjacent hexes.
  // Only engaged when a terrain index is supplied (every duel/training strike skips this).
  if (distance >= 2 && opts.terrainIx && attacker.position && target.position
    && !losClear(attacker.position, target.position, opts.terrainIx)) {
    return { hit: false, blocked: true, damage: 0, crit: false, nat, breakdown: "no line of sight — a wall blocks the shot" };
  }
  const coverAC = Math.max(0, Number(opts.coverAC) || 0);
  // COVER → raise the target's effective AC on a shallow copy (activeEffects ref preserved so the
  // engine's buffAC/debuffAC sums still apply); the result object is independent of the live unit.
  const tgt = coverAC > 0
    ? { ...target, stats: { ...(target.stats || {}), ac: ((target.stats && target.stats.ac) || 0) + coverAC } }
    : target;
  const res = resolveAttackExt(attacker, tgt, nat, distance, rng);
  res.nat = nat;
  if (!res || !res.hit) { if (res) res.crit = false; return res; }

  const { lo, mult } = weaponCritFor(attacker);
  const isWeaponCrit = nat >= lo;                          // a hitting swing whose nat is in [lo,20]
  // recover the ×1 base damage: the engine ALREADY ×2'd it iff nat===20 (loss-less, integers)
  const base1 = nat === 20 ? res.damage / 2 : res.damage;
  if (isWeaponCrit) {
    const corrected = Math.max(1, Math.round(base1 * mult));
    res.crit = true;
    if (corrected !== res.damage) {
      // engine's breakdown reflected its own ×2 (or no-crit) — annotate the weapon's real result
      res.breakdown = `${res.breakdown}  ✷ ${rangeLabel(lo)} crit ×${mult} → ${corrected} dmg`;
    }
    res.damage = corrected;
  } else {
    // nat in (no weapon-crit): make sure a plain nat-20 ×2 weapon stays ×2 (engine already did),
    // and a non-20 hit is the engine's straight damage. Nothing to correct.
    res.crit = false;
  }
  return res;
}

const rangeLabel = (lo) => (lo >= 20 ? "20" : `${lo}-20`);

/**
 * castWrapped — THE single spell resolver (chokepoint). A thin, faithful pass-through to the
 * verbatim resolveSpellCast so game.js's player-cast + AI-cast + AoE-splash paths all route
 * through this module (and the engine call lives ONLY here). game.js applies the returned
 * { damage | healing | effect } itself (applyDamage / healUnit / activeEffects.push).
 *
 * DETERMINISM HOOK: `rng` (default Math.random) is forwarded to resolveSpellCast so the save roll
 * + damage/heal dice come from the per-fight seeded rng when the resolver / live game supply one;
 * absent it, Math.random keeps every existing caller byte-for-byte unchanged.
 *
 * @param {object} caster
 * @param {object} target
 * @param {{id:string,name:string,level:number,battle:object}} spell
 * @param {boolean} [isConcentration]
 * @param {() => number} [rng=Math.random]
 */
export function castWrapped(caster, target, spell, isConcentration, rng = Math.random) {
  return resolveSpellCast(caster, target, spell.id, spell.name, spell.level, spell.battle, isConcentration, rng);
}

/**
 * resolveOverboard — the WATER-EDGE fall check. A unit that ENTERS a water-edge hex makes a DEX
 * reflex save: roll d20 + abilityMod(rawAbilities.dex) vs `dc`; below the DC it goes overboard.
 * Lives HERE (not game.js) so the d20 stays in the chokepoint alongside strike()/castWrapped() —
 * game.js calls this and then applies the consequence through its own applyDamage. NO MUTATION.
 *
 * @param {object} unit
 * @param {{dc?:number, nat?:number, rng?:()=>number}} [opts]  nat injectable for deterministic tests; rng defaults to Math.random
 * @returns {{fell:boolean, roll:number, mod:number, total:number, dc:number}}
 */
export function resolveOverboard(unit, opts = {}) {
  const dc = Number.isFinite(opts.dc) ? Math.trunc(Number(opts.dc)) : 12;
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
  const nat = Number.isFinite(opts.nat) ? Number(opts.nat) : rollD20(rng);
  const mod = abilityMod((unit && unit.rawAbilities && unit.rawAbilities.dex) || 0);
  const total = nat + mod;
  return { fell: total < dc, roll: nat, mod, total, dc };
}

// ── SQUAD AI + TELEGRAPH ──────────────────────────────────────────────────────────────────
// One brain feeds two consumers: the Into-the-Breach intent TELEGRAPH (game.js paints the
// planned move + strike hexes before the enemy acts) AND the actual enemy turn (game.js moves
// to moveTo and strikes the planned target). Re-validation after a kill: game.js calls
// chooseTarget() again at strike time so a dead target is replaced.

/** Effective HP to FINISH a foe from its CURRENT hp: currentHp ÷ this attacker's hit chance.
 *  Lower = easier to drop → the focus-fire target. */
export function effHpToFinish(foe, attackerBonus) {
  const ac = (foe.stats && foe.stats.ac) || 10;
  const hp = Math.max(1, Number(foe.currentHp) || 0);
  const p = hitChance(attackerBonus, ac);
  return p > 0 ? hp / p : hp * 20;
}

/**
 * chooseTarget — focus-fire pick: the standing foe with the LOWEST effHp-to-finish (break the
 * weakest first), ties broken by nearest. Returns null if no foe stands. Exported so the AI can
 * RE-VALIDATE after an ally's kill changes the board.
 *
 * @param {object} unit
 * @param {object[]} foes  candidate enemies (caller passes the conscious ones)
 * @returns {object|null}
 */
export function chooseTarget(unit, foes) {
  const live = (foes || []).filter((f) => f && isConscious(f));
  if (!live.length) return null;
  const bonus = (unit.stats && unit.stats.atkBonus) || 0;
  let best = null, bestScore = Infinity, bestDist = Infinity;
  for (const f of live) {
    const score = effHpToFinish(f, bonus);
    const d = hexDistance(unit.position, f.position);
    if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && d < bestDist)) {
      best = f; bestScore = score; bestDist = d;
    }
  }
  return best;
}

const sameHex = (a, b) => a && b && a.q === b.q && a.r === b.r;
const minDistToAny = (hex, units, dist) => units.reduce((m, u) => Math.min(m, dist(hex, u.position)), Infinity);

/**
 * planIntent — decide a unit's turn AND describe it for the telegraph. Pure: it reads the
 * board through `ctx` (so it stays node-safe and decoupled from the grid module) and returns a
 * plan; it changes nothing. game.js paints { moveTo, strikeHexes } as the intent ghost, then
 * executes the same plan through strike()/castWrapped().
 *
 * Behaviour (per COMBAT-PLAN P6):
 *   • focus-fire — target = chooseTarget() (lowest effHp foe).
 *   • KITE       — casters & ranged (actRange>1) pick the reachable hex that keeps the target in
 *                  range while MAXIMISING spacing from the nearest foe (stay at arm's length).
 *   • SCREEN     — melee pick a hex that can strike the target while staying nearest their OWN
 *                  caster (their body blocks the lane to the squishy caster).
 *
 * LINE-OF-SIGHT (P8): an optional `ctx.hasLos(fromHex, targetPos)` predicate makes a RANGED/cast
 * plan require a clear line — the AI kites to a hex it can actually SEE the target from (and won't
 * telegraph a strike through a wall). Absent (duels/training) → defaults to always-clear.
 *
 * @param {object} unit
 * @param {{ foes:object[], allies:object[], reach:(u:object)=>{q:number,r:number}[],
 *           dist:(a:object,b:object)=>number, actRange:(u:object)=>number,
 *           meleeRange:(u:object)=>number, ownCaster?:object|null, aoeArea?:(u:object)=>number,
 *           hasLos?:(from:{q:number,r:number}, to:{q:number,r:number})=>boolean }} ctx
 * @returns {{ target:object|null, targetId:any, moveTo:{q:number,r:number}, from:{q:number,r:number},
 *            strikeHexes:{q:number,r:number}[], willStrike:boolean, kind:string }}
 */
export function planIntent(unit, ctx) {
  const here = { q: unit.position.q, r: unit.position.r };
  const dist = ctx.dist || ((a, b) => hexDistance(a, b));
  const foes = (ctx.foes || []).filter(isConscious);
  const target = chooseTarget(unit, foes);
  const kind = unit.role === "caster" ? "caster" : ((unit.attackRange || 1) > 1 ? "ranged" : "melee");

  if (!target) {
    return { target: null, targetId: null, moveTo: here, from: here, strikeHexes: [], willStrike: false, kind };
  }

  const actRange = Math.max(1, (ctx.actRange ? ctx.actRange(unit) : (unit.attackRange || 1)));
  const candidates = [here, ...((ctx.reach && ctx.reach(unit)) || [])];
  const hasLos = ctx.hasLos || (() => true);   // P8: default (no terrain) → every line is clear
  // Can the unit act on the target FROM hex h? In range AND — for a RANGED/cast reach (distance ≥ 2)
  // — with a clear line of sight (a wall blocks the shot). Melee (adjacent) never needs a line.
  const canActFrom = (h) => {
    const d = dist(h, target.position);
    if (d > actRange) return false;
    return d <= 1 || hasLos(h, target.position);
  };
  const kiter = kind === "caster" || kind === "ranged";

  let moveTo = here;
  const actable = candidates.filter(canActFrom);
  if (kiter) {
    if (actable.length) {
      // stay in range, maximise distance from the NEAREST foe (kite); tie → closest to max range
      moveTo = actable.reduce((best, h) => {
        const sp = minDistToAny(h, foes, dist), bs = minDistToAny(best, foes, dist);
        if (sp > bs + 1e-9) return h;
        if (Math.abs(sp - bs) <= 1e-9 && dist(h, target.position) > dist(best, target.position)) return h; // sit nearer max range
        return best;
      }, actable[0]);
    } else {
      moveTo = closestTo(candidates, target.position, dist);          // out of range → close in
    }
  } else {
    // melee: strike if able, while SCREENING own caster (stay nearest it); else close in
    const caster = ctx.ownCaster || (ctx.allies || []).find((a) => a !== unit && a.role === "caster" && isConscious(a)) || null;
    const strikers = candidates.filter((h) => dist(h, target.position) <= (ctx.meleeRange ? ctx.meleeRange(unit) : (unit.attackRange || 1)));
    if (strikers.length) {
      moveTo = caster
        ? closestTo(strikers, caster.position, dist)                  // body between foe and caster
        : closestTo(strikers, target.position, dist);
    } else {
      moveTo = closestTo(candidates, target.position, dist);
    }
  }

  const willStrike = canActFrom(moveTo);   // P8: in range AND (adjacent OR clear line) — no firing through walls
  const strikeHexes = [{ q: target.position.q, r: target.position.r }];
  // telegraph the AoE blast zone for area casters (foes adjacent to the target within hexArea)
  const area = ctx.aoeArea ? ctx.aoeArea(unit) : 0;
  if (willStrike && area > 0) {
    for (const f of foes) {
      if (sameHex(f.position, target.position)) continue;
      if (dist(f.position, target.position) <= area) strikeHexes.push({ q: f.position.q, r: f.position.r });
    }
  }
  return { target, targetId: target.id, moveTo, from: here, strikeHexes, willStrike, kind };
}

/** Hex in `list` nearest to `pos` (first-wins on ties → stable). */
function closestTo(list, pos, dist) {
  let best = list[0], bestD = Infinity;
  for (const h of list) { const d = dist(h, pos); if (d < bestD) { bestD = d; best = h; } }
  return best;
}
