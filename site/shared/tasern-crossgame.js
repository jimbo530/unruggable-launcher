/**
 * Tasern Cross-Game Integration v1.0
 * Connects Baselings, Tales of Tasern D20, and the Tasern Arcade
 * into one unified ecosystem with shared progress and rewards.
 *
 * Usage: <script src="/shared/tasern-crossgame.js"></script>
 * Non-intrusive: if this fails to load, all games work independently.
 *
 * API:
 *   TasernCrossGame.init()
 *   TasernCrossGame.getProfile()
 *   TasernCrossGame.sync()
 *   TasernCrossGame.emit(event, data)
 *   TasernCrossGame.on(event, callback)
 *   TasernCrossGame.getBaselingCompanion(baselingId)
 *   TasernCrossGame.getDungeonRewards()
 *   TasernCrossGame.getArcadeRewards()
 *   TasernCrossGame.getD20Blessings()
 *   TasernCrossGame.getArcadeBonuses()
 *   TasernCrossGame.notify(msg, source, target)
 */
const TasernCrossGame = (function() {
"use strict";

// ============================================================
// CONSTANTS
// ============================================================
const VERSION = "1.0.0";
const PROFILE_KEY = "tasern_profile";
const CROSSGAME_KEY = "tasern_crossgame";
const NOTIFICATIONS_KEY = "tasern_crossgame_notifications";

// localStorage keys for each game
const KEYS = {
  baseling: "baseling-save-v1",
  d20_prefix: "tot-character-save",  // appended with -wallet
  d20_battle: "tot-battle-state",
  arcade: "tasern_badges"
};

// ============================================================
// EVENT BUS
// ============================================================
const listeners = {};

function emit(event, data) {
  const handlers = listeners[event] || [];
  for (let i = 0; i < handlers.length; i++) {
    try { handlers[i](data); }
    catch (e) { console.warn("[CrossGame] Event handler error:", event, e.message); }
  }
  // Also dispatch a DOM event so other scripts can listen
  try {
    window.dispatchEvent(new CustomEvent("tasern-crossgame", {
      detail: { event, data, timestamp: Date.now() }
    }));
  } catch (e) { console.warn("[CrossGame] CustomEvent dispatch failed:", e.message); }
}

function on(event, callback) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(callback);
  return function off() {
    listeners[event] = listeners[event].filter(function(fn) { return fn !== callback; });
  };
}

// ============================================================
// STORAGE HELPERS
// ============================================================
function safeGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn("[CrossGame] Failed to read", key, e.message);
    return null;
  }
}

function safeSet(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn("[CrossGame] Failed to write", key, e.message);
    return false;
  }
}

function loadCrossGameState() {
  return safeGet(CROSSGAME_KEY) || {
    version: VERSION,
    rewards: {
      dungeon_treats: 0,
      companion_scrolls: [],
      d20_stat_gifts: [],
      arcade_tokens: 0,
      d20_blessings: [],
      d20_tournament_items: [],
      season_tier: 0
    },
    unlocks: {
      gamer_trait: false,
      hard_mode: false,
      arcade_accessories: [],
      baseling_accessories: []
    },
    notifications_seen: [],
    last_sync: 0
  };
}

function saveCrossGameState(state) {
  state.last_sync = Date.now();
  safeSet(CROSSGAME_KEY, state);
}

// ============================================================
// GAME DATA READERS
// ============================================================

function readBaselingData() {
  const save = safeGet(KEYS.baseling);
  if (!save || !save.baselings) return null;

  const baselings = save.baselings || [];
  let highestLevel = 0;
  let totalBattleWins = 0;

  for (let i = 0; i < baselings.length; i++) {
    const b = baselings[i];
    const stats = b.stats || {};
    const level = Math.floor(
      ((stats.str || 0) + (stats.dex || 0) + (stats.con || 0) +
       (stats.int || 0) + (stats.wis || 0) + (stats.cha || 0)) / 6
    );
    if (level > highestLevel) highestLevel = level;
    totalBattleWins += (b.raceWins || 0);
  }

  return {
    count: baselings.filter(function(b) { return b.alive !== false; }).length,
    total: baselings.length,
    highestLevel: highestLevel,
    totalBattleWins: totalBattleWins,
    baselings: baselings,
    totalPoop: save.totalPoop || 0,
    wallet: save.gameWallet || save.mainWallet || null
  };
}

