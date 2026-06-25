// Smoke test: prove the equip system changes combat stats (the fight data path).
// Run: node game/battle-grid/smoke-equip.mjs
import { makeStarterUnits } from "./units.js";
import { equipItem, equippedList } from "./items.js";

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✔ " : "  ✘ ") + msg); if (!cond) fails++; };

const [barb, wiz] = makeStarterUnits();

console.log("Barbarian base:", { atkBonus: barb.stats.atkBonus, attack: barb.stats.attack, ac: barb.stats.ac, maxHp: barb.maxHp, range: barb.attackRange });
const b0 = { atk: barb.stats.atkBonus, dmg: barb.stats.attack, ac: barb.stats.ac, hp: barb.maxHp };

equipItem(barb, "cutlass");       // +2 dmg, +1 to-hit
equipItem(barb, "captains_coat"); // +1 AC, +4 HP
equipItem(barb, "spyglass");      // +1 reach, +1 to-hit
console.log("Barbarian equipped:", { gear: equippedList(barb).map(g => g.name), atkBonus: barb.stats.atkBonus, attack: barb.stats.attack, ac: barb.stats.ac, maxHp: barb.maxHp, range: barb.attackRange });

ok(barb.stats.attack === b0.dmg + 2, `attack ${b0.dmg} → ${barb.stats.attack} (+2 cutlass)`);
ok(barb.stats.atkBonus === b0.atk + 2, `to-hit ${b0.atk} → ${barb.stats.atkBonus} (+1 cutlass +1 spyglass)`);
ok(barb.stats.ac === b0.ac + 1, `AC ${b0.ac} → ${barb.stats.ac} (+1 coat)`);
ok(barb.maxHp === b0.hp + 4, `maxHp ${b0.hp} → ${barb.maxHp} (+4 coat)`);
ok(barb.attackRange === 2, `reach 1 → ${barb.attackRange} (+1 spyglass)`);

// toggle off the cutlass — stats revert from base (non-destructive)
equipItem(barb, "cutlass");
ok(barb.stats.attack === b0.dmg, `attack reverts to ${b0.dmg} when cutlass stowed (${barb.stats.attack})`);
ok(barb.stats.atkBonus === b0.atk + 1, `to-hit now ${barb.stats.atkBonus} (spyglass only)`);

// swapping weapon in same slot replaces, not stacks
equipItem(barb, "cutlass");
equipItem(barb, "boarding_pike"); // replaces cutlass in weapon slot
ok(barb.equipped.weapon === "boarding_pike", `weapon slot replaced → ${barb.equipped.weapon}`);
ok(barb.stats.attack === b0.dmg + 1, `pike gives +1 dmg only (no cutlass stack): ${barb.stats.attack}`);

// caster: lantern raises real spell power
const w0 = wiz.castingAbilityMod;
equipItem(wiz, "beacon_lantern"); // +1 to-hit, +1 spell
ok(wiz.castingAbilityMod === w0 + 1, `wizard spell power ${w0} → ${wiz.castingAbilityMod} (+1 lantern)`);

console.log(fails === 0 ? "\nALL EQUIP CHECKS PASS ✅" : `\n${fails} CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
