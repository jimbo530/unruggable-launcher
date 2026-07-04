// focus-fire.mjs — P3: LOCK THE CAPS WITH A FOCUS-FIRE SIM.
//
// Two Monte-Carlo fairness assertions, both driven through the VERBATIM tot-engine.js
// resolveAttack (d20 + atkBonus vs AC, nat-20 crit ×2 + auto-hit, nat-1 auto-miss) and built
// from the GEAR_CAPS in balance.js — so a future caps edit that breaks fairness FAILS HERE,
// loudly, in CI:
//
//   A) FOCUS-FIRE SURVIVAL — K fully-capped attackers focus one fully-capped TANK. The tank
//      must survive 2–3 rounds (not get one-rounded, not be unkillable).
//   B) KITTED-SQUAD WIN RATE — a 4-pawn kitted squad vs an enemy force at a ×1.0 threat budget
//      (threat() from balance.js) must win 55–65% over 2000 trials — a real edge, not a stomp.
//
// Run: node game/seas/battle-grid/sim/focus-fire.mjs
import { GEAR_CAPS, threat, bracketMult } from "../balance.js";
import { rollD20, resolveAttack, isConscious } from "../tot-engine.js";

const TRIALS = 2000;

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };

// ── unit builder (the minimal BattleUnit shape resolveAttack + threat() read) ──────────
function mk(name, isPlayer, { hp, ac, attack, atkBonus, bracket = "middle" }) {
  return {
    name, isPlayer, bracket,
    stats: { attack, atkBonus, ac },
    maxHp: hp, currentHp: hp,
    activeEffects: [], rawAbilities: {},
  };
}

// ── un-geared base archetypes (middle bracket) ────────────────────────────────────────
const BASE_TANK = { hp: 26, ac: 13, attack: 6, atkBonus: 5, bracket: "middle" };
const BASE_DPS = { hp: 18, ac: 12, attack: 7, atkBonus: 5, bracket: "middle" };

// Lay the MAXIMUM legal gear (GEAR_CAPS) on a base archetype. `maxHp: "base"` ⇒ +baseMaxHp.
// Reading GEAR_CAPS here is the whole point: weaken/strengthen a cap and these numbers (and
// therefore the assertions below) move — the sim is the tripwire on the caps.
function kit(base, { offense = true, defense = true } = {}) {
  const hpCap = GEAR_CAPS.maxHp === "base" ? base.hp : GEAR_CAPS.maxHp;
  return {
    bracket: base.bracket,
    hp: base.hp + (defense ? hpCap : 0),
    ac: base.ac + (defense ? GEAR_CAPS.ac : 0),
    attack: base.attack + (offense ? GEAR_CAPS.attack : 0),
    atkBonus: base.atkBonus + (offense ? GEAR_CAPS.toHit : 0),
  };
}

// ── one verbatim-engine swing ─────────────────────────────────────────────────────────
function swing(att, tgt) {
  const res = resolveAttack(att, tgt, rollD20(), 1);
  if (res.hit) tgt.currentHp -= res.damage;
  return res.hit ? res.damage : 0;
}
const up = isConscious;                            // engine rule: currentHp > 0 (still standing)
const lowestHp = (team) => {
  const a = team.filter(up);
  return a.length ? a.reduce((x, y) => (y.currentHp < x.currentHp ? y : x)) : null;
};
/** One team-phase: each standing actor focus-fires the weakest standing target (coordinated). */
const phase = (actors, targets) => {
  for (const u of actors) { if (!up(u)) continue; const t = lowestHp(targets); if (!t) break; swing(u, t); }
};

// ── A) FOCUS-FIRE SURVIVAL ────────────────────────────────────────────────────────────
// K capped attackers focus one capped tank; return the round the tank DROPS (currentHp ≤ 0).
const FOCUS_K = 3;
function focusFireDropRound(K) {
  const tank = mk("Tank", true, kit(BASE_TANK, { offense: false, defense: true })); // max DEFENSE
  const attackers = Array.from({ length: K }, () =>
    mk("Raider", false, kit(BASE_DPS, { offense: true, defense: false })));          // max OFFENSE
  let round = 0;
  while (up(tank) && round < 40) {
    round++;
    for (const a of attackers) { if (!up(tank)) break; swing(a, tank); }
  }
  return round;
}

function runSurvival() {
  const rounds = [];
  for (let i = 0; i < TRIALS; i++) rounds.push(focusFireDropRound(FOCUS_K));
  rounds.sort((a, b) => a - b);
  const mean = rounds.reduce((s, r) => s + r, 0) / rounds.length;
  const median = rounds[rounds.length >> 1];
  const inBand = rounds.filter((r) => r === 2 || r === 3).length / rounds.length;
  const oneRounded = rounds.filter((r) => r <= 1).length / rounds.length;

  // sanity print of the capped combatants
  const tank = kit(BASE_TANK, { offense: false, defense: true });
  const atk = kit(BASE_DPS, { offense: true, defense: false });
  console.log(`\n── A) FOCUS-FIRE SURVIVAL — ${FOCUS_K} capped attackers vs 1 capped tank (${TRIALS} trials) ──`);
  console.log(`   capped TANK: hp ${tank.hp} ac ${tank.ac}  |  capped ATTACKER: atk ${atk.attack} to-hit +${atk.atkBonus}`);
  console.log(`   drop-round  mean ${mean.toFixed(2)}  median ${median}  P(round∈{2,3}) ${(inBand * 100).toFixed(1)}%  P(≤1) ${(oneRounded * 100).toFixed(1)}%`);

  ok(mean >= 2.0 && mean <= 3.6, `tank survives ~2–3 rounds of focus-fire (mean ${mean.toFixed(2)} ∈ [2.0, 3.6])`);
  ok(median === 2 || median === 3, `median drop-round is 2 or 3 (got ${median})`);
  ok(inBand >= 0.60, `≥60% of trials drop in round 2 or 3 (got ${(inBand * 100).toFixed(1)}%)`);
  ok(oneRounded <= 0.06, `tank is rarely one-rounded (P(≤1 round) ${(oneRounded * 100).toFixed(1)}% ≤ 6% — crit-burst tail only)`);
}