function readD20Data() {
  // D20 saves are per-wallet, try to find any
  let save = null;
  let wallet = null;

  // Check all localStorage keys for tot-character-save prefix
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(KEYS.d20_prefix)) {
        const candidate = safeGet(key);
        if (candidate && candidate.level) {
          // Use the highest level character found
          if (!save || candidate.level > save.level) {
            save = candidate;
            wallet = candidate.wallet || key.replace(KEYS.d20_prefix + "-", "");
          }
        }
      }
    }
  } catch (e) {
    console.warn("[CrossGame] Error scanning D20 saves:", e.message);
  }

  if (!save) return null;

  return {
    characterLevel: save.level || 1,
    xp: save.xp || 0,
    class_id: save.class_id || "fighter",
    dungeonsCleared: Object.keys(save.quest_flags || {}).filter(function(k) {
      return k.startsWith("dungeon_") && save.quest_flags[k];
    }).length,
    questsCompleted: Object.keys(save.quest_flags || {}).filter(function(k) {
      return save.quest_flags[k];
    }).length,
    battlesWon: save.battles_won || 0,
    battlesLost: save.battles_lost || 0,
    day: save.day || 1,
    coins: save.coins || { gp: 0, sp: 0, cp: 0 },
    inventory: save.inventory || [],
    equipment: save.equipment || {},
    wallet: wallet
  };
}

function readArcadeData() {
  const state = safeGet(KEYS.arcade);
  if (!state) return null;

  const scores = state.scores || {};
  let totalScore = 0;
  const gameNames = Object.keys(scores);
  for (let i = 0; i < gameNames.length; i++) {
    totalScore += (scores[gameNames[i]] || 0);
  }

  return {
    gamesPlayed: (state.games_played || []).length,
    uniqueGames: new Set(state.games_played || []).size,
    totalScore: totalScore,
    badgesEarned: (state.badges_earned || []).length,
    badges: state.badges_earned || [],
    genres: state.genres_played || [],
    sessionGames: state.session_games || [],
    scores: scores
  };
}

// ============================================================
// BASELING -> D20 COMPANION TRANSLATION
// ============================================================

/**
 * Convert a baseling's stats to D20 ability scores.
 * Baseling stats: str, dex, con, int, wis, cha (1-100 scale)
 * D20 stats: STR, DEX, CON, INT, WIS, CHA (3-20 scale, with companion cap)
 */
function translateBaselingToD20(baseling) {
  if (!baseling || !baseling.stats) return null;

  const stats = baseling.stats;
  // Map baseling 0-100 scale to D20 3-18 companion range
  // Companions cap at level/2 + 8 for max stat (so lv10 baseling = max 13)
  function scale(val) {
    return Math.max(3, Math.min(18, Math.floor(3 + (val || 0) * 15 / 100)));
  }

  // Determine baseling effective level (avg of all stats / 10, floored)
  const avgStat = ((stats.str || 0) + (stats.dex || 0) + (stats.con || 0) +
                   (stats.int || 0) + (stats.wis || 0) + (stats.cha || 0)) / 6;
  const companionLevel = Math.max(1, Math.floor(avgStat / 10));

  // Happiness/hunger bonus
  let conditionBonus = 0;
  if (baseling.hunger !== undefined) {
    // hunger 0 = full, 100 = starving. Happy 0-100.
    const wellFed = (baseling.hunger || 0) < 30;
    const happy = (baseling.happy || 0) > 70;
    if (wellFed && happy) conditionBonus = 2;
    else if (wellFed || happy) conditionBonus = 1;
  }

  // Determine species abilities based on evolution/type
  const abilities = getCompanionAbilities(baseling);

  return {
    name: baseling.charName || "Baseling",
    id: baseling.id,
    level: companionLevel,
    stats: {
      STR: scale(stats.str) + conditionBonus,
      DEX: scale(stats.dex) + conditionBonus,
      CON: scale(stats.con),
      INT: scale(stats.int),
      WIS: scale(stats.wis),
      CHA: scale(stats.cha)
    },
    hp: companionLevel * 4 + scale(stats.con) - 10,
    ac: 10 + Math.floor((scale(stats.dex) - 10) / 2) + Math.min(companionLevel, 4),
    attack_bonus: companionLevel + Math.floor((scale(stats.str) - 10) / 2),
    abilities: abilities,
    conditionBonus: conditionBonus,
    species: baseling.charId || "unknown",
    rarity: baseling.combinedRarity || baseling.charRarity || "common",
    element: getBaselingElement(baseling),
    source: "baseling_companion"
  };
}

function getCompanionAbilities(baseling) {
  const abilities = [];
  const stats = baseling.stats || {};
  const tier = baseling.evoTier || 0;

  // Base ability: Tackle (all companions)
  abilities.push({
    name: "Tackle",
    type: "attack",
    damage: "1d4",
    description: "A basic physical attack"
  });

  // STR-focused: Slam
  if ((stats.str || 0) > 40) {
    abilities.push({
      name: "Slam",
      type: "attack",
      damage: "1d6",
      description: "A powerful body blow"
    });
  }

  // DEX-focused: Quick Strike
  if ((stats.dex || 0) > 40) {
    abilities.push({
      name: "Quick Strike",
      type: "attack",
      damage: "1d4+2",
      description: "A fast, precise attack. +2 to hit."
    });
  }

  // INT-focused: Spore Burst (magic damage)
  if ((stats.int || 0) > 40) {
    abilities.push({
      name: "Spore Burst",
      type: "magic",
      damage: "1d6",
      description: "Releases a cloud of damaging spores"
    });
  }

  // WIS-focused: Heal Pulse
  if ((stats.wis || 0) > 50) {
    abilities.push({
      name: "Heal Pulse",
      type: "heal",
      damage: "1d4+1",
      description: "Heals an ally for a small amount"
    });
  }

  // CHA-focused: Intimidate
  if ((stats.cha || 0) > 50) {
    abilities.push({
      name: "Intimidate",
      type: "debuff",
      effect: "fear",
      description: "May cause an enemy to flee for 1 round"
    });
  }

  // Evolution tier abilities
  if (tier >= 1) {
    abilities.push({
      name: "Evolve Strike",
      type: "attack",
      damage: "1d8",
      description: "Empowered attack from evolutionary growth"
    });
  }
  if (tier >= 2) {
    abilities.push({
      name: "Primal Surge",
      type: "buff",
      effect: "all_stats_+1",
      description: "Temporarily boosts all party stats by 1"
    });
  }

  return abilities;
}

