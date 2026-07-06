// node --test land-journey.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import {
  WALK_HOURS_PER_HEX, PARTY_ENTITY, walkHexDistance, walkLine,
  isLandTerrain, canWalk, planWalk,
} from './land-journey.js';

// A tiny synthetic terrain: a strip of land (r===3) surrounded by sea. Port Royal-ish island
// on one row so straight-line walks stay on land; a jump to another row crosses sea.
const land = new Set(['7,3', '8,3', '9,3', '10,3', '11,3']);
const terrainAt = (q, r) => (land.has(q + ',' + r) ? 'plains' : 'sea');
const GRID = { cols: 16, rows: 11 };

test('dials: walk is 12h/hex, slower than a ship (8h/hex)', () => {
  assert.equal(WALK_HOURS_PER_HEX, 12);
  assert.ok(WALK_HOURS_PER_HEX > 8, 'walking must be slower than sailing');
  assert.equal(PARTY_ENTITY, 'party');
});

test('walkHexDistance matches the odd-q cube convention', () => {
  assert.equal(walkHexDistance({ q: 8, r: 3 }, { q: 8, r: 3 }), 0);
  assert.equal(walkHexDistance({ q: 8, r: 3 }, { q: 9, r: 3 }), 1); // one hex east = 1 hex
  assert.equal(walkHexDistance({ q: 8, r: 3 }, { q: 11, r: 3 }), 3);
});

test('walkLine is the inclusive straight hex path', () => {
  const line = walkLine({ q: 8, r: 3 }, { q: 11, r: 3 });
  assert.equal(line.length, 4);                       // 3 hexes distance -> 4 cells inclusive
  assert.deepEqual(line[0], { q: 8, r: 3 });
  assert.deepEqual(line[line.length - 1], { q: 11, r: 3 });
});

test('isLandTerrain: sea/water/ocean/empty are NOT walkable; land is', () => {
  assert.equal(isLandTerrain('sea'), false);
  assert.equal(isLandTerrain('water'), false);
  assert.equal(isLandTerrain('ocean'), false);
  assert.equal(isLandTerrain(''), false);
  assert.equal(isLandTerrain('plains'), true);
  assert.equal(isLandTerrain('beach'), true);
  assert.equal(isLandTerrain('mountain'), true);
});

test('canWalk: land target on an all-land line is allowed', () => {
  const r = canWalk({ q: 8, r: 3 }, { q: 11, r: 3 }, terrainAt, GRID);
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
});

test('canWalk: a water target is blocked with the sail-instead message', () => {
  const r = canWalk({ q: 8, r: 3 }, { q: 8, r: 5 }, terrainAt, GRID);
  assert.equal(r.ok, false);
  assert.match(r.reason, /sea is in the way/);
});

test('canWalk: a land target whose straight line crosses sea is blocked', () => {
  // add an isolated land hex far away so the target itself is land, but the line to it is sea.
  const land2 = new Set([...land, '8,7']);
  const t2 = (q, r) => (land2.has(q + ',' + r) ? 'plains' : 'sea');
  const r = canWalk({ q: 8, r: 3 }, { q: 8, r: 7 }, t2, GRID);
  assert.equal(r.ok, false);
  assert.match(r.reason, /sea is in the way/);
});

test('canWalk: same hex / off-chart are refused', () => {
  assert.equal(canWalk({ q: 8, r: 3 }, { q: 8, r: 3 }, terrainAt, GRID).ok, false);
  assert.equal(canWalk({ q: 8, r: 3 }, { q: 99, r: 3 }, terrainAt, GRID).ok, false);
});

test('planWalk: distance × 12h fiction; ms dev-scaled (1.5× a ship hex)', () => {
  const p = planWalk({ q: 8, r: 3 }, { q: 11, r: 3 }, { msPerHex: 5000, speed: 1 });
  assert.equal(p.distance, 3);
  assert.equal(p.hours, 36);                          // 3 hexes × 12h
  // ms = (hours/8) * msPerHex / speed = (36/8) * 5000 = 22500. Per-hex that's 7500ms = 1.5× a
  // ship's 5000ms/hex — the "slower on foot" fiction expressed in real time.
  assert.equal(p.ms, 22500);
  assert.equal(p.ms / p.distance, 7500);
});

test('planWalk: speed and msPerHex default sanely', () => {
  const p = planWalk({ q: 8, r: 3 }, { q: 9, r: 3 });
  assert.equal(p.distance, 1);
  assert.equal(p.hours, 12);
  assert.ok(p.ms > 0);
});
