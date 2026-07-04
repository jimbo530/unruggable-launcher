/**
 * bestiary-sea.js — SEA / PIRATE MONSTER bestiary for the "Seize the Seas" ship-deck
 * battle grid. DIRECT-STAT monsters (the makeMonster() path the engine notes call for):
 * NO class-engine / token endowment — these are hand-statted foes built straight onto the
 * Tales-of-Tasern BattleUnit shape that tot-engine.js + game.js consume.
 *
 * HOUSE RULE (founder): authentic D&D 3.5 SRD creatures, KEEP their abilities + flavor,
 * SCALE every entry down to the DECK BAND so they fight player pawns fairly:
 *     player pawns ~10–20 HP · AC ~10–12 · dmg ~4–9 · to-hit ~+2..+5.
 * The real SRD line (HD / AC / Str / Dex / attacks) is cited in a // SRD: comment over
 * each entry; the engine fields below are the SCALED-to-band values.
 *
 * ADDITIVE ONLY — this file does NOT edit the core engine. It:
 *   • exports SEA_BESTIARY (templates) + spawnGroup()/spawnKraken() (placed units),
 *   • exports SEA_SPELLS (themed SPELLS-shaped entries) so caster monsters can cast once
 *     the wirer does a one-line  Object.assign(SPELLS, SEA_SPELLS)  in units.js/game.js.
 *
 * ── ENGINE-READY NOTES (what makeMonster() guarantees) ──────────────────────────────
 *   A placed unit carries EVERY field game.js touches when a monster is the current()
 *   unit, so the renderer / stat panel never throws on a foe's turn:
 *     combat (tot-engine): stats{attack,atkBonus,ac}, rawAbilities{str..cha}, currentHp,
 *                          maxHp, activeEffects[], position, attackRange, movementHexes,
 *                          casterLevel, castingAbilityMod, availableSpells[]
 *     display  (game.js): className, engineStats{STR..CHA}, endowment{}, qualified[],
 *                          equipped{weapon,armor,trinket}, totalLevel, bracket, spellDC
 *     death sink (game.js): baseStats + base* mirrors so applyEquipment() at -10 is safe
 *                          (monsters carry no gear → no loot lines, no crash)
 *
 * ── role vs archetype ───────────────────────────────────────────────────────────────
 *   `role` is the ENGINE role and is ALWAYS "melee" | "caster" (game.js AI branches on it:
 *   a caster prefers spells, a melee just strikes within attackRange — RANGED foes are
 *   role:"melee" with attackRange>1, which resolveAttack already supports at any distance).
 *   `archetype` is the descriptive label (swarm / brute / skirmisher / undead / ranged /
 *   mini-boss / boss-limb / boss-core) for UI + the founder; it does NOT drive the engine.
 *
 * node --check clean. ESM. Sibling import of the two grid constants only.
 */

import { GRID_COLS, GRID_ROWS } from "./tot-engine.js";

