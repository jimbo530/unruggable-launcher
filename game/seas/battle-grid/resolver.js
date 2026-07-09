// @ts-check
/**
 * resolver.js — THE SINGLE SOURCE OF COMBAT TRUTH (pure, headless, deterministic).
 *
 * WHY THIS EXISTS (seas combat-settlement model, see project_seas_combat_settlement):
 *   The server is the referee, the client is the screen. A fight is fully
 *   DETERMINISTIC from `seed + actions`. The browser plays it; the seas-server
 *   REPLAYS this exact module with the same seed + action log and independently
 *   recomputes the outcome. A win only settles if the server's replay agrees.
 *   "Trust the client's win" is exploitable — this makes a faked win impossible
 *   (server recomputes) and grinding the RNG impossible (server issues the seed).
 *
 * HARD CONTRACT (do not break any of these — the whole security model rests on them):
 *   • NO DOM, NO globals, NO `window`/`document`/`localStorage`.
 *   • NO `Date.now()`, NO `Math.random()`. ALL entropy comes from the passed `seed`
 *     via a seeded PRNG. Same {seed, teams, actions} → byte-identical output, always.
 *   • NO silent catches. An illegal/desynced action THROWS loudly (the server treats
 *     a throw as "reject this fight log") — we never silently skip or fudge.
 *
 * CANONICAL ADAPTATION (this tree, vs the simpler stale prototype):
 *   The canonical battle-grid never calls the raw engine directly — every swing + spell
 *   flows through the combat-helpers.js CHOKEPOINT (`strike()` / `castWrapped()`), which
 *   layers weapon-dice (combat-ext) and per-weapon crit RANGES on top of the verbatim
 *   tot-engine math. So THIS resolver delegates to that SAME chokepoint (threading the
 *   SEEDED rng through it) — making the resolver byte-identical to what the live game
 *   rolls, weapon dice + crit ranges included. game.js calls these same per-action
 *   resolvers / the same chokepoint with the same seeded rng → parity by construction.
 */

import {
  rollD20, hexDistance, hexNeighbors, hexesInRange,
  isConscious, isAlive, isUnconscious, isDead,
} from "./tot-engine.js";
import { strike, castWrapped, planIntent, chooseTarget, resolveOverboard } from "./combat-helpers.js";
import { coverACAt, blockedKeys, tileEntryEffect } from "./terrain-effects.js";
import { losClear } from "./los.js";
// SHARED effects (AoE shapes + conditions): identical rules/rng-order on client + server.
import { aoeSecondaryTargets, tickConditions, tryApplyOnHit, resolveControl } from "./effects.js";
// GRID-CONFIG SHADOW (grid-config.js): the squad board is 16×9, but tot-engine's hexesInRange/
// hexNeighbors are FROZEN at the verbatim 9×7. game.js runs multi-pawn fights by importing the
// grid-reading fns from grid-config (a byte-for-byte copy that reads a MUTABLE GRID) + calling
// setGrid(). resolveEncounter MUST do the same or rats spawned past column 9 can't move (no
// neighbors in-bounds). resolveFight (the duel per-action path) keeps tot-engine's 9×7 untouched.
import { hexesInRange as gridHexesInRange, setGrid } from "./grid-config.js";

// ── Seeded PRNG ─────────────────────────────────────────────────────────────────
/**
 * Hash an arbitrary seed (number OR string — the server will issue a string seed
 * like a fight nonce / signature digest) into a uint32 for the PRNG. Deterministic.
 * @param {number|string} seed
 * @returns {number} uint32
 */
function hashSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed);
  // xfnv1a-style string hash → uint32 (deterministic across V8 in browser & Node).
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0);
}

/**
 * mulberry32 PRNG — tiny, fast, well-distributed, 100% deterministic. Returns a
 * function producing floats in [0,1). Used everywhere Math.random would have been.
 * @param {number} a uint32 state
 */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a deterministic rng from a seed. Pass the SAME seed → SAME sequence.
 * @param {number|string} seed
 * @returns {() => number} a Math.random-shaped function
 */
export function makeRng(seed) {
  return mulberry32(hashSeed(seed));
}

// Exported so callers (e.g. the bilge encounter builder, on BOTH client + server) can map a
// server-issued STRING seed → the SAME uint32 a numeric-seeded roller (area-encounters' mulberry32)
// needs — keeping the rat COMPOSITION deterministic from the one seed, not a second source.
export { hashSeed };

// ── Pure clone (no input mutation → repeatable replays) ──────────────────────────
/**
 * Deep-clone plain combat data (units/teams). Units are plain JSON-shaped objects
 * (no functions/Dates), so structuredClone (Node 17+/modern browsers) is ideal with
 * a JSON fallback. We clone so resolveFight never mutates the caller's input — that
 * is what lets the same input be replayed identically any number of times.
 * @template T @param {T} v @returns {T}
 */
