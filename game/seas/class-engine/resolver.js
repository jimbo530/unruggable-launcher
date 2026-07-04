// @ts-check
/**
 * resolver.js — PURE, DETERMINISTIC game logic for the Cause = Class engine.
 *
 * Input: a plain EndowmentMap (stubbed here — later supplied by the on-chain
 * vault / cross-version oracle). NO blockchain calls. Same input → same output.
 *
 * Pipeline:
 *   endowment → levels → stats → qualified classes → bracket → spells → loadouts
 *
 * Mechanics (from docs/battle-grid-class-map.md + design memory):
 *  - Level = $ endowed ($1 = 1 level), cumulative. Total level = sum over causes.
 *  - Base block: 10 HP + all six D&D stats at 10.
 *  - WATER spreads stats two ways:
 *      • DIFFUSE water (bought / undirected) splits 1/6 evenly across all six stats.
 *      • EARNED cause-water CONCENTRATES at 6× into that cause's primary stat.
 *    (Spending $6 diffuse = +1 to every stat; earning $6 in a cause = +6 to its stat.)
 *  - Caps: 20 normal, 30 god (per-cause `god` flag via endowment entry).
 *  - Spell power = the cause's PRIMARY stat. d20 mod = floor((stat-10)/2);
 *    save DC = 8 + mod.
 *  - Class qualification = ratio gate (share within strictness band) AND prereqs AND,
 *    for the balance Fighter, NO cause dominating.
 *  - Drift is implicit: change the endowment, re-run, qualifications shift.
 *
 * @typedef {import("./schema.js").Cause} Cause
 * @typedef {import("./schema.js").ClassDef} ClassDef
 * @typedef {import("./schema.js").EngineConfig} EngineConfig
 * @typedef {import("./schema.js").Stat} Stat
 */

import {
  STATS, BASE_STAT, BASE_HP, NORMAL_CAP, GOD_CAP, STRICTNESS, validateConfig, splitWeights,
} from "./schema.js";

/**
 * EndowmentMap — the stubbed on-chain read. Two accepted shapes per cause:
 *   "clean_water": 12                       // shorthand: 12 USD, earned/concentrated
 *   "clean_water": { usd: 12, god: true }   // explicit; god raises that cause's cap to 30
 * Plus an optional reserved key "_diffuse" for bought/undirected water (spreads 1/6):
 *   "_diffuse": 30                          // 30 USD spread evenly across all stats
 *
 * @typedef {Object.<string, number | { usd: number, god?: boolean }>} EndowmentMap
 */

/** Reserved endowment key for bought/undirected (diffuse) water. */
export const DIFFUSE_KEY = "_diffuse";

/** d20 ability modifier. */
export function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

/** d20 save DC for a primary-stat-driven effect. */
export function saveDC(score) {
  return 8 + abilityMod(score);
}

/** @param {number | { usd: number, god?: boolean }} entry */
function entryUsd(entry) {
  if (typeof entry === "number") return entry;
  if (entry && typeof entry.usd === "number") return entry.usd;
  throw new Error(`resolver: malformed endowment entry ${JSON.stringify(entry)} — expected number or { usd }`);
}

/** @param {number | { usd: number, god?: boolean }} entry */
function entryGod(entry) {
  return typeof entry === "object" && !!entry.god;
}

/**
 * Normalize + validate the raw endowment stub. Throws LOUD on negatives / unknown
 * causes so a bad oracle read never silently mis-levels a wallet.
 *
 * @param {EndowmentMap} endowment
 * @param {Cause[]} causes
 * @returns {{ perCause: Map<string, { usd: number, god: boolean }>, diffuseUsd: number, totalUsd: number }}
 */
export function normalizeEndowment(endowment, causes) {
  if (!endowment || typeof endowment !== "object") {
    throw new Error("resolver: endowment must be an object { causeId: usd }");
  }
  const causeIds = new Set(causes.map((c) => c.id));
  const perCause = new Map();
  let diffuseUsd = 0;
  let totalUsd = 0;

  for (const [key, raw] of Object.entries(endowment)) {
    const usd = entryUsd(raw);
    if (usd < 0) throw new Error(`resolver: endowment for "${key}" is negative (${usd})`);
    if (key === DIFFUSE_KEY) {
      diffuseUsd += usd;
      totalUsd += usd;
      continue;
    }
    if (!causeIds.has(key)) {
      throw new Error(`resolver: endowment references unknown cause "${key}" (not in config)`);
    }
    perCause.set(key, { usd, god: entryGod(raw) });
    totalUsd += usd;
  }
  return { perCause, diffuseUsd, totalUsd };
}

