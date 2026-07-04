// @ts-check
'use strict';
/**
 * play.js — the bot's HEADLESS COMBAT HAND. It plays a bilge-rats fight to a result and records the
 * player's action log, so fight.js can submit that log to the seas-server's /seas/verify-fight for
 * an AUTHORITATIVE verdict.
 *
 * THIS IS NOT A NEW ENGINE. It is a faithful CommonJS port of the PROVEN client simulation in
 * game/seas/battle-grid/resolver-encounter.test.js (the documented mirror of resolveEncounter): both
 * sides are AI-piloted through the SAME shared squad AI (combat-helpers planIntent → move → tile-entry
 * → chooseTarget → strike), off ONE seeded rng, in the SAME turn order + rng DRAW ORDER the server's
 * resolveEncounter uses. That test proves: feeding ONLY { seed, playerActions } back to
 * resolveEncounter — which RE-COMPUTES every rat turn itself — reproduces the SAME winner, the SAME
 * per-unit final HP, and the SAME dice breakdowns. So a local win here ⇒ a server-verified win there.
 *
 * The PLAYER is piloted by the game's OWN squad AI (planIntent/chooseTarget) — a real, competent
 * combatant, not a scripted win. We never fabricate a result; we play it and read the outcome.
 *
 * The battle-grid modules are ESM; this file is CommonJS, so we load them via dynamic import()
 * (the same pattern seas-server.js uses). REAL-OR-NOTHING: any load/parse failure throws loudly.
 */
const path = require('path');
const { pathToFileURL } = require('url');

const BG = path.join(__dirname, '..', '..', 'battle-grid');           // game/seas/battle-grid
const BILGE = path.join(__dirname, '..', '..', '..', 'lib', 'bilge-rats.js'); // game/lib/bilge-rats.js
const bgUrl = (f) => pathToFileURL(path.join(BG, f)).href;

let _c = null;
/** Load (once) the SAME combat-truth modules the live game + the server replay use. */
async function loadCombat() {
  if (_c) return _c;
  const [resolver, units, helpers, engine, gridcfg, terrain, los, bilge] = await Promise.all([
    import(bgUrl('resolver.js')),
    import(bgUrl('units.js')),
    import(bgUrl('combat-helpers.js')),
    import(bgUrl('tot-engine.js')),
    import(bgUrl('grid-config.js')),
    import(bgUrl('terrain-effects.js')),
    import(bgUrl('los.js')),
    import(pathToFileURL(BILGE).href),
  ]);
  if (typeof resolver.resolveEncounter !== 'function' || typeof units.buildUnit !== 'function' ||
      typeof bilge.buildBilgeEnemies !== 'function' || !units.SPELLS) {
    throw new Error('[play] combat modules did not export the expected API (resolveEncounter/buildUnit/buildBilgeEnemies/SPELLS)');
  }
  _c = { resolver, units, helpers, engine, gridcfg, terrain, los, bilge, SPELLS: units.SPELLS };
  return _c;
}

const key = (h) => `${h.q},${h.r}`;
const samePos = (a, b) => a && b && a.q === b.q && a.r === b.r;

/**
 * Build the bilge fight from a server-issued seed: the player pawn (a BattleUnit via the class-engine
 * bridge) + the rat squad RECONSTRUCTED from the seed (the SAME ids/hexes the server will rebuild) +
 * the bilge deck terrain. Sets the shared 16×9 squad grid (the bilge board) first.
 *
 * HONEST BOUNDARY: the player pawn here is built from an `endowment` (the class-engine input). Decoding
 * a REAL on-chain pawn's exact endowment/stats by crewId is the same TODO flagged in pawns.js — until
 * then the caller passes a representative endowment (the proof uses the strong demo leader {burgers:40}).
 *
 * @param {{ seed:string|number, endowment?:object, role?:string, position?:{q:number,r:number}, name?:string }} o
 */
async function buildBilgeFight(o) {
  const c = await loadCombat();
  if (o.seed === undefined || o.seed === null) throw new Error('[play] buildBilgeFight: seed required');
  c.gridcfg.setGrid(c.bilge.SQUAD_GRID.cols, c.bilge.SQUAD_GRID.rows);
  const position = o.position || { q: 1, r: 4 };
  const leader = c.units.buildUnit({
    id: 'LEADER', isPlayer: true, name: o.name || 'Captain', emoji: '🦜',
    endowment: o.endowment || { burgers: 40 }, role: o.role || 'melee', position,
  });
  const playerTeam = [leader];
  const enemyTeam = c.bilge.buildBilgeEnemies(o.seed, [position]);
  const terrain = c.bilge.bilgeTerrain();
  return { playerTeam, enemyTeam, terrain };
}

/**
 * PLAY the fight headlessly (both sides AI-piloted off the seeded rng) and record the player's actions.
 * Faithful port of resolver-encounter.test.js clientSim — same turn loop, same rng draw order.
 * @returns {{ winner:'player'|'enemy'|'draw'|null, playerActions:object[], units:object[], rounds:number }}
 */