// ── THEMED SPELLS (SPELLS-shaped; merge into tot-engine SPELLS to enable) ────────────
// Caster monsters reference these ids in availableSpells. game.js safely SKIPS any spell
// id it can't find in SPELLS, so a monster stays functional (falls back to its physical
// ranged strike) until the wirer enables them with one additive line — no core edit:
//     import { SEA_SPELLS } from "./bestiary-sea.js";
//     Object.assign(SPELLS, SEA_SPELLS);   // in units.js (the SPELLS owner) or game.js boot
export const SEA_SPELLS = {
  // SRD: Kraken — ink cloud (60-ft spread) + spell-likes. Modeled as a caustic Reflex-half blast.
  ink_spray: {
    id: "ink_spray", name: "Ink Spray", level: 2,
    battle: { type: "damage", hexRange: 4, hexArea: 1, damage: "1d6", damageType: "acid", save: "ref" },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────────
// THE BESTIARY — each value is a TEMPLATE; spawnGroup()/spawnKraken() turn a template +
// a board position into a full, engine-ready BattleUnit (see makeMonster below).
// `abilities` are D&D scores (scaled into band); makeMonster derives ToT rawAbilities
// (score − 10, min 0) for saves and engineStats (the raw scores) for the stat panel.
// `art` is a SPRITE ID placeholder — the founder drops the cut-out PNG and the renderer
// swaps it for the emoji (imageUrl is left undefined so the emoji token always shows now).
// ─────────────────────────────────────────────────────────────────────────────────────
export const SEA_BESTIARY = {
  // SRD: Dire Rat — Small Animal, HD 1d8+1 (5 hp), AC 15, Str 10 Dex 17 Con 12, bite +4 melee
  //      (1d4 plus filth fever). Scaled to a SWARM CHIP: low HP, weak bite, comes in numbers.
  "Bilge Rat": {
    name: "Bilge Rat", title: "Swarm", archetype: "swarm", role: "melee",
    emoji: "\u{1F400}", art: "mob-bilge-rat", subtypes: ["vermin", "aquatic"],
    maxHp: 4, stats: { attack: 2, atkBonus: 3, ac: 13 }, attackRange: 1, movementHexes: 6,
    abilities: { str: 10, dex: 16, con: 12, int: 2, wis: 12, cha: 4 },
    cr: 1, tier: "rabble", groupSize: 5, swarm: true,
    special: "Swarm: spawns 4–6 from the bilges; individually weak but flanks fast. Bite " +
      "carries filth fever (disease mechanic NOT in the engine yet — flavor only for now).",
  },

  // SRD: Shark, Medium — Medium Animal, HD 3d8+3 (16 hp), AC 15, Str 13 Dex 15 Con 13,
  //      bite +4 melee (1d6+1), keen scent + blood frenzy. Scaled: a fast biting brute.
  "Shark": {
    name: "Shark", title: "Predator", archetype: "brute", role: "melee",
    emoji: "\u{1F988}", art: "mob-shark", subtypes: ["animal", "aquatic"],
    maxHp: 14, stats: { attack: 5, atkBonus: 4, ac: 13 }, attackRange: 1, movementHexes: 5,
    abilities: { str: 13, dex: 15, con: 13, int: 1, wis: 12, cha: 2 },
    cr: 2, tier: "beast", groupSize: 1,
    telegraph: { windupRounds: 1, tell: "the shark thrashes, scenting blood…", bonusVsWounded: 2 },
    special: "Blood Frenzy: telegraphs (rears/thrashes one round), then lunges; the wirer can " +
      "add +2 dmg vs a wounded target (telegraph data is here; the wind-up needs engine wiring).",
  },

  // SRD: Merfolk — Medium Humanoid (Aquatic), HD 1d8 (4 hp), AC 13 (+2 natural), Str 10 Dex 13
  //      Con 12, trident +1 melee (1d8) / heavy crossbow +1 ranged (1d10). Raider build: Str↑,
  //      reach/thrown trident. Scaled to a skirmisher who strikes from 2 hexes.
  "Merfolk Raider": {
    name: "Merfolk Raider", title: "Raider", archetype: "skirmisher", role: "melee",
    emoji: "\u{1F9DC}", art: "mob-merfolk-raider", subtypes: ["humanoid", "aquatic"],
    maxHp: 11, stats: { attack: 5, atkBonus: 3, ac: 12 }, attackRange: 2, movementHexes: 4,
    abilities: { str: 14, dex: 13, con: 12, int: 10, wis: 11, cha: 12 },
    cr: 1, tier: "warrior", groupSize: 3,
    special: "Trident reach/throw: strikes at 2 hexes (reach + hurled trident) so it pokes from " +
      "the rail before closing. Amphibious — at home in the water arena.",
  },

  // SRD: Skeleton (Human warrior) — Medium Undead, HD 1d12 (6 hp), AC 15 (+2 natural, +1 Dex),
  //      Str 13 Dex 13 Con — , 2 claws +1 (1d4+1) or by weapon; DR 5/bludgeoning, immune cold,
  //      undead traits. Scaled: a cutlass boarder that does NOT bleed out (already dead).
  "Skeleton Crew": {
    name: "Skeleton Crew", title: "Undead Boarder", archetype: "undead", role: "melee",
    emoji: "\u{1F480}", art: "mob-skeleton-crew", subtypes: ["undead"],
    maxHp: 9, stats: { attack: 4, atkBonus: 2, ac: 13 }, attackRange: 1, movementHexes: 4,
    abilities: { str: 13, dex: 13, con: 10, int: 0, wis: 10, cha: 1 },
    cr: 1, tier: "undead", groupSize: 4, undead: true, noBleed: true,
    special: "Undead: immune to fear/poison/disease; mindless. DESTROYED at 0 HP — NO bleed-out " +
      "clock (it just collapses to bones). 'No-bleed at 0' needs engine wiring (flag set here).",
  },

  // SRD: Human Warrior 1 (+ crossbow) — Medium Humanoid, HD 1d8+1 (5 hp), AC 16 (scale + shield),
  //      Str 13 Dex 11 Con 12, heavy crossbow +1 (1d10) or longsword +2 (1d8+1). Marine build:
  //      marksman Dex, musket volley. Scaled to a RANGED foe that strikes at 4 hexes.
  "Navy Marine": {
    name: "Navy Marine", title: "Musketeer", archetype: "ranged", role: "melee",
    emoji: "\u{1FA96}", art: "mob-navy-marine", subtypes: ["humanoid"],
    maxHp: 10, stats: { attack: 5, atkBonus: 3, ac: 12 }, attackRange: 4, movementHexes: 3,
    abilities: { str: 13, dex: 13, con: 12, int: 10, wis: 11, cha: 10 },
    cr: 1, tier: "warrior", groupSize: 2, isRanged: true,
    special: "Volley: fires at 4 hexes (musket/heavy crossbow) and prefers to keep its distance; " +
      "weak if you close to melee. Hold the deck and rush it.",
  },

  // SRD: Giant Crab (Monstrous Crab) — Medium-Large Vermin/Animal: thick chitin shell (high natural
  //      AC), 2 claws + improved grab/constrict, SLOW mover. Scaled to a BEACH MINI-BRUTE: tanky
  //      (high AC + HP), a hard pincer hit, but it scuttles slowly so a quick pawn can kite it. This
  //      is the signature BEACH / crabbing-job daily encounter (founder 2026-06-26).
  "Giant Crab": {
    name: "Giant Crab", title: "Beach Brute", archetype: "brute", role: "melee",
    emoji: "\u{1F980}", art: "mob-giant-crab", subtypes: ["animal", "aquatic"],
    maxHp: 13, stats: { attack: 6, atkBonus: 4, ac: 14 }, attackRange: 1, movementHexes: 3,
    abilities: { str: 16, dex: 10, con: 14, int: 1, wis: 10, cha: 5 },
    cr: 2, tier: "beast", groupSize: 1,
    telegraph: { windupRounds: 1, tell: "the crab rears back, raising a great pincer…", hexArea: 1 },
    special: "Hard Shell: high AC (14) — wear it down. PINCER GRAB: a hit can seize the target " +
      "(grapple flavor — grapple mechanic NOT in the engine yet). SLOW: scuttles only 3 hexes, so " +
      "a nimble pawn can kite it on the open sand. The beach/crabbing daily encounter.",
  },

  // SRD: Giant Constrictor Snake (sea-serpent reskin) — Huge Animal, HD 11d8+14 (63 hp), AC 15,
  //      Str 25 Dex 17 Con 14, bite +13 (1d8+10) + improved grab/constrict (1d8+10). Scaled to a
  //      DECK MINI-BOSS (~2x a strong pawn), long-neck lunge at 2 hexes, constrict flavor.
  "Sea Serpent": {
    name: "Sea Serpent", title: "Mini-Boss", archetype: "mini-boss", role: "melee",
    emoji: "\u{1F40D}", art: "mob-sea-serpent", subtypes: ["animal", "aquatic"],
    maxHp: 28, stats: { attack: 8, atkBonus: 5, ac: 14 }, attackRange: 2, movementHexes: 4,
    abilities: { str: 20, dex: 15, con: 16, int: 1, wis: 12, cha: 6 },
    cr: 5, tier: "mini-boss", groupSize: 1,
    telegraph: { windupRounds: 1, tell: "the serpent coils to strike…", hexArea: 1 },
    special: "Constrict: a hit COILS the target (grapple/hold — grapple mechanic NOT in the engine " +
      "yet, flavor for now). Mini-boss: ~2x pawn HP and reach 2. Gate it with bodies, hit hard.",
  },

  // SRD: Kraken — Gargantuan Magical Beast (Aquatic), HD 20d10+200 (310 hp), AC 20, Str 36 Dex 10
  //      Con 30, 2 tentacles +25 (2d8+13) + 6 arms +20 (1d6+6), improved grab/constrict. Split for
  //      the deck: each ARM is its OWN pawn — spawn 4–6 on the water-edge, reach 3, severable.
  "Kraken Tentacle": {
    name: "Kraken Tentacle", title: "Kraken Arm", archetype: "boss-limb", role: "melee",
    emoji: "\u{1F991}", art: "mob-kraken-tentacle", subtypes: ["magical-beast", "aquatic"],
    maxHp: 12, stats: { attack: 7, atkBonus: 5, ac: 13 }, attackRange: 3, movementHexes: 1,
    abilities: { str: 22, dex: 10, con: 18, int: 0, wis: 12, cha: 2 },
    cr: 5, tier: "boss", groupSize: 5, anchor: "water-edge", severable: true, noBleed: true,
    telegraph: { windupRounds: 1, tell: "a tentacle rears back over the rail…", hexArea: 1, reach: 3 },
    special: "Anchored to a water-edge hex (movementHexes 1 — it reaches ONTO the deck, it does " +
      "not roam). TELEGRAPHED SLAM: winds up one round, then slams everything within reach 3. " +
      "SEVERABLE: destroyed instantly at 0 HP with NO bleed-out (lopped off). Telegraph + " +
      "sever-at-0 + no-bleed flags are set here; both behaviors need engine wiring (see notes).",
  },

  // SRD: Kraken (core) — same beast's head/eye; Int 21 Wis 20 Cha 20, spell-likes (control weather/
  //      winds, dominate animal, resist energy) + ink cloud. The BOSS CORE: a stationary caster.
  //      Kill the eye OR sever every arm to end the fight. Scaled abilities so saves stay in-band.
  "Kraken Eye": {
    name: "Kraken Eye", title: "Kraken Core", archetype: "boss-core", role: "caster",
    emoji: "\u{1F441}", art: "mob-kraken-eye", subtypes: ["magical-beast", "aquatic"],
    maxHp: 26, stats: { attack: 6, atkBonus: 5, ac: 14 }, attackRange: 5, movementHexes: 0,
    abilities: { str: 20, dex: 10, con: 18, int: 16, wis: 16, cha: 16 },
    cr: 6, tier: "boss", groupSize: 1, anchor: "water-edge",
    castingAbility: "int", casterLevel: 6, availableSpells: ["ink_spray"],
    special: "Boss core: STATIONARY (movementHexes 0) — looms off the rail and lashes out at range " +
      "5. Casts Ink Spray (SEA_SPELLS — enable via Object.assign into SPELLS). Hypnotic gaze is " +
      "flavor only (will-save debuff not wired). WIN CONDITION: drop the eye or sever all arms.",
  },

  // ════════ SRD CR 0–5 SEA/AQUATIC COMPLETION FILL (2026-07-01) ════════
  // Remaining SRD 3.5 (OGL) aquatic/coastal creatures + a small human pirate crew, so the
  // fishing/beach/coast daily encounters are fully stocked. Same TEMPLATE shape as above
  // (abilities = D&D scores; makeMonster derives rawAbilities = score−10). No WILD outliers.

  // SRD: Porpoise/Dolphin — Medium Animal, HD 2d8+2 (11 hp), AC 15, Str 11 Dex 15 Con 13,
  //      slam +4 (2d4), blindsight, swim. A friendly beast — rare foe, common sea-flavor.
  "Dolphin": {
    name: "Dolphin", title: "Sea Friend", archetype: "beast", role: "melee",
    emoji: "\u{1F42C}", art: "mob-dolphin", subtypes: ["animal", "aquatic"],
    maxHp: 11, stats: { attack: 5, atkBonus: 4, ac: 15 }, attackRange: 1, movementHexes: 6,
    abilities: { str: 11, dex: 15, con: 13, int: 2, wis: 12, cha: 6 },
    cr: 1, tier: "beast", groupSize: 2,
    special: "Blindsight (echolocation); swim 80; hold breath. Usually an ally — rams only if cornered.",
  },

  // SRD: Sea Cat — Large Magical Beast (Aquatic), HD 6d10+18 (51 hp), AC 16, Str 21 Dex 13
  //      Con 17, 2 claws +9 (1d6+5) + bite (2d6+2). A finned lion-fish predator. Scaled to a
  //      COAST/REEF mini-brute (below the Sea Serpent mini-boss).
  "Sea Cat": {
    name: "Sea Cat", title: "Reef Predator", archetype: "brute", role: "melee",
    emoji: "\u{1F981}", art: "mob-sea-cat", subtypes: ["magical-beast", "aquatic"],
    maxHp: 20, stats: { attack: 6, atkBonus: 5, ac: 15 }, attackRange: 1, movementHexes: 5,
    abilities: { str: 18, dex: 13, con: 16, int: 2, wis: 12, cha: 9 },
    cr: 4, tier: "beast", groupSize: 1,
    telegraph: { windupRounds: 1, tell: "the sea cat arches, fins flaring…", bonusVsWounded: 2 },
    special: "Finned lion of the reef: 2 claws + bite; hold breath; swim. Rends anything overboard.",
  },

  // SRD: Shark, Large — Large Animal, HD 7d8+7 (38 hp), AC 15, Str 17 Dex 15 Con 13, bite +7
  //      (1d8+4), keen scent + blood frenzy. The bigger reef shark (the CR2 "Shark" is Medium).
  "Great Shark": {
    name: "Great Shark", title: "Apex Predator", archetype: "brute", role: "melee",
    emoji: "\u{1F988}", art: "mob-great-shark", subtypes: ["animal", "aquatic"],
    maxHp: 22, stats: { attack: 7, atkBonus: 6, ac: 14 }, attackRange: 1, movementHexes: 6,
    abilities: { str: 17, dex: 15, con: 13, int: 1, wis: 12, cha: 2 },
    cr: 4, tier: "beast", groupSize: 1,
    telegraph: { windupRounds: 1, tell: "the great shark rolls, scenting blood…", bonusVsWounded: 3 },
    special: "Blood Frenzy: telegraphs then lunges (bonus dmg vs wounded); keen scent; swim. " +
      "The big cousin of the reef Shark — a deep-water brute.",
  },

  // SRD: Human Commoner/Warrior 1 (unarmed rabble) — Medium Humanoid, HD 1d8 (4 hp), AC 12,
  //      Str 11 Dex 12 Con 11, club/gaff +0 (1d6). A ragged deckhand press-ganged into a scrap.
  //      The small-pirate-crew filler for the FISHING daily encounter (founder note).
  "Pirate Deckhand": {
    name: "Pirate Deckhand", title: "Rabble", archetype: "skirmisher", role: "melee",
    emoji: "\u{1F9D1}\u{200D}\u{2708}\u{FE0F}", art: "mob-pirate-deckhand", subtypes: ["humanoid"],
    maxHp: 6, stats: { attack: 3, atkBonus: 1, ac: 12 }, attackRange: 1, movementHexes: 4,
    abilities: { str: 11, dex: 12, con: 11, int: 9, wis: 10, cha: 9 },
    cr: 0.25, tier: "rabble", groupSize: 3,
    special: "A ragged deckhand with a gaff-hook: weak alone, comes in small mobs. The little " +
      "pirate crew that jumps a fishing boat (beach/fishing daily encounter).",
  },

  // SRD: Human Rogue 1 (cutlass) — Medium Humanoid, HD 1d6 (4 hp), AC 13 (studded+Dex), Str 12
  //      Dex 15 Con 11, rapier/cutlass +2 (1d6+1), sneak attack +1d6. The crew's leader-thug.
  "Pirate Cutthroat": {
    name: "Pirate Cutthroat", title: "Cutthroat", archetype: "skirmisher", role: "melee",
    emoji: "\u{1F3F4}\u{200D}\u{2620}\u{FE0F}", art: "mob-pirate-cutthroat", subtypes: ["humanoid"],
    maxHp: 9, stats: { attack: 5, atkBonus: 3, ac: 14 }, attackRange: 1, movementHexes: 4,
    abilities: { str: 12, dex: 15, con: 11, int: 10, wis: 11, cha: 12 },
    cr: 1, tier: "warrior", groupSize: 2,
    special: "Cutlass + sneak attack (bonus dmg vs a flanked/surprised target — flavor for now); " +
      "the small pirate crew's lead thug. Pairs with Pirate Deckhands.",
  },
};

// ── ToT ability mod (mirrors tot-engine abilityMod: floor(max(0,s)/2)) ───────────────
const mod = (s) => Math.floor(Math.max(0, Number(s) || 0) / 2);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

let _seq = 0; // unique-id counter across all spawns this session

// ── Placement slot generators (kept inside the 9x7 deck bounds) ──────────────────────
/** Enemy boarding side: the right third of the deck, spread center-out across rows so a
 *  group doesn't stack in one column. */
function enemySpawnSlots() {
  const cols = [7, GRID_COLS - 1, 6, 5];          // right rail first
  const rows = [3, 1, 5, 2, 4, 0, 6];             // center-out spread
  const out = [];
  for (const r of rows) for (const q of cols)
    if (q >= 0 && q < GRID_COLS && r >= 0 && r < GRID_ROWS) out.push({ q, r });
  return out;
}

/** Water-edge ring: the deck perimeter borders the sea. Ordered enemy-side first so a
 *  kraken wraps the starboard/boarding rail before ringing the rest of the hull. */
function waterEdgeSlots() {
  const seen = new Set(); const out = [];
  const maxQ = GRID_COLS - 1, maxR = GRID_ROWS - 1;
  const push = (q, r) => {
    const k = q + "," + r;
    if (q >= 0 && q < GRID_COLS && r >= 0 && r < GRID_ROWS && !seen.has(k)) { seen.add(k); out.push({ q, r }); }
  };
  for (let r = 0; r <= maxR; r++) push(maxQ, r);   // right rail (enemy side)
  for (let q = maxQ; q >= 0; q--) push(q, 0);       // top rail
  for (let q = maxQ; q >= 0; q--) push(q, maxR);    // bottom rail
  for (let r = 0; r <= maxR; r++) push(0, r);       // left rail last
  return out;
}

/** First free hex from `slots`; else scan the whole deck; else a safe default. Never stacks. */
function freeHexFrom(slots, taken) {
  for (const h of slots) if (!taken.has(h.q + "," + h.r)) return h;
  for (let q = GRID_COLS - 1; q >= 0; q--)
    for (let r = 0; r < GRID_ROWS; r++)
      if (!taken.has(q + "," + r)) return { q, r };
  return { q: GRID_COLS - 1, r: 0 };
}

/**
 * Build ONE engine-ready BattleUnit from a bestiary template + a board position.
 * This is the DIRECT-STAT monster path (no class-engine): every field game.js or
 * tot-engine.js reads for a foe is populated so a monster's turn never throws.
 *
 * @param {object} tpl   a SEA_BESTIARY template
 * @param {{q:number,r:number}} position
 * @param {number} [idx] index within a group (>0 → numbered name "Shark 2")
 * @param {number} [groupN] total in the group (drives numbering)
 */
export function makeMonster(tpl, position, idx = 0, groupN = 1) {
  const ab = tpl.abilities;
  // ToT rawAbilities = D&D score − 10 (min 0). resolveSpellCast reads con/dex/wis for saves.
  const raw = {
    str: Math.max(0, ab.str - 10), dex: Math.max(0, ab.dex - 10), con: Math.max(0, ab.con - 10),
    int: Math.max(0, ab.int - 10), wis: Math.max(0, ab.wis - 10), cha: Math.max(0, ab.cha - 10),
  };
  const castingMod = tpl.role === "caster" ? mod(raw[tpl.castingAbility || "int"]) : 0;
  // Combat stats hexCombat actually reads (+ a few mirror fields buildUnit also fills).
  const stats = {
    attack: tpl.stats.attack, atkBonus: tpl.stats.atkBonus, ac: tpl.stats.ac,
    mAtk: ab.int, def: raw.dex, mDef: raw.wis, hp: tpl.maxHp,
  };
  const name = groupN > 1 ? `${tpl.name} ${idx + 1}` : tpl.name;

  return {
    id: `mob_${slug(tpl.name)}_${++_seq}`,
    name,
    className: tpl.title || tpl.archetype || "Monster",
    imageEmoji: tpl.emoji,
    imageUrl: undefined,            // art not cut yet → emoji token shows (founder supplies sprite)
    art: tpl.art,                   // ART HOOK: sprite id for the renderer/founder
    isPlayer: false,
    role: tpl.role,                 // ENGINE role: "melee" | "caster"
    archetype: tpl.archetype,       // descriptive only (UI / founder)

    // ── display fields game.js showStats() reads (so the foe panel never crashes) ──
    endowment: {},                                  // Object.entries({}) → no class-engine endowment
    engineStats: { STR: ab.str, DEX: ab.dex, CON: ab.con, INT: ab.int, WIS: ab.wis, CHA: ab.cha },
    qualified: [],                                  // no class abilities → panel shows "—"
    bracket: tpl.tier || "monster",
    totalLevel: tpl.cr || 1,
    spellDC: 10 + castingMod,

    // ── ToT BattleUnit combat shape (tot-engine.js consumes this) ──
    position: { q: position.q, r: position.r },
    stats,
    rawAbilities: raw,
    subtypes: tpl.subtypes || [],
    currentHp: tpl.maxHp,
    maxHp: tpl.maxHp,
    hasMoved: false,
    hasActed: false,
    activeEffects: [],
    attackRange: tpl.attackRange,
    isRanged: !!tpl.isRanged || tpl.attackRange > 1,
    casterLevel: tpl.casterLevel || tpl.cr || 1,
    castingAbilityMod: castingMod,
    availableSpells: tpl.availableSpells || [],
    movementHexes: tpl.movementHexes,

    // ── monster behavior flags (additive — the engine wirer reads these) ──
    special: tpl.special,
    swarm: !!tpl.swarm,
    undead: !!tpl.undead,
    severable: !!tpl.severable,     // destroyed at 0 HP (no down/bleed state) — needs wiring
    noBleed: !!tpl.noBleed,         // skip the bleed-out clock at <=0 — needs wiring
    anchor: tpl.anchor || null,     // "water-edge" → spawns on a perimeter hex, barely moves
    telegraph: tpl.telegraph || null, // wind-up "tell" before a big hit — needs wiring

    // ── equip base mirrors so applyEquipment() at -10 is safe (monsters carry no gear) ──
    // Seed ALL 7 paper-doll slots (matches units.js buildUnit + INTEGRATION.md §3.2) so the
    // equip UI / death-drop / any Object.keys(equipped) consumer sees every slot.
    equipped: { weapon: null, offhand: null, armor: null, helm: null, boots: null, ring: null, trinket: null },
    baseStats: { ...stats },
    baseMaxHp: tpl.maxHp,
    baseAttackRange: tpl.attackRange,
    baseMovementHexes: tpl.movementHexes,
    baseCastingMod: castingMod,
  };
}

/**
 * Spawn a group of one monster type as PLACED units (each with a board position).
 * @param {string} name   a key of SEA_BESTIARY (e.g. "Bilge Rat", "Kraken Tentacle")
 * @param {number} [count] how many; defaults to the template's groupSize (else 1)
 * @returns {object[]} engine-ready BattleUnits, foe side, no two on the same hex
 */
export function spawnGroup(name, count) {
  const tpl = SEA_BESTIARY[name];
  if (!tpl) {
    throw new Error(`spawnGroup: no sea monster "${name}". Known: ${Object.keys(SEA_BESTIARY).join(", ")}`);
  }
  const n = Math.max(1, count || tpl.groupSize || 1);
  const slots = tpl.anchor === "water-edge" ? waterEdgeSlots() : enemySpawnSlots();
  const taken = new Set();
  const placed = [];
  for (let i = 0; i < n; i++) {
    const pos = freeHexFrom(slots, taken);
    taken.add(pos.q + "," + pos.r);
    placed.push(makeMonster(tpl, pos, i, n));
  }
  return placed;
}

/**
 * Assemble the KRAKEN as a MULTI-PAWN boss: N severable arms ringing the water-edge plus
 * (optionally) the stationary Eye core looming off the starboard rail. Returns one flat
 * array of placed units ready to drop into the battle deck's units[].
 *
 * @param {number} [tentacles] arms to spawn (clamped 4–6 per the design)
 * @param {boolean} [withEye]  include the Kraken Eye core (default true)
 * @returns {object[]} placed BattleUnits: [...arms, eye?]
 */
export function spawnKraken(tentacles = 5, withEye = true) {
  const n = Math.max(4, Math.min(6, tentacles | 0));
  const slots = waterEdgeSlots();
  const taken = new Set();
  const units = [];

  // Eye core takes the starboard-rail center first (so arms ring around it).
  if (withEye) {
    const eyePos = { q: GRID_COLS - 1, r: Math.floor(GRID_ROWS / 2) };
    taken.add(eyePos.q + "," + eyePos.r);
    units.push(makeMonster(SEA_BESTIARY["Kraken Eye"], eyePos, 0, 1));
  }
  const arm = SEA_BESTIARY["Kraken Tentacle"];
  for (let i = 0; i < n; i++) {
    const pos = freeHexFrom(slots, taken);
    taken.add(pos.q + "," + pos.r);
    units.push(makeMonster(arm, pos, i, n));
  }
  return units;
}

/** All bestiary keys (handy for encounter tables / a foe picker). */
export const SEA_MONSTER_NAMES = Object.keys(SEA_BESTIARY);
