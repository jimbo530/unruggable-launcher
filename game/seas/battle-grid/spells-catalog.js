// @ts-check
/**
 * spells-catalog.js — broad D&D 3.5 SRD spell catalog in the EXACT `SPELLS`
 * battle-format consumed by tot-engine.js `resolveSpellCast`. ADDITIVE ONLY:
 * this file does NOT edit the engine. Merge it into the live registry with:
 *
 *     import { SPELLS } from "./units.js";          // re-exports tot-engine SPELLS
 *     import { SPELL_CATALOG } from "./spells-catalog.js";
 *     Object.assign(SPELLS, SPELL_CATALOG);         // idempotent superset
 *
 * The three spells already in tot-engine.js (magic_missile, burning_hands,
 * ray_of_frost) are reproduced VERBATIM here so the merge is a strict, idempotent
 * superset (same ids → identical data).
 *
 * ── FORMAT (must match tot-engine.js SPELLS, unchanged) ──────────────────────
 *   { id, name, level, battle: {
 *       type:        "damage" | "healing" | "buff"  (+ pending types below),
 *       hexRange:    int  (cast range in hexes; beginSpell() targets within this),
 *       hexArea?:    int  (radius in hexes — see AoE caveat),
 *       damage?:     "XdY" | "XdY+Z" | "XdY/level"  (rollDice; /level ×dice, cap 10),
 *       damageType?: flavor string ("fire", "cold", "force", ...),
 *       healing?:    "XdY+Z"  (rollDice; do NOT use /level — see healing note),
 *       save?:       "fort" | "ref" | "will"  (target d20 + ability mod vs DC;
 *                    DC = 10 + level + caster.castingAbilityMod; save HALVES damage),
 *       buffAC?, buffAtk?, buffDmg?, buffSave?, buffSpeed?: int,
 *       durationRounds?: int  (-1 = whole combat; game.js ticks these down 567-570),
 *   } }
 *
 * ── TUNING (deck band: pawns ~10-20 HP, AC ~10-12) ───────────────────────────
 *   • `/level` damage spells are kept at SRD dice because casterLevel is bracket-
 *     capped 1-5 in units.js (feather1…god5), so e.g. fireball = 1d6…5d6 — already
 *     band-safe and self-limiting. The engine also caps /level at 10 dice.
 *   • FLAT-dice damage spells (no /level) DON'T self-limit, so a few are trimmed
 *     from raw SRD to the band (scorching ray 4d6→2d6, ice storm 5d6→3d6). Each
 *     trim is noted on its entry.
 *   • Cure spells use FLAT XdY+Z (NOT /level): the engine's /level multiplies the
 *     DICE COUNT, which would turn "1d8+level" into "Ld8" and over-heal wildly.
 *     Flat values approximate SRD "1d8 + caster level (capped)" inside the band.
 *
 * ── ENGINE-CONSUMES-IT-UNCHANGED, but DRIVER (game.js) wiring still pending ───
 *   resolveSpellCast() already returns correct results for damage/healing/buff.
 *   The pieces game.js does NOT yet apply are listed in this PR's needsEngineWiring
 *   (AoE splash, healing application + friendly targeting, buff application,
 *   buffSpeed movement, and the three pending control/dispel/utility types).
 *   Spells whose type is NOT damage/healing/buff (light/daze/dispel_magic) are
 *   SAFE to merge today — the engine simply no-ops them ("no battle effect") until
 *   their effect type is wired; they are included so the data is READY.
 *
 * SRD source: d20 SRD (System Reference Document 3.5), spell descriptions.
 */

