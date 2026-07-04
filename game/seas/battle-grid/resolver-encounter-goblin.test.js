// @ts-check
/**
 * resolver-encounter-goblin.test.js — proves the HARDENED GOBLIN CAVE fight (resolveEncounter) is the
 * trustworthy server-replay referee, exactly like the bilge-rats proof (resolver-encounter.test.js).
 * A real goblin-cave fight, played out, REPLAYS IDENTICALLY on the server from only { seed, playerActions }
 * (the goblins are RE-COMPUTED, not trusted). Run:  node resolver-encounter-goblin.test.js
 *
 * Proves (same four pillars as bilge):
 *   (A) DETERMINISM — same { seed, teams, playerActions } → byte-identical result; input never mutated.
 *   (B) SERVER-REPLAY PARITY (load-bearing) — an INDEPENDENT "client" sim plays the whole fight (both
 *       sides AI-piloted through the SAME chokepoint, ONE seeded rng) + records the player's actions;
 *       feeding ONLY { seed, playerActions } to resolveEncounter (which RE-COMPUTES every goblin turn)
 *       reproduces the SAME winner + SAME per-unit final HP. Exactly the seas-server verify path.
 *   (C) CORRECTNESS — the cave is HARDER than the bilge arena (a 3–4 goblin pack incl. a ranged slinger,
 *       on the chokepoint cave deck): a strong leader still wins MOST seeds; a feeble one takes real
 *       blood; an inconclusive log is NEVER a player win (the keeper can't be tricked into paying).
 *   (D) ANTI-CHEAT — a tampered player log (out of range / double-act / wall-walk / unknown unit) THROWS.
 *
 * Pure/headless: engine + chokepoint + terrain + resolver + the GOBLIN builder. Runs under Node.
 */

import { resolveEncounter, makeRng } from "./resolver.js";
import { buildUnit } from "./units.js";
import { buildGoblinEnemies, caveTerrain, SQUAD_GRID } from "../../lib/goblin-cave.js";
import { strike, planIntent, chooseTarget, resolveOverboard } from "./combat-helpers.js";
import { SPELLS, hexDistance, isConscious, isAlive, isUnconscious } from "./tot-engine.js";
import { coverACAt, blockedKeys, tileEntryEffect } from "./terrain-effects.js";
import { losClear } from "./los.js";
// Squad board is 16×9 — use the grid-config shadow (NOT tot-engine's frozen 9×7), same as game.js.
import { hexesInRange, setGrid } from "./grid-config.js";
setGrid(SQUAD_GRID.cols, SQUAD_GRID.rows);

