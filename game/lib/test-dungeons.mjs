// test-dungeons.mjs — dungeon templates + cooldown + job-reroute logic.  node game/lib/test-dungeons.mjs
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};
const D = await import("./dungeons.js");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗", m); } };

const t0 = 1_000_000_000_000;            // a fixed "now"
const HR = D.COOLDOWN_MS_PER_HOUR;
const pawn = "0xPAWN", win = "0xOWNER";

ok(D.listDungeons().length === 6, "6 dungeon templates");
const d1 = D.getDungeon(1);
ok(d1 && d1.poolId === 1 && d1.tier === 1, "dungeon 1 has poolId + tier");
ok(JSON.stringify(d1.rewardCoins) === JSON.stringify(["copper", "silver"]), "tier-1 pays copper/silver");
ok(D.getDungeon(5).rewardCoins[0] === "gold", "tier-3 pays gold");

// ready before any run
ok(D.canRun(pawn, 1, t0).ok, "can run a fresh dungeon");
ok(!D.isGrinding(pawn, t0), "not grinding before a run");

// start a run → cooldown + reroute window
const run = D.startRun(pawn, 1, t0);
ok(run.rooms.length === 2 && run.runId.startsWith("d1-p"), "startRun returns rooms + runId");
ok(!D.canRun(pawn, 1, t0).ok && D.canRun(pawn, 1, t0).reason === "cooldown", "on cooldown right after");
ok(D.cooldownLeftSecs(pawn, 1, t0) === Math.ceil(4 * HR / 1000), "cooldown ≈ 4h for tier-1");

// while on cooldown the job stream reroutes to THIS dungeon's pool (100% feed)
const rr = D.jobRerouteTarget(pawn, t0);
ok(rr && rr.poolId === 1 && rr.dungeonId === 1, "jobRerouteTarget = the dungeon's pool while cooling");
ok(D.isGrinding(pawn, t0), "isGrinding true during cooldown");

// can still run a DIFFERENT dungeon (cooldown is per-pawn-per-dungeon)
ok(D.canRun(pawn, 2, t0).ok, "a different dungeon is runnable");

// after cooldown expires → reroute ends, runnable again
const later = t0 + 4 * HR + 1000;
ok(D.canRun(pawn, 1, later).ok, "runnable again after cooldown");
ok(D.jobRerouteTarget(pawn, later) === null, "reroute ends after cooldown (job stream returns to owner)");
ok(!D.isGrinding(pawn, later), "not grinding after cooldown");

// reroute picks the LATEST active grind when grinding two dungeons
D.startRun(pawn, 1, later);                       // cooldown until later+4h
const r2 = D.startRun(pawn, 5, later + 100);      // tier-3, 8h — later expiry
const pick = D.jobRerouteTarget(pawn, later + 200);
ok(pick && pick.dungeonId === 5, "reroute follows the latest/longest active grind");

// finishRun → claim intent for the backend signer
const intent = D.finishRun(pawn, 5, win);
ok(intent.poolId === 5 && intent.winner === win && intent.coins[0] === "gold" && intent.runId === r2.runId,
   "finishRun → claim intent {poolId, winner, coins, runId}");

console.log(`\n${fail === 0 ? "✅" : "❌"} dungeon tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
