// seas-harvest.http-smoke.mjs — HTTP-level smoke for the CATCH / HARVEST DISPENSER route
// (/seas/harvest) over the REAL http layer (JSON in/out, status codes). Boots the server's own
// createServer() on an ephemeral port, injects OFFLINE chain reads + a throwaway harvest signer (no
// RPC, no VPS key), and round-trips the full referee path: sail to the grounds → skilled catch →
// signed authorization → cooldown → unskilled floor → supply cap → signer-absent 503.
// Independent of combat (so it never flakes on fight variance). Run: node game/server/seas-harvest.http-smoke.mjs
import { createRequire } from "node:module";
import http from "node:http";
import { ethers } from "ethers";
const require = createRequire(import.meta.url);
const srv = require("./seas-server.js");

let fails = 0; const ok = (c, m, d) => { console.log((c ? "  ok  " : "  FAIL ") + m + (d ? "  " + d : "")); if (!c) fails++; };

function req(method, port, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({ host: "127.0.0.1", port, path, method, headers: { "content-type": "application/json", ...(data ? { "content-length": data.length } : {}) } },
      (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") })); });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
const post = (port, p, b) => req("POST", port, p, b);

(async () => {
  // isolate state in a temp store so a previous run / the real store can't leak landed-pawns or cooldowns
  const os = require("node:os"); const pth = require("node:path");
  srv.setStoreFile(pth.join(os.tmpdir(), `seas-harvest-smoke-${Date.now()}.json`));
  await srv.init();

  // ── inject offline deps (no RPC / no key): deterministic skill+supply + a throwaway signer ──
  const harvest = require("../seas/citizen/lib/harvest.js");
  const hSigner = new ethers.Wallet("0x" + "9".repeat(64));
  const CHAIN = 8453n;
  const FISH = "0x907D043d33A243cd9818d6e2ccd5b3C9ef9905B5";
  const GROUND = "0x000000000000000000000000000000000000C0DE";
  const COLL = "0x9500880DEC9B310b4a728C75A271a25615A2443E";
  const state = { level: 9, supplyUnits: 5_000_000, stockUnits: 5_000_000, cooldown: 3600, signerPresent: true };
  const offlineSign = async (a) => {
    const raw = ethers.solidityPackedKeccak256(
      ["address", "address", "uint256", "address", "uint256", "uint256", "bytes32", "uint256"],
      [ethers.getAddress(a.ground), ethers.getAddress(a.collection), BigInt(a.tokenId), ethers.getAddress(a.resource), BigInt(a.amount), Number(a.expiry), ethers.hexlify(a.nonce), CHAIN]
    );
    const sig = await hSigner.signMessage(ethers.getBytes(raw));
    return { ground: ethers.getAddress(a.ground), collection: ethers.getAddress(a.collection), tokenId: BigInt(a.tokenId).toString(), resource: ethers.getAddress(a.resource), amount: BigInt(a.amount).toString(), expiry: Number(a.expiry), nonce: ethers.hexlify(a.nonce), sig, signer: hSigner.address };
  };
  srv.setHarvestDeps({
    read: async () => ({ skill: { level: state.level, backingUsd: state.level * 5, planted: state.level > 0 }, supplyUnits: state.supplyUnits, isRes: true, onchainCooldown: state.cooldown, stockUnits: state.stockUnits, blockTime: Math.floor(Date.now() / 1000) }),
    signerPresent: () => state.signerPresent,
    sign: offlineSign,
  });
  // in-memory grounds config (the server's _testGroundsCfg seam is private; we set it via the loader patch)
  srv._setTestGrounds && srv._setTestGrounds();

  const server = srv.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  console.log(`[harvest-smoke] server on 127.0.0.1:${port}`);

  try {
    // a fresh, unique player each run (belt-and-braces alongside the isolated store)
    const player = ethers.getAddress("0x" + ethers.hexlify(ethers.randomBytes(20)).slice(2));

    // 0) grounds config must be present for the test (set via the exported test hook)
    if (!srv.harvestGrounds() || !srv.harvestGrounds().grounds) { ok(false, "test grounds config loaded (need srv._setTestGrounds)"); throw new Error("no test grounds"); }

    // 1) NOT at the grounds → 403 co-location refusal
    let h = await post(port, "/seas/harvest", { player, collection: COLL, tokenId: "7", resource: "fish" });
    ok(h.status === 403, "not at the grounds → 403 (co-location gate)", h.body.reason);

    // 2) unknown resource → 400
    h = await post(port, "/seas/harvest", { player, collection: COLL, tokenId: "7", resource: "dragons" });
    ok(h.status === 400 && /unknown harvest resource/.test(h.body.reason), "unknown resource → 400");

    // 3) sail to the grounds (loc 8004) and land
    const sail = await post(port, "/seas/sail", { player, toHex: { q: 8, r: 4 } });
    ok(sail.status === 200, "sail to the grounds accepted");
    // wait out the (mock real-clock) voyage — distance from hub is small; poll location until landed
    let landed = false;
    for (let i = 0; i < 40 && !landed; i++) {
      const loc = await req("GET", port, `/seas/location?player=${player}`);
      if (loc.body && loc.body.atSea === false && loc.body.location === 8004) landed = true;
      else await new Promise((r) => setTimeout(r, 500));
    }
    ok(landed, "wallet landed at the grounds (loc 8004)");

    // 4) SKILLED catch over HTTP → 200 with a signed authorization that recovers to the harvest signer
    h = await post(port, "/seas/harvest", { player, collection: COLL, tokenId: "7", resource: "fish" });
    const expS = harvest.computeHarvest(state.level, state.supplyUnits);
    ok(h.status === 200 && h.body.ok && h.body.catch.amount === expS.amount, `skilled catch → 200, amount == harvestMath (${h.body.catch?.amount})`);
    const a = h.body.authorization;
    if (a) {
      const raw = ethers.solidityPackedKeccak256(
        ["address", "address", "uint256", "address", "uint256", "uint256", "bytes32", "uint256"],
        [a.ground, a.collection, BigInt(a.tokenId), a.resource, BigInt(a.amount), a.expiry, a.nonce, CHAIN]
      );
      ok(ethers.verifyMessage(ethers.getBytes(raw), a.sig).toLowerCase() === hSigner.address.toLowerCase(), "authorization sig recovers to the harvest signer over the wire");
    } else ok(false, "authorization present");

    // 5) cooldown → 429 on immediate re-catch (same pawn)
    h = await post(port, "/seas/harvest", { player, collection: COLL, tokenId: "7", resource: "fish" });
    ok(h.status === 429, "immediate re-catch → 429 cooldown");

    // 6) unskilled floor (different pawn) strictly less than skilled
    state.level = 0;
    h = await post(port, "/seas/harvest", { player, collection: COLL, tokenId: "8", resource: "fish" });
    const expF = harvest.computeHarvest(0, state.supplyUnits);
    ok(h.status === 200 && h.body.catch.amount === expF.amount && expF.amount < expS.amount, `unskilled floor < skilled (${h.body.catch?.amount} < ${expS.amount})`);

    // 7) thin supply → supply-capped
    state.level = 9; state.supplyUnits = 1000; state.stockUnits = 1000;
    h = await post(port, "/seas/harvest", { player, collection: COLL, tokenId: "9", resource: "fish" });
    ok(h.status === 200 && h.body.catch.limitedBy === "supply", `thin supply → supply-capped (${h.body.catch?.amount})`);

    // 8) signer absent → 503 with the computed catch but no signature (never a fake ok)
    state.signerPresent = false;
    h = await post(port, "/seas/harvest", { player, collection: COLL, tokenId: "12", resource: "fish" });
    ok(h.status === 503 && h.body.computed?.amount > 0 && !h.body.authorization, "signer absent → 503 (computed, NOT signed; no fake ok)");

    console.log(fails === 0 ? "\nHARVEST HTTP SMOKE: ALL PASS" : `\n${fails} HARVEST CHECK(S) FAILED`);
  } finally { server.close(); srv.setHarvestDeps(null); srv._setTestGrounds && srv._setTestGrounds(null); }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("[harvest-smoke] FAILED:", e.message || e); process.exit(1); });
