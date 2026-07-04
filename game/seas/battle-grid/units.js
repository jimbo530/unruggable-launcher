// @ts-check
/**
 * units.js — THE BRIDGE: class-engine stats → Tales-of-Tasern BattleUnit shape.
 *
 * Pipeline per unit:
 *   example endowment  →  class-engine resolve()  →  raw D&D scores + HP + class
 *                      →  mapped into a ToT `BattleUnit` (tot-engine.js consumes it)
 *
 * ── THE STAT BRIDGE (the load-bearing part) ─────────────────────────────────────
 * The class-engine emits RAW D&D ability scores (STR 20 = D&D 20), HP = 10+(CON-10),
 * spell DC = 8 + INT mod. Tales-of-Tasern's combat (battleStats.ts / hexCombat.ts)
 * uses scores that are "D&D − 10" and abilityMod(s) = floor(s/2). So the bridge:
 *
 *   rawAbilities (ToT) = classEngineScore − 10        // 20 → 10, 10 → 0
 *   ToT abilityMod(rawAbilities.X) == floor((classEngineScore-10)/2)  // identical d20 mod
 *
 * Then we fill ToT's ComputedStats fields the way battleStats.ts computeStats() does
 * (just the fields hexCombat.resolveAttack / resolveSpellCast actually read):
 *   stats.attack  = STR-derived physical damage   (ToT: max(1, raw.str) → here STR mod-equivalent flat)
 *   stats.atkBonus= attack bonus (to-hit)         (we use the class-engine d20 STR/INT mod + a small BAB)
 *   stats.ac      = 10 + DEX mod                   (battleStats: 10 + dexMod (+armor); v1 unarmored)
 *   stats.mAtk    = INT (magic damage stat)
 *   maxHp/currentHp = class-engine HP
 *   castingAbilityMod = INT mod, casterLevel = totalLevel (for /level spells)
 *
 * Because the SCORES come straight from resolve(), a Barbarian (BURGERS) and a
 * Wizard (PUMP) built by the class-engine drop directly into the ToT combat math.
 *
 * ── PAPER-DOLL / NFT + COSMETIC ART NOTE ────────────────────────────────────────
 * These units will eventually BE the dynamic paper-doll crew NFTs: stats from this
 * bridge (endowment from the on-chain oracle), and ART from the crew-render service.
 * The founder fills in three art hooks (all placeholders today):
 *   1. unit token sprite  → `imageUrl` on the unit (game.js draws an emoji/disc now)
 *   2. deck background    → game.js drawDeck()  (plank pattern placeholder)
 *   3. cosmetic items     → the existing ToT cosmetic/closet item art layers onto
 *                           the paper doll (game.js leaves a `cosmetics: []` slot).
 */

import { resolve, makeConfig, abilityMod as engineMod, BASE_HP, BASE_STAT } from "../class-engine/index.js";
import { applyStarvation, starvationPenalty } from "../../lib/upkeep.js";
import { abilityMod as totMod, SPELLS as SPELLS_BASE } from "./tot-engine.js";
import { equipItem, SLOTS } from "./items.js";
import { deriveCombatStats } from "./stat-derive.js";
import { SPELL_CATALOG } from "./spells-catalog.js";
import { SEA_SPELLS } from "./bestiary-sea.js";
import { makeMonsterById, enemySpawnHexes } from "./monster-bridge.js";
import { GRID_PRESETS } from "./grid-config.js";

const CONFIG = makeConfig();

// ── MERGED SPELL REGISTRY ────────────────────────────────────────────────────────
// game.js imports SPELLS from HERE (units.js owns the registry), so merging lights up the
// whole catalog with NO game.js change and tot-engine.js stays VERBATIM. The 3 ToT spells
// (magic_missile / burning_hands / ray_of_frost) are pinned by spreading SPELLS_BASE LAST —
// the catalog reproduces them identically, so this is a strict, idempotent superset that
// GUARANTEES the originals stay byte-for-byte even if the catalog ever drifts. SEA_SPELLS
// adds the caster-monster spells (e.g. ink_spray) on top.
export const SPELLS = { ...SPELL_CATALOG, ...SEA_SPELLS, ...SPELLS_BASE };

/**
 * ART HOOKS — real Grok sprite PATHS to swap in for the emoji placeholders.
 *
 * IMPORTANT: the raw sprites at D:\grok-sprites\acorn\ are pixel-art on a MAGENTA
 * background with rounded corners and need a colorkey CUTOUT before display (method
 * in D:\grok-sprites\acorn\INVENTORY.md). That image processing is NOT done here.
 * The inventory's cutout TARGET is  site/games/art/acorn/<name>.png  — which does
 * NOT exist yet. So every hook below is `ready: false`: the renderer keeps using the
 * emoji token until a confirmed-cutout PNG is dropped in and the flag flipped.
 *
 *   Player crew  → char/acornboy-*  /  char/acorngirl-*   (idle/run/jump frames)
 *   Enemy        → enemies/*-crop.png  (beetle, mushroom, penguin, scarab, spider)
 *   Deck props   → props/*  (barrel, crate, pots, statues) — optional cover on hexes
 *   Background   → site/games/art/scenery/<theme>/bg.png  (biome bg as TEMP deck;
 *                  NO ship-deck art exists yet — founder makes the real deck art)
 *
 * To wire real art later: cut the sprite per INVENTORY.md → drop at `src` →
 * set ready:true. The renderer (game.js drawUnit) will then use `src` over emoji.
 */
