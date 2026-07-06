#!/usr/bin/env node
'use strict';
/**
 * row.js — MAN THE OARS. Put a pawn to rowing on ITS OWN ship. Rowing is a JOB on the ship: a pawn
 * can do it as long as it is aboard (a member of that ship's crew), wherever the ship happens to be.
 *
 * FOUNDER'S DESIGN (2026-07-06):
 *   • "when a pawn rows its flow goes to buying the ship's row token"
 *   • "any pawn made with a ship gets a fee flow from LP ... we need rowers with flow to make those
 *      pawns' flow get activated"
 *   • "wire the row action. it would be a job on the ship so can be done as long as the pawn is on the
 *      ship. this is location keyed but location moves."
 *
 * HOW THIS MAPS TO LIVE MACHINERY (no new mechanism invented):
 *   • The "job on the ship" = clock the pawn into the ship's rowVault as a WorkClock V2 JOB target
 *     (the SAME clock the town jobs + Guard use; Guard's target is likewise a water/flow vault). This
 *     records the pawn AT THE OARS + the time it rows. Owner-only, on-chain.
 *   • "aboard" (v1) = crew membership: the pawn is a token in that ship's crew distributor. The oars
 *     move WITH the ship — no port/location requirement (the server has no ship-entity position yet,
 *     so crew membership is the faithful aboard-ness; see lib/ships.js).
 *   • "flow goes to buying the ship's row token" = the ship's rowVault (WaterV2, payoutToken = the
 *     ship's own token) harvests its backing's Aave yield and BUYS the ship token (Money->ship pool).
 *     That is done by the live row-harvest keeper on the pawn's ROW-WATER backing — see the GAP below.
 *
 * THE GAP (reported, NOT papered over): clocking a pawn IN marks it at the oars, but for its flow to
 * actually buy the ship token the pawn needs ROW-WATER backing in the rowVault, and there is currently
 * NO free/automatic redirect of a pawn's EXISTING water-flow into the rowVault. Turning an already-
 * watered pawn's flow into rowVault principal is the founder-gated sail->row bridge (Option A keeper /
 * Option B contract in mftusd-build/row-fund-from-sails.cjs). This tool does NOT invent a dispenser or
 * a free-income path. It wires the JOB layer the founder asked for; the flow-funding automation stays
 * founder-gated and is surfaced in every status read.
 *
 * MODES (DRY by default; live needs --execute AND CITIZEN_ALLOW_LIVE=1 + you must OWN the pawn):
 *   node citizen/tools/row.js                                  # READ: the oars + rowable ships + my pawns' row state
 *   node citizen/tools/row.js --pawn <distributor:tokenId>     # DRY plan: clock this pawn into rowing on its ship
 *   node citizen/tools/row.js status --pawn <distributor:tokenId>   # is it rowing? for how long? + the oars' flow state
 *   node citizen/tools/row.js --pawn <distributor:tokenId> --execute  # LIVE clock-in (owner tx)
 *   node citizen/tools/row.js stop --pawn <distributor:tokenId> [--execute]  # ship the oars (clock out)
 */
