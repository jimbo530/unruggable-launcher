// crit-ranges.mjs — P6 UNIT TEST: per-weapon crit ranges + the DIVIDE-OUT guard.
//
// The verbatim engine (tot-engine resolveAttack) only knows "nat 20 → ×2". strike()
// (combat-helpers.js) layers each weapon's real SRD crit RANGE + MULTIPLIER on top, and MUST
// divide out the engine's hard-coded ×2 BEFORE applying the weapon's multiplier — or a nat-20
// ×3 weapon would double-apply to ×6. This test injects the natural d20 so every assertion is
// deterministic (no RNG), and pins the exact damage.
//
// Run: node game/seas/battle-grid/crit-ranges.mjs
import { strike, forecast, parseCrit, weaponCritFor } from "./combat-helpers.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };

// Synthetic combatants: attacker ALWAYS hits (huge to-hit) so damage is the only variable.
// stats.attack = 10 (flat), and the test weapons (boarding-axe ×3, cutlass 18-20) roll NO dice
// — they carry a crit field but no diceRoll/dmgDice flag — so base damage is a clean 10.
const mkAtk = (weapon) => ({
  name: "Atk", stats: { attack: 10, atkBonus: 50, ac: 10 },
  equipped: { weapon }, activeEffects: [], position: { q: 0, r: 0 }, currentHp: 50, maxHp: 50,
});
const mkTgt = () => ({
  name: "Tgt", stats: { attack: 0, atkBonus: 0, ac: 10 },
  equipped: {}, activeEffects: [], rawAbilities: {}, position: { q: 1, r: 0 }, currentHp: 100, maxHp: 100,
});

// ── parseCrit() table ──────────────────────────────────────────────────────────────────
ok(JSON.stringify(parseCrit(undefined)) === JSON.stringify({ lo: 20, mult: 2 }), "parseCrit(undefined) → {20,×2} (SRD default)");
ok(JSON.stringify(parseCrit("19-20")) === JSON.stringify({ lo: 19, mult: 2 }), "parseCrit('19-20') → {19,×2}");
ok(JSON.stringify(parseCrit("18-20")) === JSON.stringify({ lo: 18, mult: 2 }), "parseCrit('18-20') → {18,×2}");
ok(JSON.stringify(parseCrit("×3")) === JSON.stringify({ lo: 20, mult: 3 }), "parseCrit('×3') → {20,×3}");
ok(JSON.stringify(parseCrit("x3")) === JSON.stringify({ lo: 20, mult: 3 }), "parseCrit('x3') (ascii) → {20,×3}");
ok(JSON.stringify(parseCrit("19-20/×3")) === JSON.stringify({ lo: 19, mult: 3 }), "parseCrit combined '19-20/×3' → {19,×3}");

// resolve the live weapon profiles from gear-ext WEAPON_DICE
ok(weaponCritFor(mkAtk("boarding-axe")).mult === 3, "boarding-axe resolves to a ×3 weapon (from WEAPON_DICE)");
ok(weaponCritFor(mkAtk("cutlass")).lo === 18, "cutlass resolves to an 18-20 crit range (from WEAPON_DICE)");

// ── THE DIVIDE-OUT GUARD: ×3 weapon, natural 20 ─────────────────────────────────────────
// base 10 → weapon ×3 = 30. NOT 20 (engine's bare ×2), NOT 60 (the bug: engine ×2 THEN weapon ×3).
{
  const r = strike(mkAtk("boarding-axe"), mkTgt(), { nat: 20, distance: 1 });
  ok(r.hit && r.crit === true, "×3 weapon nat-20 is a crit");
  ok(r.damage === 30, `×3 weapon nat-20 deals 3× base = 30 (got ${r.damage})`);
  ok(r.damage !== 60, "DIVIDE-OUT proven: NOT 60 (engine ×2 was removed before applying weapon ×3)");
  ok(r.damage !== 20, "weapon ×3 actually applied: NOT the engine's bare ×2 = 20");
}

