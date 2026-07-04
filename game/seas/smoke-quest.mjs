// Smoke test for the Seas Quest Ladder game-layer (quest-ladder.js).
//   Validates: the LOCKED 60-rung catalog (ids/names/tiers/pools) matches the registration
//   scripts, and the WATCHER bands progress + banks trophies with the locked run rules
//   (continuous run, lose-on-switch keeps banked trophies, versatility from distinct jobs,
//   loyalty/seadog stay pending). NO chain, NO network — pure logic + an in-memory store.
// Run: node game/seas/smoke-quest.mjs
import QuestLadder from "./quest-ladder.js";

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✔ " : "  ✘ ") + msg); if (!cond) fails++; };

// deterministic, isolated store (no localStorage in Node anyway, but make it explicit + resettable)
const mem = {};
QuestLadder.setStore({
  get: (k) => (mem[k] ? JSON.parse(mem[k]) : null),
  set: (k, v) => { mem[k] = JSON.stringify(v); },
  del: (k) => { delete mem[k]; },
});

// ── 1. CATALOG INTEGRITY ──────────────────────────────────────────────────────
console.log("catalog:");
const A = QuestLadder.ACHIEVEMENTS;
ok(A.length === 60, `60 achievements total (got ${A.length})`);
const ids = A.map((a) => a.id);
ok(new Set(ids).size === ids.length, "all ids unique");
ok(A.filter((a) => a.kind === "JOB").length === 42, "42 job-ladder rungs (7 jobs × 6)");
ok(A.filter((a) => a.kind === "SHIP").length === 18, "18 ship-ladder rungs (3 × 6)");

// exact locked names at key ids (mirror of register-achievements.cjs + register-guard-ladder.cjs)
const nameOf = (id) => (QuestLadder.byId(id) || {}).name;
ok(nameOf(101) === "Signed On the Docks", "101 = Signed On the Docks");
ok(nameOf(106) === "Cargo Baron", "106 = Cargo Baron (STR apex)");
ok(nameOf(206) === "Net Lord", "206 = Net Lord");
ok(nameOf(606) === "Merchant Prince", "606 = Merchant Prince (CHA apex)");
ok(nameOf(1001) === "Posted to the Watch", "1001 = Posted to the Watch (Guard rung 1)");
ok(nameOf(1006) === "Lord Protector of the Port", "1006 = Lord Protector of the Port (Guard apex)");
ok(nameOf(706) === "True Crew", "706 = True Crew (Loyalty apex)");
ok(nameOf(806) === "Old Sea Dog", "806 = Old Sea Dog (Sea Dog apex)");
ok(nameOf(906) === "Jack of All Trades", "906 = Jack of All Trades (Versatility apex)");

// tier mapping per rung + pool address wiring
const tierOf = (id) => (QuestLadder.byId(id) || {}).tier;
ok(tierOf(101) === "Mayor" && tierOf(102) === "Mayor", "rungs 1-2 -> Mayor");
ok(tierOf(103) === "Lord" && tierOf(104) === "PettyKing", "rung 3 -> Lord, rung 4 -> Petty King");
ok(tierOf(105) === "HighKing" && tierOf(106) === "Emperor", "rung 5 -> High King, rung 6 -> Emperor");
ok(QuestLadder.byId(106).pool === "0xF3dA6a1D7d1a57F4E4782213D831646C7E45d6B0", "Emperor pool addr wired");
ok(QuestLadder.byId(101).pool === "0xB10fbbCB67d68d1f43E566089FFa0f36Bd057193", "Mayor pool addr wired");

// metric typing
ok(QuestLadder.byId(101).metric === "jobRun", "job rungs = jobRun metric");
ok(QuestLadder.byId(701).metric === "loyaltyTime", "700 = loyaltyTime");
ok(QuestLadder.byId(801).metric === "mercTime", "800 = mercTime");
ok(QuestLadder.byId(901).metric === "jobVariety" && QuestLadder.byId(901).thresholdCount === 2, "900 = jobVariety, rung1 needs 2 trades");

// ── 2. WATCHER — continuous run banks the right job rungs ───────────────────────
console.log("watcher (run + banking):");
const NOW = 1_900_000_000;                 // fixed pretend "now" (unix secs)
const crew = "0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f:7";
QuestLadder.reset(crew);

// employed at STR for 1 day + a bit (>= 86400, < 604800) -> bank only rung 1 (id 101)
let r = QuestLadder.observe(crew, { job: "str", startedAt: NOW - 90000 }, NOW);
ok(r.newlyEarned.some((a) => a.id === 101), "STR run >=1d banks 101 (Signed On the Docks)");
ok(!r.newlyEarned.some((a) => a.id === 102), "STR run <1w does NOT bank 102");
let m = QuestLadder.progressFor(crew, { job: "str", startedAt: NOW - 90000 }, NOW);
ok(m.live && m.live.jobKey === "str", "live model shows current job STR");
ok(m.trophies.some((t) => t.id === 101), "101 shows as a banked trophy");
const strLadder = m.ladders.find((l) => l.id === 1);
ok(strLadder.rungs[0].reached && strLadder.rungs[0].banked, "STR rung1 reached+banked in model");
ok(!strLadder.rungs[1].reached && strLadder.rungs[1].isNext, "STR rung2 is the next unreached rung");
ok(strLadder.rungs[1].pct > 0 && strLadder.rungs[1].pct < 100, "STR rung2 shows partial progress %");

