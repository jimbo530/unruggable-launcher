#!/usr/bin/env node
'use strict';
/**
 * scan-gaps.js — toolbelt wrapper around the shared gap-scan module. ONE job: print the live,
 * ranked market-gap list as clean JSON, then exit. Read-only (no wallet, no tx).
 *
 *   node citizen/tools/scan-gaps.js                 # all tokens, ranked
 *   node citizen/tools/scan-gaps.js --actionable    # only gaps with a SAFE trade right now
 *   node citizen/tools/scan-gaps.js --top 5         # first N
 */
const { scanGaps, liveCoinUsd } = require('../../gap-scan.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

(async () => {
  const args = process.argv.slice(2);
  const onlyActionable = args.includes('--actionable');
  const topIdx = args.indexOf('--top');
  const top = topIdx >= 0 ? Number(args[topIdx + 1]) : null;

  let gaps = await scanGaps();
  const coinUsd = await liveCoinUsd();
  if (onlyActionable) gaps = gaps.filter(g => g.actionable);
  if (top) gaps = gaps.slice(0, top);

  out({
    ok: true, tool: 'scan-gaps', generatedAt: new Date().toISOString(),
    coinUsd, count: gaps.length,
    actionable: gaps.filter(g => g.actionable).map(g => g.id),
    gaps,
  });
})().catch(e => { out({ ok: false, tool: 'scan-gaps', error: e.message || String(e), hint: 'live market scan failed (RPC / QuoterV2) — retry in a moment; this is read-only and safe to re-run.' }); process.exit(1); });
