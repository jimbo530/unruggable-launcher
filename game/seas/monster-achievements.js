// @ts-check
'use strict';
/**
 * monster-achievements.js — the PER-MONSTER KILL-ACHIEVEMENT LADDER for "Seize the Seas".
 * Founder (2026-07-01): "achievements for killing a certain number of each monster.
 *   Kill 100 rats = Exterminator = bronze; 1000 rats = Master Exterminator = silver prize;
 *   no gold for rats — but do that for a lot of monsters and keep a bestiary/achievement tracker."
 *
 * WHAT THIS IS (data + a pure derivation — NO ethers, NO I/O, NO RNG)
 *   For EVERY monster in the two bestiaries (bestiary-sea.js + bestiary-dungeon.js — the 208-strong
 *   roster) this file derives a kill-count LADDER of 1-3 rungs:
 *       { count, title, tier, prizeToken }
 *   where `tier` is BRONZE | SILVER | GOLD and `prizeToken` maps to the EXISTING coin ladder
 *   (bronze→COPPER, silver→SILVER, gold→GOLD — the same coins the roll-chart/loot rails already pay).
 *   Plus a GEM META ladder (a tier ABOVE gold) that rewards COLLECTING achievements (see below).
 *
 * WHY IMPORT THE BESTIARIES INSTEAD OF HARD-CODING 208 ROWS
 *   The bestiaries are the single source of truth for the roster + every stat block, and are owned
 *   by another agent (read-only for us). Duplicating 208 rows here would rot the moment a stat block
 *   changes. Instead we ENUMERATE the roster from the bestiaries at module-load and DERIVE each
 *   ladder from the creature's own CR + type via a clear formula, then OVERLAY hand-named iconic
 *   titles (Exterminator, Wolfsbane, Goblin-Slayer, Dragonsbane, …). One formula, 208 ladders, and
 *   it tracks the bestiary automatically. rat's ladder is PINNED verbatim to the founder's spec.
 *
 * ─ THE FORMULA (skill/grind → compliant; the reward is EARNED by kill count, never chance) ─
 *   A monster's WORTH is its CR. Weak vermin you slaughter by the hundred; a troll you kill a handful.
 *   So THRESHOLDS scale DOWN with CR and the CAP TIER scales UP with CR:
 *
 *     capTier(cr): cr < 1        → SILVER   (common/weak vermin: bronze + silver, NO gold)
 *                  1 <= cr < 4   → SILVER   (rank-and-file foes: bronze + silver, NO gold)
 *                  4 <= cr < 8   → GOLD     (tough/rare foes: reach gold)
 *                  cr >= 8       → GOLD     (bosses/dragons: reach gold at LOW counts)
 *     (a `special`-overridable per-monster cap lets a signature nemesis reach gold sooner.)
 *
 *     thresholds(cr): a base count that FALLS as CR rises (kill far fewer of the big ones):
 *                  bronze = clamp( round( 120 / (1 + cr) ), 3, 100 )
 *                  silver = bronze * 10   (a full order of magnitude more — the grind rung)
 *                  gold   = bronze * (cr >= 8 ? 5 : 30)   (bosses: gold at a *low* multiple)
 *       → rat (cr .33): bronze 90→PINNED 100, silver 1000, no gold.   (matches the founder verbatim)
 *       → troll (cr 5): bronze ~20, silver ~200, GOLD ~600.
 *       → dragon (cr 10): bronze ~11, silver ~110, GOLD ~55  (you kill so few, gold comes fast).
 *   Counts are rounded to friendly numbers (see niceCount). Titles: iconic monsters get a hand
 *   name from TITLE_OVERRIDES; everything else gets a readable generated "Slayer/Bane/Scourge" title.
 *
 * ─ GEM META LADDER (founder 2026-07-01: "gem level achievements for getting so many achievements") ─
 *   A tier ABOVE gold that rewards COLLECTING achievements. Earn N TOTAL achievements (ALL of them —
 *   every per-monster rung + any others) → a GEM milestone with a hunter-flavored title. Prize tier =
 *   GEM, paid in the project's 5 deployed GEM trade-goods (verified from commodity-tokens.csv). See
 *   META_LADDER + getMetaTiers().
 *
 * EXPORTS
 *   TIERS                              → { BRONZE, SILVER, GOLD, GEM } tier meta (label + coin/gem token)
 *   COIN_TOKENS / GEM_TOKENS           → verified Base addresses (NOT hand-typed — see provenance)
 *   getKillTiers(monsterId)            → the derived ladder [{ count, title, tier, prizeToken, achId }]
 *   KILL_LADDERS                       → the full { [monsterId]: ladder } table (all 208)
 *   META_LADDER / getMetaTiers()       → the GEM meta ladder (collect-N-achievements)
 *   achId(monsterId, tier)             → the STABLE string achievement id used by the tracker + keeper
 *   allMonsterIds()                    → every monster id the ladder covers (union of both bestiaries)
 *
 * node --check clean. ESM. Imports the two bestiaries (read-only) + nothing else.
 */

