#!/usr/bin/env node
'use strict';
/**
 * citizen-player.js — THIN, OPTIONAL "dumb fallback" loop for the First Citizen.
 *
 * The REAL brain is a headless Claude agent (built separately) that orchestrates the toolbelt in
 * citizen/tools/* to actually PLAY the game (get good, win fights, build trade routes, grow a
 * kingdom). This file is just a no-LLM safety-net: every cycle it scans gaps and prints the single
 * top SAFE gap-closing trade it WOULD make — in DRY mode only. It is rules-subject and broadcasts
 * nothing on its own.
 *
 *   node citizen-player.js              # one cycle, print the plan, exit
 *   node citizen-player.js --loop 60    # repeat every 60s (still DRY)
 *
 * Going live is deliberately NOT automated here: the founder funds the wallet, reviews, and the
 * agent harness (with CITIZEN_ALLOW_LIVE=1) does the trading. This fallback stays paper-only.
 */
const { scanGaps } = require('./gap-scan.js');
const chain = require('./citizen/lib/chain.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

async function cycle() {
  const gaps = await scanGaps();
  const target = gaps.find(g => g.actionable) || null;
  const wallet = chain.walletAddress();
  out({
    ok: true, agent: 'first-citizen-fallback', mode: 'DRY', at: new Date().toISOString(),
    wallet,
    topActionableGap: target ? { id: target.id, sym: target.sym, gapPct: target.gapPct, direction: target.direction, route: target.route } : null,
    decision: target
      ? `would close gap "${target.id}" (${target.direction}, ${target.gapPct?.toFixed(2)}%) with one small paced trade — run: node citizen/tools/trade.js ${target.id}`
      : 'no safe gap to close right now — idle (markets within band, or only the near-zero sell side diverges).',
    note: 'fallback loop is paper-only; the Claude agent harness is the real player.',
  });
}

(async () => {
  const loopIdx = process.argv.indexOf('--loop');
  const everyS = loopIdx >= 0 ? Number(process.argv[loopIdx + 1] || 60) : 0;
  await cycle();
  if (everyS > 0) setInterval(() => { cycle().catch(e => out({ ok: false, error: e.message })); }, everyS * 1000);
})().catch(e => { out({ ok: false, agent: 'first-citizen-fallback', error: e.message }); process.exit(1); });
