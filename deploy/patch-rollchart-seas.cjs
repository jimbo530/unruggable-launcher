#!/usr/bin/env node
/**
 * patch-rollchart-seas.cjs — SURGICAL standalone patch that wires the ROLL-CHART PRIZE into the LIVE
 * seas-server (which already has cooldown + orb + ownerOf-harden applied, NOT the roll integration).
 *
 * WHAT IT DOES (purely ADDITIVE to verify-fight — no existing field renamed/removed):
 *   On a SERVER-VERIFIED WIN, verify-fight rolls LOCATION_CHARTS[fight] (DETERMINISTIC off the pinned
 *   seed via sha256 — server-authoritative, un-re-rollable), pins the result on the consumed nonce, and
 *   adds to the response:
 *     - roll  : the full roll-chart result { fight, dice, roll, faces, crit, fires:[…], framing }
 *     - prize : { poolId, poolAddress, label, deployed }  (the numbered LootPool the keeper fires)
 *   A loss / inconclusive run rolls NOTHING (roll:null, prize:null). The roll only NAMES the pool — the
 *   founder-gated keeper performs the on-chain payout. Compliance framing: "win by skill → win a random
 *   prize" (never spin/jackpot/odds/wager/gamble/bet).
 *
 * 4 EDITS (each anchored BYTE-EXACT + UNIQUE against deploy/live-seas-server.snapshot.js):
 *   (1) require ./roll-charts.js + a rollHash(sha256) helper  — after the forge require
 *   (2) resolve the roll on a win                              — after the cooldown-start block
 *   (3) add roll + prize to the verify-fight response body     — after `payoutEligible: playerWon,`
 *   (4) live --selftest: assert the WIN carries the prize/roll  — after the payout-eligible assertion
 *
 * roll-charts.js IS A PURE MODULE (no ethers, no I/O, no requires) → SAFE in the server dir. This patch
 * requires it as ./roll-charts.js, so it MUST be scp'd to the SERVER dir: /var/www/tasern/server/roll-charts.js
 * (the SAME dir as forge-title.js, which the live server already requires as ./forge-title.js).
 *
 * Idempotent (re-run = no-op once patched). DRY by default; --write applies. Aborts LOUDLY if any anchor
 * is missing/drifted/ambiguous (no blind insert). Backs up to .pre-rollchart.bak.
 *
 * USAGE (on the VPS, coordinator):
 *   node patch-rollchart-seas.cjs --server /var/www/tasern/server/seas-server.js          # DRY
 *   node patch-rollchart-seas.cjs --server /var/www/tasern/server/seas-server.js --write    # applies
 * Then: scp roll-charts.js → /var/www/tasern/server/  ; node --check ; --selftest ; pm2 restart ; curl-verify.
 *
 * NO SILENT CATCHES — anchor failures abort loudly; the server addition only NAMES a pool (moves nothing).
 */
'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WRITE = args.includes('--write');
const SERVER = opt('--server');
if (!SERVER) { console.error('required: --server <path to live seas-server.js>'); process.exit(1); }

// ── (1) require + rollHash ─────────────────────────────────────────────────────────────────────
// Anchor: the live forge require line (server-dir form, present post-forge-patch). Insert AFTER it.
const REQ_ANCHOR = `const forge = require('./forge-title.js');`;
const REQ_INSERT = `
// ROLL-CHART PRIZE — pure config + server-authoritative roll engine (no ethers, no I/O). Required from
// the SERVER dir (scp roll-charts.js → /var/www/tasern/server/). NAMES the pool to fire; moves no funds.
const rollCharts = require('./roll-charts.js');
// sha256 hex of the pinned seed — the injected hashFn the roll engine derives the deterministic roll from.
function rollHash(s) { return require('crypto').createHash('sha256').update(String(s)).digest('hex'); }`;