import { SEA_BESTIARY } from './battle-grid/bestiary-sea.js';
import { DUNGEON_BESTIARY } from './battle-grid/bestiary-dungeon.js';

// ── VERIFIED TOKEN ADDRESSES (Base) — provenance, never hand-typed ───────────────────────────
// Coins: game/seas/water-tokens.csv (COPPER/SILVER/GOLD rows) + deploy/coins-deployed.json + memory.
// Gems : game/seas/commodity-tokens.csv rows tagged `gem` (5 deployed gem trade-goods).
export const COIN_TOKENS = {
  COPPER: '0x0197896c617f20d61E73E06eC8b2A95eef176bee',
  SILVER: '0x36cF0ceDEee07b14C496f77C61d010268c31E0e9',
  GOLD:   '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004',
};
export const GEM_TOKENS = {
  AMETHYST: '0xC5a9BC41936EF545DE210727FedCf8a43aEFa95F',
  DIAMOND:  '0x567c3EA4E2eB7fb0C55523162a248a5A25fD5Bb0',
  EMERALD:  '0x3220D7b78F0b3839248E624ed3c7c2c215389063',
  PLATINUM: '0x6722ef27d1854E73269b0abE42290C000D3EfddA',
  RUBY:     '0xE78023faFb55e61dC4d28D13F623e32fE9a3Fe6A',
};

// Tier meta. `rank` orders the tiers (bronze<silver<gold<gem) for the chime/UI escalation.
export const TIERS = {
  BRONZE: { key: 'bronze', rank: 1, label: 'Bronze', prizeToken: COIN_TOKENS.COPPER, coin: 'COPPER' },
  SILVER: { key: 'silver', rank: 2, label: 'Silver', prizeToken: COIN_TOKENS.SILVER, coin: 'SILVER' },
  GOLD:   { key: 'gold',   rank: 3, label: 'Gold',   prizeToken: COIN_TOKENS.GOLD,   coin: 'GOLD' },
  GEM:    { key: 'gem',    rank: 4, label: 'Gem',    prizeToken: null, coin: 'GEM' }, // gem token is per-milestone
};

// ── roster helpers ───────────────────────────────────────────────────────────────────────────
// Normalize BOTH bestiaries into one { id → { id, name, cr, role, subtypes[], hp, ac } } map. The
// dungeon bestiary is keyed by snake_case id; the sea bestiary is keyed by Title-Case display name,
// so we slugify its keys to a stable snake_case id (the same style the rest of the game uses).
const slug = (s) => String(s).trim().toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Read a CR from a (possibly loosely-typed) stat block. Defaults to 1 (never throws). */
function crOf(def) { const n = Number(def && def.cr); return Number.isFinite(n) && n > 0 ? n : 1; }

function buildRoster() {
  const roster = {};
  for (const [id, def] of Object.entries(DUNGEON_BESTIARY)) {
    roster[id] = { id, name: def.name || id, cr: crOf(def), role: def.role || 'melee',
      subtypes: Array.isArray(def.subtypes) ? def.subtypes : [], boss: !!def.boss };
  }
  for (const [key, tpl] of Object.entries(SEA_BESTIARY)) {
    const id = slug(key);
    if (roster[id]) continue; // a dungeon entry already owns this id — don't clobber it
    roster[id] = { id, name: tpl.name || key, cr: crOf(tpl), role: tpl.role || 'melee',
      subtypes: Array.isArray(tpl.subtypes) ? tpl.subtypes : [], boss: false };
  }
  return roster;
}
const ROSTER = buildRoster();

// ── cap tier (which is the HIGHEST tier a monster's ladder reaches) ────────────────────────────
// Worth scales with CR. Vermin cap at SILVER (grind hundreds; no gold). Tough/rare foes reach GOLD.
function capRankFor(cr) {
  if (cr < 4) return 2;      // BRONZE + SILVER only (rat, kobold, goblin, wolf, …) — no gold
  return 3;                  // BRONZE + SILVER + GOLD (ogre, troll, wyrmling, wight, dragons, …)
}

