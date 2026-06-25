// @ts-check
/**
 * schema.js — Type definitions + a runtime validator for the Cause = Class engine.
 *
 * This file is PURE DATA SHAPE + VALIDATION. No game logic lives here.
 * The designer authors `config/causes.js` and `config/classes.js` against these
 * shapes. `validateConfig()` is a defensive check so a malformed config fails
 * LOUD at load time instead of silently producing wrong qualifications.
 *
 * Nothing here touches a blockchain. Endowment data is a plain object stub
 * (see resolver.js EndowmentMap) that will later be filled by the on-chain
 * vault / cross-version oracle.
 */

/** The six canonical D&D ability scores. Order is fixed and load-bearing. */
export const STATS = /** @type {const} */ (["STR", "DEX", "CON", "INT", "WIS", "CHA"]);

/** Base value every stat starts at before any water (endowment) is applied. */
export const BASE_STAT = 10;

/** HP every wallet starts with before class/level bonuses. */
export const BASE_HP = 10;

/** Level cap for a normal cause; "god" causes may exceed up to GOD_CAP. */
export const NORMAL_CAP = 20;
export const GOD_CAP = 30;

/**
 * The eleven archetype families from the class map (docs/battle-grid-class-map.md §4a).
 * A cause is tagged to a family; a class belongs to a family. Combos cross families.
 */
export const FAMILIES = /** @type {const} */ ([
  "Tank",
  "Melee-DPS",
  "Mobility",       // Mobility / Skirmisher
  "Ranged",
  "Arcane",         // Arcane caster
  "Divine",         // Divine caster
  "Nature",         // Nature caster
  "Support",        // Support / buff
  "Control",        // Debuff / control
  "Gish",           // Gish / hybrid
  "Exotic",         // Niche / exotic
  "Generalist",     // Balanced / jack-of-all (earned bluechip, balance Fighter)
]);

/**
 * Strictness bands. This is the "concentration RATIO + drift" lever (map §4b/§4c).
 * A higher strictness class demands its required cause(s) hold a TIGHTER share of
 * the wallet's total endowment — dilute past the band and you drift out of the class.
 *
 * `bandWidth` is the +/- tolerance (in ratio points, 0..1) the cause % may wander
 * from `ratioThreshold` before the class drops. Loose = wide, strict = narrow.
 */
export const STRICTNESS = /** @type {const} */ ({
  loose:  { bandWidth: 1.00 }, // Tier 0 on-ramp: any dilution tolerated above threshold
  medium: { bandWidth: 0.20 }, // Tier 1-2: must stay within 20 points of threshold
  strict: { bandWidth: 0.08 }, // Tier 3 exotic: very tight, drifts out the instant it slips
});

/**
 * @typedef {(typeof STATS)[number]} Stat
 * @typedef {(typeof FAMILIES)[number]} Family
 * @typedef {keyof typeof STRICTNESS} Strictness
 */

/**
 * A CAUSE = an authored charitable endowment target. This is what a wallet puts
 * money into; the money becomes "water" that grows stats (resolver.js).
 *
 * `stat` may be EITHER:
 *   - a single Stat string ("STR")  → concentrated 1.0 per $1 into that stat, OR
 *   - a SPLIT object { STR: 0.5, CON: 0.5 } → $1 divides by the weights
 *     (+0.5 STR, +0.5 CON per $1). Split weights MUST sum to 1.0. This is a
 *     CONCENTRATED split (the point stays whole, just shared) — NOT the 1/6
 *     diffuse spread, which is unchanged.
 *
 * @typedef {{ [stat: string]: number }} StatSplit  Partial Record<Stat, number>, weights sum to 1.0.
 *
 * `pointRate` (default 1.0) multiplies the stat POINTS produced per $1 endowed to
 * this cause, applied BEFORE the single-stat-vs-split distribution (and still
 * subject to the 20/30 caps). pointRate > 1.0 represents a cause carrying an EXTRA
 * impact mechanic that rewards more power (e.g. a forgone-airdrop burn). Must be > 0.
 *
 * @typedef {Object} Cause
 * @property {string}        id        Unique stable key, e.g. "burgers".
 * @property {string}        name      Display name, e.g. "Burgers".
 * @property {Family}        family    Which archetype family this cause feeds.
 * @property {Stat|StatSplit} stat     Single stat OR a weighted split (weights sum to 1.0).
 * @property {number}  [pointRate]     Stat points per $1 (default 1.0; must be > 0).
 * @property {Stat}    [secondary]     Optional secondary stat (display/flavor only).
 * @property {string}  [tokenRef]      Opaque ref to the on-chain cause token / vault. Engine never calls it.
 * @property {string}  [note]          Designer note.
 */

