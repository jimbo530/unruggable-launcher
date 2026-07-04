// chokepoint.mjs — P6 GREP-GUARD: the verbatim engine attack/spell resolvers
// (resolveAttack / resolveSpellCast / resolveAttackExt / rollD20) must live ONLY in
// combat-helpers.js among the battle DRIVER files. game.js must route EVERY swing + cast through
// the chokepoint (strike() / castWrapped() / forecast()), never the engine directly — so the
// per-weapon crit ranges, the forecast HUD, and the AI all have a single home.
//
// (game.js can't be imported in node — it touches the DOM at load — so this reads it as text.)
//
// Run: node game/seas/battle-grid/chokepoint.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), "utf8");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };

const game = read("game.js");
const helpers = read("combat-helpers.js");

// 1) game.js (the driver) must NOT reference any raw engine resolver — fully routed via the chokepoint.
for (const tok of ["resolveAttackExt", "resolveAttack", "resolveSpellCast", "rollD20"]) {
  ok(!game.includes(tok), `game.js is free of "${tok}" (routed through combat-helpers.js)`);
}

// 2) game.js DOES call the chokepoint + planner API.
for (const tok of ["strike(", "castWrapped(", "forecast(", "planIntent(", "chooseTarget("]) {
  ok(game.includes(tok), `game.js calls the chokepoint API "${tok}"`);
}

// 3) combat-helpers.js IS the single home of the engine resolvers.
ok(helpers.includes("resolveAttackExt"), "combat-helpers.js owns resolveAttackExt (the attack chokepoint)");
ok(helpers.includes("resolveSpellCast"), "combat-helpers.js owns resolveSpellCast (the spell chokepoint)");
ok(helpers.includes("rollD20"), "combat-helpers.js owns rollD20 (strike() rolls the d20)");

console.log(fails === 0 ? "\nCHOKEPOINT GUARD: ALL PASS ✅" : `\n${fails} GUARD CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
