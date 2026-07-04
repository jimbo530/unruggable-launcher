// @ts-check
'use strict';
/**
 * jobs.js — the SINGLE SOURCE OF TRUTH for what a Seize-the-Seas pawn can clock INTO via WorkClock V2.
 *
 * A "job" here = a WorkClock JOB target (TargetType.JOB). The clock tracks continuous worked-time on
 * that target; the guard-ladder keeper (mftusd-build/seas-ladder/guard-ladder-keeper.cjs) reads
 * currentRun()/accumulated() on the target and pays the time ladder. So a job is REAL on-chain iff a
 * WorkClock JOB *target* exists for it. The target is a WaterV2 job vault (game/seas/jobs/index.html
 * JOBS config + game/seas/employment.js VAULT_TO_KEY are the live map).
 *
 * STATUS (verified on-chain 2026-06-27 — addresses cross-checked against jobs/index.html,
 * employment.js, water-tokens.csv, deploy/ocean-deployed.json, deploy/mill-lp-deployed.json,
 * deploy/forageables-deployed.json):
 *
 *   LIVE  — a WorkClock JOB target (WaterV2 vault) is deployed; a pawn can clock in TODAY:
 *           the 6 town stat-jobs (haul/mend/stock/beacon/rites/barter) + the GUARD civic job.
 *
 *   PLANNED — the founder named these (fishing/logging/milling/crabbing) and the ECONOMY exists
 *           (FISH/LUMBER/CRAB tokens + sell-walls/ocean/mill LPs), BUT there is NO WaterV2 JOB
 *           VAULT for them yet, so they are NOT valid WorkClock targets. Clocking in is therefore
 *           IMPOSSIBLE without a founder-gated vault deploy. We expose them so the brain can SEE
 *           them and the work tool can report exactly what's missing — we NEVER fake a clock-in to
 *           a target that doesn't exist (real-or-nothing).
 *
 * Adding a real fishing/etc job later = deploy its WaterV2 vault, drop its address in here with
 * status:'live', register the matching achievement rungs on the prize pool, and it lights up with
 * ZERO code change to work.js or the brain.
 */

const TT_JOB = 0;   // WorkClock TargetType.JOB
// const TT_SHIP = 1; // (ships are handled by the crew/allegiance flow, not the work tool)

// The pawn crew collections (the four ship distributors; same as pawns.js / crew/index.html).
// A job is collection-agnostic (WaterV2.plantTree(collection,tokenId)) so any pawn collection works.
const PAWNS = {
  blackTide: '0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f',
  solDelMar: '0x9500880DEC9B310b4a728C75A271a25615A2443E',
  redrum:    '0x4ECe491951B759363bCBAF75389a202Fe0584080',
  guard:     '0x8C1f935F6DbB17d593BF3EC8114A2f045e350545',
};

/**
 * @typedef {Object} Job
 * @property {string} id           stable job id the brain/tool use
 * @property {string} name         town-flavor name (matches jobs/index.html)
 * @property {string} stat         the skill it trains (or 'GUARD'/'-')
 * @property {'live'|'planned'} status
 * @property {number} ttype        WorkClock TargetType (JOB=0)
 * @property {string|null} target  the WorkClock JOB target (WaterV2 vault) — null if PLANNED (no vault)
 * @property {string|null} produces token symbol the economy yields (flavor/context)
 * @property {string|null} terrainGate  required terrain to work here (e.g. 'beach' for crabbing) or null
 * @property {string} note
 */