export const ART = {
  // TODO(founder): cut char/acornboy-idle-raw.png → site/games/art/acorn/acornboy-idle.png, then ready:true
  acornboy: { src: "../../site/games/art/acorn/acornboy-idle.png", rawRef: "D:/grok-sprites/acorn/char/acornboy-idle-raw.png", ready: false },
  // TODO(founder): cut char/acorngirl-idle-raw.png → site/games/art/acorn/acorngirl-idle.png
  acorngirl: { src: "../../site/games/art/acorn/acorngirl-idle.png", rawRef: "D:/grok-sprites/acorn/char/acorngirl-idle-raw.png", ready: false },
  // TODO(founder): enemies/spider-crop.png looks pre-cut; verify alpha then ready:true
  enemySpider: { src: "../../site/games/art/acorn/enemy-spider.png", rawRef: "D:/grok-sprites/acorn/enemies/spider-crop.png", ready: false },
  // TEMP battle background option (biome bg already in-game; no ship-deck art yet):
  bgTemp: { src: "../../site/games/art/scenery/jungle/bg.png", ready: false },
};

// ── CONVERGENCE: a battle unit's IMAGE is its paper-doll CREW NFT ────────────────
/**
 * The crew paper-doll service (base-crew-meta) composites each crew NFT's look
 * (base acorn + tint + equipped gear + cosmetics + stickers) into a single PNG at
 *     GET <CREW_SERVICE_URL>/crew/render/<crewId>.png
 * where crewId = "<distributorAddress>:<tokenId>".
 *
 * A unit therefore = a crew NFT: STATS from the class-engine (above), IMAGE from
 * this compositor. Equipping different gear/cosmetics in the closet changes the
 * render → changes the battle token automatically (no code change here).
 *
 * PRODUCTION NOTE: in production the crewId comes from the player's OWNED crew NFTs
 * (FeeShareDistributor ERC-721 token ids the wallet holds), and CREW_SERVICE_URL is
 * the HOSTED crew service origin (not localhost). Buying/equipping GearStore1155 gear
 * updates that crew's look in the closet → the paper-doll PNG → this battle token,
 * with zero changes to the battle code. The demo below uses two example crew ids whose
 * looks were pre-equipped via the closet API (crown+cape, sunglasses+cape) so the two
 * paper-dolls visibly differ.
 */
export const CREW_SERVICE_URL =
  (typeof window !== "undefined" && window.CREW_SERVICE_URL) || "http://localhost:8791";

// The Black Tide crew NFT collection — 100 real on-chain pawns. Used so demo/sparring
// combatants render a REAL pawn paper-doll (not a placeholder distributor id).
const SHIP_DIST = "0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f";

/** Build the paper-doll render URL for a crew id, or null if no crewId is set. */
export function crewImageUrl(crewId) {
  if (!crewId) return null;
  return `${CREW_SERVICE_URL}/crew/render/${encodeURIComponent(crewId)}.png`;
}

/** class-engine raw D&D score → ToT rawAbilities value (D&D − 10, min 0). */
const toTScore = (s) => Math.max(0, s - 10);

/**
 * Map a resolved class-engine view onto a ToT BattleUnit.
 *
 * @param {object} def
 * @param {string} def.id
 * @param {boolean} def.isPlayer
 * @param {import("../class-engine/resolver.js").EndowmentMap} def.endowment
 * @param {string} def.name
 * @param {string} def.emoji            placeholder token glyph (founder swaps art)
 * @param {"melee"|"caster"} def.role
 * @param {{q:number,r:number}} def.position
 * @param {string[]} [def.spells]       SPELLS ids the caster may use
 * @param {{src:string, ready:boolean}} [def.art]  fallback sprite hook (used only if no crewId)
 * @param {string} [def.crewId]         crew NFT id "<distributor>:<tokenId>" → paper-doll image
 */
