// @ts-check
/**
 * area-encounters.js — AREA → RANDOM-ENCOUNTER mapping for "Seize the Seas" (the expanding world).
 *
 * WHAT THIS IS
 *   A data-driven table that answers: "the ship is in <area> at <danger> — what does it run into?"
 *   It is the WORLD layer above the existing voyage encounter pipe:
 *
 *       location.js setSail()  →  rolls a leg's danger  →  (this file) rollEncounter(area, danger)
 *                              →  encounter.js bridge    →  battle-grid (units.js builds the foes)
 *
 *   location.js already has a tiny private ENEMY_POOL (danger 1/2/3) for the FIRST pass. This file
 *   is the EXPANSION: named biomes, weighted monster GROUPS (multi-foe), non-combat events, and
 *   apex bosses that only surface in rough water. It is additive — it does NOT edit location.js,
 *   encounter.js, or any core engine file; a future wiring step can swap location.js's roll for
 *   rollEncounter() here (see AREA_HINTS for the map→area bridge).
 *
 * TWO KINDS OF FOE (matches the engine's two build paths)
 *   • RAIDER (humans / rival pirate crews) → built from an ENDOWMENT + gear LOADOUT, the SAME
 *     `sts_pvp_opponent` snapshot path units.js already uses. These are DROP-IN with today's
 *     encounter.js (the enemy carries an `endowment`, which assertPveEncounter requires).
 *   • MONSTER (rats / goblins / kraken / sharks / serpent / skeletons) → built from DIRECT STATS via a
 *     future units.js makeMonster() that looks the id up in the bestiaries. These need the new
 *     multi-enemy + makeMonster path (see CONTENT-WISHLIST.md §1 + §6 — both flagged below).
 *
 *   Monster stat blocks live in (agent-generated) `battle-grid/bestiary-sea.js` (SEA_BESTIARY) and
 *   `battle-grid/bestiary-dungeon.js` (DUNGEON_BESTIARY). This file references monsters by ID ONLY,
 *   so it stays node-runnable and testable WITHOUT those files existing yet. MONSTER_IDS (below) is
 *   the exact contract the bestiary authors must fill. Each ref is commented with its SRD source +
 *   the deck-band scaling from the wishlist (player pawns ~10–20 HP, AC ~10–12, dmg ~4–9, hit +2..+5).
 *
 * THE ROLL
 *   rollEncounter(areaId, danger, rng?) picks one weighted row from the area's table:
 *     • a COMBAT row → returns encounter.js's PVE shape, EXTENDED with a multi-foe `group`:
 *           { type:"pve", areaId, danger, map, groupId, groupName, objective, roster, group:[…], enemy }
 *       `enemy` = group[0] for single-foe back-compat; `group` is the full multi-enemy list.
 *     • an EVENT row → { type:"event", areaId, danger, eventId, event } (flotsam / merchant / storm / …).
 *   Rougher water (higher danger) biases toward combat AND unlocks apex rows gated by `minDanger`.
 *
 *   DETERMINISTIC-FRIENDLY: pass your own rng (a function → [0,1)) as the 3rd arg and the whole roll
 *   — which row, how many foes, foe ids — is reproducible. mulberry32(seed) is exported for tests/demos.
 *   Throws loudly on a bad area/group/event id (no silent catches).
 *
 * Game-layer / pure data. No localStorage, no chain, no network. node --check clean.
 */

// ───────────────────────────────────────────────────────────────────────────────────────────
// RNG + small helpers (deterministic when a seeded rng is supplied)
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Tiny seeded PRNG (mulberry32) → a function returning [0,1). For reproducible rolls/tests/demos. */
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Read one rng() value, validated + clamped into [0,1). Throws (never silent) on a bad rng. */
function randFloat(rng) {
  const v = rng();
  if (typeof v !== "number" || Number.isNaN(v))
    throw new Error("area-encounters: rng() must return a number in [0,1).");
  return v <= 0 ? 0 : v >= 1 ? 0.9999999 : v;
}

/** Inclusive integer in [min,max]. */
function randInt(min, max, rng) {
  if (max < min) { const t = min; min = max; max = t; }
  return min + Math.floor(randFloat(rng) * (max - min + 1));
}

/** Resolve a count spec: a fixed number, or a [min,max] range rolled with rng. */
function rollCount(n, rng) {
  if (Array.isArray(n)) return randInt(n[0], n[1], rng);
  return Number.isFinite(n) ? n : 1;
}

/** Weighted pick over [{ row, w }]. Throws if total weight is 0 (a malformed table). */
function weightedPick(weighted, rng) {
  let total = 0;
  for (const x of weighted) total += x.w > 0 ? x.w : 0;
  if (!(total > 0)) throw new Error("area-encounters: weightedPick got zero total weight.");
  let t = randFloat(rng) * total;
  for (const x of weighted) { t -= x.w > 0 ? x.w : 0; if (t < 0) return x.row; }
  return weighted[weighted.length - 1].row; // floating-point safety net
}