/**
 * A PREREQUISITE: hold `level` (= $ endowed) in another class's required cause(s).
 * Mirrors FFT "reach Lv N in job X" (map §2).
 *
 * @typedef {Object} Prereq
 * @property {string} classId  Another class id that must be QUALIFIED.
 * @property {number} level    Minimum class-level required in that prereq class.
 */

/**
 * An ability/spell granted by a class, gated by class-level (= $ in the cause).
 * Mirrors FFT/D&D spell tiers unlocking as you level the job/class.
 *
 * @typedef {Object} Ability
 * @property {string}  id
 * @property {string}  name
 * @property {number}  minClassLevel  Class-level at which this unlocks.
 * @property {"spell"|"ability"} kind
 * @property {string} [note]
 */

/**
 * A CLASS = an authored archetype unlocked by an endowment shape. This is the
 * config the designer grows like FFT's job list — no code changes needed.
 *
 * Gating levers (map §4b):
 *  (a) ratio gate    — each requiredCause's share of total endowment >= ratioThreshold,
 *                      held within the strictness band (concentration + drift).
 *  (b) depth gate    — class-level (sum of $ in requiredCauses) drives ability tiers.
 *  (c) prereq gate   — FFT-style: be QUALIFIED for listed prereq classes at >= level.
 *
 * @typedef {Object} ClassDef
 * @property {string}   id
 * @property {string}   name
 * @property {Family}   family
 * @property {Stat}     primaryStat        Drives spell power / save DC (8 + mod).
 * @property {Stat}    [secondaryStat]
 * @property {string[]} requiredCauses     One or more cause ids the wallet must hold.
 * @property {number}   ratioThreshold     Min combined share (0..1) requiredCauses must hold.
 * @property {Strictness} strictness       Band tightness for the ratio gate.
 * @property {Prereq[]} prereqs            FFT-style class prereqs (may be empty).
 * @property {Ability[]} abilities         Level-gated abilities/spells.
 * @property {0|1|2|3}  tier               0 Base, 1 Specialized, 2 Combo, 3 Exotic.
 * @property {boolean} [balanceClass]      Fighter-style: qualifies when NO cause dominates.
 * @property {string}  [note]
 */

/**
 * @typedef {Object} EngineConfig
 * @property {Cause[]}    causes
 * @property {ClassDef[]} classes
 */

const STAT_SET = new Set(STATS);
const FAMILY_SET = new Set(FAMILIES);
const STRICT_SET = new Set(Object.keys(STRICTNESS));

/** Tolerance for split-weight sum == 1.0 (float safety). */
export const SPLIT_SUM_EPSILON = 1e-9;

/**
 * Normalize a cause's `stat` field into a weight map { STAT: weight } that sums to 1.0.
 *  - single stat "STR"          → { STR: 1.0 }
 *  - split { STR: 0.5, CON: 0.5 } → returned as-is (validated)
 * Throws LOUD on unknown stats or weights that don't sum to 1.0.
 *
 * @param {string | Record<string, number>} stat
 * @param {string} [causeId]  for error messages
 * @returns {Record<string, number>}
 */
export function splitWeights(stat, causeId = "?") {
  if (typeof stat === "string") {
    if (!STAT_SET.has(stat)) throw new Error(`splitWeights: cause "${causeId}" has unknown stat "${stat}"`);
    return { [stat]: 1.0 };
  }
  if (!stat || typeof stat !== "object") {
    throw new Error(`splitWeights: cause "${causeId}" stat must be a stat string or a split object`);
  }
  const entries = Object.entries(stat);
  if (entries.length === 0) throw new Error(`splitWeights: cause "${causeId}" split is empty`);
  let sum = 0;
  for (const [s, w] of entries) {
    if (!STAT_SET.has(s)) throw new Error(`splitWeights: cause "${causeId}" split has unknown stat "${s}"`);
    if (typeof w !== "number" || w <= 0) throw new Error(`splitWeights: cause "${causeId}" split weight for "${s}" must be > 0`);
    sum += w;
  }
  if (Math.abs(sum - 1.0) > SPLIT_SUM_EPSILON) {
    throw new Error(`splitWeights: cause "${causeId}" split weights must sum to 1.0, got ${sum}`);
  }
  return { ...stat };
}

