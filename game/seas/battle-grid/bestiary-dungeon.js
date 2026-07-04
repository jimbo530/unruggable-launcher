// @ts-check
/**
 * bestiary-dungeon.js — engine-ready CAVE / DUNGEON monster catalog for "Seize the Seas".
 *
 * WHAT THIS IS
 *   Player crew pawns build from a token ENDOWMENT via the class-engine (units.js buildUnit).
 *   MONSTERS don't have endowments — they use a DIRECT-stat path. makeMonster(def, opts)
 *   turns a flat stat block below into the SAME Tales-of-Tasern `BattleUnit` shape buildUnit
 *   emits, so a monster drops straight into game.js / tot-engine.js with ZERO new combat code.
 *   spawnGroup()/spawnPack() build a whole multi-enemy pack (the CONTENT-WISHLIST "more pawns"
 *   ask) and place them on the enemy side of the deck.
 *
 * SOURCES (reused — founder already mapped these)
 *   • Kardov's Gate bestiary  ← Tales-of-Tasern/src/lib/monsters.ts   (87 SRD stat blocks)
 *   • Kardov's Gate dungeons   ← Tales-of-Tasern/src/lib/dungeons.ts    (~37 custom bosses/adds)
 *   • Cave-goblin pack + dice  ← game/seas/CONTENT-WISHLIST.md §1, §6   (founder's deck-band calls)
 *   Sibling file bestiary-sea.js shares this exact entry shape + makeMonster/spawnGroup pattern.
 *
 * CONVENTIONS (load-bearing — match the rest of the battle-grid)
 *   • Ability scores are the project "-10" convention (D&D score − 10, min 0): a STR-18 ogre
 *     reads str:11, a STR-9 kobold reads str:1. We copy the founder's mapped values straight
 *     into `rawAbilities` (ToT abilityMod(raw) == the real d20 mod). engineStats (the panel
 *     display) reconstructs the nominal D&D score as raw+10.
 *   • DAMAGE is FLAT in this engine (resolveAttack uses stats.attack as the damage, no dice).
 *     So stats.attack = AVERAGE of the SRD damage dice (avgDice). Mid/high-CR foes intentionally
 *     hit harder than the starter band — TIER them by `cr` (see needsEngineWiring).
 *   • Casters may only use the 3 ported spells (magic_missile / burning_hands / ray_of_frost);
 *     monster spell-likes are mapped to the closest of those and the real ability kept in `special`.
 *
 * HOUSE RULE (founder): keep each creature's abilities & flavor; scale to the deck band
 *   (player pawns ~10-20 HP, AC ~10-12 (monsters to ~14), dmg ~4-9, to-hit ~+2..+5) ONLY when a
 *   mapped block is WILDLY off. We kept every mapped stat AS-IS except 12 top-end outliers
 *   (HP>90 OR AC>20 OR to-hit>+14) compressed to a boss band (HP~78-85, AC~18-20, hit~+11-12,
 *   dmg~10-14) — each flagged `scaled:true` with a // SCALED comment. See SCALED_OUTLIERS export.
 *
 * Game-layer / data only. No on-chain, no network. node --check clean. Additive — core engine
 * files (tot-engine.js / units.js / game.js) are NOT edited.
 *
 * ART: founder makes all sprites; each entry names an `art` id (see artNeededFromFounder).
 */

import { abilityMod } from "./tot-engine.js";

// ── helpers ─────────────────────────────────────────────────────────────────────
const cl0 = (n) => Math.max(0, Math.floor(Number(n) || 0));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const titleCase = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "Monster");

/** Average of an SRD damage expression → the FLAT damage this engine uses. Accepts a number
 *  (passed through), or "NdM", "NdM+B", "NdM-B". Min 1. (No "/level" — those are spells.) */