export function buildUnit(def) {
  // 1) STATS COME FROM THE CLASS ENGINE — nothing combat-relevant is hardcoded.
  const view = resolve(def.endowment, CONFIG);
  const baseScores = view.stats;              // raw D&D scores, BEFORE hunger
  // UNIVERSAL EATING (founder 2026-06-28): a STARVING pawn fights WEAKER. Fold the all-stats
  // starvation debuff (−1/all stats per unfed day, cumulative, floored at 1) into the scores HERE,
  // at the ONE place a unit's scores are resolved — so EVERY downstream combat number (to-hit, dmg,
  // AC, mAtk, def, mDef, speed, and HP below) drops together. Keyed by def.id (the crewId); a unit
  // with NO upkeep record (monsters, sparring dummies, demo pawns) has hungryDays 0 → penalty 0 →
  // scores pass through unchanged (byte-for-byte). Opt out per-build with def.noStarve (e.g. preview).
  const now = def.now || Date.now();
  const starvePen = def.noStarve ? 0 : starvationPenalty(def.id, now);   // ≤ 0
  const S = starvePen === 0 ? baseScores : applyStarvation(baseScores, def.id, now);
  const klass = view.qualified[0] || null;
  const className = klass ? klass.name : "(no class)";

  // 2) class-engine d20 mods (floor((score-10)/2)) — used for to-hit / damage / DC.
  const strMod = engineMod(S.STR);
  const dexMod = engineMod(S.DEX);
  const intMod = engineMod(S.INT);

  // CHARACTER LEVEL for combat scaling. NOT raw $ endowed (that would make a $14
  // wizard a level-24 caster and one-shot everything via /level spells). Instead we
  // derive a modest level from the weight bracket: feather 1 / light 2 / middle 3 /
  // heavy 4 / god 5. This is what drives BAB and per-level spell dice.
  const BRACKET_LEVEL = { unranked: 1, feather: 1, light: 2, middle: 3, heavy: 4, god: 5 };
  const charLevel = BRACKET_LEVEL[view.bracket.id] ?? 1;

  // 3) Build the ToT rawAbilities (D&D − 10). ToT's abilityMod(this) == engineMod(score).
  const rawAbilities = {
    str: toTScore(S.STR), dex: toTScore(S.DEX), con: toTScore(S.CON),
    int: toTScore(S.INT), wis: toTScore(S.WIS), cha: toTScore(S.CHA),
  };

  // 4) Fill the ToT ComputedStats fields that hexCombat actually reads.
  //    (battleStats.ts computes far more; we provide the combat-relevant subset and
  //     keep the SAME meaning: attack = physical dmg, atkBonus = to-hit, ac = 10+DEX.)
  const isCaster = def.role === "caster";
  // Derive the combat bridge via the SHARED formula (stat-derive.js) — the SAME function
  // items.js applyEquipment() uses — so a unit's geared numbers re-derive from its base
  // ability scores and a +2 STR ring really moves to-hit/dmg. With zero gear this yields
  // byte-for-byte the previous inline result (attack/atkBonus/ac/speed unchanged).
  const derived = deriveCombatStats({ scores: S, role: def.role, charLevel });
  // HP from the (possibly starved) CON, via the SAME formula the class-engine resolver uses
  //   HP = BASE_HP + max(0, round(CON - BASE_STAT))  (resolver.js ~L191)
  // so a starved CON drops HP exactly as the engine would, and an UNFED pawn is also frailer. With
  // no hunger S===baseScores so hp === view.hp (byte-for-byte). Floor at 1 — a pawn is never 0-HP here.
  const hp = starvePen === 0 ? view.hp : Math.max(1, BASE_HP + Math.max(0, Math.round(S.CON - BASE_STAT)));
  const stats = {
    attack:   derived.attack,              // melee hits harder (STR), caster weak in melee
    mAtk:     derived.mAtk,
    def:      derived.def,
    mDef:     derived.mDef,
    hp,
    ac:       derived.ac,                  // battleStats: 10 + dexMod (unarmored v1)
    atkBonus: derived.atkBonus,            // ability mod + small bracket BAB (capped +3)
    speed:    derived.speed,               // ft; /5 → hexes of move
    // fields hexCombat reads but we don't use in v1 (kept zero/empty so ports run clean):
    lightningDmg: 0, fireDmg: 0, lightningDice: null, fireDice: null, retaliationDice: null,
    resistances: [], immunities: [], retaliationDmg: 0,
  };

  return {
    id: def.id,
    name: def.name,
    className,
    imageEmoji: def.emoji,
    // ── UNIT IMAGE = PAPER-DOLL CREW NFT (the convergence) ──
    // crewId identifies this unit's crew NFT; its composited paper-doll PNG (base +
    // gear + cosmetics) is the battle token. The renderer (game.js drawUnit) loads
    // `imageUrl` as an <image>, and ALWAYS keeps the emoji as an onerror FALLBACK so a
    // token is never blank if the crew service is down.
    crewId: def.crewId || null,
    imageUrl: def.crewId
      ? crewImageUrl(def.crewId)                         // paper-doll crew render (preferred)
      : (def.art && def.art.ready ? def.art.src : undefined), // else a ready Grok sprite, else emoji
    cosmetics: [],                         // ART HOOK: ToT cosmetic/closet item layers
    isPlayer: def.isPlayer,
    role: def.role,

    // engine-sourced display data (for the stat panel + log transparency)
    endowment: def.endowment,
    engineStats: S,
    bracket: view.bracket.label,
    totalLevel: view.totalLevel,
    qualified: view.qualified,
    spellDC: 8 + intMod,                   // class-engine save DC (display)

    // ── ToT BattleUnit shape (consumed by tot-engine.js) ──
    position: { ...def.position },
    stats,
    rawAbilities,
    subtypes: [],
    currentHp: hp,
    maxHp: hp,
    hasMoved: false,
    hasActed: false,
    activeEffects: [],
    attackRange: isCaster ? 1 : 1,         // both melee-attack at range 1; caster prefers spells
    isRanged: false,
    // spell fields (ToT resolveSpellCast reads these)
    casterLevel: charLevel,                // bracket-derived level (drives /level spell dice)
    castingAbilityMod: intMod,
    availableSpells: def.spells || [],
    movementHexes: Math.max(2, Math.floor(stats.speed / 5)), // ft→hexes (5ft per hex)

    // ── EQUIP SYSTEM: base (unequipped) values. items.js applyEquipment() layers
    //    equipped gear onto these to produce the live combat fields above, so
    //    equipping/removing is non-destructive (always recomputed from base).
    baseStats: { ...stats },
    baseMaxHp: hp,
    baseAttackRange: isCaster ? 1 : 1,
    baseMovementHexes: Math.max(2, Math.floor(stats.speed / 5)),
    baseCastingMod: intMod,
    // RAW D&D scores → items.js applyEquipment() re-derives the bridge from these so
    // ability-score gear (Gauntlets of Ogre Power, etc.) raises to-hit/dmg/HP + carry.
    baseAbilities: { STR: S.STR, DEX: S.DEX, CON: S.CON, INT: S.INT, WIS: S.WIS, CHA: S.CHA },
    // 7-slot paper doll — seed EVERY slot so the equip UI renders each row + applyEquipment is total.
    equipped: { weapon: null, offhand: null, armor: null, helm: null, boots: null, ring: null, trinket: null },
  };
}