// ×3 weapon, natural 19 → outside its [20,20] crit range → ordinary hit (×1) = 10.
{
  const r = strike(mkAtk("boarding-axe"), mkTgt(), { nat: 19, distance: 1 });
  ok(r.hit && r.crit === false && r.damage === 10, `×3 weapon nat-19 is a normal hit = 10 (got ${r.damage}, crit ${r.crit})`);
}

// ── EXTENDED RANGE: cutlass (18-20, ×2) ─────────────────────────────────────────────────
// The bare engine would NOT crit on 18 or 19; the weapon range must. base 10 → ×2 = 20.
{
  const r18 = strike(mkAtk("cutlass"), mkTgt(), { nat: 18, distance: 1 });
  ok(r18.hit && r18.crit === true && r18.damage === 20, `cutlass nat-18 crits ×2 = 20 (engine alone wouldn't) (got ${r18.damage}, crit ${r18.crit})`);
  const r19 = strike(mkAtk("cutlass"), mkTgt(), { nat: 19, distance: 1 });
  ok(r19.crit === true && r19.damage === 20, `cutlass nat-19 crits ×2 = 20 (got ${r19.damage})`);
  const r17 = strike(mkAtk("cutlass"), mkTgt(), { nat: 17, distance: 1 });
  ok(r17.crit === false && r17.damage === 10, `cutlass nat-17 is a normal hit = 10 (got ${r17.damage})`);
  const r20 = strike(mkAtk("cutlass"), mkTgt(), { nat: 20, distance: 1 });
  ok(r20.crit === true && r20.damage === 20, `cutlass nat-20 stays ×2 = 20 — no double-apply (got ${r20.damage})`);
}

// ── DEFAULT weapon (no crit field) keeps the verbatim engine behaviour ───────────────────
{
  const r20 = strike(mkAtk(null), mkTgt(), { nat: 20, distance: 1 });
  ok(r20.crit === true && r20.damage === 20, `no-weapon nat-20 = engine ×2 = 20 (unchanged) (got ${r20.damage})`);
  const r10 = strike(mkAtk(null), mkTgt(), { nat: 10, distance: 1 });
  ok(r10.hit && r10.crit === false && r10.damage === 10, `no-weapon nat-10 is a normal hit = 10 (got ${r10.damage})`);
  const r1 = strike(mkAtk(null), mkTgt(), { nat: 1, distance: 1 });
  ok(r1.hit === false && r1.crit === false, "natural 1 is an auto-miss (no crit)");
}

// ── forecast(): EXACT, NO-MUTATION read-out ─────────────────────────────────────────────
{
  const tgt = mkTgt();
  const f = forecast(mkAtk("cutlass"), tgt);
  // attacker hits on every face 2..20 (huge to-hit), nat 1 misses → 19/20 = 0.95
  ok(Math.abs(f.hitPct - 0.95) < 1e-9, `forecast hitPct = 0.95 (got ${f.hitPct})`);
  // cutlass 18-20 → faces {18,19,20} crit, all hit → 3/20 = 0.15
  ok(Math.abs(f.critPct - 0.15) < 1e-9, `forecast critPct = 0.15 for an 18-20 weapon (got ${f.critPct})`);
  ok(f.flatDmg === 10, `forecast flatDmg = 10 (normal hit) (got ${f.flatDmg})`);
  ok(f.critDmg === 20, `forecast critDmg = 20 (×2) (got ${f.critDmg})`);
  ok(f.hpAfter === 90, `forecast hpAfter = 100-10 = 90 (got ${f.hpAfter})`);
  ok(tgt.currentHp === 100 && tgt.activeEffects.length === 0, "forecast() mutates NOTHING (target untouched)");

  const fAxe = forecast(mkAtk("boarding-axe"), mkTgt());
  ok(Math.abs(fAxe.critPct - 0.05) < 1e-9, `forecast critPct = 0.05 for a ×3/nat-20-only weapon (got ${fAxe.critPct})`);
  ok(fAxe.critDmg === 30, `forecast critDmg = 30 (×3) (got ${fAxe.critDmg})`);
}

console.log(fails === 0 ? "\nCRIT-RANGE UNIT TEST: ALL PASS ✅" : `\n${fails} CRIT CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