/** Short deterministic id tag from the rng (so foe ids are reproducible under a seed). */
function tag(rng) { return Math.floor(randFloat(rng) * 1e9).toString(36); }

/** Gentle danger→combat bias: rougher water makes COMBAT rows count for more; events stay steady. */
function combatBias(d) { return Math.max(0.4, Math.min(2, 0.4 + 0.32 * d)); }
//   d0 .40 · d1 .72 · d2 1.04 · d3 1.36 · d4 1.68 · d5 2.00

// ───────────────────────────────────────────────────────────────────────────────────────────
// MONSTER_IDS — the CONTRACT for the (agent-generated) bestiary files. makeMonster() in units.js
// must resolve each id from SEA_BESTIARY (bestiary-sea.js) / DUNGEON_BESTIARY (bestiary-dungeon.js).
// Stat bands here mirror CONTENT-WISHLIST.md §6 (SRD, scaled to the deck band). Keep abilities/flavor.
// ───────────────────────────────────────────────────────────────────────────────────────────
export const MONSTER_IDS = {
  sea: [
    "bilge_rat",        // SRD Dire Rat        → HP 4 · AC 13 · bite 1 · +2 · range 1 · move 5 (fast); flees at ≤2 HP
    "shark",            // SRD Shark, Medium   → HP 9 · AC 13 · bite 5 · +3 · range 1 · move 6 (swim); punishes overboard
    "merfolk_raider",   // SRD Merfolk         → HP 6 · AC 14 · trident 4 · +3 · range 2 · move 4 (swim); hit-and-submerge
    "skeleton_boarder", // SRD Skeleton        → HP 6 · AC 13 · scimitar 4 · +2 · range 1 · move 4; immune to bleed/poison
    "navy_marine",      // SRD Warrior (musket)→ HP 8 · AC 14 · shot 5 · +4 · range 4 · move 3; disciplined ranged line
    "sea_serpent",      // SRD Sea Serpent/Eel → HP 30 · AC 16 · bite 8 · +6 · reach 2 · move 4 (swim); MINI-BOSS
    "kraken_tentacle",  // SRD Kraken (limb)   → HP 14 · AC 14 · slam 2d6 · +4 · reach 3 · move 2 (anchored); telegraphs, severable
  ],
  dungeon: [
    "goblin_spearman",   // SRD Goblin        → HP 5 · AC 13 · spear 2 · +2 · reach 2 · move 3
    "goblin_slinger",    // SRD Goblin        → HP 4 · AC 12 · sling 2 · +2 · range 3 · move 3
    "goblin_shaman",     // SRD Goblin Adept  → HP 5 · AC 11 · caster (scorching ray) · move 3
    "hobgoblin_boss",    // SRD Hobgoblin     → HP 9 · AC 14 · blade 4 · +3 · range 1 · move 3; killing it ROUTS the pack
    "giant_spider",      // SRD Monstrous Spider, Small → HP 10 · AC 14 · bite 4 · +4 · range 1 · move 4; poison/web
    "constrictor_snake", // SRD Snake, Constrictor → HP 12 · AC 13 · squeeze 5 · +4 · reach 1 · move 3; grab
  ],
};

// ───────────────────────────────────────────────────────────────────────────────────────────
// RAIDERS — rival pirate crews built from a token ENDOWMENT + gear LOADOUT (the PVP-snapshot path
// units.js buildOpponentUnit() already uses). endowment keys are REAL class-engine causes
// (burgers/egp/pump/char/ccc/bluechip); loadout ids are REAL armory ids (gear-data.js). Mirrors +
// extends location.js's ENEMY_POOL, adding the wishlist's "named captains + set loadouts".
// These are DROP-IN with TODAY's encounter.js (the foe carries an endowment).
// ───────────────────────────────────────────────────────────────────────────────────────────
export const RAIDERS = {
  tide_cutpurse:      { slug: "tide-cutpurse",      name: "Tide Cutpurse",        tier: 1, role: "melee",
    endowment: { egp: 8 },              loadout: { weapon: "dagger-iron",     armor: "armor-studded",     trinket: null } },     // SRD Human Rogue 1
  reef_scavenger:     { slug: "reef-scavenger",     name: "Reef Scavenger",       tier: 1, role: "melee",
    endowment: { burgers: 8 },          loadout: { weapon: "handaxe-iron",    armor: "armor",             trinket: null } },     // SRD Human Warrior 1
  brineblade:         { slug: "brineblade-marauder", name: "Brineblade Marauder", tier: 2, role: "melee",
    endowment: { burgers: 16, egp: 4 }, loadout: { weapon: "scimitar-iron",   armor: "armor-chain-shirt", trinket: "lantern" } }, // SRD Human Warrior 2
  gravewater:         { slug: "gravewater-conjurer", name: "Gravewater Conjurer", tier: 2, role: "caster",
    endowment: { pump: 14, char: 4 },   loadout: { weapon: "dagger-iron",     armor: "armor",             trinket: "lantern" },
    spells: ["magic_missile", "ray_of_frost"] },                                                                                  // SRD Human Adept/Sorcerer 2
  black_reach_reaver: { slug: "black-reach-reaver", name: "Black Reach Reaver",   tier: 3, role: "melee",
    endowment: { burgers: 28 },         loadout: { weapon: "greataxe-steel",  armor: "armor-chainmail",   trinket: "relic" } },   // SRD Human Barbarian 3
  kraken_corsair:     { slug: "kraken-corsair",     name: "Kraken Corsair",       tier: 3, role: "melee",
    endowment: { bluechip: 26 },        loadout: { weapon: "longsword-steel", armor: "armor-chainmail",   trinket: "spyglass" } },// SRD Human Fighter 3
  // ── named captains (boss leads — killing the lead ROUTS the crew) ──
  red_mowgli:         { slug: "red-mowgli",         name: "Red Mowgli",           tier: 3, role: "melee", boss: true,
    endowment: { burgers: 28, bluechip: 6 }, loadout: { weapon: "greataxe-steel", armor: "armor-breastplate", trinket: "relic" } }, // SRD Human Barbarian 4 (named captain)
  maw_caller:         { slug: "maw-leviathan-caller", name: "Maw Leviathan-Caller", tier: 3, role: "caster",
    endowment: { pump: 22, ccc: 6 },    loadout: { weapon: "warhammer-steel", armor: "armor-breastplate", trinket: "relic" },
    spells: ["magic_missile", "burning_hands", "ray_of_frost"] },                                                                 // SRD Human Cleric/Sorcerer 3
};

