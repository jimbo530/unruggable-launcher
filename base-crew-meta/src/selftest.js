// ============================================================
//  selftest.js — no-server smoke test of the Base crew module.
//  Exercises: crewKey canonicalisation, closet look store, gear->look, render
//  (placeholder when art is absent), ERC-721 metadata shape, stats, and ship-flag
//  store. Writes go to data/ (a throwaway local store). No chain, no network.
//  Run: node src/selftest.js
// ============================================================
const assert = require('assert');
const closet = require('./closet');
const { buildMetadata } = require('./metadata');
const { renderCrew } = require('./render');
const gearHook = require('./gear-hook');
const flagStore = require('./flag-store');
const { getStats } = require('./stats');

const DIST = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';

(async () => {
  // 1. crewKey canonicalisation (address lowercased, tokenId preserved)
  const k = closet.crewKey(DIST, 7);
  assert.strictEqual(k, DIST.toLowerCase() + ':7', 'crewKey canonicalisation');
  assert.strictEqual(closet.crewKey(DIST + ':7'), k, 'crewKey from string');
  assert.strictEqual(closet.crewKey({ distributor: DIST, tokenId: 7 }), k, 'crewKey from object');
  console.log('PASS  crewKey ->', k);

  // 2. default look + deterministic gender (id 7 odd -> boy)
  const look0 = closet.getLook(k);
  assert.strictEqual(look0.base, 'boy', 'odd id default boy');
  assert.strictEqual(look0.color, 'natural', 'default natural');
  console.log('PASS  default look:', JSON.stringify(look0));

  // 3. closet writes: colour + equip a hat
  closet.setColor(k, 'blue');
  closet.equip(k, 'hat', 'item-crown:yellow');
  const look1 = closet.getLook(k);
  assert.strictEqual(look1.color, 'blue', 'colour set');
  assert.strictEqual(look1.items.hat, 'item-crown:yellow', 'hat equipped');
  console.log('PASS  closet writes:', JSON.stringify(look1.items), look1.color);

  // 4. gear -> look (GearStore1155 id 1 maps to gear-crown-king in config)
  const owner = '0x1111111111111111111111111111111111111111';
  gearHook.onGearBought(owner, 1);                 // grant
  const equipped = gearHook.equipGearOnCrew(k, 1, { owner }); // equip onto crew
  assert.ok(equipped.items.gear && equipped.items.gear.startsWith('gear-crown-king'), 'gear equipped');
  console.log('PASS  gear->look: gear slot =', equipped.items.gear);

  // 5. render produces a non-trivial PNG (placeholder base when art absent)
  const { png, traits } = await renderCrew(closet.getLook(k));
  assert.ok(Buffer.isBuffer(png) && png.length > 1000, 'render produced a PNG');
  assert.ok(png.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG magic');
  console.log('PASS  render: PNG', png.length, 'bytes; traits:', traits.map(t => t.trait_type).join(','));

  // 6. ERC-721 metadata shape
  const meta = buildMetadata(k, 'https://crew.tasern.quest');
  for (const f of ['name', 'description', 'image', 'attributes']) assert.ok(f in meta, 'metadata has ' + f);
  assert.ok(Array.isArray(meta.attributes) && meta.attributes.length > 0, 'attributes is a non-empty array');
  assert.ok(meta.image.startsWith('https://crew.tasern.quest/crew/render/'), 'image is the render URL');
  const hasClass = meta.attributes.some(a => a.trait_type === 'Class');
  const hasLevel = meta.attributes.some(a => a.trait_type === 'Level');
  assert.ok(hasClass && hasLevel, 'class + level attributes present');
  console.log('PASS  metadata: image =', meta.image);
  console.log('      attributes =', JSON.stringify(meta.attributes));

  // 7. stats (captain = id 0, derived class for id 7)
  console.log('PASS  stats id7 =', JSON.stringify(getStats(k)));
  console.log('PASS  stats id0 class =', getStats(closet.crewKey(DIST, 0)).class);

  // 8. ship flag store (tiny 1x1 PNG as a flag), metadata image resolves to it
  const tinyPng = await flagStore.decodeImage(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  );
  assert.ok(Buffer.isBuffer(tinyPng), 'flag decode');
  const shipAddr = '0x2222222222222222222222222222222222222222';
  await flagStore.setShipFlag(shipAddr, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'launcher');
  assert.ok(flagStore.hasFlag(shipAddr), 'flag stored');
  const shipMeta = flagStore.buildShipMetadata(shipAddr, 'https://crew.tasern.quest', { name: 'Test Ship', symbol: 'TS' });
  assert.ok(shipMeta.image.endsWith('/ship/flag/' + shipAddr.toLowerCase() + '.png'), 'ship metadata image = flag');
  console.log('PASS  ship flag: meta image =', shipMeta.image);

  console.log('\nALL SELF-TESTS PASSED');
})().catch((e) => { console.error('\nSELFTEST FAILED:', e.message); process.exit(1); });