async function playFight({ seed, playerTeam, enemyTeam, terrain, maxRounds = 60 }) {
  const c = await loadCombat();
  const { strike, planIntent, chooseTarget, resolveOverboard } = c.helpers;
  const { hexDistance, isConscious, isAlive, isUnconscious } = c.engine;
  const { coverACAt, blockedKeys, tileEntryEffect } = c.terrain;
  const { losClear } = c.los;
  const { hexesInRange } = c.gridcfg;        // 16×9 squad grid (NOT tot-engine's frozen 9×7)
  const { makeRng } = c.resolver;
  c.gridcfg.setGrid(c.bilge.SQUAD_GRID.cols, c.bilge.SQUAD_GRID.rows);

  const ix = new Map((terrain || []).map((cell) => [key(cell), cell]));
  const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  const rng = makeRng(seed);
  const units = [
    ...clone(playerTeam).map((u) => ({ ...u, isPlayer: true })),
    ...clone(enemyTeam).map((u) => ({ ...u, isPlayer: false })),
  ];
  const decided = () => new Set(units.filter(isConscious).map((u) => !!u.isPlayer)).size <= 1;

  const aiCtx = (u) => {
    const foes = units.filter((e) => isConscious(e) && e.isPlayer !== u.isPlayer);
    const allies = units.filter((e) => isConscious(e) && e.isPlayer === u.isPlayer);
    const occ = (ex) => { const s = new Set(units.filter((x) => isAlive(x) && x !== ex).map((x) => key(x.position))); for (const k of blockedKeys(ix)) s.add(k); return s; };
    return {
      foes, allies,
      reach: (unit) => hexesInRange(unit.position, unit.movementHexes, occ(unit)),
      dist: (a, b) => hexDistance(a, b),
      actRange: (unit) => unit.attackRange || 1,
      meleeRange: (unit) => unit.attackRange || 1,
      ownCaster: allies.find((a) => a !== u && a.role === 'caster') || null,
      aoeArea: () => 0,
      hasLos: (f, t) => losClear(f, t, ix),
    };
  };
  const applyDmg = (t, d) => { t.currentHp -= d; };
  const tileEntry = (u) => {
    if (!isConscious(u) || !ix || ix.size === 0) return;
    const fx = tileEntryEffect(ix, u.position);
    if (!fx) return;
    if (fx.type === 'water-edge') { const s = resolveOverboard(u, { dc: fx.dc, rng }); if (s.fell && fx.dmg > 0) applyDmg(u, fx.dmg); return; }
    if (fx.dmg > 0) applyDmg(u, fx.dmg);
  };
  // One AI turn (player OR enemy). Records player actions (move/attack); [] for an enemy turn.
  const aiTurn = (u, record) => {
    const acts = [];
    const intent = planIntent(u, aiCtx(u));
    if (intent && intent.moveTo && !samePos(intent.moveTo, u.position) && !u.hasMoved) {
      u.position = { q: intent.moveTo.q, r: intent.moveTo.r }; u.hasMoved = true;
      if (record) acts.push({ unit: u.id, type: 'move', to: { ...u.position } });
      tileEntry(u);
    }
    if (!isConscious(u)) return acts;
    const foes = units.filter((e) => isConscious(e) && e.isPlayer !== u.isPlayer);
    const target = intent && intent.target && isConscious(intent.target) ? intent.target : chooseTarget(u, foes);
    if (!target || u.hasActed) return acts;
    const dist = hexDistance(u.position, target.position);
    const losOk = dist <= 1 || losClear(u.position, target.position, ix);
    if (dist <= (u.attackRange || 1) && losOk) {
      const res = strike(u, target, { distance: dist, coverAC: coverACAt(ix, target.position), terrainIx: ix, rng });
      if (res.hit) applyDmg(target, res.damage);
      u.hasActed = true;
      if (record) acts.push({ unit: u.id, type: 'attack', target: target.id });
    }
    return acts;
  };

  const playerActions = [];
  let turnIdx = 0, round = 1, guard = 0;
  const MAX = units.length * (maxRounds + 2) + 16;
  while (!decided() && guard++ < MAX) {
    const u = units[turnIdx];
    if (isConscious(u)) {
      u.hasMoved = false; u.hasActed = false;
      if (u.isPlayer) { const acts = aiTurn(u, true); for (const a of acts) playerActions.push(a); playerActions.push({ unit: u.id, type: 'end' }); }
      else { aiTurn(u, false); }
      if (decided()) break;
    } else if (isUnconscious(u)) { u.currentHp -= 1; if (decided()) break; }
    turnIdx = (turnIdx + 1) % units.length;
    if (turnIdx === 0) { round++; if (round > maxRounds) break; }
  }
  const sides = new Set(units.filter(isConscious).map((u) => !!u.isPlayer));
  const winner = sides.size === 0 ? 'draw' : sides.size === 1 ? (sides.has(true) ? 'player' : 'enemy') : null;
  return { winner, playerActions, units, rounds: round };
}

/**
 * OFFLINE cross-check: replay the recorded log through the ACTUAL server replay function
 * (resolveEncounter) right here, the same way /seas/verify-fight will. If this agrees the player won,
 * the network verify is a formality — and if the action log were somehow illegal, this THROWS exactly
 * as the server would (so we never submit a log we know the server will reject).
 */
async function verifyLocal({ seed, playerTeam, enemyTeam, playerActions, terrain }) {
  const c = await loadCombat();
  const r = c.resolver.resolveEncounter({
    seed, playerTeam, enemyTeam, playerActions,
    spellbook: c.SPELLS, terrain, grid: c.bilge.SQUAD_GRID,
  });
  return { winner: r.winner, exhausted: r.finalState.exhausted, round: r.finalState.round };
}

/** Compact player-HP summary for the journal/transcript (how decisive the win was). */
function survivors(units) {
  return units.filter((u) => u.isPlayer).map((u) => ({ id: u.id, name: u.name, hp: u.currentHp, maxHp: u.maxHp, alive: u.currentHp > -10, conscious: u.currentHp > 0 }));
}

module.exports = { loadCombat, buildBilgeFight, playFight, verifyLocal, survivors };