// ───────────────────────────────────────────────────────────────────────────────────────────
// ENCOUNTER_GROUPS — named monster GROUPS (multi-foe compositions). `n` is a fixed count or a
// [min,max] range rolled per encounter. `objective`: "wipe" (default) | "rout" (kill the lead) |
// "sever" (cut N limbs / survive — kraken). `deck` optionally overrides the area's battle map.
// ───────────────────────────────────────────────────────────────────────────────────────────
export const ENCOUNTER_GROUPS = {
  // ── SEA bestiary groups ──
  bilge_rat_swarm: { name: "Bilge Rat Swarm", objective: "wipe", flee: "half",
    members: [{ build: "monster", bestiary: "sea", id: "bilge_rat", name: "Bilge Rat", n: [4, 6], role: "minion" }] }, // SRD Dire Rat swarm (voyage hold)

  // FIRST REAL FIGHT starter — "a few bilge rats" (2–3), winnable by a lone party-leader. The full
  // [4,6] swarm above stays the rougher VOYAGE encounter; this smaller pack is the in-town Arena entry.
  bilge_rats_starter: { name: "Bilge Rats", objective: "wipe", flee: "half",
    members: [{ build: "monster", bestiary: "sea", id: "bilge_rat", name: "Bilge Rat", n: [2, 3], role: "minion" }] },

  lone_shark: { name: "Circling Shark", objective: "wipe",
    members: [{ build: "monster", bestiary: "sea", id: "shark", name: "Reef Shark", n: 1, role: "beast" }] },          // SRD Shark

  shark_pack: { name: "Shark Pack", objective: "wipe",
    members: [{ build: "monster", bestiary: "sea", id: "shark", name: "Reef Shark", n: [2, 4], role: "beast" }] },     // SRD Shark (feeding frenzy)

  merfolk_raid: { name: "Merfolk Raiders", objective: "wipe",
    members: [{ build: "monster", bestiary: "sea", id: "merfolk_raider", name: "Merfolk Raider", n: [2, 3], role: "skirmisher" }] }, // SRD Merfolk

  skeleton_boarders: { name: "Skeleton Crew", objective: "wipe",
    members: [{ build: "monster", bestiary: "sea", id: "skeleton_boarder", name: "Drowned Skeleton", n: [3, 5], role: "undead" }], // SRD Skeleton (ghost-ship boarders)
    deck: "two-ship" },

  navy_patrol: { name: "Navy Marine Line", objective: "wipe",
    members: [{ build: "monster", bestiary: "sea", id: "navy_marine", name: "Navy Marine", n: [3, 4], role: "ranged" }], // SRD Warrior w/ firearms
    deck: "two-ship" },

  sea_serpent: { name: "Sea Serpent", objective: "wipe", boss: true,
    members: [{ build: "monster", bestiary: "sea", id: "sea_serpent", name: "Sea Serpent", n: 1, role: "boss", lead: true }] }, // SRD Sea Serpent (mini-boss)

  kraken: { name: "The Kraken", objective: "sever", boss: true, survival: true, severFraction: 0.6,
    members: [{ build: "monster", bestiary: "sea", id: "kraken_tentacle", name: "Kraken Tentacle", n: [4, 6],
      role: "limb", telegraph: true, severable: true }] }, // SRD Kraken — model each limb as a severable pawn; win = sever N / survive

  // ── DUNGEON bestiary groups (caves / coves / jungle) ──
  goblin_pack: { name: "Cave Goblin Pack", objective: "rout", routsOnLeaderDeath: true,
    members: [
      { build: "monster", bestiary: "dungeon", id: "hobgoblin_boss",  name: "Hobgoblin Boss", n: 1,      role: "boss", lead: true }, // kill → pack routs
      { build: "monster", bestiary: "dungeon", id: "goblin_spearman", name: "Goblin Spear",   n: [2, 3], role: "melee" },
      { build: "monster", bestiary: "dungeon", id: "goblin_slinger",  name: "Goblin Slinger", n: [1, 2], role: "ranged" },
      { build: "monster", bestiary: "dungeon", id: "goblin_shaman",   name: "Goblin Shaman",  n: 1,      role: "caster" },
    ] }, // SRD Goblin pack + Hobgoblin leader

  // ⭐ PORT ROYAL GOBLIN CAVE — a SMALL, leaderless STARTER pack for a beginning party. Reuses the
  // SAME dungeon goblin stat blocks as goblin_pack (goblin_spearman / goblin_slinger), just fewer +
  // no boss, so a 1–4 pawn starting party can clear it. game/lib/goblin-cave.js rolls THIS via the
  // dedicated "goblin-cave" area below; nothing else references it, so it's purely additive.
  cave_goblins_starter: { name: "Cave Goblins", objective: "wipe",
    members: [
      { build: "monster", bestiary: "dungeon", id: "goblin_spearman", name: "Cave Goblin",   n: [2, 3], role: "melee" },  // SRD Goblin (→ goblin_spear)
      { build: "monster", bestiary: "dungeon", id: "goblin_slinger",  name: "Goblin Slinger", n: 1,      role: "ranged" }, // SRD Goblin w/ sling
    ] }, // 2–3 spears + 1 sling — a short scrap, no hobgoblin lead

  jungle_ambush: { name: "Jungle Ambush", objective: "wipe",
    members: [
      { build: "monster", bestiary: "dungeon", id: "giant_spider",      name: "Giant Spider",      n: [1, 2], role: "beast" },
      { build: "monster", bestiary: "dungeon", id: "constrictor_snake", name: "Constrictor Snake", n: 1,      role: "beast" },
    ] }, // SRD Monstrous Spider + Constrictor Snake

  // ── RAIDER groups (endowment / PVP-snapshot path — drop-in with today's encounter.js) ──
  petty_cutpurses: { name: "Tide Cutpurses", objective: "wipe",
    members: [{ build: "raider", raider: "tide_cutpurse", n: [1, 2] }] },

  scavenger_skiff: { name: "Reef Scavengers", objective: "wipe", deck: "two-ship",
    members: [{ build: "raider", raider: "reef_scavenger", n: [1, 2] }] },

  marauder_band: { name: "Brineblade Marauders", objective: "wipe", deck: "two-ship",
    members: [
      { build: "raider", raider: "brineblade", n: [1, 2] },
      { build: "raider", raider: "gravewater", n: 1 },
    ] },

  reaver_raid: { name: "Black Reach Reavers", objective: "wipe", deck: "two-ship",
    members: [
      { build: "raider", raider: "black_reach_reaver", n: [1, 2] },
      { build: "raider", raider: "gravewater", n: 1 },
    ] },

  corsair_boarding: { name: "Kraken Corsairs", objective: "wipe", deck: "two-ship",
    members: [{ build: "raider", raider: "kraken_corsair", n: [1, 2] }] },

  red_mowgli_crew: { name: "Red Mowgli's Cutthroats", objective: "rout", routsOnLeaderDeath: true, deck: "two-ship",
    members: [
      { build: "raider", raider: "red_mowgli", n: 1, lead: true },
      { build: "raider", raider: "brineblade", n: [1, 2] },
      { build: "raider", raider: "maw_caller", n: 1 },
    ] },
};

