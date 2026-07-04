// smoke-los.mjs — P8 VISION · LINE-OF-SIGHT · FOG OF WAR smoke test. Proves the new los.js layer:
//   A) a WALL on the sight line BLOCKS LOS and a RANGED shot through it is REJECTED at the chokepoint;
//      a CLEAR line is allowed; MELEE (adjacent) is never gated; the forecast HUD reads 0% when walled.
//   B) per-unit sightRange is EXTENDABLE (a sight stat / a SPYGLASS trinket's mods.sight).
//   C) fog vision is the UNION of a side's pawns → a 2nd pawn placed far away REVEALS a far area
//      (the per-ship founder payoff); a wall hides what's behind it; downed/enemy pawns don't reveal.
//   D) fog engages ONLY on the bigger squad/ship boards — the 1v1 training/duel board stays fully
//      visible (NO regression).
//   E) the AI won't telegraph a shot THROUGH a wall (planIntent respects ctx.hasLos).
// Deterministic (injected d20), synthetic terrain Map, no DOM / no chain.
//   Run: node game/seas/battle-grid/smoke-los.mjs
import { hexLine, losClear, sightRangeOf, sightField, visibleHexes, fogActiveForGrid, SIGHT_BASE } from "./los.js";
import { strike, forecast, planIntent } from "./combat-helpers.js";
import { ITEMS } from "./items.js";
import { setGrid, GRID_PRESETS } from "./grid-config.js";
import { hexDistance } from "./tot-engine.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };
const K = (h) => `${h.q},${h.r}`;

// synthetic combatants (mirror smoke-terrain): no weapon dice, no effects → terrain is the only variable.
const mkAtk = (pos) => ({ name: "Gunner", position: pos, stats: { attack: 8, atkBonus: 12, ac: 10 }, equipped: { weapon: null }, activeEffects: [], currentHp: 30, maxHp: 30 });
const mkTgt = (pos) => ({ name: "Mark", position: pos, stats: { attack: 0, atkBonus: 0, ac: 8 }, equipped: {}, activeEffects: [], rawAbilities: {}, currentHp: 30, maxHp: 30 });

console.log("── A) WALL blocks the sight line + the RANGED shot; clear line allowed; melee unaffected ──");
setGrid(GRID_PRESETS.squad.cols, GRID_PRESETS.squad.rows);   // 16×9 — room for a long line
const A = { q: 2, r: 4 }, T = { q: 8, r: 4 };
const line = hexLine(A, T);
ok(line.length === hexDistance(A, T) + 1 && K(line[0]) === K(A) && K(line[line.length - 1]) === K(T),
  `hexLine(A,T) walks ${line.length} hexes from A to T (dist ${hexDistance(A, T)})`);
const mid = line[Math.floor(line.length / 2)];                // a hex STRICTLY between A and T
const wallIx = new Map([[K(mid), { type: "wall" }]]);          // one blocking tile on the line
const clearIx = new Map();                                    // authored deck, but nothing on this line

ok(losClear(A, T, wallIx) === false, `a WALL on the line (${K(mid)}) BLOCKS line-of-sight`);
ok(losClear(A, T, clearIx) === true, "a CLEAR line (no wall between) is allowed");
ok(losClear(A, T, null) === true, "no terrain index at all → clear (duel/training back-compat)");
ok(losClear(A, mid, wallIx) === true, "the wall hex itself is still VISIBLE (endpoints never self-block)");

// strike() chokepoint: the SAME ranged swing is rejected through the wall but lands on a clear line.
const shot = hexDistance(A, T);   // distance 6 → ranged
const blocked = strike(mkAtk(A), mkTgt(T), { nat: 18, distance: shot, terrainIx: wallIx });
ok(blocked.hit === false && blocked.blocked === true, "a RANGED strike THROUGH a wall is REJECTED (no LOS, no damage)");
const clear = strike(mkAtk(A), mkTgt(T), { nat: 18, distance: shot, terrainIx: clearIx });
ok(clear.hit === true && !clear.blocked, "the SAME shot on a CLEAR line lands (LOS gate is wall-only)");

// melee (adjacent, distance 1) is NEVER gated — even with a wall elsewhere in the index.
const ADJ = { q: 2, r: 5 };       // neighbor of (2,4)
const melee = strike(mkAtk(A), mkTgt(ADJ), { nat: 18, distance: 1, terrainIx: wallIx });
ok(melee.hit === true && melee.blocked !== true, "MELEE (adjacent, distance 1) is unaffected by LOS");

// forecast HUD reflects the same gate.
const fBlocked = forecast(mkAtk(A), mkTgt(T), { terrainIx: wallIx });
const fClear = forecast(mkAtk(A), mkTgt(T), { terrainIx: clearIx });
ok(fBlocked.blocked === true && fBlocked.hitPct === 0, "forecast HUD reads 0% (blocked) for a walled-off ranged shot");
ok(!fClear.blocked && fClear.hitPct > 0, "forecast HUD shows a real hit% on a clear line");

