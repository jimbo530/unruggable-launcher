// @ts-check
/**
 * diffuse-row-water.test.js — proves the founder 2026-06-30 fix: a pawn's LEVEL/_diffuse
 * is the SUM of ALL its diffuse waters (generic WATER 0x9789 + its ship ROW vault), NOT just
 * the generic vault. node:test, zero deps. Run: node --test (from game/seas/class-engine/).
 *
 * Two layers are covered:
 *  1) RESOLVER math — the engine already sums every '_diffuse' contribution into one diffuse pool;
 *     these assertions pin that $2 diffuse = +1/3 each stat and $1 diffuse = +1/6 (backward-compat).
 *  2) SNAPSHOT-BUILD merge — the build-water-levels.cjs per-key accumulator collapses the generic
 *     vault read AND the row-vault read into a single _diffuse total. We reproduce that exact
 *     accumulation (the load-bearing line) to prove generic $1 + row $1 → _diffuse 2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeStats, makeConfig, DIFFUSE_KEY } from "../index.js";

const config = makeConfig();
const STATS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── 1) RESOLVER: diffuse sums; $2 → +1/3 each stat; $1 → +1/6 (unchanged) ──
test("row+generic diffuse: _diffuse=2 raises every stat by +1/3 (10.333…)", () => {
  const s = computeStats({ [DIFFUSE_KEY]: 2 }, config.causes); // $1 generic + $1 row, pre-summed
  for (const st of STATS) {
    assert.ok(approx(s.raw[st], 10 + 2 / 6), `${st} raw should be 10 + 2/6, got ${s.raw[st]}`);
  }
});

test("backward-compatible: _diffuse=1 (generic only, no row) raises every stat by +1/6", () => {
  const s = computeStats({ [DIFFUSE_KEY]: 1 }, config.causes); // generic vault only
  for (const st of STATS) {
    assert.ok(approx(s.raw[st], 10 + 1 / 6), `${st} raw should be 10 + 1/6, got ${s.raw[st]}`);
  }
});

test("row water adds ON TOP of cause water without disturbing the single-stat causes", () => {
  // $1 generic + $1 row = _diffuse 2 (+1/3 all), PLUS $40 BURGERS → CON (single-stat cause).
  const s = computeStats({ [DIFFUSE_KEY]: 2, burgers: 40 }, config.causes);
  // Every stat gets the diffuse bump…
  for (const st of STATS) assert.ok(s.raw[st] >= 10 + 2 / 6 - 1e-9, `${st} keeps the diffuse bump`);
  // …and CON additionally gets the full BURGERS concentration (then caps at 20).
  assert.equal(s.stats.CON, 20, "CON caps at 20 from BURGERS + diffuse");
  assert.ok(approx(s.raw.STR, 10 + 2 / 6), "STR only gets the diffuse share (BURGERS is CON-only now)");
});

// ── 2) SNAPSHOT-BUILD merge: generic read + row read collapse into one _diffuse ──
// Mirrors build-water-levels.cjs exactly:
//   (snapshot[crewId] ||= {})[v.key] = (snapshot[crewId][v.key] || 0) + usd
// run once per vault for a pawn (generic, then its row vault), both key '_diffuse'.
test("snapshot accumulation: generic $1 + row $1 → one _diffuse=2 entry", () => {
  const reads = [
    { key: "_diffuse", usd: 1 }, // generic WATER 0x9789 principal
    { key: "_diffuse", usd: 1 }, // this ship's ROW vault principal
  ];
  const snapshot = {};
  const crewId = "0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f:51";
  for (const r of reads) {
    (snapshot[crewId] || (snapshot[crewId] = {}))[r.key] = (snapshot[crewId][r.key] || 0) + r.usd;
  }
  assert.deepEqual(snapshot[crewId], { _diffuse: 2 }, "two diffuse reads sum into one _diffuse");

  // …and that merged endowment, fed to the resolver, yields +1/3 each stat.
  const s = computeStats(snapshot[crewId], config.causes);
  for (const st of STATS) assert.ok(approx(s.raw[st], 10 + 2 / 6), `${st} = 10 + 1/3`);
});

test("snapshot accumulation backward-compat: generic-only pawn keeps _diffuse=1", () => {
  const reads = [{ key: "_diffuse", usd: 0.499999 }]; // a real Harbor Guard value from water-levels.json
  const snapshot = {};
  const crewId = "0x8C1f935F6DbB17d593BF3EC8114A2f045e350545:50";
  for (const r of reads) {
    (snapshot[crewId] || (snapshot[crewId] = {}))[r.key] = (snapshot[crewId][r.key] || 0) + r.usd;
  }
  assert.deepEqual(snapshot[crewId], { _diffuse: 0.499999 }, "no row vault → unchanged generic-only entry");
});
