// node --test world-vision.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { sightRange, isHexScouted, visibleOthers, WORLD_SIGHT } from './world-vision.js';

test('open terrain (sea/grass) extends sight to 2; closed terrain stays 1', () => {
  assert.equal(WORLD_SIGHT.base, 1);
  assert.equal(WORLD_SIGHT.open, 2);
  assert.equal(sightRange('sea'), 2);
  assert.equal(sightRange('Grassland'), 2);
  assert.equal(sightRange('forest'), 1);
  assert.equal(sightRange(null), 1);
});

test('base sight = your hex + the ring (adjacent seen, 2 away hidden on closed terrain)', () => {
  const forest = () => 'forest';      // base 1
  const ships = [{ q: 5, r: 5 }];
  assert.ok(isHexScouted({ q: 6, r: 5 }, ships, forest), 'adjacent hex is scouted');
  assert.ok(!isHexScouted({ q: 8, r: 5 }, ships, forest), 'a hex 3 away is hidden at range 1');
});

test('open terrain widens to 2 hexes', () => {
  const sea = () => 'sea';            // open 2
  const ships = [{ q: 5, r: 5 }];
  assert.ok(isHexScouted({ q: 7, r: 5 }, ships, sea), '2 hexes away on sea is scouted');
});

test('sight is shared across ships — a ship on each front widens what you see', () => {
  const sea = () => 'sea';
  const ships2 = [{ q: 5, r: 5 }, { q: 20, r: 20 }];
  const others = [{ id: 'rival', q: 21, r: 20 }];      // next to ship #2, far from ship #1
  assert.equal(visibleOthers(ships2, others, sea).length, 1, 'shared: ship #2 spots the rival');
  assert.equal(visibleOthers([ships2[0]], others, sea).length, 0, 'solo ship #1 cannot see it');
});
