// Smoke test: the equip system changes combat stats (the fight data path).
//   P1c — 7-slot flat gear  ·  P2b — ability-score mods + weapon dice
// Run: node game/seas/battle-grid/smoke-equip.mjs
//
// NOTE: this file was rewritten during the v2 content wiring. The previous version pinned
// item ids (cutlass/captains_coat/boarding_pike/beacon_lantern) that never existed in the
// generated armory, so it failed 7/10 even before these edits. It now exercises REAL ids
// that exist after gear-ext.js is merged into ITEMS (see items.js), plus the new features.
import { makeStarterUnits } from "./units.js";
import { equipItem, equippedList, ITEMS, SLOTS } from "./items.js";
import { resolveAttack } from "./tot-engine.js";
import { resolveAttackExt, weaponDiceExpr } from "./combat-ext.js";
import { pawnCapacity } from "../../lib/weight.js";

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✔ " : "  ✘ ") + msg); if (!cond) fails++; };

// ── P1c: 7 slots + flat mods ────────────────────────────────────────────────────
const [barb, wiz] = makeStarterUnits();
ok(SLOTS.length === 7, `7-slot paper doll (${SLOTS.join("/")})`);
ok(Object.keys(barb.equipped).length === 7, "unit seeds all 7 equipped slots");

const b0 = { atk: barb.stats.atkBonus, dmg: barb.stats.attack, ac: barb.stats.ac, hp: barb.maxHp, move: barb.movementHexes };
console.log("Barbarian base:", b0);

equipItem(barb, "cutlass");       // weapon  : +2 dmg, +1 to-hit
equipItem(barb, "iron-buckler");  // offhand : +1 AC      (NEW slot)
equipItem(barb, "healers-kit");   // trinket : +4 HP
equipItem(barb, "sea-boots");     // boots   : +1 move     (NEW slot)
console.log("Barbarian equipped:", { gear: equippedList(barb).map((g) => g.name), atkBonus: barb.stats.atkBonus, attack: barb.stats.attack, ac: barb.stats.ac, maxHp: barb.maxHp, move: barb.movementHexes });

ok(barb.stats.attack === b0.dmg + 2, `attack ${b0.dmg} → ${barb.stats.attack} (+2 cutlass)`);
ok(barb.stats.atkBonus === b0.atk + 1, `to-hit ${b0.atk} → ${barb.stats.atkBonus} (+1 cutlass)`);
ok(barb.stats.ac === b0.ac + 1, `AC ${b0.ac} → ${barb.stats.ac} (+1 iron-buckler, NEW offhand slot)`);
ok(barb.maxHp === b0.hp + 4, `maxHp ${b0.hp} → ${barb.maxHp} (+4 healers-kit)`);
ok(barb.movementHexes === b0.move + 1, `move ${b0.move} → ${barb.movementHexes} (+1 sea-boots, NEW boots slot)`);

// toggle the cutlass off — stats revert from base (non-destructive)
equipItem(barb, "cutlass");
ok(barb.stats.attack === b0.dmg, `attack reverts to ${b0.dmg} when cutlass stowed (${barb.stats.attack})`);

// swapping weapon in the same slot replaces, not stacks
equipItem(barb, "cutlass");
equipItem(barb, "boarding-axe");  // replaces cutlass in the weapon slot
ok(barb.equipped.weapon === "boarding-axe", `weapon slot replaced → ${barb.equipped.weapon}`);
ok(barb.stats.attack === b0.dmg + 2, `boarding-axe gives +2 dmg only (no cutlass stack): ${barb.stats.attack}`);

// caster: lantern raises real spell power
const w0 = wiz.castingAbilityMod;
equipItem(wiz, "lantern");        // +1 to-hit, +1 spell
ok(wiz.castingAbilityMod === w0 + 1, `wizard spell power ${w0} → ${wiz.castingAbilityMod} (+1 lantern)`);

// ── P2b: ability-score gear re-derives the bridge (raises attack AND carry) ───────
const [barb2] = makeStarterUnits();
const a0 = barb2.stats.attack, str0 = barb2.engineStats.STR, cap0 = pawnCapacity(str0);
equipItem(barb2, "gauntlets-ogre-power");   // trinket : +2 STR
ok(barb2.engineStats.STR === str0 + 2, `STR ${str0} → ${barb2.engineStats.STR} (+2 gauntlets)`);
ok(barb2.stats.attack === a0 + 1, `attack ${a0} → ${barb2.stats.attack} (+2 STR ⇒ +1 dmg, re-derived)`);
ok(pawnCapacity(barb2.engineStats.STR) > cap0, `pawnCapacity ${cap0} → ${pawnCapacity(barb2.engineStats.STR)} (carry rises with STR)`);
equipItem(barb2, "gauntlets-ogre-power");   // off
ok(barb2.stats.attack === a0 && barb2.engineStats.STR === str0, "gauntlets removed ⇒ reverts to base exactly");

// ── P2b: weapon DICE via combat-ext (verbatim engine + a rolled die) ─────────────
// Inject a dice weapon (no flat mods.attack, so STR-base + die is counted once).
ITEMS.test_dice_blade = { id: "test_dice_blade", name: "Test Dice Blade", slot: "weapon", emoji: "🗡️", gold: 1, weight: 1, mods: {}, dmgDice: "1d6" };
const [barb3] = makeStarterUnits();
const dummy = { stats: { ac: 1 }, rawAbilities: {}, activeEffects: [] };
const base3 = barb3.stats.attack;
ok(!weaponDiceExpr(barb3.equipped.weapon), "no dice weapon equipped → flat path");
ok(resolveAttack(barb3, dummy, 18, 1).damage === base3, `flat resolveAttack dmg = base (${base3})`);
equipItem(barb3, "test_dice_blade");
ok(weaponDiceExpr("test_dice_blade") === "1d6", "dmgDice weapon resolves to 1d6");
let lo = 99, hi = 0;
for (let i = 0; i < 80; i++) { const r = resolveAttackExt(barb3, dummy, 18, 1); if (r.hit) { lo = Math.min(lo, r.damage); hi = Math.max(hi, r.damage); } }
ok(lo >= base3 + 1 && hi <= base3 + 6 && hi > lo, `dice swing varies ${base3}+1..${base3}+6 (got ${lo}..${hi})`);
ok(resolveAttackExt(barb3, dummy, 18, 1).diceBreakdown !== undefined, "resolveAttackExt reports the die roll");

console.log(fails === 0 ? "\nALL EQUIP CHECKS PASS ✅" : `\n${fails} CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
