// @ts-check
/**
 * gear-ext.js — SEIZE THE SEAS gear EXPANSION (pure DATA + pure helpers).
 *
 * ADDITIVE to gear-data.js (which stays the authentic D&D 3.5 armory — DO NOT edit it).
 * This file proposes MORE slots, ability-score gear, a dice-damage upgrade, rarity +
 * rolled affixes, set bonuses, and consumables/throwables. It imports NOTHING from the
 * core engine (no circular imports); everything here is data the engine OPTS IN to.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ EXACT WIRING CHANGES TO TURN THIS DATA ON (none are done here — see            │
 * │ needsEngineWiring in the task return). Each is small + additive:               │
 * ├──────────────────────────────────────────────────────────────────────────────┤
 * │ items.js                                                                       │
 * │  1. import { GEAR_EXT } from "./gear-ext.js";                                   │
 * │  2. export const SLOTS = GEAR_EXT.SLOTS;   // [weapon,offhand,armor,helm,boots, │
 * │                                            //  ring,trinket]  (was 3 slots)     │
 * │  3. after `export const ITEMS = buildArmory();`:                               │
 * │        Object.assign(ITEMS, GEAR_EXT.ITEMS);   // equip + show new gear         │
 * │     (CONSUMABLES are NOT merged into ITEMS — they're used, not worn; expose     │
 * │      them via a separate bag/use action, see game.js note 4.)                   │
 * │  4. applyEquipment(u) must LEARN the ability keys + RECOMPUTE derived stats.    │
 * │     Replace the body's flat-sum loop with the two-pass version below            │
 * │     (sums flat mods AND ability deltas, then rebuilds derived fields the SAME   │
 * │      way units.js buildUnit() did, so a +2 STR ring really raises to-hit/dmg):  │
 * │                                                                                │
 * │        const mod = (raw) => Math.floor(Math.max(0, raw) / 2);  // == tot abilityMod
 * │        const ra = { ...u.baseRawAbilities };                   // see units.js note 1
 * │        const flat = { attack:0, atkBonus:0, ac:0, maxHp:0, attackRange:0,       │
 * │                       movementHexes:0, castingMod:0 };                          │
 * │        for (const slot of SLOTS) {                                              │
 * │          const id = u.equipped[slot]; if (!id) continue;                        │
 * │          const m = ITEMS[id].mods || {};                                        │
 * │          for (const k in flat) if (m[k]) flat[k] += m[k];                       │
 * │          for (const a of ["str","dex","con","int","wis","cha"])                 │
 * │            if (m[a]) ra[a] += m[a];          // ABILITY gear shifts the score   │
 * │        }                                                                        │
 * │        const setb = GEAR_EXT.setBonusFor(SLOTS.map(s => u.equipped[s]));         │
 * │        for (const k in flat) if (setb.mods[k]) flat[k] += setb.mods[k];          │
 * │        for (const a of ["str","dex","con","int","wis","cha"])                   │
 * │          if (setb.mods[a]) ra[a] += setb.mods[a];                               │
 * │        const isCaster = u.role === "caster", lvl = u.casterLevel || 1;          │
 * │        const strMod=mod(ra.str), dexMod=mod(ra.dex), intMod=mod(ra.int),        │
 * │              conMod=mod(ra.con), baseConMod=mod(u.baseRawAbilities.con);         │
 * │        u.rawAbilities = ra;                  // saves/spell-saves read this      │
 * │        const s = { ...u.baseStats };                                            │
 * │        s.attack   = (isCaster ? Math.max(1,1+intMod) : Math.max(1,4+strMod)) + flat.attack;
 * │        s.ac       = 10 + dexMod + flat.ac;                                       │
 * │        s.atkBonus = (isCaster ? intMod : strMod) + Math.min(3, lvl) + flat.atkBonus;
 * │        const castingMod = intMod + flat.castingMod;                              │
 * │        let maxHp   = u.baseMaxHp + (conMod - baseConMod) * lvl + flat.maxHp;      │
 * │        const speed = Math.max(15, 25 + dexMod*5);                                │
 * │        // …then the existing tail (wasFull/currentHp clamp, u.stats=s,           │
 * │        //   u.maxHp=maxHp, u.attackRange = u.baseAttackRange + flat.attackRange,  │
 * │        //   u.movementHexes = Math.max(2,Math.floor(speed/5)) + flat.movementHexes,
 * │        //   u.castingAbilityMod = castingMod, u.spellDC = 8 + castingMod).        │
 * │                                                                                │
 * │ units.js  buildUnit()                                                           │
 * │  1. store a BASE copy of the abilities so applyEquipment can recompute from a    │
 * │     clean baseline:  baseRawAbilities: { ...rawAbilities },                      │
 * │  2. seed ALL slots:  equipped: { weapon:null, offhand:null, armor:null,          │
 * │       helm:null, boots:null, ring:null, trinket:null },                          │
 * │  3. the two ["weapon","armor","trinket"] pre-equip loops (makeStarterUnits +     │
 * │     buildOpponentUnit) → iterate SLOTS (or GEAR_EXT.SLOTS) instead.              │
 * │                                                                                │
 * │ tot-engine.js  resolveAttack()  (DICE-DAMAGE upgrade — optional, gated)         │
 * │  • Today: `damage = attacker.stats.attack` (flat). To roll weapon dice, pass the │
 * │    equipped weapon id in and, when set, use:                                     │
 * │       const expr = GEAR_EXT.weaponDamageExpr(weaponId);   // e.g. "1d8"           │
 * │       let damage = expr ? rollDice(expr).total + abilityMod(attacker.rawAbilities.str)
 * │                         : attacker.stats.attack;          // flat fallback        │
 * │    crit (nat 20) still ×2 the result. Cone/AoE weapons (blunderbuss) carry        │
 * │    { area } in WEAPON_DICE → resolve like burning_hands (hexArea around target).  │
 * │                                                                                │
 * │ game.js  (CONSUMABLES / throwables)                                              │
 * │  • Add a "Use Item" action that reads GEAR_EXT.CONSUMABLES[id].use and routes it  │
 * │    through the EXISTING effect paths: kind "healing"→heal like a healing spell;   │
 * │    "damage"→resolveSpellCast-style roll vs hexArea; "control"/"hazard"→push an    │
 * │    activeEffects entry (buffSpeed:-… / debuffAtk) with durationRounds;            │
 * │    "reposition"→move the target along the hex line (reuse the movement helper).   │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * EXACT NEW ITEMS (ids shipped in GEAR_EXT.ITEMS), grouped by slot:
 *   weapon (pirate / firearms): cutlass, boarding-axe, flintlock-pistol, blunderbuss, musket
 *   offhand: iron-buckler, parrying-dagger, targe-shield, boarding-shield, kraken-buckler
 *   helm:    iron-helm, captains-tricorne, diving-helm, headband-intellect,
 *            headband-vast-intellect, mask-of-insight
 *   boots:   sea-boots, boots-of-striding, boots-of-agility, tide-walkers
 *   ring:    ring-of-protection, ring-of-warding, ring-of-the-bear, ring-of-the-owl,
 *            ring-of-the-ram, navigators-signet
 *   trinket: gauntlets-ogre-power, belt-giant-strength, amulet-of-health,
 *            cloak-of-charisma, sirens-pearl
 *   CONSUMABLES (not worn): grog, powder-bomb, throwing-net, caltrops, grappling-hook,
 *            smoke-bomb, thunderstone
 *
 * THEME: pirate ship-deck. Ability-score gear is authentic SRD "stat item" lineage
 * (Headband of Intellect, Gauntlets of Ogre Power, Amulet of Health, …). Firearms use
 * the DMG Renaissance-firearm option (flagged HOUSERULE — not in the core 3.5 weapon
 * table). Every entry is commented with its // SRD source.
 */