// ───────────────────────────────────────────────────────────────────────────────────────────
// EVENTS — non-combat table rows. `kind` lets a future handler route them (trade → shop, hazard →
// time/wave, loot → salvage, explore → board, lore/flavor → text). All hooks are flagged below.
// ───────────────────────────────────────────────────────────────────────────────────────────
export const EVENTS = {
  calm_seas:      { name: "Calm Seas",            kind: "flavor",  text: "Flat water and a fair wind. The watch stays sharp, but nothing stirs — sail on." },
  flotsam:        { name: "Flotsam & Jetsam",     kind: "loot",    text: "Wreckage drifts past. Salvage rope, planks, and a few stray coins.", loot: "salvage" },
  merchant_dhow:  { name: "Peddler's Dhow",       kind: "trade",   text: "A trader's dhow hails you and holds her hold open for barter.", shop: "small" },
  merchant_convoy:{ name: "Merchant Convoy",      kind: "trade",   text: "A guarded convoy will trade — better stock, but watchful guns.", shop: "large" },
  black_market:   { name: "Black-Market Buyer",   kind: "trade",   text: "A hooded factor buys what no honest port will. Coin for contraband.", shop: "blackmarket" },
  squall:         { name: "Squall",               kind: "hazard",  text: "A sudden squall. Reef the sails or lose time — and your footing.", hazard: "time" },
  storm_wall:     { name: "Storm Wall",           kind: "hazard",  text: "A wall of weather ahead. Waves sweep the deck; hold fast.", hazard: "wave" },
  derelict:       { name: "Derelict Hulk",        kind: "explore", text: "A dead ship wallows in the swell. Board her… if you dare.", explore: "derelict" },
  message_bottle: { name: "Message in a Bottle",  kind: "lore",    text: "A sealed bottle bobs alongside. A map fragment? A warning?", lore: true },
  pod_of_whales:  { name: "Pod of Whales",        kind: "flavor",  text: "Great shapes breach off the bow. The crew's spirits lift.", buff: "morale" },
  treasure_cache: { name: "Buried Cache",         kind: "explore", text: "An X gouged into a leaning palm. Dig — if the jungle lets you.", explore: "cache" },
};

