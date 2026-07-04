#!/usr/bin/env node
/*
  roll-charts.selftest.cjs — hermetic selftest for the win-loot resolver + signature framework.
  Proves (founder 2026-07-01 model):
    1. CORE always present when a signature is supplied (guaranteed drop).
    2. SECONDARY fires at ~the intended rate PER CR over many seeds (LOW at CR0-1, rising by CR).
    3. Same seed → same result (deterministic / un-re-rollable).
    4. Higher CR → higher secondary rate (monotonic-ish).
    5. AREA/biome steers the secondary pool to a thematically-matched pool.
    6. COMPLIANCE: resolveWinLoot output leaks NO odds/dice/roll/spin/jackpot fields or text.
  Uses a REAL crypto sha256 hashFn (the server injects the same). No network, no chain. node run.
*/
'use strict';
const crypto = require('crypto');
const rc = require('./roll-charts.js');
const sig = require('./loot-signatures.js');

const hashFn = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ FAIL:', msg); fails++; } else console.log('  ✓', msg); };

// ── 1. CORE always present when a signature is supplied ──────────────────────────────
console.log('\n[1] CORE guaranteed when signature supplied');
{
  const creatures = [
    { name: 'Wolf', subtypes: ['beast'] },
    { name: 'Goblin', subtypes: ['humanoid', 'goblinoid'] },
    { name: 'Skeleton', subtypes: ['undead'] },
    { name: 'Giant Crab', subtypes: ['animal', 'aquatic'] },
    { name: 'Totally New Mob', subtypes: ['beast'] },       // subtype fallback
    { name: 'Unsubtyped Thing', subtypes: [] },             // default fallback
  ];
  for (const c of creatures) {
    const s = sig.resolveSignature(c);
    const out = rc.resolveWinLoot({ cr: 1, area: 'forest', signature: s }, 'seed-abc-0001', hashFn);
    ok(out.core && Array.isArray(out.core.goods) && out.core.goods.length >= 1,
      `${c.name}: core present (${out.core.goods.map((g) => g.sym).join('+')}) [src=${s.source}]`);
  }
  // wolf specific: pelt + meat
  const wolf = sig.resolveSignature({ name: 'Wolf', subtypes: ['beast'] });
  ok(wolf.goods.some((g) => /pelt/i.test(g.note || '')) && wolf.goods.some((g) => g.kind === 'food'),
    'wolf CORE = wolf pelt + meat (founder example)');
  const boar = sig.resolveSignature({ name: 'Boar', subtypes: ['beast'] });
  ok(boar.goods.some((g) => g.sym === 'PORK') && boar.goods.some((g) => g.kind === 'hide'),
    'boar CORE = pork + hide (founder example)');
}

// ── 2 + 4. SECONDARY fires ~intended rate per CR, rising with CR ─────────────────────
console.log('\n[2+4] SECONDARY fire-rate by CR (low at CR0-1, rising)');
{
  const N = 20000;
  const rate = (cr) => {
    let fired = 0;
    for (let i = 0; i < N; i++) {
      const out = rc.resolveWinLoot({ cr, area: 'forest' }, `seed-rate-${cr}-${i}`, hashFn);
      if (out.secondary) fired++;
    }
    return fired / N;
  };
  const rates = {};
  for (const cr of [0, 1, 2, 3, 4, 5]) rates[cr] = rate(cr);
  for (const cr of [0, 1, 2, 3, 4, 5]) {
    const expected = rc.secondChance(cr);
    const within = Math.abs(rates[cr] - expected) < 0.02; // ±2 pts over 20k
    ok(within, `CR${cr}: observed ${(rates[cr] * 100).toFixed(1)}% ≈ target ${(expected * 100).toFixed(0)}%`);
  }
  ok(rates[0] < 0.15, `CR0 rate LOW (${(rates[0] * 100).toFixed(1)}% < 15%)`);
  ok(rates[0] >= 0.08 && rates[1] <= 0.20, `CR0-1 in founder ~8-12/18% band`);
  ok(rates[0] < rates[1] && rates[1] < rates[2] && rates[2] < rates[3] && rates[3] < rates[4] && rates[4] < rates[5],
    'secondary rate strictly rises CR0<1<2<3<4<5');
}

// ── 3. Same seed → same result (deterministic, un-re-rollable) ───────────────────────
console.log('\n[3] Determinism (same seed → same result)');
{
  const s = sig.resolveSignature({ name: 'Shark', subtypes: ['animal', 'aquatic'] });
  const a = rc.resolveWinLoot({ cr: 3, area: 'open-sea', signature: s }, 'pinned-seed-xyz-777', hashFn);
  const b = rc.resolveWinLoot({ cr: 3, area: 'open-sea', signature: s }, 'pinned-seed-xyz-777', hashFn);
  ok(JSON.stringify(a) === JSON.stringify(b), 'identical (seed,cr,area,signature) → identical result');
  // different seed generally differs in secondary decision across many samples
  let differ = 0;
  for (let i = 0; i < 200; i++) {
    const x = rc.resolveSecondary(3, 'open-sea', `seed-alpha-${i}`, hashFn);
    const y = rc.resolveSecondary(3, 'open-sea', `seed-bravo-${i}`, hashFn);
    if (JSON.stringify(x) !== JSON.stringify(y)) differ++;
  }
  ok(differ > 0, `different seeds produce different secondary outcomes (${differ}/200 differed)`);
}