// ── 1) SLOTS (proposed) ─────────────────────────────────────────────────────────
// Grows the 3-slot prototype to a 7-slot paper doll. `helm` + `offhand` are split out
// of the base armory (which kept Helm + Shield inside the single `armor` slot); `boots`
// + `ring` are brand-new. The ORDER is the render/equip order game.js will use.
export const SLOTS = ["weapon", "offhand", "armor", "helm", "boots", "ring", "trinket"];

// ── 2) RARITY TIERS ─────────────────────────────────────────────────────────────
// color = UI chip; affixes = how many rolled affixes a dropped item of this tier gets;
// powerMul = soft budget hint for hand-placed mods; dropWeight = relative roll weight.
export const RARITIES = {
  common:    { id: "common",    label: "Common",    color: "#9aa0a6", affixes: 0, powerMul: 1.0, dropWeight: 50 },
  uncommon:  { id: "uncommon",  label: "Uncommon",  color: "#37b24d", affixes: 1, powerMul: 1.25, dropWeight: 30 },
  rare:      { id: "rare",      label: "Rare",      color: "#1c7ed6", affixes: 2, powerMul: 1.6, dropWeight: 14 },
  epic:      { id: "epic",      label: "Epic",      color: "#9c36b5", affixes: 3, powerMul: 2.0, dropWeight: 5 },
  legendary: { id: "legendary", label: "Legendary", color: "#f08c00", affixes: 4, powerMul: 2.6, dropWeight: 1 },
};
const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"];