function getBaselingElement(baseling) {
  // Determine element from birth theme or color variant
  const theme = baseling.birthTheme || "";
  const color = baseling.colorVariant || "";

  if (theme.includes("fire") || color.includes("red")) return "fire";
  if (theme.includes("water") || color.includes("blue")) return "water";
  if (theme.includes("earth") || color.includes("green")) return "earth";
  if (theme.includes("air") || color.includes("white")) return "air";
  if (theme.includes("shadow") || color.includes("purple")) return "shadow";
  if (theme.includes("light") || color.includes("gold")) return "light";
  return "neutral";
}

// ============================================================
// D20 -> BASELING REWARDS
// ============================================================

const DUNGEON_TREATS = {
  easy: { name: "Goblin Grub", nutrition: 15, rarity: "common" },
  medium: { name: "Mushroom Stew", nutrition: 30, rarity: "uncommon" },
  hard: { name: "Dragon Fruit", nutrition: 50, rarity: "rare" },
  deadly: { name: "Celestial Nectar", nutrition: 80, rarity: "epic" }
};

const COMPANION_SCROLLS = [
  { id: "scroll_flame_breath", name: "Scroll of Flame Breath", move: "Flame Breath", stat: "str", min_level: 3 },
  { id: "scroll_shadow_step", name: "Scroll of Shadow Step", move: "Shadow Step", stat: "dex", min_level: 5 },
  { id: "scroll_stone_skin", name: "Scroll of Stone Skin", move: "Stone Skin", stat: "con", min_level: 4 },
  { id: "scroll_mind_blast", name: "Scroll of Mind Blast", move: "Mind Blast", stat: "int", min_level: 6 },
  { id: "scroll_nature_call", name: "Scroll of Nature's Call", move: "Nature's Call", stat: "wis", min_level: 5 },
  { id: "scroll_charm", name: "Scroll of Charm", move: "Charm", stat: "cha", min_level: 4 }
];

const STAT_GIFT_ITEMS = [
  { id: "gift_str_gauntlet", name: "Gauntlet of Might", stat: "str", bonus: 2, d20_item: "gauntlets_of_ogre_power" },
  { id: "gift_dex_boots", name: "Boots of Speed", stat: "dex", bonus: 2, d20_item: "boots_of_elvenkind" },
  { id: "gift_con_amulet", name: "Amulet of Vitality", stat: "con", bonus: 2, d20_item: "amulet_of_health" },
  { id: "gift_int_circlet", name: "Circlet of Thought", stat: "int", bonus: 2, d20_item: "headband_of_intellect" },
  { id: "gift_wis_pendant", name: "Pendant of Insight", stat: "wis", bonus: 2, d20_item: "periapt_of_wisdom" },
  { id: "gift_cha_cloak", name: "Cloak of Presence", stat: "cha", bonus: 2, d20_item: "cloak_of_charisma" }
];

/**
 * Check D20 progress and generate rewards for baseling game.
 * Called on sync — returns pending rewards not yet claimed.
 */
