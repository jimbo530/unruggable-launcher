// @ts-check
'use strict';
/**
 * bestiary-lore.js — STRENGTHS & WEAKNESSES intel for "Seize the Seas", DERIVED from each monster's
 * actual stat block. Founder (2026-07-01): once a player earns a monster's (first/bronze) kill
 * achievement, its bestiary entry REVEALS how to fight it — "if they have the achievement they have
 * the monster's strengths and weaknesses in the bestiary to read."
 *
 * WHY A SEPARATE FILE (and why DERIVED, not authored)
 *   The bestiary entries themselves are owned by another agent (read-only for us), so we do NOT edit
 *   them. Instead this file IMPORTS both bestiaries and, for each of the 208 creatures, computes a
 *   short { strengths[], weaknesses[], tactics } from its OWN numbers — high AC → "hard to hit";
 *   low CON/HP → "fragile"; resistances/immunities → called out; a heavy telegraph attack → "brace/
 *   interrupt"; a caster → "disrupt its spells"; pack/lead flags; speed. Because it's derived, it can
 *   never drift from the stat block, and hand-written flavor lives ONLY in FLAVOR_OVERRIDES (a small
 *   overlay for the iconic foes) — never by editing the bestiary.
 *
 * PURE — no ethers, no I/O, no RNG. node --check clean. ESM. Imports the two bestiaries only.
 *
 * EXPORTS
 *   loreFor(monsterId)   → { name, cr, strengths:[…], weaknesses:[…], tactics:'…' }  (null if unknown)
 *   BESTIARY_LORE        → the full { [monsterId]: lore } table (all 208)
 *   allLoreIds()         → every id with a lore entry
 */

import { SEA_BESTIARY } from './battle-grid/bestiary-sea.js';
import { DUNGEON_BESTIARY } from './battle-grid/bestiary-dungeon.js';

const slug = (s) => String(s).trim().toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/**
 * Normalize a bestiary entry (either shape) into the fields the lore derivation reads.
 *   dungeon: flat { hp, ac, con, role, subtypes, special, boss, spells, range, speed, dmg }
 *   sea:     { maxHp, stats:{attack,atkBonus,ac}, abilities:{con,…}, attackRange, movementHexes,
 *             telegraph{}, role, subtypes, special, swarm, undead, noBleed, isRanged, severable }
 * The sea CON is a D&D SCORE (≈10 = average); the dungeon CON is the "-10" convention (score-10).
 * We convert both to a common "is it beefy?" read: sea con>=15 = tough / <=11 = fragile;
 * dungeon con>=4 = tough / con<=2 = fragile. (See toughFrail.)
 */
function normalize(id, def, kind) {
  if (kind === 'dungeon') {
    return {
      id, name: def.name || id, cr: num(def.cr, 1), role: def.role || 'melee',
      subtypes: Array.isArray(def.subtypes) ? def.subtypes : [],
      hp: num(def.hp, 6), ac: num(def.ac, 12),
      con: num(def.con, 1), conKind: 'mod10', // "-10" convention
      range: num(def.range, 1), speed: num(def.speed, 30),
      special: String(def.special || ''), boss: !!def.boss,
      spells: Array.isArray(def.spells) ? def.spells : [],
      telegraph: null, swarm: false, undead: false, noBleed: false, isRanged: false, severable: false,
    };
  }
  // sea
  const ab = def.abilities || {};
  return {
    id, name: def.name || id, cr: num(def.cr, 1), role: def.role || 'melee',
    subtypes: Array.isArray(def.subtypes) ? def.subtypes : [],
    hp: num(def.maxHp, 6), ac: num(def.stats && def.stats.ac, 12),
    con: num(ab.con, 10), conKind: 'score', // D&D score
    range: num(def.attackRange, 1), speed: num(def.movementHexes, 3) * 10,
    special: String(def.special || ''), boss: !!def.boss || /boss/i.test(String(def.tier || '')),
    spells: Array.isArray(def.availableSpells) ? def.availableSpells : [],
    telegraph: def.telegraph || null, swarm: !!def.swarm, undead: !!def.undead,
    noBleed: !!def.noBleed, isRanged: !!def.isRanged, severable: !!def.severable,
  };
}