function avgDice(expr) {
  if (typeof expr === "number") return Math.max(1, Math.round(expr));
  const m = String(expr).trim().match(/^(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?$/i);
  if (!m) { const n = parseInt(String(expr), 10); return Number.isFinite(n) ? Math.max(1, n) : 1; }
  const count = parseInt(m[1], 10), size = parseInt(m[2], 10);
  const bonus = m[3] ? parseInt(m[3].replace(/\s+/g, ""), 10) : 0;
  return Math.max(1, Math.round((count * (size + 1)) / 2 + bonus));
}

/** SRD feet of speed → deck-band hexes (tight 2-6 band on a 9x7 deck; goblin spd30 → 3). */
function moveFromSpeed(speed) { return clamp(Math.round((Number(speed) || 30) / 10), 2, 6); }

// Enemy-side spawn hexes on the 9-wide x 7-tall deck (player starts left ~q1). 15 slots.
export const ENEMY_HOME = [
  { q: 7, r: 1 }, { q: 8, r: 2 }, { q: 6, r: 2 }, { q: 7, r: 3 }, { q: 8, r: 4 },
  { q: 6, r: 4 }, { q: 7, r: 5 }, { q: 8, r: 0 }, { q: 6, r: 0 }, { q: 8, r: 6 },
  { q: 6, r: 6 }, { q: 7, r: 0 }, { q: 7, r: 6 }, { q: 8, r: 3 }, { q: 6, r: 3 },
];

/**
 * DIRECT-STAT MONSTER → ToT BattleUnit. Mirrors units.js buildUnit's OUTPUT shape exactly
 * (engineStats / qualified / endowment / equipped / base* all present) so showStats(), the
 * encumbrance code, the equip system and the d20 combat all read a monster without crashing.
 *
 * @param {object} def   a DUNGEON_BESTIARY entry
 * @param {{ id?:string, monsterId?:string, position?:{q:number,r:number}, isPlayer?:boolean,
 *           boss?:boolean, name?:string, hpBonus?:number }} [opts]
 * @returns {object} BattleUnit
 */
export function makeMonster(def, opts = {}) {
  if (!def || typeof def !== "object") throw new Error("makeMonster: missing def"); // visible, never silent
  const monsterId = opts.monsterId ?? def.id ?? "mob";
  const id = opts.id ?? `m_${monsterId}`;
  const position = opts.position ?? { q: 7, r: 3 };
  const isPlayer = !!opts.isPlayer;
  const role = def.role === "caster" ? "caster" : "melee";

  const A = {
    str: cl0(def.str), dex: cl0(def.dex), con: cl0(def.con),
    int: cl0(def.int), wis: cl0(def.wis), cha: cl0(def.cha),
  };
  const intMod = abilityMod(A.int);                 // ToT mod = floor(raw/2)
  const range = def.range ?? 1;
  const move = moveFromSpeed(def.speed ?? 30);
  const hp = Math.max(1, Math.round((def.hp ?? 6) + (opts.hpBonus ?? 0)));
  const attack = avgDice(def.dmg ?? 1);             // FLAT dmg = avg of SRD dice
  const ac = def.ac ?? 12;
  const hit = def.hit ?? 0;
  const cr = def.cr ?? 1;
  const lvl = Math.max(1, Math.round(cr));
  // Monster caster level is capped at 4 so /level spells (burning_hands 1d4/level) stay in band.
  const casterLevel = role === "caster" ? clamp(Math.round(cr / 2) + 1, 1, 4) : lvl;

  const stats = {
    attack, atkBonus: hit, ac, mAtk: A.int + 10, def: A.dex, mDef: A.wis, hp,
    speed: def.speed ?? 30,
    // fields hexCombat reads but v1 doesn't drive (kept zero/empty so ports run clean):
    lightningDmg: 0, fireDmg: 0, lightningDice: null, fireDice: null, retaliationDice: null,
    resistances: [], immunities: [], retaliationDmg: 0,
  };

  return {
    id, monsterId,
    name: opts.name ?? def.name,
    className: def.cls ?? titleCase((def.subtypes && def.subtypes[0]) || "monster"),
    imageEmoji: def.emoji ?? "\u{1F47E}",            // 👾 placeholder; founder swaps art
    crewId: null, imageUrl: undefined, cosmetics: [],
    isPlayer, role,

    // ── stat-panel parity (showStats reads these for ANY unit, enemy included) ──
    endowment: {},                                   // monsters have no token endowment
    engineStats: { STR: A.str + 10, DEX: A.dex + 10, CON: A.con + 10, INT: A.int + 10, WIS: A.wis + 10, CHA: A.cha + 10 },
    bracket: cr != null ? `CR ${cr}` : "—",
    totalLevel: lvl,
    qualified: [],                                   // no class → showStats shows abilities "—"
    spellDC: 8 + intMod,

    // ── ToT BattleUnit shape (consumed by tot-engine.js / game.js) ──
    position: { ...position },
    stats,
    rawAbilities: A,
    subtypes: def.subtypes ?? [],
    currentHp: hp, maxHp: hp,
    hasMoved: false, hasActed: false, activeEffects: [],
    attackRange: range,
    isRanged: role !== "caster" && range >= 3,       // slinger/archer style
    casterLevel, castingAbilityMod: intMod,
    availableSpells: role === "caster" ? (def.spells ?? ["magic_missile"]) : [],
    movementHexes: move,

    // equip system base values (monsters arrive unequipped; applyEquipment recomputes from these)
    baseStats: { ...stats }, baseMaxHp: hp, baseAttackRange: range,
    baseMovementHexes: move, baseCastingMod: intMod,
    equipped: { weapon: null, offhand: null, armor: null, helm: null, boots: null, ring: null, trinket: null },

    // bestiary metadata (display / future hooks; not used by core combat)
    cr, art: def.art ?? null, special: def.special ?? null,
    boss: !!(opts.boss ?? def.boss), naturalArmor: def.naturalArmor ?? 0, scaled: !!def.scaled,
  };
}

/**
 * Build a multi-enemy GROUP from specs and place them on the enemy side.
 * @param {Array<{ id:string, count?:number|[number,number], position?:{q,r}, boss?:boolean,
 *                 name?:string, hpBonus?:number }>} specs
 * @param {{ startId?:number, positions?:Array<{q,r}>, rng?:()=>number }} [opts]
 * @returns {object[]} BattleUnits
 */
export function spawnGroup(specs, opts = {}) {
  if (!Array.isArray(specs)) throw new Error("spawnGroup: specs must be an array");
  const home = opts.positions ?? ENEMY_HOME;
  const rng = opts.rng ?? Math.random;
  const out = [];
  let n = opts.startId ?? 1, slot = 0;
  for (const spec of specs) {
    const def = DUNGEON_BESTIARY[spec.id];
    if (!def) throw new Error(`spawnGroup: unknown monster id "${spec.id}"`); // visible, never silent
    let count = spec.count ?? 1;
    if (Array.isArray(count)) { const [lo, hi] = count; count = lo + Math.floor(rng() * (hi - lo + 1)); }
    for (let i = 0; i < count; i++) {
      const pos = spec.position && i === 0 ? spec.position : home[slot % home.length];
      slot++;
      out.push(makeMonster(def, {
        id: `m_${spec.id}_${n++}`, monsterId: spec.id, position: { ...pos }, isPlayer: false,
        boss: spec.boss || def.boss || false, name: spec.name, hpBonus: spec.hpBonus,
      }));
    }
  }
  return out;
}

/** Build a named preset pack from DUNGEON_PACKS. */
export function spawnPack(packId, opts = {}) {
  const pack = DUNGEON_PACKS[packId];
  if (!pack) throw new Error(`spawnPack: unknown pack "${packId}"`); // visible, never silent
  return spawnGroup(pack.members, opts);
}

/** Lookups for the encounter system. */
export const getMonster = (id) => DUNGEON_BESTIARY[id] || null;
export const allMonsterIds = () => Object.keys(DUNGEON_BESTIARY);
export function monstersByCR(min = 0, max = Infinity) {
  return Object.entries(DUNGEON_BESTIARY)
    .filter(([, d]) => (d.cr ?? 1) >= min && (d.cr ?? 1) <= max)
    .map(([id]) => id);
}

// ════════════════════════════════════════════════════════════════════════════════
// THE CATALOG
// Entry shape: { name, emoji, cr, role, hp, ac, dmg(number|SRD-dice), hit, range, speed,
//   str,dex,con,int,wis,cha (the -10 convention), subtypes[], special, art, cls?, boss?, scaled?,
//   spells?(caster), naturalArmor?(dungeon) }.  // SRD source on each.
// ════════════════════════════════════════════════════════════════════════════════
export const DUNGEON_BESTIARY = {
  // ── ⭐ CAVE GOBLINS — authored pack (CONTENT-WISHLIST §1/§6, SRD Goblin/Hobgoblin base) ──
  goblin_spear: { // SRD Goblin (MM) tuned to deck band: spear-and-shield, 10ft reach.
    name: "Goblin Spear", emoji: "\u{1F47A}", cr: 0.33, role: "melee", cls: "Cave Goblin",
    hp: 5, ac: 13, dmg: 2, hit: 2, range: 2, speed: 30,
    str: 1, dex: 3, con: 2, int: 1, wis: 1, cha: 1, subtypes: ["humanoid", "goblinoid"],
    special: "Reach 2 (spear wall); darkvision 60; flees if the boss falls.", art: "goblin",
  },
  goblin_slinger: { // SRD Goblin w/ sling: the pack's ranged poke.
    name: "Goblin Slinger", emoji: "\u{1F3AF}", cr: 0.33, role: "melee", cls: "Cave Goblin",
    hp: 4, ac: 12, dmg: 2, hit: 2, range: 3, speed: 30,
    str: 1, dex: 4, con: 2, int: 1, wis: 1, cha: 1, subtypes: ["humanoid", "goblinoid"],
    special: "Ranged sling (range 3); kites; darkvision 60.", art: "goblin-archer",
  },
  goblin_shaman: { // SRD Goblin adept: a caster that flings a frost/force ray.
    name: "Goblin Shaman", emoji: "\u{1FA84}", cr: 1, role: "caster", cls: "Cave Goblin",
    hp: 5, ac: 11, dmg: 1, hit: 1, range: 1, speed: 30,
    str: 1, dex: 3, con: 2, int: 3, wis: 3, cha: 1, subtypes: ["humanoid", "goblinoid"],
    spells: ["ray_of_frost", "magic_missile"],
    special: "Adept caster: frost ray then force bolt; darkvision 60.", art: "goblin-shaman",
  },
  hobgoblin_boss: { // SRD Hobgoblin leader, boss-tuned: kill it → the pack ROUTS.
    name: "Hobgoblin Boss", emoji: "\u{1F9CC}", cr: 2, role: "melee", cls: "Warband Leader",
    hp: 9, ac: 14, dmg: 4, hit: 3, range: 1, speed: 30, boss: true,
    str: 4, dex: 3, con: 4, int: 1, wis: 1, cha: 2, subtypes: ["humanoid", "goblinoid"],
    special: "Tanky leader. Killing it ROUTS the goblin pack (see needsEngineWiring).", art: "hobgoblin",
  },

  // ════════ KARDOV'S GATE BESTIARY — monsters.ts (87 SRD blocks, mapped stats kept) ════════
  kobold: { // SRD Kobold: spear +1 (1d6-1), Dex 13, darkvision 60.
    name: "Kobold", emoji: "\u{1F98E}", cr: 0.25, role: "melee", hp: 4, ac: 15, dmg: "1d6-1", hit: 1, range: 1, speed: 30,
    str: 1, dex: 3, con: 1, int: 1, wis: 1, cha: 1, subtypes: ["humanoid", "reptilian"],
    special: "Pack tactics; darkvision 60; light-sensitive.", art: "kobold",
  },
  spider_tiny: { // SRD Tiny Monstrous Spider: bite +5 (1d3-4 + poison).
    name: "Tiny Spider", emoji: "\u{1F577}️", cr: 0.25, role: "melee", hp: 2, ac: 15, dmg: "1d3", hit: 5, range: 1, speed: 20,
    str: 1, dex: 7, con: 1, int: 1, wis: 1, cha: 1, subtypes: ["vermin"],
    special: "Poison (Dex); climb; tremorsense.", art: "spider-tiny",
  },
  dire_rat: { // SRD Dire Rat: bite +4 (1d4 + filth fever). Reskin: "Giant Sewer Rat".
    name: "Dire Rat", emoji: "\u{1F400}", cr: 0.33, role: "melee", hp: 5, ac: 15, dmg: "1d4", hit: 4, range: 1, speed: 40,
    str: 1, dex: 7, con: 2, int: 1, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Disease (filth fever); climb; low-light.", art: "rat",
  },
  goblin: { // SRD Goblin: morningstar +2 (1d6), darkvision 60.
    name: "Goblin", emoji: "\u{1F47A}", cr: 0.33, role: "melee", hp: 5, ac: 15, dmg: "1d6", hit: 2, range: 1, speed: 30,
    str: 1, dex: 3, con: 2, int: 1, wis: 1, cha: 1, subtypes: ["humanoid", "goblinoid"],
    special: "Darkvision 60.", art: "goblin",
  },
  fire_beetle: { // SRD Giant Fire Beetle: bite +1 (2d4), glows.
    name: "Giant Fire Beetle", emoji: "\u{1FAB2}", cr: 0.33, role: "melee", hp: 4, ac: 16, dmg: "2d4", hit: 1, range: 1, speed: 30,
    str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1, subtypes: ["vermin"],
    special: "Glands glow (light 10 ft); darkvision.", art: "beetle",
  },
  orc: { // SRD Orc: falchion +4 (2d4+4), ferocious, light-sensitive.
    name: "Orc", emoji: "\u{1F479}", cr: 0.5, role: "melee", hp: 5, ac: 13, dmg: "2d4+4", hit: 4, range: 1, speed: 30,
    str: 7, dex: 1, con: 2, int: 1, wis: 1, cha: 1, subtypes: ["humanoid", "orc"],
    special: "Big two-hander; light sensitivity; darkvision 60.", art: "orc",
  },
  hobgoblin: { // SRD Hobgoblin: longsword +2 (1d8+1). Reskin: "Smuggler" / "First Mate".
    name: "Hobgoblin", emoji: "\u{1F9CC}", cr: 0.5, role: "melee", hp: 6, ac: 15, dmg: "1d8+1", hit: 2, range: 1, speed: 30,
    str: 3, dex: 3, con: 4, int: 1, wis: 1, cha: 1, subtypes: ["humanoid", "goblinoid"],
    special: "Disciplined; darkvision 60.", art: "hobgoblin",
  },
  zombie: { // SRD Zombie: slam +2 (1d6+1), single action/round.
    name: "Zombie", emoji: "\u{1F9DF}", cr: 0.5, role: "melee", hp: 16, ac: 11, dmg: "1d6+1", hit: 2, range: 1, speed: 30,
    str: 2, dex: 1, con: 1, int: 1, wis: 1, cha: 1, subtypes: ["undead"],
    special: "Undead; DR 5/slashing; one action per round.", art: "zombie",
  },
  skeleton: { // SRD Skeleton: scimitar +1 (1d6+1), DR 5/bludgeoning. Reskin: Armored/Barrow/Priestly Skeleton.
    name: "Skeleton", emoji: "\u{1F480}", cr: 0.5, role: "melee", hp: 6, ac: 15, dmg: "1d6+1", hit: 1, range: 1, speed: 30,
    str: 3, dex: 3, con: 1, int: 1, wis: 1, cha: 1, subtypes: ["undead"],
    special: "Undead; DR 5/bludgeoning; immune cold.", art: "skeleton",
  },
  stirge: { // SRD Stirge: touch +7 then attach + blood drain.
    name: "Stirge", emoji: "\u{1F99F}", cr: 0.5, role: "melee", hp: 5, ac: 16, dmg: 2, hit: 7, range: 1, speed: 40,
    str: 1, dex: 9, con: 1, int: 1, wis: 2, cha: 1, subtypes: ["magical_beast"],
    special: "Fly 40; attach + blood drain 1d4 Con/round.", art: "stirge",
  },
  small_spider: { // SRD Small Monstrous Spider: bite +4 (1d4-2 + poison). Reskin: "Brood Guardian".
    name: "Small Spider", emoji: "\u{1F577}️", cr: 0.5, role: "melee", hp: 4, ac: 14, dmg: "1d4-2", hit: 4, range: 1, speed: 30,
    str: 1, dex: 7, con: 1, int: 1, wis: 1, cha: 1, subtypes: ["vermin"],
    special: "Poison (Str); climb.", art: "spider",
  },
  badger: { // SRD Badger: claw +4 (1d2-1), rages when wounded.
    name: "Badger", emoji: "\u{1F9A1}", cr: 0.5, role: "melee", hp: 6, ac: 15, dmg: "1d2-1", hit: 4, range: 1, speed: 30,
    str: 1, dex: 7, con: 5, int: 1, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Rage (+STR/CON) when wounded.", art: "badger",
  },
  wolf: { // SRD Wolf: bite +3 (1d6+1), trip.
    name: "Wolf", emoji: "\u{1F43A}", cr: 1, role: "melee", hp: 13, ac: 14, dmg: "1d6+1", hit: 3, range: 1, speed: 50,
    str: 3, dex: 5, con: 5, int: 1, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Trip on a hit.", art: "wolf",
  },
  gnoll: { // SRD Gnoll: battleaxe +3 (1d8+2), darkvision.
    name: "Gnoll", emoji: "\u{1F43A}", cr: 1, role: "melee", hp: 11, ac: 15, dmg: "1d8+2", hit: 3, range: 1, speed: 30,
    str: 5, dex: 1, con: 3, int: 1, wis: 1, cha: 1, subtypes: ["humanoid", "gnoll"],
    special: "Darkvision 60; pack hunter.", art: "gnoll",
  },
  giant_spider: { // SRD Medium/Giant Monstrous Spider: bite +4 (1d6 + poison), web. ("Giant Spider" classic.)
    name: "Giant Spider", emoji: "\u{1F578}️", cr: 1, role: "melee", hp: 11, ac: 14, dmg: "1d6", hit: 4, range: 1, speed: 30,
    str: 1, dex: 7, con: 2, int: 1, wis: 1, cha: 1, subtypes: ["vermin"],
    special: "Poison (Str); web; climb. (= bestiary 'Medium Spider'.)", art: "spider",
  },
  krenshar: { // SRD Krenshar: bite +2 (1d6), scare (Will DC 13).
    name: "Krenshar", emoji: "\u{1F631}", cr: 1, role: "melee", hp: 11, ac: 15, dmg: "1d6", hit: 2, range: 1, speed: 40,
    str: 1, dex: 4, con: 1, int: 1, wis: 2, cha: 3, subtypes: ["magical_beast"],
    special: "Scare — peels its face back (Will DC 13 or shaken).", art: "krenshar",
  },
  ant_worker: { // SRD Giant Ant (worker): bite +1 (1d6).
    name: "Giant Ant Worker", emoji: "\u{1F41C}", cr: 1, role: "melee", hp: 9, ac: 17, dmg: "1d6", hit: 1, range: 1, speed: 50,
    str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1, subtypes: ["vermin"],
    special: "Tunneler; relentless.", art: "ant",
  },
  giant_bee: { // SRD Giant Bee: sting +2 (1d4 + poison).
    name: "Giant Bee", emoji: "\u{1F41D}", cr: 1, role: "melee", hp: 13, ac: 14, dmg: "1d4", hit: 2, range: 1, speed: 40,
    str: 1, dex: 4, con: 1, int: 1, wis: 2, cha: 1, subtypes: ["vermin"],
    special: "Fly; poison (Con); dies after it stings.", art: "bee",
  },
  troglodyte: { // SRD Troglodyte: club +1 (1d6), stench (Fort DC 13).
    name: "Troglodyte", emoji: "\u{1F98E}", cr: 1, role: "melee", hp: 13, ac: 15, dmg: "1d6", hit: 1, range: 1, speed: 30,
    str: 1, dex: 1, con: 4, int: 1, wis: 1, cha: 1, subtypes: ["humanoid", "reptilian"],
    special: "Stench aura (Fort DC 13 or sickened); darkvision 90.", art: "troglodyte",
  },
  bugbear: { // SRD Bugbear: morningstar +5 (1d8+2), stealthy.
    name: "Bugbear", emoji: "\u{1F43B}", cr: 2, role: "melee", hp: 16, ac: 17, dmg: "1d8+2", hit: 5, range: 1, speed: 30,
    str: 5, dex: 2, con: 3, int: 1, wis: 1, cha: 1, subtypes: ["humanoid", "goblinoid"],
    special: "Stealthy ambusher; darkvision 60.", art: "bugbear",
  },
  worg: { // SRD Worg: bite +7 (1d6+4), trip. Reskin: "Hag's Worg".
    name: "Worg", emoji: "\u{1F43A}", cr: 2, role: "melee", hp: 30, ac: 14, dmg: "1d6+4", hit: 7, range: 1, speed: 50,
    str: 7, dex: 5, con: 5, int: 1, wis: 4, cha: 1, subtypes: ["magical_beast"],
    special: "Trip on a hit; scent.", art: "worg",
  },
  boar: { // SRD Boar: gore +4 (1d8+3), ferocity.
    name: "Boar", emoji: "\u{1F417}", cr: 2, role: "melee", hp: 25, ac: 16, dmg: "1d8+3", hit: 4, range: 1, speed: 40,
    str: 5, dex: 1, con: 7, int: 1, wis: 3, cha: 1, subtypes: ["beast"],
    special: "Ferocity — keeps fighting below 0 HP.", art: "boar",
  },
  dire_weasel: { // SRD Dire Weasel: bite +6 (1d6+3), attach + blood drain.
    name: "Dire Weasel", emoji: "\u{1F9A1}", cr: 2, role: "melee", hp: 13, ac: 16, dmg: "1d6+3", hit: 6, range: 1, speed: 40,
    str: 4, dex: 9, con: 1, int: 1, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Attach then blood drain 1d4 Con/round.", art: "weasel",
  },
  ant_soldier: { // SRD Giant Ant (soldier): bite +3 (2d4+3), acid sting.
    name: "Giant Ant Soldier", emoji: "\u{1F41C}", cr: 2, role: "melee", hp: 11, ac: 17, dmg: "2d4+3", hit: 3, range: 1, speed: 50,
    str: 4, dex: 1, con: 3, int: 1, wis: 3, cha: 1, subtypes: ["vermin"],
    special: "Improved grab + acid sting.", art: "ant",
  },
  rat_swarm: { // SRD Rat Swarm: swarm (1d6 + disease), distraction.
    name: "Rat Swarm", emoji: "\u{1F400}", cr: 2, role: "melee", hp: 13, ac: 14, dmg: "1d6", hit: 4, range: 1, speed: 15,
    str: 1, dex: 5, con: 1, int: 1, wis: 2, cha: 1, subtypes: ["vermin", "swarm"],
    special: "Swarm: auto-hit distraction (Fort save) + disease; half dmg from slashing.", art: "rat-swarm",
  },
  dire_wolf: { // SRD Dire Wolf: bite +11 (1d8+10), trip. (Kept — a deliberately deadly CR3.)
    name: "Dire Wolf", emoji: "\u{1F43A}", cr: 3, role: "melee", hp: 45, ac: 14, dmg: "1d8+10", hit: 11, range: 1, speed: 50,
    str: 15, dex: 5, con: 7, int: 1, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Trip on a hit; scent. High to-hit — tier vs leveled crews.", art: "dire-wolf",
  },
  wight: { // SRD Wight: slam +3 (1d4+1 + energy drain).
    name: "Wight", emoji: "\u{1F9DF}", cr: 3, role: "melee", hp: 26, ac: 15, dmg: "1d4+1", hit: 3, range: 1, speed: 30,
    str: 2, dex: 2, con: 1, int: 1, wis: 3, cha: 5, subtypes: ["undead"],
    special: "Energy drain (1 level) → creates spawn.", art: "wight",
  },
  ankheg: { // SRD Ankheg: bite +7 (2d6+7 + 1d4 acid), spit acid, burrow.
    name: "Ankheg", emoji: "\u{1FAB1}", cr: 3, role: "melee", hp: 28, ac: 18, dmg: "2d6+7", hit: 7, range: 2, speed: 30,
    str: 11, dex: 1, con: 7, int: 1, wis: 3, cha: 1, subtypes: ["magical_beast"],
    special: "Spit acid (5d4 line, 1/6hr); burrow 20; improved grab.", art: "ankheg",
  },
  cockatrice: { // SRD Cockatrice: bite +9 (1d4-2 + petrification).
    name: "Cockatrice", emoji: "\u{1F414}", cr: 3, role: "melee", hp: 27, ac: 14, dmg: "1d4", hit: 9, range: 1, speed: 30,
    str: 1, dex: 7, con: 1, int: 1, wis: 3, cha: 1, subtypes: ["magical_beast"],
    special: "Petrification on a hit (Fort DC 12 or turn to stone); fly.", art: "cockatrice",
  },
  ettercap: { // SRD Ettercap: bite +5 (1d8+2 + poison), web.
    name: "Ettercap", emoji: "\u{1F578}️", cr: 3, role: "melee", hp: 27, ac: 14, dmg: "1d8+2", hit: 5, range: 1, speed: 30,
    str: 4, dex: 7, con: 3, int: 1, wis: 5, cha: 1, subtypes: ["aberration"],
    special: "Web traps; poison (Dex).", art: "ettercap",
  },
  doppelganger: { // SRD Doppelganger: slam +5 (1d6+1), change shape, detect thoughts.
    name: "Doppelganger", emoji: "\u{1F465}", cr: 3, role: "melee", hp: 22, ac: 15, dmg: "1d6+1", hit: 5, range: 1, speed: 30,
    str: 2, dex: 3, con: 2, int: 3, wis: 4, cha: 3, subtypes: ["aberration"],
    special: "Change shape; detect thoughts; immune sleep/charm.", art: "doppelganger",
  },
  assassin_vine: { // SRD Assassin Vine: slam +7 (1d6+7), constrict, entangle.
    name: "Assassin Vine", emoji: "\u{1F33F}", cr: 3, role: "melee", hp: 30, ac: 15, dmg: "1d6+7", hit: 7, range: 2, speed: 10,
    str: 10, dex: 1, con: 6, int: 1, wis: 3, cha: 1, subtypes: ["plant"],
    special: "Constrict 1d6+7; entangle; camouflage (looks like normal vine).", art: "vine",
  },
  hyena: { // SRD Hyena: bite +3 (1d6+3), trip.
    name: "Hyena", emoji: "\u{1F43E}", cr: 1, role: "melee", hp: 13, ac: 14, dmg: "1d6+3", hit: 3, range: 1, speed: 50,
    str: 4, dex: 5, con: 5, int: 1, wis: 3, cha: 1, subtypes: ["beast"],
    special: "Trip on a hit; pack tactics.", art: "hyena",
  },
  monstrous_scorpion_med: { // SRD Medium Monstrous Scorpion: claws +2 (1d3+1), sting (poison).
    name: "Giant Scorpion", emoji: "\u{1F982}", cr: 1, role: "melee", hp: 13, ac: 14, dmg: "1d3+1", hit: 2, range: 1, speed: 40,
    str: 3, dex: 1, con: 4, int: 1, wis: 1, cha: 1, subtypes: ["vermin"],
    special: "Poison sting (Fort DC 12); constrict; improved grab.", art: "scorpion",
  },
  lizardfolk: { // SRD Lizardfolk: club +2 (1d6+1), bite, hold breath.
    name: "Lizardfolk", emoji: "\u{1F98E}", cr: 1, role: "melee", hp: 11, ac: 15, dmg: "1d6+1", hit: 2, range: 1, speed: 30,
    str: 3, dex: 1, con: 3, int: 1, wis: 1, cha: 1, subtypes: ["humanoid", "reptilian"],
    special: "Hold breath; bite + claws.", art: "lizardfolk",
  },
  constrictor_snake: { // SRD Constrictor Snake: constrict +7 (1d3+4), improved grab.
    name: "Constrictor Snake", emoji: "\u{1F40D}", cr: 1, role: "melee", hp: 13, ac: 12, dmg: "1d3+4", hit: 7, range: 2, speed: 20,
    str: 5, dex: 7, con: 3, int: 1, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Constrict + improved grab; scent.", art: "snake",
  },
  giant_centipede: { // SRD Giant Centipede: bite +2 (1d6-1 + poison).
    name: "Giant Centipede", emoji: "\u{1F41B}", cr: 1, role: "melee", hp: 5, ac: 14, dmg: "1d6-1", hit: 2, range: 1, speed: 40,
    str: 1, dex: 5, con: 1, int: 1, wis: 1, cha: 1, subtypes: ["vermin"],
    special: "Poison (Dex, Fort DC 13); climb.", art: "centipede",
  },
  crocodile: { // SRD Crocodile: bite +6 (1d8+6), improved grab, death roll. (Captain Blacktide's pet.)
    name: "Crocodile", emoji: "\u{1F40A}", cr: 1, role: "melee", hp: 22, ac: 15, dmg: "1d8+6", hit: 6, range: 1, speed: 30,
    str: 9, dex: 2, con: 7, int: 1, wis: 2, cha: 1, subtypes: ["beast", "aquatic"],
    special: "Improved grab + death roll; aquatic; holds breath.", art: "crocodile",
  },
  ghoul: { // SRD Ghoul: bite +3 (1d6+1 + paralysis).
    name: "Ghoul", emoji: "\u{1F9DF}", cr: 2, role: "melee", hp: 13, ac: 14, dmg: "1d6+1", hit: 3, range: 1, speed: 30,
    str: 3, dex: 5, con: 1, int: 3, wis: 4, cha: 1, subtypes: ["undead"],
    special: "Paralysis on a hit (Fort DC 12); undead.", art: "ghoul",
  },
  hippogriff: { // SRD Hippogriff: claws +5 (1d4+4), fly.
    name: "Hippogriff", emoji: "\u{1F985}", cr: 2, role: "melee", hp: 25, ac: 15, dmg: "1d4+4", hit: 5, range: 1, speed: 50,
    str: 6, dex: 5, con: 4, int: 1, wis: 4, cha: 1, subtypes: ["magical_beast"],
    special: "Fly 100; dive attack.", art: "hippogriff",
  },
  sahuagin: { // SRD Sahuagin: trident +4 (1d8+3), blood frenzy. Reskin: Sahuagin Raider / Temple Guard.
    name: "Sahuagin", emoji: "\u{1F9DC}", cr: 2, role: "melee", hp: 11, ac: 16, dmg: "1d8+3", hit: 4, range: 1, speed: 30,
    str: 4, dex: 3, con: 2, int: 4, wis: 3, cha: 1, subtypes: ["humanoid", "aquatic"],
    special: "Blood frenzy; speak with sharks; aquatic. A sea-raider — prime Seize-the-Seas foe.", art: "sahuagin",
  },
  dire_ape: { // SRD Dire Ape: claws +12 (1d6+7), rend.
    name: "Dire Ape", emoji: "\u{1F98D}", cr: 2, role: "melee", hp: 35, ac: 15, dmg: "1d6+7", hit: 12, range: 1, speed: 30,
    str: 12, dex: 5, con: 4, int: 1, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Rend 2d6+10 if both claws hit; climb.", art: "ape",
  },
  monstrous_scorpion_lg: { // SRD Large Monstrous Scorpion: 2 claws +6 (1d6+4), sting (poison). Reskin: Reef Scorpion.
    name: "Huge Scorpion", emoji: "\u{1F982}", cr: 3, role: "melee", hp: 45, ac: 16, dmg: "1d6+4", hit: 6, range: 2, speed: 50,
    str: 9, dex: 1, con: 4, int: 1, wis: 1, cha: 1, subtypes: ["vermin"],
    special: "Poison (Fort DC 14); improved grab; constrict.", art: "scorpion",
  },
  ghast: { // SRD Ghast: bite +5 (1d8+1 + paralysis), stench.
    name: "Ghast", emoji: "\u{1F9DF}", cr: 3, role: "melee", hp: 29, ac: 17, dmg: "1d8+1", hit: 5, range: 1, speed: 30,
    str: 3, dex: 7, con: 1, int: 3, wis: 4, cha: 1, subtypes: ["undead"],
    special: "Paralysis (Fort DC 15); stench aura; undead.", art: "ghast",
  },
  manticore: { // SRD Manticore: claws +10 (2d4+5), tail spikes (ranged).
    name: "Manticore", emoji: "\u{1F981}", cr: 3, role: "melee", hp: 57, ac: 17, dmg: "2d4+5", hit: 10, range: 1, speed: 30,
    str: 10, dex: 2, con: 9, int: 1, wis: 2, cha: 1, subtypes: ["magical_beast"],
    special: "Tail spikes (6/day, 1d8+2, range 180); fly.", art: "manticore",
  },
  green_hag: { // SRD Green Hag: claw +13 (1d4+7), spell-likes. SCALED: AC 22→19, hit +13→+11 (AC>20 outlier).
    name: "Green Hag", emoji: "\u{1F9D9}", cr: 5, role: "melee", hp: 49, ac: 19, dmg: "1d4+7", hit: 11, range: 1, speed: 30, scaled: true,
    str: 15, dex: 2, con: 2, int: 3, wis: 3, cha: 4, subtypes: ["fey"],
    special: "Weakness aura; mimicry; invisibility; spell-likes. Swamp boss of Forest 2.", art: "hag",
  },
  giant_constrictor: { // SRD Giant Constrictor: bite +10 (1d8+10), constrict. Reskin: Sea Serpent.
    name: "Giant Constrictor", emoji: "\u{1F40D}", cr: 3, role: "melee", hp: 45, ac: 12, dmg: "1d8+10", hit: 10, range: 2, speed: 20,
    str: 15, dex: 7, con: 3, int: 1, wis: 2, cha: 1, subtypes: ["beast", "aquatic"],
    special: "Constrict 1d8+10; improved grab; aquatic. Reskin as 'Sea Serpent'.", art: "snake-giant",
  },
  fenmaw: { // Tasern owlbear-type: claws +9 (1d6+5), crushing grip.
    name: "Fenmaw", emoji: "\u{1F9A2}", cr: 4, role: "melee", hp: 52, ac: 15, dmg: "1d6+5", hit: 9, range: 2, speed: 30,
    str: 11, dex: 2, con: 11, int: 1, wis: 2, cha: 1, subtypes: ["magical_beast"],
    special: "Crushing grip (improved grab) 2d8; Tasern-original owlbear.", art: "owlbear",
  },
  glimmerstalk: { // Tasern displacer-beast reskin: feelers +9 (1d6+4), displacement.
    name: "Glimmerstalk", emoji: "\u{1F408}", cr: 4, role: "melee", hp: 51, ac: 16, dmg: "1d6+4", hit: 9, range: 2, speed: 40,
    str: 8, dex: 5, con: 6, int: 1, wis: 2, cha: 1, subtypes: ["magical_beast"],
    special: "Lightsmear — 50% miss chance (displacement).", art: "displacer",
  },
  griffon: { // SRD Griffon: bite +8 (2d6+4), pounce, rake.
    name: "Griffon", emoji: "\u{1F985}", cr: 4, role: "melee", hp: 59, ac: 17, dmg: "2d6+4", hit: 8, range: 1, speed: 40,
    str: 8, dex: 5, con: 6, int: 1, wis: 3, cha: 1, subtypes: ["magical_beast"],
    special: "Pounce; rake 1d6+2; fly.", art: "griffon",
  },
  gargoyle: { // SRD Gargoyle: claw +6 (1d4+2), DR 10/magic, freeze.
    name: "Gargoyle", emoji: "\u{1F5FF}", cr: 4, role: "melee", hp: 37, ac: 16, dmg: "1d4+2", hit: 6, range: 1, speed: 40,
    str: 5, dex: 4, con: 8, int: 1, wis: 1, cha: 1, subtypes: ["magical_beast", "earth"],
    special: "DR 10/magic; freeze (poses as a statue); fly.", art: "gargoyle",
  },
  filth_maw: { // SRD Otyugh reskin: tentacle +4 (1d6), constrict, disease.
    name: "Filth-Maw", emoji: "\u{1F9A0}", cr: 4, role: "melee", hp: 36, ac: 17, dmg: "1d6", hit: 4, range: 2, speed: 20,
    str: 8, dex: 1, con: 8, int: 1, wis: 2, cha: 1, subtypes: ["aberration"],
    special: "Constrict; disease (filth fever); lurks in sewers.", art: "otyugh",
  },
  ogre: { // SRD Ogre: greatclub +8 (2d8+7), Large reach.
    name: "Ogre", emoji: "\u{1F9CC}", cr: 4, role: "melee", hp: 29, ac: 16, dmg: "2d8+7", hit: 8, range: 2, speed: 30,
    str: 11, dex: 1, con: 5, int: 1, wis: 1, cha: 1, subtypes: ["giant"],
    special: "Big crushing swings; darkvision 60.", art: "ogre",
  },
  wraith: { // SRD Wraith: incorporeal touch +5 (1d4 + Con drain).
    name: "Wraith", emoji: "\u{1F47B}", cr: 4, role: "melee", hp: 32, ac: 15, dmg: "1d4", hit: 5, range: 1, speed: 40,
    str: 1, dex: 6, con: 1, int: 4, wis: 4, cha: 5, subtypes: ["undead", "incorporeal"],
    special: "Incorporeal; 1d6 Con drain; create spawn; powerless in daylight.", art: "wraith",
  },
  gray_ooze: { // SRD Gray Ooze: slam +3 (1d6+1 + 1d6 acid), dissolves metal.
    name: "Gray Ooze", emoji: "\u{1F9A0}", cr: 4, role: "melee", hp: 31, ac: 5, dmg: "2d6", hit: 3, range: 1, speed: 10,
    str: 2, dex: 1, con: 1, int: 1, wis: 1, cha: 1, subtypes: ["ooze"],
    special: "Acid dissolves metal/stone; improved grab; near-transparent (surprise).", art: "ooze",
  },
  troll: { // SRD Troll: claw +9 (1d6+6), regeneration 5, rend.
    name: "Troll", emoji: "\u{1F9CC}", cr: 5, role: "melee", hp: 63, ac: 16, dmg: "1d6+6", hit: 9, range: 2, speed: 30,
    str: 13, dex: 4, con: 13, int: 1, wis: 1, cha: 1, subtypes: ["giant"],
    special: "Regeneration 5 (fire/acid stops it); rend 2d6+9.", art: "troll",
  },
  shambling_mound: { // SRD Shambling Mound: slam +11 (2d6+5), electricity heals it.
    name: "Shambling Mound", emoji: "\u{1F33F}", cr: 5, role: "melee", hp: 60, ac: 20, dmg: "2d6+5", hit: 11, range: 2, speed: 20,
    str: 11, dex: 1, con: 7, int: 1, wis: 1, cha: 1, subtypes: ["plant"],
    special: "Constrict; immune to electricity (heals it); improved grab.", art: "shambler",
  },
  mummy: { // SRD Mummy: slam +11 (1d6+10 + mummy rot), DR 5/-, despair.
    name: "Mummy", emoji: "\u{1F9DF}", cr: 5, role: "melee", hp: 55, ac: 20, dmg: "1d6+10", hit: 11, range: 1, speed: 20,
    str: 14, dex: 1, con: 1, int: 1, wis: 4, cha: 5, subtypes: ["undead"],
    special: "DR 5/-; fire vulnerable; despair (Will DC 16 paralyze); mummy rot.", art: "mummy",
  },
  chimera: { // SRD Chimera: three heads (2d6+4 / 1d8+4 / gore), fire breath.
    name: "Chimera", emoji: "\u{1F409}", cr: 5, role: "melee", hp: 76, ac: 19, dmg: "2d6+4", hit: 10, range: 2, speed: 30,
    str: 9, dex: 3, con: 7, int: 1, wis: 3, cha: 1, subtypes: ["magical_beast"],
    special: "Breath weapon (fire 3d8, Ref DC 17); fly; three heads.", art: "chimera",
  },
  wyvern: { // SRD Wyvern: sting +10 (1d6+4 + poison), bite, fly.
    name: "Wyvern", emoji: "\u{1F409}", cr: 5, role: "melee", hp: 59, ac: 18, dmg: "2d8+4", hit: 8, range: 2, speed: 40,
    str: 9, dex: 2, con: 5, int: 1, wis: 2, cha: 1, subtypes: ["dragon"],
    special: "Poison sting (Fort DC 17, 2d6 Con); fly; pounce.", art: "wyvern",
  },
  girallon: { // SRD Girallon: four claws +12 (1d4+7), rend.
    name: "Girallon", emoji: "\u{1F98D}", cr: 5, role: "melee", hp: 58, ac: 16, dmg: "1d4+7", hit: 12, range: 1, speed: 40,
    str: 12, dex: 5, con: 4, int: 1, wis: 2, cha: 1, subtypes: ["magical_beast"],
    special: "Four arms; rend 2d4+10; climb.", art: "girallon",
  },
  dire_bear: { // SRD Dire Bear: claw +19 (2d4+10), rend. SCALED: HP 105→80, hit +19→+12, dmg→14 (HP/hit outlier).
    name: "Dire Bear", emoji: "\u{1F43B}", cr: 6, role: "melee", hp: 80, ac: 18, dmg: 14, hit: 12, range: 2, speed: 40, scaled: true,
    str: 17, dex: 3, con: 9, int: 1, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Improved grab; rend 2d4+10.", art: "dire-bear",
  },
  lamia: { // SRD Lamia: touch +11 (1d4 Wis drain), claws, spell-likes.
    name: "Lamia", emoji: "\u{1F9DD}", cr: 6, role: "melee", hp: 58, ac: 18, dmg: "1d4+2", hit: 11, range: 1, speed: 60,
    str: 8, dex: 3, con: 2, int: 3, wis: 5, cha: 2, subtypes: ["magical_beast"],
    special: "Wisdom drain (1d4); disguise self; charm monster; suggestion.", art: "lamia",
  },
  hydra_5head: { // SRD 5-Headed Hydra: 5 bites +6 (1d10+3), regen heads. Reskin: Storm Hydra (+10 HP) coastal boss.
    name: "Five-Headed Hydra", emoji: "\u{1F409}", cr: 6, role: "melee", hp: 52, ac: 15, dmg: "1d10+3", hit: 6, range: 2, speed: 30,
    str: 7, dex: 2, con: 10, int: 1, wis: 1, cha: 1, subtypes: ["magical_beast", "aquatic"],
    special: "Five heads (multiattack); regenerates heads unless fire/acid; aquatic.", art: "hydra",
  },
  ogre_mage: { // SRD Ogre Mage: greatsword +10 (2d8+7) + spell-likes (cone of cold).
    name: "Ogre Mage", emoji: "\u{1F9CC}", cr: 6, role: "caster", hp: 37, ac: 18, dmg: "2d8+7", hit: 10, range: 1, speed: 30,
    str: 11, dex: 1, con: 7, int: 4, wis: 4, cha: 7, subtypes: ["giant"],
    spells: ["magic_missile", "burning_hands"],
    special: "Cone of cold; fly; invisibility; charm; gaseous form; regeneration 5.", art: "ogre-mage",
  },
  hill_giant: { // SRD Hill Giant: greatclub +16 (2d8+10), rock throwing. SCALED: HP 102→78, AC 20→19, hit +16→+11, dmg→13.
    name: "Hill Giant", emoji: "\u{1F9CC}", cr: 7, role: "melee", hp: 78, ac: 19, dmg: 13, hit: 11, range: 2, speed: 30, scaled: true,
    str: 15, dex: 1, con: 9, int: 1, wis: 1, cha: 1, subtypes: ["giant"],
    special: "Rock throwing (2d6+7, range 120); rock catching.", art: "giant-hill",
  },
  dire_tiger: { // SRD Dire Tiger: claw +18 (2d4+8), pounce, rake. SCALED: HP 120→80, hit +18→+12, dmg→13.
    name: "Dire Tiger", emoji: "\u{1F405}", cr: 7, role: "melee", hp: 80, ac: 18, dmg: 13, hit: 12, range: 1, speed: 40, scaled: true,
    str: 17, dex: 5, con: 7, int: 1, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Pounce; improved grab; rake 2d4+4.", art: "dire-tiger",
  },
  stone_giant: { // SRD Stone Giant: greatclub +17 (2d8+12), rocks. SCALED: HP 119→80, AC 25→20, hit +17→+11, dmg→13.
    name: "Stone Giant", emoji: "\u{1F5FF}", cr: 7, role: "melee", hp: 80, ac: 20, dmg: 13, hit: 11, range: 2, speed: 30, scaled: true,
    str: 17, dex: 5, con: 9, int: 1, wis: 2, cha: 1, subtypes: ["giant"],
    special: "Rock throwing (2d8+12, range 180); rock catching.", art: "giant-stone",
  },
  spectre: { // SRD Spectre: incorporeal touch +6 (1d8 + 2 neg levels).
    name: "Spectre", emoji: "\u{1F47B}", cr: 7, role: "melee", hp: 45, ac: 15, dmg: "1d8", hit: 6, range: 1, speed: 50,
    str: 1, dex: 6, con: 1, int: 4, wis: 4, cha: 5, subtypes: ["undead", "incorporeal"],
    special: "Energy drain (2 levels); create spawn; incorporeal; sunlight powerless.", art: "spectre",
  },
  maw_priest: { // Iron Maw lore: feeler +8 (1d4+1), Silent Scream. (monsters.ts cr8.)
    name: "Maw-Priest", emoji: "\u{1F441}️", cr: 8, role: "caster", hp: 44, ac: 15, dmg: "1d4+1", hit: 8, range: 1, speed: 30,
    str: 2, dex: 4, con: 2, int: 9, wis: 7, cha: 7, subtypes: ["aberration"],
    spells: ["magic_missile"],
    special: "Silent Scream (60ft cone, Will DC 17, stun 3d4); hollowing; ward vs magic 25.", art: "maw-priest",
  },
  frost_giant: { // SRD Frost Giant: greataxe +18 (3d6+13). SCALED: HP 133→80, AC 21→20, hit +18→+12, dmg→14.
    name: "Frost Giant", emoji: "\u{1F9CA}", cr: 8, role: "melee", hp: 80, ac: 20, dmg: 14, hit: 12, range: 2, speed: 40, scaled: true,
    str: 19, dex: 1, con: 11, int: 1, wis: 4, cha: 1, subtypes: ["giant"],
    special: "Rock throwing (2d6+9); cold immunity; fire vulnerability.", art: "giant-frost",
  },
  young_black_dragon: { // SRD Young Black Dragon: bite +13 (2d6+4), acid breath. SCALED: HP 105→78, AC 21→20, hit +13→+11, dmg→11.
    name: "Young Black Dragon", emoji: "\u{1F409}", cr: 8, role: "melee", hp: 78, ac: 20, dmg: 11, hit: 11, range: 2, speed: 40, scaled: true,
    str: 7, dex: 1, con: 5, int: 2, wis: 3, cha: 2, subtypes: ["dragon"],
    special: "Acid breath (60ft line, 8d4, Ref DC 17); water breathing; darkness.", art: "dragon-black",
  },
  young_blue_dragon: { // SRD Young Blue Dragon: bite +14 (2d6+4), lightning breath. SCALED: HP 115→80, AC 22→20, hit +14→+12, dmg→11.
    name: "Young Blue Dragon", emoji: "\u{1F409}", cr: 8, role: "melee", hp: 80, ac: 20, dmg: 11, hit: 12, range: 2, speed: 40, scaled: true,
    str: 7, dex: 1, con: 5, int: 4, wis: 5, cha: 4, subtypes: ["dragon"],
    special: "Lightning breath (80ft line, 8d8, Ref DC 18); create/destroy water.", art: "dragon-blue",
  },
  mudwretch: { // monsters.ts: rusty shiv +1 (1d4), pack tactics. Scuttles up from the drains beneath Kardov's Gate.
    name: "Mudwretch", emoji: "\u{1FAB1}", cr: 0.5, role: "melee", hp: 5, ac: 14, dmg: "1d4", hit: 1, range: 1, speed: 30,
    str: 1, dex: 3, con: 2, int: 1, wis: 1, cha: 1, subtypes: ["humanoid"],
    special: "Pack tactics (+1/adjacent ally, max +3). Drain-scuttler of Kardov's Gate.", art: "mudwretch",
  },
  carrion_creeper: { // SRD Carrion Crawler reskin: tendrils +4 (paralysis).
    name: "Carrion Creeper", emoji: "\u{1F41B}", cr: 1, role: "melee", hp: 13, ac: 15, dmg: "1d4", hit: 4, range: 2, speed: 30,
    str: 4, dex: 3, con: 3, int: 1, wis: 5, cha: 1, subtypes: ["aberration"],
    special: "Paralytic tendrils (8 attacks, Fort DC 13, 2d4 rounds).", art: "carrion-crawler",
  },
  fen_lurker: { // monsters.ts: slam +3 (1d6+1 + 1d4 acid), marsh camouflage.
    name: "Fen Lurker", emoji: "\u{1F33F}", cr: 1, role: "melee", hp: 11, ac: 13, dmg: "1d6+1", hit: 3, range: 1, speed: 20,
    str: 5, dex: 1, con: 4, int: 1, wis: 1, cha: 1, subtypes: ["plant"],
    special: "Acid 1d4; camouflage in marsh (Hide +8).", art: "fen-lurker",
  },
  razorbeak: { // monsters.ts: bite +2 (1d4) + latch, flock attack, fly.
    name: "Razorbeak", emoji: "\u{1F426}", cr: 2, role: "melee", hp: 10, ac: 15, dmg: "1d4", hit: 2, range: 1, speed: 40,
    str: 1, dex: 4, con: 1, int: 1, wis: 3, cha: 1, subtypes: ["magical_beast"],
    special: "Fly; flock attack — latch + blood drain 1d4/round.", art: "razorbeak",
  },
  tunnel_brute: { // monsters.ts: greatclub +5 (1d10+4), bred in the mine-warrens below the city.
    name: "Tunnel Brute", emoji: "\u{1F9CC}", cr: 2, role: "melee", hp: 19, ac: 16, dmg: "1d10+4", hit: 5, range: 2, speed: 30,
    str: 7, dex: 2, con: 5, int: 1, wis: 1, cha: 1, subtypes: ["giant"],
    special: "Darkvision 90; light sensitivity (-1 in daylight).", art: "tunnel-brute",
  },
  ridge_stalker: { // SRD Bulette reskin: bite +6 (1d8+4), burrow, leap.
    name: "Ridge Stalker", emoji: "\u{1F988}", cr: 3, role: "melee", hp: 26, ac: 14, dmg: "1d8+4", hit: 6, range: 1, speed: 40,
    str: 7, dex: 2, con: 5, int: 1, wis: 2, cha: 1, subtypes: ["magical_beast"],
    special: "Burrow 20; leaps from the earth (charge +4, knockdown).", art: "bulette",
  },
  shadowcloak: { // SRD Cloaker reskin: tail slap +8 (1d6+5), moan, engulf.
    name: "Shadowcloak", emoji: "\u{1F987}", cr: 5, role: "melee", hp: 45, ac: 19, dmg: "1d6+5", hit: 8, range: 2, speed: 40,
    str: 11, dex: 6, con: 7, int: 4, wis: 5, cha: 5, subtypes: ["aberration"],
    special: "Moan (Fort DC 15, hold 5 rounds); engulf; shadow shift.", art: "cloaker",
  },
  fungal_horror: { // SRD Shambler reskin: slam +11 (2d6+6), lightning heals it.
    name: "Fungal Horror", emoji: "\u{1F344}", cr: 6, role: "melee", hp: 60, ac: 17, dmg: "2d6+6", hit: 11, range: 2, speed: 20,
    str: 9, dex: 1, con: 8, int: 1, wis: 1, cha: 1, subtypes: ["plant"],
    special: "Engulf; immune lightning (heals 1/dmg); constrict.", art: "shambler",
  },
  stone_render: { // monsters.ts: bite +12 (2d6+7), rend, scent.
    name: "Stone Render", emoji: "\u{1F98F}", cr: 6, role: "melee", hp: 65, ac: 19, dmg: "2d6+7", hit: 12, range: 2, speed: 30,
    str: 11, dex: 2, con: 8, int: 1, wis: 3, cha: 1, subtypes: ["magical_beast"],
    special: "Rend +2d8+10 if both claws hit; scent.", art: "stone-render",
  },
  venom_lord: { // monsters.ts: sting +11 (1d8+4 + poison), serpent sorcerer of drowned places.
    name: "Venom Lord", emoji: "\u{1F40D}", cr: 7, role: "caster", hp: 75, ac: 20, dmg: "1d8+4", hit: 11, range: 2, speed: 30,
    str: 8, dex: 4, con: 7, int: 6, wis: 6, cha: 5, subtypes: ["aberration"],
    spells: ["ray_of_frost", "magic_missile"],
    special: "Poison (Fort DC 18, 1d6 Con); spell-likes (charm, hold person).", art: "venom-lord",
  },
  marsh_wyrm: { // monsters.ts adult black marsh-dragon: bite +18 (2d8+7). SCALED: HP 152→85, AC 24→20, hit +18→+12, dmg→14.
    name: "Marsh Wyrm", emoji: "\u{1F409}", cr: 9, role: "melee", hp: 85, ac: 20, dmg: 14, hit: 12, range: 2, speed: 40, scaled: true,
    str: 11, dex: 1, con: 7, int: 4, wis: 5, cha: 4, subtypes: ["dragon"],
    special: "Acid breath (80ft line, 12d4, Ref DC 21); frightful presence; water mastery.", art: "dragon-marsh",
  },
  frost_jarl: { // monsters.ts ice-clan war-chief: greataxe +20 (3d6+15). SCALED: HP 142→85, AC 22→20, hit +20→+12, dmg→14.
    name: "Frost Jarl", emoji: "\u{1F9CA}", cr: 9, role: "melee", hp: 85, ac: 20, dmg: 14, hit: 12, range: 2, speed: 40, scaled: true,
    str: 21, dex: 1, con: 11, int: 2, wis: 4, cha: 3, subtypes: ["giant"],
    special: "Rock throwing (2d6+10); cold immunity; commands frost-kin.", art: "frost-jarl",
  },
  bone_tyrant: { // monsters.ts lich-thing from the Crypts of Ashen Memory: touch +12 (1d8+5 neg). SCALED: HP 104→78, AC 24→20, hit +12→+11.
    name: "Bone Tyrant", emoji: "\u{1F480}", cr: 11, role: "caster", hp: 78, ac: 20, dmg: "1d8+5", hit: 11, range: 1, speed: 30, scaled: true,
    str: 3, dex: 4, con: 1, int: 6, wis: 6, cha: 8, subtypes: ["undead"],
    spells: ["magic_missile"],
    special: "Fear aura (DC 19); paralyzing touch (DC 19); channel negative; turn resist +4.", art: "lich",
  },
  deep_terror: { // SRD Aboleth reskin, rules drowned cities: tentacle +16 (1d8+6). SCALED: HP 119→82, AC 21→20, hit +16→+12, dmg→11.
    name: "Deep Terror", emoji: "\u{1F991}", cr: 12, role: "caster", hp: 82, ac: 20, dmg: 11, hit: 12, range: 2, speed: 30, scaled: true,
    str: 13, dex: 1, con: 9, int: 8, wis: 9, cha: 9, subtypes: ["aberration", "aquatic"],
    spells: ["magic_missile"],
    special: "Enslave (DC 18, dominate 60ft); psionics; mucus cloud (slime).", art: "aboleth",
  },

  // ════════ KARDOV'S GATE DUNGEONS — dungeons.ts (~37 custom bosses/adds) ════════
  // Schema B: no damage dice given → FLAT dmg derived = clamp(3 + floor(str/2) + min(4, elem), 1, 14);
  // `hit` = the block's flat `atk`; `ac` = the block's listed AC (already includes naturalArmor).
  ossuary_ghast: { // dungeons.ts CRYPT_1 r3 The Ossuary (boss).
    name: "Ossuary Ghast", emoji: "\u{1F9DF}", cr: 4, role: "melee", hp: 38, ac: 17, dmg: 7, hit: 5, range: 1, speed: 30, boss: true,
    str: 8, dex: 6, con: 7, int: 4, wis: 3, cha: 5, naturalArmor: 3, subtypes: ["undead"],
    special: "Crypt of Ashen Memory boss; paralysis + stench.", art: "ghast",
  },
  iron_priest_wight: { // dungeons.ts CRYPT_2 r3 Inner Sanctum (mini-boss).
    name: "Iron Priest Wight", emoji: "\u{1F9DF}", cr: 5, role: "melee", hp: 42, ac: 17, dmg: 7, hit: 5, range: 1, speed: 30,
    str: 8, dex: 5, con: 7, int: 4, wis: 5, cha: 6, naturalArmor: 3, subtypes: ["undead"],
    special: "Energy drain; flanked by two ghouls.", art: "wight",
  },
  iron_mummy: { // dungeons.ts CRYPT_2 r4 The Reliquary (boss).
    name: "The Iron Mummy", emoji: "\u{1F9DF}", cr: 6, role: "melee", hp: 55, ac: 19, dmg: 8, hit: 6, range: 1, speed: 20, boss: true,
    str: 10, dex: 4, con: 9, int: 5, wis: 6, cha: 8, naturalArmor: 5, subtypes: ["undead"],
    special: "Despair; mummy rot; DR.", art: "mummy",
  },
  burial_king: { // dungeons.ts CRYPT_3 r3 Burial King's Chamber (boss).
    name: "The Burial King", emoji: "\u{1F480}", cr: 5, role: "melee", hp: 48, ac: 18, dmg: 7, hit: 6, range: 2, speed: 30, boss: true,
    str: 9, dex: 5, con: 8, int: 4, wis: 5, cha: 7, naturalArmor: 4, subtypes: ["undead"],
    special: "Guarded by Barrow Guards (skeletons +3 HP).", art: "skeleton-king",
  },
  rat_king: { // dungeons.ts SEWER_1 r3 Throne of Filth (boss); pony-sized dire rat.
    name: "The Rat King", emoji: "\u{1F400}", cr: 3, role: "melee", hp: 35, ac: 16, dmg: 6, hit: 4, range: 1, speed: 35, boss: true,
    str: 7, dex: 7, con: 6, int: 3, wis: 4, cha: 5, naturalArmor: 3, subtypes: ["beast"],
    special: "Disease; summons rat swarms.", art: "rat-king",
  },
  fungal_shambler: { // dungeons.ts SEWER_2 r2 Fungal Grotto (x2).
    name: "Fungal Shambler", emoji: "\u{1F344}", cr: 3, role: "melee", hp: 28, ac: 14, dmg: 6, hit: 3, range: 2, speed: 20,
    str: 6, dex: 2, con: 7, int: 1, wis: 2, cha: 1, naturalArmor: 3, subtypes: ["plant"],
    special: "Spore burst; slow.", art: "shambler-small",
  },
  sporeling: { // dungeons.ts SEWER_2 r2 Fungal Grotto (minion).
    name: "Sporeling", emoji: "\u{1F344}", cr: 1, role: "melee", hp: 15, ac: 12, dmg: 5, hit: 2, range: 1, speed: 15,
    str: 4, dex: 3, con: 5, int: 1, wis: 1, cha: 1, naturalArmor: 2, subtypes: ["plant"],
    special: "Bursts into spores on death.", art: "sporeling",
  },
  sewer_cultist: { // dungeons.ts SEWER_2 r3 Cultist Hideout (x2).
    name: "Sewer Cultist", emoji: "\u{1F9D1}", cr: 2, role: "melee", hp: 22, ac: 14, dmg: 5, hit: 3, range: 1, speed: 30,
    str: 4, dex: 5, con: 4, int: 4, wis: 3, cha: 3, naturalArmor: 0, subtypes: ["humanoid"],
    special: "Serves the Dark Altar.", art: "cultist",
  },
  cult_enforcer: { // dungeons.ts SEWER_2 r3 Cultist Hideout.
    name: "Cult Enforcer", emoji: "\u{1F9D1}", cr: 3, role: "melee", hp: 30, ac: 16, dmg: 6, hit: 4, range: 1, speed: 30,
    str: 7, dex: 5, con: 6, int: 2, wis: 2, cha: 2, naturalArmor: 1, subtypes: ["humanoid"],
    special: "Cult muscle.", art: "enforcer",
  },
  shadow_priest: { // dungeons.ts SEWER_2 r4 Dark Altar (boss); chamber predates Kardov's Gate.
    name: "The Shadow Priest", emoji: "\u{1F9D9}", cr: 6, role: "caster", hp: 48, ac: 18, dmg: 5, hit: 5, range: 1, speed: 30, boss: true,
    str: 5, dex: 6, con: 6, int: 8, wis: 7, cha: 8, naturalArmor: 2, subtypes: ["humanoid"],
    spells: ["ray_of_frost", "magic_missile"],
    special: "Shadow magic; summons Shadow Tendrils.", art: "shadow-priest",
  },
  shadow_tendril: { // dungeons.ts SEWER_2 r4 (x2 with Shadow Priest).
    name: "Shadow Tendril", emoji: "\u{1F311}", cr: 2, role: "melee", hp: 18, ac: 15, dmg: 5, hit: 4, range: 2, speed: 25,
    str: 5, dex: 7, con: 3, int: 1, wis: 1, cha: 1, naturalArmor: 1, subtypes: ["aberration", "shadow"],
    special: "Living shadow add.", art: "shadow",
  },
  broodmother_cave: { // dungeons.ts CAVE_1 r3 Queen's Lair (boss); cart-horse-sized spider.
    name: "The Broodmother", emoji: "\u{1F577}️", cr: 5, role: "melee", hp: 45, ac: 17, dmg: 7, hit: 5, range: 2, speed: 35, boss: true,
    str: 8, dex: 7, con: 7, int: 2, wis: 4, cha: 3, naturalArmor: 4, subtypes: ["vermin"],
    special: "Web; poison; spawns Brood Guardians (small spiders).", art: "spider-queen",
  },
  myconid_guard: { // dungeons.ts CAVE_2 r2 Mushroom Forest (x2).
    name: "Myconid Guard", emoji: "\u{1F344}", cr: 3, role: "melee", hp: 32, ac: 15, dmg: 6, hit: 4, range: 1, speed: 20,
    str: 7, dex: 3, con: 7, int: 3, wis: 5, cha: 2, naturalArmor: 4, subtypes: ["plant"],
    special: "Spore attacks.", art: "myconid",
  },
  myconid_sprout: { // dungeons.ts CAVE_2 r2 Mushroom Forest (minion).
    name: "Myconid Sprout", emoji: "\u{1F344}", cr: 0.5, role: "melee", hp: 12, ac: 12, dmg: 4, hit: 2, range: 1, speed: 15,
    str: 3, dex: 2, con: 4, int: 2, wis: 3, cha: 1, naturalArmor: 2, subtypes: ["plant"],
    special: "Myconid minion.", art: "myconid-small",
  },
  crystal_troll: { // dungeons.ts CAVE_2 r4 Crystal Cavern (boss); with Troll-Thrall Kobolds.
    name: "Crystal Cavern Troll", emoji: "\u{1F9CC}", cr: 6, role: "melee", hp: 58, ac: 18, dmg: 8, hit: 6, range: 2, speed: 30, boss: true,
    str: 11, dex: 4, con: 10, int: 2, wis: 3, cha: 2, naturalArmor: 5, subtypes: ["giant"],
    special: "Regeneration; crystal hide.", art: "troll-crystal",
  },
  animated_armor: { // dungeons.ts TOWER_1 r1 Ground Floor (x2).
    name: "Animated Armor", emoji: "\u{1F6E1}️", cr: 3, role: "melee", hp: 32, ac: 17, dmg: 7, hit: 4, range: 1, speed: 25,
    str: 8, dex: 2, con: 7, int: 1, wis: 1, cha: 1, naturalArmor: 5, subtypes: ["construct"],
    special: "Construct; immune mind-affecting.", art: "animated-armor",
  },
  flying_sword: { // dungeons.ts TOWER_1 r1 Ground Floor (minion).
    name: "Flying Sword", emoji: "\u{1F5E1}️", cr: 2, role: "melee", hp: 18, ac: 15, dmg: 5, hit: 4, range: 1, speed: 30,
    str: 5, dex: 6, con: 3, int: 1, wis: 1, cha: 1, naturalArmor: 2, subtypes: ["construct"],
    special: "Construct; hovers; fly.", art: "flying-sword",
  },
  arcane_guardian: { // dungeons.ts TOWER_1 r2 Library (x2); deals lightning.
    name: "Arcane Guardian", emoji: "\u{1F52E}", cr: 4, role: "caster", hp: 38, ac: 17, dmg: 8, hit: 5, range: 1, speed: 30,
    str: 6, dex: 7, con: 6, int: 6, wis: 5, cha: 4, naturalArmor: 3, subtypes: ["construct"],
    spells: ["magic_missile"],
    special: "Arcane construct; lightning lash.", art: "arcane-guardian",
  },
  bound_elemental: { // dungeons.ts TOWER_1 r3 Summoning Circle (boss); fire + lightning.
    name: "Bound Elemental", emoji: "\u{1F525}", cr: 5, role: "caster", hp: 55, ac: 19, dmg: 11, hit: 6, range: 2, speed: 35, boss: true,
    str: 9, dex: 8, con: 8, int: 3, wis: 4, cha: 5, naturalArmor: 4, subtypes: ["elemental"],
    spells: ["burning_hands", "ray_of_frost"],
    special: "Fire + lightning; bound to the circle.", art: "elemental",
  },
  frenzied_homunculus: { // dungeons.ts TOWER_2 r1 Laboratory (x2).
    name: "Frenzied Homunculus", emoji: "\u{1F9EA}", cr: 1, role: "melee", hp: 18, ac: 15, dmg: 4, hit: 3, range: 1, speed: 30,
    str: 3, dex: 7, con: 3, int: 4, wis: 2, cha: 1, naturalArmor: 1, subtypes: ["construct"],
    special: "Poison bite (sleep); frenzied.", art: "homunculus",
  },
  alchemical_golem: { // dungeons.ts TOWER_2 r1 Laboratory; deals fire.
    name: "Alchemical Golem", emoji: "\u{1F9EA}", cr: 4, role: "melee", hp: 35, ac: 16, dmg: 9, hit: 4, range: 1, speed: 20,
    str: 8, dex: 3, con: 8, int: 1, wis: 1, cha: 1, naturalArmor: 4, subtypes: ["construct"],
    special: "Alchemical fire splash; construct.", art: "golem",
  },
  malachar: { // dungeons.ts TOWER_2 r3 Observatory (named boss); fire + lightning.
    name: "Malachar, the Mad Apprentice", emoji: "\u{1F9D9}", cr: 6, role: "caster", hp: 52, ac: 18, dmg: 9, hit: 6, range: 1, speed: 30, boss: true,
    str: 4, dex: 7, con: 6, int: 10, wis: 3, cha: 7, naturalArmor: 2, subtypes: ["humanoid"],
    spells: ["burning_hands", "magic_missile"],
    special: "Fire + lightning blasts; summons Star Wisps.", art: "mad-apprentice",
  },
  star_wisp: { // dungeons.ts TOWER_2 r3 (x2 with Malachar).
    name: "Star Wisp", emoji: "\u{2728}", cr: 2, role: "caster", hp: 15, ac: 16, dmg: 5, hit: 4, range: 1, speed: 40,
    str: 1, dex: 8, con: 2, int: 3, wis: 3, cha: 3, naturalArmor: 1, subtypes: ["aberration"],
    spells: ["ray_of_frost"],
    special: "Lightning mote; fast.", art: "wisp",
  },
  stone_sentinel: { // dungeons.ts DWARVEN_1 r3 Forge Room (boss).
    name: "Stone Sentinel", emoji: "\u{1F5FF}", cr: 5, role: "melee", hp: 52, ac: 19, dmg: 8, hit: 6, range: 2, speed: 20, boss: true,
    str: 10, dex: 2, con: 10, int: 1, wis: 4, cha: 1, naturalArmor: 6, subtypes: ["construct", "earth"],
    special: "Slam; construct; forge-bound.", art: "sentinel",
  },
  dwarven_warden: { // dungeons.ts DWARVEN_2 r3 The Armory (mini-boss); with Hobgoblin Raiders.
    name: "Dwarven Warden", emoji: "\u{1F6E1}️", cr: 5, role: "melee", hp: 55, ac: 19, dmg: 8, hit: 6, range: 1, speed: 20,
    str: 10, dex: 3, con: 9, int: 3, wis: 5, cha: 1, naturalArmor: 6, subtypes: ["construct"],
    special: "Armory guard construct.", art: "warden",
  },
  cursed_king: { // dungeons.ts DWARVEN_2 r4 Throne Room (boss); highest-HP named boss (75).
    name: "The Cursed King", emoji: "\u{1F451}", cr: 8, role: "melee", hp: 75, ac: 20, dmg: 9, hit: 8, range: 2, speed: 25, boss: true,
    str: 12, dex: 4, con: 11, int: 6, wis: 7, cha: 10, naturalArmor: 5, subtypes: ["undead"],
    special: "Curse; undead dwarf-lord; Cursed Honor Guard adds.", art: "cursed-king",
  },
  cursed_honor_guard: { // dungeons.ts DWARVEN_2 r4 (x2 with Cursed King).
    name: "Cursed Honor Guard", emoji: "\u{1F6E1}️", cr: 4, role: "melee", hp: 38, ac: 18, dmg: 7, hit: 5, range: 1, speed: 20,
    str: 8, dex: 3, con: 8, int: 2, wis: 3, cha: 2, naturalArmor: 4, subtypes: ["undead"],
    special: "Cursed dwarf add.", art: "honor-guard",
  },
  lesser_imp: { // dungeons.ts DEMONIC_1 r1 (x4) / r3 (x2); deals fire.
    name: "Lesser Imp", emoji: "\u{1F47F}", cr: 1, role: "melee", hp: 18, ac: 15, dmg: 5, hit: 3, range: 1, speed: 30,
    str: 3, dex: 7, con: 3, int: 4, wis: 3, cha: 4, naturalArmor: 2, subtypes: ["outsider", "evil"],
    special: "Fast healing; fire touch.", art: "imp",
  },
  fiendish_hound: { // dungeons.ts DEMONIC_1 r2 Summoning Pit (x2); fire.
    name: "Fiendish Hound", emoji: "\u{1F415}", cr: 3, role: "melee", hp: 30, ac: 16, dmg: 8, hit: 5, range: 1, speed: 40,
    str: 7, dex: 6, con: 6, int: 2, wis: 3, cha: 2, naturalArmor: 3, subtypes: ["outsider", "evil", "fire"],
    special: "Fiery bite; pack hunter.", art: "hellhound",
  },
  summoner_imp: { // dungeons.ts DEMONIC_1 r2 Summoning Pit; fire.
    name: "Summoner Imp", emoji: "\u{1F47F}", cr: 3, role: "caster", hp: 25, ac: 16, dmg: 6, hit: 4, range: 1, speed: 30,
    str: 3, dex: 6, con: 4, int: 6, wis: 4, cha: 5, naturalArmor: 2, subtypes: ["outsider", "evil"],
    spells: ["burning_hands"],
    special: "Summons more imps; fire.", art: "imp-summoner",
  },
  pit_fiend_lt: { // dungeons.ts DEMONIC_1 r3 The Gate (boss); highest fire dmg.
    name: "Pit Fiend Lieutenant", emoji: "\u{1F47F}", cr: 7, role: "caster", hp: 65, ac: 20, dmg: 12, hit: 7, range: 2, speed: 30, boss: true,
    str: 11, dex: 6, con: 10, int: 7, wis: 6, cha: 9, naturalArmor: 5, subtypes: ["outsider", "evil", "fire"],
    spells: ["burning_hands", "magic_missile"],
    special: "Spell-likes; fear; hellfire.", art: "pit-fiend",
  },
  corrupted_elemental: { // dungeons.ts DEMONIC_2 r2 Blood Pool.
    name: "Corrupted Elemental", emoji: "\u{1FA78}", cr: 5, role: "melee", hp: 50, ac: 18, dmg: 7, hit: 6, range: 2, speed: 30,
    str: 9, dex: 6, con: 9, int: 2, wis: 3, cha: 4, naturalArmor: 4, subtypes: ["elemental", "corrupted"],
    special: "Blood-corrupted slam.", art: "elemental-corrupt",
  },
  blood_tendril: { // dungeons.ts DEMONIC_2 r2 (x2).
    name: "Blood Tendril", emoji: "\u{1FA78}", cr: 2, role: "melee", hp: 20, ac: 14, dmg: 5, hit: 4, range: 2, speed: 20,
    str: 5, dex: 5, con: 4, int: 1, wis: 1, cha: 1, naturalArmor: 2, subtypes: ["elemental", "corrupted"],
    special: "Reaching corrupted add.", art: "tendril",
  },
  corruption_avatar: { // dungeons.ts DEMONIC_2 r3 Heart Chamber (final boss); highest-HP dungeon enemy (80).
    name: "Corruption Avatar", emoji: "\u{1F479}", cr: 9, role: "melee", hp: 80, ac: 20, dmg: 12, hit: 8, range: 2, speed: 25, boss: true,
    str: 12, dex: 5, con: 11, int: 6, wis: 5, cha: 10, naturalArmor: 5, subtypes: ["aberration", "corrupted"],
    special: "Fire; corruption aura; Corruption Spawn adds.", art: "avatar",
  },
  corruption_spawn: { // dungeons.ts DEMONIC_2 r3 (x2).
    name: "Corruption Spawn", emoji: "\u{1F479}", cr: 2, role: "melee", hp: 22, ac: 14, dmg: 6, hit: 4, range: 1, speed: 25,
    str: 6, dex: 5, con: 5, int: 1, wis: 1, cha: 1, naturalArmor: 2, subtypes: ["aberration", "corrupted"],
    special: "Corruption add.", art: "spawn",
  },
  broodmother_webwood: { // dungeons.ts FOREST_1 r3 Broodmother's Den (boss); distinct from the CAVE_1 broodmother.
    name: "Broodmother Spider", emoji: "\u{1F577}️", cr: 4, role: "melee", hp: 36, ac: 16, dmg: 6, hit: 5, range: 2, speed: 30, boss: true,
    str: 7, dex: 7, con: 6, int: 1, wis: 3, cha: 1, naturalArmor: 3, subtypes: ["vermin"],
    special: "Webwood den; web; poison.", art: "spider-queen2",
  },
  captain_blacktide: { // dungeons.ts COASTAL_1 r3 The Captain's Grotto (boss); smuggler captain — PRIME Seize-the-Seas reuse.
    name: "Captain Blacktide", emoji: "\u{1F3F4}‍☠️", cr: 6, role: "melee", hp: 42, ac: 17, dmg: 6, hit: 6, range: 1, speed: 30, boss: true,
    str: 6, dex: 8, con: 5, int: 5, wis: 4, cha: 6, naturalArmor: 2, subtypes: ["humanoid"],
    special: "Pirate captain with a pet crocodile + First Mates. The seas-game's signature boarding boss.", art: "pirate-captain",
  },

  // ════════ SRD CR 0–5 COMPLETION FILL (2026-07-01) ════════
  // Every remaining SRD 3.5 (Open Game License) monster CR 0–5 not already above, so the
  // whole low-CR Monster Manual is droppable into combat. Same -10 ability convention, same
  // fields. Product-Identity creatures are DELIBERATELY skipped (see report). No WILD outliers
  // in this band (all HP<90, AC<21, hit<+15) so nothing here is `scaled`.

  // ── CR 0 — critters / familiars / vermin (D&D score −10, min 0) ──
  cat: { // SRD Cat: 2 claws +4 (1d2−4), bite +−1 (1d3−4). Tiny animal.
    name: "Cat", emoji: "\u{1F408}", cr: 0, role: "melee", hp: 2, ac: 14, dmg: 1, hit: 4, range: 1, speed: 30,
    str: 0, dex: 5, con: 0, int: 0, wis: 2, cha: 3, subtypes: ["beast"],
    special: "Low-light vision; scent; climb. A familiar/critter, not a real threat.", art: "cat",
  },
  rat: { // SRD Rat: bite +4 (1d3−4). Tiny vermin/animal.
    name: "Rat", emoji: "\u{1F401}", cr: 0, role: "melee", hp: 1, ac: 14, dmg: 1, hit: 4, range: 1, speed: 15,
    str: 0, dex: 5, con: 0, int: 0, wis: 2, cha: 0, subtypes: ["beast"],
    special: "Low-light; scent; climb/swim. Single sewer rat (see rat_swarm for the pack).", art: "rat",
  },
  bat: { // SRD Bat: no effective attack; blindsense (echolocation). Diminutive animal.
    name: "Bat", emoji: "\u{1F987}", cr: 0, role: "melee", hp: 1, ac: 16, dmg: 1, hit: 3, range: 1, speed: 40,
    str: 0, dex: 5, con: 0, int: 0, wis: 4, cha: 0, subtypes: ["beast"],
    special: "Fly 40; blindsense 20 (echolocation). Flits, barely bites.", art: "bat",
  },
  toad: { // SRD Toad: harmless. Diminutive animal familiar.
    name: "Toad", emoji: "\u{1F438}", cr: 0, role: "melee", hp: 1, ac: 15, dmg: 1, hit: 0, range: 1, speed: 5,
    str: 0, dex: 2, con: 1, int: 0, wis: 4, cha: 0, subtypes: ["beast"],
    special: "Low-light vision; amphibious. A familiar, not a fighter.", art: "toad",
  },
  lizard: { // SRD Lizard: bite +4 (1d4−4). Tiny animal.
    name: "Lizard", emoji: "\u{1F98E}", cr: 0, role: "melee", hp: 1, ac: 14, dmg: 1, hit: 4, range: 1, speed: 20,
    str: 0, dex: 5, con: 0, int: 0, wis: 2, cha: 0, subtypes: ["beast"],
    special: "Climb; low-light. Ordinary reptile.", art: "lizard",
  },
  weasel: { // SRD Weasel: bite +4 (1d3−4) + attach. Tiny animal.
    name: "Weasel", emoji: "\u{1F9A6}", cr: 0, role: "melee", hp: 2, ac: 14, dmg: 1, hit: 4, range: 1, speed: 20,
    str: 0, dex: 5, con: 0, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Attach on a hit; scent. (See dire_weasel for the CR2 version.)", art: "weasel",
  },
  owl: { // SRD Owl: talons +3 (1d4−3). Tiny animal.
    name: "Owl", emoji: "\u{1F989}", cr: 0, role: "melee", hp: 2, ac: 15, dmg: 1, hit: 3, range: 1, speed: 40,
    str: 0, dex: 5, con: 0, int: 0, wis: 4, cha: 4, subtypes: ["beast"],
    special: "Fly 40; low-light vision; superb spot. A familiar/scout.", art: "owl",
  },
  hawk: { // SRD Hawk: talons +5 (1d4−2). Tiny animal.
    name: "Hawk", emoji: "\u{1F985}", cr: 0, role: "melee", hp: 2, ac: 17, dmg: 1, hit: 5, range: 1, speed: 60,
    str: 0, dex: 7, con: 1, int: 0, wis: 4, cha: 1, subtypes: ["beast"],
    special: "Fly 60; keen sight. Diving raptor.", art: "hawk",
  },
  raven: { // SRD Raven: claws +4 (1d2−5). Tiny animal familiar.
    name: "Raven", emoji: "\u{1F426}\u{200D}\u{2B1B}", cr: 0, role: "melee", hp: 1, ac: 14, dmg: 1, hit: 4, range: 1, speed: 40,
    str: 0, dex: 5, con: 0, int: 0, wis: 4, cha: 1, subtypes: ["beast"],
    special: "Fly 40; can mimic sounds. A witch's familiar.", art: "raven",
  },
  monkey: { // SRD Monkey: bite +4 (1d3−4). Tiny animal.
    name: "Monkey", emoji: "\u{1F412}", cr: 0, role: "melee", hp: 1, ac: 14, dmg: 1, hit: 4, range: 1, speed: 30,
    str: 0, dex: 5, con: 0, int: 0, wis: 2, cha: 3, subtypes: ["beast"],
    special: "Climb 30; low-light. Ship's-monkey nuisance.", art: "monkey",
  },
  dog: { // SRD Dog: bite +2 (1d4+1). Small animal.
    name: "Dog", emoji: "\u{1F415}", cr: 0, role: "melee", hp: 6, ac: 15, dmg: "1d4+1", hit: 2, range: 1, speed: 40,
    str: 3, dex: 5, con: 5, int: 0, wis: 2, cha: 2, subtypes: ["beast"],
    special: "Scent; low-light. A guard/hunting dog. (Riding dog = a tougher variant.)", art: "dog",
  },
  small_centipede: { // SRD Small Monstrous Centipede: bite +2 (1d4−1 + poison). Small vermin.
    name: "Small Centipede", emoji: "\u{1F41B}", cr: 0.13, role: "melee", hp: 2, ac: 14, dmg: "1d4-1", hit: 2, range: 1, speed: 30,
    str: 0, dex: 5, con: 0, int: 0, wis: 0, cha: 0, subtypes: ["vermin"],
    special: "Poison (Dex, Fort DC 9); climb; darkvision. (See giant_centipede for the CR1.)", art: "centipede-small",
  },

  // ── CR 1/8–1/4 — small threats, mounts, minor outsiders ──
  pony: { // SRD Pony: hooves +−1 (1d3). Medium animal mount.
    name: "Pony", emoji: "\u{1F40E}", cr: 0.25, role: "melee", hp: 13, ac: 13, dmg: "1d3", hit: 0, range: 1, speed: 40,
    str: 3, dex: 3, con: 4, int: 0, wis: 1, cha: 0, subtypes: ["beast"],
    special: "Low-light; scent. A child/halfling mount.", art: "pony",
  },
  viper_tiny: { // SRD Tiny Viper Snake: bite +4 (poison). Tiny animal.
    name: "Tiny Viper", emoji: "\u{1F40D}", cr: 0.25, role: "melee", hp: 2, ac: 17, dmg: 1, hit: 4, range: 1, speed: 15,
    str: 0, dex: 7, con: 1, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Poison (Con, Fort DC 10); climb/swim; scent.", art: "snake-viper",
  },
  eagle: { // SRD Eagle: 2 talons +3 (1d4), bite +−2 (1d4). Small animal.
    name: "Eagle", emoji: "\u{1F985}", cr: 0.5, role: "melee", hp: 4, ac: 14, dmg: "1d4", hit: 3, range: 1, speed: 80,
    str: 2, dex: 5, con: 2, int: 0, wis: 4, cha: 3, subtypes: ["beast"],
    special: "Fly 80; keen sight (Spot +14). A diving raptor.", art: "eagle",
  },
  octopus: { // SRD Octopus: arms +3 (0, grab), bite +3 (1d3), ink, jet. Small animal (aquatic).
    name: "Octopus", emoji: "\u{1F419}", cr: 0.5, role: "melee", hp: 11, ac: 16, dmg: "1d3", hit: 3, range: 1, speed: 20,
    str: 2, dex: 5, con: 3, int: 0, wis: 2, cha: 3, subtypes: ["beast", "aquatic"],
    special: "Improved grab; ink cloud (escape); jet swim; amphibious.", art: "octopus",
  },
  giant_frog: { // SRD Giant Frog: tongue +3 (grab) + bite (1d4+1). Medium animal.
    name: "Giant Frog", emoji: "\u{1F438}", cr: 0.5, role: "melee", hp: 9, ac: 12, dmg: "1d4+1", hit: 3, range: 2, speed: 30,
    str: 2, dex: 3, con: 2, int: 0, wis: 2, cha: 0, subtypes: ["beast", "aquatic"],
    special: "Sticky tongue: pull + bite (reach 2); amphibious; swim.", art: "frog-giant",
  },
  dretch: { // SRD Dretch (demon, tanar'ri): 2 claws +2 (1d4), bite (1d4), stinking cloud 1/day.
    name: "Dretch", emoji: "\u{1F47F}", cr: 2, role: "melee", hp: 15, ac: 16, dmg: "1d4", hit: 2, range: 1, speed: 20,
    str: 2, dex: 0, con: 4, int: 0, wis: 1, cha: 1, subtypes: ["outsider", "evil", "chaotic"],
    special: "Stinking cloud 1/day; summon another dretch; DR 5/cold iron; darkvision 60. Lowly demon fodder.", art: "dretch",
  },
  lemure: { // SRD Lemure (devil, baatezu): claws +1 (1d3), DR 5/silver+good, mindless.
    name: "Lemure", emoji: "\u{1F47F}", cr: 1, role: "melee", hp: 13, ac: 14, dmg: "1d3", hit: 1, range: 1, speed: 20,
    str: 3, dex: 0, con: 3, int: 0, wis: 1, cha: 1, subtypes: ["outsider", "evil", "lawful"],
    special: "DR 5/silver or good; mindless; resist fire; darkvision. The devils' rank-and-file.", art: "lemure",
  },

  // ── CR 1 — beasts, minor fey, mephits, dragon wyrmlings ──
  black_bear: { // SRD Black Bear: 2 claws +4 (1d4+2), bite +−1 (1d6+1). Medium animal.
    name: "Black Bear", emoji: "\u{1F43B}", cr: 2, role: "melee", hp: 19, ac: 13, dmg: "1d4+2", hit: 4, range: 1, speed: 40,
    str: 5, dex: 3, con: 4, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Scent; low-light. (See dire_bear for the SCALED CR6.)", art: "bear-black",
  },
  leopard: { // SRD Leopard: bite +6 (1d6+1), 2 claws (1d3), pounce, rake, improved grab. Medium animal.
    name: "Leopard", emoji: "\u{1F406}", cr: 2, role: "melee", hp: 19, ac: 15, dmg: "1d6+1", hit: 6, range: 1, speed: 50,
    str: 6, dex: 9, con: 5, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Pounce; rake 1d3+1; improved grab; scent. A big spotted cat.", art: "leopard",
  },
  giant_lizard: { // SRD Monitor Lizard: bite +4 (1d8+4). Medium animal.
    name: "Monitor Lizard", emoji: "\u{1F98E}", cr: 2, role: "melee", hp: 22, ac: 15, dmg: "1d8+4", hit: 4, range: 1, speed: 30,
    str: 7, dex: 5, con: 7, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Scent; swim; low-light. A big monitor/komodo.", art: "lizard-giant",
  },
  pixie: { // SRD Pixie (fey): short sword +6 (1d4−1) / bow, invisibility, spell-likes.
    name: "Pixie", emoji: "\u{1F9DA}", cr: 4, role: "caster", hp: 6, ac: 16, dmg: "1d4-1", hit: 6, range: 3, speed: 30,
    str: 0, dex: 8, con: 1, int: 6, wis: 5, cha: 6, subtypes: ["fey"],
    spells: ["magic_missile"],
    special: "Greater invisibility (at will); fly 60; DR 10/cold iron; spell-likes (lesser confusion, dancing lights). Bow shots at range 3.", art: "pixie",
  },
  dryad: { // SRD Dryad (fey): club +3 (1d6), or improvised, spell-likes (charm, tree stride).
    name: "Dryad", emoji: "\u{1F9DA}", cr: 3, role: "caster", hp: 14, ac: 13, dmg: "1d6", hit: 3, range: 1, speed: 30,
    str: 0, dex: 9, con: 1, int: 6, wis: 5, cha: 7, subtypes: ["fey"],
    spells: ["magic_missile"],
    special: "Charm person (DC 18, spell-like); tree dependent; wild empathy; entangle. Guardian of a tree.", art: "dryad",
  },
  satyr: { // SRD Satyr (fey): head-butt +4 (1d6+1) / dagger, pipes (sleep/fear/charm).
    name: "Satyr", emoji: "\u{1F9DA}", cr: 2, role: "melee", hp: 26, ac: 15, dmg: "1d6+1", hit: 4, range: 1, speed: 40,
    str: 2, dex: 3, con: 3, int: 2, wis: 3, cha: 3, subtypes: ["fey"],
    special: "Pan-pipes (Will DC 13: sleep, fear, or charm); DR 5/cold iron; low-light. A woodland trickster.", art: "satyr",
  },
  thoqqua: { // SRD Thoqqua (elemental, fire/earth): slam +3 (2d6 + 2d6 heat + burn). Medium.
    name: "Thoqqua", emoji: "\u{1F525}", cr: 2, role: "melee", hp: 13, ac: 18, dmg: "2d6", hit: 3, range: 1, speed: 30,
    str: 3, dex: 3, con: 3, int: 0, wis: 1, cha: 1, subtypes: ["elemental", "fire", "earth"],
    special: "Heated body (+2d6 fire on hit); burn; burrow through stone; immune fire; vulnerable cold.", art: "thoqqua",
  },
  mephit_fire: { // SRD Fire Mephit (elemental outsider): 2 claws +3 (1d3+1 fire), breath, spell-like.
    name: "Fire Mephit", emoji: "\u{1F525}", cr: 3, role: "caster", hp: 13, ac: 16, dmg: "1d3+1", hit: 3, range: 2, speed: 30,
    str: 3, dex: 5, con: 2, int: 2, wis: 1, cha: 5, subtypes: ["outsider", "fire"],
    spells: ["burning_hands"],
    special: "Breath weapon (15ft cone 1d8 fire, Ref DC 11); fast healing 2 near flame; fly 40; immune fire.", art: "mephit-fire",
  },
  mephit_ice: { // SRD Ice Mephit: 2 claws +4 (1d3+1 cold), frost breath, chill metal spell-like.
    name: "Ice Mephit", emoji: "\u{2744}\u{FE0F}", cr: 3, role: "caster", hp: 13, ac: 18, dmg: "1d3+1", hit: 4, range: 2, speed: 30,
    str: 3, dex: 5, con: 3, int: 2, wis: 1, cha: 5, subtypes: ["outsider", "cold"],
    spells: ["ray_of_frost"],
    special: "Frost breath (1d4 cold + slow, Ref DC 11); fast healing near cold/snow; fly 40; immune cold; vulnerable fire.", art: "mephit-ice",
  },
  pseudodragon: { // SRD Pseudodragon (dragon): bite +6 (1d3−2), sting +6 (1d3−2 + poison/sleep).
    name: "Pseudodragon", emoji: "\u{1F432}", cr: 1, role: "melee", hp: 7, ac: 18, dmg: "1d3", hit: 6, range: 1, speed: 15,
    str: 0, dex: 5, con: 3, int: 0, wis: 2, cha: 0, subtypes: ["dragon"],
    special: "Sting poison (Fort DC 14 or sleep 1 min/1 hr); fly 60; blindsense; telepathy. A tiny good dragon.", art: "pseudodragon",
  },
  dragon_wyrmling_white: { // SRD White Dragon Wyrmling: bite +4 (1d6), cold breath 2d6.
    name: "White Dragon Wyrmling", emoji: "\u{1F409}", cr: 2, role: "melee", hp: 22, ac: 16, dmg: "1d6", hit: 4, range: 1, speed: 40,
    str: 3, dex: 0, con: 3, int: 0, wis: 1, cha: 1, subtypes: ["dragon", "cold"],
    special: "Cold breath (15ft cone, 2d6, Ref DC 13); swim/burrow; immune cold; icewalking. Baby white dragon.", art: "dragon-white-wyrmling",
  },
  dragon_wyrmling_black: { // SRD Black Dragon Wyrmling: bite +4 (1d6+1), acid breath 2d4.
    name: "Black Dragon Wyrmling", emoji: "\u{1F409}", cr: 3, role: "melee", hp: 26, ac: 16, dmg: "1d6+1", hit: 4, range: 1, speed: 40,
    str: 3, dex: 0, con: 3, int: 0, wis: 1, cha: 1, subtypes: ["dragon", "water"],
    special: "Acid breath (30ft line, 2d4, Ref DC 13); swim; water-breathing; immune acid. Baby black dragon.", art: "dragon-black-wyrmling",
  },
  dragon_wyrmling_red: { // SRD Red Dragon Wyrmling: bite +7 (1d8+4), fire breath 2d10.
    name: "Red Dragon Wyrmling", emoji: "\u{1F409}", cr: 4, role: "melee", hp: 37, ac: 17, dmg: "1d8+4", hit: 7, range: 1, speed: 40,
    str: 7, dex: 0, con: 5, int: 2, wis: 1, cha: 2, subtypes: ["dragon", "fire"],
    special: "Fire breath (30ft cone, 2d10, Ref DC 15); fly 100; immune fire; vulnerable cold. Baby red dragon.", art: "dragon-red-wyrmling",
  },

  // ── CR 2–3 — mid beasts, constructs, elementals, celestials ──
  centaur: { // SRD Centaur (monstrous humanoid): longsword +8 (1d8+4) + 2 hooves, or longbow.
    name: "Centaur", emoji: "\u{1F3C7}", cr: 3, role: "melee", hp: 26, ac: 14, dmg: "1d8+4", hit: 8, range: 3, speed: 50,
    str: 8, dex: 4, con: 5, int: 0, wis: 3, cha: 1, subtypes: ["monstrous_humanoid"],
    special: "Longbow at range 3 (1d8+2) then charge; darkvision. A plains rider-beast.", art: "centaur",
  },
  choker: { // SRD Choker (aberration): 2 tentacles +6 (1d3+3), improved grab, constrict, quickness.
    name: "Choker", emoji: "\u{1F419}", cr: 2, role: "melee", hp: 16, ac: 17, dmg: "1d3+3", hit: 6, range: 2, speed: 20,
    str: 6, dex: 4, con: 3, int: 0, wis: 3, cha: 1, subtypes: ["aberration"],
    special: "Constrict 1d3+3; improved grab; quickness (extra action); climb. Lurks in cave chokepoints.", art: "choker",
  },
  shocker_lizard: { // SRD Shocker Lizard (magical beast): bite +4 (1d4), stun/lethal shock.
    name: "Shocker Lizard", emoji: "\u{26A1}", cr: 2, role: "melee", hp: 15, ac: 16, dmg: "1d4", hit: 4, range: 2, speed: 40,
    str: 0, dex: 5, con: 3, int: 0, wis: 2, cha: 2, subtypes: ["magical_beast"],
    special: "Stunning shock (2d8 electricity when pack-grouped, Ref DC 13); immune electricity; climb/swim.", art: "shocker-lizard",
  },
  magmin: { // SRD Magmin (elemental, fire): slam +4 (1d3 + 1d6 fire + combustion), DR 5/-.
    name: "Magmin", emoji: "\u{1F30B}", cr: 3, role: "melee", hp: 13, ac: 16, dmg: "1d3", hit: 4, range: 1, speed: 20,
    str: 2, dex: 5, con: 3, int: 0, wis: 1, cha: 1, subtypes: ["elemental", "fire"],
    special: "Fiery touch (+1d6 fire + combustion); DR 5/-; immune fire; explodes on death. A living coal-imp.", art: "magmin",
  },
  air_elemental_sm: { // SRD Small Air Elemental: slam +4 (1d4), whirlwind, fly. CR1.
    name: "Small Air Elemental", emoji: "\u{1F32C}\u{FE0F}", cr: 1, role: "melee", hp: 13, ac: 17, dmg: "1d4", hit: 4, range: 1, speed: 30,
    str: 2, dex: 7, con: 2, int: 0, wis: 1, cha: 1, subtypes: ["elemental", "air"],
    special: "Fly 100 (perfect); whirlwind; air mastery; darkvision. A conjured wind.", art: "elemental-air-sm",
  },
  earth_elemental_sm: { // SRD Small Earth Elemental: slam +5 (1d6+4), earth glide. CR1.
    name: "Small Earth Elemental", emoji: "\u{1FAA8}", cr: 1, role: "melee", hp: 13, ac: 17, dmg: "1d6+4", hit: 5, range: 1, speed: 20,
    str: 7, dex: 0, con: 5, int: 0, wis: 1, cha: 1, subtypes: ["elemental", "earth"],
    special: "Earth glide (through stone); earth mastery; push; darkvision. A conjured stone.", art: "elemental-earth-sm",
  },
  fire_elemental_sm: { // SRD Small Fire Elemental: slam +3 (1d4 + 1d4 fire + burn). CR1.
    name: "Small Fire Elemental", emoji: "\u{1F525}", cr: 1, role: "melee", hp: 11, ac: 15, dmg: "1d4", hit: 3, range: 1, speed: 50,
    str: 0, dex: 5, con: 2, int: 0, wis: 1, cha: 1, subtypes: ["elemental", "fire"],
    special: "Burn (+1d4 fire); immune fire; vulnerable cold; darkvision. A conjured flame.", art: "elemental-fire-sm",
  },
  water_elemental_sm: { // SRD Small Water Elemental: slam +4 (1d6+3), drench, swim. CR1.
    name: "Small Water Elemental", emoji: "\u{1F30A}", cr: 1, role: "melee", hp: 13, ac: 17, dmg: "1d6+3", hit: 4, range: 1, speed: 20,
    str: 4, dex: 0, con: 5, int: 0, wis: 1, cha: 1, subtypes: ["elemental", "water"],
    special: "Swim 90; water mastery; drench (douse fire); darkvision. A conjured wave.", art: "elemental-water-sm",
  },
  celestial_lantern_archon: { // SRD Lantern Archon (celestial): 2 light rays +5 (1d6), aura.
    name: "Lantern Archon", emoji: "\u{1F526}", cr: 2, role: "melee", hp: 13, ac: 15, dmg: "1d6", hit: 5, range: 4, speed: 60,
    str: 0, dex: 1, con: 3, int: 0, wis: 1, cha: 4, subtypes: ["outsider", "good", "lawful"],
    special: "Light rays at range 4 (1d6, no save); DR 10/evil; aura of menace; fly 60; a good outsider (rare foe, common ally).", art: "archon-lantern",
  },
  celestial_hound_archon: { // SRD Hound Archon (celestial): bite +8 (1d8+3) + slam, aura.
    name: "Hound Archon", emoji: "\u{1F415}", cr: 4, role: "melee", hp: 33, ac: 19, dmg: "1d8+3", hit: 8, range: 1, speed: 40,
    str: 6, dex: 3, con: 5, int: 0, wis: 3, cha: 2, subtypes: ["outsider", "good", "lawful"],
    special: "DR 10/evil; aura of menace (Will DC 15); magic circle vs evil; scent; change shape. A celestial guardian.", art: "archon-hound",
  },
  bearded_devil: { // SRD Bearded Devil (baatezu): glaive +7 (1d10+3), beard +2 (1d8 + disease), battle frenzy.
    name: "Bearded Devil", emoji: "\u{1F47F}", cr: 5, role: "melee", hp: 45, ac: 19, dmg: "1d10+3", hit: 7, range: 2, speed: 40,
    str: 5, dex: 5, con: 5, int: 2, wis: 3, cha: 2, subtypes: ["outsider", "evil", "lawful"],
    special: "Beard (1d8 + infernal wound, bleeds); battle frenzy; DR 5/silver+good; glaive reach 2; summon devil; darkvision.", art: "devil-bearded",
  },
  blink_dog: { // SRD Blink Dog (magical beast): bite +3 (1d6+1), blink (teleport). CR2.
    name: "Blink Dog", emoji: "\u{1F415}", cr: 2, role: "melee", hp: 22, ac: 16, dmg: "1d6+1", hit: 3, range: 1, speed: 40,
    str: 3, dex: 5, con: 3, int: 2, wis: 3, cha: 1, subtypes: ["magical_beast"],
    special: "Blink (dimension door at will — 50% miss vs it); scent; low-light. A good pack-hunter.", art: "blink-dog",
  },
  brown_bear: { // SRD Brown Bear (grizzly): 2 claws +11 (1d8+8), bite (2d6+4), improved grab. CR4.
    name: "Brown Bear", emoji: "\u{1F43B}", cr: 4, role: "melee", hp: 51, ac: 15, dmg: "1d8+8", hit: 11, range: 1, speed: 40,
    str: 17, dex: 3, con: 6, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Improved grab; scent; low-light. A grizzly. (See dire_bear for the SCALED CR6.)", art: "bear-brown",
  },
  lion: { // SRD Lion (animal): bite +7 (1d8+3), 2 claws (1d4+1), pounce, rake, improved grab. CR3.
    name: "Lion", emoji: "\u{1F981}", cr: 3, role: "melee", hp: 33, ac: 15, dmg: "1d8+3", hit: 7, range: 1, speed: 40,
    str: 11, dex: 5, con: 5, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Pounce; rake 1d4+1; improved grab; scent. The savannah cat.", art: "lion",
  },
  tiger: { // SRD Tiger (animal): 2 claws +9 (1d8+6), bite (2d6+3), pounce, rake. CR4.
    name: "Tiger", emoji: "\u{1F405}", cr: 4, role: "melee", hp: 45, ac: 14, dmg: "1d8+6", hit: 9, range: 1, speed: 40,
    str: 13, dex: 5, con: 7, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Pounce; rake 1d8+3; improved grab; scent. (See dire_tiger for the SCALED CR7.)", art: "tiger",
  },
  giant_wasp: { // SRD Giant Wasp (vermin): sting +6 (1d3+3 + poison), fly. CR3.
    name: "Giant Wasp", emoji: "\u{1F41D}", cr: 3, role: "melee", hp: 26, ac: 14, dmg: "1d3+3", hit: 6, range: 1, speed: 60,
    str: 4, dex: 6, con: 4, int: 0, wis: 3, cha: 1, subtypes: ["vermin"],
    special: "Poison sting (Fort DC 14, 1d6 Dex); fly 60; darkvision. A wasp the size of a pony.", art: "wasp-giant",
  },
  spider_swarm: { // SRD Spider Swarm (vermin): swarm 1d6 + poison, distraction. CR1.
    name: "Spider Swarm", emoji: "\u{1F577}\u{FE0F}", cr: 1, role: "melee", hp: 9, ac: 17, dmg: "1d6", hit: 0, range: 1, speed: 20,
    str: 0, dex: 7, con: 0, int: 0, wis: 0, cha: 0, subtypes: ["vermin", "swarm"],
    special: "Swarm: auto-hit 1d6 + poison (Fort DC 11) + distraction; immune weapon damage; climb. A skittering carpet.", art: "spider-swarm",
  },
  animated_object_sm: { // SRD Small Animated Object (construct): slam +1 (1d4). CR0.5.
    name: "Animated Object (Small)", emoji: "\u{1FA91}", cr: 0.5, role: "melee", hp: 6, ac: 14, dmg: "1d4", hit: 1, range: 1, speed: 30,
    str: 3, dex: 0, con: 0, int: 0, wis: 0, cha: 0, subtypes: ["construct"],
    special: "Construct; immune mind-affecting/poison/disease; a chair/rug/rope lurching to life.", art: "animated-object-sm",
  },
  animated_object_lg: { // SRD Large Animated Object (construct): slam +6 (2d6+7). CR3.
    name: "Animated Object (Large)", emoji: "\u{1F6AA}", cr: 3, role: "melee", hp: 52, ac: 14, dmg: "2d6+7", hit: 6, range: 2, speed: 30,
    str: 10, dex: 0, con: 0, int: 0, wis: 0, cha: 0, subtypes: ["construct"],
    special: "Construct; immune mind-affecting/poison/disease; reach 2. A statue/wagon animated to attack.", art: "animated-object-lg",
  },
  ochre_jelly: { // SRD Ochre Jelly (ooze): slam +7 (2d4+3 acid), split, acid. CR5.
    name: "Ochre Jelly", emoji: "\u{1F7E1}", cr: 5, role: "melee", hp: 58, ac: 4, dmg: "2d4+3", hit: 7, range: 1, speed: 10,
    str: 5, dex: 0, con: 6, int: 0, wis: 1, cha: 1, subtypes: ["ooze"],
    special: "Acid slam (dissolves flesh/wood not metal); splits when hit by slashing/lightning; blindsight; constrict.", art: "ooze-ochre",
  },
  green_slime: { // SRD Green Slime (hazard, statted as a clinging ooze): 1d6 Con drain on touch. CR4.
    name: "Green Slime", emoji: "\u{1F7E2}", cr: 4, role: "melee", hp: 26, ac: 5, dmg: "1d6", hit: 3, range: 1, speed: 0,
    str: 3, dex: 0, con: 4, int: 0, wis: 0, cha: 0, subtypes: ["ooze"],
    special: "Clings to ceilings/walls; devours flesh then metal/wood (Con damage); scraped/burned/frozen off; blindsight. A dungeon hazard-ooze.", art: "slime-green",
  },
  will_o_wisp: { // SRD Will-o'-Wisp (aberration): shock +12 (2d8 electricity), natural invisibility. CR6 (edge of band).
    name: "Will-o'-Wisp", emoji: "\u{1F4A1}", cr: 6, role: "melee", hp: 40, ac: 20, dmg: "2d8", hit: 12, range: 2, speed: 50,
    str: 0, dex: 9, con: 3, int: 4, wis: 4, cha: 4, subtypes: ["aberration", "air"],
    special: "Natural invisibility (winks out); immune to most magic; fly 50 (perfect); lures travellers into bogs. A cunning swamp light.", art: "will-o-wisp",
  },
  gelatinous_cube: { // SRD Gelatinous Cube (ooze): slam +5 (1d6 + 1d6 acid + paralysis), engulf. CR3.
    name: "Gelatinous Cube", emoji: "\u{1F9CA}", cr: 3, role: "melee", hp: 54, ac: 3, dmg: "1d6", hit: 5, range: 1, speed: 15,
    str: 5, dex: 0, con: 6, int: 0, wis: 1, cha: 1, subtypes: ["ooze"],
    special: "Paralysis on touch (Fort DC 20); engulf; acid (+1d6, not metal); transparent (surprise); blindsight. The corridor-sweeper.", art: "ooze-cube",
  },
  darkmantle: { // SRD Darkmantle (magical beast): slam +5 (1d4+4), darkness, crush/grab. CR1.
    name: "Darkmantle", emoji: "\u{1F987}", cr: 1, role: "melee", hp: 13, ac: 17, dmg: "1d4+4", hit: 5, range: 1, speed: 20,
    str: 4, dex: 2, con: 3, int: 0, wis: 3, cha: 1, subtypes: ["magical_beast"],
    special: "Darkness (spell-like); improved grab + constrict (drops from the ceiling); blindsight; fly 30. A cave-lurker.", art: "darkmantle",
  },
  ape: { // SRD Ape (animal): 2 claws +7 (1d6+5), bite (1d6+2). Large animal. CR2.
    name: "Ape", emoji: "\u{1F98D}", cr: 2, role: "melee", hp: 29, ac: 14, dmg: "1d6+5", hit: 7, range: 1, speed: 30,
    str: 9, dex: 5, con: 4, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Climb; scent; low-light. A great silverback. (See dire_ape for the CR2 rend-brute.)", art: "ape",
  },
  camel: { // SRD Camel (animal): bite +0 (1d4). Large mount. CR1.
    name: "Camel", emoji: "\u{1F42B}", cr: 1, role: "melee", hp: 22, ac: 13, dmg: "1d4", hit: 0, range: 1, speed: 50,
    str: 8, dex: 3, con: 5, int: 0, wis: 1, cha: 0, subtypes: ["beast"],
    special: "Endures thirst; spits; a desert caravan mount, not a real fighter.", art: "camel",
  },
  bison: { // SRD Bison (animal): gore +8 (1d8+9), stampede. Large animal. CR2.
    name: "Bison", emoji: "\u{1F9AC}", cr: 2, role: "melee", hp: 30, ac: 13, dmg: "1d8+9", hit: 8, range: 1, speed: 40,
    str: 12, dex: 1, con: 6, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Stampede (herd tramples); scent; low-light. A great plains ox.", art: "bison",
  },
  giant_owl: { // SRD Giant Owl (magical beast): 2 talons +8 (1d6+4), bite (1d8+2). CR3.
    name: "Giant Owl", emoji: "\u{1F989}", cr: 3, role: "melee", hp: 26, ac: 15, dmg: "1d6+4", hit: 8, range: 1, speed: 40,
    str: 7, dex: 5, con: 3, int: 2, wis: 4, cha: 2, subtypes: ["magical_beast"],
    special: "Fly 70; low-light + superb Spot; silent flight; speaks. A noble winged mount/scout.", art: "owl-giant",
  },
  giant_eagle: { // SRD Giant Eagle (magical beast): 2 talons +8 (1d6+4), bite (1d8+2). CR3.
    name: "Giant Eagle", emoji: "\u{1F985}", cr: 3, role: "melee", hp: 26, ac: 15, dmg: "1d6+4", hit: 8, range: 1, speed: 80,
    str: 7, dex: 5, con: 3, int: 4, wis: 3, cha: 2, subtypes: ["magical_beast"],
    special: "Fly 80 (average); keen sight; dive; speaks. A noble raptor.", art: "eagle-giant",
  },
  horse_heavy: { // SRD Heavy Warhorse (animal): 2 hooves +4 (1d6+4), bite (1d4+2). Large mount. CR2.
    name: "Warhorse", emoji: "\u{1F40E}", cr: 2, role: "melee", hp: 30, ac: 14, dmg: "1d6+4", hit: 4, range: 1, speed: 50,
    str: 8, dex: 3, con: 7, int: 0, wis: 3, cha: 1, subtypes: ["beast"],
    special: "Trained for war (fights while ridden); scent; low-light. A destrier.", art: "warhorse",
  },
  dire_boar: { // SRD Dire Boar (animal): gore +12 (1d8+12), ferocity. Large animal. CR4.
    name: "Dire Boar", emoji: "\u{1F417}", cr: 4, role: "melee", hp: 52, ac: 15, dmg: "1d8+12", hit: 12, range: 1, speed: 40,
    str: 17, dex: 0, con: 9, int: 0, wis: 3, cha: 1, subtypes: ["beast"],
    special: "Ferocity (fights below 0 HP); scent; low-light. A tusked monster-pig.", art: "boar-dire",
  },
  dire_badger: { // SRD Dire Badger (animal): 2 claws +4 (1d4+2), bite (1d6+1), rage, burrow. CR2.
    name: "Dire Badger", emoji: "\u{1F9A1}", cr: 2, role: "melee", hp: 22, ac: 16, dmg: "1d4+2", hit: 4, range: 1, speed: 30,
    str: 4, dex: 5, con: 7, int: 0, wis: 2, cha: 1, subtypes: ["beast"],
    special: "Rage (+4 Str/Con when wounded); burrow 10; scent; low-light. A tunnel-fury beast.", art: "badger-dire",
  },
  dire_bat: { // SRD Dire Bat (animal): bite +5 (1d8+4), blindsense, fly. CR2.
    name: "Dire Bat", emoji: "\u{1F987}", cr: 2, role: "melee", hp: 30, ac: 15, dmg: "1d8+4", hit: 5, range: 1, speed: 40,
    str: 7, dex: 7, con: 3, int: 0, wis: 4, cha: 2, subtypes: ["beast"],
    special: "Fly 40 (good); blindsense 40 (echolocation); scent. A wolf-sized cave bat.", art: "bat-dire",
  },
  giant_octopus: { // SRD Giant Octopus (animal): arms +9 (1d4+5, grab), bite (1d8+2), constrict, ink. CR8→edge; scaled band CR5-ish.
    name: "Giant Octopus", emoji: "\u{1F419}", cr: 5, role: "melee", hp: 52, ac: 18, dmg: "1d4+5", hit: 9, range: 2, speed: 20,
    str: 10, dex: 5, con: 3, int: 0, wis: 2, cha: 3, subtypes: ["beast", "aquatic"],
    special: "Improved grab + constrict 2d8+7; ink cloud; jet swim 30; reach 2. A ship-menace (kraken's little cousin).", art: "octopus-giant",
  },
};

// The 12 top-end blocks compressed to a boss band (HP>90 OR AC>20 OR to-hit>+14). All others kept as mapped.
export const SCALED_OUTLIERS = [
  "green_hag", "dire_bear", "hill_giant", "dire_tiger", "stone_giant", "frost_giant",
  "young_black_dragon", "young_blue_dragon", "marsh_wyrm", "frost_jarl", "bone_tyrant", "deep_terror",
];

// ── PACK PRESETS (spawnPack) — featured warbands + thematic dungeon groups ───────
export const DUNGEON_PACKS = {
  // ⭐ Cave Goblins (CONTENT-WISHLIST featured). rout: kill the boss → the pack flees.
  caveGoblins: {
    name: "Cave Goblin Warband", map: "cave", rout: "hobgoblin_boss",
    members: [
      { id: "goblin_spear", count: [2, 3] },
      { id: "goblin_slinger", count: [1, 2] },
      { id: "goblin_shaman", count: 1 },
      { id: "hobgoblin_boss", count: 1, boss: true },
    ],
  },
  // A few classic dungeon monsters (the task's named set).
  classicDungeon: {
    name: "Dungeon Delve", map: "cave",
    members: [
      { id: "kobold", count: [2, 4] },
      { id: "orc", count: [1, 2] },
      { id: "giant_spider", count: 1 },
      { id: "zombie", count: 1 },
      { id: "gnoll", count: 1 },
    ],
  },
  cryptUndead: {
    name: "Crypt of Ashen Memory", map: "crypt", rout: null,
    members: [
      { id: "skeleton", count: [2, 3], name: "Armored Skeleton", hpBonus: 3 },
      { id: "zombie", count: 1 },
      { id: "ghoul", count: 1 },
      { id: "ossuary_ghast", count: 1, boss: true },
    ],
  },
  sewerVermin: {
    name: "Throne of Filth", map: "sewer", rout: "rat_king",
    members: [
      { id: "dire_rat", count: [2, 4], name: "Giant Sewer Rat" },
      { id: "rat_swarm", count: 1 },
      { id: "sewer_cultist", count: [1, 2] },
      { id: "rat_king", count: 1, boss: true },
    ],
  },
  spiderNest: {
    name: "The Queen's Lair", map: "cave", rout: "broodmother_cave",
    members: [
      { id: "small_spider", count: [2, 3], name: "Brood Guardian" },
      { id: "giant_spider", count: 1 },
      { id: "broodmother_cave", count: 1, boss: true },
    ],
  },
  // Coastal reuse (founder flagged these as tailor-made for a seas game). Storm Hydra = +10 HP hydra.
  smugglersCove: {
    name: "Smuggler's Cove", map: "coastal", rout: "captain_blacktide",
    members: [
      { id: "sahuagin", count: [1, 2], name: "Sahuagin Raider" },
      { id: "crocodile", count: 1 },
      { id: "hobgoblin", count: 1, name: "First Mate" },
      { id: "captain_blacktide", count: 1, boss: true },
    ],
  },
  drownedTemple: {
    name: "The Drowned Temple", map: "coastal", rout: "hydra_5head",
    members: [
      { id: "sahuagin", count: [2, 3], name: "Temple Guard" },
      { id: "monstrous_scorpion_lg", count: 1, name: "Reef Scorpion" },
      { id: "hydra_5head", count: 1, name: "Storm Hydra", hpBonus: 10, boss: true },
    ],
  },
};

export default DUNGEON_BESTIARY;
