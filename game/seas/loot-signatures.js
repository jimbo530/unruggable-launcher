// @ts-check
'use strict';
/**
 * loot-signatures.js — the MONSTER-SIGNATURE (CORE loot) framework for "Seize the Seas".
 * Founder 2026-07-01, the settled loot model:
 *
 *   Every fight win = TWO layers, all BACK-END (players never see dice/odds — only the treasure):
 *     (1) CORE      = the creature's GUARANTEED signature drop (wolf -> pelt + meat, boar -> pork +
 *                     hide, etc.). THIS FILE resolves the CORE by creature TYPE/SUBTYPE.
 *     (2) SECONDARY = a HIDDEN chance to ALSO draw from a CR-band + AREA-matched general tier pool
 *                     (roll-charts.js owns that draw). Not this file.
 *
 * WHY SUBTYPE-KEYED (stable, roster-independent)
 *   The bestiaries (battle-grid/bestiary-sea.js SEA_BESTIARY, battle-grid/bestiary-dungeon.js
 *   DUNGEON_BESTIARY) tag every creature with `subtypes` (e.g. ["beast"], ["humanoid","goblinoid"],
 *   ["undead"], ["vermin"], ["ooze"], ["magical_beast","aquatic"]…). Keying the CORE off SUBTYPE
 *   means new creatures inherit a sensible signature automatically — the map does NOT break when the
 *   roster grows. A small per-NAME OVERRIDE table (SIGNATURE_OVERRIDES) then sharpens the specifics
 *   the founder called out (wolf->wolf pelt, boar->pork, spider->silk+venom, snake->venom+skin…).
 *
 * ⚠️ RECONCILE FLAG (LOUD, on purpose)
 *   SIGNATURE_OVERRIDES below was built by reading the CURRENT bestiary keys (2026-07-01). Another
 *   agent is STILL ADDING CR0-5 entries to the bestiary RIGHT NOW. This override table MUST be
 *   reconciled against the FINAL CR0-5 roster before ship. reconcileSignatures(bestiaryKeys) returns
 *   the keys with NO override (they fall back to subtype defaults — safe, just less specific) so a
 *   later pass can review them. It does NOT throw — a missing override is a soft warning, not a crash.
 *
 * OUTPUT — resolveSignature(creatureDefOrType) -> {
 *     source, matchedBy, subtype, goods:[{ sym, kind, note }], hasCoin, coinSym, tags:[…]
 *   }
 *   `goods` NAMES the CORE trade-goods (mostly food + materials, per the founder model). It is a
 *   DESCRIPTION — this file NEVER moves funds and NEVER references pool addresses or bps. The keeper
 *   maps `goods` symbols to the on-chain CORE pool at payout time (founder-gated), same as SECONDARY.
 *
 *   Compliance: this is a fixed LOOT-SIGNATURE table (skill win -> see what treasure you find). No
 *   odds, no chance, no spin/jackpot language anywhere in the returned shape.
 *
 * PURE data + a pure resolver. No I/O, no chain, no RNG, no imports of the bestiary files (it takes
 * a def OR a {type,subtype} — so it stays node --check clean without the ESM bestiaries loading).
 */

// ───────────────────────────────────────────────────────────────────────────────────────────
// GOODS symbols — the trade-good tokens the CORE names. Symbols MUST exist in
// game/seas/commodity-tokens.csv (verified 2026-07-01). We name SYMBOLS only; the keeper resolves
// symbol -> address at payout so this file has zero hard-coded addresses.
// kinds: food | material | hide | pelt | fiber | venom | bone | residue | essence | coin | misc
// ───────────────────────────────────────────────────────────────────────────────────────────

/** The by-SUBTYPE CORE signature. Ordered specific-first: the FIRST subtype that matches wins.
 *  Each entry: goods[] (the guaranteed core), hasCoin/coinSym (humanoids carry a little copper). */