/**
 * DEMO FALLBACK (no party / no localStorage): a hot-seat pair on one ship deck —
 *   Barbarian — BURGERS endowment ($24 → STR/CON split) → STR 20 / CON 20,
 *               HP 20, AC 10. Melee bruiser; must close to swing.
 *   Wizard    — PUMP endowment ($12) + EGP splash ($4 → DEX/INT) → INT 20, DEX 12,
 *               CON 10. HP 10 glass cannon; casts real ToT spells at range.
 * The PRIMARY path is the walking party below; this pair only spars when no party exists.
 */
// ── WALKING PARTY (sts_party) — the source of who takes the field ───────────────
// The Decks battle is built from the player's WALKING PARTY: the crewIds chosen in the
// Crew View (sts_party, ≤4) with one designated LEADER (sts_party_leader). Each crewId
// resolves to a unit the SAME way for OWNED (chain) and HIRED (rented house) pawns —
// combat never cares about ownership, only the party list. (Ownership is enforced in the
// Crew View, the only place a crewId is allowed into the party.) All reads are guarded so
// the Node smoke tests — no localStorage — fall back to the demo skirmish.
const PARTY_MAX = 4;

// Distinct LEFT-side spawn hexes (player team) on the 9×7 deck (GRID q0-8 × r0-6). Leader
// first → leader acts first (turn order == array order). All distinct + clear of the
// sparring hex {q:7,r:1}. Leader hex {q:1,r:5} matches the single-player/demo position.
const PLAYER_HEXES = [ { q: 1, r: 5 }, { q: 0, r: 4 }, { q: 1, r: 3 }, { q: 0, r: 2 } ];

// Crew distributors → species/token (mirror of the Crew View). crewId = "<dist>:<tokenId>".
// Species is display flavor; combat stats come from the class-engine endowment below.
const CREW_SPECIES = {
  "0x2e2ab7ae48876f1b4497a04d864c025f7df58e1f": { species: "Orc",    token: "BLACKTIDE" },
  "0x9500880dec9b310b4a728c75a271a25615a2443e": { species: "Elf",    token: "SOLM" },
  "0x4ece491951b759363bcbaf75389a202fe0584080": { species: "Goblin", token: "REDRUM" },
  "0x8c1f935f6dbb17d593bf3ec8114a2f045e350545": { species: "Human",  token: "GUARD" },
};
// Default endowment until on-chain crew metadata is wired (matches the Crew View's
// ownedToPawn/rentedToPawn). The class-engine needs an endowment to resolve stats.
const DEFAULT_ENDOWMENT = { burgers: 10 };

/** Read the walking party (sts_party = list of crewIds). Guarded so Node smoke tests
 *  (no localStorage) fall back to the demo unit. */