// ── 5. AREA/biome steers to a thematically-matched pool ──────────────────────────────
console.log('\n[5] AREA/biome theming of the SECONDARY pool');
{
  // For a CR2-3 fight, forest→Deepwood, sea→Corsair, mountains→Highland, swamp→Mire, cave→Warren.
  const themeExpect = [
    { area: 'forest',    tier: '2-3', wantKey: 'deepwood' },
    { area: 'open-sea',  tier: '2-3', wantKey: 'corsair'  },
    { area: 'mountains', tier: '2-3', wantKey: 'highland' },
    { area: 'swamp',     tier: '2-3', wantKey: 'mire'     },
    { area: 'sea-caves', tier: '2-3', wantKey: 'warren'   },
  ];
  for (const t of themeExpect) {
    // find a seed that FIRES so we can inspect the pool pick
    let picked = null;
    for (let i = 0; i < 500 && !picked; i++) {
      const r = rc.resolveSecondary(3, t.area, `theme-${t.area}-${i}`, hashFn);
      if (r) picked = r;
    }
    ok(picked && picked.tier === t.tier && picked.poolKey === t.wantKey,
      `${t.area} @ CR3 → tier ${t.tier} pool "${picked ? picked.poolKey : 'NONE'}" (want ${t.wantKey})`);
  }
  // CR band mapping
  ok(rc.tierForCR(0) === '0-1' && rc.tierForCR(1) === '0-1', 'CR0-1 → tier 0-1');
  ok(rc.tierForCR(2) === '2-3' && rc.tierForCR(3) === '2-3', 'CR2-3 → tier 2-3');
  ok(rc.tierForCR(4) === '4-5' && rc.tierForCR(5) === '4-5', 'CR4-5 → tier 4-5');
}

// ── 6. COMPLIANCE: no odds/dice/roll/spin/jackpot leaked in resolveWinLoot output ────
console.log('\n[6] Compliance — no odds/dice/roll/spin/jackpot leak');
{
  const s = sig.resolveSignature({ name: 'Wolf', subtypes: ['beast'] });
  const out = rc.resolveWinLoot({ cr: 4, area: 'forest', signature: s }, 'compliance-seed-9', hashFn);
  const json = JSON.stringify(out).toLowerCase();
  const banned = ['odds', 'chance', 'roll', 'dice', 'spin', 'jackpot', 'wager', 'gamble', 'bet', 'probab', 'secondchance'];
  const leaked = banned.filter((w) => json.includes(w));
  ok(leaked.length === 0, `output free of banned terms (leaked: ${leaked.join(',') || 'none'})`);
  ok(!('roll' in out) && !('faces' in out) && (!out.secondary || !('probability' in out.secondary)),
    'no roll/faces/probability keys in the returned shape');
  ok(/won by skill/i.test(out.framing), 'framing = "You won by skill — see what treasure you find."');
}

// ── RECONCILE report (loud) against the CURRENT bestiary keys ────────────────────────
console.log('\n[reconcile] signature-override coverage vs CURRENT bestiary (⚠ RE-RUN after roster final)');
{
  const currentNames = [
    // sea
    'Bilge Rat','Shark','Merfolk Raider','Skeleton Crew','Navy Marine','Giant Crab','Sea Serpent',
    'Kraken Tentacle','Kraken Eye','Dolphin','Sea Cat','Great Shark','Pirate Deckhand','Pirate Cutthroat',
    // dungeon (sample of the 200+ roster)
    'Wolf','Dire Wolf','Worg','Boar','Dire Boar','Black Bear','Brown Bear','Dire Bear','Lion','Tiger',
    'Goblin','Kobold','Orc','Hobgoblin','Skeleton','Zombie','Mummy','Giant Spider','Small Spider',
    'Constrictor Snake','Crocodile','Gray Ooze','Ogre','Troll','Wyvern','Chimera','Sahuagin','Ghoul',
    'Green Hag','Rat Swarm','Dire Rat','Gelatinous Cube',
  ];
  const rep = sig.reconcileSignatures(currentNames);
  console.log(`  coverage: ${rep.withOverride.length}/${rep.total} have a per-name override`);
  console.log(`  ⚠ subtype-only (fall back to subtype default — safe, less specific):\n     ${rep.subtypeOnly.join(', ') || '(none)'}`);
  console.log('  ⚠ NOTE: another agent is STILL adding CR0-5 entries. Re-run reconcileSignatures() on the');
  console.log('    FINAL roster and sharpen any important subtype-only creatures before ship.');
  ok(rep.withOverride.length > 0, 'reconcile runs and reports coverage (soft — never throws)');
}

// ── 7. LEGACY resolveRoll() unchanged (the server still depends on the d6 6-pool draw) ─
console.log('\n[7] Legacy resolveRoll() intact');
{
  const r = rc.resolveRoll('goblin-cave', 'pinned-seed-legacy-123', hashFn);
  ok(r && typeof r.roll === 'number' && r.fires && r.fires.length === 1 && r.fires[0].pool.label,
    `resolveRoll works: roll ${r.roll} → ${r.fires[0].pool.label} (deployed=${r.fires[0].deployed})`);
  const r2 = rc.resolveRoll('goblin-cave', 'pinned-seed-legacy-123', hashFn);
  ok(JSON.stringify(r) === JSON.stringify(r2), 'resolveRoll still deterministic');
}

console.log(`\n${fails === 0 ? 'ALL PASS ✅' : `${fails} FAILURE(S) ❌`}`);
process.exit(fails === 0 ? 0 : 1);
