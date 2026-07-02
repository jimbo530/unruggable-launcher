// node --test world-terrain.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { terrainAt, TERRAIN, TERRAIN_OVERRIDE } from './world-terrain.js';
import { sightRange } from './world-vision.js';

test('open sea by default -> 2-hex sight', () => {
  assert.equal(terrainAt(3, 4), TERRAIN.SEA);
  assert.equal(sightRange(terrainAt(3, 4)), 2);
});

test('a PORT hex is COAST (open) -> 2-hex sight', () => {
  const ports = { p1: { q: 5, r: 5 }, p2: { q: 9, r: 2 } };
  assert.equal(terrainAt(5, 5, ports), TERRAIN.COAST);
  assert.equal(sightRange(terrainAt(5, 5, ports)), 2);
  assert.equal(terrainAt(4, 4, ports), TERRAIN.SEA); // not a port -> sea
});

test('a founder override to rough terrain tightens sight to 1', () => {
  TERRAIN_OVERRIDE['9,9'] = TERRAIN.FOREST;
  assert.equal(terrainAt(9, 9), TERRAIN.FOREST);
  assert.equal(sightRange(terrainAt(9, 9)), 1);
  delete TERRAIN_OVERRIDE['9,9'];
});
