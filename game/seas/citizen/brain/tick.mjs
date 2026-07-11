#!/usr/bin/env node
// @ts-check
/**
 * tick.mjs — ONE TICK of a Seize-the-Seas bot. The "brain harness" v2: it gives a headless Claude
 * agent (per bot profile) its charter, its layered memory (goals + distilled notes + journal), and a
 * RICH live state (wallet incl. copper/silver, pawns, port report, its trade-good INVENTORY, and its
 * claimable achievements), asks it to plan up to THREE ordered steps toward the climb, runs them
 * through the existing hands (citizen/tools/*), and journals the outcome.
 *
 * WHAT V2 ADDS over the one-action menu-picker:
 *   1. EYES — the bot now SEES its loot goods (inventory.js) and its claimable rungs, and its journal
 *      line shows copper/silver. v1 read eth/usdc/gold only, so a peasant with a hold full of salt
 *      and rations thought it was broke.
 *   2. THE CLIMB — the prompt carries the game's progression ladder (peasant → goods → gold → gear →
 *      more earners → builder → kingdom) as world knowledge, so every decision aims at the next rung.
 *   3. PLANS, NOT PICKS — the model may return up to 3 ordered steps per tick (e.g. inventory →
 *      quote → sell), executed sequentially, each result journaled. Legacy single {tool,...} replies
 *      still work.
 *   4. LAYERED MEMORY — goals/<profile>.md (its own current focus, brain-editable via "goal"),
 *      notes/<profile>.md (durable deduped lessons via "note"), journal (raw log, as before).
 *   5. RUT DETECTION — if the last ticks repeated the same move with an unchanged purse, the harness
 *      says so in the prompt and asks for a different rung or a flaw report.
 *   6. QA TEETH — a "flaw" field appends to FLAWS.md (deduped): the bots are the game's first
 *      players AND its testers; what blocks them becomes the build backlog.
 *
 * HOSTING — unchanged: the LOCAL `claude` CLI (subscription auth), headless print mode, no API key.
 * SAFETY — unchanged: every tool gates its own live tx; the harness never passes --execute unless
 * --live AND CITIZEN_ALLOW_LIVE=1; real-or-nothing journaling; small + paced caps live in the tools.
 *
 * RUN
 *   node citizen/brain/tick.mjs <profile> [--plan] [--live] [--base <seas-api-url>] [--model <id>]
 *     <profile>   citizen | brawler | worker | fisher | trader
 *     --plan      assemble + PRINT the prompt/state and EXIT (no claude call)
 *     --live      permit --execute on spending tools (still needs CITIZEN_ALLOW_LIVE=1); default DRY
 *   The daily runner is daily.mjs; the burst loop is run.mjs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { locationLabel } from '../../../lib/location.js'; // shared map: friendly "open water (q,r) [loc]" / port names

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = __dirname;                                   // game/seas/citizen/brain
const SEAS_DIR = path.join(__dirname, '..', '..');             // game/seas (the toolbelt cwd)
const JOURNAL_DIR = path.join(BRAIN_DIR, 'journals');
const GOALS_DIR = path.join(BRAIN_DIR, 'goals');
const NOTES_DIR = path.join(BRAIN_DIR, 'notes');
const CACHE_DIR = path.join(BRAIN_DIR, 'cache');
const FLAWS_PATH = path.join(BRAIN_DIR, 'FLAWS.md');
const DEFAULT_BASE = process.env.SEAS_API_BASE || 'https://tasern.quest/seas-api';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MAX_STEPS = 3;
const CLAIMABLE_TTL_MS = 6 * 60 * 60 * 1000; // claim eligibility moves on 24h+ rungs — 6h cache is honest

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function flagVal(name, dflt = null) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? true) : dflt; }
function hasFlag(name) { return process.argv.includes(name); }

// ── THE CLIMB — the game's progression ladder, as world knowledge (inform, never command) ─────────
const LADDER = `
COPPER is the base coin — 100 COPPER = 1 GOLD. Loot GOODS (salt, rations, hides, meats, fish, gems)
are real tradeable wealth: winning ANY coin or goods is real progress. This is a long, slow grind by
design — a peasant's climb, not a day-one castle. The proven rungs:
  0. PEASANT — win the fights you can clearly win (loot pays copper + goods when the payout rail is
     on); crab/fish for free coin once the catch is wired. Keep every good you win.
  1. GOODS TRADER — know your hold (inventory), sell dear at the right port, let copper stack toward
     silver and gold.
  2. FIRST GOLD — attested achievement rungs pay 1% of a LIVE prize pool: the richest single moves in
     the game. Claim what the house has attested; convert winnings when they land.
  3. GEAR + LEVELS — water a pawn ($1 = 1 level) and gear up, so harder fights (bigger loot tiers)
     become clearly winnable.
  4. MORE EARNERS — put more pawns on jobs and day-1 achievements; every new pawn starts this same
     climb from its own rung 0.
  5. BUILDER — spend gold on structures (mill/farm) that produce goods forever; craft or buy a boat;
     run goods between ports where they're scarce.
  6. KINGDOM — titles, settlements, fleets, crews. The long game. Earned, never given.
Climbing rules: never skip income that is free; front-load fat prize pools (payouts shrink as pools
drain); if a rung is BLOCKED by a missing rail or a broken flow, file a flaw and work another rung —
do not grind the same blocked move tick after tick.`;

// ── THE ACTION MENU (the toolbelt, as the model sees it) ───────────────────────────────────────
const MENU = [
  { tool: 'wait', desc: 'Take no action this tick (the patient move — wait for an arrival, an attest, or a better market).', args: {}, build: () => null },
  { tool: 'wallet', desc: 'Read my wallet: ETH/USDC/Money + copper/silver/gold coin balances.', args: {}, build: () => ['citizen/tools/wallet.js'] },
  { tool: 'inventory', desc: 'Read my HOLD: every trade-good ERC20 I own (salt, rations, hides, meats, gems…). Goods are wealth. Read-only, cached ~15min (fresh:true to force).', args: { fresh: 'bool (optional)' }, build: (a) => ['citizen/tools/inventory.js', ...(a.fresh ? ['--fresh'] : [])] },
  { tool: 'pawns', desc: 'Read the pawns under my command (read-only command picture).', args: {}, build: (_a, ctx) => ['citizen/tools/pawns.js', ctx.selfAddr].filter(Boolean) },
  { tool: 'scan-gaps', desc: 'List the live, ranked market gaps (the Port Report). Read-only.', args: { top: 'int (optional, default 5)' }, build: (a) => ['citizen/tools/scan-gaps.js', '--top', String(a.top || 5)] },
  { tool: 'quote', desc: 'Quote ONE route, read-only. What would I get for X of tokenIn→tokenOut?', args: { tokenIn: 'symbol/0x', tokenOut: 'symbol/0x', amount: 'human number', fee: 'int (optional)' }, build: (a) => { if (!a.tokenIn || !a.tokenOut || a.amount == null) throw new Error('quote needs tokenIn, tokenOut, amount'); return ['citizen/tools/quote.js', String(a.tokenIn), String(a.tokenOut), String(a.amount), ...(a.fee ? [String(a.fee)] : [])]; } },
  { tool: 'fight', desc: 'Run the bilge-rats fight (issue-seed → play headlessly → server-verify → would-claim). Skill-based; auto-declines a fight it would lose. Loot pays only while the payout keeper is on.', args: { pawn: 'distributor:tokenId (optional)', endowment: 'json (optional)' }, build: (a) => ['citizen/tools/fight.js', 'play', ...(a.pawn ? ['--pawn', String(a.pawn)] : []), ...(a.endowment ? ['--endowment', typeof a.endowment === 'string' ? a.endowment : JSON.stringify(a.endowment)] : [])] },
  { tool: 'claim-achievement', desc: 'Achievement rungs (the richest pay). No args = READ which of my pawns\' rungs are EARNED + ATTESTED + unclaimed and what GOLD they pay now. With pawns + execute:true = CLAIM those rungs (paced, capped, needs live).', args: { pawns: 'comma tokenIds e.g. "0,1,2" (required to claim)', execute: 'bool (true to claim; needs live)', max: 'int (optional, default 2 per tick)' }, build: (a, ctx) => { const argv = ['citizen/tools/claim-achievement.js']; if (a.pawns) argv.push('--pawns', String(a.pawns)); if (a.execute && ctx.allowExecute) { if (!a.pawns) throw new Error('claiming needs an explicit pawns list'); argv.push('--execute', '--max', String(a.max || 2)); } return argv; } },
  { tool: 'water-pawn', desc: 'Level a pawn: $1 USDC = 1 level (locked endowment, irreversible — water deliberately). No execute = READ level + cost. target "level" = class level, "flow" = job-wage flow.', args: { pawn: 'guard tokenId (required)', levels: 'int (optional, default 1)', target: 'level|flow (optional)', execute: 'bool (needs live + USDC)' }, build: (a, ctx) => { if (a.pawn == null) throw new Error('water-pawn needs a pawn tokenId'); return ['citizen/tools/water-pawn.js', '--pawn', String(a.pawn), ...(a.levels ? ['--levels', String(a.levels)] : []), ...(a.target ? ['--target', String(a.target)] : []), ...(a.execute && ctx.allowExecute ? ['--execute'] : [])]; } },
  { tool: 'sail', desc: 'Begin a server-clocked voyage to hex (q,r). Travel takes real time; rules-subject.', args: { q: 'int', r: 'int' }, build: (a) => { if (a.q == null || a.r == null) throw new Error('sail needs q and r'); return ['citizen/tools/sail.js', String(a.q), String(a.r)]; } },
  { tool: 'trade', desc: 'Plan (DRY) or execute one small gap-closing buy by gapId. DRY unless the harness is --live + CITIZEN_ALLOW_LIVE=1.', args: { gapId: 'string (from scan-gaps)', usd: 'number (optional, ≤0.25)' }, build: (a, ctx) => { if (!a.gapId) throw new Error('trade needs a gapId'); return ['citizen/tools/trade.js', String(a.gapId), ...(a.usd != null ? [String(a.usd)] : []), ...(ctx.allowExecute ? ['--execute'] : [])]; } },
  { tool: 'convert-winnings', desc: 'Income→build: convert Guard cbBTC winnings → GOLD (threshold-batched). DRY unless --live + CITIZEN_ALLOW_LIVE=1.', args: { usd: 'number (optional)' }, build: (a, ctx) => ['citizen/tools/convert-winnings.js', ...(a.usd != null ? ['--usd', String(a.usd)] : []), ...(ctx.allowExecute ? ['--execute'] : [])] },
  { tool: 'work', desc: 'Put a pawn to WORK a job (steady wage path). With no jobId: READ the job catalog + my pawns\' current jobs + accrued time. With a jobId + pawn: clock that pawn in (haul/mend/stock/beacon/rites/barter/guard are LIVE; fish/log/mill/crab are PLANNED → it will say so honestly). DRY unless --live + CITIZEN_ALLOW_LIVE=1.', args: { jobId: 'string (optional; omit to READ)', pawn: 'distributor:tokenId (required to clock in)', mode: 'int 1|2 (optional, default 1)' }, build: (a, ctx) => { if (!a.jobId) return ['citizen/tools/work.js', 'read']; if (!a.pawn) throw new Error('work clock-in needs a pawn (distributor:tokenId)'); return ['citizen/tools/work.js', String(a.jobId), '--pawn', String(a.pawn), ...(a.mode ? ['--mode', String(a.mode)] : []), ...(ctx.allowExecute ? ['--execute'] : [])]; } },
  { tool: 'build', desc: 'BUILD a structure (mill/farm): pay GOLD → a structure that produces goods + re-locks your gold as a growing endowment. No kind = LIST buildable. With kind = PLAN + price it. Never fakes a structure.', args: { kind: 'string mill|farm (optional; omit to LIST)', site: 'string (optional site id)', gold: 'number (optional gold to lock)' }, build: (a, ctx) => { if (!a.kind) return ['citizen/tools/build.js', 'list']; return ['citizen/tools/build.js', 'plan', String(a.kind), ...(a.site ? ['--site', String(a.site)] : []), ...(a.gold != null ? ['--gold', String(a.gold)] : []), ...(ctx.allowExecute ? ['--execute'] : [])]; } },
  { tool: 'fish', desc: 'FISH/CRAB for a living. "loop" = read supply+skill+projected catch+sell value; "catch"/"crab" = skill-gated harvest (dispenser not fully wired — it says so honestly); "sell" = sell caught fish at Port Royal (live-capable). Location-gated (sail first).', args: { action: 'string loop|catch|crab|sell (optional, default loop)', usd: 'number (optional 0.10-0.25, sell only)' }, build: (a, ctx) => { const act = (a.action || 'loop'); return ['citizen/tools/fish.js', String(act), ...(a.usd != null ? ['--usd', String(a.usd)] : []), ...(ctx.allowExecute && act === 'sell' ? ['--execute'] : [])]; } },
];
const MENU_BY_TOOL = Object.fromEntries(MENU.map((m) => [m.tool, m]));

// ── run a toolbelt command as a child (profile wallet env injected) → parsed JSON or raw text ────
function runTool(argv, env, timeoutMs = 120000) {
  const r = spawnSync('node', argv, { cwd: SEAS_DIR, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw new Error(`tool spawn failed (${argv.join(' ')}): ${r.error.message}`);
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  let json = null;
  try { json = JSON.parse(stdout); } catch { /* not JSON — keep raw */ }
  // A tool killed by the timeout (SIGTERM) exits with a null status + a signal — that is a REAL failure
  // and must never look like a clean run. Synthesize a loud error result so the outcome line surfaces it.
  if (r.status === null && r.signal) {
    return { status: 124, json: { error: `tool KILLED by signal ${r.signal} after ${timeoutMs}ms (timeout) — ${argv.join(' ')}`, stderr: stderr.slice(0, 1500) }, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 1500) };
  }
  // Nonzero exit with NO parseable stdout: fold stderr into a synthetic error JSON so the failure is
  // never reduced to a bare status. (Tools that print their own {error} JSON are already covered.)
  if (r.status !== 0 && !json) {
    return { status: r.status, json: { error: (stderr.trim() || stdout.trim() || `exited ${r.status} with no output`).slice(0, 1200) }, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 1500) };
  }
  return { status: r.status, json, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 1500) };
}