// ── (2) resolve the roll on a win ──────────────────────────────────────────────────────────────
// Anchor: the cooldown-start block (the 3 lines that close with `}`). Insert the roll resolution AFTER it.
const ROLL_ANCHOR =
`  if (kind.cooldownSecs && rec.pawn && !result.finalState.exhausted) {
    cooldownStarted = startCooldown(rec.pawn, rec.fight, kind.cooldownSecs);
  }`;
const ROLL_INSERT = `

  // ── ROLL-CHART PRIZE: ONLY on a server-verified SKILL WIN. DETERMINISTIC off the SAME server-pinned
  //    seed (un-re-rollable: the nonce is now spent), so the win always lands the identical pool. The
  //    roll only NAMES the numbered LootPool to fire (basis: live balance × per-token bps); the founder-
  //    gated keeper performs the payout. A loss / inconclusive run rolls NOTHING. We pin it on the rec so
  //    a keeper read sees the exact same authoritative result.
  let roll = null, prize = null;
  if (playerWon) {
    roll = rollCharts.resolveRoll(rec.fight, seed, rollHash);
    rec.roll = roll; // pinned to this (consumed) nonce — the keeper fires what THIS says, nothing else
    const fire = roll && Array.isArray(roll.fires) && roll.fires[0] ? roll.fires[0] : null;
    if (fire) prize = { poolId: fire.poolId, poolAddress: fire.pool.address, label: fire.pool.label, deployed: fire.deployed };
  }`;

// ── (3) add roll + prize to the response body ──────────────────────────────────────────────────
// Anchor: the unique `payoutEligible: playerWon,` body line. Insert the new fields AFTER it.
const BODY_ANCHOR = `      payoutEligible: playerWon,`;
const BODY_INSERT = `
      // the roll-chart prize for this win (null on a loss): which numbered LootPool the keeper fires.
      // "win by skill → win a random prize" — server-authoritative + deterministic-per-seed.
      roll,
      prize,`;

// ── (4) live --selftest: assert the WIN carries the prize/roll (keeps ALL PASSED honest) ─────────
// Anchor: the payout-eligible assertion line in the combat-settlement selftest. Insert asserts AFTER it.
const ST_ANCHOR = `    assert(v.body.winner === 'player' && v.body.payoutEligible === true, 'a server-verified player win is payout-eligible (the keeper gate)');`;
const ST_INSERT = `

    // ROLL-CHART: a verified WIN carries a server-authoritative roll + prize naming the numbered pool.
    assert(v.body.roll && typeof v.body.roll.roll === 'number', 'a verified WIN carries a roll-chart result');
    assert(v.body.roll.dice === 'd6' && v.body.roll.roll >= 1 && v.body.roll.roll <= 6, 'bilge-rats rolls a d6 in [1..6]');
    assert(Array.isArray(v.body.roll.fires) && v.body.roll.fires.length === 1, 'bilge-rats single-fires exactly ONE pool (launch: fires=1)');
    assert(v.body.prize && v.body.prize.poolId === 1 && v.body.prize.poolAddress === '0xE07CE9Ec642d42C5c8A0068203068BAc6042bF57',
      'bilge-rats prize = numbered pool 1 = the LIVE Bilge LootPool (verified address)');
    assert(!/spin|jackpot|odds|wager|gamble|\\bbet\\b/i.test(JSON.stringify(v.body.roll)), 'roll framing uses NO gambling language (compliance hard line)');
    // DETERMINISTIC-PER-SEED: rolling the SAME seed yields the IDENTICAL pool (un-re-rollable).
    const _reroll = rollCharts.resolveRoll('bilge-rats', iss.seed, rollHash);
    assert(_reroll.fires[0].poolId === v.body.prize.poolId, 'the roll is DETERMINISTIC per server-pinned seed (same seed → same prize)');`;