// ───────────────────────────────────────────────────────────────────────────────────────────
// AREAS — the ten biomes of the expanding world. Each: dangerTier (1–5), the `map` (battle-deck
// background art id) it fights on, a `terrain` note (cover/hazard the deck should model), and a
// WEIGHTED `table` of combat groups + events. `minDanger` on a row gates apex content to rough water.
// ───────────────────────────────────────────────────────────────────────────────────────────
export const AREAS = {
  harbor: {
    id: "harbor", name: "Harbor & Home Waters", biome: "harbor", dangerTier: 1, map: "harbor",
    terrain: "Calm dock water; piers & moored hulls as cover. No hazards. The safe hub (Port Royal).",
    blurb: "The friendly shipping lane around the home port. Mostly trade and salvage; the odd cutpurse skiff.",
    table: [
      { kind: "event",  weight: 5, eventId: "calm_seas" },
      { kind: "event",  weight: 4, eventId: "merchant_dhow" },
      { kind: "event",  weight: 2, eventId: "flotsam" },
      { kind: "event",  weight: 1, eventId: "message_bottle" },
      { kind: "combat", weight: 2, groupId: "petty_cutpurses" },
    ],
  },

  "coastal-shallows": {
    id: "coastal-shallows", name: "Coastal Shallows", biome: "coast", dangerTier: 1, map: "shoals",
    terrain: "Knee-deep shoals; sandbars slow movement (−1 hex). Lone sharks lurk; gulls & wrecks.",
    blurb: "Sheltered water along the islands. Easy first fights: a scavenger skiff, a circling shark.",
    table: [
      { kind: "event",  weight: 4, eventId: "calm_seas" },
      { kind: "event",  weight: 3, eventId: "flotsam" },
      { kind: "event",  weight: 2, eventId: "merchant_dhow" },
      { kind: "combat", weight: 3, groupId: "scavenger_skiff" },
      { kind: "combat", weight: 2, groupId: "lone_shark" },
      { kind: "combat", weight: 2, groupId: "merfolk_raid", minDanger: 2 },
    ],
  },

  reef: {
    id: "reef", name: "Coral Reef & Tidepools", biome: "reef", dangerTier: 2, map: "reef",
    terrain: "Shallow coral; movement penalty in water, coral heads as cover. Sharks lurk; fall = shark bait.",
    blurb: "Bright, treacherous coral. Shark packs and merfolk hunt the shallows; scavengers pick the wrecks.",
    table: [
      { kind: "event",  weight: 3, eventId: "flotsam" },
      { kind: "event",  weight: 1, eventId: "calm_seas" },
      { kind: "combat", weight: 4, groupId: "shark_pack" },
      { kind: "combat", weight: 3, groupId: "merfolk_raid" },
      { kind: "combat", weight: 2, groupId: "scavenger_skiff" },
      { kind: "combat", weight: 2, groupId: "skeleton_boarders", minDanger: 3 },
    ],
  },

  "open-sea": {
    id: "open-sea", name: "The Open Sea", biome: "ocean", dangerTier: 3, map: "open-deck",
    terrain: "Big open deck; rails = fall-overboard hazard, masts = cover. Water-edge hexes for emergent foes.",
    blurb: "The trade-road of the deep water. Rival crews board you, shark packs circle — and rarely, the Kraken rises.",
    table: [
      { kind: "event",  weight: 2, eventId: "merchant_convoy" },
      { kind: "event",  weight: 2, eventId: "flotsam" },
      { kind: "event",  weight: 1, eventId: "derelict" },
      { kind: "combat", weight: 4, groupId: "marauder_band" },
      { kind: "combat", weight: 3, groupId: "shark_pack" },
      { kind: "combat", weight: 3, groupId: "corsair_boarding" },
      { kind: "combat", weight: 2, groupId: "navy_patrol" },
      { kind: "combat", weight: 1, groupId: "kraken", minDanger: 4 },
    ],
  },

  "deep-sea": {
    id: "deep-sea", name: "The Deep / The Maw", biome: "abyss", dangerTier: 4, map: "kraken-sea",
    terrain: "Heaving open deck over the abyss; water-edge tentacle spawns, rails = overboard. The apex waters.",
    blurb: "Far from any safe port. The Kraken and the Sea Serpent rule here, alongside the heaviest reaver crews.",
    table: [
      { kind: "event",  weight: 1, eventId: "derelict" },
      { kind: "event",  weight: 1, eventId: "storm_wall" },
      { kind: "combat", weight: 3, groupId: "sea_serpent" },
      { kind: "combat", weight: 3, groupId: "kraken" },
      { kind: "combat", weight: 3, groupId: "reaver_raid" },
      { kind: "combat", weight: 2, groupId: "skeleton_boarders" },
      { kind: "combat", weight: 2, groupId: "corsair_boarding" },
    ],
  },

  "sea-caves": {
    id: "sea-caves", name: "Sea Caves & Grottos", biome: "cave", dangerTier: 3, map: "cave",
    terrain: "Tight cavern; stalagmite cover, chokepoints, dark edges (limited sight). Home of the goblins.",
    blurb: "Smuggler-warren caves cut into the cliffs. Goblin packs and drowned skeletons defend the dark.",
    table: [
      { kind: "event",  weight: 2, eventId: "flotsam" },
      { kind: "event",  weight: 1, eventId: "message_bottle" },
      { kind: "combat", weight: 4, groupId: "goblin_pack" },
      { kind: "combat", weight: 3, groupId: "skeleton_boarders" },
      { kind: "combat", weight: 2, groupId: "scavenger_skiff" },
    ],
  },

  // ⭐ PORT ROYAL GOBLIN CAVE — a NAMED dungeon-entry area (not an open-water leg). Its table is a
  // SINGLE combat row, so rollEncounter("goblin-cave") ALWAYS returns the small goblin starter pack
  // (a guaranteed fight, the way a dungeon entry should behave). map "cave" reuses the existing cave
  // deck art. Foot-reachable land site on the Port Royal island (see game/lib/goblin-cave.js CAVE.hex).
  "goblin-cave": {
    id: "goblin-cave", name: "Goblin Cave (Port Royal)", biome: "cave", dangerTier: 1, map: "cave",
    terrain: "Tight cliff cavern bored into the Port Royal headland; stalagmite cover + dark chokepoints. A small goblin den.",
    blurb: "A goblin warren in the Port Royal cliffs — a short overland march from the harbour. A starter scrap against a small goblin pack.",
    table: [
      { kind: "combat", weight: 1, groupId: "cave_goblins_starter" },
    ],
  },

  "ship-bilge": {
    id: "ship-bilge", name: "Ship's Bilge & Hold", biome: "interior", dangerTier: 1, map: "bilge",
    terrain: "Cramped hold; water pools (hazard), barrels & cargo as cover. The signature first squad fight.",
    blurb: "Below your own decks. A swarm of bilge rats — the perfect 'lots of cheap bodies' tutorial scrap.",
    table: [
      { kind: "event",  weight: 2, eventId: "calm_seas" },
      { kind: "combat", weight: 6, groupId: "bilge_rat_swarm" },
      { kind: "combat", weight: 1, groupId: "skeleton_boarders", minDanger: 2 },
    ],
  },

  // BILGE RATS — the FIRST REAL FIGHT (in-town Arena starter; no travel). Unlike "ship-bilge"
  // (the general voyage hold, with events + a danger-gated skeleton row), this area has a SINGLE
  // combat row, so a roll ALWAYS yields the winnable rat swarm — the deterministic, stakes entry
  // fight the bilge LootPool (0xE07CE9Ec…) pays out (mirrors the "goblin-cave" single-row pattern).
  "bilge-rats": {
    id: "bilge-rats", name: "Bilge Rats (Arena)", biome: "interior", dangerTier: 1, map: "bilge",
    terrain: "The Arena's flooded under-hold — barrels for cover, ankle-deep bilge water. The first real scrap.",
    blurb: "Your first REAL fight: a swarm of bilge rats boils up from the hold. Win and the Rogue Network pays your cut.",
    table: [
      { kind: "combat", weight: 1, groupId: "bilge_rats_starter" },
    ],
  },

  "storm-front": {
    id: "storm-front", name: "Storm Front", biome: "weather", dangerTier: 4, map: "storm",
    terrain: "Slick storm deck; a wave hazard sweeps a row each round, footing is slippery. Weather is the real foe.",
    blurb: "A wall of weather. Mostly survival against the sea itself — plus opportunists who ride the gale in.",
    table: [
      { kind: "event",  weight: 4, eventId: "storm_wall" },
      { kind: "event",  weight: 3, eventId: "squall" },
      { kind: "combat", weight: 3, groupId: "reaver_raid" },
      { kind: "combat", weight: 2, groupId: "sea_serpent", minDanger: 4 },
      { kind: "combat", weight: 1, groupId: "kraken", minDanger: 5 },
    ],
  },

  "smuggler-cove": {
    id: "smuggler-cove", name: "Smuggler's Cove", biome: "cove", dangerTier: 2, map: "cove",
    terrain: "Hidden anchorage; jetty & crates cover, narrow mouth chokepoint. A black-market haunt.",
    blurb: "A pirate hideaway. Trade contraband at the black market — or fight the crews who call it home.",
    table: [
      { kind: "event",  weight: 3, eventId: "black_market" },
      { kind: "event",  weight: 2, eventId: "merchant_dhow" },
      { kind: "combat", weight: 3, groupId: "marauder_band" },
      { kind: "combat", weight: 2, groupId: "goblin_pack" },
      { kind: "combat", weight: 2, groupId: "petty_cutpurses" },
      { kind: "combat", weight: 1, groupId: "red_mowgli_crew", minDanger: 3 },
    ],
  },

  "island-jungle": {
    id: "island-jungle", name: "Island Jungle", biome: "jungle", dangerTier: 3, map: "jungle",
    terrain: "Dense landfall; foliage cover & sight blocks, vine-tangle slows movement. Buried treasure & ambush.",
    blurb: "Ashore on a wild island. Jungle beasts and goblin warrens guard the X-marked caches.",
    table: [
      { kind: "event",  weight: 3, eventId: "treasure_cache" },
      { kind: "event",  weight: 1, eventId: "calm_seas" },
      { kind: "combat", weight: 4, groupId: "jungle_ambush" },
      { kind: "combat", weight: 3, groupId: "goblin_pack" },
      { kind: "combat", weight: 2, groupId: "scavenger_skiff" },
      { kind: "combat", weight: 1, groupId: "red_mowgli_crew", minDanger: 4 },
    ],
  },
};

