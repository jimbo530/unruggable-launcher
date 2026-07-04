// personal-bestiary.test.mjs — REAL harness for the bestiary + kill-achievement system.
// Simulates kills, asserts tier-crossing fires ONCE, asserts lore is gated by achievement, checks
// the rat spec verbatim, a boss reaching gold at a low count, and the GEM meta ladder + unlock events.
// Run: node game/seas/personal-bestiary.test.mjs   (exits non-zero on any failure — real-or-nothing)

import {
  getKillTiers, KILL_LADDERS, allMonsterIds, META_LADDER, achId, COIN_TOKENS, GEM_TOKENS,
} from './monster-achievements.js';
import { loreFor, allLoreIds } from './bestiary-lore.js';
import {
  makeStore, recordKill, knownLore, bestiaryFor, totalEarned, UNLOCK_EVENT_KIND,
} from './personal-bestiary.js';

let pass = 0, fail = 0;
const results = [];
function assert(cond, msg) {
  if (cond) { pass++; results.push('  PASS  ' + msg); }
  else { fail++; results.push('  FAIL  ' + msg); }
}
const PAWN = 'seas-crew:0x8C1f935F6DbB17d593BF3EC8114A2f045e350545:7';

console.log('\n=== monster-achievement + personal-bestiary harness ===\n');

// ── 0) roster coverage ──────────────────────────────────────────────────────────────────────
const ids = allMonsterIds();
console.log(`roster: ${ids.length} monsters covered by the kill ladder; ${allLoreIds().length} have lore.`);
assert(ids.length >= 150, `ladder covers the full roster (${ids.length} monsters, expect ~200+)`);
assert(allLoreIds().length === ids.length, 'every monster with a ladder also has a lore entry');
assert(COIN_TOKENS.COPPER.startsWith('0x') && GEM_TOKENS.DIAMOND.startsWith('0x'), 'coin + gem token addresses present');

// ── 1) RAT ladder is the founder's spec, VERBATIM (100 Exterminator / 1000 Master Exterminator, NO gold) ──
const rat = getKillTiers('rat');
console.log('\nrat ladder:', JSON.stringify(rat.map((r) => ({ count: r.count, title: r.title, tier: r.tier }))));
assert(rat.length === 2, 'rat has exactly 2 rungs (bronze + silver, NO gold)');
assert(rat[0].count === 100 && rat[0].title === 'Exterminator' && rat[0].tier === 'bronze', 'rat bronze = 100 kills → "Exterminator"');
assert(rat[1].count === 1000 && rat[1].title === 'Master Exterminator' && rat[1].tier === 'silver', 'rat silver = 1000 kills → "Master Exterminator"');
assert(!rat.some((r) => r.tier === 'gold'), 'rat has NO gold tier (vermin cap at silver)');
assert(rat[0].prizeToken === COIN_TOKENS.COPPER && rat[1].prizeToken === COIN_TOKENS.SILVER, 'rat rungs pay COPPER then SILVER');

// ── 2) a TOUGH foe (troll) REACHES GOLD at a LOWER count than the rat's silver ──
const troll = getKillTiers('troll');
console.log('troll ladder:', JSON.stringify(troll.map((r) => ({ count: r.count, title: r.title, tier: r.tier }))));
assert(troll.some((r) => r.tier === 'gold'), 'troll ladder REACHES gold');
const trollGold = troll.find((r) => r.tier === 'gold');
assert(trollGold.count < 1000, `troll gold count (${trollGold.count}) is far below the rat's 1000 (kill far fewer of the big ones)`);
assert(trollGold.prizeToken === COIN_TOKENS.GOLD, 'troll gold rung pays GOLD');

// ── 3) TIER CROSSING fires ONCE on recordKill, at the exact thresholds ──
const store = makeStore();
// 99 rats → nothing yet
let r = recordKill(store, PAWN, 'rat', 99);
assert(r.newlyEarned.length === 0 && r.killCount === 99, '99 rats: no tier yet (killCount 99)');
// the 100th rat → Exterminator (bronze) fires exactly once
r = recordKill(store, PAWN, 'rat', 1);
assert(r.killCount === 100, 'the 100th rat brings killCount to 100');
assert(r.newlyEarned.length >= 1 && r.newlyEarned[0].kind === UNLOCK_EVENT_KIND, 'crossing 100 fires an achievement_unlocked event');
const exterm = r.newlyEarned.find((e) => e.title === 'Exterminator');
assert(exterm && exterm.tier === 'bronze', 'the event is the bronze "Exterminator"');
assert(exterm.prize.coin === 'COPPER' && exterm.prize.prizeToken === COIN_TOKENS.COPPER, 'the unlock carries the COPPER coin prize');
// killing more rats (still < 1000) does NOT re-fire bronze
r = recordKill(store, PAWN, 'rat', 500); // now 600
assert(r.newlyEarned.length === 0, 'bronze does NOT re-fire on further rat kills (idempotent)');
// the 1000th rat → Master Exterminator (silver) fires once
r = recordKill(store, PAWN, 'rat', 400); // now 1000
const master = r.newlyEarned.find((e) => e.title === 'Master Exterminator');
assert(master && master.tier === 'silver' && master.prize.coin === 'SILVER', 'the 1000th rat fires the silver "Master Exterminator" (SILVER)');
// well past 1000 → nothing new (no gold for rats)
r = recordKill(store, PAWN, 'rat', 5000);
assert(r.newlyEarned.length === 0, 'no further rat tier ever fires (no gold for rats)');