const SUBTYPE_SIGNATURES = {
  // ── beasts / animals: meat + hide/pelt (the food-first low-fight rule lives here) ──
  beast:          { goods: [{ sym: 'PORK',   kind: 'food' }, { sym: 'ARMORHIDE', kind: 'hide' }], tags: ['game', 'forest'] },
  animal:         { goods: [{ sym: 'PORK',   kind: 'food' }, { sym: 'ARMORHIDE', kind: 'hide' }], tags: ['game'] },
  magical_beast:  { goods: [{ sym: 'JERKY',  kind: 'food' }, { sym: 'ARMORHIDE', kind: 'hide' }], tags: ['exotic'] },
  'magical-beast':{ goods: [{ sym: 'JERKY',  kind: 'food' }, { sym: 'ARMORHIDE', kind: 'hide' }], tags: ['exotic'] },

  // ── vermin (rats/spiders/beetles/centipedes): little food + silk/residue ──
  vermin:         { goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'SALT', kind: 'food' }], tags: ['creepy'] },

  // ── humanoids (goblin/kobold/orc/bandit/pirate): crude gear + a few COPPER + rations ──
  humanoid:       { goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'DAGGERWOODE', kind: 'material', note: 'crude gear' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear'] },
  goblinoid:      { goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'DAGGERWOODE', kind: 'material', note: 'crude goblin gear' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear'] },
  orc:            { goods: [{ sym: 'JERKY',   kind: 'food' }, { sym: 'BATTLEAXEWO', kind: 'material', note: 'crude gear' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear'] },
  reptilian:      { goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'ARMORHIDE', kind: 'hide' }], hasCoin: true, coinSym: 'COPPER', tags: ['scaled'] },
  gnoll:          { goods: [{ sym: 'JERKY',   kind: 'food' }, { sym: 'ARMORHIDE', kind: 'hide' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear'] },

  // ── aquatic (shark/crab/fish-folk/serpent): meat + shell/salvage ──
  aquatic:        { goods: [{ sym: 'FISH',   kind: 'food' }, { sym: 'SALT', kind: 'food' }], tags: ['sea'] },

  // ── undead (skeleton/zombie/wight/ghoul/mummy): bone-dust-goods + grave goods (no food) ──
  undead:         { goods: [{ sym: 'BRICK',  kind: 'bone', note: 'bone dust -> trade good' }, { sym: 'SHALE', kind: 'material', note: 'grave goods' }], tags: ['grave'] },
  incorporeal:    { goods: [{ sym: 'SHALE',  kind: 'residue', note: 'ectoplasmic residue -> trade good' }], tags: ['grave'] },

  // ── ooze / slime: residue only (no food, no hide) ──
  ooze:           { goods: [{ sym: 'SHALE',  kind: 'residue', note: 'ooze residue -> trade good' }], tags: ['residue'] },

  // ── plant (assassin vine / shambling mound / mound): fiber + timber ──
  plant:          { goods: [{ sym: 'LOGS',   kind: 'material', note: 'plant fiber / timber' }, { sym: 'BLKBRY', kind: 'food' }], tags: ['forest'] },

  // ── giant / ogre / troll: BIG meat + a crude cache (a little copper) ──
  giant:          { goods: [{ sym: 'BEAR',   kind: 'food', note: 'big game meat' }, { sym: 'GREATCLUBWO', kind: 'material', note: 'crude cache' }], hasCoin: true, coinSym: 'COPPER', tags: ['big'] },

  // ── dragon / wyvern: hide + a fine cache (dragons run high-CR so the SECONDARY tier carries the value) ──
  dragon:         { goods: [{ sym: 'ARMORHIDE', kind: 'hide', note: 'dragon hide' }, { sym: 'BEAR', kind: 'food', note: 'big game meat' }], hasCoin: true, coinSym: 'COPPER', tags: ['apex'] },

  // ── fey / aberration / elemental / earth: essence / misc ──
  fey:            { goods: [{ sym: 'BLUBRY', kind: 'food' }, { sym: 'HONEY', kind: 'food' }], tags: ['fey'] },
  aberration:     { goods: [{ sym: 'SHALE',  kind: 'residue', note: 'aberrant residue' }], tags: ['weird'] },
  earth:          { goods: [{ sym: 'SHALE',  kind: 'material' }, { sym: 'GRANITE', kind: 'material' }], tags: ['stone'] },

  // ── construct (animated armor/sword, golems, guardians, homunculi): scrap metal + broken parts (no food) ──
  construct:      { goods: [{ sym: 'IRONORE', kind: 'material', note: 'scrap metal' }, { sym: 'SHALE', kind: 'material', note: 'broken parts' }], tags: ['scrap', 'construct'] },

  // ── elemental (air/fire/water/corrupted motes): elemental essence/residue (no food) ──
  elemental:      { goods: [{ sym: 'COAL',  kind: 'essence', note: 'elemental mote -> essence' }, { sym: 'SHALE', kind: 'residue', note: 'elemental residue' }], tags: ['elemental'] },

  // ── outsider (imps/devils/fiends/archons/mephits): planar residue + a little cursed coin (no food) ──
  outsider:       { goods: [{ sym: 'SHALE', kind: 'residue', note: 'planar/brimstone residue' }], hasCoin: true, coinSym: 'COPPER', tags: ['planar'] },

  // ── monstrous humanoid (centaur, etc.): game meat + hide + a little coin ──
  monstrous_humanoid: { goods: [{ sym: 'ELK', kind: 'food', note: 'game meat' }, { sym: 'ARMORHIDE', kind: 'hide' }], hasCoin: true, coinSym: 'COPPER', tags: ['plains'] },
};

/** Fallback when NO subtype matches (should be rare — flagged by resolveSignature.matchedBy). */
const DEFAULT_SIGNATURE = { goods: [{ sym: 'RATIONS', kind: 'food' }], tags: ['generic'] };

// ───────────────────────────────────────────────────────────────────────────────────────────
// SIGNATURE_OVERRIDES — per-CREATURE sharpening, built by reading the CURRENT bestiary keys
// (2026-07-01). Keyed by the creature's `name` (case-insensitive) OR its bestiary id. These win
// over the subtype default. ⚠️ MUST BE RECONCILED against the final CR0-5 roster — see the file
// header + reconcileSignatures(). Only the founder-named specifics + the clearest wins are set here;
// everything else safely falls back to the subtype signature.
// ───────────────────────────────────────────────────────────────────────────────────────────
const SIGNATURE_OVERRIDES = {
  // founder's explicit examples
  'wolf':          { goods: [{ sym: 'ARMORHIDE', kind: 'pelt', note: 'wolf pelt' }, { sym: 'PORK', kind: 'food', note: 'game meat' }], tags: ['forest', 'game'] },
  'dire wolf':     { goods: [{ sym: 'ARMORHIDE', kind: 'pelt', note: 'dire wolf pelt' }, { sym: 'BEAR', kind: 'food', note: 'big game meat' }], tags: ['forest', 'game'] },
  'worg':          { goods: [{ sym: 'ARMORHIDE', kind: 'pelt', note: 'worg pelt' }, { sym: 'PORK', kind: 'food' }], tags: ['forest', 'game'] },
  'boar':          { goods: [{ sym: 'PORK', kind: 'food', note: 'pork' }, { sym: 'ARMORHIDE', kind: 'hide', note: 'boar hide' }], tags: ['forest', 'game'] },
  'dire boar':     { goods: [{ sym: 'PORK', kind: 'food', note: 'pork' }, { sym: 'ARMORHIDE', kind: 'hide' }], tags: ['forest', 'game'] },
  // bears -> hide + meat
  'black bear':    { goods: [{ sym: 'ARMORHIDE', kind: 'hide', note: 'bear hide' }, { sym: 'BEAR', kind: 'food', note: 'bear meat' }], tags: ['forest', 'game'] },
  'brown bear':    { goods: [{ sym: 'ARMORHIDE', kind: 'hide', note: 'bear hide' }, { sym: 'BEAR', kind: 'food', note: 'bear meat' }], tags: ['forest', 'game'] },
  'dire bear':     { goods: [{ sym: 'ARMORHIDE', kind: 'hide', note: 'dire bear hide' }, { sym: 'BEAR', kind: 'food', note: 'bear meat' }], tags: ['forest', 'game'] },
  // big cats -> pelt + meat
  'lion':          { goods: [{ sym: 'ARMORHIDE', kind: 'pelt', note: 'lion pelt' }, { sym: 'ELK', kind: 'food', note: 'game meat' }], tags: ['plains', 'game'] },
  'tiger':         { goods: [{ sym: 'ARMORHIDE', kind: 'pelt', note: 'tiger pelt' }, { sym: 'ELK', kind: 'food' }], tags: ['jungle', 'game'] },
  'dire tiger':    { goods: [{ sym: 'ARMORHIDE', kind: 'pelt', note: 'dire tiger pelt' }, { sym: 'BEAR', kind: 'food' }], tags: ['jungle', 'game'] },
  'leopard':       { goods: [{ sym: 'ARMORHIDE', kind: 'pelt', note: 'leopard pelt' }, { sym: 'ELK', kind: 'food' }], tags: ['jungle', 'game'] },
  'sea cat':       { goods: [{ sym: 'ARMORHIDE', kind: 'pelt', note: 'sea cat pelt' }, { sym: 'FISH', kind: 'food' }], tags: ['sea', 'game'] },
  // spiders -> silk + venom (using in-catalog proxies: fiber=LOGS-derived? no — use RATIONS food + SALT is wrong; spiders give silk+venom)
  'giant spider':  { goods: [{ sym: 'ARMORHIDE', kind: 'fiber', note: 'spider silk -> fiber good' }, { sym: 'HEALPOTS', kind: 'venom', note: 'spider venom -> alchemical good' }], tags: ['cave', 'creepy'] },
  'small spider':  { goods: [{ sym: 'HEALPOTS', kind: 'venom', note: 'spider venom' }, { sym: 'RATIONS', kind: 'food' }], tags: ['cave', 'creepy'] },
  'tiny spider':   { goods: [{ sym: 'HEALPOTS', kind: 'venom', note: 'spider venom' }], tags: ['cave', 'creepy'] },
  'ettercap':      { goods: [{ sym: 'ARMORHIDE', kind: 'fiber', note: 'web silk -> fiber' }, { sym: 'HEALPOTS', kind: 'venom' }], tags: ['cave', 'creepy'] },
  'broodmother cave':   { goods: [{ sym: 'ARMORHIDE', kind: 'fiber', note: 'silk' }, { sym: 'HEALPOTS', kind: 'venom' }], tags: ['cave', 'creepy'] },
  // snakes -> venom + skin
  'constrictor snake':  { goods: [{ sym: 'ARMORHIDE', kind: 'hide', note: 'snake skin' }, { sym: 'HEALPOTS', kind: 'venom', note: 'snake venom' }], tags: ['swamp', 'creepy'] },
  'giant constrictor':  { goods: [{ sym: 'ARMORHIDE', kind: 'hide', note: 'serpent skin' }, { sym: 'HEALPOTS', kind: 'venom' }], tags: ['swamp', 'creepy'] },
  'sea serpent':        { goods: [{ sym: 'ARMORHIDE', kind: 'hide', note: 'serpent skin' }, { sym: 'FISH', kind: 'food' }], tags: ['sea', 'creepy'] },
  'viper tiny':         { goods: [{ sym: 'HEALPOTS', kind: 'venom', note: 'viper venom' }], tags: ['creepy'] },
  // undead specifics
  'skeleton':      { goods: [{ sym: 'BRICK', kind: 'bone', note: 'bone dust' }, { sym: 'SHALE', kind: 'material', note: 'grave goods' }], tags: ['grave'] },
  'skeleton crew': { goods: [{ sym: 'BRICK', kind: 'bone', note: 'bone dust' }, { sym: 'SALT', kind: 'material', note: 'drowned salvage' }], tags: ['grave', 'sea'] },
  'zombie':        { goods: [{ sym: 'BRICK', kind: 'bone', note: 'grave dust' }, { sym: 'RATIONS', kind: 'material', note: 'moldering goods' }], tags: ['grave'] },
  'mummy':         { goods: [{ sym: 'BRICK', kind: 'bone', note: 'ancient dust' }, { sym: 'SAFFRON', kind: 'material', note: 'embalming spices' }], tags: ['grave', 'ruins'] },
  // aquatic specifics: crab -> shell + meat; shark -> teeth + meat; fish-folk -> salvage + meat
  'giant crab':    { goods: [{ sym: 'CRAB', kind: 'food', note: 'crab meat' }, { sym: 'BRICK', kind: 'material', note: 'shell -> trade good' }], tags: ['coast', 'sea'] },
  'crab':          { goods: [{ sym: 'CRAB', kind: 'food', note: 'crab meat' }, { sym: 'BRICK', kind: 'material', note: 'shell' }], tags: ['coast', 'sea'] },
  'shark':         { goods: [{ sym: 'FISH', kind: 'food', note: 'shark meat' }, { sym: 'BRICK', kind: 'material', note: 'shark teeth -> trade good' }], tags: ['sea'] },
  'great shark':   { goods: [{ sym: 'FISH', kind: 'food', note: 'shark meat' }, { sym: 'BRICK', kind: 'material', note: 'shark teeth' }], tags: ['sea'] },
  'merfolk raider':{ goods: [{ sym: 'FISH', kind: 'food' }, { sym: 'SALT', kind: 'material', note: 'reef salvage' }], hasCoin: true, coinSym: 'COPPER', tags: ['sea'] },
  'sahuagin':      { goods: [{ sym: 'FISH', kind: 'food' }, { sym: 'SALT', kind: 'material' }], hasCoin: true, coinSym: 'COPPER', tags: ['sea'] },
  'crocodile':     { goods: [{ sym: 'ARMORHIDE', kind: 'hide', note: 'croc hide' }, { sym: 'FISH', kind: 'food' }], tags: ['swamp', 'sea'] },
  'dolphin':       { goods: [{ sym: 'FISH', kind: 'food' }], tags: ['sea'] },
  // humanoid pirate/goblin specifics: crude gear + copper + rations
  'goblin':        { goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'DAGGERWOODE', kind: 'material', note: 'crude goblin gear' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear', 'cave'] },
  'goblin spear':  { goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'SPW', kind: 'material', note: 'crude spear' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear', 'cave'] },
  'goblin slinger':{ goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'SLINGWOODEN', kind: 'material', note: 'crude sling' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear', 'cave'] },
  'kobold':        { goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'DAGGERWOODE', kind: 'material', note: 'crude gear' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear', 'cave'] },
  'orc':           { goods: [{ sym: 'JERKY', kind: 'food' }, { sym: 'BATTLEAXEWO', kind: 'material', note: 'crude axe' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear'] },
  'hobgoblin':     { goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'SWI', kind: 'material', note: 'iron sword' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear'] },
  'bugbear':       { goods: [{ sym: 'JERKY', kind: 'food' }, { sym: 'MACEWOODEN', kind: 'material', note: 'crude gear' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear'] },
  'pirate deckhand':{ goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'FISH', kind: 'food' }], hasCoin: true, coinSym: 'COPPER', tags: ['sea', 'crude-gear'] },
  'pirate cutthroat':{ goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'DAGGERIRON', kind: 'material', note: 'cutlass -> iron gear' }], hasCoin: true, coinSym: 'COPPER', tags: ['sea', 'crude-gear'] },
  'navy marine':   { goods: [{ sym: 'RATIONS', kind: 'food' }, { sym: 'CROSSBOWWOO', kind: 'material', note: 'issued gear' }], hasCoin: true, coinSym: 'COPPER', tags: ['crude-gear'] },
  // rats / bilge rats -> a little food (the tutorial fight always feeds the pawn)
  'bilge rat':     { goods: [{ sym: 'RATIONS', kind: 'food', note: 'scraps' }], tags: ['sea', 'creepy'] },
  'dire rat':      { goods: [{ sym: 'RATIONS', kind: 'food', note: 'scraps' }], tags: ['creepy'] },
  'rat swarm':     { goods: [{ sym: 'RATIONS', kind: 'food', note: 'scraps' }], tags: ['creepy'] },
  // giants / ogres / trolls -> big meat + crude cache
  'ogre':          { goods: [{ sym: 'BEAR', kind: 'food', note: 'big meat' }, { sym: 'GREATCLUBWO', kind: 'material', note: 'crude cache' }], hasCoin: true, coinSym: 'COPPER', tags: ['big'] },
  'troll':         { goods: [{ sym: 'BEAR', kind: 'food', note: 'big meat' }, { sym: 'ARMORHIDE', kind: 'hide' }], hasCoin: true, coinSym: 'COPPER', tags: ['big', 'forest'] },
  // ooze / slime
  'gray ooze':     { goods: [{ sym: 'SHALE', kind: 'residue', note: 'ooze residue' }], tags: ['residue', 'cave'] },
  'ochre jelly':   { goods: [{ sym: 'SHALE', kind: 'residue', note: 'jelly residue' }], tags: ['residue', 'cave'] },
  'gelatinous cube':{ goods: [{ sym: 'SHALE', kind: 'residue', note: 'gel residue' }, { sym: 'COPPER', kind: 'coin', note: 'undigested coin' }], hasCoin: true, coinSym: 'COPPER', tags: ['residue', 'cave'] },
  'green slime':   { goods: [{ sym: 'SHALE', kind: 'residue' }], tags: ['residue', 'cave'] },
  // dragons / wyrmlings -> hide + big meat (value carried by high-CR SECONDARY tier)
  'wyvern':        { goods: [{ sym: 'ARMORHIDE', kind: 'hide', note: 'wyvern hide' }, { sym: 'BEAR', kind: 'food' }], hasCoin: true, coinSym: 'COPPER', tags: ['apex'] },
  'chimera':       { goods: [{ sym: 'ARMORHIDE', kind: 'hide' }, { sym: 'BEAR', kind: 'food' }], hasCoin: true, coinSym: 'COPPER', tags: ['apex'] },
  // reconcile polish (2026-07-01, final-roster pass): iconic creatures sharpened past their subtype default
  'ghoul':         { goods: [{ sym: 'BRICK', kind: 'bone', note: 'bone dust' }, { sym: 'SHALE', kind: 'material', note: 'grave goods' }], tags: ['grave', 'cave'] },
  'green hag':     { goods: [{ sym: 'HEALPOTS', kind: 'venom', note: 'hag reagents' }, { sym: 'BLKBRY', kind: 'food', note: 'swamp forage' }], tags: ['swamp', 'fey'] },
  'kraken tentacle':{ goods: [{ sym: 'FISH', kind: 'food', note: 'tentacle meat' }, { sym: 'HEALPOTS', kind: 'venom', note: 'kraken ink -> alchemical' }], tags: ['sea'] },
  'kraken eye':    { goods: [{ sym: 'HEALPOTS', kind: 'venom', note: 'kraken ichor -> alchemical' }, { sym: 'FISH', kind: 'food' }], tags: ['sea'] },
};

// ───────────────────────────────────────────────────────────────────────────────────────────
// Resolver
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Normalize a creature input into { name, subtypes[] }. Accepts a bestiary def, or a plain
 *  { type/subtype } hint, or a bare string (treated as a name). Throws (visibly) on garbage. */
function normalizeCreature(input) {
  if (input == null) throw new Error('resolveSignature: creature is required (def, {type,subtype}, or name)');
  if (typeof input === 'string') return { name: input, subtypes: [] };
  if (typeof input !== 'object') throw new Error(`resolveSignature: bad creature input (${typeof input})`);
  const name = input.name || input.monsterId || input.id || '';
  let subtypes = [];
  if (Array.isArray(input.subtypes)) subtypes = input.subtypes.slice();
  else if (typeof input.subtype === 'string') subtypes = [input.subtype];
  else if (typeof input.type === 'string') subtypes = [input.type];
  return { name: String(name), subtypes: subtypes.map((s) => String(s).toLowerCase()) };
}

/**
 * Resolve the CORE signature for a creature.
 * @param {object|string} creatureDefOrType  a bestiary def, {type/subtype}, or a name string
 * @returns {{ source:'override'|'subtype'|'default', matchedBy:string, subtype:string|null,
 *             name:string, goods:Array<{sym:string,kind:string,note?:string}>,
 *             hasCoin:boolean, coinSym:string|null, tags:string[] }}
 */
function resolveSignature(creatureDefOrType) {
  const { name, subtypes } = normalizeCreature(creatureDefOrType);
  const key = name.toLowerCase().trim();

  // 1) per-creature override wins
  if (key && Object.prototype.hasOwnProperty.call(SIGNATURE_OVERRIDES, key)) {
    const o = SIGNATURE_OVERRIDES[key];
    return {
      source: 'override', matchedBy: key, subtype: subtypes[0] || null, name,
      goods: o.goods.map((g) => ({ ...g })),
      hasCoin: !!o.hasCoin, coinSym: o.hasCoin ? (o.coinSym || 'COPPER') : null,
      tags: (o.tags || []).slice(),
    };
  }

  // 2) subtype default (first matching subtype, in the creature's own order)
  for (const st of subtypes) {
    if (Object.prototype.hasOwnProperty.call(SUBTYPE_SIGNATURES, st)) {
      const s = SUBTYPE_SIGNATURES[st];
      return {
        source: 'subtype', matchedBy: st, subtype: st, name,
        goods: s.goods.map((g) => ({ ...g })),
        hasCoin: !!s.hasCoin, coinSym: s.hasCoin ? (s.coinSym || 'COPPER') : null,
        tags: (s.tags || []).slice(),
      };
    }
  }

  // 3) default fallback (flagged so a caller/log can see it was un-signed)
  return {
    source: 'default', matchedBy: 'none', subtype: subtypes[0] || null, name,
    goods: DEFAULT_SIGNATURE.goods.map((g) => ({ ...g })),
    hasCoin: false, coinSym: null, tags: DEFAULT_SIGNATURE.tags.slice(),
  };
}

/**
 * RECONCILE HELPER — given the FINAL bestiary keys/names, report which have NO per-name override
 * (they fall back to subtype defaults — safe, just less specific). Use this after the bestiary
 * author finishes the CR0-5 roster so a review pass can sharpen the important ones.
 * Does NOT throw — a missing override is a soft warning.
 * @param {string[]} bestiaryNames  creature `name`s (or ids) from the final roster
 * @returns {{ total:number, withOverride:string[], subtypeOnly:string[] }}
 */
function reconcileSignatures(bestiaryNames) {
  if (!Array.isArray(bestiaryNames)) throw new Error('reconcileSignatures: pass an array of creature names/ids');
  const withOverride = [], subtypeOnly = [];
  for (const raw of bestiaryNames) {
    const k = String(raw).toLowerCase().trim();
    if (Object.prototype.hasOwnProperty.call(SIGNATURE_OVERRIDES, k)) withOverride.push(k);
    else subtypeOnly.push(k);
  }
  return { total: bestiaryNames.length, withOverride, subtypeOnly };
}

/** All subtypes with a signature (docs / tests). */
function knownSubtypes() { return Object.keys(SUBTYPE_SIGNATURES); }
/** All creature names with an explicit override (docs / reconcile). */
function overriddenCreatures() { return Object.keys(SIGNATURE_OVERRIDES); }

module.exports = {
  SUBTYPE_SIGNATURES, SIGNATURE_OVERRIDES, DEFAULT_SIGNATURE,
  resolveSignature, reconcileSignatures, knownSubtypes, overriddenCreatures,
};
