// Smoke test for the NON-COMBAT VOYAGE EVENTS resolver (event-resolver.js).
//   Validates: every event kind builds player CHOICES; TRADE buy/sell move gold↔pack; SALVAGE adds
//   gold+items; BOARD yields loot OR springs an ambush (escalate descriptor, no loot); WEATHER trades
//   time for risk (cargo overboard + repairs); FLAVOR/LORE give morale; bad ids THROW; the rollers
//   return a guaranteed event / combat; and the stores match the SHARED game keys (sts_gold raw
//   number, sts_inv_pawn JSON [{id,qty}]). NO chain, NO network — pure logic + an in-memory store.
// Run: node game/seas/battle-grid/smoke-events.mjs
import * as EVT from "./event-resolver.js";
import { mulberry32 } from "./area-encounters.js";

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✔ " : "  ✘ ") + msg); if (!cond) fails++; };
const fixed = (v) => () => v;                       // a constant rng → forces a specific branch
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

// ── isolated in-memory store (RAW strings, exactly like localStorage) ──────────────────────────
let mem = {};
EVT.setStore({ get: (k) => (k in mem ? mem[k] : null), set: (k, v) => { mem[k] = String(v); }, del: (k) => { delete mem[k]; } });
const reset = (gold = 0, pack = []) => { mem = {}; if (gold) mem["sts_gold"] = String(gold); if (pack.length) mem["sts_inv_pawn"] = JSON.stringify(pack); };

// ── 1. CHOICES per kind ─────────────────────────────────────────────────────────────────────
console.log("choices per event kind:");
reset(200, [{ id: "spice_crate", qty: 1 }]);
ok(EVT.eventChoices("merchant_dhow").map((c) => c.id).join(",") === "buy,sell,leave", "trade → buy/sell/leave");
ok(EVT.eventChoices("flotsam").some((c) => c.id === "take"), "salvage → take");
ok(EVT.eventChoices("derelict").some((c) => c.id === "board"), "derelict → board");
ok(EVT.eventChoices("treasure_cache").some((c) => c.id === "dig"), "cache → dig");
ok(EVT.eventChoices("squall").map((c) => c.id).join(",") === "reef,run", "squall → reef/run");
ok(EVT.eventChoices("storm_wall").map((c) => c.id).join(",") === "hold,push", "storm wall → hold/push");
ok(EVT.eventChoices("message_bottle").some((c) => c.id === "read"), "bottle → read");
ok(EVT.eventChoices("calm_seas")[0].id === "continue", "calm seas → continue");
const model = EVT.buildEventModel("merchant_convoy");
ok(model.kind === "trade" && Array.isArray(model.choices) && typeof model.gold === "number", "buildEventModel returns kind+choices+gold");

// ── 2. TRADE — buy spends gold + adds cargo; sell turns cargo into coin ─────────────────────────
console.log("trade buy/sell:");
reset(200, []);
let r = EVT.resolveEventChoice("merchant_dhow", "buy");                 // small shop featured = silk_bolt @ 50
ok(r.outcome.goldDelta === -50 && EVT.getGold() === 150, "buy silk_bolt: -50g, balance 150");
ok(EVT.packCount("silk_bolt") === 1, "buy adds silk_bolt to the pack");
ok(typeof mem["sts_gold"] === "string" && Number(mem["sts_gold"]) === 150, "gold persisted as a RAW number string (sts_gold)");
ok(Array.isArray(JSON.parse(mem["sts_inv_pawn"])), "pack persisted as JSON array (sts_inv_pawn)");

reset(0, [{ id: "spice_crate", qty: 1 }, { id: "timber", qty: 2 }]);
r = EVT.resolveEventChoice("merchant_dhow", "sell");                    // sells the BEST: spice_crate (55) > timber (12)
ok(r.outcome.goldDelta === 55 && EVT.getGold() === 55, "sell picks the most valuable good (spice_crate, +55g)");
ok(EVT.packCount("spice_crate") === 0 && EVT.packCount("timber") === 2, "sell removes one spice_crate, leaves the timber");

reset(0, [{ id: "spice_crate", qty: 1 }]);
r = EVT.resolveEventChoice("black_market", "sell");                     // premium ×1.5 → 55*1.5 = 83 (rounded)
ok(r.outcome.goldDelta === 83, "black market pays a premium (spice_crate 55 → 83)");

reset(10, []);
const buyChoice = EVT.eventChoices("merchant_dhow").find((c) => c.id === "buy");
ok(buyChoice.disabled === true && /Need/.test(buyChoice.reason || ""), "buy is disabled + reasoned when gold is short");
r = EVT.resolveEventChoice("merchant_dhow", "buy");
ok(r.outcome.goldDelta === 0 && EVT.getGold() === 10, "an unaffordable buy resolves with NO change (no silent fail)");

// ── 3. SALVAGE — take adds gold + a material ───────────────────────────────────────────────────
console.log("salvage:");
reset(0, []);
r = EVT.resolveEventChoice("flotsam", "take", { rng: fixed(0) });       // floors → 5g, first item (timber), qty 1
ok(r.outcome.goldDelta === 5 && EVT.getGold() === 5, "salvage take: +5g (rng=0 floor)");
ok(EVT.packCount("timber") === 1, "salvage adds a material to the pack");
reset(0, []);
r = EVT.resolveEventChoice("flotsam", "leave");
ok(r.outcome.goldDelta === 0 && EVT.getPack().length === 0, "salvage leave: nothing changes");