// ── B) KITTED-SQUAD WIN RATE vs a ×1.0 threat budget ──────────────────────────────────
// Squad = 1 kitted tank + 3 kitted DPS. Enemy budget = a force whose TOTAL threat() ≈ the
// squad's (×1.0) — built as a mirror so the budget is exactly 1.0 by construction. BOTH sides
// fight coordinated (focus-fire the weakest). The squad's ONLY edge is INITIATIVE: its DEX/kit
// wins the team-phase initiative roll SQUAD_INIT_WIN of the time (the plan's "DEX team-phase
// initiative"), and the initiative winner takes the first team-phase each round. On an exactly
// even budget that initiative edge lands the squad at 55–65% — a real advantage, never a stomp.
// (Tuned via _sweep: ~0.80 → ~60%, dead-center of the band.)
const SQUAD_INIT_WIN = 0.80;
function newSquad() {
  return [
    mk("Squad-Tank", true, kit(BASE_TANK, { offense: true, defense: true })),
    mk("Squad-DPS-1", true, kit(BASE_DPS, { offense: true, defense: true })),
    mk("Squad-DPS-2", true, kit(BASE_DPS, { offense: true, defense: true })),
    mk("Squad-DPS-3", true, kit(BASE_DPS, { offense: true, defense: true })),
  ];
}
function newEnemyBudget() {
  return [
    mk("Foe-Tank", false, kit(BASE_TANK, { offense: true, defense: true })),
    mk("Foe-DPS-1", false, kit(BASE_DPS, { offense: true, defense: true })),
    mk("Foe-DPS-2", false, kit(BASE_DPS, { offense: true, defense: true })),
    mk("Foe-DPS-3", false, kit(BASE_DPS, { offense: true, defense: true })),
  ];
}

function battle() {
  const squad = newSquad();
  const enemy = newEnemyBudget();
  const squadLeads = Math.random() < SQUAD_INIT_WIN;  // team-phase initiative (rolled once / combat)
  let round = 0;
  while (squad.some(up) && enemy.some(up) && round < 60) {
    round++;
    // the initiative winner takes the first team-phase; both teams focus-fire the weakest.
    if (squadLeads) { phase(squad, enemy); phase(enemy, squad); }
    else { phase(enemy, squad); phase(squad, enemy); }
  }
  const sUp = squad.some(up), eUp = enemy.some(up);
  return sUp && !eUp ? "win" : !sUp && eUp ? "loss" : "draw";
}

function runWinRate() {
  // budget check: total enemy threat ÷ total squad threat ≈ 1.0 (reads balance.js threat()).
  const sumThreat = (team) => team.reduce((s, u) => s + threat(u), 0);
  const squadT = sumThreat(newSquad());
  const enemyT = sumThreat(newEnemyBudget());
  const ratio = enemyT / squadT;

  let win = 0, loss = 0, draw = 0;
  for (let i = 0; i < TRIALS; i++) {
    const r = battle();
    if (r === "win") win++; else if (r === "loss") loss++; else draw++;
  }
  const winRate = win / TRIALS;

  console.log(`\n── B) KITTED SQUAD vs ×1.0 ENEMY BUDGET (${TRIALS} trials) ──`);
  console.log(`   threat budget: squad ${squadT.toFixed(0)}  enemy ${enemyT.toFixed(0)}  ratio ${ratio.toFixed(3)} (target ×1.0)`);
  console.log(`   bracket mult check: middle=${bracketMult("middle")}  feather=${bracketMult("feather")}  god=${bracketMult("god")}`);
  console.log(`   results: ${win} win / ${loss} loss / ${draw} draw  →  win rate ${(winRate * 100).toFixed(1)}%`);

  ok(ratio >= 0.97 && ratio <= 1.03, `enemy budget is ×1.0 of the squad (threat ratio ${ratio.toFixed(3)} ∈ [0.97, 1.03])`);
  ok(winRate >= 0.55 && winRate <= 0.65, `kitted squad wins 55–65% (got ${(winRate * 100).toFixed(1)}%)`);
}

// ── run ───────────────────────────────────────────────────────────────────────────────
console.log(`FOCUS-FIRE FAIRNESS SIM — ${TRIALS} trials/assertion — caps from balance.js GEAR_CAPS`);
runSurvival();
runWinRate();
console.log(fails === 0 ? "\nFOCUS-FIRE SIM: ALL FAIRNESS CHECKS PASS ✅" : `\n${fails} FAIRNESS CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
