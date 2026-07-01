#!/usr/bin/env node
// @ts-check
/**
 * run.mjs — the SLOW-TICK LOOP RUNNER for the bot brains. It wakes on a slow interval and runs ONE
 * tick (tick.mjs runTick) for each selected profile, in sequence (paced — the sea keeps its own time).
 * Each bot reads its charter + journal + live state, the local `claude` CLI picks ONE action, the
 * harness runs it through the existing hands, and the outcome is journaled. No API key (subscription
 * CLI). Default is DRY (no live tx); pass --live (and set CITIZEN_ALLOW_LIVE=1) to permit --execute.
 *
 * RUN
 *   node citizen/brain/run.mjs                                  # all profiles, default 15-min tick, DRY
 *   node citizen/brain/run.mjs --once                           # a single pass over all profiles, then exit
 *   node citizen/brain/run.mjs --profiles brawler,fisher        # only these
 *   node citizen/brain/run.mjs --interval 1800                  # seconds between passes (default 900)
 *   node citizen/brain/run.mjs --plan --once                    # PROVE the wiring (no claude calls)
 *   node citizen/brain/run.mjs --live                           # permit --execute (still needs CITIZEN_ALLOW_LIVE=1)
 *
 * On Windows, run under pm2/nssm or just leave the terminal open. The loop is deliberately slow.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runTick } from './tick.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function flagVal(name, dflt = null) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? true) : dflt; }
function hasFlag(name) { return process.argv.includes(name); }
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const ALL = ['citizen', 'brawler', 'worker', 'fisher', 'trader'];

async function onePass(profiles, opts) {
  for (const p of profiles) {
    const started = new Date().toISOString();
    try {
      const r = await runTick(p, opts);
      const summary = r.mode === 'plan'
        ? `plan ok (prompt ${r.promptChars} chars, ${r.menu.length} tools)`
        : `${r.action ? r.action.tool : '?'} → ${r.exec && (r.exec.error || (r.exec.ran === false ? 'waited' : `status ${r.exec.status}`))}`;
      console.log(`[${started}] ${p}: ${summary}`);
    } catch (e) {
      // No silent catch: a tick failure is logged loudly; the loop continues to the next bot.
      console.error(`[${started}] ${p}: TICK FAILED — ${e.message}`);
    }
    await sleep(2000); // small inter-bot pace (avoid hammering the RPC/server back-to-back)
  }
}

(async () => {
  const profiles = (flagVal('--profiles') && typeof flagVal('--profiles') === 'string')
    ? String(flagVal('--profiles')).split(',').map((s) => s.trim()).filter(Boolean)
    : ALL;
  const intervalSec = Number(flagVal('--interval', 900)) || 900;
  const opts = { plan: hasFlag('--plan'), live: hasFlag('--live'), base: flagVal('--base'), model: flagVal('--model') };
  const once = hasFlag('--once');

  console.log(`[run] profiles=${profiles.join(',')} interval=${intervalSec}s mode=${opts.plan ? 'PLAN' : 'LIVE-BRAIN'} execute=${opts.live ? 'permitted-if-CITIZEN_ALLOW_LIVE=1' : 'DRY'}`);
  do {
    await onePass(profiles, opts);
    if (!once) { console.log(`[run] pass complete — sleeping ${intervalSec}s`); await sleep(intervalSec * 1000); }
  } while (!once);
  console.log('[run] --once complete.');
})().catch((e) => { console.error('[run] FATAL:', e.message); process.exit(1); });
