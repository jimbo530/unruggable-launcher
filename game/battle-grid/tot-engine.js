// @ts-check
/**
 * tot-engine.js — Tales-of-Tasern hex + d20 combat + spell ENGINE, ported to
 * standalone vanilla ESM (TS types stripped, logic UNCHANGED).
 *
 * REUSE PROVENANCE (do not "improve" the formulas — they match the live ToT game):
 *   • Hex math       ← Tales-of-Tasern/src/lib/hexGrid.ts   (PORTED VERBATIM)
 *       hexToPixel, hexPolygonPoints, toCube, hexDistance, isAdjacent,
 *       hexNeighbors (odd-q flat-top), hexesInRange (BFS), allHexes.
 *   • d20 combat     ← Tales-of-Tasern/src/lib/hexCombat.ts (PORTED VERBATIM)
 *       rollD20, abilityMod (floor(stat/2) — see CONVENTION below), rollDice,
 *       resolveAttack (d20+atkBonus vs AC, crit 20 / crit-miss 1, dmg=attack stat),
 *       resolveSpellCast (DC = 10 + spellLevel + castingAbilityMod; target d20 +
 *       save-ability mod vs DC; damage halves on a made save).
 *   • Spells         ← Tales-of-Tasern/src/lib/spells.ts    (REAL spell data copied)
 *       Magic Missile, Burning Hands, Ray of Frost — exact `battle` effects.
 *
 * CONVENTION (load-bearing): ToT ability scores are "D&D score − 10", so its
 * abilityMod(s) = floor(s/2). The class-engine (units.js) outputs RAW D&D scores,
 * so the bridge subtracts 10 before storing into `rawAbilities` — see units.js.
 * Net result is identical d20 mods (class-engine STR 20 → +5 either way).
 *
 * Only the pure ENGINE is ported. The React renderers (HexBattle.tsx / CombatUI.tsx
 * / useHexBattle.ts) are NOT ported — this prototype renders its own ship-deck on
 * an SVG hex grid (see game.js) using these same primitives.
 */

// ── Grid config (from hexGrid.ts; deck is wider than tall like a ship) ──────────
export const GRID_COLS = 9;
export const GRID_ROWS = 7;
export const HEX_SIZE = 38;            // center→vertex px (hexGrid.ts default)
const SQRT3 = Math.sqrt(3);

// ── hexGrid.ts — pixel/polygon (flat-top, odd-q offset) — PORTED VERBATIM ───────
export function hexToPixel(hex, size = HEX_SIZE) {
  const x = size * 1.5 * hex.q;
  const y = size * SQRT3 * (hex.r + 0.5 * (hex.q & 1));
  return { x: x + size + 4, y: y + size + 4 };
}

export function hexPolygonPoints(cx, cy, size = HEX_SIZE) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

export function gridPixelDimensions(size = HEX_SIZE) {
  const last = hexToPixel({ q: GRID_COLS - 1, r: GRID_ROWS - 1 }, size);
  return { width: last.x + size + 8, height: last.y + size * SQRT3 * 0.5 + 8 };
}

function toCube(hex) {
  const x = hex.q;
  const z = hex.r - (hex.q - (hex.q & 1)) / 2;
  const y = -x - z;
  return { x, y, z };
}

