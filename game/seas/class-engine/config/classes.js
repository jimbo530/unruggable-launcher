// @ts-check
/**
 * config/classes.js — REAL v1 CLASS ROSTER (launch base). Designer may still edit.
 *
 * All Tier-0, single-cause, loose-ish strictness. cause → class is 1:1:
 *   Burgers  → Barbarian   (STR/CON)
 *   TGN      → Shepherd     (WIS/CHA)
 *   EGP      → Spellblade   (DEX/INT)
 *   bluechip → Generalist   (balanced-but-earned)
 *   (balance) Fighter        opens only while diffuse/balanced
 *
 * Every class is pure config. Abilities carry minClassLevel tiers so spell/ability
 * gating by class-level (= $ in the cause) is demonstrable. To author a new class,
 * append an object — no engine code changes.
 *
 * @typedef {import("../schema.js").ClassDef} ClassDef
 */

/** @type {ClassDef[]} */
export const CLASSES = [
  // ── Burgers → Barbarian (STR/CON brute) ───────────────────────────────────
  {
    id: "barbarian",
    name: "Barbarian",
    family: "Melee-DPS",
    primaryStat: "CON",
    secondaryStat: "STR",
    requiredCauses: ["burgers"],
    ratioThreshold: 0.30,            // 30% of endowment in Burgers unlocks the lane
    strictness: "loose",             // base on-ramp
    prereqs: [],
    tier: 0,
    abilities: [
      { id: "rage",           name: "Rage",           minClassLevel: 1,  kind: "ability", note: "self buff" },
      { id: "reckless_strike",name: "Reckless Strike",minClassLevel: 5,  kind: "ability" },
      { id: "brutal_slam",    name: "Brutal Slam",    minClassLevel: 10, kind: "ability", note: "AoE knockdown" },
    ],
    note: "v1 — frontline brute.",
  },

  // ── TGN → Shepherd (WIS/CHA grove orator) ─────────────────────────────────
  {
    id: "shepherd",
    name: "Shepherd",
    family: "Nature",
    primaryStat: "CHA",
    secondaryStat: "WIS",
    requiredCauses: ["tgn"],
    ratioThreshold: 0.30,
    strictness: "loose",
    prereqs: [],
    tier: 0,
    abilities: [
      { id: "rally",        name: "Rally",         minClassLevel: 1,  kind: "ability", note: "party buff" },
      { id: "healing_word", name: "Healing Word",  minClassLevel: 1,  kind: "spell" },
      { id: "thornbloom",   name: "Thornbloom",    minClassLevel: 6,  kind: "spell",   note: "nature control" },
      { id: "inspire",      name: "Inspire",       minClassLevel: 10, kind: "ability" },
    ],
    note: "v1 — Grove orator / support.",
  },

  // ── EGP → Spellblade (DEX/INT elven arcane-trickster) ─────────────────────
  {
    id: "spellblade",
    name: "Spellblade",
    family: "Gish",
    primaryStat: "DEX",
    secondaryStat: "INT",
    requiredCauses: ["egp"],
    ratioThreshold: 0.30,
    strictness: "loose",
    prereqs: [],
    tier: 0,
    abilities: [
      { id: "arcane_strike", name: "Arcane Strike", minClassLevel: 1, kind: "ability", note: "gish melee+magic" },
      { id: "shadowstep",    name: "Shadowstep",    minClassLevel: 4, kind: "ability", note: "mobility" },
      { id: "hex",           name: "Hex",           minClassLevel: 8, kind: "spell",   note: "debuff" },
    ],
    note: "v1 — elven spellblade / arcane trickster.",
  },

  // ── CHAR → Warden (WIS/CON durable nature guardian, forgone-airdrop burn cause) ──
  {
    id: "warden",
    name: "Warden",
    family: "Nature",
    primaryStat: "WIS",              // spell power off WIS; CON gives the tanky body (HP)
    secondaryStat: "CON",
    requiredCauses: ["char"],
    ratioThreshold: 0.30,
    strictness: "loose",
    prereqs: [],
    tier: 0,
    abilities: [
      { id: "bark_skin",  name: "Bark Skin",  minClassLevel: 1,  kind: "ability", note: "defense" },
      { id: "earth_heal", name: "Earth Heal", minClassLevel: 3,  kind: "spell" },
      { id: "root_snare", name: "Root Snare", minClassLevel: 6,  kind: "spell",   note: "control" },
      { id: "thorn_guard",name: "Thorn Guard",minClassLevel: 10, kind: "ability", note: "reflect" },
    ],
    note: "v1 — durable WIS/CON nature guardian; gated by CHAR (forgone-airdrop burn cause).",
  },

  // ── PUMP → Wizard (pure INT nuker; glass cannon — no CON, base HP) ────────
  {
    id: "wizard",
    name: "Wizard",
    family: "Arcane",
    primaryStat: "INT",              // pure-INT blaster; NO CON → squishy (base HP)
    requiredCauses: ["pump"],
    ratioThreshold: 0.30,
    strictness: "loose",
    prereqs: [],
    tier: 0,
    abilities: [
      { id: "solar_bolt",  name: "Solar Bolt",  minClassLevel: 1,  kind: "spell",   note: "nuke" },
      { id: "overload",    name: "Overload",    minClassLevel: 4,  kind: "ability" },
      { id: "arc_lance",   name: "Arc Lance",   minClassLevel: 8,  kind: "spell" },
      { id: "arcane_ward", name: "Arcane Ward", minClassLevel: 12, kind: "ability", note: "defense" },
    ],
    note: "v1 — pure-INT Wizard; high spell DC but base HP (glass cannon). Splash CON to survive.",
  },

  // ── bluechip → Generalist (balanced-but-earned) ───────────────────────────
  {
    id: "generalist",
    name: "Generalist",
    family: "Generalist",
    primaryStat: "CON",              // jack-of-all; CON anchors a steady body
    requiredCauses: ["bluechip"],
    ratioThreshold: 0.30,            // earned bluechip must be a real share to qualify
    strictness: "medium",
    prereqs: [],
    tier: 0,
    abilities: [
      { id: "adapt",      name: "Adapt",       minClassLevel: 1, kind: "ability", note: "swap a small bonus stat" },
      { id: "steady",     name: "Steady",      minClassLevel: 3, kind: "ability" },
      { id: "jack_skill", name: "Jack of All", minClassLevel: 8, kind: "ability" },
    ],
    note: "v1 — earned generalist; simple, flexible kit.",
  },

  // ── Fighter (BALANCE class) — opens only while diffuse/balanced ────────────
  {
    id: "fighter",
    name: "Fighter (Balance)",
    family: "Generalist",
    primaryStat: "STR",
    // BALANCE: no requiredCause. Opens when the wallet is DIFFUSE/BALANCED —
    // no single cause dominates past `ratioThreshold` (the max-dominant-share for
    // balance classes). Concentrate, and the Fighter CLOSES.
    requiredCauses: [],
    balanceClass: true,
    ratioThreshold: 0.34,            // no cause may hold a third or more
    strictness: "loose",
    prereqs: [],
    tier: 0,
    abilities: [
      { id: "second_wind", name: "Second Wind", minClassLevel: 1, kind: "ability" },
      { id: "power_attack",name: "Power Attack",minClassLevel: 3, kind: "ability" },
      { id: "guard",       name: "Guard",       minClassLevel: 5, kind: "ability" },
    ],
    note: "v1 — the BALANCE class; open only while diffuse, closes when concentrated.",
  },
];
