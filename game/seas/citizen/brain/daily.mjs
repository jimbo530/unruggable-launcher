#!/usr/bin/env node
// @ts-check
/**
 * daily.mjs — the "SHOW UP ONCE A DAY (more if adventuring calls for it)" runner for the Citizen.
 *
 * Founder 2026-06-30: "get the Citizen to show up and check strat and in-game news at least once per
 * day, more if adventuring calls for it." This is the dependable floor — a Windows Scheduled Task fires
 * it daily; each run the brain shows up, reads its charter (STRAT) + the live Port Report (in-game NEWS)
 * + its journal, decides ONE action, and journals it (tick.mjs runTick does all that).
 *
 * THE ADVENTURE RAMP: if the daily tick turns into an ACTIVE adventure (a sail/voyage, a fight it
 * ENGAGES rather than declines, a trade/build/work/fish/convert that actually runs), the runner keeps
 * ticking a few more times THIS run (spaced) so the adventure gets attention the same day. If the tick
 * is idle (wait, or a declined fight), it's just the one daily check-in and we exit. So: quiet days =
 * 1 tick; adventuring days = up to ~5 ticks over ~1.5h.
 *
 * SAFE: DRY by default (no live tx). Pass --live AND set CITIZEN_ALLOW_LIVE=1 to permit --execute
 * (tick.mjs/chain.js still gate every spend). Real-or-nothing: tick failures are logged loudly.
 *
 * RUN
 *   node citizen/brain/daily.mjs            # one daily check-in (+ adventure ramp), DRY
 *   node citizen/brain/daily.mjs --live     # permit --execute (still needs CITIZEN_ALLOW_LIVE=1)
 *   node citizen/brain/daily.mjs --floor-only   # exactly one tick, no ramp (pure daily floor)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runTick } from './tick.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hasFlag = (n) => process.argv.includes(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString();

// ALL players run daily: the resource-rich Citizen + the 4 single-pawn deckhands (brawler/worker/
// fisher/trader). Founder 2026-07-01: "all the regular pawns not in the guard are supposed to be
// running too, to see single-pawn play options and growth strategies inside the rules" + "even with no
// funds they should be able to get started and grow — we built it that way on purpose." So the empty
// deckhands bootstrap from zero by the designed earn path (work/fight/first-day achievement), same
// rules as any free-starting human. Override with CITIZEN_PROFILES=citizen,worker (comma list).
const PROFILES = (process.env.CITIZEN_PROFILES || 'citizen,brawler,worker,fisher,trader')
  .split(',').map((s) => s.trim()).filter(Boolean);
const MAX_EXTRA = Number(process.env.CITIZEN_ADVENTURE_TICKS || 4);       // extra ramp rounds while adventuring
const GAP_MS = (Number(process.env.CITIZEN_ADVENTURE_GAP_SEC || 1200)) * 1000; // 20 min between ramp rounds

// Is this tick an ACTIVE, ONGOING adventure that warrants another look today?
// A bilge FIGHT fully resolves inside one tick (issue->play->verify->done) — it does NOT need a
// follow-up, so it never ramps. The real "adventuring calls for more" signals are: a VOYAGE underway
// (a server-clocked sail that arrives later → check back to act on arrival), or — once live/funded — an
// actually-EXECUTED economic venture (trade/build/work/fish/convert). DRY plans don't ramp.
function isAdventuring(r) {
  if (!r || r.mode !== 'live') return false;
  // v2 ticks may run up to 3 steps; ANY step that starts a voyage or executes a live venture ramps.
  const steps = Array.isArray(r.steps) && r.steps.length ? r.steps : (r.exec ? [r.exec] : []);
  for (const ex of steps) {
    if (!ex || ex.error || ex.ran === false) continue;
    if (ex.tool === 'sail' && ex.status === 0) return true;   // a voyage is underway → look back on arrival
    if (r.allowExecute && ['trade', 'build', 'work', 'fish', 'convert-winnings', 'claim-achievement', 'water-pawn'].includes(ex.tool) && ex.status === 0) {
      return true;                                             // a real (live) venture is in motion
    }
  }
  return false;                                                // wait, fight, and DRY plans = no ramp
}

function summarize(r) {
  if (!r) return 'no result';
  if (r.mode !== 'live') return `mode=${r.mode}`;
  const steps = Array.isArray(r.steps) && r.steps.length ? r.steps : (r.exec ? [r.exec] : []);
  const parts = steps.map((ex) => {
    const out = ex.error ? `ERROR ${ex.error}`
      : ex.ran === false ? 'waited'
        : (ex.result && (ex.result.decision || ex.result.tool)) || `status ${ex.status}`;
    return `${ex.tool || '?'}:${typeof out === 'string' ? out : JSON.stringify(out)}`;
  });
  return parts.join(' → ') || '?';
}

async function tickOne(prof, opts) {
  try {
    const r = await runTick(prof, opts);
    console.log(`[daily ${stamp()}] ${prof}: ${summarize(r)}`);
    return r;
  } catch (e) {
    console.error(`[daily ${stamp()}] ${prof}: TICK FAILED — ${e.message}`);
    return null; // one bot's failure never stops the rest
  }
}

(async () => {
  const opts = { live: hasFlag('--live') };
  const floorOnly = hasFlag('--floor-only');
  console.log(`[daily ${stamp()}] check-in — profiles=[${PROFILES.join(',')}] mode=${opts.live ? 'LIVE-permit' : 'DRY'} ramp=${floorOnly ? 'off' : `≤${MAX_EXTRA}@${GAP_MS / 60000}min`}`);

  // ── FLOOR PASS: every player shows up once (reads strat + in-game news, decides, journals) ──
  const results = {};
  let totalTicks = 0;
  for (const prof of PROFILES) { results[prof] = await tickOne(prof, opts); totalTicks++; }

  // ── ADVENTURE RAMP: re-tick ONLY the players with an ongoing voyage/venture, up to MAX_EXTRA rounds ──
  let round = 0;
  while (!floorOnly && round < MAX_EXTRA) {
    const adv = PROFILES.filter((p) => isAdventuring(results[p]));
    if (!adv.length) break;
    console.log(`[daily ${stamp()}] adventuring: [${adv.join(',')}] — next look in ${GAP_MS / 60000} min (round ${round + 1}/${MAX_EXTRA})`);
    await sleep(GAP_MS);
    for (const prof of adv) { results[prof] = await tickOne(prof, opts); totalTicks++; }
    round++;
  }
  console.log(`[daily ${stamp()}] done — ${totalTicks} tick(s) across ${PROFILES.length} player(s). Journals: citizen/brain/journals/*.md`);
})().catch((e) => { console.error(`[daily] FATAL: ${e.message}`); process.exit(1); });
