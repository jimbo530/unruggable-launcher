// @ts-check
/**
 * resolver.test.js — focused mechanic tests for the REAL v1 triad + CHAR
 * (node:test runner, zero deps). Run: node --test  (from game/class-engine/)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolve, makeConfig, computeStats, weightBracket, abilityMod, saveDC, splitWeights, DIFFUSE_KEY,
} from "../index.js";

const config = makeConfig();
const ids = (qualified) => qualified.map((q) => q.id);

// ───────────────────────────── SPLIT MATH ─────────────────────────────
test("splitWeights: single stat → {stat:1.0}; valid split passes; bad sum throws", () => {
  assert.deepEqual(splitWeights("STR"), { STR: 1.0 });
  assert.deepEqual(splitWeights({ STR: 0.5, CON: 0.5 }), { STR: 0.5, CON: 0.5 });
  assert.throws(() => splitWeights({ STR: 0.5, CON: 0.4 }), /sum to 1\.0/);
  assert.throws(() => splitWeights({ STR: 0.5, ZZZ: 0.5 }), /unknown stat/);
});

test("split math exact: $40 burgers → raw STR/CON 30 each (cap 20), others 10", () => {
  const s = computeStats({ burgers: 40 }, config.causes);
  assert.equal(s.raw.STR, 30, "raw STR = 10 + 40*0.5");
  assert.equal(s.raw.CON, 30);
  assert.equal(s.stats.STR, 20, "STR caps at 20");
  assert.equal(s.stats.CON, 20);
  assert.equal(s.stats.INT, 10, "non-fed stats untouched");
});

test("smaller split stake stays under cap and is exact", () => {
  const s = computeStats({ tgn: 12 }, config.causes); // WIS/CHA split
  assert.equal(s.stats.WIS, 16);
  assert.equal(s.stats.CHA, 16);
  assert.equal(s.stats.STR, 10);
});

test("diffuse (1/6) is unchanged and distinct from split", () => {
  const d = computeStats({ [DIFFUSE_KEY]: 6 }, config.causes); // +1 to all six
  for (const s of ["STR", "DEX", "CON", "INT", "WIS", "CHA"]) assert.equal(d.stats[s], 11);
  const e = computeStats({ egp: 6 }, config.causes); // DEX/INT split → +3 each
  assert.equal(e.stats.DEX, 13);
  assert.equal(e.stats.INT, 13);
  assert.equal(e.stats.STR, 10);
});

test("god cap 30 applies to BOTH stats of a split cause", () => {
  const s = computeStats({ burgers: { usd: 60, god: true } }, config.causes);
  assert.equal(s.caps.STR, 30);
  assert.equal(s.caps.CON, 30);
  assert.equal(s.stats.STR, 30);
  assert.equal(s.stats.CON, 30);
});

test("bluechip (even six-way earned split) raises all six stats equally", () => {
  const s = computeStats({ bluechip: 60 }, config.causes); // +10 each
  for (const st of ["STR", "DEX", "CON", "INT", "WIS", "CHA"]) assert.equal(s.stats[st], 20);
});

// ───────────────────────────── pointRate ─────────────────────────────
test("pointRate: default causes are 1.0x; CHAR is 1.5x per $1", () => {
  // TGN (default 1.0x), WIS/CHA split → $20 gives 20*1.0*0.5 = +10 WIS.
  const tgn = computeStats({ tgn: 20 }, config.causes);
  assert.equal(tgn.raw.WIS, 20, "1.0x: raw WIS = 10 + 10");

  // CHAR (1.5x), WIS/CON split → 20*1.5 = 30 points, *0.5 = +15 WIS, +15 CON.
  const char = computeStats({ char: 20 }, config.causes);
  assert.equal(char.raw.WIS, 25, "1.5x: raw WIS = 10 + 15");
  assert.equal(char.raw.CON, 25, "1.5x: raw CON = 10 + 15");
});

test("pointRate is 1.5x more efficient than a 1.0x cause for the same $ and split shape", () => {
  // Both WIS/CON-style: compare CHAR(1.5) to a hypothetical 1.0 cause via burgers-share math.
  // CHAR $20 → +15 to each split stat; a 1.0 cause $20 with .5 weight → +10. 15/10 = 1.5x.
  const char = computeStats({ char: 20 }, config.causes);
  const charGainWIS = char.raw.WIS - 10;
  const oneXGain = 20 * 1.0 * 0.5; // 1.0 rate, same 0.5 weight
  assert.equal(charGainWIS / oneXGain, 1.5);
});

test("pointRate validation: <= 0 throws LOUD", () => {
  const badCauses = [{ id: "z", name: "Z", family: "Tank", stat: "STR", pointRate: 0 }];
  const badClasses = [{
    id: "zc", name: "ZC", family: "Tank", primaryStat: "STR",
    requiredCauses: ["z"], ratioThreshold: 0.3, strictness: "loose", prereqs: [], tier: 0, abilities: [],
  }];
  assert.throws(() => makeConfig({ causes: badCauses, classes: badClasses }), /pointRate must be > 0/);
});

// ───────────────────────────── PUMP / GLASS CANNON ─────────────────────────────
test("PUMP applies NORMAL pointRate 1.0 into INT (single stat)", () => {
  // RULE: PUMP players receive PUMP tokens → no bonus → 1.0/$1.
  // $6 pump → +6 INT raw (under cap), proving the 1.0 rate.
  const small = computeStats({ pump: 6 }, config.causes);
  assert.equal(small.raw.INT, 16, "raw INT = 10 + 6*1.0");
  // $20 pump → 10 + 20*1.0 = 30 raw → caps at 20.
  const s = computeStats({ pump: 20 }, config.causes);
  assert.equal(s.raw.INT, 30, "raw INT = 10 + 20*1.0");
  assert.equal(s.stats.INT, 20, "caps at 20");
  assert.equal(s.stats.CON, 10, "no CON from PUMP");
});

test("PUMP 1.0 takes more $ to cap INT than CHAR's 1.5 would", () => {
  // PUMP (1.0): need $10 to hit INT 20 cap (10 + 10).
  assert.equal(computeStats({ pump: 10 }, config.causes).stats.INT, 20);
  assert.equal(computeStats({ pump: 9 }, config.causes).stats.INT, 19, "$9 → INT 19, not yet capped");
  // A 1.5-rate single-INT cause would cap at $6.67; PUMP needs $10. (Offset: player keeps PUMP tokens.)
});

test("pure-PUMP Wizard is a GLASS CANNON: high INT/DC, base 10 HP", () => {
  const v = resolve({ pump: 20 }, config);
  assert.ok(ids(v.qualified).includes("wizard"));
  const wz = v.qualified.find((q) => q.id === "wizard");
  assert.equal(wz.primaryStat, "INT");
  assert.equal(v.stats.INT, 20, "big INT");
  assert.equal(v.stats.CON, 10, "no CON");
  assert.equal(v.hp, 10, "base HP — squishy");
  assert.ok(wz.saveDC >= 13, `high spell DC, was ${wz.saveDC}`);
});

test("PUMP + CHAR build keeps the nuke but raises HP via CHAR's CON", () => {
  const v = resolve({ pump: 20, char: 16 }, config);
  // CHAR $16 → 16*1.5 = 24 pts, *0.5 = +12 CON → CON 22 → cap 20 → HP 20.
  assert.ok(v.stats.INT >= 20, "still a strong nuke");
  assert.ok(v.stats.CON > 10, "CON raised by CHAR");
  assert.ok(v.hp > 10, `HP raised above base (was ${v.hp})`);
  // Both Wizard and Warden may qualify depending on shares; Wizard must be present.
  assert.ok(ids(v.qualified).includes("wizard"), "still a Wizard");
});

// ───────────────────────────── CON → HP ─────────────────────────────
test("CON drives HP: HP = 10 + (CON - 10)", () => {
  assert.equal(computeStats({}, config.causes).hp, 10, "base CON 10 → HP 10");
  // $20 burgers → CON 20 → +10 HP.
  assert.equal(computeStats({ burgers: 20 }, config.causes).hp, 20);
  // $40 burgers → CON caps 20 → still +10 HP (cap limits both stat and HP).
  assert.equal(computeStats({ burgers: 40 }, config.causes).hp, 20);
  // god CON 30 → +20 HP.
  assert.equal(computeStats({ burgers: { usd: 60, god: true } }, config.causes).hp, 30);
});

test("CHAR raises both WIS and CON, so a CHAR build also gains HP", () => {
  // $12 char → 12*1.5 = 18 pts, *0.5 = +9 WIS, +9 CON (under cap) → CON 19 → HP 19.
  const under = resolve({ char: 12 }, config);
  assert.equal(under.stats.WIS, 19);
  assert.equal(under.stats.CON, 19);
  assert.equal(under.hp, 19, "CON 19 → HP 10 + 9 = 19");

  // $20 char → raw 25 each but normal cap 20 (no god flag) → CON 20 → HP 20.
  const capped = resolve({ char: 20 }, config);
  assert.equal(capped.stats.WIS, 20, "capped at 20");
  assert.equal(capped.stats.CON, 20);
  assert.equal(capped.hp, 20, "CON 20 → HP 20 (cap limits both stat and HP)");
});

// ───────────────────────────── TRIAD + CHAR QUALIFICATION ─────────────────────────────
test("focused BURGERS endower qualifies Barbarian; Fighter closes", () => {
  const v = resolve({ burgers: 40 }, config);
  assert.ok(ids(v.qualified).includes("barbarian"));
  assert.ok(!ids(v.qualified).includes("fighter"));
});

test("focused TGN endower qualifies Shepherd (WIS primary), WIS & CHA up", () => {
  const v = resolve({ tgn: 40 }, config);
  const shep = v.qualified.find((q) => q.id === "shepherd");
  assert.ok(shep && shep.primaryStat === "WIS");
  assert.ok(v.stats.WIS > 10 && v.stats.CHA > 10);
});

test("focused EGP endower qualifies Spellblade (DEX & INT up)", () => {
  const v = resolve({ egp: 40 }, config);
  assert.ok(ids(v.qualified).includes("spellblade"));
  assert.ok(v.stats.DEX > 10 && v.stats.INT > 10);
});

test("focused CHAR endower qualifies Warden (not Barbarian/Shepherd)", () => {
  const v = resolve({ char: 20 }, config);
  const q = ids(v.qualified);
  assert.ok(q.includes("warden"), "CHAR maps to Warden");
  assert.ok(!q.includes("barbarian"));
  assert.ok(!q.includes("shepherd"));
});

test("bought-water player is Fighter only, no specialist branch", () => {
  const v = resolve({ [DIFFUSE_KEY]: 60 }, config);
  assert.ok(ids(v.qualified).includes("fighter"));
  assert.ok(!ids(v.qualified).includes("barbarian"));
  assert.equal(v.perCause.length, 0);
});

test("earned generalist (bluechip) qualifies Generalist", () => {
  assert.ok(ids(resolve({ bluechip: 40 }, config).qualified).includes("generalist"));
});

// ───────────────────────────── DRIFT ─────────────────────────────
test("drift — diluting Burgers below 30% drops Barbarian", () => {
  const before = resolve({ burgers: 40, tgn: 60 }, config);
  assert.ok(ids(before.qualified).includes("barbarian"));
  const after = resolve({ burgers: 40, tgn: 60, egp: 60 }, config);
  const bShare = after.perCause.find((p) => p.id === "burgers").share;
  assert.ok(bShare < 0.30);
  assert.ok(!ids(after.qualified).includes("barbarian"));
});

test("full-triad endower reaches all six stats", () => {
  const v = resolve({ burgers: 30, tgn: 30, egp: 30 }, config);
  const q = ids(v.qualified);
  assert.ok(q.includes("barbarian") && q.includes("shepherd") && q.includes("spellblade"));
  for (const s of ["STR", "DEX", "CON", "INT", "WIS", "CHA"]) assert.ok(v.stats[s] > 10);
});

// ───────────────────────────── BRACKETS / TIERS / DC ─────────────────────────────
test("weight brackets bin total level", () => {
  assert.equal(weightBracket(2).id, "feather");
  assert.equal(weightBracket(5).id, "light");
  assert.equal(weightBracket(10).id, "middle");
  assert.equal(weightBracket(20).id, "heavy");
  assert.equal(weightBracket(25).id, "god");
});

test("ability tiers unlock by class-level", () => {
  const low = resolve({ burgers: 4 }, config);
  const lowIds = low.qualified.find((q) => q.id === "barbarian").availableAbilities.map((a) => a.id);
  assert.ok(lowIds.includes("rage"));
  assert.ok(!lowIds.includes("brutal_slam"));
  const high = resolve({ burgers: 12 }, config);
  const highIds = high.qualified.find((q) => q.id === "barbarian").availableAbilities.map((a) => a.id);
  assert.ok(highIds.includes("reckless_strike") && highIds.includes("brutal_slam"));
});

test("spell power = primary stat; save DC = 8 + mod", () => {
  const v = resolve({ tgn: 12 }, config); // Shepherd WIS 16 → mod +3 → DC 11
  const shep = v.qualified.find((q) => q.id === "shepherd");
  assert.equal(shep.spellPower, 16);
  assert.equal(abilityMod(16), 3);
  assert.equal(shep.saveDC, 11);
  assert.equal(saveDC(16), 11);
});

// ───────────────────────────── LOADOUT / DETERMINISM / SAFETY ─────────────────────────────
test("loadout cap follows bracket; multiclass exposes a menu", () => {
  assert.equal(resolve({ burgers: 4 }, config).loadoutOptions.cap, 1);
  const multi = resolve({ burgers: 30, tgn: 30, egp: 30 }, config);
  assert.ok(multi.loadoutOptions.candidates.length >= 3);
  assert.ok(multi.loadoutOptions.suggested.length <= multi.loadoutOptions.cap);
});

test("resolve is deterministic", () => {
  const e = { burgers: 24, tgn: 16 };
  assert.deepEqual(resolve(e, config), resolve(e, config));
});

test("unknown cause / negative fail LOUD", () => {
  assert.throws(() => resolve({ not_a_cause: 5 }, config), /unknown cause/);
  assert.throws(() => resolve({ burgers: -1 }, config), /negative/);
});

test("config with a bad split sum fails validation LOUD", () => {
  const badCauses = [{ id: "x", name: "X", family: "Tank", stat: { STR: 0.6, CON: 0.6 } }];
  const badClasses = [{
    id: "xc", name: "XC", family: "Tank", primaryStat: "STR",
    requiredCauses: ["x"], ratioThreshold: 0.3, strictness: "loose", prereqs: [], tier: 0, abilities: [],
  }];
  assert.throws(() => makeConfig({ causes: badCauses, classes: badClasses }), /sum to 1\.0/);
});