/** @type {Job[]} */
const JOBS = [
  // ── LIVE town stat-jobs (WorkClock JOB targets = the WaterV2 stat vaults) ──
  { id: 'haul',   name: 'Haul cargo',        stat: 'STR', status: 'live', ttype: TT_JOB, target: '0xD6D793628dc6Eed71EB37dd6c51678E8a9c25f22', produces: 'CRATE',   terrainGate: null, note: 'on the docks — trains STR' },
  { id: 'mend',   name: 'Mend the nets',     stat: 'DEX', status: 'live', ttype: TT_JOB, target: '0xb303c91724485462e3450A0Bd4513a521df997cB', produces: 'EGP',     terrainGate: null, note: 'netting sheds — trains DEX' },
  { id: 'stock',  name: 'Stock the rations', stat: 'CON', status: 'live', ttype: TT_JOB, target: '0x893531A85f249cC38Da772be9056762E188302F6', produces: 'BURGERS', terrainGate: null, note: 'storehouse — trains CON' },
  { id: 'beacon', name: 'Tend the beacon',   stat: 'INT', status: 'live', ttype: TT_JOB, target: '0x90B54DA4Ac020fB163C51237e169FecEaC2369be', produces: 'BEACON',  terrainGate: null, note: 'lighthouse — trains INT' },
  { id: 'rites',  name: 'Sea-calling rites', stat: 'WIS', status: 'live', ttype: TT_JOB, target: '0x8C121fC0171944C3EA40d14FE549dFf7107BDf39', produces: 'SHELLS',  terrainGate: null, note: 'shell shrine — trains WIS' },
  { id: 'barter', name: 'Barter & haggle',   stat: 'CHA', status: 'live', ttype: TT_JOB, target: '0xc0813524820df5C6bb9a63a521fE218ff974b1B4', produces: 'TGN',     terrainGate: null, note: 'market square — trains CHA' },
  // ── LIVE civic job (the Harbor Guard's WorkClock target = the cbBTC MayorVault; guard ladder pays it) ──
  { id: 'guard',  name: 'Guard the Port',    stat: 'GUARD', status: 'live', ttype: TT_JOB, target: '0x44c504Ce08635536635f153B6Ae5d9D6d8b3131F', produces: 'cbBTC/GOLD', terrainGate: null, note: "the Mayor's civic post — funds the prize purse; guard ladder ids 1001-1006" },

  // ── HARVEST jobs — founder 2026-06-27 (CORRECTED): production is gated to a pawn's WATER FLOW +
  // SKILL, NEVER a market-buy. A "catch" = a deterministic skill-scaled, supply-capped HARVEST of the
  // resource a WATER source's flow has produced (citizen/lib/harvest.js). Run with the `fish` tool,
  // NOT `work` (no clock-in target). The market swap-BUY is FORBIDDEN + disabled.
  //
  // FISHING — flow-live SUPPLY (ocean LP FISH reserve = what the ocean-water keeper produced), skill =
  // WIS. CATCH at the ocean grounds (loc 8004), carry to Port Royal (loc 8003), SELL dear (real buyer).
  // The catch DISPENSER is not built yet (no on-chain skill-gated catch mechanism) → catch is DRY-design
  // until founder builds it; the SELL leg is LIVE-capable. ──
  { id: 'fish',  name: 'Fishing',  stat: 'WIS', status: 'live', mechanism: 'flow-catch', tool: 'fish', ttype: null, target: null,
    produces: 'FISH',   terrainGate: null,
    note: "Skill+flow-gated CATCH (NOT a buy): supply = ocean LP FISH reserve (flow-produced), skill = WIS (sea-calling vault). Catch at the ocean (loc 8004) → sail to Port Royal (loc 8003) → SELL dear (real buyer). `node citizen/tools/fish.js [loop|catch|sell]`. Catch DISPENSER founder-gated (flagged); sell is live-capable. Market swap-buy FORBIDDEN/disabled. Fisher pawn = Sol del Mar / deckhand 0x218C…" },

  // CRABBING — SAME flow-gated skill catch as fishing (founder: "crabbing is same, only flow from
  // water turns to crabs"), but the CRAB water flow source is NOT deployed → no supply yet. Beach-gated.
  { id: 'crab',  name: 'Crabbing', stat: 'WIS', status: 'planned', mechanism: 'flow-catch', tool: 'fish', ttype: null, target: null,
    produces: 'CRAB',   terrainGate: 'beach',
    note: 'SAME mechanic as fishing (flow-gated skill catch via `fish crab`), skill = WIS, gated to BEACH tiles (game/lib/location.js; Bonewater Atolls = beach). PLANNED: needs a CRAB WATER flow source deployed (a water vault whose flow → CRAB 0xCc85d908…) — there is no supply to harvest until then. NO crab MARKET is needed (scratch that). Founder-gated: the CRAB water vault + the shared catch dispenser.' },

  // ── PLANNED jobs the founder named (2026-06-27) — economy EXISTS, mechanic not wired ──
  { id: 'log',   name: 'Logging',  stat: '-', status: 'planned', mechanism: 'flow-catch?', ttype: TT_JOB, target: null,
    produces: 'LUMBER', terrainGate: 'forest',
    note: 'Likely the SAME flow-gated harvest model (lumber from a tree/forest water flow), gated to forest tiles. LUMBER token 0x7a97e5e7… + mill LPs exist; the harvest mechanic + a lumber water flow source are not wired. Founder-gated.' },
  { id: 'mill',  name: 'Milling',  stat: '-', status: 'planned', mechanism: 'structure?', ttype: TT_JOB, target: null,
    produces: 'LUMBER', terrainGate: null,
    note: 'Mills (LUMBER/GOLD LPs at loc 13001/14003) are LIVE keeper-fed pools; milling = processing logs at a mill STRUCTURE (ties to the build mechanic / a mill water vault). Founder-gated.' },
];

const byId = (id) => JOBS.find((j) => j.id === String(id).toLowerCase()) || null;
const liveJobs = () => JOBS.filter((j) => j.status === 'live');
const plannedJobs = () => JOBS.filter((j) => j.status === 'planned');

module.exports = { JOBS, PAWNS, byId, liveJobs, plannedJobs, TT_JOB };