// ── tiny harness ────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0; const results = [];
function ok(c, m) { if (c) { pass++; results.push("  PASS  " + m); } else { fail++; results.push("  FAIL  " + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m); }
function throws(fn, m) { try { fn(); ok(false, `expected throw: ${m}`); } catch (e) { ok(true, `threw as required (${m}): ${String(e.message).slice(0, 64)}…`); } }
const clone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const key = (h) => `${h.q},${h.r}`;
const samePos = (a, b) => a && b && a.q === b.q && a.r === b.r;

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────
// Player mustered at the cave mouth (left). A strong leader (clears) and a feeble one (struggles).
const strongLeader = (id = "LEADER") =>
  buildUnit({ id, isPlayer: true, name: "Captain", emoji: "🦜", endowment: { burgers: 40 }, role: "melee", position: { q: 1, r: 4 } });
const feebleLeader = (id = "LEADER") =>
  buildUnit({ id, isPlayer: true, name: "Cabin Boy", emoji: "🧒", endowment: { pump: 2 }, role: "melee", position: { q: 1, r: 4 } });

const TERRAIN = caveTerrain();
const terrainIxOf = (cells) => new Map((cells || []).map((c) => [key(c), c]));

// ── INDEPENDENT "client" simulation (mirrors game.js + resolveEncounter, but DOES NOT call it) ──
// Plays a full fight: both sides AI-piloted via planIntent/strike off ONE seeded rng, in the SAME
// turn order + rng DRAW ORDER as resolveEncounter. Records the PLAYER's actions (move/attack/end).
function aiCtx(units, u, ix) {
  const foes = units.filter((e) => isConscious(e) && e.isPlayer !== u.isPlayer);
  const allies = units.filter((e) => isConscious(e) && e.isPlayer === u.isPlayer);
  const occ = (ex) => { const s = new Set(units.filter((x) => isAlive(x) && x !== ex).map((x) => key(x.position))); for (const k of blockedKeys(ix)) s.add(k); return s; };
  return {
    foes, allies,
    reach: (unit) => hexesInRange(unit.position, unit.movementHexes, occ(unit)),
    dist: (a, b) => hexDistance(a, b),
    actRange: (unit) => unit.attackRange || 1,
    meleeRange: (unit) => unit.attackRange || 1,
    ownCaster: allies.find((a) => a !== u && a.role === "caster") || null,
    aoeArea: () => 0,
    hasLos: (f, t) => losClear(f, t, ix),
  };
}
function applyDmg(t, d) { t.currentHp -= d; }
function tileEntry(u, ix, rng) {
  if (!isConscious(u) || !ix || ix.size === 0) return;
  const fx = tileEntryEffect(ix, u.position);
  if (!fx) return;
  if (fx.type === "water-edge") { const s = resolveOverboard(u, { dc: fx.dc, rng }); if (s.fell && fx.dmg > 0) applyDmg(u, fx.dmg); return; }
  if (fx.dmg > 0) applyDmg(u, fx.dmg);
}
/** One AI turn (player OR enemy), mirroring resolveEncounter's runEnemyTurn. Returns the recorded
 *  player actions (move/attack) for this turn — [] for an enemy turn. */
function aiTurn(units, u, rng, ix, record) {
  const acts = [];
  const intent = planIntent(u, aiCtx(units, u, ix));
  if (intent && intent.moveTo && !samePos(intent.moveTo, u.position) && !u.hasMoved) {
    u.position = { q: intent.moveTo.q, r: intent.moveTo.r }; u.hasMoved = true;
    if (record) acts.push({ unit: u.id, type: "move", to: { ...u.position } });
    tileEntry(u, ix, rng);
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
    if (record) acts.push({ unit: u.id, type: "attack", target: target.id });
  }
  return acts;
}
/** Full fight sim → { winner, units, playerActions }. Independent of resolveEncounter. */
function clientSim({ seed, playerTeam, enemyTeam, terrain, maxRounds = 60 }) {
  const ix = terrainIxOf(terrain);
  const rng = makeRng(seed);
  const units = [...clone(playerTeam).map((u) => ({ ...u, isPlayer: true })), ...clone(enemyTeam).map((u) => ({ ...u, isPlayer: false }))];
  const decided = () => new Set(units.filter(isConscious).map((u) => !!u.isPlayer)).size <= 1;
  const playerActions = [];
  let turnIdx = 0, round = 1, guard = 0;
  const MAX = units.length * (maxRounds + 2) + 16;
  while (!decided() && guard++ < MAX) {
    const u = units[turnIdx];
    if (isConscious(u)) {
      u.hasMoved = false; u.hasActed = false;
      if (u.isPlayer) { const acts = aiTurn(units, u, rng, ix, true); for (const a of acts) playerActions.push(a); playerActions.push({ unit: u.id, type: "end" }); }
      else { aiTurn(units, u, rng, ix, false); }
      if (decided()) break;
    } else if (isUnconscious(u)) { u.currentHp -= 1; if (decided()) break; }
    turnIdx = (turnIdx + 1) % units.length;
    if (turnIdx === 0) { round++; if (round > maxRounds) break; }
  }
  const sides = new Set(units.filter(isConscious).map((u) => !!u.isPlayer));
  const winner = sides.size === 0 ? "draw" : sides.size === 1 ? (sides.has(true) ? "player" : "enemy") : null;
  return { winner, units, playerActions };
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// (A) DETERMINISM + input immutability
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const seed = "seas-goblin-0xFEED";
  const playerTeam = [strongLeader()];
  const enemyTeam = buildGoblinEnemies(seed, [{ q: 1, r: 4 }]);
  const sim = clientSim({ seed, playerTeam, enemyTeam, terrain: TERRAIN });

  const r1 = resolveEncounter({ seed, playerTeam, enemyTeam, playerActions: sim.playerActions, spellbook: SPELLS, terrain: TERRAIN, grid: SQUAD_GRID });
  const r2 = resolveEncounter({ seed, playerTeam, enemyTeam, playerActions: sim.playerActions, spellbook: SPELLS, terrain: TERRAIN, grid: SQUAD_GRID });
  eq(r1, r2, "A: same {seed,teams,playerActions} → identical result object across runs");

  const beforeP = JSON.stringify(playerTeam), beforeE = JSON.stringify(enemyTeam);
  resolveEncounter({ seed, playerTeam, enemyTeam, playerActions: sim.playerActions, spellbook: SPELLS, terrain: TERRAIN, grid: SQUAD_GRID });
  ok(JSON.stringify(playerTeam) === beforeP, "A: playerTeam input is NOT mutated");
  ok(JSON.stringify(enemyTeam) === beforeE, "A: enemyTeam input is NOT mutated");
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// (B) SERVER-REPLAY PARITY — the goblin fight replays identically from only { seed, playerActions }
// ════════════════════════════════════════════════════════════════════════════════════════════
function assertReplay(label, seed, mkPlayer) {
  const playerTeam = [mkPlayer()];
  const enemyTeam = buildGoblinEnemies(seed, [playerTeam[0].position]);
  // CLIENT plays the whole fight (goblins AI-driven) and records the player's actions.
  const sim = clientSim({ seed, playerTeam, enemyTeam, terrain: TERRAIN });
  // SERVER replays from ONLY seed + the player's recorded actions; it RE-COMPUTES every goblin turn.
  const srv = resolveEncounter({ seed, playerTeam, enemyTeam, playerActions: sim.playerActions, spellbook: SPELLS, terrain: TERRAIN, grid: SQUAD_GRID });

  ok(srv.winner === sim.winner, `${label}: server winner == client winner (${srv.winner})`);
  let hpMatch = true;
  for (const su of srv.finalState.units) { const cu = sim.units.find((u) => u.id === su.id); if (!cu || cu.currentHp !== su.currentHp) hpMatch = false; }
  ok(hpMatch, `${label}: every unit's final HP matches the client sim`);
  const srvBreak = srv.log.filter((e) => e.type === "attack" || e.type === "spell").map((e) => e.breakdown);
  ok(srvBreak.length > 0, `${label}: server produced ${srvBreak.length} dice rolls (a real fight happened)`);
  return { srv, sim };
}
{
  for (const seed of ["goblin-A", "goblin-B", "goblin-C", "0xBADC0FFEE", 7777]) assertReplay(`B parity seed=${seed}`, seed, strongLeader);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// (C) CORRECTNESS — a strong leader clears MOST seeds; a feeble one bleeds. Goblins re-computed from seed.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // The cave is HARDER than the bilge arena (goblins hit harder than rats + a ranged slinger), so a
  // strong leader should still win the MAJORITY of seeds (≥3/5) — not a guaranteed clear like the rats.
  let strongWins = 0;
  for (const seed of ["c1", "c2", "c3", "c4", "c5"]) {
    const { srv } = assertReplay(`C strong seed=${seed}`, seed, strongLeader);
    if (srv.winner === "player") strongWins++;
  }
  ok(strongWins >= 3, `C: the strong leader WINS the cave on ≥3/5 seeds (won ${strongWins}/5) — winnable but a real fight`);

  // STATS MATTER: a feeble cabin boy must not be trivially unscathed — assert the feeble leader ENDS
  // hurt (takes real damage) AND the server agrees with the client on every feeble outcome (parity
  // holds either way). Proves the d20/HP math bites without over-fitting a win/loss balance.
  let feebleHurtSeeds = 0;
  for (const seed of ["d1", "d2", "d3", "d4", "d5"]) {
    const playerTeam = [feebleLeader()];
    const enemyTeam = buildGoblinEnemies(seed, [playerTeam[0].position]);
    const sim = clientSim({ seed, playerTeam, enemyTeam, terrain: TERRAIN });
    const srv = resolveEncounter({ seed, playerTeam, enemyTeam, playerActions: sim.playerActions, spellbook: SPELLS, terrain: TERRAIN, grid: SQUAD_GRID });
    ok(srv.winner === sim.winner, `C feeble seed=${seed}: server agrees with client (${srv.winner})`);
    const me = srv.finalState.units.find((u) => u.id === "LEADER");
    if (me.currentHp < me.maxHp || srv.winner === "enemy") feebleHurtSeeds++;
  }
  ok(feebleHurtSeeds >= 3, `C: the goblins draw real blood from a feeble leader (hurt/downed on ≥3/5 seeds: ${feebleHurtSeeds}/5)`);

  // INCONCLUSIVE log → never a player win (the keeper can't be tricked into paying)
  const seed = "inconclusive";
  const playerTeam = [strongLeader()];
  const enemyTeam = buildGoblinEnemies(seed, [playerTeam[0].position]);
  const short = resolveEncounter({ seed, playerTeam, enemyTeam, playerActions: [{ unit: "LEADER", type: "end" }], spellbook: SPELLS, terrain: TERRAIN, grid: SQUAD_GRID });
  ok(short.winner !== "player", `C: a log too short to win is NOT a player win (winner=${short.winner}, exhausted=${short.finalState.exhausted})`);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// (D) ANTI-CHEAT — a tampered player log THROWS (server rejects, never pays a faked win)
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const seed = "cheat";
  const playerTeam = [strongLeader()];
  const enemyTeam = buildGoblinEnemies(seed, [playerTeam[0].position]);
  const goblinId = enemyTeam[0].id;
  const base = { seed, playerTeam, enemyTeam, spellbook: SPELLS, terrain: TERRAIN, grid: SQUAD_GRID };

  throws(() => resolveEncounter({ ...base, playerActions: [{ unit: "LEADER", type: "attack", target: goblinId }, { unit: "LEADER", type: "end" }] }),
    "attack a goblin far across the cave (out of range)");
  throws(() => resolveEncounter({ ...base, playerActions: [{ unit: "LEADER", type: "attack", target: "GHOST" }] }),
    "attack a non-existent unit");
  throws(() => resolveEncounter({ ...base, playerActions: [{ unit: "LEADER", type: "move", to: { q: 1, r: 4 } }, { unit: "LEADER", type: "move", to: { q: 2, r: 4 } }, { unit: "LEADER", type: "end" }] }),
    "two moves in one turn (action economy)");
  throws(() => resolveEncounter({ ...base, playerActions: [{ unit: "LEADER", type: "move", to: { q: 15, r: 8 } }, { unit: "LEADER", type: "end" }] }),
    "teleport move far out of movement range");
  throws(() => resolveEncounter({ ...base, playerActions: [{ unit: "LEADER", type: "attack" }] }),
    "attack with no target id");
}

// ── report ──────────────────────────────────────────────────────────────────────────────────
console.log(results.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