// ───────────────────────────────────────────────────────────────────────────────────────────
// AREA_HINTS — a light bridge from location.js's world to an area id, WITHOUT importing location.js
// (string hints only, so this file stays standalone). A future wiring step can read the ship's
// port danger / region (location.js PORTS) and pick a default open-water area to roll in.
// ───────────────────────────────────────────────────────────────────────────────────────────
export const AREA_HINTS = {
  // location.js PORTS[].danger (0..3 today) → a sensible OPEN-WATER area for that roughness.
  byPortDanger: { 0: "harbor", 1: "coastal-shallows", 2: "open-sea", 3: "deep-sea" },
  // location.js PORT regions → a themed area near that port.
  byRegion: {
    "Crown Waters": "harbor",
    "Buccaneer Shallows": "smuggler-cove",
    "Saltmarsh Reach": "coastal-shallows",
    "Beacon Light": "coastal-shallows",
    "Bonewater Atolls": "reef",
    "The Maw": "deep-sea",
    "The Black Reach": "sea-caves",
  },
  // areas chosen by GAME STATE, not by the open-water map (onboard / landfall / weather).
  onboard: "ship-bilge",
  landfall: "island-jungle",
  weather: "storm-front",
};

// ───────────────────────────────────────────────────────────────────────────────────────────
// FOE BUILDERS — expand a group's compact composition into a flat list of foe snapshots.
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Build ONE raider foe snapshot (endowment + loadout). Shape matches units.js buildOpponentUnit. */
function makeRaiderFoe(raiderKey, rng, idx) {
  const t = RAIDERS[raiderKey];
  if (!t) throw new Error(`area-encounters: unknown raider "${raiderKey}".`);
  return {
    id: `pve-${t.slug}-${tag(rng)}-${idx}`,
    name: t.name,
    build: "raider",
    role: t.role || "melee",
    endowment: { ...t.endowment }, // → class-engine stats (drop-in with encounter.js today)
    loadout: { ...t.loadout },     // → real armory ids (items.js / gear-data.js)
    spells: t.spells ? [...t.spells] : undefined,
    boss: !!t.boss,
  };
}