// ── 4. BOARD — loot on a safe roll, AMBUSH (escalate) on a risky roll ──────────────────────────
console.log("board / raid:");
reset(0, []);
const dEv = { type: "event", eventId: "derelict", areaId: "open-sea", danger: 3 };
r = EVT.resolveEventChoice(dEv, "board", { rng: fixed(0.99) });         // 0.99 > 0.35 → NO ambush → loot
ok(r.escalate === null && r.outcome.goldDelta > 0 && r.outcome.items.some((i) => i.dir === "add"), "board (safe roll): loot, no escalate");
reset(0, []);
r = EVT.resolveEventChoice(dEv, "board", { rng: fixed(0.01) });         // 0.01 < 0.35 → AMBUSH
ok(r.escalate && r.escalate.areaId === "open-sea" && r.outcome.goldDelta === 0, "board (bad roll): escalate descriptor, no loot");
ok(EVT.getPack().length === 0, "an ambush yields no cargo");
reset(0, []);
r = EVT.resolveEventChoice({ type: "event", eventId: "treasure_cache", areaId: "island-jungle", danger: 3 }, "pass");
ok(r.outcome.text && r.escalate === null, "cache pass: no fight, no loot");

// ── 5. WEATHER — safe arm loses time; risky arm can cost cargo + repairs ───────────────────────
console.log("weather:");
reset(0, [{ id: "timber", qty: 4 }]);
r = EVT.resolveEventChoice("squall", "reef");
ok(r.outcome.timeLostSecs > 0 && r.outcome.goldDelta === 0, "reef sails: time lost, no damage");
ok(EVT.getVoyageState().timeLostSecs === r.outcome.timeLostSecs, "time-loss accrues into the voyage ledger");
reset(100, [{ id: "timber", qty: 4 }]);
r = EVT.resolveEventChoice("storm_wall", "push", { rng: fixed(0.01) }); // 0.01 < 0.6 → damage
ok(r.outcome.repairs > 0 && r.outcome.goldDelta < 0, "push through (bad roll): pays repairs");
ok(r.outcome.items.some((i) => i.dir === "remove"), "push through (bad roll): cargo swept overboard");
reset(100, [{ id: "timber", qty: 4 }]);
r = EVT.resolveEventChoice("squall", "run", { rng: fixed(0.99) });      // 0.99 > 0.5 → clean
ok(r.outcome.goldDelta === 0 && !r.outcome.items.some((i) => i.dir === "remove"), "run (good roll): slips past clean");

// ── 6. FLAVOR / LORE — morale ──────────────────────────────────────────────────────────────────
console.log("flavor / lore:");
reset(0, []);
r = EVT.resolveEventChoice("pod_of_whales", "continue");
ok(r.outcome.morale === 2 && EVT.getVoyageState().morale === 2, "whales lift morale (+2)");
r = EVT.resolveEventChoice("message_bottle", "read");
ok(r.outcome.morale === 1 && /map-fragment|warning/i.test(r.outcome.text), "reading the bottle: +1 morale + a lore line");
r = EVT.resolveEventChoice("message_bottle", "ignore");
ok(r.outcome.morale === 0, "ignoring the bottle: no morale");

// ── 7. GUARDS — bad ids THROW (no silent no-op) ────────────────────────────────────────────────
console.log("guards (loud failures):");
ok(throws(() => EVT.resolveEventChoice("not_an_event", "take")), "unknown eventId throws");
ok(throws(() => EVT.resolveEventChoice("flotsam", "buy")), "invalid choice for the event throws");
ok(throws(() => EVT.eventChoices("nope")), "eventChoices on a bad id throws");

// ── 8. ROLLERS — guaranteed event / guaranteed combat (deterministic) ──────────────────────────
console.log("rollers:");
const evRoll = EVT.rollVoyageEvent("harbor", 1, mulberry32(1));
ok(evRoll && evRoll.type === "event" && EVENTSAFE(evRoll.eventId), "rollVoyageEvent returns a real EVENT");
const amb = EVT.rollAmbush("open-sea", 3, mulberry32(2));
ok(amb && amb.type === "pve" && Array.isArray(amb.group) && amb.group.length > 0, "rollAmbush returns a real COMBAT group");
function EVENTSAFE(id) { try { return !!EVT.buildEventModel(id); } catch (e) { return false; } }

// ── 9. DETERMINISM — same seed → same outcome ──────────────────────────────────────────────────
console.log("determinism:");
reset(0, []); const a1 = EVT.resolveEventChoice("flotsam", "take", { rng: mulberry32(7) });
reset(0, []); const a2 = EVT.resolveEventChoice("flotsam", "take", { rng: mulberry32(7) });
ok(a1.outcome.goldDelta === a2.outcome.goldDelta && JSON.stringify(a1.outcome.items) === JSON.stringify(a2.outcome.items), "seeded salvage is reproducible");

// ── 10. ARM / READ / CLEAR pending event (parity with encounter.js) ────────────────────────────
console.log("pending-event arming:");
reset(0, []);
EVT.armVoyageEvent({ type: "event", eventId: "merchant_dhow", areaId: "harbor", danger: 1 }, { returnTo: "/seas/map.html" });
const pend = EVT.readVoyageEvent();
ok(pend && pend.eventId === "merchant_dhow" && pend.returnTo === "/seas/map.html", "armVoyageEvent stores a pending blob");
EVT.clearVoyageEvent();
ok(EVT.readVoyageEvent() === null, "clearVoyageEvent wipes it");

console.log(fails ? `\nEVENTS SMOKE FAILED: ${fails} assertion(s).` : "\nALL EVENT-RESOLVER SMOKE CHECKS PASSED ⚓");
process.exit(fails ? 1 : 0);