function calculateDungeonRewards(d20Data, crossState) {
  if (!d20Data) return [];
  const rewards = [];
  const claimed = crossState.rewards.d20_stat_gifts || [];

  // Dungeon treats: 1 per dungeon cleared
  const treatsOwed = d20Data.dungeonsCleared - (crossState.rewards.dungeon_treats || 0);
  if (treatsOwed > 0) {
    for (let i = 0; i < treatsOwed; i++) {
      // Difficulty based on character level
      const diff = d20Data.characterLevel >= 10 ? "deadly" :
                   d20Data.characterLevel >= 7 ? "hard" :
                   d20Data.characterLevel >= 4 ? "medium" : "easy";
      rewards.push({
        type: "dungeon_treat",
        item: DUNGEON_TREATS[diff],
        source: "d20_dungeon"
      });
    }
  }

  // Companion scrolls: every 5 quests completed
  const scrollsEarned = Math.floor(d20Data.questsCompleted / 5);
  const scrollsOwned = (crossState.rewards.companion_scrolls || []).length;
  if (scrollsEarned > scrollsOwned) {
    const available = COMPANION_SCROLLS.filter(function(s) {
      return !crossState.rewards.companion_scrolls.some(function(owned) {
        return owned.id === s.id;
      });
    });
    if (available.length > 0) {
      const scroll = available[Math.floor(Math.random() * available.length)];
      rewards.push({
        type: "companion_scroll",
        item: scroll,
        source: "d20_quests"
      });
    }
  }

  // Stat gift items: every 20 battles won
  const giftsEarned = Math.floor(d20Data.battlesWon / 20);
  if (giftsEarned > claimed.length) {
    const available = STAT_GIFT_ITEMS.filter(function(g) {
      return !claimed.some(function(c) { return c.id === g.id; });
    });
    if (available.length > 0) {
      const gift = available[Math.floor(Math.random() * available.length)];
      rewards.push({
        type: "stat_gift",
        item: gift,
        source: "d20_battles"
      });
    }
  }

  // Gold -> baseling accessories (10gp buys 1 accessory token)
  const goldTotal = d20Data.coins.gp || 0;
  if (goldTotal >= 10) {
    rewards.push({
      type: "accessory_available",
      gold_cost: 10,
      source: "d20_gold",
      message: "You have enough gold to buy a baseling accessory (10gp)"
    });
  }

  return rewards;
}

// ============================================================
// ARCADE -> BASELING REWARDS
// ============================================================

const ARCADE_COSMETICS = [
  { id: "hat_pixel", name: "Pixel Crown", cost: 50, type: "head" },
  { id: "hat_joystick", name: "Joystick Hat", cost: 30, type: "head" },
  { id: "acc_controller", name: "Mini Controller", cost: 40, type: "accessory" },
  { id: "acc_coin", name: "Arcade Coin Necklace", cost: 20, type: "accessory" },
  { id: "food_power_pellet", name: "Power Pellet", cost: 15, type: "food", nutrition: 25 },
  { id: "food_bonus_fruit", name: "Bonus Fruit", cost: 10, type: "food", nutrition: 15 },
  { id: "speedup_warp", name: "Warp Star", cost: 100, type: "speedup", duration_min: 30 }
];

const ARCADE_GAME_ACCESSORIES = {
  "tasern_pinball": { id: "acc_pinball_flipper", name: "Pinball Flipper Badge", threshold: 50000 },
  "spore_defense": { id: "acc_tower_helm", name: "Tower Guardian Helm", threshold: 10 },
  "rhythm_baseling": { id: "acc_music_note", name: "Rhythm Note", threshold: 1 },
  "tasern_quest": { id: "acc_quest_scroll", name: "Quest Scroll", threshold: 1 },
  "baseling_sluggers": { id: "acc_baseball_cap", name: "Champion Cap", threshold: 1 }
};

function calculateArcadeRewards(arcadeData, crossState) {
  if (!arcadeData) return [];
  const rewards = [];

  // Arcade tokens: 1 per 1000 total score
  const tokensEarned = Math.floor(arcadeData.totalScore / 1000);
  const tokensOwned = crossState.rewards.arcade_tokens || 0;
  if (tokensEarned > tokensOwned) {
    rewards.push({
      type: "arcade_tokens",
      amount: tokensEarned - tokensOwned,
      source: "arcade_score"
    });
  }

  // Gamer trait: play 10+ unique games
  if (arcadeData.uniqueGames >= 10 && !crossState.unlocks.gamer_trait) {
    rewards.push({
      type: "trait_unlock",
      trait: "gamer",
      source: "arcade_diversity",
      message: "You played 10+ arcade games! Your baseling earned the 'Gamer' trait!"
    });
  }

  // Game-specific accessories
  const scores = arcadeData.scores || {};
  const owned = crossState.unlocks.arcade_accessories || [];
  const gameKeys = Object.keys(ARCADE_GAME_ACCESSORIES);
  for (let i = 0; i < gameKeys.length; i++) {
    const game = gameKeys[i];
    const acc = ARCADE_GAME_ACCESSORIES[game];
    if ((scores[game] || 0) >= acc.threshold && owned.indexOf(acc.id) === -1) {
      rewards.push({
        type: "accessory_unlock",
        item: acc,
        source: "arcade_" + game,
        message: "Beating " + game + " unlocked: " + acc.name + "!"
      });
    }
  }

  return rewards;
}

// ============================================================
// ARCADE -> D20 BLESSINGS
// ============================================================

