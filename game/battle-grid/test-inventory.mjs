// test-inventory.mjs — proves the count-based inventory + fallen-weapon rule.
//   node game/battle-grid/test-inventory.mjs
// Shims localStorage BEFORE importing items.js so the count mutations are exercised.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const {
  ITEMS, inventory, gearCount, addGear, removeGear, ownedGear,
  bestSpareWeapon, resolveFallenWeapon,
} = await import("./items.js");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗", msg); } };

// pick two distinct real weapon ids from the generated armory
const weaponIds = Object.keys(ITEMS).filter((id) => ITEMS[id].slot === "weapon");
const [wA, wB] = weaponIds.slice(0, 2);
ok(wA && wB && wA !== wB, `found two weapon ids (${wA}, ${wB})`);

// ── counts: add / count / remove ─────────────────────────────────────────────
mem.clear();
ok(gearCount(wA) === 0, "starts empty");
addGear(wA, 3);
ok(gearCount(wA) === 3, "addGear(3) → 3");
ok(removeGear(wA, 1) === 1, "removeGear(1) returns 1 removed");
ok(gearCount(wA) === 2, "→ 2 left");
ok(removeGear(wA, 99) === 2, "removeGear over-asks → removes only what's there (2)");
ok(gearCount(wA) === 0, "→ 0 left");
ok(!ownedGear().has(wA), "ownedGear() excludes zero-count items");

// ── legacy array migration ───────────────────────────────────────────────────
mem.clear();
mem.set("sts_gear", JSON.stringify([wA, wB, wA])); // old Set-ish format w/ a dup
ok(gearCount(wA) === 2 && gearCount(wB) === 1, "legacy array migrates to counts");
ok(ownedGear().has(wA) && ownedGear().has(wB), "ownedGear() reads migrated data");

// ── bestSpareWeapon picks the strongest owned weapon ─────────────────────────
mem.clear();
const score = (id) => (ITEMS[id].mods?.attack || 0) + (ITEMS[id].mods?.atkBonus || 0);
const strong = weaponIds.reduce((a, b) => (score(b) > score(a) ? b : a));
addGear(strong, 1); addGear(wA, 1);
ok(bestSpareWeapon() === strong, `bestSpareWeapon() = strongest owned (${strong})`);

// ── player pawn falls → loses carried weapon, auto-equips a spare ────────────
mem.clear();
addGear(wA, 2);                                  // carrying wA, one spare of wA
let r = resolveFallenWeapon({ weaponId: wA, fallenIsPlayer: true, winnerGetsIt: false });
ok(r.lostId === wA, "player fall: weapon lost");
ok(gearCount(wA) === 1, "→ inventory down by exactly 1 (spare remains)");
ok(r.reEquipId === wA, "→ auto-equips the remaining spare");

mem.clear();
addGear(wA, 1);                                  // carrying wA, NO spare
r = resolveFallenWeapon({ weaponId: wA, fallenIsPlayer: true, winnerGetsIt: true });
ok(gearCount(wA) === 0 && r.reEquipId === null, "player fall, no spare → bare (reEquipId null)");

// ── enemy pawn falls → 50/50 loot vs house sink ──────────────────────────────
mem.clear();
r = resolveFallenWeapon({ weaponId: wB, fallenIsPlayer: false, winnerGetsIt: true });
ok(r.lootedId === wB && gearCount(wB) === 1, "enemy fall + win-roll → player loots weapon");
mem.clear();
r = resolveFallenWeapon({ weaponId: wB, fallenIsPlayer: false, winnerGetsIt: false });
ok(r.toHouse === true && gearCount(wB) === 0, "enemy fall + house-roll → sink (no loot)");

console.log(`\n${fail === 0 ? "✅" : "❌"} inventory/fall tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
