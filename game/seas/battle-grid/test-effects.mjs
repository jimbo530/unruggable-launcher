// node seas/battle-grid/test-effects.mjs — shared AoE shapes + conditions smoke test.
// The security property under test: same {seed, teams, actions} -> byte-identical outcome,
// WITH the new effects in play (splash order, condition dice, on-hit riders all seeded).
import { aoeSecondaryTargets, applyCondition, tickConditions, tryApplyOnHit, resolveControl } from "./effects.js";
import { resolveEncounter, makeRng } from "./resolver.js";
import { SPELLS } from "./units.js";
import { makeMonsterById } from "./monster-bridge.js";

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok  " : "  FAIL") + " - " + msg); if (!cond) fails++; };

const mkUnit = (id, isPlayer, q, r, hp = 10) => ({
  id, name: id, isPlayer, position: { q, r }, currentHp: hp, maxHp: hp,
  stats: { ac: 10, atkBonus: 2, attack: 3 }, rawAbilities: { str: 2, dex: 2, con: 2, int: 2, wis: 2, cha: 2 },
  hasMoved: false, hasActed: false, activeEffects: [], attackRange: 1, movementHexes: 4,
  castingAbilityMod: 2, casterLevel: 3, role: "melee",
});

// ── 1) shapes ────────────────────────────────────────────────────────────────────────
{
  const caster = mkUnit("c", true, 2, 3);
  const struck = mkUnit("t0", false, 3, 3);
  const inCone = mkUnit("t1", false, 4, 3);   // further along the aim — widening wedge
  const offAxis = mkUnit("t2", false, 2, 6);  // nowhere near the aim
  const ally = mkUnit("a1", true, 4, 3);      // friendly — always spared
  const units = [caster, struck, inCone, offAxis, ally];
  const cone = { battle: { hexShape: "cone", hexLength: 3 } };
  const hitsC = aoeSecondaryTargets(cone, caster, struck, units, () => true).map((u) => u.id);
  ok(hitsC.includes("t1") && !hitsC.includes("t2") && !hitsC.includes("a1"), "cone catches along-aim foe, spares off-axis + ally (got " + JSON.stringify(hitsC) + ")");

  const line = { battle: { hexShape: "line", hexLength: 5 } };
  const onLine = mkUnit("t3", false, 5, 3);
  const hitsL = aoeSecondaryTargets(line, caster, struck, [...units, onLine], () => true).map((u) => u.id);
  ok(hitsL.includes("t3") && !hitsL.includes("t2"), "line corridor catches colinear foe, spares off-axis (got " + JSON.stringify(hitsL) + ")");

  const radius = { battle: { hexArea: 1 } };
  const hitsR = aoeSecondaryTargets(radius, caster, struck, [...units, onLine], () => true).map((u) => u.id);
  ok(hitsR.includes("t1") && !hitsR.includes("t3"), "radius splash = within hexArea of struck hex only");
}

// ── 2) conditions tick ──────────────────────────────────────────────────────────────
{
  const u = mkUnit("p", true, 1, 1);
  applyCondition(u, { id: "burn", rounds: 2, dmg: "1d4", name: "flames" });
  applyCondition(u, { id: "stun", rounds: 1 });
  const rng = makeRng("tick-test");
  const t1 = tickConditions(u, rng);
  ok(t1.skip === true, "stun skips the turn");
  ok(t1.events.some((e) => e.kind === "condition-dot" && e.damage >= 1), "burn deals damage");
  ok(u.conditions.length === 1 && u.conditions[0].id === "burn", "stun expired, burn persists");
  const t2 = tickConditions(u, rng);
  ok(t2.skip === false && u.conditions.length === 0, "burn expires after its rounds");
  let threw = false; try { applyCondition(u, { id: "confetti", rounds: 1 }); } catch { threw = true; }
  ok(threw, "unknown condition throws (no silent nonsense)");
}

// ── 3) on-hit rider + monster passthrough ────────────────────────────────────────────
{
  const spider = makeMonsterById("giant_spider", { q: 5, r: 5 });
  ok(spider.applies && spider.applies.id === "poison", "giant_spider carries mechanical venom");
  const prey = mkUnit("prey", true, 5, 6, 12);
  // force a failed save deterministically by scanning seeds
  let applied = null;
  for (let s = 0; s < 50 && !applied; s++) {
    const r = tryApplyOnHit(spider, { ...prey, conditions: [] }, makeRng("venom" + s));
    if (r && r.applied) applied = r;
  }
  ok(!!applied, "venom lands on a failed save (within 50 seeds)");
}

// ── 4) control spell = stun ─────────────────────────────────────────────────────────
{
  const caster = mkUnit("cz", true, 1, 1);
  let stunned = null;
  for (let s = 0; s < 50 && !stunned; s++) {
    const tgt = mkUnit("v", false, 2, 1);
    const r = resolveControl(caster, tgt, SPELLS.daze, makeRng("daze" + s));
    if (r && r.stunned) stunned = { r, tgt };
  }
  ok(!!stunned && stunned.tgt.conditions.some((c) => c.id === "stun"), "daze stuns on a failed save");
}

// ── 5) full-replay determinism with effects in play ─────────────────────────────────
{
  const caster = { ...mkUnit("hero", true, 1, 4), role: "caster", availableSpells: ["fireball"], casterLevel: 3 };
  const spiders = [0, 1, 2].map((i) => ({ ...makeMonsterById("giant_spider", { q: 6 + (i % 2), r: 3 + i }, { id: "sp" + i }), isPlayer: false }));
  const input = {
    seed: "effects-parity-1",
    playerTeam: [caster],
    enemyTeam: spiders,
    spellbook: SPELLS,
    playerActions: [
      { unit: "hero", type: "spell", spell: "fireball", target: "sp1" },
      { unit: "hero", type: "end" },
      { unit: "hero", type: "end" },
      { unit: "hero", type: "end" },
      { unit: "hero", type: "end" },
      { unit: "hero", type: "end" },
    ],
  };
  const a = resolveEncounter(input);
  const b = resolveEncounter(input);
  ok(JSON.stringify(a.log) === JSON.stringify(b.log), "replay is byte-identical (same seed + actions)");
  const splashes = a.log.filter((e) => e.type === "spell-splash");
  ok(splashes.length >= 1, "fireball splashes at least one secondary spider (" + splashes.length + ")");
  ok(a.winner === "player" || a.winner === "enemy" || a.winner === null || a.winner === "draw", "outcome well-formed (" + a.winner + ")");
}

console.log(fails ? "\n" + fails + " FAILURES" : "\nall good");
process.exit(fails ? 1 : 0);
