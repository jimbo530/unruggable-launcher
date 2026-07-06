#!/usr/bin/env node
'use strict';
/**
 * work.js — the bot's WORK hand. A pawn clocks INTO a named job (fish/log/mill/crab/guard/the 6 town
 * stat-jobs) through WorkClock V2 (the SAME clock the jobs page + clock-crew.cjs + the guard-ladder
 * keeper use). Two modes:
 *
 *   READ (default): show every job in the catalog (LIVE vs PLANNED) + the current job + accrued time
 *                   for each pawn under this wallet's command. Read-only.
 *
 *   CLOCK-IN:       `work <jobId> --pawn <distributor:tokenId> [--mode 1|2]` — clock that pawn into the
 *                   job via WorkClock.setWork (a REAL owner tx). DRY by default; broadcasts only with
 *                   --execute AND CITIZEN_ALLOW_LIVE=1. Also `work clock-out --pawn <...>`.
 *
 * HONESTY / REAL-OR-NOTHING (memory: chain_is_truth):
 *   • A job is LIVE only if a WorkClock JOB target (WaterV2 vault) exists for it (citizen/lib/jobs.js).
 *     FISHING/LOGGING/MILLING/CRABBING are PLANNED — the tokens + economy exist, but NO job vault is
 *     deployed yet, so there's NOTHING to clock into. We REFUSE to clock into a PLANNED job and report
 *     exactly what's missing (a founder-gated vault deploy) — we never fake a clock-in.
 *   • CRABBING is LOCATION-GATED to beach tiles: we read the seas-server's authoritative hex + the
 *     shared map's terrain. If the pawn isn't on a beach we say "not on a beach tile — can't crab"
 *     (we never fake presence). (Moot until the crab job vault exists, but the gate is wired + tested.)
 *
 * The pawn must be owned by THIS wallet (WorkClock is owner-only); chain.setWork verifies that on-chain
 * and refuses otherwise (a clear error, not a revert). Exact-pawn, paced, gated — fits the toolbelt rails.
 *
 *   node citizen/tools/work.js                                   # READ: catalog + my pawns' jobs (DRY)
 *   node citizen/tools/work.js fish --pawn 0x9500…443E:0         # DRY plan: clock a Sol del Mar pawn into FISHING
 *   node citizen/tools/work.js fish --pawn 0x9500…443E:0 --execute   # LIVE (needs CITIZEN_ALLOW_LIVE=1)
 *   node citizen/tools/work.js clock-out --pawn 0x9500…443E:0 --execute
 */
