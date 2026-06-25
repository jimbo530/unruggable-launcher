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

import { resolve, makeConfig, abilityMod as engineMod } from "../class-engine/index.js";
import { abilityMod as totMod, SPELLS } from "./tot-engine.js";
import { equipItem } from "./items.js";

const CONFIG = makeConfig();

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
  const S = view.stats;                       // raw D&D scores
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
  const stats = {
    attack:   isCaster ? Math.max(1, 1 + intMod) : Math.max(1, 4 + strMod), // melee hits harder (STR), caster weak in melee
    mAtk:     S.INT,
    def:      S.DEX,
    mDef:     S.WIS,
    hp:       view.hp,
    ac:       10 + dexMod,                 // battleStats: 10 + dexMod (unarmored v1)
    // to-hit = ability mod + a SMALL BAB. BAB is bracket-derived (not raw $), capped
    // at +3 so a high-$ unit doesn't auto-hit — keeps the 2-unit demo swingy.
    atkBonus: (isCaster ? intMod : strMod) + Math.min(3, charLevel),
    speed:    Math.max(15, 25 + dexMod * 5), // ft; /5 → hexes of move (battleStats default 30)
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
    currentHp: view.hp,
    maxHp: view.hp,
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
    baseMaxHp: view.hp,
    baseAttackRange: isCaster ? 1 : 1,
    baseMovementHexes: Math.max(2, Math.floor(stats.speed / 5)),
    baseCastingMod: intMod,
    equipped: { weapon: null, armor: null, trinket: null },
  };
}

/**
 * Two starter units, hot-seat, on one ship deck.
 *
 *   Barbarian — BURGERS endowment ($24 → STR/CON split) → STR 20 / CON 20,
 *               HP 20, AC 10. Melee bruiser; must close to swing.
 *   Wizard    — PUMP endowment ($12) + EGP splash ($4 → DEX/INT) → INT 20, DEX 12,
 *               CON 10. HP 10 glass cannon; casts real ToT spells at range.
 */
/** Read crew recruited at the Tavern (localStorage). Guarded so Node smoke tests
 *  (no localStorage) just fall back to the demo unit. */
function readRecruited() {
  if (typeof localStorage === "undefined") return [];
  try {
    const c = JSON.parse(localStorage.getItem("sts_crew") || "[]");
    return Array.isArray(c) ? c.filter((p) => p && p.endowment) : [];
  } catch (e) {
    console.warn("recruited-crew parse failed:", e);   // visible, not silent
    return [];
  }
}

/** Read the active-fighter pawn id chosen in the Crew View (localStorage). */
function readActiveId() {
  return typeof localStorage === "undefined" ? null : localStorage.getItem("sts_active");
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
  // Equip the opponent's saved loadout snapshot so you fight their actual kit.
  const lo = o.loadout || null;
  if (lo) for (const slot of ["weapon", "armor", "trinket"]) if (lo[slot]) equipItem(enemy, lo[slot]);
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
 * The crewId of the pawn that would take the field (active fighter, else first recruit),
 * or null if there's no recruited crew. game.js warms this pawn's on-chain JobClock
 * employment BEFORE building the skirmish, so the combat lock reads live chain state.
 */
export function activeFighterCrewId() {
  const recruited = readRecruited();
  if (!recruited.length) return null;
  const activeId = readActiveId();
  const p = recruited.find((x) => x.id === activeId) || recruited[0];
  return (p && p.crewId) || null;
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
 * Build the training skirmish at the port. The PLAYER unit is the first pawn you
 * recruited at the Tavern (rebuilt from its endowment via the class-engine); if you
 * haven't recruited anyone yet, you spar as a demo Barbarian. The opponent is a
 * sparring caster — the "good enough" basic fight used to TRAIN on the port narrative.
 */
export function makeStarterUnits() {
  const recruited = readRecruited();
  let player;
  if (recruited.length) {
    // The active fighter chosen in the Crew View (else the first recruit).
    const activeId = readActiveId();
    const p = recruited.find((x) => x.id === activeId) || recruited[0];

    // COMBAT LOCK: an EMPLOYED pawn is on the job and cannot sail/fight. Signal the
    // caller (game.js) to show an in-world block instead of starting the skirmish.
    const lock = employmentLockMessage(p.crewId, p.name || "Crew hand");
    if (lock) return { locked: true, message: lock, pawn: p };

    const r = pawnRole(p.endowment);
    player = buildUnit({
      id: "u_player", isPlayer: true, name: p.name || "Recruit", emoji: r.emoji,
      endowment: p.endowment, role: r.isCaster ? "caster" : "melee",
      position: { q: 1, r: 5 }, spells: r.spells, crewId: p.crewId || null,
    });
    // Pre-equip the gear loadout saved in the Crew View.
    const lo = readLoadout(p.id);
    if (lo) for (const slot of ["weapon", "armor", "trinket"]) if (lo[slot]) equipItem(player, lo[slot]);
  } else {
    // No recruit yet → spar as a demo deckhand whose paper-doll is a REAL Black Tide
    // pawn (#0, a dev play-pawn) so the training fight always shows a real crew doll.
    player = buildUnit({
      id: "u_barb", isPlayer: true, name: "Grokk", emoji: "\u{1FA93}",
      endowment: { burgers: 24 }, role: "melee", position: { q: 1, r: 5 },
      crewId: SHIP_DIST + ":0", art: ART.acornboy,
    });
  }

  // ── ENEMY: PVP opponent SNAPSHOT (open-sea, real stakes) OR harbor sparring dummy ──
  // In PVP mode the enemy is a SNAPSHOT of another player's pawn (their stats + loadout),
  // AI-piloted by the SAME enemy AI that drives the sparring caster — no real-time netcode.
  // Outside PVP mode the default harbor TRAINING flow is unchanged.
  if (isPvpMode()) {
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

  return [player, sparring];
}

export { CONFIG, SPELLS };