export function hexDistance(a, b) {
  const ac = toCube(a), bc = toCube(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
}

export function isAdjacent(a, b) { return hexDistance(a, b) === 1; }

const EVEN_Q_NEIGHBORS = [
  { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: -1 }, { dq: -1, dr: 0 }, { dq: 0, dr: +1 },
];
const ODD_Q_NEIGHBORS = [
  { dq: +1, dr: +1 }, { dq: +1, dr: 0 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
];

export function hexNeighbors(hex) {
  const offsets = (hex.q & 1) === 0 ? EVEN_Q_NEIGHBORS : ODD_Q_NEIGHBORS;
  return offsets
    .map((d) => ({ q: hex.q + d.dq, r: hex.r + d.dr }))
    .filter((h) => h.q >= 0 && h.q < GRID_COLS && h.r >= 0 && h.r < GRID_ROWS);
}

export function hexesInRange(center, range, occupied = new Set()) {
  const visited = new Set();
  const key = (h) => `${h.q},${h.r}`;
  visited.add(key(center));
  let frontier = [center];
  const result = [];
  for (let step = 0; step < range; step++) {
    const next = [];
    for (const hex of frontier) {
      for (const n of hexNeighbors(hex)) {
        const k = key(n);
        if (visited.has(k) || occupied.has(k)) continue;
        visited.add(k);
        next.push(n);
        result.push(n);
      }
    }
    frontier = next;
  }
  return result;
}

export function allHexes() {
  const hexes = [];
  for (let q = 0; q < GRID_COLS; q++)
    for (let r = 0; r < GRID_ROWS; r++) hexes.push({ q, r });
  return hexes;
}

// ── hexCombat.ts — dice + modifiers — PORTED VERBATIM ───────────────────────────
export function rollD20() { return Math.floor(Math.random() * 20) + 1; }

/** ToT convention: stats are D&D−10, so mod = floor(stat/2). */
export function abilityMod(stat) { return Math.floor(Math.max(0, stat) / 2); }

export function rollDice(expr, casterLevel = 1) {
  const trimmed = expr.trim();
  if (/^\d+$/.test(trimmed)) { const n = parseInt(trimmed); return { total: n, breakdown: `${n}` }; }
  const perLevel = trimmed.includes("/level");
  const clean = trimmed.replace("/level", "").trim();
  const m = clean.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
  if (!m) return { total: 0, breakdown: "0" };
  let numDice = parseInt(m[1]);
  const dieSize = parseInt(m[2]);
  const bonus = m[3] ? parseInt(m[3]) : 0;
  if (perLevel) numDice = Math.min(numDice * casterLevel, 10);
  let total = bonus;
  const rolls = [];
  for (let i = 0; i < numDice; i++) {
    const roll = Math.floor(Math.random() * dieSize) + 1;
    rolls.push(roll); total += roll;
  }
  total = Math.max(1, total);
  const diceStr = `${numDice}d${dieSize}[${rolls.join(",")}]`;
  const bonusStr = bonus > 0 ? `+${bonus}` : "";
  return { total, breakdown: `${diceStr}${bonusStr}=${total}` };
}

function sumEffects(unit, key) {
  return (unit.activeEffects || []).reduce((sum, e) => sum + ((e[key]) ?? 0), 0);
}

// ── Death mechanic (hexCombat.ts) — 0 = unconscious, -10 = dead ──────────────────
export function isConscious(u) { return u.currentHp > 0; }
export function isUnconscious(u) { return u.currentHp <= 0 && u.currentHp > -10; }
export function isDead(u) { return u.currentHp <= -10; }
export function isAlive(u) { return u.currentHp > -10; }

/**
 * resolveAttack — PORTED from hexCombat.ts (boon/feat/elemental branches that need
 * the full ToT data tree are trimmed; the CORE d20 math is identical).
 *   d20(natural) + atkBonus vs target.stats.ac; nat 20 = crit (x2 dmg); nat 1 = miss.
 *   damage = attacker.stats.attack (the STR-derived physical damage stat).
 */
export function resolveAttack(attacker, target, natural, distance = 1) {
  const atkBuff = sumEffects(attacker, "buffAtk") + sumEffects(attacker, "debuffAtk");
  const acBuff = sumEffects(target, "buffAC") + sumEffects(target, "debuffAC");
  const dmgBuff = sumEffects(attacker, "buffDmg") + sumEffects(attacker, "debuffDmg");
  const effectiveAC = target.stats.ac + acBuff;

  const atkMod = attacker.stats.atkBonus + atkBuff;
  const modified = natural + atkMod;
  const isCrit = natural === 20;
  const isCritMiss = natural === 1;

  const modParts = [`${attacker.stats.atkBonus}`];
  if (atkBuff !== 0) modParts.push(`${atkBuff > 0 ? "+" : ""}${atkBuff} spell`);
  const modStr = modParts.join(" ");

  if (isCritMiss) return { hit: false, damage: 0, breakdown: `d20(1) — Critical Miss!` };

  if (!isCrit && modified < effectiveAC) {
    return {
      hit: false, damage: 0,
      breakdown: `d20(${natural}) + ${modStr} = ${modified} vs AC ${effectiveAC} — Miss!`,
    };
  }

  let damage = attacker.stats.attack + dmgBuff;
  const parts = [`${attacker.stats.attack} STR`];
  if (dmgBuff !== 0) parts.push(`${dmgBuff > 0 ? "+" : ""}${dmgBuff} spell`);
  if (isCrit) { damage *= 2; }
  damage = Math.max(1, Math.round(damage));

  const dmgStr = parts.join(" + ");
  const critStr = isCrit ? " CRITICAL HIT! " : "";
  const rangeStr = distance > 1 ? ` (${distance} hex)` : "";
  return {
    hit: true, damage,
    breakdown: `d20(${natural}) + ${modStr} = ${modified} vs AC ${effectiveAC}${rangeStr} —${critStr} ${damage} damage (${dmgStr}${isCrit ? " x2" : ""})`,
  };
}

/**
 * resolveSpellCast — PORTED VERBATIM (damage / healing / buff branches kept).
 *   DC = 10 + spellLevel + caster.castingAbilityMod
 *   save: target rolls d20 + abilityMod(save ability) vs DC; damage halves on save.
 */
export function resolveSpellCast(caster, target, spellId, spellName, spellLevel, effect, isConcentration) {
  const casterLvl = caster.casterLevel ?? 1;
  const casterMod = caster.castingAbilityMod ?? 0;
  const dc = 10 + spellLevel + casterMod;

  let saved = false, saveRoll = 0, saveTotal = 0;
  if (effect.save) {
    const saveAbility = effect.save === "fort" ? target.rawAbilities.con
      : effect.save === "ref" ? target.rawAbilities.dex
      : target.rawAbilities.wis;
    const saveMod = abilityMod(saveAbility) + sumEffects(target, "buffSave");
    saveRoll = rollD20();
    saveTotal = saveRoll + saveMod;
    saved = saveTotal >= dc;
  }
  const saveStr = effect.save
    ? ` (${effect.save.toUpperCase()} save: d20(${saveRoll})+${abilityMod(
        effect.save === "fort" ? target.rawAbilities.con
          : effect.save === "ref" ? target.rawAbilities.dex
          : target.rawAbilities.wis,
      )} = ${saveTotal} vs DC ${dc}${saved ? " — SAVED" : " — FAILED"})`
    : ` (DC ${dc}, no save)`;

  if (effect.type === "damage" && effect.damage) {
    const { total, breakdown } = rollDice(effect.damage, casterLvl);
    const finalDmg = saved ? Math.max(1, Math.floor(total / 2)) : total;
    const dmgTypeStr = effect.damageType ? ` ${effect.damageType}` : "";
    return { success: true, damage: finalDmg, breakdown: `${spellName}: ${breakdown}${dmgTypeStr} damage${saved ? " (halved)" : ""}${saveStr}` };
  }
  if (effect.type === "healing" && effect.healing) {
    const { total, breakdown } = rollDice(effect.healing, casterLvl);
    return { success: true, healing: total, breakdown: `${spellName}: heals ${breakdown} HP` };
  }
  if (effect.type === "buff") {
    const dur = effect.durationRounds ?? 1;
    const eff = {
      spellId, spellName, sourceId: caster.id, remainingRounds: dur, concentration: isConcentration,
      buffAC: effect.buffAC, buffAtk: effect.buffAtk, buffDmg: effect.buffDmg, buffSave: effect.buffSave, buffSpeed: effect.buffSpeed,
    };
    const parts = [];
    if (effect.buffAC) parts.push(`+${effect.buffAC} AC`);
    if (effect.buffAtk) parts.push(`+${effect.buffAtk} ATK`);
    if (effect.buffDmg) parts.push(`+${effect.buffDmg} DMG`);
    if (effect.buffSave) parts.push(`+${effect.buffSave} saves`);
    return { success: true, effect: eff, breakdown: `${spellName}: ${parts.join(", ")} for ${dur === -1 ? "combat" : dur + " rounds"}` };
  }
  return { success: false, breakdown: `${spellName}: no battle effect` };
}

// ── Real ToT spells (copied from spells.ts `battle` effects) ────────────────────
// id / name / level (wizard slot) / battle effect — used by the Wizard unit.
export const SPELLS = {
  magic_missile: {
    id: "magic_missile", name: "Magic Missile", level: 1,
    battle: { type: "damage", hexRange: 5, damage: "1d4+1", damageType: "force" }, // no save
  },
  burning_hands: {
    id: "burning_hands", name: "Burning Hands", level: 1,
    battle: { type: "damage", hexRange: 2, hexArea: 1, damage: "1d4/level", damageType: "fire", save: "ref" },
  },
  ray_of_frost: {
    id: "ray_of_frost", name: "Ray of Frost", level: 0,
    battle: { type: "damage", hexRange: 3, damage: "1d3", damageType: "cold" }, // cantrip, no save
  },
};