// ── friendly count rounding (100 / 250 / 1000, never 137) ──────────────────────────────────────
function niceCount(n) {
  if (n <= 5) return Math.max(1, Math.round(n));
  if (n <= 12) return Math.round(n);                    // 6..12 kept as-is (low boss counts)
  if (n <= 30) return Math.round(n / 5) * 5;            // nearest 5
  if (n <= 120) return Math.round(n / 10) * 10;         // nearest 10
  if (n <= 600) return Math.round(n / 25) * 25;         // nearest 25
  return Math.round(n / 100) * 100;                     // nearest 100
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ── the threshold formula (counts FALL as CR rises) ────────────────────────────────────────────
function thresholdsFor(cr) {
  const bronze = niceCount(clamp(Math.round(120 / (1 + cr)), 3, 100));
  const silver = niceCount(bronze * 10);
  const gold   = niceCount(bronze * (cr >= 8 ? 5 : 30)); // bosses: gold at a LOW multiple of bronze
  return { bronze, silver, gold };
}

// ── iconic hand-named titles (bronze/silver/gold) for the memorable nemeses ─────────────────────
// keyed by monster id → { bronze, silver, gold? }. Anything not here gets a generated title.
// rat is PINNED to the founder's verbatim spec (Exterminator / Master Exterminator, NO gold).
const TITLE_OVERRIDES = {
  rat:            { bronze: 'Exterminator',        silver: 'Master Exterminator' },              // founder verbatim
  dire_rat:       { bronze: 'Ratcatcher',          silver: 'Rat-Scourge' },
  rat_swarm:      { bronze: 'Swarm-Breaker',       silver: 'Tide-Turner' },
  bilge_rat:      { bronze: 'Bilge-Cleaner',       silver: 'Scourge of the Bilge' },
  bat:            { bronze: 'Batsbane',            silver: 'Nightwing-Culler' },
  giant_bat:      { bronze: 'Batsbane',            silver: 'Roostbreaker' },
  wolf:           { bronze: 'Wolfsbane',           silver: 'Pack-Hunter',        gold: 'Winterfang' },
  dire_wolf:      { bronze: 'Wolfsbane',           silver: 'Alpha-Killer',       gold: 'Direbane' },
  worg:           { bronze: 'Worgsbane',           silver: 'Worg-Hunter',        gold: 'Fangbreaker' },
  goblin:         { bronze: 'Goblin-Culler',       silver: 'Goblin-Slayer' },
  goblin_spear:   { bronze: 'Goblin-Culler',       silver: 'Goblin-Slayer' },
  hobgoblin:      { bronze: 'Hobgoblin-Hunter',    silver: 'Warband-Breaker' },
  kobold:         { bronze: 'Kobold-Stomper',      silver: 'Kobold-Bane' },
  orc:            { bronze: 'Orc-Cleaver',         silver: 'Orc-Slayer' },
  gnoll:          { bronze: 'Gnoll-Hunter',        silver: 'Gnoll-Slayer' },
  skeleton:       { bronze: 'Bone-Breaker',        silver: 'Grave-Cleanser' },
  skeleton_crew:  { bronze: 'Bone-Breaker',        silver: 'Boarder-Bane' },
  zombie:         { bronze: 'Corpse-Burner',       silver: 'Rot-Purger' },
  ghoul:          { bronze: 'Ghoul-Hunter',        silver: 'Ghoul-Bane',         gold: 'Crypt-Cleanser' },
  stirge:         { bronze: 'Stirge-Swatter',      silver: 'Bloodsucker-Bane' },
  giant_spider:   { bronze: 'Web-Cutter',          silver: 'Spider-Slayer',      gold: 'Broodbane' },
  small_spider:   { bronze: 'Web-Cutter',          silver: 'Nestbreaker' },
  ogre:           { bronze: 'Ogre-Feller',         silver: 'Ogre-Slayer',        gold: 'Giantsbane' },
  troll:          { bronze: 'Troll-Hunter',        silver: 'Troll-Slayer',       gold: 'Trollsbane' },
  wight:          { bronze: 'Wight-Hunter',        silver: 'Wight-Slayer',       gold: 'Deathless-Bane' },
  shark:          { bronze: 'Shark-Hunter',        silver: 'Finbreaker',         gold: 'Deep-Terror' },
  great_shark:    { bronze: 'Shark-Hunter',        silver: 'Finbreaker',         gold: 'Maw of the Deep' },
  sea_serpent:    { bronze: 'Serpent-Hunter',      silver: 'Serpent-Slayer',     gold: 'Leviathan-Bane' },
  kraken_tentacle:{ bronze: 'Arm-Severer',         silver: 'Kraken-Cutter',      gold: 'Krakenbane' },
  kraken_eye:     { bronze: 'Eye-Piercer',         silver: 'Kraken-Blinder',     gold: 'Krakenslayer' },
  giant_crab:     { bronze: 'Shell-Cracker',       silver: 'Crab-Slayer',        gold: 'Carapace-Breaker' },
};
// Iconic caps: a signature nemesis whose ladder should REACH GOLD even at a lower CR band.
const CAP_OVERRIDE = { ghoul: 3, giant_spider: 3, shark: 3, great_shark: 3, sea_serpent: 3 };

/** Generate a readable title for a non-iconic monster at a given tier. */
function generatedTitle(name, tierKey) {
  const suffix = tierKey === 'bronze' ? 'Hunter' : tierKey === 'silver' ? 'Slayer' : 'Bane';
  return `${name} ${suffix}`;
}

// ── STABLE achievement id (used by the tracker + the on-chain keeper) ────────────────────────────
// e.g. "kill:rat:bronze". Deterministic + human-readable so the keeper can map it to a coin payout.
export function achId(monsterId, tierKey) { return `kill:${monsterId}:${tierKey}`; }

// ── build the ladder for one monster ─────────────────────────────────────────────────────────
function buildLadder(m) {
  const th = thresholdsFor(m.cr);
  const capRank = Math.max(capRankFor(m.cr), CAP_OVERRIDE[m.id] || 0);
  const over = TITLE_OVERRIDES[m.id] || {};
  const rungs = [];
  // rat is pinned verbatim (bronze=100 Exterminator, silver=1000 Master Exterminator).
  const bronzeCount = m.id === 'rat' ? 100 : th.bronze;
  const silverCount = m.id === 'rat' ? 1000 : th.silver;

  rungs.push({ count: bronzeCount, title: over.bronze || generatedTitle(m.name, 'bronze'),
    tier: 'bronze', prizeToken: COIN_TOKENS.COPPER, coin: 'COPPER', achId: achId(m.id, 'bronze') });
  if (capRank >= 2) rungs.push({ count: silverCount, title: over.silver || generatedTitle(m.name, 'silver'),
    tier: 'silver', prizeToken: COIN_TOKENS.SILVER, coin: 'SILVER', achId: achId(m.id, 'silver') });
  if (capRank >= 3) rungs.push({ count: th.gold, title: over.gold || generatedTitle(m.name, 'gold'),
    tier: 'gold', prizeToken: COIN_TOKENS.GOLD, coin: 'GOLD', achId: achId(m.id, 'gold') });
  return rungs;
}

// ── the full table (built once at load) ────────────────────────────────────────────────────────
export const KILL_LADDERS = Object.freeze(
  Object.fromEntries(Object.values(ROSTER).map((m) => [m.id, Object.freeze(buildLadder(m))]))
);

/** The kill-tier ladder for a monster id. Returns [] for an unknown id (never throws — a monster
 *  the bestiaries don't list simply has no ladder yet; the tracker still counts kills). */
export function getKillTiers(monsterId) {
  return KILL_LADDERS[monsterId] || [];
}

/** The monster meta for an id (name/cr/role) — handy for the bestiary view + tests. */
export function monsterMeta(monsterId) { return ROSTER[monsterId] || null; }

/** Every monster id the ladder covers (union of both bestiaries). */
export function allMonsterIds() { return Object.keys(KILL_LADDERS); }

// ── GEM META LADDER — collect N total achievements → a gem milestone (tier ABOVE gold) ──────────
// Escalating milestones with hunter-flavored titles; each pays a project GEM token (verified above).
// The gem token ASCENDS with the milestone (amethyst → … → diamond), so the top collector earns
// the top gem. achId here is meta:<count> so it never collides with a kill:<id>:<tier> id.
export const META_LADDER = Object.freeze([
  { count: 10,  title: 'Achievement Hunter',  tier: 'gem', gem: 'AMETHYST', prizeToken: GEM_TOKENS.AMETHYST, achId: 'meta:10' },
  { count: 25,  title: 'Beast-Tracker',       tier: 'gem', gem: 'EMERALD',  prizeToken: GEM_TOKENS.EMERALD,  achId: 'meta:25' },
  { count: 50,  title: 'Bestiary Scholar',    tier: 'gem', gem: 'RUBY',     prizeToken: GEM_TOKENS.RUBY,     achId: 'meta:50' },
  { count: 100, title: 'Monster Master',      tier: 'gem', gem: 'PLATINUM', prizeToken: GEM_TOKENS.PLATINUM, achId: 'meta:100' },
  { count: 200, title: 'Living Legend',       tier: 'gem', gem: 'DIAMOND',  prizeToken: GEM_TOKENS.DIAMOND,  achId: 'meta:200' },
]);

/** The gem meta tiers a given TOTAL-earned count qualifies for (all rungs at/under `total`). Used by
 *  the tracker to detect newly-crossed meta milestones after an achievement is earned. */
export function getMetaTiers(total) {
  const t = Number(total) || 0;
  return META_LADDER.filter((r) => t >= r.count);
}

/** The next uncrossed meta milestone above `total` (or null if all earned) — for the bestiary view. */
export function nextMetaTier(total) {
  const t = Number(total) || 0;
  return META_LADDER.find((r) => t < r.count) || null;
}