/**
 * Per-cause levels + shares. Level = USD ($1 = 1 level), cumulative.
 *
 * @param {EndowmentMap} endowment
 * @param {Cause[]} causes
 * @returns {{
 *   totalLevel: number,
 *   diffuseLevel: number,
 *   perCause: Array<{ id: string, name: string, family: string, stat: Stat, level: number, share: number, god: boolean }>
 * }}
 */
export function computeLevels(endowment, causes) {
  const { perCause, diffuseUsd, totalUsd } = normalizeEndowment(endowment, causes);
  const causeById = new Map(causes.map((c) => [c.id, c]));
  const out = [];
  for (const [id, { usd, god }] of perCause) {
    const c = /** @type {Cause} */ (causeById.get(id));
    const weights = splitWeights(c.stat, c.id);
    const statLabel = Object.keys(weights).join("/"); // "STR" or "STR/CON"
    out.push({
      id,
      name: c.name,
      family: c.family,
      stat: c.stat,                                 // raw (single stat or split object)
      statLabel,                                    // readable, e.g. "STR/CON"
      level: usd,                                   // $1 = 1 level
      share: totalUsd === 0 ? 0 : usd / totalUsd,   // ratio of total endowment
      god,
    });
  }
  // Deterministic ordering: highest level first, then id.
  out.sort((a, b) => b.level - a.level || a.id.localeCompare(b.id));
  return { totalLevel: totalUsd, diffuseLevel: diffuseUsd, perCause: out };
}

/**
 * Compute the six stats + HP from endowment.
 *  - DIFFUSE water: +1/6 per stat per $1 (so $6 diffuse = +1 to each stat).
 *  - EARNED cause-water: +1 per $1 directly into that cause's primary stat
 *    (the "6× concentration" relative to the same dollar spent diffuse).
 *  - Each stat capped at 20, or 30 if ANY god cause feeds that stat.
 *
 * @param {EndowmentMap} endowment
 * @param {Cause[]} causes
 * @returns {{ hp: number, stats: Record<Stat, number>, raw: Record<Stat, number>, caps: Record<Stat, number> }}
 */
export function computeStats(endowment, causes) {
  const { perCause, diffuseUsd } = normalizeEndowment(endowment, causes);
  const causeById = new Map(causes.map((c) => [c.id, c]));

  /** @type {Record<Stat, number>} */
  const raw = /** @type {any} */ ({});
  /** @type {Record<Stat, number>} */
  const caps = /** @type {any} */ ({});
  for (const s of STATS) {
    raw[s] = BASE_STAT;
    caps[s] = NORMAL_CAP;
  }

  // Diffuse water: even 1/6 spread.
  const perStatFromDiffuse = diffuseUsd / STATS.length;
  for (const s of STATS) raw[s] += perStatFromDiffuse;

  // Earned cause-water: concentrate into the cause's stat(s) (6× vs diffuse).
  // A SPLIT cause divides the concentrated $ by its weights (e.g. {STR:.5,CON:.5}
  // → +0.5 STR, +0.5 CON per $1). This is NOT the 1/6 diffuse spread; the point
  // stays whole, it is just shared across the named stats.
  for (const [id, { usd, god }] of perCause) {
    const c = /** @type {Cause} */ (causeById.get(id));
    const rate = c.pointRate === undefined ? 1.0 : c.pointRate; // points per $1 (default 1.0)
    const points = usd * rate;                                   // total stat points BEFORE split
    const weights = splitWeights(c.stat, c.id);
    for (const [s, w] of Object.entries(weights)) {
      raw[s] += points * w;                                      // distribute by single/split weights
      if (god) caps[s] = GOD_CAP; // a god cause lifts the cap on every stat it feeds
    }
  }

  // CON DRIVES HP (D&D-style; "CON is always good because it's HP"):
  //   HP = BASE_HP + (CON - BASE_STAT)  → every point of CON above 10 adds +1 HP
  //   (CON 20 → +10 HP; CON 30 → +20 HP). Uses the CAPPED CON value.
  // This makes any CON-granting cause (CHAR, BURGERS) raise survivability for ANY build.
  /** @type {Record<Stat, number>} */
  const stats = /** @type {any} */ ({});
  for (const s of STATS) {
    stats[s] = Math.min(raw[s], caps[s]);
  }
  const hp = BASE_HP + Math.max(0, Math.round(stats.CON - BASE_STAT));

  return { hp, stats, raw, caps };
}