// ── 3) WEAPON-DICE TABLE (dice-damage upgrade) ──────────────────────────────────
// Maps a weapon BASE type (the gear-data key, before its -iron/-bronze material suffix)
// to its authentic D&D 3.5 SRD Medium damage die. resolveAttack can roll this instead of
// the flat `stats.attack`. crit = field; reach/area are extra resolver hints.
// HOUSERULE entries (no core-3.5 die) are flagged — keep them tagged so we don't pretend.
export const WEAPON_DICE = {
  // light / simple ── SRD: Weapons table (Simple)
  dagger: { die: "1d4", crit: "19-20" },        // SRD Simple: Dagger 1d4 19-20/×2
  club: { die: "1d6" },                          // SRD Simple: Club 1d6
  sickle: { die: "1d6" },                        // SRD Simple: Sickle 1d6
  kama: { die: "1d6" },                          // SRD Exotic(monk): Kama 1d6
  sai: { die: "1d4" },                           // SRD Exotic(monk): Sai 1d4
  nunchaku: { die: "1d6" },                      // SRD Exotic(monk): Nunchaku 1d6
  "light-hammer": { die: "1d4" },                // SRD Martial: Hammer, light 1d4
  handaxe: { die: "1d6" },                       // SRD Martial: Handaxe 1d6
  // one-hand martial ── SRD: Weapons table (Martial, one-handed)
  mace: { die: "1d8" },                          // SRD Simple: Mace, heavy 1d8
  morningstar: { die: "1d8" },                   // SRD Simple: Morningstar 1d8
  warhammer: { die: "1d8", crit: "×3" },         // SRD Martial: Warhammer 1d8 ×3
  hammer: { die: "1d8", crit: "×3" },            // alias of warhammer
  shortsword: { die: "1d6", crit: "19-20" },     // SRD Martial: Sword, short 1d6 19-20
  scimitar: { die: "1d6", crit: "18-20" },       // SRD Martial: Scimitar 1d6 18-20
  rapier: { die: "1d6", crit: "18-20" },         // SRD Martial: Rapier 1d6 18-20
  kukri: { die: "1d4", crit: "18-20" },          // SRD Exotic: Kukri 1d4 18-20
  longsword: { die: "1d8", crit: "19-20" },      // SRD Martial: Sword, long 1d8 19-20
  sword: { die: "1d8", crit: "19-20" },          // alias of longsword
  battleaxe: { die: "1d8", crit: "×3" },         // SRD Martial: Battleaxe 1d8 ×3
  flail: { die: "1d8" },                         // SRD Martial: Flail 1d8
  "bastard-sword": { die: "1d10", crit: "19-20" }, // SRD Exotic: Sword, bastard 1d10 19-20
  // two-handed ── SRD: Weapons table (two-handed)
  quarterstaff: { die: "1d6", note: "double 1d6/1d6" }, // SRD Simple: Quarterstaff 1d6/1d6
  greatsword: { die: "2d6", crit: "19-20" },     // SRD Martial: Greatsword 2d6 19-20
  greataxe: { die: "1d12", crit: "×3" },         // SRD Martial: Greataxe 1d12 ×3
  greatclub: { die: "1d10" },                    // SRD Martial: Greatclub 1d10
  maul: { die: "1d10", houserule: true },        // HOUSERULE: no core-3.5 "maul"; heavy-hammer ≈ 1d10
  "dwarven-waraxe": { die: "1d10", crit: "×3" }, // SRD Exotic: Dwarven waraxe 1d10 ×3
  "dwarven-urgrosh": { die: "1d8", note: "double 1d8/1d6" }, // SRD Exotic: Dwarven urgrosh 1d8/1d6
  "gnome-hooked-hammer": { die: "1d8", note: "double 1d8/1d6" }, // SRD Exotic: Gnome hooked hammer
  "orc-double-axe": { die: "1d8", note: "double 1d8/1d8" }, // SRD Exotic: Orc double axe
  // reach ── SRD: Weapons table (reach)
  spear: { die: "1d8", crit: "×3", reach: true },   // SRD Simple: Spear 1d8 ×3
  glaive: { die: "1d10", crit: "×3", reach: true }, // SRD Martial: Glaive 1d10 ×3 reach
  halberd: { die: "1d10", crit: "×3", reach: true },// SRD Martial: Halberd 1d10 ×3 reach
  pike: { die: "1d8", crit: "×3", reach: true },    // SRD Martial: Longspear/Pike 1d8 ×3 reach
  lance: { die: "1d8", crit: "×3", reach: true },   // SRD Martial: Lance 1d8 ×3 (mounted)
  mancatcher: { die: "1d2", houserule: true, reach: true, note: "grab/control, mostly nonlethal" }, // HOUSERULE
  // ranged ── SRD: Weapons table (ranged)
  shortbow: { die: "1d6", crit: "×3" },          // SRD Martial: Shortbow 1d6 ×3
  longbow: { die: "1d8", crit: "×3" },           // SRD Martial: Longbow 1d8 ×3
  crossbow: { die: "1d8", crit: "19-20" },       // SRD Simple: Crossbow, light 1d8 19-20
  "hand-crossbow": { die: "1d4", crit: "19-20" },// SRD Exotic: Crossbow, hand 1d4 19-20
  "heavy-crossbow": { die: "1d10", crit: "19-20" }, // SRD Simple: Crossbow, heavy 1d10 19-20
  "repeating-crossbow": { die: "1d8", crit: "19-20" }, // SRD Exotic: Crossbow, repeating 1d8
  dart: { die: "1d4" },                          // SRD Simple: Dart 1d4 (thrown)
  javelin: { die: "1d6" },                       // SRD Simple: Javelin 1d6 (thrown)
  shuriken: { die: "1d2" },                      // SRD Exotic: Shuriken 1d2 (thrown)
  sling: { die: "1d4" },                         // SRD Simple: Sling 1d4
  blowgun: { die: "1d2", houserule: true },      // HOUSERULE (not core 3.5): blowgun 1d2
  bolas: { die: "1d4", note: "nonlethal/trip" }, // SRD Exotic: Bolas 1d4 nonlethal
  net: { die: null, note: "no damage — entangle (special)" }, // SRD Exotic: Net (entangle)
  // ── NEW pirate weapons shipped in this file (see ITEMS.weapon) ──
  cutlass: { die: "1d6", crit: "18-20", note: "scimitar reskin" }, // SRD Martial Scimitar 1d6 18-20 (pirate cutlass)
  "boarding-axe": { die: "1d6", crit: "×3" },    // SRD Martial Handaxe/Battleaxe lineage → 1d6 ×3
  "flintlock-pistol": { die: "1d8", houserule: true, note: "DMG Renaissance firearm" }, // HOUSERULE: DMG firearms
  blunderbuss: { die: "2d4", houserule: true, area: 1, note: "DMG firearm — CONE, hits hexArea 1" }, // HOUSERULE cone AoE
  musket: { die: "1d12", houserule: true, note: "DMG Renaissance firearm, long range" }, // HOUSERULE: DMG firearms
};

