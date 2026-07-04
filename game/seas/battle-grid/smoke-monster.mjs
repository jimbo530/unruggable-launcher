// Smoke test (P1a/P1b): multi-enemy N-vs-N squads spawn carrying the FULL buildUnit shape,
// across BOTH bestiaries, via the area-encounters group path. Run:
//   node game/seas/battle-grid/smoke-monster.mjs
import { makeSquadBattle } from "./units.js";
import { rollEncounter, mulberry32 } from "./area-encounters.js";
import { resolveMonster, enemySpawnHexes } from "./monster-bridge.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };

// Every field game.js showStats()/loadOf()/combat reads on ANY unit (incl. a foe's turn).
const FULL = ["qualified", "engineStats", "endowment", "equipped", "baseStats", "baseMaxHp",
  "baseAttackRange", "baseMovementHexes", "baseCastingMod", "stats", "rawAbilities", "position",
  "currentHp", "maxHp", "attackRange", "movementHexes", "casterLevel", "castingAbilityMod",
  "availableSpells", "bracket", "totalLevel", "spellDC"];
const shapeOk = (u) => FULL.every((k) => u[k] !== undefined);
const missing = (u) => FULL.filter((k) => u[k] === undefined);

// 1) direct bestiary-key squad: 5 bilge rats vs the demo player
const rats = makeSquadBattle(["bilge_rat", "bilge_rat", "bilge_rat", "bilge_rat", "bilge_rat"], { mode: "encounter" });
ok(rats.units.length === 6, `5-rat squad → 6 units (got ${rats.units.length})`);
const hx = rats.units.map((u) => `${u.position.q},${u.position.r}`);
ok(new Set(hx).size === hx.length, "all spawn hexes unique (no overlap)");
const sides = new Set(rats.units.map((u) => u.isPlayer));
ok(sides.has(true) && sides.has(false), "checkWin-style side set has BOTH true and false (N-vs-N safe)");
const bad = rats.units.slice(1).find((u) => !shapeOk(u));
ok(!bad, bad ? `monster MISSING fields: ${missing(bad).join(", ")}` : "every monster carries the FULL buildUnit shape (showStats safe)");

// 2) cross-bestiary id resolution (the area-encounters → bestiary contract)
ok(resolveMonster("bilge_rat").kind === "sea", "bilge_rat → sea bestiary");
ok(resolveMonster("goblin_spearman").key === "goblin_spear", "goblin_spearman → goblin_spear (dungeon alias)");
ok(resolveMonster("skeleton_boarder").key === "Skeleton Crew", "skeleton_boarder → Skeleton Crew (sea alias)");
ok(resolveMonster("kraken_tentacle").kind === "sea", "kraken_tentacle → sea");
let threw = false; try { resolveMonster("not_a_monster"); } catch (e) { threw = true; }
ok(threw, "unknown monster id THROWS (loud, never a silent no-spawn)");

// 3) placement helper never stacks, stays on the 9x7 deck, avoids taken hexes
const taken = new Set(["1,5"]);
const hexes = enemySpawnHexes(12, taken);
ok(hexes.length === 12 && new Set(hexes.map((h) => `${h.q},${h.r}`)).size === 12, "enemySpawnHexes → 12 distinct hexes");
ok(hexes.every((h) => h.q >= 0 && h.q < 9 && h.r >= 0 && h.r < 7) && !hexes.some((h) => h.q === 1 && h.r === 5),
  "all hexes in the 9×7 grid + the taken player hex (1,5) is avoided");

// 4) area-encounters rollEncounter() → squad, for the 3 wishlist groups (rats / goblins / kraken)
for (const [area, danger, gid] of [["ship-bilge", 1, "bilge_rat_swarm"], ["sea-caves", 3, "goblin_pack"], ["deep-sea", 4, "kraken"]]) {
  let enc = null;
  for (let s = 1; s < 500 && !enc; s++) { const e = rollEncounter(area, danger, mulberry32(s)); if (e.type === "pve" && e.groupId === gid) enc = e; }
  ok(!!enc, `${area} can roll ${gid}`);
  if (enc) {
    const sq = makeSquadBattle(enc, { mode: "encounter", objective: enc.objective });
    ok(sq.units.length === enc.group.length + 1, `${gid}: ${enc.group.length} foes + 1 player = ${sq.units.length} units`);
    ok(sq.units.slice(1).every(shapeOk), `${gid}: every foe carries the full shape`);
    const p = sq.units.map((u) => `${u.position.q},${u.position.r}`);
    ok(new Set(p).size === p.length, `${gid}: all hexes unique`);
    console.log(`      [${gid}] ${sq.units.slice(1).map((u) => u.name).join(", ")}`);
  }
}

console.log(fails === 0 ? "\nALL MONSTER CHECKS PASS ✅" : `\n${fails} CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
