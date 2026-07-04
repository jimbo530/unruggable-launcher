// Smoke test (P2c): spells-catalog merges into SPELLS; the 3 ToT spells stay VERBATIM.
// Run: node game/seas/battle-grid/smoke-spells.mjs
import { SPELLS } from "./units.js";
import { SPELLS as BASE } from "./tot-engine.js";
import { SPELL_CATALOG } from "./spells-catalog.js";
import { SEA_SPELLS } from "./bestiary-sea.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };

// The 3 originals must be byte-for-byte the tot-engine source (deep-equal).
for (const id of ["magic_missile", "burning_hands", "ray_of_frost"])
  ok(JSON.stringify(SPELLS[id]) === JSON.stringify(BASE[id]), `${id} is VERBATIM from tot-engine.js`);

// Whole SRD catalog merged in.
for (const id of Object.keys(SPELL_CATALOG)) ok(!!SPELLS[id], `catalog "${id}" present in SPELLS`);
// Caster-monster (sea) spells merged in.
for (const id of Object.keys(SEA_SPELLS)) ok(!!SPELLS[id], `sea spell "${id}" present in SPELLS`);

// A few specific new entries with the expected shape.
ok(SPELLS.fireball && SPELLS.fireball.battle.hexArea === 2, "fireball merged (hexArea 2)");
ok(SPELLS.cure_light_wounds && SPELLS.cure_light_wounds.battle.type === "healing", "cure_light_wounds is healing-typed");
ok(SPELLS.bless && SPELLS.bless.battle.type === "buff", "bless is buff-typed");
ok(SPELLS.ink_spray && SPELLS.ink_spray.battle.damageType === "acid", "ink_spray (kraken) merged");

const total = Object.keys(SPELLS).length;
ok(total >= Object.keys(SPELL_CATALOG).length, `SPELLS is a superset (${total} entries)`);

console.log(fails === 0 ? "\nALL SPELL CHECKS PASS ✅" : `\n${fails} CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
