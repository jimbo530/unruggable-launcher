#!/usr/bin/env node
'use strict';
/**
 * sail.js — begin a server-clocked voyage to a hex (RULES-SUBJECT). The agent's "move" hand.
 * It goes THROUGH the seas-server (the location authority); travel takes real time and the bot
 * cannot trade at a destination until it genuinely arrives. We never set our own location.
 *
 *   node citizen/tools/sail.js <q> <r> [player]
 *   node citizen/tools/sail.js 8 3        # sail to Port Royal (8003)
 */
const chain = require('../lib/chain.js');
const seas = require('../lib/seas-api.js');
function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

(async () => {
  const [qArg, rArg, playerArg] = process.argv.slice(2);
  if (qArg === undefined || rArg === undefined) throw new Error('usage: sail.js <q> <r> [player]');
  const player = playerArg || chain.walletAddress();
  if (!player) throw new Error('no player address — pass one or run init-wallet.js');

  const before = await seas.location(player);
  const res = await seas.sail(player, qArg, rArg);
  out({
    ok: res.ok !== false, tool: 'sail', player, toHex: { q: Number(qArg), r: Number(rArg) },
    serverBase: seas.BASE, before, result: res,
    note: res.transport === 'unreachable'
      ? 'seas-server unreachable at this base — set SEAS_API_BASE (prod: https://tasern.quest/seas-api). NOT faking a voyage.'
      : 'voyage requested through the rules server (server-clocked; arrival takes real time).',
  });
})().catch(e => { out({ ok: false, tool: 'sail', error: e.message }); process.exit(1); });