// ── ordered edits ───────────────────────────────────────────────────────────────────────────────
const EDITS = [
  { name: '(1) require roll-charts + rollHash', kind: 'after', anchor: REQ_ANCHOR,  text: REQ_INSERT },
  { name: '(2) resolve roll on a win',          kind: 'after', anchor: ROLL_ANCHOR, text: ROLL_INSERT },
  { name: '(3) add roll+prize to response body', kind: 'after', anchor: BODY_ANCHOR, text: BODY_INSERT },
  { name: '(4) selftest prize/roll assertions',  kind: 'after', anchor: ST_ANCHOR,   text: ST_INSERT },
];

// idempotency markers — one per edit; if ALL present, fully patched (no-op).
const MARKERS = [
  "require('./roll-charts.js')",          // (1)
  'roll = rollCharts.resolveRoll(rec.fight, seed, rollHash)', // (2)
  'roll,\n      prize,',                  // (3) (the two added body fields, in order)
  "a verified WIN carries a roll-chart result", // (4)
];
function fullyPatched(s) { return MARKERS.every((m) => s.includes(m)); }
function partiallyPatched(s) { return MARKERS.some((m) => s.includes(m)) && !fullyPatched(s); }

function apply(src) {
  let s = src;
  const changes = [];

  if (fullyPatched(s)) return { s, changes: ['(already fully patched — no changes)'] };
  if (partiallyPatched(s)) {
    const present = MARKERS.filter((m) => s.includes(m));
    throw new Error('PARTIAL roll-chart patch detected — these markers are present but not all:\n  ' +
      present.join('\n  ') + '\nThe live file is in a mixed state; fix by hand, do NOT auto-patch (would duplicate symbols).');
  }

  for (const e of EDITS) {
    if (!s.includes(e.anchor)) {
      throw new Error('ANCHOR NOT FOUND for ' + e.name + ' — the live file drifted from the expected text.\n' +
        'Patch by hand. Expected to find:\n--- BEGIN ANCHOR ---\n' + e.anchor + '\n--- END ANCHOR ---');
    }
    if (s.indexOf(e.anchor) !== s.lastIndexOf(e.anchor)) {
      throw new Error('AMBIGUOUS anchor for ' + e.name + ' — appears more than once; refusing to guess. Patch by hand.');
    }
    s = s.replace(e.anchor, e.anchor + e.text);
    changes.push('+ ' + e.name);
  }

  // post-condition: every marker must now be present
  if (!fullyPatched(s)) {
    const missing = MARKERS.filter((m) => !s.includes(m));
    throw new Error('POST-PATCH CHECK FAILED — these markers are still missing after applying edits:\n  ' + missing.join('\n  '));
  }
  return { s, changes };
}

(function main() {
  if (!fs.existsSync(SERVER)) { console.error('server file not found:', SERVER); process.exit(1); }
  const src = fs.readFileSync(SERVER, 'utf8');
  const { s, changes } = apply(src);

  console.log('patch plan for', SERVER);
  for (const c of changes) console.log('  ', c);

  if (!WRITE) {
    console.log('\nDRY — re-run with --write to apply, then:');
    console.log('  1) scp roll-charts.js → /var/www/tasern/server/roll-charts.js   (REQUIRED — server requires ./roll-charts.js)');
    console.log('  2) node --check ' + SERVER);
    console.log('  3) node ' + SERVER + ' --selftest        (must print "ALL PASSED")');
    console.log('  4) pm2 restart seas-server');
    console.log('  5) curl-verify: a verified WIN now returns { roll, prize:{ poolId, poolAddress, label } }.');
    return;
  }

  if (changes[0] && changes[0].startsWith('(already')) { console.log('\nserver already patched — left as-is'); return; }

  const bak = SERVER + '.pre-rollchart.bak';
  fs.copyFileSync(SERVER, bak);
  fs.writeFileSync(SERVER, s);
  console.log('\npatched', SERVER, '(backup:', bak + ')');
  console.log('NEXT (coordinator): scp roll-charts.js → server dir → node --check → --selftest → pm2 restart → curl-verify.');
})();