// ── extract the model's reply: {steps:[...]} (v2) or legacy {tool,...} (v1) ─────────────────────
function extractReply(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty model reply');
  const tryParse = (s) => { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch { return null; } };
  const valid = (o) => o && (Array.isArray(o.steps) ? o.steps.length && o.steps.every((s) => s && s.tool) : !!o.tool);
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { const o = tryParse(fence[1].trim()); if (valid(o)) return o; }
  const whole = tryParse(text.trim()); if (valid(whole)) return whole;
  const cands = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') { depth--; if (depth === 0) { cands.push(text.slice(i, j + 1)); break; } }
    }
  }
  for (let k = cands.length - 1; k >= 0; k--) { const o = tryParse(cands[k]); if (valid(o)) return o; }
  throw new Error(`could not parse a plan/action JSON from the model reply: ${text.slice(0, 200)}`);
}

// normalize a reply into { steps[≤3], reasoning, lesson, note, goal, flaw }
function normalizeReply(o) {
  const steps = Array.isArray(o.steps)
    ? o.steps.slice(0, MAX_STEPS).map((s) => ({ tool: s.tool, args: (s.args && typeof s.args === 'object') ? s.args : {} }))
    : [{ tool: o.tool, args: (o.args && typeof o.args === 'object') ? o.args : {} }];
  return {
    steps,
    reasoning: typeof o.reasoning === 'string' ? o.reasoning : '',
    lesson: typeof o.lesson === 'string' ? o.lesson : '',
    note: typeof o.note === 'string' ? o.note.trim() : '',
    goal: typeof o.goal === 'string' ? o.goal.trim() : '',
    flaw: typeof o.flaw === 'string' ? o.flaw.trim() : '',
  };
}