export const SPELL_CATALOG = {
  // ══ LEVEL 0 — Cantrips / Orisons ═══════════════════════════════════════════
  ray_of_frost: {
    // SRD Lvl 0 Evocation [Cold]. Ranged touch, 1d3 cold. (VERBATIM from engine.)
    id: "ray_of_frost", name: "Ray of Frost", level: 0,
    battle: { type: "damage", hexRange: 3, damage: "1d3", damageType: "cold" }, // cantrip, no save
  },
  acid_splash: {
    // SRD Lvl 0 Conjuration [Acid]. Ranged touch orb, 1d3 acid, range 25ft+.
    id: "acid_splash", name: "Acid Splash", level: 0,
    battle: { type: "damage", hexRange: 5, damage: "1d3", damageType: "acid" }, // ranged touch, no save
  },
  resistance: {
    // SRD Lvl 0 Abjuration. +1 resistance bonus on saving throws, 1 min.
    // Engine reads sumEffects(target,"buffSave") in the save path → works once
    // buff application + friendly targeting are wired.
    id: "resistance", name: "Resistance", level: 0,
    battle: { type: "buff", hexRange: 1, buffSave: 1, durationRounds: 10 },
  },
  light: {
    // SRD Lvl 0 Evocation [Light]. Illuminates like a torch, no combat effect.
    // PENDING TYPE "utility": engine no-ops it until vision/concealment rules exist.
    id: "light", name: "Light", level: 0,
    battle: { type: "utility", hexRange: 1, durationRounds: 10 }, // illumination only — needs vision wiring
  },
  daze: {
    // SRD Lvl 0 Enchantment [Mind-Affecting]. Will negates; a creature of 4 HD or
    // fewer takes no action for 1 round. PENDING TYPE "control" (lose-a-turn /
    // stun) — engine has no skip-action mechanic, so it no-ops until wired.
    id: "daze", name: "Daze", level: 0,
    battle: { type: "control", hexRange: 5, save: "will", durationRounds: 1 }, // skip target's next action — needs stun wiring
  },

  // ══ LEVEL 1 ════════════════════════════════════════════════════════════════
  magic_missile: {
    // SRD Lvl 1 Evocation [Force]. Auto-hit, no attack roll, no save. (VERBATIM.)
    id: "magic_missile", name: "Magic Missile", level: 1,
    battle: { type: "damage", hexRange: 5, damage: "1d4+1", damageType: "force" }, // no save
  },
  burning_hands: {
    // SRD Lvl 1 Evocation [Fire]. 15ft cone, 1d4/level (max 5d6 in SRD), Ref half.
    // (VERBATIM from engine; hexArea splash pending — see AoE wiring.)
    id: "burning_hands", name: "Burning Hands", level: 1,
    battle: { type: "damage", hexRange: 2, hexArea: 1, damage: "1d4/level", damageType: "fire", save: "ref" },
  },
  shocking_grasp: {
    // SRD Lvl 1 Evocation [Electricity]. Touch, 1d6/level (max 5d6).
    id: "shocking_grasp", name: "Shocking Grasp", level: 1,
    battle: { type: "damage", hexRange: 1, damage: "1d6/level", damageType: "electricity" }, // touch, no save
  },
  shield: {
    // SRD Lvl 1 Abjuration [Force]. +4 shield bonus to AC (and blocks magic
    // missile, not modeled). Self, 1 min/level.
    id: "shield", name: "Shield", level: 1,
    battle: { type: "buff", hexRange: 1, buffAC: 4, durationRounds: 5 },
  },
  cure_light_wounds: {
    // SRD Lvl 1 Conjuration [Healing]. Cures 1d8 + caster level (max +5). Flat
    // band-tuned approximation (NOT /level — see healing note in header).
    id: "cure_light_wounds", name: "Cure Light Wounds", level: 1,
    battle: { type: "healing", hexRange: 1, healing: "1d8+1" },
  },
  bless: {
    // SRD Lvl 1 Enchantment. Allies get +1 morale on attack rolls (and saves vs
    // fear, not separately modeled). Burst centered on caster.
    id: "bless", name: "Bless", level: 1,
    battle: { type: "buff", hexRange: 5, buffAtk: 1, durationRounds: 10 },
  },

  // ══ LEVEL 2 ════════════════════════════════════════════════════════════════
  scorching_ray: {
    // SRD Lvl 2 Evocation [Fire]. Ranged touch ray(s), SRD 4d6/ray, no save.
    // TRIMMED 4d6→2d6 for the deck band (flat dice don't self-limit).
    id: "scorching_ray", name: "Scorching Ray", level: 2,
    battle: { type: "damage", hexRange: 6, damage: "2d6", damageType: "fire" }, // no save (ranged touch)
  },
  bulls_strength: {
    // SRD Lvl 2 Transmutation. +4 enhancement to STR → +2 melee attack & +2 melee
    // damage. Touch.
    id: "bulls_strength", name: "Bull's Strength", level: 2,
    battle: { type: "buff", hexRange: 1, buffAtk: 2, buffDmg: 2, durationRounds: 10 },
  },
  mirror_image: {
    // SRD Lvl 2 Illusion. 1d4+ decoy images absorb attacks; abstracted here as a
    // defensive AC bonus. Self.
    id: "mirror_image", name: "Mirror Image", level: 2,
    battle: { type: "buff", hexRange: 1, buffAC: 4, durationRounds: 10 }, // decoys → AC abstraction
  },
  cure_moderate_wounds: {
    // SRD Lvl 2 Conjuration [Healing]. Cures 2d8 + caster level (max +10). Flat
    // band-tuned approximation.
    id: "cure_moderate_wounds", name: "Cure Moderate Wounds", level: 2,
    battle: { type: "healing", hexRange: 1, healing: "2d8+3" },
  },

  // ══ LEVEL 3 ════════════════════════════════════════════════════════════════
  fireball: {
    // SRD Lvl 3 Evocation [Fire]. 20ft-radius burst, 1d6/level (max 10d6), Ref half.
    // hexArea radius ≈ 2 hexes; AoE splash pending (engine resolves one target now).
    id: "fireball", name: "Fireball", level: 3,
    battle: { type: "damage", hexRange: 6, hexArea: 2, damage: "1d6/level", damageType: "fire", save: "ref" },
  },
  lightning_bolt: {
    // SRD Lvl 3 Evocation [Electricity]. 120ft LINE, 1d6/level (max 10d6), Ref half.
    // Engine has no line shape — approximated as small radius; line AoE pending.
    id: "lightning_bolt", name: "Lightning Bolt", level: 3,
    battle: { type: "damage", hexRange: 6, hexArea: 1, damage: "1d6/level", damageType: "electricity", save: "ref" }, // SRD line; shape pending
  },
  haste: {
    // SRD Lvl 3 Transmutation. +30ft speed, +1 attack, +1 dodge AC, +1 Reflex.
    // buffSpeed (+3 hexes) is INERT until movement reads it — see buffSpeed wiring.
    id: "haste", name: "Haste", level: 3,
    battle: { type: "buff", hexRange: 5, buffSpeed: 3, buffAtk: 1, buffAC: 1, durationRounds: 5 },
  },
  dispel_magic: {
    // SRD Lvl 3 Abjuration. Strips/ends active spell effects on a target. PENDING
    // TYPE "dispel" (remove activeEffects) — engine no-ops until wired.
    id: "dispel_magic", name: "Dispel Magic", level: 3,
    battle: { type: "dispel", hexRange: 5 }, // remove target's active effects — needs dispel wiring
  },

  // ══ LEVEL 4 ════════════════════════════════════════════════════════════════
  ice_storm: {
    // SRD Lvl 4 Evocation [Cold]. 20ft-radius cylinder, SRD 3d6 bludgeon + 2d6 cold,
    // no save. TRIMMED to 3d6 cold flat for the band; hexArea splash pending.
    id: "ice_storm", name: "Ice Storm", level: 4,
    battle: { type: "damage", hexRange: 6, hexArea: 2, damage: "3d6", damageType: "cold" }, // no save
  },
  cure_serious_wounds: {
    // SRD Cleric 3 Conjuration [Healing]; placed at L4 per this catalog's
    // progression (higher slot → higher DC). Cures 3d8 + level (max +15). Flat.
    id: "cure_serious_wounds", name: "Cure Serious Wounds", level: 4,
    battle: { type: "healing", hexRange: 1, healing: "3d8+5" },
  },
  stoneskin: {
    // SRD Lvl 4 Abjuration. DR 10/adamantine. Engine has no damage reduction;
    // abstracted as a defensive AC bonus (harder to meaningfully hit). Touch.
    id: "stoneskin", name: "Stoneskin", level: 4,
    battle: { type: "buff", hexRange: 1, buffAC: 3, durationRounds: 10 }, // DR abstraction → AC
  },

  // ══ LEVEL 5 ════════════════════════════════════════════════════════════════
  cone_of_cold: {
    // SRD Lvl 5 Evocation [Cold]. 60ft CONE, 1d6/level (SRD max 15d6; engine caps
    // /level at 10d6), Ref half. Cone approximated as a short-range radius burst.
    id: "cone_of_cold", name: "Cone of Cold", level: 5,
    battle: { type: "damage", hexRange: 2, hexArea: 2, damage: "1d6/level", damageType: "cold", save: "ref" }, // SRD cone; shape pending
  },
  flame_strike: {
    // SRD Lvl 5 Evocation [Fire]. 10ft-radius column, 1d6/level (SRD max 15d6;
    // engine caps 10d6), Ref half. Half fire/half divine (single type here).
    id: "flame_strike", name: "Flame Strike", level: 5,
    battle: { type: "damage", hexRange: 5, hexArea: 1, damage: "1d6/level", damageType: "fire", save: "ref" },
  },
  heal: {
    // SRD Cleric 6 Conjuration [Healing]; placed at L5 here as the catalog's
    // capstone heal. SRD restores 10/level (effectively full). Flat big heal,
    // band-tuned to top up a 10-20 HP pawn.
    id: "heal", name: "Heal", level: 5,
    battle: { type: "healing", hexRange: 1, healing: "5d8+10" },
  },
};