function readParty() {
  if (typeof localStorage === "undefined") return [];
  try {
    const p = JSON.parse(localStorage.getItem("sts_party") || "[]");
    return Array.isArray(p) ? p.filter((id) => typeof id === "string" && id.includes(":")) : [];
  } catch (e) {
    console.warn("party parse failed:", e);            // visible, not silent
    return [];
  }
}

/** Read the designated party leader crewId (sts_party_leader). */
function readPartyLeader() {
  return typeof localStorage === "undefined" ? null : localStorage.getItem("sts_party_leader");
}

/** Read the off-chain display-name layer (sts_names), keyed by crewId (NOT ownership). */
function readNames() {
  if (typeof localStorage === "undefined") return {};
  try { return JSON.parse(localStorage.getItem("sts_names") || "{}"); }
  catch (e) { console.warn("names parse failed:", e); return {}; }   // visible, not silent
}

/** Read the HIRED list (sts_rented) as a Set of crewIds. A hired (house-owned) hero is
 *  NOT the player's employee, so the town-job employment lock never applies to it. */
function readRentedSet() {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const r = JSON.parse(localStorage.getItem("sts_rented") || "[]");
    return new Set(Array.isArray(r) ? r.map((x) => x && x.crewId).filter(Boolean) : []);
  } catch (e) { console.warn("rented parse failed:", e); return new Set(); } // visible, not silent
}

/** Resolve one party crewId → a pawn def for buildUnit. Species from the distributor,
 *  display name from the off-chain name layer (else "<Species> #<tokenId>"), endowment
 *  the wired default. Identical for owned + hired crewIds. */
function partyPawnDef(crewId) {
  const [dist, tokenId] = String(crewId).split(":");
  const meta = CREW_SPECIES[(dist || "").toLowerCase()] || null;
  const species = meta ? meta.species : "Crew";
  const names = readNames();
  const name = names[crewId] || (species + " #" + (tokenId ?? "?"));
  return { crewId, endowment: DEFAULT_ENDOWMENT, name, species };
}

/** Build one walking-party member into a real battle unit (class-engine stats + paper-doll
 *  render + the gear loadout saved in the Crew View). Same path for owned + hired — combat
 *  is ownership-blind. Loadout applies across ALL 7 gear slots (canonical SLOTS). */
function buildPartyMember(crewId, position) {
  const def = partyPawnDef(crewId);
  const r = pawnRole(def.endowment);
  const unit = buildUnit({
    id: crewId, isPlayer: true, name: def.name, emoji: r.emoji, endowment: def.endowment,
    role: r.isCaster ? "caster" : "melee", position, spells: r.spells, crewId,
  });
  const lo = readLoadout(crewId);   // loadout is keyed by crewId in the Crew View
  if (lo) for (const slot of SLOTS) if (lo[slot]) equipItem(unit, lo[slot]);
  return unit;
}

// ── ASYNC PVP (crew-vs-crew) ─────────────────────────────────────────────────
/**
 * PVP MODE is OFF by default — the harbor TRAINING flow (player vs sparring caster)
 * is unchanged unless PVP is explicitly turned on. PVP is on when EITHER:
 *   • the URL carries  ?mode=pvp   (set by the PVP setup page link), OR
 *   • localStorage flag  sts_pvp_mode === "1"  (no-URL fallback / persisted toggle).
 * When on, makeStarterUnits() builds the ENEMY from a stored OPPONENT SNAPSHOT
 * (their stats + equipped loadout, AI-piloted) instead of the hardcoded sparring caster.
 */
/**
 * BATTLE MODE — which framing the deck runs under:
 *   "encounter" → a VOYAGE PVE encounter (raiders on a sail route). URL ?mode=encounter,
 *                 armed by the voyage bridge (encounter.js) off location.js setSail().
 *   "pvp"       → async open-sea PVP duel (URL ?mode=pvp, or sts_pvp_mode flag fallback).
 *   "training"  → default harbor sparring (unchanged).
 * encounter and pvp BOTH build the enemy from the same `sts_pvp_opponent` snapshot, so the
 * voyage bridge reuses the entire PVP enemy-build path — only the framing/return differ.
 */
export function battleMode() {
  let urlMode = null;
  if (typeof window !== "undefined" && window.location && window.location.search) {
    try { urlMode = new URLSearchParams(window.location.search).get("mode"); }
    catch (e) { console.warn("battle mode url parse failed:", e); }   // visible, not silent
  }
  if (urlMode === "encounter") return "encounter";
  if (urlMode === "pvp") return "pvp";
  if (typeof localStorage !== "undefined" && localStorage.getItem("sts_pvp_mode") === "1") return "pvp";
  return "training";
}

/** Open-sea (real-stakes) mode = PVP duel OR a voyage PVE encounter. Both share the
 *  enemy-from-snapshot path in makeStarterUnits; battleMode() splits the framing. */