const ARCADE_BLESSINGS = [
  { id: "bless_first_steps", badge: "first_steps", stat: "CON", bonus: 1, name: "Blessing of Beginnings" },
  { id: "bless_explorer", badge: "explorer", stat: "WIS", bonus: 1, name: "Explorer's Insight" },
  { id: "bless_adventurer", badge: "adventurer", stat: "DEX", bonus: 1, name: "Adventurer's Reflexes" },
  { id: "bless_veteran", badge: "veteran", stat: "STR", bonus: 1, name: "Veteran's Might" },
  { id: "bless_high_scorer", badge: "high_scorer", stat: "INT", bonus: 1, name: "Scholar's Focus" },
  { id: "bless_speed_demon", badge: "speed_demon", stat: "DEX", bonus: 1, name: "Quickened Step" },
  { id: "bless_puzzle_master", badge: "puzzle_master", stat: "INT", bonus: 2, name: "Puzzle Master's Logic" },
  { id: "bless_boss_slayer", badge: "boss_slayer", stat: "STR", bonus: 2, name: "Slayer's Fury" },
  { id: "bless_legend", badge: "legend", stat: "ALL", bonus: 1, name: "Legendary Aura" }
];

function calculateD20Blessings(arcadeData, crossState) {
  if (!arcadeData) return [];
  const blessings = [];
  const earned = crossState.rewards.d20_blessings || [];
  const badges = arcadeData.badges || [];

  for (let i = 0; i < ARCADE_BLESSINGS.length; i++) {
    const blessing = ARCADE_BLESSINGS[i];
    if (badges.indexOf(blessing.badge) !== -1 && earned.indexOf(blessing.id) === -1) {
      blessings.push({
        type: "d20_blessing",
        item: blessing,
        source: "arcade_badge_" + blessing.badge,
        message: "Arcade badge '" + blessing.badge + "' grants: " + blessing.name + " (+" + blessing.bonus + " " + blessing.stat + ")"
      });
    }
  }

  // Season tier rewards
  const tier = arcadeData.badgesEarned || 0;
  if (tier >= 30 && earned.indexOf("season_companion") === -1) {
    blessings.push({
      type: "d20_companion",
      item: {
        id: "arcade_champion",
        name: "Arcade Champion",
        stats: { STR: 14, DEX: 16, CON: 12, INT: 14, WIS: 10, CHA: 14 },
        abilities: [
          { name: "Pixel Slash", type: "attack", damage: "2d6" },
          { name: "Extra Life", type: "heal", damage: "2d8" }
        ]
      },
      source: "arcade_season_30",
      message: "Season Tier 30 reached! Arcade Champion companion unlocked in D20!"
    });
  }

  // Tournament wins (10+ unique games with top scores)
  const topScores = Object.keys(arcadeData.scores || {}).filter(function(g) {
    return arcadeData.scores[g] >= 10000;
  }).length;
  if (topScores >= 5 && earned.indexOf("tournament_item") === -1) {
    blessings.push({
      type: "d20_item",
      item: { id: "sword_of_the_arcade", name: "Sword of the Arcade", damage: "1d8+2", properties: ["magic", "light"] },
      source: "arcade_tournament",
      message: "5 games with 10K+ score! Earned: Sword of the Arcade for D20!"
    });
  }

  return blessings;
}

// ============================================================
// BASELING -> ARCADE BONUSES
// ============================================================

function calculateArcadeBonuses(baselingData) {
  if (!baselingData) return { multiplier: 1.0, hardMode: false, elementBonus: null };

  const baselings = baselingData.baselings || [];
  let highestLevel = 0;
  let bestHappiness = 0;
  let element = "neutral";

  for (let i = 0; i < baselings.length; i++) {
    const b = baselings[i];
    if (b.alive === false) continue;
    const stats = b.stats || {};
    const level = Math.floor(
      ((stats.str || 0) + (stats.dex || 0) + (stats.con || 0) +
       (stats.int || 0) + (stats.wis || 0) + (stats.cha || 0)) / 6
    );
    if (level > highestLevel) {
      highestLevel = level;
      element = getBaselingElement(b);
    }
    if ((b.happy || 0) > bestHappiness) bestHappiness = b.happy || 0;
  }

  // Happiness multiplier: 1.0 base, up to 1.25 at max happiness
  let multiplier = 1.0;
  if (bestHappiness >= 90) multiplier = 1.25;
  else if (bestHappiness >= 70) multiplier = 1.15;
  else if (bestHappiness >= 50) multiplier = 1.1;
  else if (bestHappiness >= 30) multiplier = 1.05;

  // Hard mode: unlocked at baseling level 8+
  const hardMode = highestLevel >= 8;

  // Element bonuses for matching arcade themes
  const elementGames = {
    fire: ["dragon_slayer", "fire_runner", "lava_escape", "inferno"],
    water: ["deep_dive", "ocean_quest", "fishing", "pirate_ships"],
    earth: ["mining", "cave_crawler", "boulder_dash", "garden_grow"],
    air: ["sky_soar", "cloud_hop", "wind_rider", "balloon_pop"],
    shadow: ["stealth_run", "shadow_puzzle", "night_hunt", "dungeon_dark"],
    light: ["beam_breaker", "solar_flare", "light_maze", "dawn_patrol"]
  };

  return {
    multiplier: multiplier,
    hardMode: hardMode,
    elementBonus: element !== "neutral" ? {
      element: element,
      bonus: 1.15,  // 15% bonus in matching games
      games: elementGames[element] || []
    } : null,
    highestLevel: highestLevel,
    happiness: bestHappiness
  };
}