console.log("── B) per-unit sightRange is EXTENDABLE (sight stat / spyglass) ──");
ok(sightRangeOf({ position: A }) === SIGHT_BASE, `default sight range = SIGHT_BASE (${SIGHT_BASE})`);
ok(sightRangeOf({ position: A, sightBonus: 3 }) === SIGHT_BASE + 3, "a sight bonus (sight stat) EXTENDS sight range");
ok(sightRangeOf({ position: A, baseSightRange: 7 }) === 7, "baseSightRange overrides the default base (keen-eyed monster)");
// DATA-DRIVEN SPYGLASS: any equipped item carrying mods.sight extends vision (no code change needed).
ITEMS.test_spyglass = { id: "test_spyglass", name: "Test Spyglass", slot: "trinket", emoji: "🔭", gold: 1, weight: 0, mods: { sight: 2 } };
const scout = { position: A, equipped: { trinket: "test_spyglass" } };
ok(sightRangeOf(scout) === SIGHT_BASE + 2, "a SPYGLASS trinket (mods.sight:2) extends sight — data-driven gear path");

console.log("── C) fog vision is the UNION of the side's pawns (spread = reveal); walls hide behind them ──");
setGrid(20, 9);                                               // a long ship-scale board
const near = { isPlayer: true, position: { q: 2, r: 4 }, currentHp: 10 };
const far = { isPlayer: true, position: { q: 17, r: 4 }, currentHp: 10 };
const visNear = visibleHexes([near], true, null);
ok(visNear.has("2,4"), "a pawn always sees its OWN hex");
ok(!visNear.has("17,4"), "with ONE near pawn, the far end of the ship is FOGGED (out of sight)");
const visBoth = visibleHexes([near, far], true, null);
ok(visBoth.has("17,4"), "adding a FAR pawn REVEALS the far area — vision is the UNION (per-ship payoff)");
ok(visBoth.size > visNear.size, "spreading the crew STRICTLY increases the revealed area (emergent, no special-case)");

// a downed lookout reveals nothing; an enemy pawn never grants the player vision.
const down = { isPlayer: true, position: { q: 10, r: 4 }, currentHp: 0 };   // unconscious (0 HP)
ok(visibleHexes([down], true, null).size === 0, "a DOWNED (unconscious) lookout reveals nothing");
const enemy = { isPlayer: false, position: { q: 17, r: 4 }, currentHp: 10 };
ok(!visibleHexes([near, enemy], true, null).has("17,4"), "an ENEMY pawn does NOT grant the player vision");

// a wall hides what's BEHIND it inside one pawn's own sight field.
setGrid(GRID_PRESETS.squad.cols, GRID_PRESETS.squad.rows);
const seer = { isPlayer: true, position: A, currentHp: 10, sightBonus: 10 };   // big range so T is in radius
const field = sightField(seer, wallIx);
ok(field.has("2,4"), "sightField includes the seer's own hex");
ok(field.has("2,3"), "sightField includes an adjacent CLEAR hex");
ok(hexDistance(A, T) <= sightRangeOf(seer) && !field.has(K(T)), "a hex BEHIND a wall is NOT in the sight field (fog behind cover)");

console.log("── D) fog only on the bigger boards — the 1v1 training/duel stays fully visible ──");
ok(fogActiveForGrid(GRID_PRESETS.duel) === false, "1v1 duel/training board (9×7) → NO fog (fully visible, NO regression)");
ok(fogActiveForGrid(GRID_PRESETS.squad) === true, "squad board (16×9) → fog ON");
ok(fogActiveForGrid(GRID_PRESETS.ship) === true, "ship board (20×6) → fog ON");
ok(fogActiveForGrid(GRID_PRESETS.boarding) === true, "boarding board (20×14) → fog ON");

console.log("── E) the AI won't telegraph a shot THROUGH a wall (planIntent respects ctx.hasLos) ──");
const shooter = { position: { q: 0, r: 0 }, attackRange: 5, role: "ranged", isPlayer: false, currentHp: 10, stats: { atkBonus: 0, ac: 10 } };
const mark = { id: "m", position: { q: 0, r: 3 }, isPlayer: true, currentHp: 10, stats: { atkBonus: 0, ac: 10 } };
const baseCtx = { foes: [mark], allies: [shooter], reach: () => [], dist: (a, b) => hexDistance(a, b), actRange: () => 5, meleeRange: () => 1 };
const planBlocked = planIntent(shooter, { ...baseCtx, hasLos: () => false });
const planClear = planIntent(shooter, { ...baseCtx, hasLos: () => true });
ok(planBlocked.willStrike === false, "hasLos=false → the AI does NOT plan to fire through the wall");
ok(planClear.willStrike === true, "hasLos=true → the AI fires when the line is clear");

console.log(fails === 0 ? "\nVISION / LOS / FOG: ALL PASS ✅" : `\n${fails} LOS CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