/**
 * Weight-class bracket by TOTAL level. Brackets from the design:
 *   1-2 / 3-5 / 6-10 / 11-20 (and an overflow 21+ for god-cap play).
 *
 * @param {number} totalLevel
 * @returns {{ id: string, label: string, min: number, max: number }}
 */
export function weightBracket(totalLevel) {
  const brackets = [
    { id: "feather", label: "1–2",   min: 1,  max: 2 },
    { id: "light",   label: "3–5",   min: 3,  max: 5 },
    { id: "middle",  label: "6–10",  min: 6,  max: 10 },
    { id: "heavy",   label: "11–20", min: 11, max: 20 },
    { id: "god",     label: "21–30", min: 21, max: 30 },
  ];
  for (const b of brackets) {
    if (totalLevel >= b.min && totalLevel <= b.max) return b;
  }
  if (totalLevel <= 0) return { id: "unranked", label: "0", min: 0, max: 0 };
  return brackets[brackets.length - 1]; // clamp above 30 into god bracket
}

/**
 * The combined share held by a class's requiredCauses, and the per-cause levels.
 *
 * @param {ClassDef} klass
 * @param {ReturnType<typeof computeLevels>} levels
 */
function classCauseStats(klass, levels) {
  const byId = new Map(levels.perCause.map((p) => [p.id, p]));
  let combinedShare = 0;
  let classLevel = 0;
  const missing = [];
  for (const cid of klass.requiredCauses || []) {
    const p = byId.get(cid);
    if (!p || p.level <= 0) { missing.push(cid); continue; }
    combinedShare += p.share;
    classLevel += p.level; // class-level = total $ across the class's required causes
  }
  return { combinedShare, classLevel, missing };
}

/**
 * Does the wallet hold this class's RATIO gate within its strictness band?
 * Above-threshold always qualifies; the band only matters as an UPPER tolerance for
 * how far ABOVE threshold a loose class may sit — but the real drift lever is that
 * diluting BELOW (threshold) drops it, and strict classes set a HIGH threshold so any
 * dilution slips under. We also enforce: every required cause must be present (>0).
 *
 * @param {ClassDef} klass
 * @param {{ combinedShare: number, missing: string[] }} cs
 */
function ratioGateMet(klass, cs) {
  if (cs.missing.length > 0) return false;
  // Core rule: combined share of required causes must meet/exceed the threshold.
  // Strictness sets HOW the threshold is enforced under dilution:
  //  - loose:  share >= threshold (forgiving on-ramp)
  //  - medium: share >= threshold, and must be the band away from collapse
  //  - strict: share >= threshold exactly; threshold itself is set high in config
  // The band is exposed so the UI can show "how close to drifting out" you are.
  return cs.combinedShare + 1e-9 >= klass.ratioThreshold;
}

/**
 * Distance (in ratio points) the wallet currently sits from drifting out of a class.
 * Positive = safe margin above threshold; <= 0 = does not qualify. The strictness
 * band is what a UI uses to color "danger" (within band of the edge).
 */
export function driftMargin(klass, cs) {
  return cs.combinedShare - klass.ratioThreshold;
}

/**
 * Resolve EVERYTHING for a wallet. Single entry point; pure & deterministic.
 *
 * @param {EndowmentMap} endowment
 * @param {EngineConfig} config
 * @param {{ validate?: boolean }} [opts]
 */
