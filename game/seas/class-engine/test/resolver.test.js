// @ts-check
/**
 * resolver.test.js — focused mechanic tests for the REAL v1 triad + CHAR
 * (node:test runner, zero deps). Run: node --test  (from game/class-engine/)
 *
 * ATOMIC SINGLE-STAT ROSTER (founder 2026-06-28 remap — see config/causes.js):
 *   burgers→CON, tgn→CHA, egp→DEX, char→WIS(1.5x), ccc→STR(1.5x), pump→INT, bluechip→even 1/6.
 * Each cause feeds ONE stat now (no STR/CON, WIS/CHA, DEX/INT splits). The split MACHINERY still
 * exists (bluechip is a six-way split; splitWeights/validation tests below exercise it via inline
 * configs) — only the v1 triad CAUSES became single-stat. Tests use that single-stat truth.
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

test("atomic math exact: $40 burgers → raw CON 50 (cap 20), others 10", () => {
  const s = computeStats({ burgers: 40 }, config.causes); // burgers → CON (single, 1.0x)
  assert.equal(s.raw.CON, 50, "raw CON = 10 + 40*1.0");
  assert.equal(s.stats.CON, 20, "CON caps at 20");
  assert.equal(s.stats.STR, 10, "burgers no longer feeds STR (atomic)");
  assert.equal(s.stats.INT, 10, "non-fed stats untouched");
});

test("smaller single-stat stake stays under cap and is exact", () => {
  const s = computeStats({ tgn: 12 }, config.causes); // tgn → CHA (single, 1.0x)
  assert.equal(s.stats.CHA, 22 > 20 ? 20 : 22, "10 + 12 = 22 → caps at 20");
  assert.equal(s.stats.CHA, 20);
  assert.equal(s.stats.WIS, 10, "tgn no longer feeds WIS (atomic)");
  assert.equal(s.stats.STR, 10);
  const small = computeStats({ tgn: 6 }, config.causes); // under cap
  assert.equal(small.stats.CHA, 16, "10 + 6 = 16, exact");
});

test("diffuse (1/6) is unchanged and distinct from a single-stat cause", () => {
  const d = computeStats({ [DIFFUSE_KEY]: 6 }, config.causes); // +1 to all six
  for (const s of ["STR", "DEX", "CON", "INT", "WIS", "CHA"]) assert.equal(d.stats[s], 11);
  const e = computeStats({ egp: 6 }, config.causes); // egp → DEX (single) → +6 DEX only
  assert.equal(e.stats.DEX, 16);
  assert.equal(e.stats.INT, 10, "egp no longer feeds INT (atomic)");
  assert.equal(e.stats.STR, 10);
});

test("god cap 30 applies to the cause's stat", () => {
  const s = computeStats({ burgers: { usd: 60, god: true } }, config.causes); // burgers → CON
  assert.equal(s.caps.CON, 30, "god lifts CON cap to 30");
  assert.equal(s.stats.CON, 30, "raw 10 + 60 = 70 → god cap 30");
  assert.equal(s.stats.STR, 10, "STR untouched (atomic), normal cap");
  assert.equal(s.caps.STR, 20);
});

test("bluechip (even six-way earned split) raises all six stats equally", () => {
  const s = computeStats({ bluechip: 60 }, config.causes); // +10 each
  for (const st of ["STR", "DEX", "CON", "INT", "WIS", "CHA"]) assert.equal(s.stats[st], 20);
});

// ───────────────────────────── pointRate ─────────────────────────────
test("pointRate: default causes are 1.0x; CHAR is 1.5x per $1", () => {
  // TGN (default 1.0x), single CHA → $20 gives 20*1.0 = +20 CHA raw.
  const tgn = computeStats({ tgn: 20 }, config.causes);
  assert.equal(tgn.raw.CHA, 30, "1.0x: raw CHA = 10 + 20");

  // CHAR (1.5x), single WIS → 20*1.5 = +30 WIS raw. (Atomic: CHAR no longer touches CON.)
  const char = computeStats({ char: 20 }, config.causes);
  assert.equal(char.raw.WIS, 40, "1.5x: raw WIS = 10 + 30");
  assert.equal(char.raw.CON, 10, "atomic: CHAR feeds WIS only, not CON");
});

test("pointRate is 1.5x more efficient than a 1.0x cause for the same $", () => {
  // Single-stat now: CHAR(1.5) puts +30 WIS for $20; a 1.0 single-stat cause (pump) puts +20 INT.
  // 30/20 = 1.5x. (No split weight in the comparison anymore — both are whole single-stat points.)
  const charGainWIS = computeStats({ char: 20 }, config.causes).raw.WIS - 10;     // 30 (1.5x)
  const pumpGainINT = computeStats({ pump: 20 }, config.causes).raw.INT - 10;     // 20 (1.0x)
  assert.equal(charGainWIS / pumpGainINT, 1.5);
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

test("PUMP + BURGERS build keeps the nuke but raises HP via BURGERS' CON", () => {
  // Atomic: CON comes from a CON cause (BURGERS), not CHAR (which is now WIS-only). Splash BURGERS
  // to give the glass-cannon a body. PUMP $20 → INT 20 (cap); BURGERS $10 → CON 20 → HP 20.
  const v = resolve({ pump: 20, burgers: 10 }, config);
  assert.ok(v.stats.INT >= 20, "still a strong nuke");
  assert.ok(v.stats.CON > 10, "CON raised by BURGERS");
  assert.ok(v.hp > 10, `HP raised above base (was ${v.hp})`);
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

test("CHAR is atomic WIS (1.5x): raises WIS only, gives NO HP (Warden takes its body from CON elsewhere)", () => {
  // $12 char → 12*1.5 = +18 WIS → raw 28 → cap 20. CON untouched (10) → HP stays 10.
  const v = resolve({ char: 12 }, config);
  assert.equal(v.stats.WIS, 20, "raw 10 + 18 = 28 → caps at 20");
  assert.equal(v.stats.CON, 10, "atomic: CHAR no longer feeds CON");
  assert.equal(v.hp, 10, "no CON gain → base HP 10");

  // Small stake under cap proves the 1.5x WIS rate exactly: $6 char → +9 WIS → 19.
  const small = resolve({ char: 6 }, config);
  assert.equal(small.stats.WIS, 19, "10 + 6*1.5 = 19");
  assert.equal(small.stats.CON, 10);
  assert.equal(small.hp, 10);
});

// ───────────────────────────── TRIAD + CHAR QUALIFICATION ─────────────────────────────
test("focused BURGERS endower qualifies Barbarian; Fighter closes", () => {
  const v = resolve({ burgers: 40 }, config);
  assert.ok(ids(v.qualified).includes("barbarian"));
  assert.ok(!ids(v.qualified).includes("fighter"));
});

test("focused TGN endower qualifies Shepherd (CHA primary), CHA up", () => {
  const v = resolve({ tgn: 40 }, config);
  const shep = v.qualified.find((q) => q.id === "shepherd");
  assert.ok(shep && shep.primaryStat === "CHA", "Shepherd's primary is CHA");
  assert.ok(v.stats.CHA > 10, "CHA up from TGN");
  assert.equal(v.stats.WIS, 10, "atomic: TGN no longer raises WIS");
});

test("focused EGP endower qualifies Spellblade (DEX up)", () => {
  const v = resolve({ egp: 40 }, config);
  assert.ok(ids(v.qualified).includes("spellblade"));
  assert.ok(v.stats.DEX > 10, "DEX up from EGP");
  assert.equal(v.stats.INT, 10, "atomic: EGP no longer raises INT");
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

test("the atomic v1 triad covers three stats (CON/CHA/DEX); all six needs the full roster", () => {
  // Atomic: burgers→CON, tgn→CHA, egp→DEX. The triad alone lights exactly THOSE three.
  const triad = resolve({ burgers: 30, tgn: 30, egp: 30 }, config);
  const q = ids(triad.qualified);
  assert.ok(q.includes("barbarian") && q.includes("shepherd") && q.includes("spellblade"));
  assert.ok(triad.stats.CON > 10 && triad.stats.CHA > 10 && triad.stats.DEX > 10, "triad stats up");
  assert.equal(triad.stats.STR, 10, "STR needs CCC");
  assert.equal(triad.stats.INT, 10, "INT needs PUMP");
  assert.equal(triad.stats.WIS, 10, "WIS needs CHAR");

  // The FULL single-stat roster (one cause per stat) reaches all six.
  const all = resolve({ ccc: 20, egp: 20, burgers: 20, pump: 20, char: 20, tgn: 20 }, config);
  for (const s of ["STR", "DEX", "CON", "INT", "WIS", "CHA"]) assert.ok(all.stats[s] > 10, `${s} up`);
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
  // classLevel = $ in the class's required cause; abilities gate on minClassLevel. A class only
  // appears once TOTAL level >= the FIRST_CLASS_LEVEL floor (5), so use $5+ stakes here.
  const low = resolve({ burgers: 5 }, config); // classLevel 5: rage(1)+reckless_strike(5), not brutal_slam(10)
  const lowIds = low.qualified.find((q) => q.id === "barbarian").availableAbilities.map((a) => a.id);
  assert.ok(lowIds.includes("rage"));
  assert.ok(!lowIds.includes("brutal_slam"));
  const high = resolve({ burgers: 12 }, config); // classLevel 12: all three unlocked
  const highIds = high.qualified.find((q) => q.id === "barbarian").availableAbilities.map((a) => a.id);
  assert.ok(highIds.includes("reckless_strike") && highIds.includes("brutal_slam"));
});

test("spell power = primary stat; save DC = 8 + mod", () => {
  // Shepherd's primary is CHA. tgn→CHA (single): $6 → CHA 16 (under cap) → mod +3 → DC 11.
  const v = resolve({ tgn: 6 }, config);
  const shep = v.qualified.find((q) => q.id === "shepherd");
  assert.equal(shep.spellPower, 16, "spellPower = CHA (Shepherd primary)");
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