export function isPvpMode() {
  return battleMode() !== "training";
}

/**
 * The chosen opponent SNAPSHOT (their pawn build), written by the PVP setup page to
 * localStorage `sts_pvp_opponent`. Shape mirrors a recruited crew pawn so the same
 * class-engine bridge applies:
 *   { id, name, endowment, crewId?, loadout?: { weapon, armor, trinket } }
 * Returns null if none is chosen (or storage is unavailable / malformed).
 */
function readPvpOpponent() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("sts_pvp_opponent");
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && o.endowment ? o : null;   // must carry an endowment to build stats
  } catch (e) {
    console.warn("pvp opponent parse failed:", e);   // visible, not silent
    return null;
  }
}

/** Build the AI-piloted ENEMY unit from an opponent snapshot (a SNAPSHOT of another
 *  player's pawn: their stats + equipped loadout). Role/spells inferred the same way
 *  the player pawn is, so an opponent caster casts and a bruiser swings. */
function buildOpponentUnit(o) {
  const r = pawnRole(o.endowment);
  const enemy = buildUnit({
    id: "u_pvp", isPlayer: false, name: o.name || "Rival Captain", emoji: r.emoji,
    endowment: o.endowment, role: r.isCaster ? "caster" : "melee",
    position: { q: 7, r: 1 }, spells: r.spells,
    crewId: o.crewId || (SHIP_DIST + ":1"),   // paper-doll; default to a real Black Tide pawn
  });
  // Equip the opponent's saved loadout snapshot so you fight their actual kit (all 7 slots).
  const lo = o.loadout || null;
  if (lo) for (const slot of SLOTS) if (lo[slot]) equipItem(enemy, lo[slot]);
  return enemy;
}

/** Read a pawn's saved gear loadout (set in the Crew View) → { weapon, armor, trinket }. */
function readLoadout(pawnId) {
  if (typeof localStorage === "undefined") return null;
  try {
    const all = JSON.parse(localStorage.getItem("sts_loadout") || "{}");
    return all[pawnId] || null;
  } catch (e) {
    console.warn("loadout parse failed:", e);
    return null;
  }
}

/** Read the shared employment store (employment.js → window.Employment). A pawn that is
 *  EMPLOYED at a town job is "on the job" and LOCKED from sailing/fighting until clocked
 *  out. Guarded so Node smoke tests (no window) treat every pawn as free. */
function employmentFor(crewId) {
  if (typeof window === "undefined" || !window.Employment || !crewId) return null;
  try { return window.Employment.get(crewId); }
  catch (e) { console.warn("employment read failed:", e); return null; } // visible, not silent
}

/** Friendly job name for a job key (mirrors the jobs page), for the lock message. */
const JOB_NAMES = {
  str: "hauling cargo on the docks", dex: "mending nets at the sheds",
  con: "stocking rations in the storehouse", int: "tending the lighthouse beacon",
  wis: "keeping the shell shrine", cha: "haggling in the market square",
};
export function employmentLockMessage(crewId, pawnLabel) {
  const rec = employmentFor(crewId);
  if (!rec) return null;
  // rec.job is a friendly job key ('str'..'cha') for the 6 town trades; fall back to a
  // generic phrase rather than leaking a raw vault address into player-facing text.
  const doing = JOB_NAMES[rec.job] || "working a town trade";
  return (pawnLabel || "That crew hand") + " is on the job — " + doing +
    ". Clock them out at Town Work to take them to sea or into a fight.";
}

/**
 * The crewId of the pawn that leads the fight = the WALKING PARTY's LEADER
 * (sts_party_leader, else the first party member), or null if there's no party.
 * game.js warms THIS pawn's on-chain employment (union of WorkClock V2 + legacy JobClock)
 * BEFORE building the skirmish, so the combat lock (checked on the leader in
 * buildPlayerUnit/makeStarterUnits) reads live chain state.
 */
export function activeFighterCrewId() {
  const party = readParty();
  if (!party.length) return null;
  const leader = readPartyLeader();
  return (leader && party.includes(leader)) ? leader : party[0];
}

/** Infer combat role from a pawn's resolved stats: INT-leaning → caster, else melee. */
export function pawnRole(endowment) {
  const S = resolve(endowment, CONFIG).stats;
  const isCaster = S.INT > S.STR && S.INT >= 14;
  return {
    isCaster,
    emoji: isCaster ? "\u{1F9D9}" : "\u{1FA93}",        // 🧙 / 🪓
    spells: isCaster ? ["magic_missile", "ray_of_frost"] : [],
  };
}

/**
 * Build the single PLAYER unit = the WALKING PARTY's LEADER (sts_party_leader, else first
 * party member), rebuilt via the class-engine + its saved gear loadout, else the demo
 * Barbarian when there's no party. Factored out so makeSquadBattle() (and the PVP/encounter
 * paths) reuse the EXACT same player-build path. Returns { unit } on success, or
 * { locked, message, pawn } when an OWNED leader is employed (on the job) and can't fight.
 */