const { ethers } = require('ethers');
const chain = require('../lib/chain.js');
const seas = require('../lib/seas-api.js');
const jobsLib = require('../lib/jobs.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

const ALCHEMY_NFT_BASE = 'https://base-mainnet.g.alchemy.com/nft/v3/R0jSMqs90q_KV85ytn45H';

/** Parse "distributor:tokenId" → { collection, tokenId } (checksummed). Throws on garbage. */
function parsePawn(s) {
  if (typeof s !== 'string') throw new Error('pawn must be "distributor:tokenId"');
  const i = s.lastIndexOf(':');
  if (i < 0) throw new Error(`bad pawn "${s}" — expected "distributor:tokenId"`);
  const collection = ethers.getAddress(s.slice(0, i));
  const tokenId = s.slice(i + 1);
  if (tokenId === '' || !/^\d+$/.test(tokenId)) throw new Error(`bad tokenId in "${s}"`);
  return { collection, tokenId };
}

/** All pawns owned by `owner` across the four ship distributors (the same source pawns.js uses). */
async function ownedPawns(owner) {
  const dists = Object.values(jobsLib.PAWNS);
  const contracts = dists.map((d) => `contractAddresses[]=${d}`).join('&');
  const base = `${ALCHEMY_NFT_BASE}/getNFTsForOwner?owner=${owner}&${contracts}&withMetadata=false&pageSize=100`;
  const list = [];
  let pageKey = null, guard = 0;
  do {
    const res = await fetch(base + (pageKey ? `&pageKey=${encodeURIComponent(pageKey)}` : ''));
    if (!res.ok) throw new Error(`Alchemy getNFTsForOwner HTTP ${res.status} for ${owner}`);
    const data = await res.json();
    for (const n of (data.ownedNfts || [])) list.push({ collection: ethers.getAddress(n.contractAddress), tokenId: String(n.tokenId) });
    pageKey = data.pageKey || null;
  } while (pageKey && ++guard < 25);
  return list;
}

/** Map a WorkClock target address back to a known job id (or null if unknown). */
function jobForTarget(target) {
  if (!target || target === ethers.ZeroAddress) return null;
  const j = jobsLib.JOBS.find((x) => x.target && x.target.toLowerCase() === target.toLowerCase());
  return j ? j.id : null;
}

const fmtDur = (secs) => {
  secs = Number(secs) || 0;
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
};

/** Catalog view: every job + how it's worked (WorkClock clock-in vs a dedicated tool vs planned). */
function catalog() {
  return jobsLib.JOBS.map((j) => {
    const isWorkClock = j.status === 'live' && !!j.target; // a real WorkClock JOB target
    return {
      id: j.id, name: j.name, stat: j.stat, status: j.status,
      target: j.target, produces: j.produces, terrainGate: j.terrainGate,
      via: isWorkClock ? 'work clock-in' : (j.status === 'live' && j.tool ? `tool: ${j.tool}` : 'planned (no mechanic yet)'),
      clockInNow: isWorkClock, // ONLY true for WorkClock clock-in jobs
      note: j.note,
    };
  });
}

(async () => {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const pawnIdx = args.indexOf('--pawn');
  const modeIdx = args.indexOf('--mode');
  const pawnArg = pawnIdx >= 0 ? args[pawnIdx + 1] : null;
  const mode = modeIdx >= 0 ? Number(args[modeIdx + 1]) : 1;
  // first positional non-flag = the verb (jobId | 'clock-out' | 'read'/'list')
  const verb = (args.find((a, i) => !a.startsWith('--') && (pawnIdx < 0 || i !== pawnIdx + 1) && (modeIdx < 0 || i !== modeIdx + 1)) || 'read').toLowerCase();

  const addr = chain.walletAddress();

  // ── READ mode: catalog + my pawns' current jobs ──
  if (verb === 'read' || verb === 'list' || verb === 'jobs') {
    let myPawns = [], readErr = null;
    if (addr) { try { myPawns = await ownedPawns(addr); } catch (e) { readErr = e.message; } }
    const pawnJobs = [];
    for (const p of myPawns) {
      try {
        const w = await chain.readWork(p.collection, p.tokenId);
        pawnJobs.push({
          pawn: `${p.collection}:${p.tokenId}`,
          employed: w.employed,
          job: w.employed ? (jobForTarget(w.target) || `unknown target ${w.target}`) : null,
          target: w.employed ? w.target : null,
          mode: w.employed ? w.mode : null,
          currentRun: w.employed ? fmtDur(w.currentRunSecs) : null,
          currentRunSecs: w.employed ? w.currentRunSecs : 0,
          accumulated: fmtDur(w.accumulatedSecs),
          accumulatedSecs: w.accumulatedSecs,
        });
      } catch (e) { pawnJobs.push({ pawn: `${p.collection}:${p.tokenId}`, error: e.message }); }
    }
    out({
      ok: true, tool: 'work', mode: 'READ', wallet: addr,
      workClock: chain.WORKCLOCK,
      jobs: catalog(),
      myPawns: { count: myPawns.length, error: readErr, jobs: pawnJobs },
      note: 'Read-only. WorkClock clock-in jobs (clockInNow:true): the 6 town stat-jobs + guard — work <jobId> --pawn <distributor:tokenId> [--mode 1|2] [--execute]. FISHING is LIVE but via the `fish` tool (ocean-LP swap, not a clock-in); log/mill/crab are PLANNED (no mechanic wired yet).',
    });
    return;
  }

  // ── CLOCK-OUT ──
  if (verb === 'clock-out' || verb === 'clockout') {
    if (!pawnArg) throw new Error('clock-out needs --pawn <distributor:tokenId>');
    const { collection, tokenId } = parsePawn(pawnArg);
    const before = await chain.readWork(collection, tokenId);
    if (!execute) {
      out({ ok: true, tool: 'work', action: 'clock-out', mode: 'DRY', pawn: pawnArg,
        currentlyEmployed: before.employed, currentJob: before.employed ? jobForTarget(before.target) : null,
        would: before.employed ? `clock pawn out (settles ${fmtDur(before.currentRunSecs)} run into history)` : 'NOTHING — pawn is not employed',
        note: 'DRY — re-run with --execute AND CITIZEN_ALLOW_LIVE=1 to broadcast.' });
      return;
    }
    if (!before.employed) throw new Error(`pawn ${pawnArg} is not employed — nothing to clock out`);
    const hash = await chain.clockOut(collection, tokenId);
    out({ ok: true, tool: 'work', action: 'clock-out', mode: 'LIVE', pawn: pawnArg, tx: hash });
    return;
  }

  // ── CLOCK-IN to a named job ──
  const job = jobsLib.byId(verb);
  if (!job) throw new Error(`unknown job "${verb}" — known: ${jobsLib.JOBS.map((j) => j.id).join(', ')} (or "read" / "clock-out")`);
  if (!pawnArg) throw new Error(`clocking into "${job.id}" needs --pawn <distributor:tokenId>`);
  const { collection, tokenId } = parsePawn(pawnArg);

  // LIVE-but-not-a-WorkClock-job (e.g. fishing = a gated ocean-LP swap, not a clock-in). Redirect to
  // its own tool rather than clocking in — there is no WorkClock target for it.
  if (job.status === 'live' && job.mechanism && job.mechanism !== 'workclock' && job.tool) {
    out({
      ok: true, tool: 'work', action: 'redirect', job: job.id, mechanism: job.mechanism, useTool: job.tool,
      reason: `"${job.name}" is LIVE but is NOT a WorkClock clock-in job — its mechanism is "${job.mechanism}". Use the dedicated tool instead.`,
      run: `node citizen/tools/${job.tool}.js`,
      note: job.note,
    });
    return;
  }

  // PLANNED job → no mechanic wired yet. Refuse honestly + flag what's missing.
  if (job.status !== 'live' || !job.target) {
    out({
      ok: false, tool: 'work', action: 'clock-in', mode: 'BLOCKED', job: job.id, pawn: pawnArg,
      reason: `"${job.name}" is PLANNED, not live: no WorkClock JOB vault (and no other wired mechanic) exists for it yet, so there is nothing to clock into.`,
      missing: 'a deployed WaterV2 job vault (WorkClock target) OR a market mechanic — founder-gated',
      economyThatExists: job.produces ? `${job.produces} token + (some of) its market exist; the JOB MECHANIC is what's missing` : null,
      note: 'Real-or-nothing: refusing to fake a clock-in to a non-existent target. Flag for the founder.',
    });
    process.exit(2);
  }

  // LOCATION GATE (e.g. crabbing requires a beach tile). Read the server-authoritative hex + terrain.
  let locInfo = null;
  if (job.terrainGate) {
    locInfo = await seas.locationWithTerrain(addr);
    if (locInfo.transport === 'unreachable') {
      out({ ok: false, tool: 'work', action: 'clock-in', mode: 'BLOCKED', job: job.id, pawn: pawnArg,
        reason: `"${job.name}" is location-gated to ${job.terrainGate} tiles, but the seas-server is unreachable so I cannot confirm where the pawn is. NOT faking presence.`,
        serverBase: seas.BASE, location: locInfo });
      process.exit(3);
    }
    if (locInfo.atSea) {
      out({ ok: false, tool: 'work', action: 'clock-in', mode: 'BLOCKED', job: job.id, pawn: pawnArg,
        reason: `pawn is at sea (arrives in ~${locInfo.secsLeft}s) — can't ${job.id} until it lands on a ${job.terrainGate} tile.`, location: locInfo });
      process.exit(3);
    }
    if ((locInfo.terrain || '').toLowerCase() !== job.terrainGate) {
      out({ ok: false, tool: 'work', action: 'clock-in', mode: 'BLOCKED', job: job.id, pawn: pawnArg,
        reason: `not on a ${job.terrainGate} tile — can't ${job.id}. Currently at ${locInfo.port || `open water (${locInfo.hex.q},${locInfo.hex.r})`}, terrain "${locInfo.terrain}". Sail to a ${job.terrainGate} hex first (e.g. Bonewater Atoll for beach).`,
        location: locInfo,
        note: 'Real location gate via seas-server hex + shared-map terrain. NOT faking presence.' });
      process.exit(3);
    }
  }

  // Current state (so a DRY plan is informative + we can warn about a lose-on-switch).
  const before = await chain.readWork(collection, tokenId);
  const switching = before.employed && before.target.toLowerCase() !== job.target.toLowerCase();

  if (!execute) {
    out({
      ok: true, tool: 'work', action: 'clock-in', mode: 'DRY', job: job.id, jobName: job.name,
      pawn: pawnArg, target: job.target, ttype: job.ttype, payoutMode: mode,
      terrainGate: job.terrainGate, location: locInfo,
      currentlyEmployed: before.employed, currentJob: before.employed ? jobForTarget(before.target) : null,
      switchWarning: switching ? `pawn is already on "${jobForTarget(before.target) || before.target}" — switching settles its ${fmtDur(before.currentRunSecs)} run into history and STARTS A FRESH run (lose-on-switch).` : null,
      would: before.target.toLowerCase() === job.target.toLowerCase() && before.employed
        ? `already on "${job.id}" — re-clock would only update payout mode (keeps the run)`
        : `clock pawn into "${job.name}" via WorkClock.setWork(${collection}, ${tokenId}, ${job.target}, JOB, mode ${mode})`,
      note: 'DRY — no tx sent. Live needs --execute AND CITIZEN_ALLOW_LIVE=1. WorkClock is owner-only: this wallet must own the pawn (verified on-chain before broadcast).',
    });
    return;
  }

  // LIVE — chain.setWork enforces CITIZEN_ALLOW_LIVE + on-chain ownership; throws loudly otherwise.
  const hash = await chain.setWork(collection, tokenId, job.target, job.ttype, mode);
  const after = await chain.readWork(collection, tokenId);
  out({
    ok: true, tool: 'work', action: 'clock-in', mode: 'LIVE', job: job.id, jobName: job.name,
    pawn: pawnArg, target: job.target, payoutMode: mode, tx: hash,
    verified: { employed: after.employed, onTarget: after.target.toLowerCase() === job.target.toLowerCase(), currentRun: fmtDur(after.currentRunSecs) },
  });
})().catch((e) => { out({ ok: false, tool: 'work', error: e.message || String(e), hint: 'run `node citizen/tools/work.js` (no args) to see the job catalog + your pawns; clock in needs --pawn <distributor:tokenId> from pawns.js myCrewIds.' }); process.exit(1); });
