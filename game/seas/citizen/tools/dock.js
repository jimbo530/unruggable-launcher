#!/usr/bin/env node
'use strict';
/**
 * dock.js — the DOCKSIDE SIGN-ON board. Founder 2026-07-06: "a menu dock-side of available jobs —
 * rowing on ships in docks taking on hands." A pawn can row a ship that is NOT its own (mixed crew);
 * either way the pawn earns the ROW TOKEN of the ship it rows.
 *
 * The job is "location keyed but location moves": you must be AT the ship's current port to SIGN ON,
 * but once aboard the row job travels WITH the ship wherever it sails.
 *
 * MODES (DRY by default — the sign-on/off only mutate on --execute):
 *   node citizen/tools/dock.js                              # BOARD: ships taking hands at YOUR port
 *   node citizen/tools/dock.js --port 8003                  # BOARD: ships taking hands at a given port
 *   node citizen/tools/dock.js sign-on --pawn <d:t> --ship "<name>"            # DRY plan
 *   node citizen/tools/dock.js sign-on --pawn <d:t> --ship "<name>" --execute  # record ABOARD (+ plant if live)
 *   node citizen/tools/dock.js sign-off --pawn <d:t> [--execute]               # leave the ship
 *   node citizen/tools/dock.js status --pawn <d:t>                             # is this pawn aboard?
 *
 * WHAT SIGN-ON DOES:
 *   1) POST /seas/sign-on — the SERVER is the authority: it verifies you are AT the ship's current port
 *      AND own the pawn, then records the pawn ABOARD (survives restarts). 403/404/409 with reasons.
 *   2) (live only) PLANT the pawn in that ship's rowVault — WaterV2.plantTree is permissionless +
 *      idempotent, so YOUR OWN wallet plants (no house keeper needed). Planting only REGISTERS the pawn
 *      (0 shares, no income); the row-token PAYOUT flows only once the oars are funded (founder-gated
 *      sail->row bridge). Skipped (reported) until the wallet is funded + CITIZEN_ALLOW_LIVE=1.
 *
 * Then man the oars: `node citizen/tools/row.js --pawn <d:t> --ship "<name>"`.
 */
