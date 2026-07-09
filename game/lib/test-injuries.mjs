// node lib/test-injuries.mjs — wounds + battle energy clocks.
import {
  recordBattleDamage, currentDeficit, healWound, hoursToMend,
  energyOf, spendEnergy, grantEnergy, hoursToNextEnergy,
  HEAL_HP_PER_HOUR, MAX_ENERGY, ENERGY_REGEN_HOURS,
} from "./injuries.js";

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok  " : "  FAIL") + " - " + msg); if (!cond) fails++; };
const HOUR = 3600 * 1000;
const T0 = 1_800_000_000_000; // fixed clock — the tests own time

// wounds
ok(currentDeficit("w1", T0) === 0, "fresh pawn has no wounds");
recordBattleDamage("w1", 6, T0);
ok(currentDeficit("w1", T0) === 6, "battle damage carries out of the fight");
ok(Math.abs(currentDeficit("w1", T0 + HOUR) - (6 - HEAL_HP_PER_HOUR)) < 1e-9, "wounds heal on the real clock");
ok(currentDeficit("w1", T0 + 10 * HOUR) === 0, "fully mended after enough hours");
recordBattleDamage("w1", 4, T0 + HOUR);
ok(Math.abs(currentDeficit("w1", T0 + HOUR) - (4 + 6 - HEAL_HP_PER_HOUR)) < 1e-9, "new wounds stack on the healed remainder");
healWound("w1", 3, T0 + HOUR);
ok(Math.abs(currentDeficit("w1", T0 + HOUR) - (8 - 3)) < 1e-9, "potions close the gap instantly");
ok(Math.abs(hoursToMend("w1", T0 + HOUR) - 5 / HEAL_HP_PER_HOUR) < 1e-9, "hoursToMend math");
let threw = false; try { recordBattleDamage("w1", -2, T0); } catch { threw = true; }
ok(threw, "negative damage throws");

// energy
ok(energyOf("e1", T0) === MAX_ENERGY, "rested pawn has a full pool");
spendEnergy("e1", T0); spendEnergy("e1", T0); spendEnergy("e1", T0);
ok(energyOf("e1", T0) === 0, "three fights drain the pool");
threw = false; try { spendEnergy("e1", T0); } catch { threw = true; }
ok(threw, "empty pool THROWS (rest or chrono orb) — never a silent fight");
const later = T0 + ENERGY_REGEN_HOURS * HOUR;
ok(Math.abs(energyOf("e1", later) - 1) < 1e-9, "one energy back per regen window");
spendEnergy("e1", later);
ok(energyOf("e1", later) < 1, "regenned point is spendable");
grantEnergy("e1", MAX_ENERGY, later);
ok(energyOf("e1", later) === MAX_ENERGY, "chrono orb refill tops the pool");
ok(hoursToNextEnergy("e1", later) === 0, "full pool = nothing ticking");
spendEnergy("e1", later);
ok(Math.abs(hoursToNextEnergy("e1", later) - ENERGY_REGEN_HOURS) < 1e-9, "next point ETA = one regen window");

console.log(fails ? "\n" + fails + " FAILURES" : "\nall good");
process.exit(fails ? 1 : 0);
