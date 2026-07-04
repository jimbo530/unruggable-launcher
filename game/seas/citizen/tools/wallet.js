#!/usr/bin/env node
'use strict';
/**
 * wallet.js — show the First Citizen's dedicated wallet: address, ETH/USDC/Money/coin balances,
 * and whether it's funded yet. Read-only. The agent calls this to know if it can act.
 *
 *   node citizen/tools/wallet.js
 */
const chain = require('../lib/chain.js');
function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

(async () => {
  const addr = chain.walletAddress();
  if (!addr) { out({ ok: false, tool: 'wallet', error: 'no wallet — run citizen/tools/init-wallet.js first', envPath: chain.ENV_PATH }); process.exit(1); }
  const b = await chain.balances(addr);
  const funded = b && (b.usdc > 0 || b.money > 0);
  out({
    ok: true, tool: 'wallet', address: addr, funded, balances: b,
    caps: { minUsdPerTrade: chain.MIN_USD_PER_TRADE, maxUsdPerTrade: chain.MAX_USD_PER_TRADE },
    liveTrading: process.env.CITIZEN_ALLOW_LIVE === '1' ? 'ENABLED' : 'disabled (DRY) — set CITIZEN_ALLOW_LIVE=1 after funding + founder approval',
    note: funded ? 'funded' : 'FUND this address with a little ETH (gas) + USDC, then the founder flips it live.',
  });
})().catch(e => { out({ ok: false, tool: 'wallet', error: e.message }); process.exit(1); });