const { ethers } = require('ethers');
const chain = require('../lib/chain.js');
const ships = require('../lib/ships.js');
const seasApi = require('../lib/seas-api.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? null) : null; }
function has(name) { return process.argv.includes(name); }

/** distributor:tokenId → { collection, tokenId } (checksummed). Throws on garbage. */
function parsePawn(s) {
  if (typeof s !== 'string') throw new Error('pawn must be "distributor:tokenId"');
  const i = s.lastIndexOf(':');
  if (i < 0) throw new Error(`bad pawn "${s}" — expected "distributor:tokenId"`);
  const collection = ethers.getAddress(s.slice(0, i));
  const tokenId = s.slice(i + 1);
  if (tokenId === '' || !/^\d+$/.test(tokenId)) throw new Error(`bad tokenId in "${s}"`);
  return { collection, tokenId };
}

async function main() {
  const player = chain.walletAddress();
  const args = process.argv.slice(2);
  const verb = (args.find((a) => !a.startsWith('--')) || 'board').toLowerCase();
  const pawnArg = flag('--pawn');
  const shipArg = flag('--ship');
  const portArg = flag('--port');
  const execute = has('--execute');

  // ── BOARD (default): ships taking on hands at a port ──
  if (verb === 'board' || verb === 'list' || verb === 'dock') {
    if (!player && !portArg) {
      out({ ok: false, tool: 'dock', reason: 'no wallet loaded and no --port given — cannot tell which dock to read.',
        hint: 'run init-wallet.js, or pass --port <locId> (e.g. --port 8003 for Port Royal).' });
      process.exit(1);
    }
    const board = await seasApi.dock(portArg ? { port: portArg } : { player });
    if (board.transport === 'unreachable') {
      out({ ok: false, tool: 'dock', reason: 'seas-server unreachable — cannot read the dock board.', serverBase: seasApi.BASE, detail: board.error });
      process.exit(1);
    }
    out({
      ok: true, tool: 'dock', mode: 'BOARD', player: player || null,
      port: board.port, portName: board.portName, atSea: board.atSea || false, secsLeft: board.secsLeft || 0,
      shipsTakingHands: board.ships || [],
      howToSignOn: 'node citizen/tools/dock.js sign-on --pawn <distributor:tokenId> --ship "<name>" --execute  (be at the ship\'s port + own the pawn). Then row: node citizen/tools/row.js --pawn <d:t> --ship "<name>".',
      note: board.note,
    });
    return;
  }

  if (!pawnArg) throw new Error('this verb needs --pawn <distributor:tokenId> (get ids from `node citizen/tools/pawns.js`).');
  const { collection, tokenId } = parsePawn(pawnArg);

  // ── STATUS: is this pawn aboard a ship? ──
  if (verb === 'status') {
    const rec = await seasApi.aboard(collection, tokenId);
    if (rec.transport === 'unreachable') { out({ ok: false, tool: 'dock', reason: 'seas-server unreachable', serverBase: seasApi.BASE }); process.exit(1); }
    out({ ok: true, tool: 'dock', mode: 'STATUS', pawn: pawnArg, aboard: rec.aboard || null,
      note: rec.aboard ? `aboard ${rec.aboard.ship} since ${new Date(rec.aboard.since).toISOString()}. Man the oars: row --pawn ${pawnArg} --ship "${rec.aboard.ship}".` : 'not signed on to any ship. Use dock.js sign-on to join a crew taking hands.' });
    return;
  }

  // ── SIGN-OFF ──
  if (verb === 'sign-off' || verb === 'signoff' || verb === 'leave') {
    if (!execute) {
      const rec = await seasApi.aboard(collection, tokenId);
      out({ ok: true, tool: 'dock', action: 'sign-off', mode: 'DRY', pawn: pawnArg, aboardNow: (rec && rec.aboard) || null,
        would: rec && rec.aboard ? `sign ${pawnArg} off ${rec.aboard.ship}` : 'NOTHING — pawn is not aboard any ship',
        note: 'DRY — re-run with --execute to actually sign off. Clock it out of the oars separately (row stop) if still rowing.' });
      return;
    }
    if (!player) throw new Error('no wallet loaded — run init-wallet.js');
    const r = await seasApi.signOff(player, collection, tokenId);
    if (r.transport === 'unreachable') { out({ ok: false, tool: 'dock', reason: 'seas-server unreachable', serverBase: seasApi.BASE }); process.exit(1); }
    out({ ok: !!r.ok, tool: 'dock', action: 'sign-off', mode: 'LIVE', pawn: pawnArg, httpStatus: r.httpStatus, result: r });
    if (!r.ok) process.exit(1);
    return;
  }

  // ── SIGN-ON ──
  if (verb === 'sign-on' || verb === 'signon' || verb === 'join') {
    if (!shipArg) throw new Error('sign-on needs --ship "<name>" (see `node citizen/tools/dock.js` for ships taking hands).');
    const ship = ships.shipByName(shipArg);
    if (!ship) {
      out({ ok: false, tool: 'dock', reason: `unknown ship "${shipArg}" — rowable ships: ${ships.rowableShips().map((s) => s.name).join(', ')}.` });
      process.exit(2);
    }
    if (!ship.rowVault) {
      out({ ok: false, tool: 'dock', reason: `${ship.name} takes no rowing hands (${ship.note || 'no rowVault wired'}).`, ship: ship.name, founderGated: true });
      process.exit(2);
    }
    const ownShip = ships.shipByDist(collection);
    const mixedCrew = !(ownShip && ownShip.name === ship.name);

    // ── DRY: preview the gate (no server mutation, no chain tx) ──
    if (!execute) {
      const board = player ? await seasApi.dock({ player }) : { transport: player ? undefined : 'no-wallet' };
      const atShipPort = board && board.port !== undefined ? Number(board.port) === Number(ship.homePort) : null;
      out({
        ok: true, tool: 'dock', action: 'sign-on', mode: 'DRY', pawn: pawnArg, ship: ship.name,
        mixedCrew, ownCrew: ownShip ? ownShip.name : null,
        rowToken: ship.shipToken, rowVault: ship.rowVault,
        yourPort: board && board.port !== undefined ? { loc: board.port, name: board.portName, atSea: board.atSea || false } : 'unknown (server unreachable / no wallet)',
        atShipPort,
        would: `sign ${pawnArg} onto ${ship.name} (server verifies you are AT ${ship.name}'s port + own the pawn), then — when live — plant it in ${ship.name}'s rowVault so it can earn the ship's row token.`,
        note: 'DRY — nothing recorded. Re-run with --execute to sign on for real. Planting the pawn in the rowVault happens only when the wallet is funded + CITIZEN_ALLOW_LIVE=1 (permissionless plantTree, your own wallet). Then: row --pawn ' + pawnArg + ' --ship "' + ship.name + '".',
      });
      return;
    }

    if (!player) throw new Error('no wallet loaded — run init-wallet.js');

    // 1) SERVER sign-on (the authority: presence-at-the-ship's-port + ownership). Records ABOARD.
    const r = await seasApi.signOn(player, collection, tokenId, ship.name);
    if (r.transport === 'unreachable') { out({ ok: false, tool: 'dock', reason: 'seas-server unreachable — sign-on not recorded', serverBase: seasApi.BASE }); process.exit(1); }
    if (!r.ok) {
      out({ ok: false, tool: 'dock', action: 'sign-on', mode: 'LIVE', pawn: pawnArg, ship: ship.name, httpStatus: r.httpStatus, reason: r.reason, result: r });
      process.exit(1);
    }

    // 2) PLANT the pawn in the ship's rowVault (permissionless, idempotent) — LIVE only.
    let plant = { done: false, note: 'plant skipped — needs a funded wallet + CITIZEN_ALLOW_LIVE=1 (the aboard record is set; rowing the WorkClock job does not require the plant, but the row-token payout will once the oars are funded).' };
    if (process.env.CITIZEN_ALLOW_LIVE === '1') {
      try {
        const res = await chain.plantPawn({ vault: ship.rowVault, collection, tokenId });
        plant = { done: true, alreadyPlanted: res.alreadyPlanted, plantTx: res.plantTx, treeId: Number(res.treeId), rowVault: ship.rowVault };
      } catch (e) {
        plant = { done: false, error: e.message, note: 'sign-on IS recorded on the server, but the on-chain plant failed — surfaced, not hidden. Retry the plant or check the wallet/gas.' };
      }
    }

    out({
      ok: true, tool: 'dock', action: 'sign-on', mode: 'LIVE', pawn: pawnArg, ship: ship.name, mixedCrew,
      aboard: r.aboard, plant,
      next: `node citizen/tools/row.js --pawn ${pawnArg} --ship "${ship.name}"  (man the oars — earns ${ship.name}'s own row token).`,
      note: r.note,
    });
    return;
  }

  throw new Error(`unknown verb "${verb}" — use: board (default) | sign-on | sign-off | status. Run \`node citizen/tools/dock.js\` for the dock board.`);
}

main().catch((e) => { out({ ok: false, tool: 'dock', error: e.message || String(e), hint: 'run `node citizen/tools/dock.js` (no args) for the dock board; sign-on needs --pawn <distributor:tokenId> --ship "<name>".' }); process.exit(1); });