function deepClone(v) {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

const key = (h) => `${h.q},${h.r}`;

// ── Win / death evaluation (single source — game.js checkWin mirrors this) ────────
/**
 * Evaluate the fight outcome from the current units. Uses ToT consciousness rules
 * (currentHp > 0 = up; <= 0 = down/out of the fight). A side is "alive" if it has at
 * least one CONSCIOUS unit.
 * @param {any[]} units
 * @returns {{ over: boolean, winner: 'player'|'enemy'|'draw'|null, label: string }}
 */
export function evaluateOutcome(units) {
  const sides = new Set(units.filter((u) => isConscious(u)).map((u) => !!u.isPlayer));
  if (sides.size > 1) return { over: false, winner: null, label: "" };
  if (sides.size === 0) return { over: true, winner: "draw", label: "DRAW" };
  const playerWon = sides.has(true);
  return {
    over: true,
    winner: playerWon ? "player" : "enemy",
    label: playerWon ? "PLAYER WINS" : "ENEMY WINS",
  };
}

// ── Damage application (headless replay layer) ────────────────────────────────────
/**
 * Apply HP damage to a unit (mutates the unit's currentHp). Returns whether the hit
 * knocked the unit out of the fight (was conscious, now isn't).
 *
 * NOTE: the LIVE game (game.js) has a RICHER applyDamage (severable/no-bleed kraken
 * arms, bleed-out, gear-drop loot). That belongs to the interactive game layer; this
 * headless version owns only the HP + consciousness math the server-replay needs.
 * @param {any} unit @param {number} dmg
 * @returns {{ downed: boolean }}
 */
export function applyDamage(unit, dmg) {
  const wasUp = isConscious(unit);
  unit.currentHp -= dmg;
  return { downed: wasUp && !isConscious(unit) };
}

/** Apply healing (mutates currentHp, capped at maxHp). @returns {{ healed:number }} */
export function applyHealing(unit, amount) {
  const before = unit.currentHp;
  unit.currentHp = Math.min(unit.maxHp, unit.currentHp + amount);
  return { healed: unit.currentHp - before };
}

// ── Action resolvers (the SHARED codepath: game.js + resolveFight both call these) ─
// Each returns a structured, DOM-free log entry. game.js renders entry.text; the
// server inspects the structured fields. The rng is consumed here in a fixed order
// by delegating to the chokepoint (strike / castWrapped) — the SAME path the live
// game uses, so the rolls are byte-identical.

function findUnit(units, id, role) {
  const u = units.find((x) => x.id === id);
  if (!u) throw new Error(`resolver: ${role} unit "${id}" not found in fight`);
  return u;
}

/**
 * MOVE a unit to a hex. Validates the hex is in movement range and unoccupied — an
 * out-of-range/occupied move THROWS (anti-cheat: the server rejects an impossible log).
 * No rng consumed. Mutates unit.position + unit.hasMoved.
 * @returns {{ type:'move', unit:string, to:{q:number,r:number}, text:string }}
 */
export function resolveMove(units, unitId, to) {
  const u = findUnit(units, unitId, "moving");
  if (!isConscious(u)) throw new Error(`resolver: ${unitId} cannot move while down`);
  const occupied = new Set(units.filter((x) => isAlive(x) && x !== u).map((x) => key(x.position)));
  const reach = new Set(hexesInRange(u.position, u.movementHexes, occupied).map(key));
  if (!reach.has(key(to))) {
    throw new Error(`resolver: ${unitId} cannot reach (${to.q},${to.r}) — out of move range or occupied`);
  }
  u.position = { q: to.q, r: to.r };
  u.hasMoved = true;
  return { type: "move", unit: unitId, to: { q: to.q, r: to.r }, text: `${u.name} moves to (${to.q},${to.r}).` };
}

/**
 * ATTACK: resolve via the canonical chokepoint `strike()` (which draws ONE d20 from the
 * SEEDED rng, delegates hit/AC/crit/buff to the verbatim engine, layers weapon dice +
 * per-weapon crit ranges), then apply damage. Validates the target is a living enemy
 * within attack range (else THROW). rng draws: the d20 (+ a weapon die, if the attacker
 * carries a dice weapon) — exactly what the live game draws.
 * @returns {{ type:'attack', unit:string, target:string, hit:boolean, damage:number, natural:number, crit:boolean, downed:boolean, breakdown:string, text:string }}
 */
export function resolveAttackAction(units, attackerId, targetId, rng) {
  const a = findUnit(units, attackerId, "attacker");
  const t = findUnit(units, targetId, "target");
  if (!isConscious(a)) throw new Error(`resolver: ${attackerId} cannot attack while down`);
  if (!isAlive(t)) throw new Error(`resolver: target ${targetId} is already dead`);
  if (a.isPlayer === t.isPlayer) throw new Error(`resolver: ${attackerId} cannot attack ally ${targetId}`);
  const dist = hexDistance(a.position, t.position);
  if (dist > a.attackRange) {
    throw new Error(`resolver: ${attackerId}→${targetId} out of range (${dist} > ${a.attackRange})`);
  }
  const res = strike(a, t, { distance: dist, rng });
  let downed = false;
  if (res.hit) downed = applyDamage(t, res.damage).downed;
  return {
    type: "attack", unit: attackerId, target: targetId,
    hit: !!res.hit, damage: res.hit ? res.damage : 0, natural: res.nat, crit: !!res.crit, downed,
    breakdown: res.breakdown,
    text: `${a.name} strikes ${t.name}: ${res.breakdown}` + (downed ? ` ${t.name} falls! (${t.currentHp} HP)` : ""),
  };
}

/**
 * SPELL: resolve via the canonical chokepoint `castWrapped()` (→ verbatim resolveSpellCast,
 * which draws the save roll THEN the damage/heal dice from the SEEDED rng, in that fixed
 * order), then apply the result. Validates target in spell range (else THROW). Supports the
 * v1 spell set (damage / healing / buff). Buff effects attach to the target's activeEffects.
 *
 * NOTE: single-target only. The live game's AoE hexArea SPLASH is a game-layer
 * multi-application (game.js castSpellAt) layered ON TOP of this chokepoint and is out of
 * scope for the headless per-action resolver (server replay / AoE is a later step).
 * @param {any} spell  a SPELLS entry { id, name, level, battle }
 * @returns {object} structured entry incl. damage|healing|effect + text
 */
export function resolveSpellAction(units, casterId, targetId, spell, rng) {
  if (!spell || !spell.battle) throw new Error(`resolver: unknown/invalid spell for ${casterId}`);
  const c = findUnit(units, casterId, "caster");
  const t = findUnit(units, targetId, "spell target");
  if (!isConscious(c)) throw new Error(`resolver: ${casterId} cannot cast while down`);
  const range = spell.battle.hexRange ?? 1;
  const dist = hexDistance(c.position, t.position);
  if (dist > range) {
    throw new Error(`resolver: ${casterId} cast ${spell.id} out of range (${dist} > ${range})`);
  }
  const res = castWrapped(c, t, spell, false, rng);

  const entry = {
    type: "spell", unit: casterId, target: targetId, spell: spell.id,
    damage: 0, healing: 0, downed: false, breakdown: res.breakdown,
    text: `${c.name} casts ${spell.name} at ${t.name}: ${res.breakdown}`,
  };
  if (res.damage) {
    entry.damage = res.damage;
    entry.downed = applyDamage(t, res.damage).downed;
    if (entry.downed) entry.text += ` ${t.name} falls! (${t.currentHp} HP)`;
  } else if (res.healing) {
    entry.healing = applyHealing(t, res.healing).healed;
  } else if (res.effect) {
    t.activeEffects = t.activeEffects || [];
    t.activeEffects.push(res.effect);
  }
  return entry;
}

// ── The headless fight (server replay + client-side determinism) ──────────────────
/**
 * @typedef {Object} FightAction
 * @property {string} unit                       acting unit id
 * @property {'move'|'attack'|'spell'|'end'} type
 * @property {string} [target]                    target unit id (attack/spell)
 * @property {{q:number,r:number}} [to]           destination hex (move)
 * @property {string} [spell]                     spell id (spell) — resolved via spellbook
 */

/**
 * Replay a full fight DETERMINISTICALLY from a seed + an ordered action log. This is
 * exactly what the seas-server runs to verify a claimed win, and what the client can
 * run to predict/preview. Same {seed, playerTeam, enemyTeam, actions} → same result.
 *
 * Input teams are DEEP-CLONED (never mutated), so the same input replays identically
 * any number of times. Actions are validated and executed in order; once a side has
 * won, remaining actions are IGNORED (the fight is over) — they are not errors.
 *
 * @param {{
 *   seed: number|string,
 *   playerTeam: any[],
 *   enemyTeam: any[],
 *   actions: FightAction[],
 *   spellbook?: Record<string, any>,   // spell id → { id,name,level,battle }
 * }} input
 * @returns {{ winner:'player'|'enemy'|'draw'|null, log:object[], finalState:{ units:any[], over:boolean, winner:string|null, actionsApplied:number } }}
 */
export function resolveFight(input) {
  if (!input || typeof input !== "object") throw new Error("resolver.resolveFight: input object required");
  const { seed, playerTeam, enemyTeam, actions } = input;
  if (seed === undefined || seed === null) throw new Error("resolver.resolveFight: a seed is required (deterministic)");
  if (!Array.isArray(playerTeam) || !Array.isArray(enemyTeam)) {
    throw new Error("resolver.resolveFight: playerTeam and enemyTeam must be arrays");
  }
  if (!Array.isArray(actions)) throw new Error("resolver.resolveFight: actions must be an array");

  // Spellbook: caller may inject the spell registry; otherwise spell actions fail loudly
  // (we never guess a spell). Callers using the default ToT spells pass { spellbook: SPELLS }.
  const spellbook = input.spellbook || null;

  const rng = makeRng(seed);
  // Clone + tag side so we never mutate caller input and isPlayer is authoritative.
  const units = [
    ...deepClone(playerTeam).map((u) => ({ ...u, isPlayer: true })),
    ...deepClone(enemyTeam).map((u) => ({ ...u, isPlayer: false })),
  ];
  // Guard against duplicate ids (would make findUnit ambiguous → silent mis-targeting).
  const ids = new Set();
  for (const u of units) {
    if (ids.has(u.id)) throw new Error(`resolver.resolveFight: duplicate unit id "${u.id}"`);
    ids.add(u.id);
  }

  const log = [];
  let outcome = evaluateOutcome(units);
  let actionsApplied = 0;

  for (const act of actions) {
    if (outcome.over) break; // fight decided — ignore trailing actions
    if (!act || typeof act !== "object" || typeof act.type !== "string") {
      throw new Error(`resolver.resolveFight: malformed action at index ${actionsApplied}`);
    }
    switch (act.type) {
      case "move":
        log.push(resolveMove(units, act.unit, requireHex(act.to, actionsApplied)));
        break;
      case "attack":
        log.push(resolveAttackAction(units, act.unit, requireTarget(act.target, actionsApplied), rng));
        break;
      case "spell": {
        const spell = resolveSpell(spellbook, act.spell, actionsApplied);
        log.push(resolveSpellAction(units, act.unit, requireTarget(act.target, actionsApplied), spell, rng));
        break;
      }
      case "end":
        log.push({ type: "end", unit: act.unit, text: `${act.unit} ends turn.` });
        break;
      default:
        throw new Error(`resolver.resolveFight: unknown action type "${act.type}" at index ${actionsApplied}`);
    }
    actionsApplied++;
    outcome = evaluateOutcome(units);
  }

  return {
    winner: outcome.winner,
    log,
    finalState: { units, over: outcome.over, winner: outcome.winner, actionsApplied },
  };
}

function requireHex(to, idx) {
  if (!to || typeof to.q !== "number" || typeof to.r !== "number") {
    throw new Error(`resolver.resolveFight: move action at index ${idx} needs a {q,r} hex`);
  }
  return to;
}
function requireTarget(target, idx) {
  if (typeof target !== "string" || !target) {
    throw new Error(`resolver.resolveFight: action at index ${idx} needs a target unit id`);
  }
  return target;
}
function resolveSpell(spellbook, spellId, idx) {
  if (typeof spellId !== "string" || !spellId) {
    throw new Error(`resolver.resolveFight: spell action at index ${idx} needs a spell id`);
  }
  if (spellbook) {
    const s = spellbook[spellId];
    if (!s) throw new Error(`resolver.resolveFight: spell "${spellId}" not in provided spellbook`);
    return s;
  }
  // No injected spellbook — fail loudly rather than guess.
  throw new Error(`resolver.resolveFight: spell action used but no spellbook provided (pass { spellbook })`);
}

// Re-export the pure helpers callers commonly need alongside the resolver, so the
// browser + server import ONE module for the whole combat-truth surface.
export { rollD20, isConscious, isAlive, hexDistance, hexNeighbors, hexesInRange };

// ════════════════════════════════════════════════════════════════════════════════════════════
// resolveEncounter — the TURN-SEQUENCED, AI-DRIVEN, terrain-aware fight (the bilge-rats model).
//
// resolveFight (above) replays a FLAT log of EVERY action (player AND enemy). That trusts the
// client to report the enemy's moves — exploitable (a cheater makes the enemy whiff/wander).
// resolveEncounter is the HARDENED model for a STAKES fight (project_seas_combat_settlement):
//
//   • It runs the SAME turn loop as the live game (game.js): units in array order, the player
//     side first; turnIdx cycles; a wrap bumps the round; downed units bleed toward −10 and skip.
//   • PLAYER turns CONSUME the submitted `playerActions` (move/attack/spell/end), enforcing the
//     real action economy (≤1 move + ≤1 act per turn) — a tampered/over-long turn THROWS.
//   • ENEMY turns are RE-COMPUTED here by the SAME shared squad AI the client uses
//     (combat-helpers planIntent → move → chooseTarget → strike/cast). The enemy's choices are
//     NOT taken from the client — the server derives them from the seed + board, exactly as the
//     client did. So a replay needs only { seed, playerActions }; the rats are recomputed.
//   • ALL dice come from ONE seeded rng consumed in the SAME ORDER as the client (player turn,
//     then each enemy by index; within a turn: move-entry overboard save, then the strike/cast),
//     so the server's winner is byte-identical to a legitimate client fight (proven by the test).
//
// PARITY BOUNDARY (honest):
//   - Enemy units are expected to be GEAR-FREE monsters (bilge rats), so their move range is
//     `movementHexes` (no encumbrance) — matching game.js encMove() for an unencumbered unit.
//     A geared enemy (a raider) would need encMove() here for exact reach parity (flagged TODO).
//   - PLAYER move-range validation unions WALLS (blockedKeys) but uses base movementHexes, not
//     encMove() — a heavily-encumbered player could squeak one hex past. Closes wall-walking;
//     encumbrance-exact player reach is a hardening TODO (doesn't affect the bilge first fight).
//   - severable / no-bleed (kraken/undead) HP nuance isn't modeled here (same as applyDamage's
//     note) — it only changes the gear-drop clock, never the WINNER (a ≤0 unit is non-conscious
//     either way), so the verified outcome is unaffected.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** Build a "q,r"→cell terrain index from an array of cells (or pass through an existing Map). */
function buildTerrainIx(terrain) {
  if (terrain instanceof Map) return terrain;
  const ix = new Map();
  if (Array.isArray(terrain)) for (const c of terrain) {
    if (c && Number.isFinite(c.q) && Number.isFinite(c.r)) ix.set(`${c.q},${c.r}`, c);
  }
  return ix;
}

/** Furthest hex a unit can affect (mirrors game.js actReach): attackRange, or a caster's longest
 *  in-kit spell range. Needs the spellbook to read spell ranges (rats have none → attackRange). */
function actReachFor(u, spellbook) {
  let r = u.attackRange || 1;
  if (u.role === "caster" && Array.isArray(u.availableSpells) && spellbook)
    for (const sid of u.availableSpells) { const sp = spellbook[sid]; if (sp && sp.battle) r = Math.max(r, sp.battle.hexRange ?? 1); }
  return r;
}

/** Largest hexArea among a caster's DAMAGE spells (mirrors game.js bestSpellArea); 0 for rats. */
function bestSpellAreaFor(u, spellbook) {
  if (u.role !== "caster" || !Array.isArray(u.availableSpells) || !spellbook) return 0;
  let area = 0;
  for (const sid of u.availableSpells) {
    const sp = spellbook[sid];
    if (sp && sp.battle && sp.battle.type === "damage") area = Math.max(area, sp.battle.hexArea || 0);
  }
  return area;
}

/** Read-only AI board context (mirrors game.js aiCtx). Enemies are unencumbered monsters, so
 *  reach uses movementHexes (== game.js encMove for an unencumbered unit). Walls are solid. */
function aiContextFor(units, u, terrainIx, spellbook) {
  const foes = units.filter((e) => isConscious(e) && e.isPlayer !== u.isPlayer);
  const allies = units.filter((e) => isConscious(e) && e.isPlayer === u.isPlayer);
  const occ = (exclude) => {
    const s = new Set(units.filter((x) => isAlive(x) && x !== exclude).map((x) => key(x.position)));
    for (const k of blockedKeys(terrainIx)) s.add(k);
    return s;
  };
  return {
    foes, allies,
    reach: (unit) => gridHexesInRange(unit.position, unit.movementHexes, occ(unit)),
    dist: (a, b) => hexDistance(a, b),
    actRange: (unit) => actReachFor(unit, spellbook),
    meleeRange: (unit) => unit.attackRange || 1,
    ownCaster: allies.find((a) => a !== u && a.role === "caster") || null,
    aoeArea: (unit) => bestSpellAreaFor(unit, spellbook),
    hasLos: (fromHex, targetPos) => losClear(fromHex, targetPos, terrainIx),
  };
}

const samePos = (a, b) => a && b && a.q === b.q && a.r === b.r;

/** TERRAIN ON-ENTER (mirrors game.js applyTileEntry): a HAZARD stings (no rng); a WATER-EDGE forces
 *  a DEX reflex save (resolveOverboard draws ONE d20 from the SAME seeded rng — load-bearing draw
 *  order). Cover/wall/difficult trigger nothing. No terrain → no-op (zero draws). */
function applyTileEntryR(u, terrainIx, rng, log) {
  if (!u || !isConscious(u) || !terrainIx || terrainIx.size === 0) return;
  const fx = tileEntryEffect(terrainIx, u.position);
  if (!fx) return;
  if (fx.type === "water-edge") {
    const save = resolveOverboard(u, { dc: fx.dc, rng });   // draws a d20 — must match game.js order
    if (save.fell) {
      log.push({ type: "overboard", unit: u.id, fell: true, total: save.total, dc: save.dc, dmg: fx.dmg,
        text: `${u.name} loses footing at ${fx.label} — OVERBOARD! (Reflex ${save.total} vs DC ${save.dc}) −${fx.dmg}` });
      if (fx.dmg > 0) applyDamage(u, fx.dmg);
    } else {
      log.push({ type: "overboard", unit: u.id, fell: false, total: save.total, dc: save.dc,
        text: `${u.name} steadies at ${fx.label}. (Reflex ${save.total} vs DC ${save.dc})` });
    }
    return;
  }
  // HAZARD: optional status + small on-enter damage (no rng).
  if (fx.status) { u.activeEffects = u.activeEffects || []; u.activeEffects.push({ ...fx.status }); }
  if (fx.dmg > 0) {
    log.push({ type: "hazard", unit: u.id, dmg: fx.dmg, text: `${u.name} stumbles through ${fx.label} — ${fx.dmg} dmg.` });
    applyDamage(u, fx.dmg);
  }
}

/** A spell cast WITH AoE splash (mirrors game.js castSpellAt): primary cast then, for a DAMAGE
 *  spell with hexArea, splash every other foe within the area — each splash draws its own save/dice
 *  from the seeded rng, in board order, exactly like the client. */
function castAtR(units, caster, spell, target, rng, terrainIx, log) {
  const res = castWrapped(caster, target, spell, false, rng);
  const entry = { type: "spell", unit: caster.id, target: target.id, spell: spell.id, breakdown: res.breakdown,
    text: `${caster.name} casts ${spell.name} at ${target.name}: ${res.breakdown}` };
  if (res.damage) {
    entry.damage = res.damage; applyDamage(target, res.damage);
    log.push(entry);
    // SHARED AoE (radius/cone/line): membership + victim ORDER come from effects.js so the
    // client's splash rolls and the server's replay consume rng identically.
    for (const u2 of aoeSecondaryTargets(spell, caster, target, units, isAlive)) {
      if (evaluateOutcome(units).over) break;
      const r2 = castWrapped(caster, u2, spell, false, rng);
      log.push({ type: "spell-splash", unit: caster.id, target: u2.id, spell: spell.id, damage: r2.damage || 0,
        breakdown: r2.breakdown, text: `  ↳ ${spell.name} splash hits ${u2.name}: ${r2.breakdown}` });
      if (r2.damage) applyDamage(u2, r2.damage);
    }
  } else if (spell.battle && spell.battle.type === "control") {
    const ctl = resolveControl(caster, target, spell, rng);
    log.push({ type: "spell-control", unit: caster.id, target: target.id, spell: spell.id,
      stunned: !!(ctl && ctl.stunned), text: ctl ? ctl.text : entry.text });
  } else if (res.healing) {
    entry.healing = applyHealing(target, res.healing).healed; log.push(entry);
  } else if (res.effect) {
    target.activeEffects = target.activeEffects || []; target.activeEffects.push(res.effect); log.push(entry);
  } else { log.push(entry); }
}

/** Re-compute and execute ONE enemy unit's turn (mirrors game.js aiTurn + aiAct): plan → move
 *  (+ tile entry) → re-validate target → strike or cast. The decision uses the SHARED planIntent /
 *  chooseTarget; the dice use the seeded rng — identical to the client. */
function runEnemyTurn(units, u, rng, terrainIx, spellbook, log) {
  const ctx = aiContextFor(units, u, terrainIx, spellbook);
  const intent = planIntent(u, ctx);
  // 1) MOVE along the plan, then resolve tile-entry (hazard/overboard).
  if (intent && intent.moveTo && !samePos(intent.moveTo, u.position) && !u.hasMoved) {
    u.position = { q: intent.moveTo.q, r: intent.moveTo.r };
    u.hasMoved = true;
    log.push({ type: "move", unit: u.id, to: { ...u.position }, text: `${u.name} advances to (${u.position.q},${u.position.r}).` });
    applyTileEntryR(u, terrainIx, rng, log);
  }
  if (!isConscious(u)) return;   // downed by a hazard/overboard on entry → no strike (game.js guard)
  // 2) re-validate the target (the planned foe may have fallen) then ACT.
  const foes = units.filter((e) => isConscious(e) && e.isPlayer !== u.isPlayer);
  let target = intent && intent.target && isConscious(intent.target) ? intent.target : chooseTarget(u, foes);
  if (!target) return;
  if (u.hasActed) return;
  const dist = hexDistance(u.position, target.position);
  const losOk = dist <= 1 || losClear(u.position, target.position, terrainIx);
  // caster: first DAMAGE spell whose range reaches the target
  if (u.role === "caster" && Array.isArray(u.availableSpells) && spellbook) {
    for (const sid of u.availableSpells) {
      const sp = spellbook[sid]; if (!sp || !sp.battle || sp.battle.type !== "damage") continue;
      if (losOk && dist <= (sp.battle.hexRange ?? 1)) { castAtR(units, u, sp, target, rng, terrainIx, log); u.hasActed = true; return; }
    }
  }
  // weapon strike if in range (chokepoint: cover + LOS + rng)
  if (dist <= (u.attackRange || 1) && losOk) {
    const res = strike(u, target, { distance: dist, coverAC: coverACAt(terrainIx, target.position), terrainIx, rng });
    let downed = false; if (res.hit) downed = applyDamage(target, res.damage).downed;
    log.push({ type: "attack", unit: u.id, target: target.id, hit: !!res.hit, damage: res.hit ? res.damage : 0,
      natural: res.nat, crit: !!res.crit, downed, breakdown: res.breakdown,
      text: `${u.name} strikes ${target.name}: ${res.breakdown}` });
    // on-hit rider (spider venom & kin) — SHARED rule, same rng point as game.js
    if (res.hit && isAlive(target)) {
      const rider = tryApplyOnHit(u, target, rng);
      if (rider) log.push({ type: "on-hit", unit: u.id, target: target.id, applied: rider.applied, text: rider.text });
    }
    u.hasActed = true;
  }
}

/** Validate + apply ONE player action (move/attack/spell), enforcing the action economy. THROWS on a
 *  tampered/illegal action (the server rejects the whole log) — never a silent skip. */
function applyPlayerAction(units, u, act, idx, rng, terrainIx, spellbook, log) {
  if (act.type === "move") {
    if (u.hasMoved) throw new Error(`resolver.resolveEncounter: ${u.id} already moved this turn (action ${idx})`);
    const to = requireHex(act.to, idx);
    const occupied = new Set(units.filter((x) => isAlive(x) && x !== u).map((x) => key(x.position)));
    for (const k of blockedKeys(terrainIx)) occupied.add(k);   // walls are solid (no wall-walking)
    const reach = new Set(gridHexesInRange(u.position, u.movementHexes, occupied).map(key));
    if (!reach.has(key(to))) throw new Error(`resolver.resolveEncounter: ${u.id} cannot reach (${to.q},${to.r}) (action ${idx})`);
    u.position = { q: to.q, r: to.r }; u.hasMoved = true;
    log.push({ type: "move", unit: u.id, to: { q: to.q, r: to.r }, text: `${u.name} moves to (${to.q},${to.r}).` });
    applyTileEntryR(u, terrainIx, rng, log);
    return;
  }
  if (act.type === "attack") {
    if (u.hasActed) throw new Error(`resolver.resolveEncounter: ${u.id} already acted this turn (action ${idx})`);
    const t = findUnit(units, requireTarget(act.target, idx), "target");
    if (!isAlive(t)) throw new Error(`resolver.resolveEncounter: target ${t.id} already dead (action ${idx})`);
    if (u.isPlayer === t.isPlayer) throw new Error(`resolver.resolveEncounter: ${u.id} cannot attack ally ${t.id} (action ${idx})`);
    const dist = hexDistance(u.position, t.position);
    if (dist > (u.attackRange || 1)) throw new Error(`resolver.resolveEncounter: ${u.id}→${t.id} out of range ${dist} (action ${idx})`);
    if (dist >= 2 && !losClear(u.position, t.position, terrainIx)) throw new Error(`resolver.resolveEncounter: ${u.id}→${t.id} no line of sight (action ${idx})`);
    const res = strike(u, t, { distance: dist, coverAC: coverACAt(terrainIx, t.position), terrainIx, rng });
    let downed = false; if (res.hit) downed = applyDamage(t, res.damage).downed;
    log.push({ type: "attack", unit: u.id, target: t.id, hit: !!res.hit, damage: res.hit ? res.damage : 0,
      natural: res.nat, crit: !!res.crit, downed, breakdown: res.breakdown,
      text: `${u.name} strikes ${t.name}: ${res.breakdown}` });
    // on-hit rider (player pawns normally carry none; uniform rule, same rng point)
    if (res.hit && isAlive(t)) {
      const rider = tryApplyOnHit(u, t, rng);
      if (rider) log.push({ type: "on-hit", unit: u.id, target: t.id, applied: rider.applied, text: rider.text });
    }
    u.hasActed = true;
    return;
  }
  if (act.type === "spell") {
    if (u.hasActed) throw new Error(`resolver.resolveEncounter: ${u.id} already acted this turn (action ${idx})`);
    const spell = resolveSpell(spellbook, act.spell, idx);
    const t = findUnit(units, requireTarget(act.target, idx), "spell target");
    const range = (spell.battle && spell.battle.hexRange) ?? 1;
    const dist = hexDistance(u.position, t.position);
    if (dist > range) throw new Error(`resolver.resolveEncounter: ${u.id} cast ${spell.id} out of range ${dist} (action ${idx})`);
    if (dist >= 2 && !losClear(u.position, t.position, terrainIx)) throw new Error(`resolver.resolveEncounter: ${u.id} cast ${spell.id} no line of sight (action ${idx})`);
    castAtR(units, u, spell, t, rng, terrainIx, log);
    u.hasActed = true;
    return;
  }
  throw new Error(`resolver.resolveEncounter: unknown player action type "${act.type}" (action ${idx})`);
}

/**
 * Replay a full STAKES encounter deterministically: player actions are taken from the submitted
 * log; enemy turns are re-computed by the shared AI; all dice come from the seed. Same
 * { seed, playerTeam, enemyTeam, playerActions } → same winner, in the browser AND on the server.
 *
 * Input is DEEP-CLONED (never mutated → repeatable replay). Each PLAYER turn in `playerActions`
 * MUST end with an { unit, type:'end' } action (the turn boundary); a turn that runs the list dry
 * without deciding the fight returns `exhausted:true` with the (likely undecided) outcome — the
 * keeper only ever pays on winner==='player', so an inconclusive log can never mint a payout.
 *
 * @param {{
 *   seed: number|string,
 *   playerTeam: any[],
 *   enemyTeam: any[],
 *   playerActions: Array<{unit:string,type:'move'|'attack'|'spell'|'end',target?:string,to?:{q:number,r:number},spell?:string}>,
 *   spellbook?: Record<string, any>,
 *   terrain?: Array<{q:number,r:number,type:string,mod?:object}> | Map<string,any>,
 *   maxRounds?: number,
 * }} input
 * @returns {{ winner:'player'|'enemy'|'draw'|null, log:object[], finalState:{ units:any[], over:boolean, winner:string|null, round:number, actionsConsumed:number, exhausted:boolean } }}
 */
export function resolveEncounter(input) {
  if (!input || typeof input !== "object") throw new Error("resolver.resolveEncounter: input object required");
  const { seed, playerTeam, enemyTeam } = input;
  if (seed === undefined || seed === null) throw new Error("resolver.resolveEncounter: a seed is required (deterministic)");
  if (!Array.isArray(playerTeam) || !Array.isArray(enemyTeam)) throw new Error("resolver.resolveEncounter: playerTeam and enemyTeam must be arrays");
  const playerActions = input.playerActions;
  if (!Array.isArray(playerActions)) throw new Error("resolver.resolveEncounter: playerActions must be an array");
  const spellbook = input.spellbook || null;
  const maxRounds = Number.isFinite(input.maxRounds) ? Math.max(1, Math.floor(input.maxRounds)) : 60;
  const terrainIx = buildTerrainIx(input.terrain);

  // BOARD SIZE: set the shared GRID this fight runs on (default the 16×9 squad deck, the bilge
  // board). This mutates a module-global (grid-config) — resolveEncounter is fully SYNCHRONOUS, so
  // a single fight never interleaves; concurrent callers must serialise (one fight at a time).
  const grid = (input.grid && Number.isFinite(input.grid.cols) && Number.isFinite(input.grid.rows))
    ? { cols: Math.floor(input.grid.cols), rows: Math.floor(input.grid.rows) }
    : { cols: 16, rows: 9 };
  setGrid(grid.cols, grid.rows);

  const rng = makeRng(seed);
  const units = [
    ...deepClone(playerTeam).map((u) => ({ ...u, isPlayer: true })),
    ...deepClone(enemyTeam).map((u) => ({ ...u, isPlayer: false })),
  ];
  const ids = new Set();
  for (const u of units) {
    if (ids.has(u.id)) throw new Error(`resolver.resolveEncounter: duplicate unit id "${u.id}"`);
    ids.add(u.id);
  }

  const log = [];
  let turnIdx = 0, round = 1, cursor = 0, exhausted = false;
  let outcome = evaluateOutcome(units);
  let guard = 0;
  const MAX_ITERS = units.length * (maxRounds + 2) + 16;

  while (!outcome.over && guard++ < MAX_ITERS) {
    const u = units[turnIdx];
    if (isConscious(u)) {
      // startTurn: reset the action economy + tick active spell effects (no rng).
      u.hasMoved = false; u.hasActed = false;
      u.activeEffects = (u.activeEffects || []).filter((e) => {
        if (e.remainingRounds === -1) return true;
        e.remainingRounds -= 1; return e.remainingRounds > 0;
      });
      // SHARED condition tick (poison save/dot, burn dot, stun skip) — same point + same
      // rng order as game.js startTurn. Damage lands through resolver applyDamage.
      {
        const tick = tickConditions(u, rng);
        for (const ev of tick.events) {
          if (ev.damage) applyDamage(u, ev.damage);
          log.push({ type: ev.kind, unit: u.id, damage: ev.damage || 0, text: ev.text });
        }
        if (tick.skip) { u.hasMoved = true; u.hasActed = true; }
        outcome = evaluateOutcome(units);
        if (outcome.over) break;
      }
      if (!isConscious(u)) { turnIdx = (turnIdx + 1) % units.length; if (turnIdx === 0) { round++; if (round > maxRounds) break; } continue; }
      if (u.isPlayer) {
        // consume this unit's submitted actions until (and including) its 'end' / a fatal result.
        let ranDry = true;
        while (cursor < playerActions.length) {
          const act = playerActions[cursor];
          if (!act || typeof act !== "object" || typeof act.type !== "string")
            throw new Error(`resolver.resolveEncounter: malformed player action at index ${cursor}`);
          if (act.unit !== u.id) { ranDry = false; break; }   // next action is another unit's turn
          cursor++;
          if (act.type === "end") { ranDry = false; break; }
          applyPlayerAction(units, u, act, cursor - 1, rng, terrainIx, spellbook, log);
          if (evaluateOutcome(units).over) { ranDry = false; break; }
        }
        if (ranDry) { exhausted = true; break; }   // log ended mid-fight → inconclusive (no win)
      } else {
        runEnemyTurn(units, u, rng, terrainIx, spellbook, log);
      }
      outcome = evaluateOutcome(units);
      if (outcome.over) break;
    } else if (isUnconscious(u)) {
      u.currentHp -= 1;   // bleed toward −10 (no rng; never changes the WINNER for the bilge fight)
      log.push({ type: "bleed", unit: u.id, hp: u.currentHp, text: `${u.name} is bleeding out… (${u.currentHp} HP)` });
      outcome = evaluateOutcome(units);
      if (outcome.over) break;
    }
    turnIdx = (turnIdx + 1) % units.length;
    if (turnIdx === 0) { round++; if (round > maxRounds) break; }
  }

  return {
    winner: outcome.winner,
    log,
    finalState: { units, over: outcome.over, winner: outcome.winner, round, actionsConsumed: cursor, exhausted },
  };
}
