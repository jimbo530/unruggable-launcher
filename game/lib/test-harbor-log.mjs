// test-harbor-log.mjs — the HARBOR'S LOG + the founder's maiden-voyage rules:
//   ship roster + starts docked at Port Royal · crew-join-at-dock allowed / at-sea blocked ·
//   at-sea crew need rations / docked crew don't · the log lists ships with correct status ·
//   AND the existing voyage still works (setSail → isAtSea → tryArrive flips to docked).
//   node game/lib/test-harbor-log.mjs
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };

const LOC = await import("./location.js");
const UP = await import("./upkeep.js");
const HL = await import("./harbor-log.js");

let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗", m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHIP = "ship_sol_del_mar";
const PAWN = "pawn_test_1";

// ── 1) ROSTER: Sol del Mar is sailable and the original three remain ──────────────────────
ok(!!LOC.SHIPS[SHIP], "Sol del Mar is in the SHIPS roster");
ok(LOC.SHIPS[SHIP].name === "Sol del Mar", "Sol del Mar has its name");
ok(LOC.SHIPS[SHIP].crewDist === "0x9500880DEC9B310b4a728C75A271a25615A2443E", "Sol del Mar carries its crew-share address");
for (const id of ["ship_black_tide", "ship_harbor_guard", "ship_redrum_raiders"])
  ok(!!LOC.SHIPS[id], `original ship ${id} is still in the roster (additive, not replaced)`);
ok(Object.keys(LOC.SHIPS).length === 4, `roster has 4 ships, got ${Object.keys(LOC.SHIPS).length}`);

// ── 2) STARTS DOCKED at Port Royal ─────────────────────────────────────────────────────────
ok(LOC.getLocation(SHIP) === "port_royal", `Sol del Mar starts docked at Port Royal, got ${LOC.getLocation(SHIP)}`);
ok(HL.isDocked(SHIP) === true, "Harbor's Log sees Sol del Mar as docked");
ok(HL.statusOf(SHIP) === "in-port", `status is in-port, got ${HL.statusOf(SHIP)}`);

// ── 3) HARBOR LOG lists every ship with a status ──────────────────────────────────────────
const log = HL.harborLog();
ok(log.length === 4, `harborLog lists all 4 ships, got ${log.length}`);
const sol = log.find((s) => s.id === SHIP);
ok(sol && sol.status === "in-port" && sol.location === "port_royal", "log entry for Sol del Mar shows in-port at port_royal");
ok(sol && sol.species === "elf" && sol.hull === "schooner" && sol.crewSize === 12, "log entry carries the ship card (elf schooner, 12 berths)");
ok(log.every((s) => ["in-port", "at-sea", "at-anchor"].includes(s.status)), "every ship has a valid status");

// ── 4) CREW JOIN — allowed at dock ─────────────────────────────────────────────────────────
const can1 = HL.canJoinCrew(SHIP);
ok(can1.ok === true, "can sign on crew while docked");
const crew1 = HL.joinCrew(SHIP, PAWN);
ok(crew1.includes(PAWN), "pawn signed aboard while docked");
ok(HL.crewOf(SHIP).includes(PAWN), "crewOf reflects the new crew member");
// idempotent
HL.joinCrew(SHIP, PAWN);
ok(HL.crewOf(SHIP).filter((p) => p === PAWN).length === 1, "re-signing the same pawn is idempotent (no dupes)");

// ── 5) RATIONS — EVERYONE EATS (founder economy rule): docked or at sea, unfed are flagged ─
// pawn is NOT fed (no rations packed)
ok(UP.isFed(PAWN) === false, "fresh pawn has no packed rations");
const dockedR = HL.voyageRations(SHIP);                 // docked → still must eat (universal upkeep)
ok(dockedR.allFed === false && dockedR.unfed.includes(PAWN), "DOCKED unfed crew still flagged (everyone eats)");
ok(!!dockedR.warning && dockedR.warning.includes("in port"), "docked rations warning reads as in-port hunger");
const embarkR = HL.voyageRations(SHIP, { embarking: true }); // about to sail → must eat
ok(embarkR.atSea === true, "embarking forces the at-sea rations rule");
ok(embarkR.unfed.includes(PAWN), "unfed crew flagged when embarking");
ok(!!embarkR.warning, "a rations warning is surfaced (playable — never blocks the voyage)");
// feed the pawn, then embarking should be clear
UP.feed(PAWN, "rations");
ok(UP.isFed(PAWN) === true, "pawn is now fed");
ok(HL.voyageRations(SHIP, { embarking: true }).allFed === true, "fed crew clears the embark warning");

// ── 6) THE VOYAGE STILL WORKS — setSail → isAtSea → tryArrive flips to docked ─────────────
// Sail Sol del Mar from Port Royal (8,3) to Beacon Isle (11,5) = 4 hexes, with its crew aboard.
const before = LOC.getLocation(SHIP);
ok(before === "port_royal", "departing from Port Royal");
const res = LOC.setSail(SHIP, "beacon_isle", LOC.DEFAULT_SAIL_SPEED, HL.crewOf(SHIP));
ok(res && res.journey && res.journey.distance === 4, `set sail, 4-hex leg, got ${res && res.journey && res.journey.distance}`);
ok(LOC.isAtSea(SHIP) === true, "ship is AT SEA right after setting sail");
ok(LOC.isAtSea(PAWN) === true, "the crew is locked at sea with the ship (whole deck moves as one)");

// while at sea — crew-join is BLOCKED, with a clear reason
const can2 = HL.canJoinCrew(SHIP);
ok(can2.ok === false && /at sea/i.test(can2.reason), "can NOT sign on crew while at sea (clear reason)");
let threw = false; try { HL.joinCrew(SHIP, "pawn_late_2"); } catch { threw = true; }
ok(threw, "joinCrew THROWS when the ship is at sea (no silent failure)");
ok(HL.statusOf(SHIP) === "at-sea", "Harbor's Log shows Sol del Mar at-sea");

// wall-clock for a 4-hex leg at speed 10 = (32/8)*MS_PER_HEX/10 ≈ 2000ms; wait it out, then arrive
const waitMs = Math.max(0, res.journey.arriveAt - Date.now()) + 300;
await sleep(waitMs);
const arrived = LOC.tryArrive(SHIP);
ok(arrived === true, "tryArrive flips the ship to its destination once the clock passes");
ok(LOC.isAtSea(SHIP) === false, "ship is no longer at sea after arrival");
ok(LOC.getLocation(SHIP) === "beacon_isle", `ship is DOCKED at Beacon Isle, got ${LOC.getLocation(SHIP)}`);
ok(HL.statusOf(SHIP) === "in-port", "Harbor's Log shows it back in port after arrival");
// crew moved with the ship
const beacon = { q: LOC.PORTS.beacon_isle.q, r: LOC.PORTS.beacon_isle.r };
const ph = LOC.getHex(PAWN);
ok(ph.q === beacon.q && ph.r === beacon.r, "the crew arrived at the destination with the ship");
// docked again → crew-join allowed once more
ok(HL.canJoinCrew(SHIP).ok === true, "crew-join is allowed again once docked at the new port");

console.log(`\n${fail === 0 ? "✅" : "❌"} harbor-log tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
