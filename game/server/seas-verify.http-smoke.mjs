// seas-verify.http-smoke.mjs — HTTP-level smoke for the combat-settlement routes (issue-seed +
// verify-fight) over the REAL http layer (JSON in/out, status codes). Boots the server's own
// createServer() on an ephemeral port, then round-trips a FULL bilge fight: issue → play → verify.
// Run: node game/server/seas-verify.http-smoke.mjs
import { createRequire } from "node:module";
import http from "node:http";
const require = createRequire(import.meta.url);
const srv = require("./seas-server.js");

let fails = 0; const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };

function post(port, path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": data.length } },
      (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b) })); });
    req.on("error", reject); req.end(data);
  });
}
function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET" },
      (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b) })); });
    req.on("error", reject); req.end();
  });
}

(async () => {
  await srv.init();
  const server = srv.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  console.log(`[http-smoke] server on 127.0.0.1:${port}`);
  try {
    const player = "0x" + "11".repeat(20);

    // 1) issue-seed over HTTP
    const iss = await post(port, "/seas/issue-seed", { player, fight: "bilge-rats" });
    ok(iss.status === 200 && iss.body.ok && typeof iss.body.seed === "string" && typeof iss.body.nonce === "string", "POST /seas/issue-seed → 200 { seed, nonce }");

    // 2) play a real fight off the issued seed (reuse the deterministic builder + engine over ESM)
    const bg = "../seas/battle-grid/";
    const bilge = await import(bg + "../../lib/bilge-rats.js");
    const units = await import(bg + "units.js");
    const ci = await import(bg + "combat-helpers.js");
    const eng = await import(bg + "tot-engine.js");
    const gc = await import(bg + "grid-config.js");
    gc.setGrid(bilge.SQUAD_GRID.cols, bilge.SQUAD_GRID.rows);
    const makeRng = (await import(bg + "resolver.js")).makeRng;
    const leader = units.buildUnit({ id: "LEADER", isPlayer: true, name: "Captain", emoji: "🦜", endowment: { burgers: 40 }, role: "melee", position: { q: 1, r: 4 } });

    // minimal client play (mirrors game.js; records the player's actions)
    const key = (h) => `${h.q},${h.r}`;
    const enemyTeam = bilge.buildBilgeEnemies(iss.body.seed, [leader.position]);
    const terrain = bilge.bilgeTerrain(); const ix = new Map(terrain.map((c) => [key(c), c]));
    const cover = (h) => { const c = ix.get(key(h)); return c && c.type === "cover" ? (c.mod && c.mod.ac) || 2 : 0; };
    const rng = makeRng(iss.body.seed);
    const U = [{ ...JSON.parse(JSON.stringify(leader)), isPlayer: true }, ...JSON.parse(JSON.stringify(enemyTeam)).map((u) => ({ ...u, isPlayer: false }))];
    const live = (u) => u.currentHp > 0;
    const decided = () => new Set(U.filter(live).map((u) => !!u.isPlayer)).size <= 1;
    const ctx = (u) => ({ foes: U.filter((e) => live(e) && e.isPlayer !== u.isPlayer), allies: U.filter((e) => live(e) && e.isPlayer === u.isPlayer),
      reach: (unit) => gc.hexesInRange(unit.position, unit.movementHexes, new Set(U.filter((x) => x.currentHp > -10 && x !== unit).map((x) => key(x.position)))),
      dist: eng.hexDistance, actRange: (unit) => unit.attackRange || 1, meleeRange: (unit) => unit.attackRange || 1, ownCaster: null, aoeArea: () => 0, hasLos: () => true });
    const actions = []; let ti = 0, round = 1, guard = 0;
    while (!decided() && guard++ < U.length * 64) {
      const u = U[ti];
      if (live(u)) {
        u.hasMoved = false; u.hasActed = false;
        const intent = ci.planIntent(u, ctx(u));
        if (intent && intent.moveTo && (intent.moveTo.q !== u.position.q || intent.moveTo.r !== u.position.r)) { u.position = { ...intent.moveTo }; if (u.isPlayer) actions.push({ unit: u.id, type: "move", to: { ...u.position } }); }
        const foes = U.filter((e) => live(e) && e.isPlayer !== u.isPlayer);
        const t = intent && intent.target && live(intent.target) ? intent.target : ci.chooseTarget(u, foes);
        if (t) { const d = eng.hexDistance(u.position, t.position); if (d <= (u.attackRange || 1)) { const r = ci.strike(u, t, { distance: d, coverAC: cover(t.position), rng }); if (r.hit) t.currentHp -= r.damage; if (u.isPlayer) actions.push({ unit: u.id, type: "attack", target: t.id }); } }
        if (u.isPlayer) actions.push({ unit: u.id, type: "end" });
        if (decided()) break;
      } else if (u.currentHp > -10) u.currentHp -= 1;
      ti = (ti + 1) % U.length; if (ti === 0 && ++round > 60) break;
    }
    const sides = new Set(U.filter(live).map((u) => !!u.isPlayer));
    const clientWinner = sides.size === 1 ? (sides.has(true) ? "player" : "enemy") : (sides.size === 0 ? "draw" : null);

    // 3) verify-fight over HTTP (server reconstructs the rats + replays)
    const v = await post(port, "/seas/verify-fight", { player, nonce: iss.body.nonce, playerTeam: [leader], playerActions: actions });
    ok(v.status === 200 && v.body.ok, "POST /seas/verify-fight → 200 ok");
    ok(v.body.winner === clientWinner, `server winner (${v.body.winner}) == client winner (${clientWinner}) over HTTP`);
    ok(v.body.winner === "player" ? v.body.payoutEligible === true : true, "a player win is payoutEligible over the wire");

    // 4) double-claim blocked + unknown nonce
    const v2 = await post(port, "/seas/verify-fight", { player, nonce: iss.body.nonce, playerTeam: [leader], playerActions: actions });
    ok(v2.status === 409, "re-verifying the same nonce → 409 (no double-claim)");
    const v3 = await post(port, "/seas/verify-fight", { player, nonce: "nope", playerTeam: [leader], playerActions: [] });
    ok(v3.status === 404, "unknown nonce → 404");

    // 5) NEW: server-cooldown-gated issue-seed REQUIRES a pawn over the wire (closes the localStorage hole)
    const COLL = "0x9500880DEC9B310b4a728C75A271a25615A2443E";
    const gNoPawn = await post(port, "/seas/issue-seed", { player, fight: "goblin-cave" });
    ok(gNoPawn.status === 400 && /cooldown-gated/.test(gNoPawn.body.reason), "POST /seas/issue-seed { goblin-cave } w/o pawn → 400 (server-cooldown-gated)");
    const gPawn = await post(port, "/seas/issue-seed", { player, fight: "goblin-cave", collection: COLL, tokenId: "5" });
    ok(gPawn.status === 200 && gPawn.body.seed?.startsWith("seas-goblin-cave-"), "POST /seas/issue-seed { goblin-cave, pawn } → 200 seed");

    // 6) NEW: the bilge-rats-quest kind is served over the wire
    const q = await post(port, "/seas/issue-seed", { player, fight: "bilge-rats-quest", collection: COLL, tokenId: "9" });
    ok(q.status === 200 && q.body.fight === "bilge-rats-quest", "POST /seas/issue-seed { bilge-rats-quest } → 200");

    // 7) NEW: use-chrono-orb validates ownership/action; cooldown GET returns the server-clock truth
    const orbBad = await post(port, "/seas/use-chrono-orb", { player, collection: COLL, tokenId: "9", action: "no-such" });
    ok(orbBad.status === 400 && /unknown skippable action/.test(orbBad.body.reason), "POST /seas/use-chrono-orb { bad action } → 400");
    const cd = await get(port, `/seas/cooldown?collection=${COLL}&tokenId=5&action=goblin-cave`);
    ok(cd.status === 200 && typeof cd.body.secsLeft === "number", "GET /seas/cooldown → 200 { secsLeft }");

    console.log(fails === 0 ? "\nHTTP SMOKE: ALL PASS ✅" : `\n${fails} HTTP CHECK(S) FAILED ❌`);
  } finally { server.close(); }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("[http-smoke] FAILED:", e.message || e); process.exit(1); });