// ============================================================
// UNIFIED PROFILE
// ============================================================

function calculateCrossGameLevel(baselingData, d20Data, arcadeData) {
  let points = 0;

  if (baselingData) {
    points += baselingData.count * 5;
    points += baselingData.highestLevel * 3;
    points += baselingData.totalBattleWins;
  }
  if (d20Data) {
    points += d20Data.characterLevel * 10;
    points += d20Data.dungeonsCleared * 5;
    points += d20Data.questsCompleted * 3;
    points += d20Data.battlesWon;
  }
  if (arcadeData) {
    points += arcadeData.uniqueGames * 2;
    points += arcadeData.badgesEarned * 5;
    points += Math.floor(arcadeData.totalScore / 5000);
  }

  // Level curve: sqrt-based so early levels are fast
  return Math.max(1, Math.floor(Math.sqrt(points / 5)));
}

function calculateTitles(baselingData, d20Data, arcadeData, crossState) {
  const titles = [];

  // Baseling titles
  if (baselingData) {
    if (baselingData.count >= 10) titles.push("Baseling Breeder");
    if (baselingData.highestLevel >= 5) titles.push("Pet Trainer");
    if (baselingData.highestLevel >= 10) titles.push("Master Trainer");
    if (baselingData.totalBattleWins >= 50) titles.push("Battle Champion");
    if (baselingData.totalPoop >= 10000) titles.push("Fertilizer Baron");
  }

  // D20 titles
  if (d20Data) {
    if (d20Data.characterLevel >= 5) titles.push("Adventurer");
    if (d20Data.characterLevel >= 10) titles.push("Hero of Tasern");
    if (d20Data.characterLevel >= 15) titles.push("Legend of the Gate");
    if (d20Data.dungeonsCleared >= 5) titles.push("Dungeon Delver");
    if (d20Data.dungeonsCleared >= 20) titles.push("Underworld Conqueror");
    if (d20Data.battlesWon >= 100) titles.push("Blade Master");
    if (d20Data.questsCompleted >= 20) titles.push("Questor");
  }

  // Arcade titles
  if (arcadeData) {
    if (arcadeData.uniqueGames >= 10) titles.push("Arcade Addict");
    if (arcadeData.uniqueGames >= 50) titles.push("Arcade Master");
    if (arcadeData.uniqueGames >= 100) titles.push("Arcade Completionist");
    if (arcadeData.badgesEarned >= 10) titles.push("Badge Collector");
    if (arcadeData.totalScore >= 100000) titles.push("High Scorer");
    if (arcadeData.totalScore >= 1000000) titles.push("Million Point Club");
  }

  // Cross-game titles
  if (baselingData && d20Data) titles.push("Dual Wielder");
  if (baselingData && arcadeData) titles.push("Retro Pet Owner");
  if (d20Data && arcadeData) titles.push("Quest Gamer");
  if (baselingData && d20Data && arcadeData) titles.push("Tasern Completionist");

  if (crossState && crossState.unlocks.gamer_trait) titles.push("Gamer");

  return titles;
}

function getProfile() {
  const baselingData = readBaselingData();
  const d20Data = readD20Data();
  const arcadeData = readArcadeData();
  const crossState = loadCrossGameState();

  // Determine wallet — use first available
  const wallet = (baselingData && baselingData.wallet) ||
                 (d20Data && d20Data.wallet) ||
                 null;

  const crossGameLevel = calculateCrossGameLevel(baselingData, d20Data, arcadeData);
  const titles = calculateTitles(baselingData, d20Data, arcadeData, crossState);

  const profile = {
    wallet: wallet,
    baselings: baselingData ? {
      count: baselingData.count,
      highestLevel: baselingData.highestLevel,
      totalBattleWins: baselingData.totalBattleWins
    } : { count: 0, highestLevel: 0, totalBattleWins: 0 },
    d20: d20Data ? {
      characterLevel: d20Data.characterLevel,
      dungeonsCleared: d20Data.dungeonsCleared,
      questsCompleted: d20Data.questsCompleted
    } : { characterLevel: 0, dungeonsCleared: 0, questsCompleted: 0 },
    arcade: arcadeData ? {
      gamesPlayed: arcadeData.gamesPlayed,
      totalScore: arcadeData.totalScore,
      badgesEarned: arcadeData.badgesEarned,
      seasonTier: crossState.rewards.season_tier || 0
    } : { gamesPlayed: 0, totalScore: 0, badgesEarned: 0, seasonTier: 0 },
    crossGameLevel: crossGameLevel,
    titles: titles,
    joinDate: crossState.last_sync > 0 ? crossState.last_sync : Date.now(),
    rewards: crossState.rewards,
    unlocks: crossState.unlocks
  };

  // Cache the profile
  safeSet(PROFILE_KEY, profile);
  return profile;
}

// ============================================================
// NOTIFICATIONS
// ============================================================