// ── drive the LOCAL claude CLI (subscription auth; no API key) ────────────────────────────────────
function askClaude(promptText, model) {
  const args = ['-p', '--output-format', 'json'];
  if (model) args.push('--model', String(model));
  const r = spawnSync(CLAUDE_BIN, args, { input: promptText, encoding: 'utf8', shell: true, timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`claude CLI spawn failed (${CLAUDE_BIN}): ${r.error.message}`);
  if (r.status !== 0) throw new Error(`claude CLI exited ${r.status}: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  let envelope; try { envelope = JSON.parse(r.stdout); } catch { envelope = null; }
  const replyText = envelope && typeof envelope.result === 'string' ? envelope.result : r.stdout;
  if (envelope && envelope.is_error) throw new Error(`claude reported an error: ${replyText.slice(0, 300)}`);
  return { reply: normalizeReply(extractReply(replyText)), raw: replyText.slice(0, 1200) };
}

// ── layered memory: journal (raw log) + notes (distilled) + goals (current focus) + FLAWS (QA) ────
function journalPath(profileId) { return path.join(JOURNAL_DIR, `${profileId}.md`); }
function readJournalTail(profileId, maxChars = 4500) {
  const p = journalPath(profileId);
  if (!fs.existsSync(p)) return '';
  const all = fs.readFileSync(p, 'utf8');
  return all.length > maxChars ? all.slice(all.length - maxChars) : all;
}
function appendJournal(profileId, entry) {
  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  const p = journalPath(profileId);
  if (!fs.existsSync(p)) fs.writeFileSync(p, `# Journal — ${profileId}\n\n_The continuous memory of this bot. Each tick appends one entry._\n`);
  fs.appendFileSync(p, entry);
}

function notesPath(profileId) { return path.join(NOTES_DIR, `${profileId}.md`); }
function readNotes(profileId) {
  // Shared DESIGN TRUTH (income rails) is prepended for EVERY profile — the canonical model of how
  // rung-0 income works (FIGHT from zero; harvest needs flow; wages are slow-drip). This stops the
  // bots re-filing misfilings (crab-dispenser) and grinding blocked rails.
  const sharedPath = path.join(NOTES_DIR, 'DESIGN-TRUTH-income-rails.md');
  const shared = fs.existsSync(sharedPath) ? fs.readFileSync(sharedPath, 'utf8') : '';
  const p = notesPath(profileId);
  const own = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  return [shared, own].filter(Boolean).join('\n\n');
}
function addNote(profileId, note) {
  if (!note) return false;
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const p = notesPath(profileId);
  const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : `# Notes — ${profileId}\n\n_Durable lessons this bot chose to keep. Deduped; newest last._\n`;
  if (existing.includes(note)) return false; // dedupe: don't re-learn the same lesson
  let next = existing + `- ${note}\n`;
  const lines = next.split('\n');
  if (lines.length > 110) next = lines.slice(0, 4).join('\n') + '\n' + lines.slice(-90).join('\n'); // cap: keep header + newest
  fs.writeFileSync(p, next);
  return true;
}

function goalsPath(profileId) { return path.join(GOALS_DIR, `${profileId}.md`); }
function readGoals(profileId) {
  const p = goalsPath(profileId);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
function setGoalNow(profileId, goalText) {
  if (!goalText) return false;
  const p = goalsPath(profileId);
  if (!fs.existsSync(p)) return false; // goals files are seeded; don't invent one silently
  const cur = fs.readFileSync(p, 'utf8');
  const updated = cur.replace(/(## Now\n)([\s\S]*?)(?=\n## |$)/, `$1${goalText.trim()}\n`);
  if (updated === cur) return false;
  fs.writeFileSync(p, updated);
  return true;
}

function addFlaw(profileId, flaw) {
  if (!flaw) return false;
  const title = flaw.split(':')[0].trim().toLowerCase();
  const existing = fs.existsSync(FLAWS_PATH) ? fs.readFileSync(FLAWS_PATH, 'utf8') : `# FLAWS — what the bot players hit\n\n_The bots are the game's first players AND its QA. Every entry here is a real block or rough edge\nthey met inside the rules. This file is the build backlog's front door._\n\n`;
  if (title && existing.toLowerCase().includes(title)) return false; // dedupe on title
  fs.writeFileSync(FLAWS_PATH, existing + `- **${new Date().toISOString().slice(0, 10)}** [${profileId}] ${flaw}\n`);
  return true;
}

// ── rut detection: same first-move + unchanged purse across the last 3 journal entries ───────────
function detectRut(profileId) {
  const tail = readJournalTail(profileId, 12000);
  const entries = tail.split(/\n## /).slice(-4); // last few entries (first split chunk may be partial)
  const states = [], moves = [];
  for (const e of entries) {
    const s = e.match(/- \*\*state\*\*: ([^\n]+)/); if (s) states.push(s[1].trim());
    const d = e.match(/- \*\*(?:decision|steps)\*\*: ([a-z-]+)/); if (d) moves.push(d[1].trim());
  }
  if (states.length < 3 || moves.length < 3) return null;
  const s3 = states.slice(-3), m3 = moves.slice(-3);
  if (s3.every((x) => x === s3[0]) && m3.every((x) => x === m3[0])) {
    return `You have led with "${m3[0]}" for ${m3.length}+ straight ticks and your purse has NOT changed. The grind is slow by design — but repeating a move that banks nothing is not the grind, it's a rut. This tick, either work a DIFFERENT rung of the climb (check your inventory/claimables/jobs — is anything sellable, claimable, or clock-in-able?), or file a "flaw" naming exactly what rail is blocking you.`;
  }
  return null;
}

// ── claimable-achievements read. Cached (6h TTL) for the tick's LIVE STATE (rungs move on day+
//    timescales, so a cache is honest for PLANNING). But a CLAIM must source its ids from CHAIN TRUTH
//    at the moment of claiming — pass fresh:true to bypass the cache (see the claim step below). A
//    stale window (drained pool, advanced start id) is exactly why claims were bouncing "nothing
//    claimable": the READ lied, the claim path re-read chain and rejected the ghost ids. ──────────────
function readClaimableCached(profileId, childEnv, opts = {}) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `claimable-${profileId}.json`);
  if (!opts.fresh && fs.existsSync(cachePath) && Date.now() - fs.statSync(cachePath).mtimeMs < CLAIMABLE_TTL_MS) {
    try { return { ...readJSON(cachePath), cached: true }; } catch { /* fall through to fresh read */ }
  }
  const r = runTool(['citizen/tools/claim-achievement.js'], childEnv, 180000);
  if (r.status !== 0 || !r.json) {
    // FAIL LOUDLY: a failed claimable read is real information, never a silent empty.
    return { error: `claimable read failed (exit ${r.status})`, detail: (r.json && r.json.error) || r.stderr || r.stdout, cached: false };
  }
  const condensed = JSON.parse(JSON.stringify(r.json, (k, v) => (Array.isArray(v) && v.length > 12 ? v.slice(0, 12).concat([`…and ${v.length - 12} more`]) : v)));
  try { fs.writeFileSync(cachePath, JSON.stringify(condensed)); } catch { /* cache write is best-effort */ }
  return { ...condensed, cached: false };
}

// ── build the tick prompt ───────────────────────────────────────────────────────────────────────
function buildPrompt({ profile, charterText, focusText, goalsText, notesText, journalTail, state, allowExecute, rutNotice }) {
  const menuLines = MENU.map((m) => {
    const argStr = Object.keys(m.args).length ? ` args: { ${Object.entries(m.args).map(([k, v]) => `${k}: ${v}`).join(', ')} }` : ' args: {}';
    return `- "${m.tool}" — ${m.desc}${argStr}`;
  }).join('\n');
  return [
    `You are playing Seize the Seas as the bot profile "${profile.name}" (${profile.keyName}). You are ONE continuous character with a journal across ticks — not a fresh mind. Play to your charter's goals.`,
    ``,
    `=== YOUR CHARTER (the rules you live by) ===`,
    charterText.trim(),
    focusText ? `\n=== YOUR PATH FOCUS ===\n${focusText.trim()}` : ``,
    ``,
    `=== THE CLIMB (world knowledge — how a peasant becomes a kingdom) ===`,
    LADDER.trim(),
    ``,
    goalsText ? `=== YOUR GOALS (your own words — update via "goal" when your focus changes) ===\n${goalsText.trim()}\n` : ``,
    notesText ? `=== YOUR NOTES (durable lessons you chose to keep) ===\n${notesText.trim()}\n` : ``,
    `=== YOUR JOURNAL (recent raw memory) ===`,
    journalTail.trim() || '(empty — this is an early tick)',
    ``,
    `=== LIVE STATE THIS TICK ===`,
    JSON.stringify(state, null, 2),
    ``,
    rutNotice ? `=== RUT NOTICE (from the harness — take it seriously) ===\n${rutNotice}\n` : ``,
    `=== ACTION MENU ===`,
    menuLines,
    ``,
    `Live execution is ${allowExecute ? 'ENABLED' : 'DISABLED (DRY)'} this tick. Honor your hard limits: small + paced, real-or-nothing, only fight when clearly favored, never risk the base / your last pawn / your last gas.`,
    ``,
    `Plan this tick as up to ${MAX_STEPS} ORDERED steps toward your next rung (1 step is fine; "wait" is fine). Read-then-act beats act-blind: e.g. inventory → quote → sell, or claim-read → claim. Do not re-run a read whose answer is already in this tick's LIVE STATE.`,
    `Reply with ONLY a JSON object, no prose, in exactly this shape:`,
    `{"steps":[{"tool":"<menu tool>","args":{...}}],`,
    ` "reasoning":"<1-2 sentences: why these steps advance the climb>",`,
    ` "lesson":"<one NEW lesson not already in your notes, or empty>",`,
    ` "note":"<optional: one durable fact worth keeping for weeks — omit if none>",`,
    ` "goal":"<optional: replace your current '## Now' focus (1-3 lines) — omit if unchanged>",`,
    ` "flaw":"<optional: a game flaw you hit — 'short title: what blocked you and where' — omit if none>"}`,
  ].join('\n');
}

// ── one tick ───────────────────────────────────────────────────────────────────────────────────────
export async function runTick(profileId, opts = {}) {
  const plan = !!opts.plan;
  const live = !!opts.live;
  const base = opts.base || DEFAULT_BASE;
  const model = opts.model || null;
  const allowExecute = live && process.env.CITIZEN_ALLOW_LIVE === '1';

  const reg = readJSON(path.join(BRAIN_DIR, 'profiles.json'));
  const profile = reg.profiles[profileId];
  if (!profile) throw new Error(`unknown profile "${profileId}" — known: ${Object.keys(reg.profiles).join(', ')}`);

  // charter + (deckhand) path focus
  const charterText = fs.readFileSync(path.join(BRAIN_DIR, profile.charter), 'utf8');
  let focusText = '';
  if (profile.pathId) {
    const paths = readJSON(path.join(BRAIN_DIR, 'deckhand-paths.json'));
    const pth = (paths.paths || []).find((p) => p.id === profile.pathId);
    if (!pth) throw new Error(`deckhand path "${profile.pathId}" not found in deckhand-paths.json`);
    focusText = `${pth.name} — starting pawn: ${pth.startingPawn}\n${pth.focus}`;
  }

  // profile wallet env for every child tool (chain.js reads CITIZEN_WALLET_ENV + CITIZEN_KEY_NAME)
  const childEnv = {
    ...process.env,
    CITIZEN_WALLET_ENV: path.join(SEAS_DIR, profile.walletEnv),
    CITIZEN_KEY_NAME: profile.keyName,
    SEAS_API_BASE: base,
  };

  // ── gather live state through the existing hands (read-only; each read fails soft) ──
  const state = { profile: profileId, serverBase: base, at: new Date().toISOString() };
  const wal = runTool(['citizen/tools/wallet.js'], childEnv);
  state.wallet = wal.json || { error: 'wallet read failed', stderr: wal.stderr };
  const selfAddr = (wal.json && wal.json.address) || null;
  const pwn = runTool(['citizen/tools/pawns.js', ...(selfAddr ? [selfAddr] : [])], childEnv);
  state.pawns = pwn.json ? {
    total: pwn.json.totalPawnsUnderCommand,
    // the ids I can actually clock in / feed — the wage rail's starting point (was hidden before)
    myCrewIds: (pwn.json.myCrewIds || []).slice(0, 12),
    myPawnCount: (pwn.json.myCrewIds || []).length,
    // location as a READABLE label (open-water hexes read "open water (q,r) [loc]", not null — the compass bug)
    command: (pwn.json.command || []).map((c) => ({ wallet: c.wallet, pawnCount: c.pawnCount, byShip: c.byShip, location: (c.location && c.location.hex) ? locationLabel(c.location) : ((c.location && c.location.note) || null) })),
  } : { error: 'pawns read failed', stderr: pwn.stderr };
  const gaps = runTool(['citizen/tools/scan-gaps.js', '--top', '5'], childEnv);
  state.portReport = gaps.json ? { coinUsd: gaps.json.coinUsd, actionable: gaps.json.actionable, top: (gaps.json.gaps || []).slice(0, 5).map((g) => ({ id: g.id, actionable: g.actionable })) } : { error: 'scan-gaps failed', stderr: gaps.stderr };
  const inv = runTool(['citizen/tools/inventory.js'], childEnv, 150000);
  state.hold = inv.json ? { held: inv.json.held, cached: !!inv.json.cached } : { error: 'inventory read failed', stderr: inv.stderr };
  // MY PAWNS' JOB STATE — the work catalog read already resolves each owned pawn's clock-in id
  // (distributor:tokenId), current job, and accrued time. Fold it into LIVE STATE so the brain can
  // (a) construct the --pawn arg clock-in requires, and (b) VERIFY a clock-in landed — without
  // spending a whole tick on a duplicate read. This is the "my pawns" section the FLAWS asked for.
  const wk = runTool(['citizen/tools/work.js', 'read'], childEnv, 150000);
  state.myPawnJobs = wk.json && wk.json.myPawns
    ? { count: wk.json.myPawns.count, error: wk.json.myPawns.error,
        pawns: (wk.json.myPawns.jobs || []).map((j) => ({ pawn: j.pawn, employed: j.employed, job: j.job, currentRun: j.currentRun, accumulated: j.accumulated })),
        note: 'clock any pawn in with work { jobId, pawn: "<pawn from here>" }; employed/job/accumulated show whether a clock-in already landed.' }
    : { error: `work read failed (exit ${wk.status})`, detail: (wk.json && wk.json.error) || wk.stderr };
  try { state.claimable = readClaimableCached(profileId, childEnv); }
  catch (e) { state.claimable = { error: `claimable read failed: ${e.message}` }; }

  const goalsText = readGoals(profileId);
  const notesText = readNotes(profileId);
  const journalTail = readJournalTail(profileId);
  const rutNotice = detectRut(profileId);
  const prompt = buildPrompt({ profile, charterText, focusText, goalsText, notesText, journalTail, state, allowExecute, rutNotice });

  // ── --plan: prove the wiring WITHOUT calling claude ──
  if (plan) {
    return { ok: true, profile: profileId, mode: 'plan', selfAddr, allowExecute, rut: !!rutNotice, state, menu: MENU.map((m) => m.tool), promptChars: prompt.length, prompt };
  }

  // ── ask the brain for a plan of up to MAX_STEPS steps ──
  const { reply, raw } = askClaude(prompt, model);

  // ── execute the steps in order (stop on the first hard error) ──
  const stepResults = [];
  for (const step of reply.steps) {
    const menuItem = MENU_BY_TOOL[step.tool];
    if (!menuItem) { stepResults.push({ tool: step.tool, error: `unknown tool "${step.tool}"` }); break; }
    let argv = null, exec = null;
    try { argv = menuItem.build(step.args, { selfAddr, allowExecute }); }
    catch (e) { exec = { tool: step.tool, error: `bad args: ${e.message}` }; }
    // FRESH-CLAIM GUARD (fix: caches lie about claim windows). A claim EXECUTE must source its ids from
    // CHAIN TRUTH at the instant of claiming — not from the tick's 6h-cached LIVE STATE. Before firing,
    // re-READ claimable FRESH (bypass cache) and narrow the brain's --pawns to only the ids that are
    // still genuinely claimable right now. If none survive, we DON'T send a doomed tx — we report the
    // fresh window loudly so the next tick claims the real ids.
    if (!exec && argv && step.tool === 'claim-achievement' && step.args && step.args.execute && allowExecute) {
      const fresh = readClaimableCached(profileId, childEnv, { fresh: true });
      const freshIds = new Set((fresh.claimableNow || []).map((c) => Number(c.tokenId)).filter((n) => Number.isInteger(n)));
      const wanted = String(step.args.pawns).split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
      const confirmed = wanted.filter((id) => freshIds.has(id));
      if (!confirmed.length) {
        exec = { tool: step.tool, ran: false, note: 'claim skipped — FRESH read shows none of the requested pawns are claimable now',
          result: { error: `stale claim: requested pawns [${wanted.join(',')}] are NOT in the FRESH claimable set [${[...freshIds].join(',') || 'empty'}] — the cached window had drifted (pool drained / start id advanced). Not sending a doomed claim.`,
            freshClaimableNow: (fresh.claimableNow || []).slice(0, 12), blockedOnHouseAttest: (fresh.blockedOnHouseAttest || []).slice(0, 6), cached: false } };
      } else {
        // rewrite --pawns to the freshly-confirmed subset (rebuild argv so the value is honest)
        argv = menuItem.build({ ...step.args, pawns: confirmed.join(',') }, { selfAddr, allowExecute });
      }
    }
    if (!exec) {
      if (argv === null) exec = { tool: step.tool, ran: false, note: 'no-op (wait)' };
      else { const r = runTool(argv, childEnv, 180000); exec = { tool: step.tool, ran: true, argv, status: r.status, result: r.json || { raw: r.stdout, stderr: r.stderr } }; }
    }
    stepResults.push(exec);
    if (exec.error || (exec.ran && exec.status !== 0)) break; // don't chain onto a failure
  }

  // ── memory writes the brain asked for ──
  const memory = {
    noted: addNote(profileId, reply.note),
    goalUpdated: setGoalNow(profileId, reply.goal),
    flawFiled: addFlaw(profileId, reply.flaw),
  };

  // ── journal the tick (state + plan + each outcome + lesson) ──
  const w = state.wallet.balances || {};
  const stepLine = reply.steps.map((s) => s.tool).join(' → ');
  const outcomeLines = stepResults.map((ex, i) => {
    const failed = !!ex.error || (ex.ran && ex.status !== 0);
    const ok = ex.error ? 'ERROR' : (ex.ran === false ? 'waited' : (ex.status === 0 ? 'ok' : `exit ${ex.status}`));
    // FAIL LOUDLY: a failed step's summary must carry the tool's OWN error message (never just its
    // name). Tools print rich {error,hint,reason} JSON even when they exit 1 — surface it. If the tool
    // emitted non-JSON, fall back to its raw stdout+stderr so a crash is never reduced to "status 1".
    let short;
    if (ex.error) {
      short = ex.error; // harness-side failure (bad args / unknown tool)
    } else if (ex.ran === false) {
      short = 'no action';
    } else if (failed) {
      const r = ex.result || {};
      const err = r.error || r.reason || r.would || r.raw || (r.stderr && `stderr: ${r.stderr}`);
      short = err
        ? (r.hint ? `${err} — hint: ${r.hint}` : err)
        : `exit ${ex.status} with no error body (raw: ${JSON.stringify(r).slice(0, 200)})`;
    } else {
      const r = ex.result || {};
      short = r.decision || r.note || r.would || r.tool || `status ${ex.status}`;
    }
    return `  ${i + 1}. ${ex.tool} (${ok}): ${typeof short === 'string' ? short.slice(0, 400) : JSON.stringify(short).slice(0, 400)}`;
  });
  const holdShort = (state.hold.held || []).slice(0, 6).map((h) => `${h.symbol}:${h.balance}`).join(' ') || 'empty';
  const entry = [
    `\n## ${state.at} — ${profileId}`,
    `- **state**: eth=${w.eth ?? '?'} usdc=${w.usdc ?? '?'} gold=${w.gold ?? '?'} silver=${w.silver ?? '?'} copper=${w.copper ?? '?'} | hold: ${holdShort} | pawns=${state.pawns.total ?? '?'} | top gap=${state.portReport.top?.[0]?.id ?? 'none'}`,
    `- **steps**: ${stepLine} — ${reply.reasoning || '(no reasoning given)'}`,
    `- **outcomes**:`,
    ...outcomeLines,
    ...(memory.noted ? [`- **noted**: ${reply.note}`] : []),
    ...(memory.goalUpdated ? [`- **goal → now**: ${reply.goal.replace(/\n/g, ' / ')}`] : []),
    ...(memory.flawFiled ? [`- **flaw filed**: ${reply.flaw}`] : []),
    `- **lesson**: ${reply.lesson || '(none)'}`,
    ``,
  ].join('\n');
  appendJournal(profileId, entry);

  // result shape stays daily.mjs-compatible: action/exec mirror the FIRST step; steps[] has them all
  const firstExec = stepResults[0] || { error: 'no steps ran' };
  return {
    ok: !stepResults.some((x) => x.error),
    profile: profileId, mode: 'live', allowExecute,
    action: { tool: reply.steps[0].tool, args: reply.steps[0].args, reasoning: reply.reasoning, lesson: reply.lesson },
    exec: firstExec,
    steps: stepResults,
    memory, rut: !!rutNotice,
    journaled: journalPath(profileId), modelRaw: raw,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const profileId = process.argv[2];
  if (!profileId || profileId.startsWith('--')) {
    console.error('usage: node citizen/brain/tick.mjs <profile> [--plan] [--live] [--base <url>] [--model <id>]');
    process.exit(1);
  }
  runTick(profileId, { plan: hasFlag('--plan'), live: hasFlag('--live'), base: flagVal('--base'), model: flagVal('--model') })
    .then((r) => { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); })
    .catch((e) => { process.stdout.write(JSON.stringify({ ok: false, profile: profileId, error: e.message }, null, 2) + '\n'); process.exit(1); });
}