function buildRoster() {
  const r = {};
  for (const [id, def] of Object.entries(DUNGEON_BESTIARY)) r[id] = normalize(id, def, 'dungeon');
  for (const [key, tpl] of Object.entries(SEA_BESTIARY)) { const id = slug(key); if (!r[id]) r[id] = normalize(id, tpl, 'sea'); }
  return r;
}
const ROSTER = buildRoster();

// ── tough / frail read (unifies the two CON conventions) ──────────────────────────────────────
function toughFrail(m) {
  const tough = m.conKind === 'score' ? m.con >= 15 : m.con >= 4;
  const frail = m.conKind === 'score' ? m.con <= 11 : m.con <= 2;
  return { tough, frail };
}

// keywords we scan the `special` text for (resistances / immunities / disease / pack / stealth …).
function scanSpecial(s) {
  const t = s.toLowerCase();
  return {
    dr: /\bdr\s*\d/.test(t),                                   // damage reduction
    drSlash: /dr\s*\d+\/slashing/.test(t),
    drBludgeon: /dr\s*\d+\/bludgeoning/.test(t),
    immuneCold: /immune[^.]*cold/.test(t),
    immuneFire: /immune[^.]*fire/.test(t),
    resistFire: /resist[^.]*fire/.test(t),
    disease: /disease|filth fever|rot/.test(t),
    poison: /poison/.test(t),
    stench: /stench/.test(t),
    fear: /scare|shaken|fear|frighten/.test(t),
    pack: /pack|flank|swarm|numbers|comes in/.test(t),
    stealth: /stealth|ambush|hide|hidden/.test(t),
    darkvision: /darkvision|low-light|blindsight|tremorsense/.test(t),
    rage: /rage/.test(t),
    fly: /\bfly\b|flight/.test(t),
    routBoss: /rout|the pack (flees|routs)/.test(t),
    grab: /grab|grapple|constrict|coil|attach/.test(t),
    lightSensitive: /light[- ]sensitiv/.test(t),
    mindless: /mindless/.test(t),
  };
}