function buildPlayerUnit() {
  const party = readParty();
  if (party.length) {
    // The field leader chosen in the Crew View (else the first party member).
    let leader = readPartyLeader();
    if (!leader || !party.includes(leader)) leader = party[0];

    // COMBAT LOCK: an EMPLOYED leader is on the job and cannot sail/fight. A HIRED
    // (house-owned) leader is never the player's employee, so the lock never applies to it.
    if (!readRentedSet().has(leader)) {
      const lp = partyPawnDef(leader);
      const lock = employmentLockMessage(leader, lp.name);
      if (lock) return { locked: true, message: lock, pawn: { crewId: leader, name: lp.name } };
    }

    // buildPartyMember carries the leader's class-engine stats + saved gear loadout.
    return { unit: buildPartyMember(leader, { q: 1, r: 5 }) };
  }
  // No party yet → spar as a demo deckhand whose paper-doll is a REAL Black Tide
  // pawn (#0, a dev play-pawn) so the training fight always shows a real crew doll.
  const player = buildUnit({
    id: "u_barb", isPlayer: true, name: "Grokk", emoji: "\u{1FA93}",
    endowment: { burgers: 24 }, role: "melee", position: { q: 1, r: 5 },
    crewId: SHIP_DIST + ":0", art: ART.acornboy,
  });
  return { unit: player };
}

/** Read an armed VOYAGE GROUP (multi-enemy) blob — a rollEncounter()-style object with a
 *  non-empty `group` array (encounter.js armVoyageEncounterGroup() writes it). Node-safe. */
function readEncounterGroup() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("sts_encounter_group");
    if (!raw) return null;
    const g = JSON.parse(raw);
    return g && Array.isArray(g.group) && g.group.length ? g : null;
  } catch (e) {
    console.warn("encounter group parse failed:", e);   // visible, not silent
    return null;
  }
}

/** Normalize a group spec into foe refs. Accepts bestiary-key strings (["bilge_rat", …]) OR
 *  the foe-snapshot objects area-encounters.js emits ({ build, monsterId, bestiary, … }). */
function normalizeRefs(arr) {
  return (arr || []).map((r) => (typeof r === "string" ? { monsterId: r, build: "monster" } : r));
}

/** Build an AI RAIDER (rival crew) from an encounter raider ref (endowment + loadout), placed
 *  at `pos`. Mirrors buildOpponentUnit() but takes a board position + name from the group. */
function buildRaiderUnit(ref, pos) {
  const r = pawnRole(ref.endowment || {});
  const role = ref.role ? (ref.role === "caster" ? "caster" : "melee") : (r.isCaster ? "caster" : "melee");
  const u = buildUnit({
    id: ref.id || "u_raider", isPlayer: false, name: ref.name || "Raider", emoji: r.emoji,
    endowment: ref.endowment || {}, role,
    position: { q: pos.q, r: pos.r }, spells: ref.spells || r.spells, crewId: ref.crewId || (SHIP_DIST + ":1"),
  });
  const lo = ref.loadout || null;
  if (lo) for (const slot of SLOTS) if (lo[slot]) equipItem(u, lo[slot]);
  if (ref.lead || ref.boss) u.lead = true;
  return u;
}

/**
 * Build a MULTI-ENEMY (N-vs-N) squad battle. The player builds via the SAME buildPlayerUnit()
 * path; the enemy side is a whole GROUP — monsters (direct-stat, via monster-bridge → the
 * bestiaries) and/or raiders (endowment+loadout) — each placed on a DISTINCT enemy hex. Returns
 * the SAME `{ pvp:true, mode, units }` control shape game.js init() already understands (so
 * init/checkWin/endTurn need ZERO change — a group is just a longer units[]). +objective/mapId
 * are extra fields game.js can read for framing; unknown to it = ignored.
 *
 * @param {object[]|{group:object[]}} group  foe refs (strings or snapshots) or a rollEncounter() result
 * @param {{ mode?:string, objective?:any, mapId?:any, player?:object }} [opts]
 */
