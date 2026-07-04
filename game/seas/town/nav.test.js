// node nav.test.js  — smoke test for the walkable-map path/rail math.
import { buildAdj, bfsPath, bestNeighborByDir, lerp } from './nav.js';
import assert from 'node:assert';

let pass = 0;
function t(name, fn){ fn(); pass++; console.log('  ok -', name); }

// Mirror of the real Port Royal topology (plaza hub + 8 location nodes + ring).
const EDGES = [
  ['plaza','store'],['plaza','tavern'],['plaza','shipyard'],['plaza','crew'],
  ['plaza','battle'],['plaza','jobs'],['plaza','play'],['plaza','docks'],
  ['tavern','store'],['store','shipyard'],['tavern','crew'],['shipyard','battle'],
  ['crew','jobs'],['battle','docks'],['jobs','play'],['play','docks'],
];
const POS = {
  plaza:{x:.50,y:.50}, store:{x:.50,y:.16}, tavern:{x:.22,y:.26}, shipyard:{x:.78,y:.26},
  crew:{x:.16,y:.54},  battle:{x:.84,y:.54}, jobs:{x:.28,y:.84}, play:{x:.50,y:.88},
  docks:{x:.74,y:.84},
};
const adj = buildAdj(EDGES);

t('adjacency is symmetric', () => {
  for (const [a,b] of EDGES){
    assert(adj[a].includes(b), `${a}->${b} missing`);
    assert(adj[b].includes(a), `${b}->${a} missing`);
  }
});

t('plaza connects to all 8 location nodes', () => {
  assert.strictEqual(adj.plaza.length, 8);
});

t('bfsPath same node = single-element path', () => {
  assert.deepStrictEqual(bfsPath(adj,'plaza','plaza'), ['plaza']);
});

t('bfsPath direct neighbour = 2 hops', () => {
  assert.deepStrictEqual(bfsPath(adj,'plaza','tavern'), ['plaza','tavern']);
});

t('bfsPath finds a valid connected route between far nodes', () => {
  const p = bfsPath(adj,'store','jobs');
  assert(p.length >= 2, 'path should exist');
  assert.strictEqual(p[0],'store');
  assert.strictEqual(p[p.length-1],'jobs');
  for (let i=0;i<p.length-1;i++) assert(adj[p[i]].includes(p[i+1]), `gap ${p[i]}-${p[i+1]}`);
});

t('bfsPath returns [] when unreachable', () => {
  const a2 = buildAdj([['x','y']]);
  assert.deepStrictEqual(bfsPath(a2,'x','z'), []);
});

t('bestNeighborByDir: up from plaza picks store (directly above)', () => {
  // screen space, y-down: "up" = dy negative
  assert.strictEqual(bestNeighborByDir(POS,adj,'plaza',0,-1), 'store');
});

t('bestNeighborByDir: down from plaza picks play (directly below)', () => {
  assert.strictEqual(bestNeighborByDir(POS,adj,'plaza',0,1), 'play');
});

t('bestNeighborByDir: left from plaza picks a left-side node', () => {
  const n = bestNeighborByDir(POS,adj,'plaza',-1,0);
  assert(['crew','tavern','jobs'].includes(n), `got ${n}`);
});

t('bestNeighborByDir: zero vector -> null', () => {
  assert.strictEqual(bestNeighborByDir(POS,adj,'plaza',0,0), null);
});

t('lerp endpoints + midpoint', () => {
  assert.strictEqual(lerp(0,10,0), 0);
  assert.strictEqual(lerp(0,10,1), 10);
  assert.strictEqual(lerp(0,10,0.5), 5);
});

console.log(`\nALL ${pass} TESTS PASSED`);