/**
 * Validate a full engine config. Throws (LOUD, never silent) on the first problem
 * with a precise message. Returns the config unchanged on success for chaining.
 *
 * @param {EngineConfig} config
 * @returns {EngineConfig}
 */
export function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("validateConfig: config must be an object { causes, classes }");
  }
  const { causes, classes } = config;
  if (!Array.isArray(causes)) throw new Error("validateConfig: config.causes must be an array");
  if (!Array.isArray(classes)) throw new Error("validateConfig: config.classes must be an array");

  const causeIds = new Set();
  for (const c of causes) {
    if (!c.id) throw new Error("validateConfig: a cause is missing `id`");
    if (causeIds.has(c.id)) throw new Error(`validateConfig: duplicate cause id "${c.id}"`);
    causeIds.add(c.id);
    if (!c.name) throw new Error(`validateConfig: cause "${c.id}" missing name`);
    if (!FAMILY_SET.has(c.family)) throw new Error(`validateConfig: cause "${c.id}" has unknown family "${c.family}"`);
    splitWeights(c.stat, c.id); // validates single stat OR split (sum == 1.0), throws LOUD
    if (c.pointRate !== undefined && (typeof c.pointRate !== "number" || c.pointRate <= 0)) {
      throw new Error(`validateConfig: cause "${c.id}" pointRate must be > 0, got ${c.pointRate}`);
    }
    if (c.secondary !== undefined && !STAT_SET.has(c.secondary)) {
      throw new Error(`validateConfig: cause "${c.id}" has unknown secondary stat "${c.secondary}"`);
    }
  }

  const classIds = new Set();
  for (const k of classes) {
    if (!k.id) throw new Error("validateConfig: a class is missing `id`");
    if (classIds.has(k.id)) throw new Error(`validateConfig: duplicate class id "${k.id}"`);
    classIds.add(k.id);
    if (!k.name) throw new Error(`validateConfig: class "${k.id}" missing name`);
    if (!FAMILY_SET.has(k.family)) throw new Error(`validateConfig: class "${k.id}" has unknown family "${k.family}"`);
    if (!STAT_SET.has(k.primaryStat)) throw new Error(`validateConfig: class "${k.id}" has unknown primaryStat "${k.primaryStat}"`);
    if (k.secondaryStat !== undefined && !STAT_SET.has(k.secondaryStat)) {
      throw new Error(`validateConfig: class "${k.id}" has unknown secondaryStat "${k.secondaryStat}"`);
    }
    if (!STRICT_SET.has(k.strictness)) throw new Error(`validateConfig: class "${k.id}" has unknown strictness "${k.strictness}"`);
    if (typeof k.ratioThreshold !== "number" || k.ratioThreshold < 0 || k.ratioThreshold > 1) {
      throw new Error(`validateConfig: class "${k.id}" ratioThreshold must be 0..1, got ${k.ratioThreshold}`);
    }
    if (![0, 1, 2, 3].includes(k.tier)) throw new Error(`validateConfig: class "${k.id}" tier must be 0..3`);
    if (!k.balanceClass) {
      if (!Array.isArray(k.requiredCauses) || k.requiredCauses.length === 0) {
        throw new Error(`validateConfig: class "${k.id}" must list at least one requiredCause (or be balanceClass)`);
      }
      for (const rc of k.requiredCauses) {
        if (!causeIds.has(rc)) throw new Error(`validateConfig: class "${k.id}" requires unknown cause "${rc}"`);
      }
    }
    for (const p of k.prereqs || []) {
      if (!classIds.has(p.classId) && !classes.some((x) => x.id === p.classId)) {
        throw new Error(`validateConfig: class "${k.id}" prereq references unknown class "${p.classId}"`);
      }
      if (typeof p.level !== "number" || p.level < 0) {
        throw new Error(`validateConfig: class "${k.id}" prereq on "${p.classId}" needs a non-negative level`);
      }
    }
    for (const a of k.abilities || []) {
      if (!a.id || !a.name) throw new Error(`validateConfig: class "${k.id}" has an ability missing id/name`);
      if (typeof a.minClassLevel !== "number" || a.minClassLevel < 0) {
        throw new Error(`validateConfig: class "${k.id}" ability "${a.id}" needs non-negative minClassLevel`);
      }
    }
  }

  return config;
}