export function resolve(endowment, config, opts = {}) {
  if (opts.validate !== false) validateConfig(config);
  const { causes, classes } = config;

  const levels = computeLevels(endowment, causes);
  const statBlock = computeStats(endowment, causes);
  const bracket = weightBracket(levels.totalLevel);

  // Does any single cause dominate? (Used by the balance Fighter.)
  const topShare = levels.perCause.length ? levels.perCause[0].share : 0;

  // First pass: ratio + balance gates (no prereqs yet). GATED on the LEVEL-5 FLOOR (founder 2026-06-28:
  // "level 5 is the 1st class level") — below TOTAL level 5 a pawn is base/unclassed; no class qualifies.
  /** @type {Map<string, { klass: ClassDef, classLevel: number, combinedShare: number, drift: number }>} */
  const ratioQualified = new Map();
  const FIRST_CLASS_LEVEL = 5;
  if (levels.totalLevel + 1e-9 >= FIRST_CLASS_LEVEL) for (const klass of classes) {
    if (klass.balanceClass) {
      // Fighter is open only while DIFFUSE — no cause dominates past the diffuseMax.
      // diffuseMax derived from threshold: default 1/ (families) ≈ spread; we use 0.34
      // (no cause may hold a third or more). Designer can override via ratioThreshold
      // as the "max dominant share" for balance classes.
      const diffuseMax = klass.ratioThreshold > 0 ? klass.ratioThreshold : 0.34;
      const open = levels.totalLevel > 0 && topShare <= diffuseMax + 1e-9;
      if (open) {
        ratioQualified.set(klass.id, { klass, classLevel: levels.totalLevel, combinedShare: 1 - topShare, drift: diffuseMax - topShare });
      }
      continue;
    }
    const cs = classCauseStats(klass, levels);
    if (ratioGateMet(klass, cs)) {
      ratioQualified.set(klass.id, { klass, classLevel: cs.classLevel, combinedShare: cs.combinedShare, drift: driftMargin(klass, cs) });
    }
  }

  // Second pass: prereq gate. A prereq is met only if the prereq class is itself
  // ratio-qualified AND its class-level >= required level. Iterate to a fixpoint so
  // chained prereqs (combo → exotic) resolve in one resolve() call.
  const prereqMet = (klass, qualifiedSet) => {
    for (const p of klass.prereqs || []) {
      const q = ratioQualified.get(p.classId);
      if (!q) return false;
      if (!qualifiedSet.has(p.classId)) return false;
      if (q.classLevel < p.level) return false;
    }
    return true;
  };

  let qualifiedSet = new Set(ratioQualified.keys());
  // Fixpoint: drop any class whose prereqs aren't (transitively) satisfied.
  for (let iter = 0; iter < classes.length + 1; iter++) {
    let changed = false;
    for (const id of [...qualifiedSet]) {
      const q = /** @type {any} */ (ratioQualified.get(id));
      if (!prereqMet(q.klass, qualifiedSet)) {
        qualifiedSet.delete(id);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Build the qualified class report with available abilities/spells by class-level.
  const qualified = [...qualifiedSet]
    .map((id) => /** @type {any} */ (ratioQualified.get(id)))
    .map(({ klass, classLevel, combinedShare, drift }) => {
      const primaryScore = statBlock.stats[klass.primaryStat];
      const available = (klass.abilities || [])
        .filter((a) => classLevel >= a.minClassLevel)
        .map((a) => ({ ...a }));
      const locked = (klass.abilities || [])
        .filter((a) => classLevel < a.minClassLevel)
        .map((a) => ({ id: a.id, name: a.name, unlocksAtLevel: a.minClassLevel }));
      return {
        id: klass.id,
        name: klass.name,
        family: klass.family,
        tier: klass.tier,
        primaryStat: klass.primaryStat,
        secondaryStat: klass.secondaryStat,
        classLevel,
        combinedShare,
        driftMargin: drift,
        strictnessBand: STRICTNESS[klass.strictness].bandWidth,
        spellPower: primaryScore,
        saveDC: saveDC(primaryScore),
        availableAbilities: available,
        lockedAbilities: locked,
      };
    })
    .sort((a, b) => b.tier - a.tier || b.classLevel - a.classLevel || a.id.localeCompare(b.id));

  // Loadout options: which qualified classes can be set ACTIVE. Action-economy bound —
  // the engine reports the menu + a default; the designer/UI picks the cap. Default cap
  // grows with bracket (more seasoned wallets juggle more, FFT main+sub style).
  const loadoutCap = bracket.id === "feather" ? 1
    : bracket.id === "light" ? 1
    : bracket.id === "middle" ? 2
    : 3; // heavy / god
  const loadoutOptions = {
    cap: loadoutCap,
    candidates: qualified.map((q) => ({ id: q.id, name: q.name, tier: q.tier })),
    // A simple deterministic default loadout: highest-tier, highest-level first.
    suggested: qualified.slice(0, loadoutCap).map((q) => q.id),
  };

  return {
    totalLevel: levels.totalLevel,
    diffuseLevel: levels.diffuseLevel,
    bracket,
    hp: statBlock.hp,
    stats: statBlock.stats,
    statCaps: statBlock.caps,
    perCause: levels.perCause,
    topShare,
    qualified,
    loadoutOptions,
  };
}