export function makeSquadBattle(group, opts = {}) {
  let player = opts.player;
  if (!player) {
    const pb = buildPlayerUnit();
    if (pb.locked) return { locked: true, message: pb.message, pawn: pb.pawn };
    player = pb.unit;
  }
  const refs = normalizeRefs(Array.isArray(group) ? group : (group && group.group) || []);
  if (!refs.length) throw new Error("makeSquadBattle: no enemy templates/refs provided."); // loud, never silent
  const taken = new Set([`${player.position.q},${player.position.r}`]);
  // P5/P4 SPAWN WIDTH: a multi-pawn group (player + ≥2 foes) fights on the wider SQUAD deck (16×9)
  // that game.js auto-selects when units.length>2 — so spawn the foes across THAT board, spreading
  // them to the full width / water-edge instead of packing the engine's 9×7 right columns. A lone
  // foe (1v1) stays on the verbatim duel board. Condition mirrors game.js init() exactly.
  const wide = (refs.length + 1) > 2;
  const hexes = enemySpawnHexes(refs.length, taken, wide ? GRID_PRESETS.squad : GRID_PRESETS.duel);
  const enemies = refs.map((ref, i) => {
    const pos = hexes[i];
    if ((ref.build || "monster") === "raider") return buildRaiderUnit(ref, pos);
    return makeMonsterById(ref.monsterId || ref.id, pos, {
      bestiary: ref.bestiary, name: ref.name, id: ref.id, idx: i, groupN: refs.length,
      telegraph: ref.telegraph, severable: ref.severable, lead: ref.lead, boss: ref.boss, hpBonus: ref.hpBonus,
    });
  });
  return {
    pvp: true, mode: opts.mode || "encounter", units: [player, ...enemies],
    objective: opts.objective || (group && group.objective) || null,
    mapId: opts.mapId || (group && group.map) || null,
    groupName: (group && group.groupName) || null,
  };
}

/**
 * Build the skirmish at the port.
 *
 * • PVP / VOYAGE-ENCOUNTER (open sea, real stakes): the player is the party LEADER
 *   (buildPlayerUnit) and the enemy is a SNAPSHOT of another player's pawn or an armed
 *   voyage group — these paths are PRESERVED VERBATIM from the engine.
 * • TRAINING (default harbor sparring): the player TEAM is the whole WALKING PARTY
 *   (sts_party, ≤4, owned or hired), the LEADER first, vs a single sparring caster. The
 *   hex grid + win check are N-vs-N safe (side-count, not unit-count), so a 1- or
 *   4-member party both work. If there's NO party yet, fall back gracefully to a demo
 *   Barbarian vs the sparring caster — no crash, just spar solo until you build a party
 *   in the Crew View.
 */
export function makeStarterUnits() {
  const pb = buildPlayerUnit();
  if (pb.locked) return { locked: true, message: pb.message, pawn: pb.pawn };
  const player = pb.unit;

  // ── ENEMY: PVP opponent SNAPSHOT (open-sea, real stakes) OR harbor sparring dummy ──
  // In PVP mode the enemy is a SNAPSHOT of another player's pawn (their stats + loadout),
  // AI-piloted by the SAME enemy AI that drives the sparring caster — no real-time netcode.
  // Outside PVP mode the default harbor TRAINING flow is unchanged.
  if (isPvpMode()) {
    // VOYAGE GROUP (multi-enemy) takes priority when a group blob is armed — ADDITIVE: the
    // single-enemy snapshot path below is untouched and is still the fallback.
    const grp = readEncounterGroup();
    if (grp) return makeSquadBattle(grp, { mode: battleMode(), objective: grp.objective || null, mapId: grp.map || null, player });

    const opp = readPvpOpponent();
    if (opp) {
      // pvp:true tells game.js to set state.stakes=true + state.arena="water" (open sea).
      // mode lets game.js frame it as a voyage "encounter" (raiders) vs a "pvp" duel.
      return { pvp: true, mode: battleMode(), units: [player, buildOpponentUnit(opp)] };
    }
    // PVP/encounter requested but no opponent snapshot stored → tell the caller to set up.
    return { pvpNoOpponent: true, mode: battleMode() };
  }

  // The sparring opponent is a REAL Black Tide pawn paper-doll (#1, a dev play-pawn) —
  // no stakes, purely a practice dummy to test how your leveled hand fights.
  const sparring = buildUnit({
    id: "u_spar", isPlayer: false, name: "Sparring Partner", emoji: "\u{1F9D9}",
    endowment: { pump: 12, egp: 4 }, role: "caster",
    spells: ["magic_missile", "burning_hands", "ray_of_frost"],
    position: { q: 7, r: 1 }, crewId: SHIP_DIST + ":1", art: ART.enemySpider,
  });

  // ── TRAINING: the WHOLE walking party (leader first) takes the field vs the sparring caster ──
  // The leader's employment lock was already enforced in buildPlayerUnit() above, so a locked
  // leader returned early. Build each party member onto a distinct left-side hex, leader first.
  const party = readParty().slice(0, PARTY_MAX);
  if (party.length) {
    let leader = readPartyLeader();
    if (!leader || !party.includes(leader)) leader = party[0];
    const ordered = [leader, ...party.filter((id) => id !== leader)];
    const players = ordered.map((crewId, i) =>
      buildPartyMember(crewId, PLAYER_HEXES[Math.min(i, PLAYER_HEXES.length - 1)]));
    return [...players, sparring];
  }

  // No party → the demo Barbarian (built by buildPlayerUnit) spars solo.
  return [player, sparring];
}

export { CONFIG };
