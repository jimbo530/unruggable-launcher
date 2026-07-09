// test-skills.mjs — SKILLS ledger: shift-accrual on a CRAFT job, no skill xp for unskilled/copper labor,
//   level thresholds, corrupt-JSON reset warns, skillForJob determinism, addSkillXp guards.
//   node game/lib/test-skills.mjs
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
const S = await import("./skills.js");
const J = await import("./jobs-loop.js");
const { getJob, SETTLEMENTS, TIER } = await import("./settlements.js");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗", m); } };
const t0 = 1_000_000_000_000, SH = J.SHIFT_MS;

// ── registry sanity ──────────────────────────────────────────────────────────────────────
ok(Object.keys(S.SKILLS).length === 6, "6 skills registered");
ok(S.SKILLS.smithing.coin === "gold" && S.SKILLS.alchemy.coin === "gold", "smithing & alchemy both pay GOLD (founder: same coin, different skills)");
ok(S.SKILLS.smithing.stats.join() === "STR,CON" && S.SKILLS.alchemy.stats.join() === "INT,WIS", "governing stat pairs wired");
ok(S.SKILLS.tailoring.coin === "copper", "tailoring = copper-tier refinement");

// ── skillForJob mapping is DETERMINISTIC (jobId string OR job object, same answer) ─────────
ok(S.skillForJob("milling") === "carpentry", "milling → carpentry");
ok(S.skillForJob(getJob("milling")) === "carpentry", "milling job-object → carpentry (same as id)");
ok(S.skillForJob("vinekeeping") === "alchemy", "vinekeeping → alchemy");
ok(S.skillForJob("haul_cargo") === null, "haul_cargo = unskilled labor → null");
ok(S.skillForJob("guard_port") === null, "guard_port (copper commons) → null");
ok(S.skillForJob("logging") === null, "raw logging → null (unskilled, stat-only)");
ok(S.skillForJob(null) === null, "null job → null (no throw)");

// ── addSkillXp accrual + guards ────────────────────────────────────────────────────────────
ok(S.addSkillXp("q1", "smithing", 25) === 25, "addSkillXp returns new total");
ok(S.addSkillXp("q1", "smithing", 15) === 40, "addSkillXp accumulates");
ok(S.skillsOf("q1").smithing === 40, "skillsOf reflects ledger");
let threw = false; try { S.addSkillXp("q1", "not_a_skill", 5); } catch { threw = true; }
ok(threw, "addSkillXp THROWS on unknown skill (no silent drop)");
threw = false; try { S.addSkillXp("q1", "smithing", -3); } catch { threw = true; }
ok(threw, "addSkillXp THROWS on negative amount");
threw = false; try { S.addSkillXp("q1", "smithing", NaN); } catch { threw = true; }
ok(threw, "addSkillXp THROWS on NaN amount");

// ── level thresholds: level = floor(sqrt(xp/10)) ───────────────────────────────────────────
mem.clear();
ok(S.skillLevel("lv", "smithing") === 0, "untrained skill = level 0");
S.addSkillXp("lv", "smithing", 10); ok(S.skillLevel("lv", "smithing") === 1, "10 xp → L1");
S.addSkillXp("lv", "smithing", 30); ok(S.skillLevel("lv", "smithing") === 2, "40 xp → L2");
S.addSkillXp("lv", "smithing", 50); ok(S.skillLevel("lv", "smithing") === 3, "90 xp → L3");
S.addSkillXp("lv", "smithing", 160); ok(S.skillLevel("lv", "smithing") === 5, "250 xp → L5");

// ── WIRING: a CRAFT job accrues skill water on collect; an UNSKILLED job does NOT ──────────
mem.clear();
// Seed a runtime MILL settlement (production jobs aren't dev-seeded — they're player-built). tier=MILL
// → statRate 1×, so a shift grants exactly XP_PER_SHIFT skill xp, easy to assert. Offers milling (→
// carpentry, SKILLED) and logging (UNSKILLED → null).
SETTLEMENTS.test_mill = { id: "test_mill", name: "Test Mill", tier: TIER.MILL, loc: 9999, jobs: { milling: 20, logging: 20 } };

// SKILLED job: milling → carpentry
let r = J.applyForWork("m1", "test_mill", "milling", t0);
ok(r.ok, "applied to milling (skilled craft job)");
const cm = J.collectShift("m1", t0 + SH + 1);
ok(cm.ok && cm.stat === "CON" && cm.xp === 1, "milling collect grants CON stat xp (unchanged path)");
ok(cm.skill === "carpentry" && cm.skillXp === 1, "milling collect ALSO grants carpentry skill xp (=stat gain)");
ok(S.skillsOf("m1").carpentry === 1, "carpentry skill water persisted for m1");
J.collectShift("m1", t0 + 2 * SH + 2);
ok(S.skillsOf("m1").carpentry === 2, "second milling shift → carpentry 2 (keeps accruing)");

// UNSKILLED job at the SAME mill: logging → NO skill water, stat only
r = J.applyForWork("m2", "test_mill", "logging", t0);
ok(r.ok, "applied to logging (unskilled labor)");
const cl = J.collectShift("m2", t0 + SH + 1);
ok(cl.ok && cl.stat === "STR", "logging collect grants STR stat xp");
ok(cl.skill === null && cl.skillXp === 0, "logging collect grants NO skill water (unskilled → null)");
ok(Object.keys(S.skillsOf("m2")).length === 0, "m2 has an EMPTY skill ledger (never crafted)");

// ── corrupt-JSON reset WARNS (no silent catch) and recovers to empty ledger ─────────────────
mem.set("sts_skills", "{not valid json");
const warns = [];
const origWarn = console.warn; console.warn = (...a) => warns.push(a.join(" "));
const recovered = S.skillsOf("whoever"); // triggers readJSON → warn + fallback {}
console.warn = origWarn;
ok(warns.some((w) => w.includes("bad JSON") && w.includes("sts_skills")), "corrupt sts_skills WARNS (visible failure)");
ok(JSON.stringify(recovered) === "{}", "corrupt ledger recovers to empty object");
// and a subsequent write repairs the store
S.addSkillXp("whoever", "cooking", 7);
ok(S.skillsOf("whoever").cooking === 7, "ledger writable again after corrupt-reset");

console.log(`\n${fail === 0 ? "✅" : "❌"} skills tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
