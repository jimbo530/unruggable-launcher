// Smoke test: the GOBLIN CAVE — site + guaranteed goblin roll through the EXISTING encounter→squad→
// bestiary path, weekly per-pawn cooldown, deterministic seed-built foes, and the HARDENED win→claim
// (server-verified player win required, copper floor + recharge-gated item loot). NO new combat: it
// drives buildGoblinEnemies (seed→spawnMonsterGroup) + rollCaveEncounter + makeSquadBattle + monster-bridge.
// Mirrors the bilge-rats hardening. Run:  node game/seas/battle-grid/smoke-goblin-cave.mjs
import * as GC from "../../lib/goblin-cave.js";
import { makeSquadBattle } from "./units.js";
import { resolveMonster } from "./monster-bridge.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };
const throws = (fn, m) => { try { fn(); ok(false, `expected throw: ${m}`); } catch (e) { ok(true, `threw as required (${m}): ${String(e.message).slice(0, 60)}…`); } };

const FULL = ["qualified","engineStats","endowment","equipped","baseStats","baseMaxHp","baseAttackRange",
  "baseMovementHexes","baseCastingMod","stats","rawAbilities","position","currentHp","maxHp","attackRange",
  "movementHexes","casterLevel","castingAbilityMod","availableSpells","bracket","totalLevel","spellDC"];
const shapeOk = (u) => FULL.every((k) => u[k] !== undefined);

console.log("1) CAVE site is on LAND, one hex EAST of Port Royal, foot-reachable");
ok(GC.CAVE.port === "port_royal", `cave belongs to port_royal (got ${GC.CAVE.port})`);
ok(GC.CAVE.hex.q === 9 && GC.CAVE.hex.r === 3, `cave hex = (9,3) — 1 EAST of port_royal (8,3), a LAND headland (loc 9003); NOT the (8,4) ocean (got ${GC.CAVE.hex.q},${GC.CAVE.hex.r})`);
ok(GC.CAVE.areaId === "goblin-cave", "cave wired to the 'goblin-cave' area");
ok(GC.CAVE.map === "cave", "cave fights on the 'cave' deck art (maps/sea-cave.js)");

console.log("2) the goblin ids the cave spawns RESOLVE through monster-bridge → bestiary-dungeon");
ok(resolveMonster("goblin_spearman").key === "goblin_spear", "goblin_spearman → goblin_spear (dungeon alias)");
ok(resolveMonster("goblin_slinger").kind === "dungeon", "goblin_slinger → dungeon bestiary");

console.log("3) rollCaveEncounter(seed) ALWAYS yields a small goblin pack, DETERMINISTIC from the seed");
for (const seed of [1, 7, 42, 99, "nonce-abc"]) {
  const enc = GC.rollCaveEncounter(seed);
  ok(enc.type === "pve" && enc.groupId === "cave_goblins_starter", `seed ${seed}: goblin starter pack (got ${enc.groupId})`);
  ok(enc.routeId === "goblin-cave", `seed ${seed}: routeId tagged 'goblin-cave' (for the return credit)`);
  const onlyGoblins = enc.group.every((f) => /goblin/i.test(f.monsterId || f.name));
  ok(onlyGoblins, `seed ${seed}: every foe is a goblin`);
  ok(enc.group.length >= 3 && enc.group.length <= 4, `seed ${seed}: small pack (3–4 foes, got ${enc.group.length})`);
}

console.log("4) buildGoblinEnemies(seed) rebuilds the EXACT squad from the seed alone (server-reconstructable)");
{
  const seed = "fight-seed-7";
  const a = GC.buildGoblinEnemies(seed, [{ q: 1, r: 4 }]);
  const b = GC.buildGoblinEnemies(seed, [{ q: 1, r: 4 }]);
  ok(a.length >= 3 && a.length <= 4, `built ${a.length} goblins from the seed`);
  ok(JSON.stringify(a) === JSON.stringify(b), "same seed → byte-identical enemy squad (ids + hexes)");
  ok(a.every(shapeOk), "every goblin carries the FULL buildUnit shape (game.js/tot-engine safe)");
  const hx = a.map((u) => `${u.position.q},${u.position.r}`);
  ok(new Set(hx).size === hx.length && !hx.includes("1,4"), "all spawn hexes unique + clear of the player hex (1,4)");
  // a DIFFERENT seed → a different squad (the seed actually drives composition)
  const c = GC.buildGoblinEnemies("fight-seed-8", [{ q: 1, r: 4 }]);
  ok(JSON.stringify(a) !== JSON.stringify(c), "a different seed → a different squad");
}

console.log("5) the cave fight still runs through the EXISTING combat (makeSquadBattle → tot-engine units)");
{
  const enc = GC.rollCaveEncounter(7);
  const sq = makeSquadBattle(enc, { mode: "encounter", objective: enc.objective, mapId: enc.map });
  ok(sq.pvp === true && sq.mode === "encounter", "squad battle control shape { pvp:true, mode:'encounter' }");
  ok(sq.units.length === enc.group.length + 1, `${enc.group.length} goblins + 1 player = ${sq.units.length} units`);
  const sides = new Set(sq.units.map((u) => u.isPlayer));
  ok(sides.has(true) && sides.has(false), "checkWin-safe: both player + enemy sides present");
  console.log("      goblins: " + sq.units.slice(1).map((u) => u.name).join(", "));
}