// ── 4) LORE is GATED by the achievement ──
// A fresh pawn that has only SEEN a wolf (not earned it) gets the LOCKED stub + progress.
const store2 = makeStore();
recordKill(store2, PAWN, 'wolf', 3); // some kills but not the bronze threshold
const lockedWolf = knownLore(store2, PAWN, 'wolf');
console.log('\nlocked wolf lore:', JSON.stringify({ unlocked: lockedWolf.unlocked, prompt: lockedWolf.prompt, progress: lockedWolf.progress }));
assert(lockedWolf.unlocked === false, 'wolf lore is LOCKED before the achievement is earned');
assert(/fight it more/i.test(lockedWolf.prompt), 'locked lore shows the "fight it more to learn its ways" prompt');
assert(lockedWolf.progress && lockedWolf.progress.kills === 3 && lockedWolf.progress.remaining > 0, 'locked lore shows kill progress toward the first rung');
assert(!lockedWolf.lore, 'locked lore does NOT leak the strengths/weaknesses');
// now earn the wolf bronze → lore UNLOCKS
const wolfBronze = getKillTiers('wolf')[0].count;
recordKill(store2, PAWN, 'wolf', wolfBronze); // cross bronze
const openWolf = knownLore(store2, PAWN, 'wolf');
assert(openWolf.unlocked === true && openWolf.lore, 'wolf lore UNLOCKS once the bronze achievement is earned');
assert(Array.isArray(openWolf.lore.strengths) && Array.isArray(openWolf.lore.weaknesses) && openWolf.lore.tactics, 'unlocked lore carries strengths[], weaknesses[], tactics');
console.log('unlocked wolf lore:', JSON.stringify(openWolf.lore));

// ── 5) derived lore is SANE from stat blocks ──
const casterLore = loreFor('goblin_shaman'); // role: caster
assert(casterLore && casterLore.strengths.some((s) => /caster|spell/i.test(s)), 'a caster monster reads as a spellcaster in its strengths');
assert(casterLore.weaknesses.some((w) => /disrupt|casting/i.test(w)), 'a caster monster reads "disrupt its casting" in its weaknesses');
const tentacle = loreFor('kraken_tentacle');
assert(tentacle && (tentacle.weaknesses.some((w) => /sever/i.test(w)) || /sever/i.test(tentacle.tactics)), 'the kraken tentacle reads as severable');

// ── 6) GEM META LADDER — collecting achievements fires gem milestones ──
console.log('\nmeta ladder:', JSON.stringify(META_LADDER.map((m) => ({ count: m.count, title: m.title, gem: m.gem }))));
const store3 = makeStore();
// earn 10 distinct achievements by grinding 10 different monsters to bronze → should trip the first gem milestone.
let allEvents = [];
let earnedCount = 0;
for (const id of allMonsterIds()) {
  if (earnedCount >= 12) break;
  const first = getKillTiers(id)[0];
  if (!first) continue;
  const res = recordKill(store3, PAWN, id, first.count); // exactly cross bronze
  const gained = res.newlyEarned.filter((e) => e.tier !== 'gem').length;
  earnedCount += gained;
  allEvents = allEvents.concat(res.newlyEarned);
}
const gemEvent = allEvents.find((e) => e.tier === 'gem');
console.log('first gem unlock:', gemEvent ? JSON.stringify({ title: gemEvent.title, gem: gemEvent.prize.coin, token: gemEvent.prize.prizeToken }) : 'none');
assert(gemEvent, 'collecting >=10 achievements fires a GEM meta milestone');
assert(gemEvent.tier === 'gem' && gemEvent.prize.prizeToken && Object.values(GEM_TOKENS).includes(gemEvent.prize.prizeToken), 'the gem milestone pays a verified GEM token');
assert(totalEarned(store3, PAWN) >= 11, `pawn total earned (${totalEarned(store3, PAWN)}) includes the 10 kill tiers + the gem milestone`);

// ── 7) bestiaryFor returns a coherent view ──
const view = bestiaryFor(store, PAWN); // the rat pawn from step 3
assert(view.monsters.length >= 1 && view.monsters[0].monsterId === 'rat', 'bestiaryFor lists the rat the pawn ground');
assert(view.monsters[0].kills >= 6000 && view.monsters[0].titles.includes('Exterminator'), 'the rat row shows the kill count + earned titles');
assert(view.titles.length >= 2, 'bestiaryFor lists the earned titles');
console.log('\nbestiary view (rat pawn):', JSON.stringify({ monsters: view.monsters.length, titles: view.titles.map((t) => t.title), meta: view.meta }));

// ── 8) unknown monster still COUNTS but has no ladder (real-or-nothing) ──
const r8 = recordKill(store, PAWN, 'no_such_beast_xyz', 5);
assert(r8.killCount === 5 && r8.newlyEarned.length === 0, 'an unknown monster still counts kills but crosses no tier');

// ── report ──
console.log('\n' + results.join('\n'));
console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
