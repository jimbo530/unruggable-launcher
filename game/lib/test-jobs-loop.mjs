// test-jobs-loop.mjs — labor market: apply → shift → collect (XP+wage), bunk caps, unlimited, leave.
//   node game/lib/test-jobs-loop.mjs
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
const J = await import("./jobs-loop.js");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗", m); } };
const t0 = 1_000_000_000_000, S = J.SHIFT_MS;

// apply to a Port Royal dock job (Haul Cargo / STR)
let r = J.applyForWork("p1", "port_royal", "haul_cargo", t0);
ok(r.ok, "apply to an open bunk");
ok(!J.applyForWork("p1", "port_royal", "mend_nets", t0).ok, "can't double-assign a pawn");
ok(J.shiftLeftSecs("p1", t0) === Math.ceil(S / 1000), "shift timer set");
ok(!J.collectShift("p1", t0).ok, "can't collect before shift done");

// collect after the shift → STR XP (city rate 5×) + silver wage
const c = J.collectShift("p1", t0 + S + 1);
ok(c.ok && c.stat === "STR" && c.xp === 5, `collect grants STR +5 (city 5× rate), got +${c.xp}`);
ok(c.coin === "silver" && c.wage === 5, "dock wage = 5 silver");
ok(J.trainedStats("p1").STR === 5, "trained STR persisted = 5");
ok(J.wages("p1").silver === 5, "earned 5 silver");
// it auto-restarted → another shift
J.collectShift("p1", t0 + 2 * S + 2);
ok(J.trainedStats("p1").STR === 10, "second shift → STR 10 (keeps working)");

// bunk caps — fill haul_cargo (cap 100) is big; test a small synthetic via occupancy/open math
ok(J.occupancy("port_royal", "haul_cargo") === 1, "occupancy counts the working pawn");
ok(J.openBunks("port_royal", "haul_cargo") === 99, "open bunks = cap(100) − 1");
// mayor is a 1-bunk OFFICE; guard_port is the UNLIMITED commons job
ok(J.openBunks("port_royal", "guard_port") === Infinity, "guard_port (commons) = unlimited bunks");
ok(J.openBunks("port_royal", "mayor") === 1, "mayor office = 1 bunk open");

// fill the single mayor seat → then it's full
ok(J.applyForWork("gov1", "port_royal", "mayor", t0).ok, "take the Mayor seat");
ok(J.openBunks("port_royal", "mayor") === 0, "Mayor seat now full (1 bunk)");
ok(!J.applyForWork("gov2", "port_royal", "mayor", t0).ok, "second pawn can't take a filled office");

// leave frees the bunk
J.leaveWork("gov1");
ok(J.openBunks("port_royal", "mayor") === 1, "leaving frees the office");

console.log(`\n${fail === 0 ? "✅" : "❌"} jobs-loop tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