console.log("6) cave terrain = the chokepoint cave deck (cover/wall/hazard for the server replay)");
{
  const t = GC.caveTerrain();
  ok(Array.isArray(t) && t.length > 0, `caveTerrain() returns ${t.length} cells`);
  ok(t.some((c) => c.type === "wall") && t.some((c) => c.type === "cover"), "cave deck has wall (chokepoint) + cover");
}

console.log("7) WEEKLY per-pawn cooldown (168h)");
{
  const pawn = "0xdist:42";
  const t0 = 1_000_000_000_000;
  ok(GC.canEnter(pawn, t0).ok, "fresh pawn can enter");
  const run = GC.enterCave(pawn, t0);
  ok(typeof run.runId === "string" && run.runId.includes(pawn), "enterCave returns a runId for this pawn");
  ok(!GC.canEnter(pawn, t0).ok, "same pawn is now BLOCKED (cooldown)");
  const left = GC.cooldownLeftSecs(pawn, t0);
  ok(left === GC.COOLDOWN_HOURS * 3600, `~168h left immediately after entering (got ${left}s)`);
  ok(GC.readyInLabel(pawn, t0) === "Ready in 7d", `readyInLabel = "Ready in 7d" (got "${GC.readyInLabel(pawn, t0)}")`);
  ok(GC.canEnter(pawn, t0 + GC.COOLDOWN_HOURS * GC.COOLDOWN_MS_PER_HOUR + 1).ok, "ready again after a full week");
  ok(GC.canEnter("0xdist:43", t0).ok, "a different pawn is unaffected by the first's cooldown");
}

console.log("8) WIN → pending REAL claim — HARDENED (server-verified player win REQUIRED, no fake payout)");
{
  const pawn = "0xdist:7";
  // a) a claim WITHOUT a server-verified player win THROWS (anti-cheat — never trust a client win)
  throws(() => GC.completeCave(pawn, { runId: "x" }), "no verifiedWinner");
  throws(() => GC.completeCave(pawn, { runId: "x", verifiedWinner: "enemy" }), "verifiedWinner != player");
  // b) a verified win records a PENDING claim targeting the pool + the pawn NFT
  const claim = GC.completeCave(pawn, { runId: "run-1", verifiedWinner: "player", collection: "0xNFT", tokenId: 7,
    seed: "s1", nonce: "n1", availableSymbols: ["RICE", "PORK"], rng: () => 0.1 });
  ok(claim.status === "pending", "claim is PENDING (the keeper settles it on-chain — not faked here)");
  ok(claim.lootPool === GC.LOOT_POOL && GC.LOOT_POOL.startsWith("0x") && GC.LOOT_POOL.length === 42, "claim targets the deployed goblin-cave LootPool");
  ok(claim.collection === "0xNFT" && claim.tokenId === 7, "claim carries the pawn NFT (collection, tokenId) for payout(ownerOf)");
  ok(claim.copperFloor && claim.copperFloor.coin === "copper" && claim.copperFloor.bps === 100, "copper floor = 1% (100 BPS) copper, always");
  ok(claim.itemLoot && claim.itemLoot.amount === 1 && ["RICE", "PORK"].includes(claim.itemLoot.symbol), `item loot = 1 whole of an AVAILABLE item (got ${claim.itemLoot && claim.itemLoot.symbol})`);
  ok(claim.verifiedWinner === "player", "claim stamps verifiedWinner=player (provenance)");
  // c) loot table is the REAL spec (RICE/FLOUR/PORK), not the old ROPE/TORCH placeholders
  const syms = GC.LOOT_TABLE.map((t) => t.symbol).sort().join(",");
  ok(syms === "FLOUR,PORK,RICE", `LOOT_TABLE = RICE/FLOUR/PORK per the founder spec (got ${syms})`);
  ok(GC.LOOT_TABLE.find((t) => t.symbol === "PORK").token === "0x676d5a1C8438A9955bbA636e496aebddA4c49a2D", "PORK wired to its verified on-chain address");
  // d) nothing recharged → item loot is null, but the copper floor STILL pays
  const dry = GC.completeCave(pawn, { runId: "run-2", verifiedWinner: "player", availableSymbols: [], rng: () => 0.1 });
  ok(dry.itemLoot === null, "no items recharged → itemLoot null (the 'sometimes' bonus)");
  ok(dry.copperFloor.bps === 100, "…but the copper floor still pays (no empty-handed run)");
  // e) item pick is deterministic under a fixed rng (testable)
  const a = GC.completeCave(pawn, { runId: "run-3", verifiedWinner: "player", availableSymbols: GC.LOOT_TABLE.map((t) => t.symbol), rng: () => 0.4 }).itemLoot.symbol;
  const b = GC.completeCave(pawn, { runId: "run-4", verifiedWinner: "player", availableSymbols: GC.LOOT_TABLE.map((t) => t.symbol), rng: () => 0.4 }).itemLoot.symbol;
  ok(a === b, `same rng → same item pick (${a}) — deterministic/testable`);
  // f) the keeper can read pending claims, and settle them
  ok(GC.pendingClaims().length >= 4, `pendingClaims() lists the recorded claims (got ${GC.pendingClaims().length})`);
  ok(GC.markClaimSettled("run-1"), "markClaimSettled('run-1') flips it to settled");
  ok(!GC.pendingClaims().some((c) => c.runId === "run-1"), "settled claim no longer pending");
}

console.log(fails === 0 ? "\nALL GOBLIN-CAVE CHECKS PASS ✅" : `\n${fails} CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