/** Build ONE monster foe snapshot (direct-stat path). makeMonster() resolves `monsterId` from the bestiary. */
function makeMonsterFoe(ref, rng, idx) {
  return {
    id: `pve-${ref.id}-${tag(rng)}-${idx}`,
    name: ref.name,
    build: "monster",
    monsterId: ref.id,         // bestiary key → SEA_BESTIARY / DUNGEON_BESTIARY
    bestiary: ref.bestiary,    // "sea" | "dungeon"
    role: ref.role || "minion",
    // hints the battle loop / makeMonster read (telegraph & sever for the Kraken, etc.):
    telegraph: !!ref.telegraph,
    severable: !!ref.severable,
  };
}

/** Expand a group id → { groupName, objective, group:[foe…], roster, lead, … }. Throws on bad ids. */
function expandGroup(groupId, rng) {
  const g = ENCOUNTER_GROUPS[groupId];
  if (!g) throw new Error(`area-encounters: unknown group "${groupId}".`);
  const group = [];
  const roster = [];
  let idx = 0;
  let lead = null;
  for (const m of g.members) {
    const count = rollCount(m.n, rng);
    const display = m.name || (m.raider && RAIDERS[m.raider] && RAIDERS[m.raider].name) || m.id || "Foe";
    if (count > 0) roster.push({ name: display, count, build: m.build });
    for (let i = 0; i < count; i++) {
      const foe = m.build === "raider"
        ? makeRaiderFoe(m.raider, rng, idx++)
        : makeMonsterFoe(m, rng, idx++);
      if (m.lead && !lead) { lead = foe; foe.lead = true; }
      group.push(foe);
    }
  }
  if (!group.length) throw new Error(`area-encounters: group "${groupId}" produced no foes.`);
  // Put the lead first so enemy=group[0] is the boss for rout/boss groups.
  if (lead && group[0] !== lead) {
    const i = group.indexOf(lead);
    group.splice(i, 1);
    group.unshift(lead);
  }
  return {
    groupId,
    groupName: g.name,
    objective: g.objective || "wipe",
    routsOnLeaderDeath: !!g.routsOnLeaderDeath,
    survival: !!g.survival,
    severTarget: g.severFraction ? Math.max(2, Math.round(group.length * g.severFraction)) : null,
    deck: g.deck || null,
    group,
    roster,
    lead,
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// THE ROLL
// ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Roll a random encounter for an area at a given danger.
 *
 * @param {string} areaId               an AREAS key (e.g. "open-sea")
 * @param {number} [danger]             0..5 situational roughness; defaults to the area's dangerTier
 * @param {() => number} [rng]          rng → [0,1); pass a seeded one (mulberry32) for deterministic rolls
 * @returns {object} a COMBAT encounter (encounter.js's PVE shape, extended with `group`) OR an EVENT:
 *   combat → { type:"pve", areaId, area, danger, map, routeId, groupId, groupName, objective,
 *              routsOnLeaderDeath, severTarget, survival, roster, group:[…], enemy, lead }
 *   event  → { type:"event", areaId, area, danger, map, eventId, event }
 */
export function rollEncounter(areaId, danger, rng = Math.random) {
  const area = AREAS[areaId];
  if (!area) throw new Error(`area-encounters: unknown area "${areaId}" (known: ${Object.keys(AREAS).join(", ")}).`);
  if (typeof rng !== "function") throw new Error("area-encounters: rng must be a function returning [0,1).");
  const d = Number.isFinite(danger) ? Math.max(0, Math.min(5, danger)) : area.dangerTier;

  // Rows allowed at this danger (apex rows gated by minDanger).
  const allowed = area.table.filter((r) => (r.minDanger ?? 0) <= d);
  if (!allowed.length) throw new Error(`area-encounters: area "${areaId}" has no rows at danger ${d}.`);

  // Gentle bias: rougher water favours combat rows; events stay flat.
  const bias = combatBias(d);
  const weighted = allowed.map((r) => ({ row: r, w: Math.max(0, r.weight) * (r.kind === "combat" ? bias : 1) }));
  const choice = weightedPick(weighted, rng);

  if (choice.kind === "event") {
    const ev = EVENTS[choice.eventId];
    if (!ev) throw new Error(`area-encounters: unknown event "${choice.eventId}" in area "${areaId}".`);
    return {
      type: "event",
      areaId, area: area.name, danger: d, map: area.map,
      eventId: choice.eventId,
      event: { id: choice.eventId, ...ev },
    };
  }

  // Combat row.
  const ex = expandGroup(choice.groupId, rng);
  return {
    type: "pve",
    areaId, area: area.name, danger: d,
    map: ex.deck || area.map,    // boarding/two-ship groups may override the deck art
    routeId: area.id,            // parity with encounter.js's context (a route/area tag)
    groupId: ex.groupId,
    groupName: ex.groupName,
    objective: ex.objective,
    routsOnLeaderDeath: ex.routsOnLeaderDeath,
    severTarget: ex.severTarget,
    survival: ex.survival,
    roster: ex.roster,
    group: ex.group,             // FULL multi-enemy list (the new spawn loop reads this)
    enemy: ex.group[0],          // single-foe back-compat (today's encounter.js bridge)
    lead: ex.lead || null,
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Read-only helpers (UI / map / tests)
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Compact list of every area (id, name, biome, dangerTier, map). */
export function listAreas() {
  return Object.values(AREAS).map((a) => ({
    id: a.id, name: a.name, biome: a.biome, dangerTier: a.dangerTier, map: a.map,
  }));
}

/** Full summary of one area: its combats + events + terrain. Throws on a bad id. */
export function areaSummary(areaId) {
  const a = AREAS[areaId];
  if (!a) throw new Error(`area-encounters: unknown area "${areaId}".`);
  return {
    id: a.id, name: a.name, biome: a.biome, dangerTier: a.dangerTier, map: a.map,
    terrain: a.terrain, blurb: a.blurb,
    combats: a.table.filter((r) => r.kind === "combat").map((r) => r.groupId),
    events: a.table.filter((r) => r.kind === "event").map((r) => r.eventId),
  };
}