/** Strip a material/affix/forge suffix to the base weapon key (longsword-iron → longsword). */
export function weaponBaseKey(id) {
  if (!id) return "";
  return String(id).replace(/#.*$/, "").replace(/-(wooden|iron|bronze|steel|leather)$/, "");
}
/** The dice expression for an equipped weapon id, or null (→ flat-damage fallback). */
export function weaponDamageExpr(id) {
  const e = WEAPON_DICE[weaponBaseKey(id)];
  return e && e.die ? e.die : null;
}

// ── tiny local builders (kept private; mirror gear-data's W/A helpers) ───────────
const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
const ABIL_LABEL = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
const px = (gold) => Math.max(1, Math.round((gold || 0) * 100)); // priceCp (1g = 100c)
/** Human-readable mod summary (covers flat combat mods AND the new ability keys). */
export function modDesc(m) {
  if (!m) return "—";
  const out = [];
  if (m.attack) out.push(`+${m.attack} dmg`);
  if (m.atkBonus) out.push(`+${m.atkBonus} to-hit`);
  if (m.ac) out.push(`+${m.ac} AC`);
  if (m.maxHp) out.push(`+${m.maxHp} HP`);
  if (m.attackRange) out.push(`+${m.attackRange} reach`);
  if (m.movementHexes) out.push(`+${m.movementHexes} move`);
  if (m.castingMod) out.push(`+${m.castingMod} spell`);
  for (const a of ABIL) if (m[a]) out.push(`+${m[a]} ${ABIL_LABEL[a]}`);
  return out.join(", ") || "—";
}
/** Build one ext item record (same shape items.js/UIs read: id/name/slot/emoji/gold/mods/desc/...). */
const G = (id, name, slot, emoji, gold, mods, weight, extra = {}) => ({
  id, name, slot, emoji, gold, priceCp: px(gold), mods, weight,
  desc: extra.desc || modDesc(mods), sprite: `../art/gear/${id}.png`,
  rarity: extra.rarity || "uncommon", material: extra.material ?? null,
  masterwork: false, enchantable: !!extra.enchantable, enchant: 0,
  set: extra.set || null, slotWas: extra.slotWas || null, houserule: !!extra.houserule,
  srd: extra.srd || "", ...extra,
});

// ── 2b) NEW STAT-ADJUSTING ITEMS, per slot ───────────────────────────────────────
// Ability-score gear uses RAW SCORE deltas (+2/+4/+6) — applyEquipment converts to mods
// via floor(score/2) and re-derives AC / to-hit / dmg / HP / spell power (see header).
export const ITEMS = {
  // ── weapon: pirate kit + firearms (flat `attack` works TODAY; `dice` is the upgrade) ──
  "cutlass": G("cutlass", "Cutlass", "weapon", "🗡️", 15, { attack: 2, atkBonus: 1 }, 4,
    { rarity: "common", srd: "Scimitar reskin (1d6 18-20)", dice: "cutlass" }),
  "boarding-axe": G("boarding-axe", "Boarding Axe", "weapon", "🪓", 10, { attack: 2 }, 4,
    { rarity: "common", srd: "Handaxe/Battleaxe lineage", dice: "boarding-axe" }),
  "flintlock-pistol": G("flintlock-pistol", "Flintlock Pistol", "weapon", "🔫", 250, { attack: 2, attackRange: 2 }, 3,
    { rarity: "uncommon", houserule: true, srd: "DMG Renaissance firearm", dice: "flintlock-pistol" }),
  "blunderbuss": G("blunderbuss", "Blunderbuss", "weapon", "💥", 500, { attack: 2, attackRange: 1 }, 8,
    { rarity: "rare", houserule: true, srd: "DMG firearm — CONE AoE (hexArea 1)", dice: "blunderbuss",
      desc: "+2 dmg, +1 reach — scatter cone hits all foes in 1 hex (with dice upgrade)" }),
  "musket": G("musket", "Musket", "weapon", "🔫", 500, { attack: 3, attackRange: 3 }, 10,
    { rarity: "rare", houserule: true, srd: "DMG Renaissance firearm", dice: "musket" }),

  // ── offhand: parry / shield (split out of base `armor` so you can dual-wield defense) ──
  "iron-buckler": G("iron-buckler", "Iron Buckler", "offhand", "🛡️", 15, { ac: 1 }, 5,
    { rarity: "common", slotWas: "armor", srd: "SRD Armor: Buckler (+1 AC)" }),
  "parrying-dagger": G("parrying-dagger", "Parrying Dagger", "offhand", "🗡️", 30, { ac: 1, atkBonus: 1 }, 1,
    { rarity: "uncommon", srd: "Main-gauche houserule (defensive off-hand)" }),
  "targe-shield": G("targe-shield", "Targe Shield", "offhand", "🛡️", 20, { ac: 2 }, 6,
    { rarity: "common", slotWas: "armor", srd: "SRD Armor: Shield, light (+2 AC)" }),
  "boarding-shield": G("boarding-shield", "Boarding Shield", "offhand", "🛡️", 20, { ac: 2, maxHp: 1 }, 15,
    { rarity: "uncommon", slotWas: "armor", srd: "SRD Armor: Shield, heavy (+2 AC) + planked bulk" }),
  "kraken-buckler": G("kraken-buckler", "Kraken-Hide Buckler", "offhand", "🦑", 2000, { ac: 2, dex: 2 }, 4,
    { rarity: "rare", enchantable: true, srd: "Buckler + Gloves of Dexterity lineage (+2 DEX)" }),

  // ── helm: was a single base `armor` helmet; ability/insight helms here ──
  "iron-helm": G("iron-helm", "Iron Helm", "helm", "⛑️", 5, { ac: 1 }, 3,
    { rarity: "common", slotWas: "armor", srd: "SRD: Helm grants minor head protection" }),
  "captains-tricorne": G("captains-tricorne", "Captain's Tricorne", "helm", "🎩", 1000, { cha: 2, atkBonus: 1 }, 1,
    { rarity: "uncommon", set: "buccaneers-regalia", srd: "Cloak/Helm of Charisma lineage (+2 CHA)" }),
  "diving-helm": G("diving-helm", "Diving Helm", "helm", "🪖", 1500, { ac: 2, maxHp: 2 }, 8,
    { rarity: "uncommon", set: "deepwater-warden", srd: "Houserule: sealed brass dive helm" }),
  "headband-intellect": G("headband-intellect", "Headband of Intellect", "helm", "🧠", 4000, { int: 2 }, 1,
    { rarity: "rare", enchantable: true, srd: "SRD Magic: Headband of Intellect +2 (4,000 gp)" }),
  "headband-vast-intellect": G("headband-vast-intellect", "Headband of Vast Intellect", "helm", "🧠", 36000, { int: 6 }, 1,
    { rarity: "legendary", srd: "SRD Magic: Headband of Intellect +6 (36,000 gp)" }),
  "mask-of-insight": G("mask-of-insight", "Mask of Insight", "helm", "🎭", 16000, { wis: 4 }, 1,
    { rarity: "epic", srd: "SRD Magic: Periapt of Wisdom +4 lineage (16,000 gp)" }),

  // ── boots: brand-new slot — movement + DEX ──
  "sea-boots": G("sea-boots", "Sea Boots", "boots", "🥾", 60, { movementHexes: 1 }, 2,
    { rarity: "common", set: "buccaneers-regalia", srd: "Houserule: sure-footed deck boots" }),
  "boots-of-striding": G("boots-of-striding", "Boots of Striding & Springing", "boots", "👢", 5500, { movementHexes: 2 }, 2,
    { rarity: "rare", srd: "SRD Magic: Boots of Striding and Springing (5,500 gp)" }),
  "boots-of-agility": G("boots-of-agility", "Boots of Agility", "boots", "👟", 4000, { dex: 2 }, 1,
    { rarity: "rare", enchantable: true, srd: "SRD Magic: Gloves of Dexterity +2 lineage (4,000 gp)" }),
  "tide-walkers": G("tide-walkers", "Tide-Walkers", "boots", "🌊", 16000, { dex: 4 }, 1,
    { rarity: "epic", srd: "SRD Magic: Gloves of Dexterity +4 lineage (16,000 gp)" }),

  // ── ring: brand-new slot — protection + the classic ability rings ──
  "ring-of-protection": G("ring-of-protection", "Ring of Protection +1", "ring", "💍", 2000, { ac: 1 }, 0,
    { rarity: "uncommon", srd: "SRD Magic: Ring of Protection +1 (2,000 gp)" }),
  "ring-of-warding": G("ring-of-warding", "Ring of Warding +2", "ring", "💍", 8000, { ac: 2 }, 0,
    { rarity: "rare", set: "deepwater-warden", srd: "SRD Magic: Ring of Protection +2 (8,000 gp)" }),
  "ring-of-the-bear": G("ring-of-the-bear", "Ring of the Bear", "ring", "🐻", 4000, { con: 2 }, 0,
    { rarity: "rare", srd: "SRD Magic: Amulet of Health +2 lineage (4,000 gp)" }),
  "ring-of-the-owl": G("ring-of-the-owl", "Ring of the Owl", "ring", "🦉", 4000, { wis: 2 }, 0,
    { rarity: "rare", srd: "SRD Magic: Periapt of Wisdom +2 lineage (4,000 gp)" }),
  "ring-of-the-ram": G("ring-of-the-ram", "Ring of the Ram", "ring", "🐏", 8600, { str: 2, attack: 1 }, 0,
    { rarity: "rare", srd: "SRD Magic: Ring of the Ram (8,600 gp) — STR/force motif" }),
  "navigators-signet": G("navigators-signet", "Navigator's Signet", "ring", "🧭", 1000, { attackRange: 1 }, 0,
    { rarity: "uncommon", srd: "Houserule: sightline ring (spyglass motif)" }),

  // ── trinket: ADD to the base trinkets — the heavy ability items live here ──
  "gauntlets-ogre-power": G("gauntlets-ogre-power", "Gauntlets of Ogre Power", "trinket", "🧤", 4000, { str: 2 }, 4,
    { rarity: "rare", enchantable: true, srd: "SRD Magic: Gauntlets of Ogre Power +2 STR (4,000 gp)" }),
  "belt-giant-strength": G("belt-giant-strength", "Belt of Giant Strength +6", "trinket", "🪢", 36000, { str: 6 }, 1,
    { rarity: "legendary", srd: "SRD Magic: Belt of Giant Strength +6 (36,000 gp)" }),
  "amulet-of-health": G("amulet-of-health", "Amulet of Health", "trinket", "📿", 4000, { con: 2 }, 0,
    { rarity: "rare", enchantable: true, srd: "SRD Magic: Amulet of Health +2 CON (4,000 gp)" }),
  "cloak-of-charisma": G("cloak-of-charisma", "Cloak of Charisma", "trinket", "🧥", 4000, { cha: 2 }, 1,
    { rarity: "rare", enchantable: true, srd: "SRD Magic: Cloak of Charisma +2 (4,000 gp)" }),
  "sirens-pearl": G("sirens-pearl", "Siren's Pearl", "trinket", "🦪", 1000, { castingMod: 1 }, 0,
    { rarity: "uncommon", srd: "SRD Magic: Pearl of Power lineage (caster motif)" }),
};

// ── 4) ROLLED AFFIXES (drops) ─────────────────────────────────────────────────
// A dropped item rolls RARITIES[tier].affixes affixes (prefix first, then suffixes).
// Each affix carries `mods` merged onto the base item, and `slots` it may appear on.
export const AFFIXES = {
  prefixes: {
    keen:    { id: "keen",    name: "Keen",    mods: { atkBonus: 1 }, slots: ["weapon"], srd: "Keen edge motif" },
    heavy:   { id: "heavy",   name: "Heavy",   mods: { attack: 1 },   slots: ["weapon"], srd: "Masterwork heft" },
    sturdy:  { id: "sturdy",  name: "Sturdy",  mods: { ac: 1 },       slots: ["offhand", "armor", "helm"], srd: "Reinforced" },
    swift:   { id: "swift",   name: "Swift",   mods: { movementHexes: 1 }, slots: ["boots"], srd: "Light step" },
    blessed: { id: "blessed", name: "Blessed", mods: { maxHp: 2 },    slots: "any", srd: "Warded by a chaplain" },
  },
  suffixes: {
    "of-the-shark":     { id: "of-the-shark",     name: "of the Shark",     mods: { attack: 1 },       slots: ["weapon"], srd: "Predator motif" },
    "of-the-tide":      { id: "of-the-tide",      name: "of the Tide",      mods: { movementHexes: 1 },slots: ["boots", "trinket"], srd: "Current-borne" },
    "of-warding":       { id: "of-warding",       name: "of Warding",       mods: { ac: 1 },           slots: ["offhand", "armor", "helm", "ring"], srd: "Abjuration motif" },
    "of-the-navigator": { id: "of-the-navigator", name: "of the Navigator", mods: { attackRange: 1 },  slots: ["weapon", "ring", "trinket"], srd: "Sightline motif" },
    "of-the-owl":       { id: "of-the-owl",       name: "of the Owl",       mods: { wis: 2 },          slots: ["helm", "ring", "trinket"], srd: "Owl's Wisdom motif" },
    "of-the-bear":      { id: "of-the-bear",      name: "of the Bear",      mods: { con: 2 },          slots: ["armor", "ring", "trinket"], srd: "Bear's Endurance motif" },
    "of-the-siren":     { id: "of-the-siren",     name: "of the Siren",     mods: { castingMod: 1 },   slots: ["helm", "trinket"], srd: "Enchantment motif" },
  },
};

const affixFitsSlot = (aff, slot) => aff.slots === "any" || (Array.isArray(aff.slots) && aff.slots.includes(slot));

/** Weighted rarity roll (uses RARITIES[*].dropWeight). */
export function rollRarity(rng = Math.random) {
  const total = RARITY_ORDER.reduce((s, k) => s + RARITIES[k].dropWeight, 0);
  let t = rng() * total;
  for (const k of RARITY_ORDER) { t -= RARITIES[k].dropWeight; if (t <= 0) return k; }
  return "common";
}

/** Roll the affixes for a (slot, rarity) drop: up to RARITIES[rarity].affixes that fit the slot. */
export function rollAffixes(slot, rarity, rng = Math.random) {
  const n = RARITIES[rarity] ? RARITIES[rarity].affixes : 0;
  if (n <= 0) return [];
  const pre = Object.values(AFFIXES.prefixes).filter((a) => affixFitsSlot(a, slot));
  const suf = Object.values(AFFIXES.suffixes).filter((a) => affixFitsSlot(a, slot));
  const picked = [];
  // at most ONE prefix; the rest from suffixes (D&D-ish naming) — no dupes.
  const take = (pool) => { if (!pool.length) return null; return pool.splice(Math.floor(rng() * pool.length), 1)[0]; };
  if (pre.length && picked.length < n) { const p = take(pre); if (p) picked.push(p); }
  while (picked.length < n && suf.length) { const s = take(suf); if (s) picked.push(s); }
  return picked;
}

/** Merge rolled affixes onto a base ext/armory item → a new instance (pure; no mutation). */
export function applyAffixes(item, affixes, rarity) {
  const mods = { ...(item.mods || {}) };
  let prefix = "", suffix = "";
  for (const a of affixes) {
    for (const k in a.mods) mods[k] = (mods[k] || 0) + a.mods[k];
    if (AFFIXES.prefixes[a.id]) prefix = a.name + " ";
    else suffix += " " + a.name;
  }
  const rar = rarity || item.rarity || "common";
  const id = `${item.id}#${rar}-${affixes.map((a) => a.id).join("-") || "base"}`;
  return {
    ...item, id, baseId: item.id, rarity: rar, rolled: true,
    name: `${prefix}${item.name}${suffix}`.trim(), mods, desc: modDesc(mods),
  };
}

// ── 5) SET BONUSES ───────────────────────────────────────────────────────────
// All-pieces-equipped grants `bonus` mods on top of each piece's own mods. `min`
// allows partial-tier sets later (default = every piece). Pieces are BASE ids; a
// rolled/forged copy (id "base#…") still counts via setBonusFor's base-id strip.
export const SETS = {
  "buccaneers-regalia": {
    id: "buccaneers-regalia", name: "Buccaneer's Regalia",
    pieces: ["cutlass", "captains-tricorne", "sea-boots"], min: 3,
    bonus: { movementHexes: 1, atkBonus: 1 },
    desc: "Swashbuckler's swagger: +1 move, +1 to-hit when cutlass, tricorne & sea boots are all worn.",
  },
  "deepwater-warden": {
    id: "deepwater-warden", name: "Deepwater Warden",
    pieces: ["diving-helm", "ring-of-warding"], min: 2,
    bonus: { ac: 2, maxHp: 3 },
    desc: "Sealed against the deep: +2 AC, +3 HP when the diving helm & ring of warding are both worn.",
  },
};

/** strip material/affix/forge suffixes → base id, so set/loadout matching is stable. */
export function baseId(id) {
  if (!id) return "";
  return String(id).replace(/#.*$/, "").replace(/-(wooden|iron|bronze|steel|leather)$/, "");
}

/** Given the equipped ids (any order, nulls ok), return matched set bonus { mods, sets:[] }. */
export function setBonusFor(equippedIds) {
  const owned = new Set((equippedIds || []).filter(Boolean).map(baseId));
  const out = { mods: {}, sets: [] };
  for (const s of Object.values(SETS)) {
    const have = s.pieces.filter((p) => owned.has(p)).length;
    if (have >= (s.min || s.pieces.length)) {
      out.sets.push(s.id);
      for (const k in s.bonus) out.mods[k] = (out.mods[k] || 0) + s.bonus[k];
    }
  }
  return out;
}

// ── 6) CONSUMABLES / THROWABLES (used, NOT worn) ───────────────────────────────
// `use` is shaped like a one-shot spell effect so game.js can route it through the
// EXISTING resolveSpellCast-style paths. target: self|ally|enemy|hex|area. kinds:
//   healing  → heal `healing` HP (self/ally)
//   damage   → roll `damage`, optional save (halves), optional hexArea (AoE)
//   control  → push an activeEffects entry (immobilize / slow / blind) for durationRounds
//   hazard   → place a hex hazard that ticks `damage` + applies `effect` while stood-in
//   reposition → pull/shove the target along the hex line by `hexes`
// `gold` is the buy price; stackable so the inventory `count` map (items.js) holds spares.
export const CONSUMABLES = {
  "grog": {
    id: "grog", name: "Mug of Grog", emoji: "🍺", slot: "consumable", kind: "healing",
    gold: 50, weight: 0.5, stackable: true,
    use: { type: "healing", target: "self", healing: "2d4+2" },
    desc: "Drink to heal 2d4+2 HP.", srd: "SRD: Potion of Cure Light Wounds analog",
  },
  "powder-bomb": {
    id: "powder-bomb", name: "Powder Bomb", emoji: "💣", slot: "consumable", kind: "throwable",
    gold: 100, weight: 1, stackable: true,
    use: { type: "damage", target: "area", hexRange: 4, hexArea: 1, damage: "2d6", damageType: "fire", save: "ref" },
    desc: "Throw up to 4 hexes: 2d6 fire to all in a 1-hex blast (Ref half).",
    srd: "SRD Alchemy: Alchemist's Fire (1d6) scaled to a packed charge",
  },
  "throwing-net": {
    id: "throwing-net", name: "Throwing Net", emoji: "🕸️", slot: "consumable", kind: "throwable",
    gold: 20, weight: 6, stackable: true,
    use: { type: "control", target: "enemy", hexRange: 3, effect: "immobilize", durationRounds: 2, save: "ref" },
    desc: "Snare a foe within 3 hexes: immobilized 2 rounds (Ref negates).",
    srd: "SRD Exotic: Net (entangle) — thrown one-shot version",
  },
  "caltrops": {
    id: "caltrops", name: "Caltrops", emoji: "🔩", slot: "consumable", kind: "throwable",
    gold: 5, weight: 2, stackable: true,
    use: { type: "hazard", target: "hex", hexArea: 1, damage: "1", effect: "slow", durationRounds: 3 },
    desc: "Scatter on a hex: 1 dmg & halved move to anything that enters (3 rounds).",
    srd: "SRD Gear: Caltrops (1 dmg, speed halved)",
  },
  "grappling-hook": {
    id: "grappling-hook", name: "Grappling Hook", emoji: "🪝", slot: "consumable", kind: "throwable",
    gold: 1, weight: 4, stackable: true,
    use: { type: "reposition", target: "enemy", mode: "pull", hexRange: 4, hexes: 2 },
    desc: "Hook a foe within 4 hexes and yank them 2 hexes toward you (or pull yourself to cover).",
    srd: "SRD Gear: Grappling hook — combat reposition houserule",
  },
  "smoke-bomb": {
    id: "smoke-bomb", name: "Smoke Bomb", emoji: "🌫️", slot: "consumable", kind: "throwable",
    gold: 20, weight: 0.5, stackable: true,
    use: { type: "control", target: "area", hexRange: 4, hexArea: 1, effect: "concealment", durationRounds: 2 },
    desc: "Burst of smoke: foes in a 1-hex cloud take -2 to-hit for 2 rounds.",
    srd: "SRD Gear: Smokestick (concealment)",
  },
  "thunderstone": {
    id: "thunderstone", name: "Thunderstone", emoji: "🔊", slot: "consumable", kind: "throwable",
    gold: 30, weight: 1, stackable: true,
    use: { type: "control", target: "area", hexRange: 5, hexArea: 1, effect: "deafen", durationRounds: 2, save: "fort" },
    desc: "Crack of thunder: foes in a 1-hex burst are deafened/rattled 2 rounds (Fort negates).",
    srd: "SRD Gear: Thunderstone (sonic, deafen, DC 15 Fort)",
  },
};

// ── BUNDLE EXPORT ───────────────────────────────────────────────────────────────
export const GEAR_EXT = {
  SLOTS,
  RARITIES,
  WEAPON_DICE,
  ITEMS,
  AFFIXES,
  SETS,
  CONSUMABLES,
  // helpers (pure; safe for the engine to import)
  weaponBaseKey, weaponDamageExpr, modDesc,
  rollRarity, rollAffixes, applyAffixes,
  baseId, setBonusFor,
};

export default GEAR_EXT;