const { ethers } = require('ethers');
const chain = require('../lib/chain.js');
const ships = require('../lib/ships.js');
const seasApi = require('../lib/seas-api.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? null) : null; }
function has(name) { return process.argv.includes(name); }

/** Parse "distributor:tokenId" -> { collection, tokenId } (checksummed). Throws on garbage. */
function parsePawn(s) {
  if (typeof s !== 'string') throw new Error('pawn must be "distributor:tokenId"');
  const i = s.lastIndexOf(':');
  if (i < 0) throw new Error(`bad pawn "${s}" — expected "distributor:tokenId"`);
  const collection = ethers.getAddress(s.slice(0, i));
  const tokenId = s.slice(i + 1);
  if (tokenId === '' || !/^\d+$/.test(tokenId)) throw new Error(`bad tokenId in "${s}"`);
  return { collection, tokenId };
}

const fmtDur = (secs) => {
  secs = Number(secs) || 0;
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
};

// Minimal WaterV2 (rowVault) read surface — self-verify the oars + report the flow state.
const ROWVAULT_ABI = [
  'function payoutToken() view returns (address)',
  'function poolFee() view returns (uint24)',
  'function treeIdFor(address,uint256) view returns (uint256)', // treeId+1, 0 = not planted (not backed)
  'function treeWater(uint256) view returns (uint256)',
  'function pendingYield() view returns (uint256)',
  'function totalBacking() view returns (uint256)',
  'function totalPayoutBought() view returns (uint256)',
];

/** Read the oars (rowVault) state for a ship + a specific pawn. Read-only; returns { ...state, error? }. */
async function readOars(ship, collection, tokenId) {
  const v = new ethers.Contract(ship.rowVault, ROWVAULT_ABI, chain.provider());
  const [payoutToken, poolFee, treeIdPlus1, pendingYield, totalBacking, totalBought] = await Promise.all([
    v.payoutToken(), v.poolFee(), v.treeIdFor(collection, tokenId), v.pendingYield(), v.totalBacking(), v.totalPayoutBought(),
  ]);
  const backed = treeIdPlus1 !== 0n;
  let rowWaterUsd = 0;
  if (backed) { try { rowWaterUsd = Number(ethers.formatUnits(await v.treeWater(treeIdPlus1 - 1n), 6)); } catch { rowWaterUsd = 0; } }
  return {
    payoutToken, poolFee: Number(poolFee),
    tokenMatchesRegistry: !ship.shipToken || payoutToken.toLowerCase() === ship.shipToken.toLowerCase(),
    pawnBacked: backed, treeId: backed ? Number(treeIdPlus1 - 1n) : null, rowWaterUsd,
    oarsBackingUsd: Number(ethers.formatUnits(totalBacking, 6)),
    pendingYieldUsd: Number(ethers.formatUnits(pendingYield, 6)),
    shipTokenBought: Number(ethers.formatUnits(totalBought, 18)),
  };
}

// The founder-gated flow-funding note carried on every status — honest about what rowing does + does NOT do yet.
const FLOW_GAP_NOTE =
  "Clocking in marks the pawn AT THE OARS (the job on the ship, time tracked on-chain). For its flow to actually " +
  "BUY the ship token, the pawn needs row-water backing in the oars (rowVault) and the live row-harvest keeper " +
  "compounds it (half grows the crew's row-water/levels, half buys the ship token -> volume -> LP fees -> wakes " +
  "every crew pawn's dormant flow). Auto-redirecting a pawn's EXISTING water-flow into the oars is the founder-gated " +
  "sail->row bridge (mftusd-build/row-fund-from-sails.cjs) — NOT wired here, and NOT faked.";

async function main() {
  const player = chain.walletAddress();
  const args = process.argv.slice(2);
  const verb = (args.find((a) => !a.startsWith('--')) || 'read').toLowerCase();
  const pawnArg = flag('--pawn');
  const mode = flag('--mode') ? Number(flag('--mode')) : 1; // WorkClock payout route (1 single / 2 double)
  const execute = has('--execute');

  // ── READ (no pawn): the oars + which ships are rowable ──
  if ((verb === 'read' || verb === 'list' || verb === 'oars') && !pawnArg) {
    out({
      ok: true, tool: 'row', mode: 'READ', player,
      whatIsRowing: 'Man the oars: a pawn rows a ship — its OWN crew ship (aboard by birth) OR any ship it signed onto at the dock (mixed crew). Either way the pawn gets the ROW TOKEN of the ship it is rowing. A job it can do wherever the ship is.',
      rowableShips: ships.rowableShips().map((s) => ({ ship: s.name, species: s.species, crewDistributor: s.dist })),
      shipsWithoutOars: ships.SHIPS.filter((s) => !s.rowVault).map((s) => ({ ship: s.name, why: s.note })),
      howToRow: 'OWN ship: row --pawn <distributor:tokenId>. MIXED CREW: first sign on at the dock — `node citizen/tools/dock.js sign-on --pawn <d:t> --ship "<name>" --execute` (be at the ship\'s port + own the pawn) — then `row --pawn <d:t> --ship "<name>"`. Get pawn ids from `node citizen/tools/pawns.js`. Watch with `row status`, ship the oars with `row stop`.',
      dockBoard: 'node citizen/tools/dock.js — ships "taking on hands" at your port.',
      note: FLOW_GAP_NOTE,
      backend: {
        aboardRule: 'own crew = pawn is in the ship\'s crew distributor (no port gate; oars move with the ship). MIXED crew = a server sign-on record (POST /seas/sign-on, gated by presence-at-the-ship\'s-port + ownership); once aboard the row job travels with the ship.',
        jobMechanism: 'WorkClock V2 setWork(collection, tokenId, rowVault, JOB, mode) — same clock as town jobs + Guard. The rowVault the pawn clocks into pays THAT ship\'s own row token.',
        workClock: chain.WORKCLOCK,
      },
    });
    return;
  }

  if (!pawnArg) throw new Error('pass --pawn <distributor:tokenId> (verbs: <default>=clock-in, status, stop). See `row` with no args for the rowable ships.');
  const { collection, tokenId } = parsePawn(pawnArg);
  const shipArg = flag('--ship');

  // ── Resolve which ship's oars this pawn would man + HOW it is aboard ──
  //   • own crew (no --ship, or --ship names its OWN ship): aboard by crew membership (the pawn is a
  //     token in that ship's crew distributor). Oars move with the ship — no port gate.
  //   • mixed crew (--ship names a DIFFERENT ship OR the pawn isn't from a known crew): aboard ONLY if
  //     the pawn SIGNED ON at that ship's dock (server aboard record). Founder: "pawns can also row
  //     boats that are not their own, mixed crew — either way the pawn gets the row token from the ship
  //     it is rowing." Sign on first with `node citizen/tools/dock.js sign-on ... --execute`.
  const ownShip = ships.shipByDist(collection);
  let ship, aboardBy, mixedCrew = false;
  if (shipArg) {
    ship = ships.shipByName(shipArg);
    if (!ship) {
      out({ ok: false, tool: 'row', reason: `unknown ship "${shipArg}" — rowable ships: ${ships.rowableShips().map((s) => s.name).join(', ')}.`,
        hint: 'pass --ship with an exact ship name, or drop --ship to row this pawn\'s own crew ship.' });
      process.exit(2);
    }
    if (ownShip && ownShip.name === ship.name) {
      aboardBy = 'crew membership (own ship)';
    } else {
      mixedCrew = true; // rowing a ship that is NOT this pawn's own crew — needs a dock sign-on
      const rec = await seasApi.aboard(collection, tokenId);
      const aboardShip = rec && rec.aboard && rec.aboard.ship;
      if (aboardShip !== ship.name) {
        out({ ok: false, tool: 'row', reason: `pawn ${pawnArg} has not signed on to ${ship.name} — it is a mixed-crew rower (its own crew is ${ownShip ? ownShip.name : 'not a known ship'}).`,
          aboardNow: aboardShip || null,
          hint: `sign on at the dock first: node citizen/tools/dock.js sign-on --pawn ${pawnArg} --ship "${ship.name}" --execute  (you must be at ${ship.name}'s port AND own the pawn).`,
          serverBase: seasApi.BASE });
        process.exit(2);
      }
      aboardBy = `signed on at the dock (mixed crew — own crew ${ownShip ? ownShip.name : 'unknown'})`;
    }
  } else {
    ship = ownShip;
    if (!ship) {
      out({ ok: false, tool: 'row', reason: `pawn ${pawnArg} is not from a known ship crew — its distributor ${collection} isn't a registered ship (lib/ships.js). Pass --ship "<name>" to row a ship it signed onto at the dock.`,
        hint: 'Use a crewId from `node citizen/tools/pawns.js` (a Black Tide / Redrum / Harbor Guard / Verdant pawn), OR sign a pawn onto a ship at the dock (dock.js) then row with --ship.' });
      process.exit(2);
    }
    aboardBy = 'crew membership';
  }
  if (!ship.rowVault) {
    out({ ok: false, tool: 'row', reason: `${ship.name} has no oars wired yet (${ship.note}). A ${ship.name} pawn cannot row until its rowVault is deployed.`,
      ship: ship.name, blocked: 'no-rowvault', founderGated: 'deploy this ship\'s WaterV2 rowVault (payoutToken = the ship token), then it lights up here with zero code change.' });
    process.exit(3);
  }

  // Ownership (WorkClock is owner-only; surface a clear status, not a revert).
  const nft = new ethers.Contract(collection, ['function ownerOf(uint256) view returns (address)'], chain.provider());
  let owner;
  try { owner = await nft.ownerOf(tokenId); } catch (e) { throw new Error(`pawn #${tokenId} ownerOf failed (${e.shortMessage || e.message}) — not minted / burned?`); }
  const ownerHeld = !!player && owner.toLowerCase() === player.toLowerCase();

  // Current work record + the oars' live state (self-verifies payoutToken vs registry).
  const [work, oars] = await Promise.all([
    chain.readWork(collection, tokenId),
    readOars(ship, collection, tokenId).catch((e) => ({ error: e.shortMessage || e.message })),
  ]);
  const rowingThisShip = work.employed && work.target.toLowerCase() === ship.rowVault.toLowerCase();
  const backendBlock = {
    aboardRule: 'crew membership (v1)', crewDistributor: ship.dist,
    workClock: chain.WORKCLOCK, rowVault: ship.rowVault,
    payoutToken: oars && oars.payoutToken ? oars.payoutToken : ship.shipToken,
    payoutTokenVerified: oars && oars.tokenMatchesRegistry === true,
    poolFee: oars && oars.poolFee ? oars.poolFee : ship.poolFee,
  };

  // ── STATUS ──
  if (verb === 'status') {
    out({
      ok: true, tool: 'row', mode: 'STATUS', player,
      pawn: pawnArg, ship: ship.name, ownerHeldByYou: ownerHeld, owner,
      rowing: rowingThisShip,
      rowingElsewhere: work.employed && !rowingThisShip ? `pawn is clocked into a different target ${work.target} (not ${ship.name}'s oars)` : null,
      timeAtOars: rowingThisShip ? fmtDur(work.currentRunSecs) : null,
      oars: oars && !oars.error ? {
        pawnHasRowWater: oars.pawnBacked,
        rowWaterLevel: oars.rowWaterUsd,
        crewOarsBackingUsd: oars.oarsBackingUsd,
        pendingYieldUsd: oars.pendingYieldUsd,
        shipTokenBoughtSoFar: oars.shipTokenBought,
      } : { error: oars && oars.error },
      note: FLOW_GAP_NOTE,
      backend: backendBlock,
    });
    return;
  }

  // ── STOP (clock out) ──
  if (verb === 'stop' || verb === 'clock-out' || verb === 'clockout') {
    if (!execute) {
      out({ ok: true, tool: 'row', action: 'stop', mode: 'DRY', pawn: pawnArg, ship: ship.name,
        rowing: rowingThisShip,
        would: rowingThisShip ? `ship the oars — clock pawn out (settles ${fmtDur(work.currentRunSecs)} at the oars into history)` : 'NOTHING — pawn is not rowing this ship',
        note: 'DRY — re-run with --execute AND CITIZEN_ALLOW_LIVE=1 to broadcast (owner tx).', backend: backendBlock });
      return;
    }
    if (!ownerHeld) throw new Error(`pawn #${tokenId} is held by ${owner}, not this wallet (${player}) — WorkClock is owner-only; refusing to clock out a pawn you don't hold`);
    if (!work.employed) throw new Error(`pawn ${pawnArg} is not rowing — nothing to clock out`);
    const hash = await chain.clockOut(collection, tokenId);
    out({ ok: true, tool: 'row', action: 'stop', mode: 'LIVE', pawn: pawnArg, ship: ship.name, tx: hash, backend: backendBlock });
    return;
  }

  // ── CLOCK IN (default verb) ──
  const switching = work.employed && !rowingThisShip;
  if (!execute) {
    out({
      ok: true, tool: 'row', action: 'clock-in', mode: 'DRY', pawn: pawnArg, ship: ship.name,
      aboard: true, aboardBy, mixedCrew,
      rowTokenPaid: ship.shipToken ? `${ship.name}'s own row token ${ship.shipToken} (the vault you clock into pays that ship's token)` : `${ship.name}'s own row token`,
      ownerHeldByYou: ownerHeld, owner,
      alreadyRowing: rowingThisShip,
      switchWarning: switching ? `pawn is currently clocked into ${work.target} — putting it to the oars settles that ${fmtDur(work.currentRunSecs)} run and starts a fresh one (lose-on-switch).` : null,
      would: rowingThisShip
        ? `already at the oars of ${ship.name} — re-clock would only refresh the payout route (keeps the run)`
        : `put pawn #${tokenId} to the oars of ${ship.name} — WorkClock.setWork(${collection}, ${tokenId}, rowVault ${ship.rowVault}, JOB, mode ${mode})`,
      oars: oars && !oars.error ? { pawnHasRowWater: oars.pawnBacked, rowWaterLevel: oars.rowWaterUsd, shipTokenBoughtSoFar: oars.shipTokenBought } : { error: oars && oars.error },
      executable: ownerHeld,
      note: ownerHeld
        ? 'DRY — no tx sent. Live needs --execute AND CITIZEN_ALLOW_LIVE=1. WorkClock is owner-only (verified on-chain before broadcast). ' + FLOW_GAP_NOTE
        : `HOLD — this wallet does not own pawn #${tokenId} (held by ${owner}). Row only pawns you hold. ` + FLOW_GAP_NOTE,
      backend: backendBlock,
    });
    return;
  }

  // LIVE — chain.setWork enforces CITIZEN_ALLOW_LIVE + on-chain ownership; throws loudly otherwise.
  if (!ownerHeld) throw new Error(`pawn #${tokenId} held by ${owner}, not this wallet (${player}) — WorkClock is owner-only; refusing to put a pawn you don't hold to the oars`);
  const hash = await chain.setWork(collection, tokenId, ship.rowVault, ships.TT_JOB, mode);
  const after = await chain.readWork(collection, tokenId);
  out({
    ok: true, tool: 'row', action: 'clock-in', mode: 'LIVE', pawn: pawnArg, ship: ship.name, tx: hash,
    verified: { rowing: after.employed, onOars: after.target.toLowerCase() === ship.rowVault.toLowerCase(), timeAtOars: fmtDur(after.currentRunSecs) },
    note: FLOW_GAP_NOTE, backend: backendBlock,
  });
}

main().catch((e) => { out({ ok: false, tool: 'row', error: e.message || String(e), hint: 'run `node citizen/tools/row.js` (no args) for the rowable ships, then `row --pawn <distributor:tokenId>` (ids from pawns.js myCrewIds). Rowing needs a pawn you hold from a ship that has oars (a rowVault).' }); process.exit(1); });