// ── 3. LOSE-ON-SWITCH keeps the banked trophy, resets the live run ─────────────
console.log("lose-on-switch + versatility:");
r = QuestLadder.observe(crew, { job: "dex", startedAt: NOW - 100 }, NOW); // fresh DEX run, ~0 elapsed
m = QuestLadder.progressFor(crew, { job: "dex", startedAt: NOW - 100 }, NOW);
ok(m.trophies.some((t) => t.id === 101), "switching to DEX KEEPS the banked STR trophy 101");
const dexLadder = m.ladders.find((l) => l.id === 2);
ok(!dexLadder.rungs[0].reached, "DEX rung1 not yet reached on a fresh run");
ok(m.distinctJobs.length === 2 && m.distinctJobs.indexOf("str") >= 0 && m.distinctJobs.indexOf("dex") >= 0, "distinct jobs = {str, dex}");
ok(r.newlyEarned.some((a) => a.id === 901), "2 distinct trades banks 901 (Two-Trade Hand)");
const versa = m.ladders.find((l) => l.id === 900);
ok(versa.rungs[0].reached, "versatility rung1 (2 trades) reached");
ok(!versa.rungs[1].reached, "versatility rung2 (3 trades) not yet");

// ── 4. ship time ladders stay PENDING (no falsified eligibility) ───────────────
console.log("ship-time ladders pending (honest gap):");
const loyalty = m.ladders.find((l) => l.id === 700);
ok(loyalty.pending === true, "loyalty ladder flagged pending");
ok(loyalty.rungs.every((x) => !x.reached), "no loyalty rung is falsely reached");
const seadog = m.ladders.find((l) => l.id === 800);
ok(seadog.rungs.every((x) => !x.reached), "no sea-dog rung is falsely reached");

// ── 5. apex bank: a full year on GUARD banks all 6 Guard rungs incl 1006 ───────
console.log("apex + claim ack:");
QuestLadder.reset(crew);
r = QuestLadder.observe(crew, { job: "guard", startedAt: NOW - 31_600_000 }, NOW); // >1yr
ok([1001, 1002, 1003, 1004, 1005, 1006].every((id) => r.newlyEarned.some((a) => a.id === id)), "1yr on Guard banks all 6 rungs incl 1006");
ok(QuestLadder.ackClaim(crew, 1006) === true, "ackClaim marks a trophy seen locally (no tx)");
ok(QuestLadder.ackClaim(crew, 404) === false, "ackClaim refuses an unearned id");

// ── 6. readiness (open items documented; nothing registers) ────────────────────
console.log("registration readiness:");
const rd = QuestLadder.readiness();
ok(rd.achievements === 60, "readiness reports 60 catalog entries");
ok(rd.registersOnChain === false && rd.registered === false, "layer never registers on-chain");
ok(rd.open === 0 && rd.deferred === 1 && rd.closed === 4, "open items: 4 CLOSED (incl CHA vault verified), 1 DEFERRED (funding), 0 still-open");
ok(rd.blocking === 0, "zero BLOCKING founder gates remain");

// ── 6b. catalog audit — complete + internally consistent (read-only, no chain) ─────────────────
console.log("catalog audit:");
const au = QuestLadder.catalogAudit();
ok(au.complete === true && au.total === 60, "audit: catalog COMPLETE (60 rungs)");
ok(au.consistent === true && au.problems.length === 0, "audit: catalog CONSISTENT (zero problems)");
ok(au.jobs === 42 && au.ships === 18 && au.idsUnique === true, "audit: 42 job + 18 ship rungs, ids unique");
ok(au.registersOnChain === false, "audit: read-only, registers nothing on-chain");
ok(Array.isArray(au.shipTimeLaddersPending) && au.shipTimeLaddersPending.length === 2, "audit: loyalty+seadog honestly flagged pending (not faked)");

// vault-address resolution (employment.js may carry a raw vault instead of a friendly key)
ok(QuestLadder.jobNumFor({ jobVault: "0xc0813524820df5C6bb9a63a521fE218ff974b1B4" }) === 6, "raw CHA vault resolves to job 6");
ok(QuestLadder.jobNumFor({ job: "guard" }) === 10, "guard key resolves to job 10");
ok(QuestLadder.jobNumFor(null) === null, "no record -> null job");

console.log(fails ? `\nQUEST SMOKE FAILED: ${fails} assertion(s).` : "\nALL QUEST-LADDER SMOKE CHECKS PASSED ⚓");
process.exit(fails ? 1 : 0);
