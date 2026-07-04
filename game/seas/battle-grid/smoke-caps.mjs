// smoke-caps.mjs — P2 CAP: prove clampGearContribution() holds gear (flat AND ability-score)
// to the GEAR_CAPS ceiling, leaves within-cap gear untouched, and passes penalties through.
//
// Run: node game/seas/battle-grid/smoke-caps.mjs
import { makeStarterUnits } from "./units.js";
import { ITEMS, equipItem, applyEquipment, clampGearContribution } from "./items.js";
import { GEAR_CAPS } from "./balance.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };

// ── synthetic OVER-CAP gear (injected like smoke-equip injects test_dice_blade) ─────────
// Mods vastly exceed every cap, so a correct clamp pins each field to base + its cap exactly.
ITEMS.test_overcap_weapon = {
  id: "test_overcap_weapon", name: "Over-Cap Blade", slot: "weapon", emoji: "🗡️", gold: 1, weight: 1,
  mods: { attack: 99, atkBonus: 99, ac: 99, maxHp: 9999, attackRange: 9, movementHexes: 9, castingMod: 9 },
};
ITEMS.test_overcap_ring = { // ability-score ONLY: a wildly out-of-range +STR (engine clamps eff score to 30)
  id: "test_overcap_ring", name: "Over-Cap Ring", slot: "ring", emoji: "💍", gold: 1, weight: 0, mods: { str: 30 },
};
ITEMS.test_penalty_armor = { // a penalty item: should pass through untouched (cap is an UPPER bound)
  id: "test_penalty_armor", name: "Cursed Plate", slot: "armor", emoji: "🥾", gold: 1, weight: 1, mods: { ac: -3 },
};

// ── 1) FLAT over-cap gear is pinned to base + cap ──────────────────────────────────────
const [barb] = makeStarterUnits();
const base = { ...barb.baseStats };
const baseMaxHp = barb.baseMaxHp, baseRange = barb.baseAttackRange, baseMove = barb.baseMovementHexes, baseCast = barb.baseCastingMod;
console.log("Barbarian base:", { attack: base.attack, atkBonus: base.atkBonus, ac: base.ac, maxHp: baseMaxHp, range: baseRange, move: baseMove });

equipItem(barb, "test_overcap_weapon");
ok(barb.stats.attack === base.attack + GEAR_CAPS.attack, `attack pinned to base+${GEAR_CAPS.attack} (${base.attack}→${barb.stats.attack})`);
ok(barb.stats.atkBonus === base.atkBonus + GEAR_CAPS.toHit, `to-hit pinned to base+${GEAR_CAPS.toHit} (${base.atkBonus}→${barb.stats.atkBonus})`);
ok(barb.stats.ac === base.ac + GEAR_CAPS.ac, `AC pinned to base+${GEAR_CAPS.ac} (${base.ac}→${barb.stats.ac})`);
ok(barb.maxHp === baseMaxHp + baseMaxHp, `maxHp pinned to base+base (${baseMaxHp}→${barb.maxHp}; "maxHp:base" cap = no more than 2×)`);
ok(barb.stats.hp === barb.maxHp, "stats.hp re-synced to clamped maxHp");
ok(barb.currentHp <= barb.maxHp, `currentHp (${barb.currentHp}) never exceeds clamped maxHp (${barb.maxHp})`);
ok(barb.attackRange === baseRange + GEAR_CAPS.range, `range pinned to base+${GEAR_CAPS.range} (${baseRange}→${barb.attackRange})`);
ok(barb.movementHexes === baseMove + GEAR_CAPS.move, `move pinned to base+${GEAR_CAPS.move} (${baseMove}→${barb.movementHexes})`);
ok(barb.castingAbilityMod === baseCast + GEAR_CAPS.castingMod, `spell power pinned to base+${GEAR_CAPS.castingMod} (${baseCast}→${barb.castingAbilityMod})`);

// stow it → everything returns to base (clamp is non-destructive)
equipItem(barb, "test_overcap_weapon");
ok(barb.stats.attack === base.attack && barb.stats.ac === base.ac && barb.maxHp === baseMaxHp, "over-cap weapon stowed ⇒ reverts to base exactly");

// ── 2) ABILITY-score gear is capped too (the headline guarantee) ───────────────────────
const [barb2] = makeStarterUnits();
const b2 = { ...barb2.baseStats };
equipItem(barb2, "test_overcap_ring");                       // +30 STR → engine clamps eff score to 30
ok(barb2.engineStats.STR === 30, `eff STR clamped to 30 by the engine (got ${barb2.engineStats.STR})`);
ok(barb2.stats.atkBonus <= b2.atkBonus + GEAR_CAPS.toHit, `ability-gear to-hit ≤ base+${GEAR_CAPS.toHit} (got ${barb2.stats.atkBonus}, base ${b2.atkBonus})`);
ok(barb2.stats.attack <= b2.attack + GEAR_CAPS.attack, `ability-gear attack ≤ base+${GEAR_CAPS.attack} (got ${barb2.stats.attack}, base ${b2.attack})`);
ok(barb2.stats.atkBonus === b2.atkBonus + GEAR_CAPS.toHit, `+30 STR DOES hit the to-hit ceiling (base+${GEAR_CAPS.toHit}=${b2.atkBonus + GEAR_CAPS.toHit})`);

// ── 3) WITHIN-cap gear is untouched (clamp only bites over-cap) ─────────────────────────
const [barb3] = makeStarterUnits();
const a3 = barb3.stats.attack;
equipItem(barb3, "cutlass");                                  // +2 dmg — well under the +6 cap
ok(barb3.stats.attack === a3 + 2, `within-cap cutlass unchanged by clamp (+2 → ${barb3.stats.attack})`);

// ── 4) PENALTY gear passes through (cap is an UPPER bound only) ─────────────────────────
const [barb4] = makeStarterUnits();
const ac4 = barb4.stats.ac;
equipItem(barb4, "test_penalty_armor");                       // −3 AC
ok(barb4.stats.ac === ac4 - 3, `penalty (−3 AC) preserved, not floored by the cap (${ac4}→${barb4.stats.ac})`);

// ── 5) clampGearContribution() is exported + idempotent ────────────────────────────────
const snap = JSON.stringify({ a: barb.stats.attack, ac: barb.stats.ac, hp: barb.maxHp });
clampGearContribution(barb); clampGearContribution(barb);
ok(JSON.stringify({ a: barb.stats.attack, ac: barb.stats.ac, hp: barb.maxHp }) === snap, "clampGearContribution() is idempotent (re-running changes nothing)");

console.log(fails === 0 ? "\nALL CAP CHECKS PASS ✅" : `\n${fails} CAP CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