/** Derive the lore entry for one normalized monster. */
function deriveLore(m) {
  const { tough, frail } = toughFrail(m);
  const sp = scanSpecial(m.special);
  const strengths = [];
  const weaknesses = [];
  const undead = m.undead || m.subtypes.includes('undead');
  const caster = m.role === 'caster' || m.spells.length > 0;

  // ── STRENGTHS ──
  if (m.ac >= 16) strengths.push('heavily armored — hard to hit');
  else if (m.ac >= 14) strengths.push('well-armored');
  if (tough || m.hp >= 24) strengths.push('tough — soaks a lot of punishment');
  if (m.range >= 4) strengths.push(`strikes from far off (range ${m.range}) — it wants to keep its distance`);
  else if (m.range >= 2) strengths.push(`reach ${m.range} — it pokes before you can close`);
  if (m.speed >= 40) strengths.push('very fast — it will run you down');
  if (sp.dr) strengths.push(sp.drSlash ? 'shrugs off slashing blows (bludgeon it)'
    : sp.drBludgeon ? 'shrugs off blunt blows (cut it)' : 'has damage reduction — heavy hits fare best');
  if (sp.immuneCold) strengths.push('immune to cold');
  if (sp.immuneFire || sp.resistFire) strengths.push('resists fire');
  if (sp.disease) strengths.push('its bite carries disease');
  if (sp.poison) strengths.push('poisonous');
  if (sp.stench) strengths.push('a sickening stench weakens those who close in');
  if (sp.fear) strengths.push('can shake resolve with fear');
  if (sp.pack || m.swarm) strengths.push('fights in numbers — do not let it flank you');
  if (sp.stealth) strengths.push('ambusher — it strikes first from hiding');
  if (sp.rage) strengths.push('grows more dangerous as it is wounded (rage)');
  if (sp.grab) strengths.push('can grab and hold — it will pin a lone fighter');
  if (undead) strengths.push('undead — immune to fear, poison and disease');
  if (caster) strengths.push('a caster — it flings spells');
  if (m.boss) strengths.push('a boss — far above the rank and file');

  // ── WEAKNESSES ──
  if (frail || m.hp <= 6) weaknesses.push('fragile — it goes down to a couple of solid hits');
  if (m.ac <= 12) weaknesses.push('lightly armored — easy to hit');
  if (m.isRanged || m.range >= 4) weaknesses.push('weak in melee — close the distance and it folds');
  if (m.speed <= 20) weaknesses.push('slow — you can kite it');
  if (m.telegraph) weaknesses.push('telegraphs a big hit — brace or interrupt it on the wind-up');
  if (caster) weaknesses.push('disrupt its casting — rush or interrupt it and the spells stop');
  if (sp.routBoss || m.boss) weaknesses.push('kill the leader and the pack breaks');
  if (sp.immuneCold) weaknesses.push('vulnerable to fire');
  if (sp.immuneFire) weaknesses.push('vulnerable to cold');
  if (sp.lightSensitive) weaknesses.push('light-sensitive — bright light blinds it');
  if (sp.mindless) weaknesses.push('mindless — no tactics, it just advances');
  if (m.severable) weaknesses.push('severable — one clean hit at 0 HP ends it, no bleed-out');

  // ── TACTICS (one-line synthesis) ──
  let tactics;
  if (m.boss || m.cr >= 6) tactics = 'A serious threat — gang up, gate it with bodies, and hit it together on the same round.';
  else if (m.isRanged || m.range >= 4) tactics = 'Rush it. It hurts at range but crumbles once you are in its face.';
  else if (m.telegraph) tactics = 'Watch for the wind-up, brace or step out of the big hit, then punish the recovery.';
  else if (caster) tactics = 'Close fast and keep pressure on so it never gets a clean spell off.';
  else if (m.swarm || sp.pack) tactics = 'Do not get surrounded — fight in a doorway or corner so only one can reach you.';
  else if (frail || m.hp <= 6) tactics = 'Hit it hard and fast — it has no staying power.';
  else if (m.ac >= 16) tactics = 'Hard to hit — keep swinging, and use your best-to-hit attacks.';
  else tactics = 'A straight fight — trade blows and out-last it.';

  return {
    name: m.name, cr: m.cr,
    strengths: strengths.length ? strengths : ['nothing special — a plain foe'],
    weaknesses: weaknesses.length ? weaknesses : ['no glaring weakness — fight it straight'],
    tactics,
  };
}

// ── iconic flavor overlay (adds a nemesis line; NEVER edits the bestiary) ────────────────────────
const FLAVOR_OVERRIDES = {
  rat:            'They breed faster than you can kill them — but each one is nothing. Volume, not danger.',
  troll:          'It regenerates; only fire or acid keeps it down. Burn the corpse or it rises again.',
  ogre:           'One great swing can fell a pawn — bait the club, dodge, then swarm the recovery.',
  kraken_tentacle:'Sever the arms one by one; each is anchored and cannot chase you across the deck.',
  kraken_eye:     'Blind the eye or lop off every arm to end the beast — it will not move to you.',
  wolf:           'Wolves trip and flank. Put your back to a wall and never fight them in the open.',
  shark:          'Blood in the water sends it into a frenzy — do not fight it wounded and bleeding.',
};

export const BESTIARY_LORE = Object.freeze(
  Object.fromEntries(Object.values(ROSTER).map((m) => {
    const lore = deriveLore(m);
    if (FLAVOR_OVERRIDES[m.id]) lore.tactics = FLAVOR_OVERRIDES[m.id] + ' ' + lore.tactics;
    return [m.id, Object.freeze(lore)];
  }))
);

/** Strengths/weaknesses/tactics for a monster id (null for an unknown id). */
export function loreFor(monsterId) { return BESTIARY_LORE[monsterId] || null; }

/** Every id with a lore entry. */
export function allLoreIds() { return Object.keys(BESTIARY_LORE); }