let notificationQueue = [];

function notify(message, source, target) {
  const notification = {
    id: Date.now() + "_" + Math.random().toString(36).substr(2, 6),
    message: message,
    source: source,
    target: target,
    timestamp: Date.now(),
    seen: false
  };

  notificationQueue.push(notification);

  // Persist
  const stored = safeGet(NOTIFICATIONS_KEY) || [];
  stored.push(notification);
  // Keep only last 50 notifications
  if (stored.length > 50) stored.splice(0, stored.length - 50);
  safeSet(NOTIFICATIONS_KEY, stored);

  // Emit event
  emit("notification", notification);

  // Show toast if DOM is available
  showNotificationToast(notification);

  return notification;
}

function getNotifications(unreadOnly) {
  const stored = safeGet(NOTIFICATIONS_KEY) || [];
  if (unreadOnly) return stored.filter(function(n) { return !n.seen; });
  return stored;
}

function markNotificationRead(id) {
  const stored = safeGet(NOTIFICATIONS_KEY) || [];
  for (let i = 0; i < stored.length; i++) {
    if (stored[i].id === id) {
      stored[i].seen = true;
      break;
    }
  }
  safeSet(NOTIFICATIONS_KEY, stored);
}

function showNotificationToast(notification) {
  if (typeof document === "undefined") return;

  // Create toast container if it doesn't exist
  let container = document.getElementById("tasern-crossgame-toasts");
  if (!container) {
    container = document.createElement("div");
    container.id = "tasern-crossgame-toasts";
    container.style.cssText = "position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:360px;";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.style.cssText = "background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid #0f3460;border-radius:12px;padding:12px 16px;color:#e0e0e0;font-family:system-ui,-apple-system,sans-serif;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.5);pointer-events:auto;opacity:0;transform:translateX(100%);transition:all 0.3s ease;";

  const sourceColors = {
    baseling: "#4CAF50",
    d20: "#FF9800",
    arcade: "#9C27B0"
  };
  const color = sourceColors[notification.source] || "#2196F3";

  toast.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><div style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0;"></div><div><div style="font-weight:600;font-size:11px;color:' + color + ';text-transform:uppercase;margin-bottom:2px;">' + (notification.source || "Cross-Game") + ' → ' + (notification.target || "You") + '</div><div>' + notification.message + '</div></div></div>';

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(function() {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(0)";
  });

  // Auto-dismiss after 5 seconds
  setTimeout(function() {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 5000);
}

// ============================================================
// SYNC ENGINE
// ============================================================

function sync() {
  const baselingData = readBaselingData();
  const d20Data = readD20Data();
  const arcadeData = readArcadeData();
  const crossState = loadCrossGameState();

  const pendingRewards = [];

  // D20 -> Baseling rewards
  const dungeonRewards = calculateDungeonRewards(d20Data, crossState);
  for (let i = 0; i < dungeonRewards.length; i++) {
    pendingRewards.push(dungeonRewards[i]);
    if (dungeonRewards[i].type === "dungeon_treat") {
      crossState.rewards.dungeon_treats = (crossState.rewards.dungeon_treats || 0) + 1;
      notify(
        "Your D20 adventure earned a " + dungeonRewards[i].item.name + " for your baseling!",
        "d20", "baseling"
      );
    }
    if (dungeonRewards[i].type === "companion_scroll") {
      crossState.rewards.companion_scrolls.push(dungeonRewards[i].item);
      notify(
        "Quest reward: " + dungeonRewards[i].item.name + " — teaches your baseling " + dungeonRewards[i].item.move + "!",
        "d20", "baseling"
      );
    }
    if (dungeonRewards[i].type === "stat_gift") {
      crossState.rewards.d20_stat_gifts.push(dungeonRewards[i].item);
      notify(
        "Battle reward: " + dungeonRewards[i].item.name + " — gives your baseling +" + dungeonRewards[i].item.bonus + " " + dungeonRewards[i].item.stat + "!",
        "d20", "baseling"
      );
    }
  }

  // Arcade -> Baseling rewards
  const arcadeRewards = calculateArcadeRewards(arcadeData, crossState);
  for (let i = 0; i < arcadeRewards.length; i++) {
    pendingRewards.push(arcadeRewards[i]);
    if (arcadeRewards[i].type === "arcade_tokens") {
      crossState.rewards.arcade_tokens = (crossState.rewards.arcade_tokens || 0) + arcadeRewards[i].amount;
      notify(
        "Earned " + arcadeRewards[i].amount + " Arcade Tokens from high scores!",
        "arcade", "baseling"
      );
    }
    if (arcadeRewards[i].type === "trait_unlock") {
      crossState.unlocks.gamer_trait = true;
      notify(
        arcadeRewards[i].message,
        "arcade", "baseling"
      );
    }
    if (arcadeRewards[i].type === "accessory_unlock") {
      crossState.unlocks.arcade_accessories.push(arcadeRewards[i].item.id);
      notify(
        arcadeRewards[i].message,
        "arcade", "baseling"
      );
    }
  }

  // Arcade -> D20 blessings
  const blessings = calculateD20Blessings(arcadeData, crossState);
  for (let i = 0; i < blessings.length; i++) {
    pendingRewards.push(blessings[i]);
    if (blessings[i].type === "d20_blessing") {
      crossState.rewards.d20_blessings.push(blessings[i].item.id);
      notify(
        blessings[i].message,
        "arcade", "d20"
      );
    }
    if (blessings[i].type === "d20_companion") {
      crossState.rewards.d20_blessings.push("season_companion");
      notify(
        blessings[i].message,
        "arcade", "d20"
      );
    }
    if (blessings[i].type === "d20_item") {
      crossState.rewards.d20_tournament_items.push(blessings[i].item);
      crossState.rewards.d20_blessings.push("tournament_item");
      notify(
        blessings[i].message,
        "arcade", "d20"
      );
    }
  }

  // Update season tier from arcade badges
  if (arcadeData) {
    crossState.rewards.season_tier = arcadeData.badgesEarned;
  }

  // Check baseling hard mode unlock
  if (baselingData && baselingData.highestLevel >= 8 && !crossState.unlocks.hard_mode) {
    crossState.unlocks.hard_mode = true;
    notify(
      "Your baseling reached level 8! Hard Mode variants unlocked in all Arcade games!",
      "baseling", "arcade"
    );
  }

  saveCrossGameState(crossState);
  emit("sync_complete", { rewards: pendingRewards, state: crossState });

  return {
    rewards: pendingRewards,
    state: crossState,
    profile: getProfile()
  };
}

// ============================================================
// INITIALIZATION
// ============================================================

let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;

  // Initial sync on load
  try {
    sync();
  } catch (e) {
    console.warn("[CrossGame] Initial sync failed:", e.message);
  }

  // Listen for storage events from other tabs/games
  try {
    window.addEventListener("storage", function(e) {
      if (e.key === KEYS.baseling || e.key === KEYS.arcade ||
          (e.key && e.key.startsWith(KEYS.d20_prefix))) {
        // Another game updated — resync
        setTimeout(function() { sync(); }, 500);
      }
    });
  } catch (e) {
    console.warn("[CrossGame] Storage listener failed:", e.message);
  }

  // Periodic sync every 60 seconds
  setInterval(function() {
    try { sync(); }
    catch (e) { console.warn("[CrossGame] Periodic sync failed:", e.message); }
  }, 60000);

  emit("initialized", { version: VERSION });
  console.log("[TasernCrossGame] v" + VERSION + " initialized");
}

// ============================================================
// PUBLIC API
// ============================================================

return {
  VERSION: VERSION,
  init: init,
  sync: sync,
  getProfile: getProfile,
  emit: emit,
  on: on,

  // Baseling -> D20
  getBaselingCompanion: function(baselingId) {
    const data = readBaselingData();
    if (!data) return null;
    const baseling = data.baselings.find(function(b) { return b.id === baselingId; });
    if (!baseling) return null;
    return translateBaselingToD20(baseling);
  },
  getAllBaselingCompanions: function() {
    const data = readBaselingData();
    if (!data) return [];
    return data.baselings
      .filter(function(b) { return b.alive !== false; })
      .map(function(b) { return translateBaselingToD20(b); })
      .filter(function(c) { return c !== null; });
  },

  // D20 -> Baseling
  getDungeonRewards: function() {
    const d20Data = readD20Data();
    const crossState = loadCrossGameState();
    return calculateDungeonRewards(d20Data, crossState);
  },

  // Arcade -> Baseling
  getArcadeRewards: function() {
    const arcadeData = readArcadeData();
    const crossState = loadCrossGameState();
    return calculateArcadeRewards(arcadeData, crossState);
  },

  // Arcade -> D20
  getD20Blessings: function() {
    const arcadeData = readArcadeData();
    const crossState = loadCrossGameState();
    return calculateD20Blessings(arcadeData, crossState);
  },

  // Baseling -> Arcade
  getArcadeBonuses: function() {
    const data = readBaselingData();
    return calculateArcadeBonuses(data);
  },

  // Notifications
  notify: notify,
  getNotifications: getNotifications,
  markNotificationRead: markNotificationRead,

  // Raw data (for profile page)
  readBaselingData: readBaselingData,
  readD20Data: readD20Data,
  readArcadeData: readArcadeData,

  // Constants (for UI)
  ARCADE_COSMETICS: ARCADE_COSMETICS,
  COMPANION_SCROLLS: COMPANION_SCROLLS,
  STAT_GIFT_ITEMS: STAT_GIFT_ITEMS,
  ARCADE_BLESSINGS: ARCADE_BLESSINGS,
  DUNGEON_TREATS: DUNGEON_TREATS
};

})();

// Auto-initialize when DOM is ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() { TasernCrossGame.init(); });
  } else {
    TasernCrossGame.init();
  }
}
