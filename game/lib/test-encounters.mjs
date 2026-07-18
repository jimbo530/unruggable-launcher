// test-encounters.mjs — daily d20 roll on working pawns: fight (giant crab) / double-take / normal,
// the 12h ping window, auto-resolve via the existing tot-engine combat, and the playable hand-off.
//   node game/lib/test-encounters.mjs
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };

const E = await import("./encounters.js");
const J = await import("./jobs-loop.js");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗", m); } };

// tiny seeded PRNG so the auto-resolve sim is reproducible
function mulberry32(seed) { let a = (seed >>> 0) || 1; return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const t0 = 1_000_000_000_000;                          // a day-aligned-ish base
const DAY = E.FIGHT_WINDOW_MS * 2;                     // DAY_MS (FIGHT_WINDOW = half a day)

// ── seed WORKING pawns directly into jobs-loop's assignment store (controlled jobs) ──
function seedJobs(map) { localStorage.setItem("sts_jobs", JSON.stringify(map)); }
seedJobs({
  pCrab:  { settlementId: "port_royal", jobId: "crabbing",   startedAt: t0, shiftUntil: t0 + 5000, autoFeed: false },
  pFish:  { settlementId: "port_royal", jobId: "fishing",    startedAt: t0, shiftUntil: t0 + 5000, autoFeed: false },
  pDock:  { settlementId: "port_royal", jobId: "haul_cargo", startedAt: t0, shiftUntil: t0 + 5000, autoFeed: false },
  pLucky: { settlementId: "port_royal", jobId: "crabbing",   startedAt: t0, shiftUntil: t0 + 5000, autoFeed: false },
});

// ── 1) FIGHT roll (d20=1 via rng→0) → giant crab for a crabbing pawn ──
const rFight = E.dailyRoll("pCrab", { now: t0, rng: () => 0 });
ok(rFight.result === "fight" && rFight.roll === 1, `roll 1 → fight (got ${rFight.result}/${rFight.roll})`);
ok(rFight.foe.monsterId === "giant_crab", "crabbing pawn meets the GIANT CRAB");
ok(!!rFight.fightId, "a pending fight was opened");
const crabFight = E.fightById(rFight.fightId);
ok(crabFight && crabFight.status === "pending", "fight record is pending");

// idempotent per day — a second roll same day does not re-roll / re-open
const rRepeat = E.dailyRoll("pCrab", { now: t0 + 1000, rng: () => 0.99 });
ok(rRepeat.repeat === true && rRepeat.result === "fight", "second roll same day → cached (no double roll)");

// ── 2) ping queued + 12h window ──
const fightPings = E.pings({ unreadOnly: true }).filter((p) => p.kind === "fight");
ok(fightPings.length === 1, "a FIGHT ping was queued for the player");
ok(E.fightTimeLeftSecs(rFight.fightId, t0) === Math.round(E.FIGHT_WINDOW_MS / 1000), "12h window timer set");
ok(E.pendingFights(t0).some((f) => f.fightId === rFight.fightId), "fight shows in pendingFights");

// ── 3) fishing pawn meets a shark ──
const rShark = E.dailyRoll("pFish", { now: t0, rng: () => 0 });
ok(rShark.foe.monsterId === "shark", "fishing pawn meets a shark, not a crab");

// ── 4) DOUBLE-take airdrop (d20=20 via rng→0.99) → +1 day's take credited ──
const wBefore = J.wages("pLucky").copper || 0, cBefore = J.produceInv("pLucky").crab || 0;
const rDbl = E.dailyRoll("pLucky", { now: t0, rng: () => 0.99 });
ok(rDbl.result === "double" && rDbl.roll === 20, `roll 20 → double (got ${rDbl.result}/${rDbl.roll})`);
ok((J.wages("pLucky").copper || 0) === wBefore + 10, "double-take credited +10 copper (crabbing wage)");
ok((J.produceInv("pLucky").crab || 0) === cBefore + 1, "double-take credited +1 crab (crabbing produce)");
ok(E.pings({ unreadOnly: true }).some((p) => p.kind === "airdrop" && p.pawnId === "pLucky"), "airdrop ping queued");

// ── 5) NORMAL roll (d20=11 via rng→0.5) ──
const rNorm = E.dailyRoll("pDock", { now: t0, rng: () => 0.5 });
ok(rNorm.result === "normal" && rNorm.roll === 11, `roll 11 → normal (got ${rNorm.result}/${rNorm.roll})`);

// ── 6) not-working pawn → loud throw, never silent ──
let threw = false; try { E.dailyRoll("ghost", { now: t0, rng: () => 0 }); } catch { threw = true; }
ok(threw, "rolling a non-working pawn throws (no silent fail)");

// ── 7) PLAYABLE hand-off → battle-grid descriptor, then record a played win ──
const enc = E.startPlayableFight(rFight.fightId, t0 + 1000);
ok(enc.type === "pve" && enc.enemy.monsterId === "giant_crab" && enc.enemy.bestiary === "sea", "playable encounter targets the existing battle-grid (giant_crab/sea)");
ok(E.fightById(rFight.fightId).status === "engaged", "engaging marks the fight (won't auto-resolve)");
ok(E.fightTimeLeftSecs(rFight.fightId, t0 + 1000) === 0, "engaged fight no longer counts down");
const played = E.resolvePlayerFight(rFight.fightId, { won: true }, t0 + 2000);
ok(played.status === "won" && E.fightById(rFight.fightId).status === "won", "played win recorded");

// ── 8) AUTO-RESOLVE the shark fight after the 12h window lapses (existing tot-engine combat) ──
const expired = E.resolveExpiredFights({ now: t0 + DAY, rng: mulberry32(7) });
ok(expired.resolved.some((r) => r.fightId === rShark.fightId), "lapsed fight auto-resolved on sweep");
const sf = E.fightById(rShark.fightId);
ok(sf.status === "auto-won" || sf.status === "auto-lost", `auto-resolved to a definite outcome (${sf.status})`);
ok(sf.outcome && sf.outcome.mode === "auto" && typeof sf.outcome.won === "boolean", "auto outcome recorded");
ok(E.pings({}).some((p) => p.kind === "auto-resolved" && p.fightId === rShark.fightId), "auto-resolve ping queued");

// ── 9) simulate gradient — a TRAINED pawn beats the crab; a GREEN pawn loses ──
localStorage.setItem("sts_pawn_xp", JSON.stringify({ hero: { STR: 20, DEX: 16, CON: 16 }, greenie: {} }));
const heroSim = E.simulateFight("hero", "Giant Crab", { now: t0, rng: mulberry32(3) });
ok(heroSim.won === true, `trained pawn beats the Giant Crab (rounds ${heroSim.rounds}, hp ${heroSim.pawnHp})`);
const greenSim = E.simulateFight("greenie", "Giant Crab", { now: t0, rng: mulberry32(3) });
ok(greenSim.won === false, `green pawn loses to the Giant Crab (hp ${greenSim.pawnHp})`);

// ── 10) sweep all working pawns next day (idempotency + per-day re-roll) ──
const sweep = E.sweepDailyRolls({ now: t0 + DAY, rng: () => 0.5 });   // all normal
ok(sweep.day === E.dayIndex(t0 + DAY), "sweep reports the new day index");
ok(sweep.rolled.length === 4, `sweep rolled all 4 working pawns next day (got ${sweep.rolled.length})`);

// ── 11) ping housekeeping ──
const firstPing = E.pings({})[0];
ok(E.markPingRead(firstPing.id) === true, "markPingRead finds the ping");
ok(E.clearReadPings() >= 1, "clearReadPings drops read pings");

console.log(`\n${fail === 0 ? "✅" : "❌"} encounters tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
