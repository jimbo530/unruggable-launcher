#!/usr/bin/env node
'use strict';
/**
 * trade.js — plan (and, once funded+approved, execute) ONE small gap-closing trade. The agent's
 * "close this gap" hand. DRY BY DEFAULT: it prints the route, the size, the price BEFORE, the
 * expected fill, and the implied price move — but broadcasts NOTHING. Live needs both --execute
 * AND CITIZEN_ALLOW_LIVE=1 (set only after the founder funds + eyeballs).
 *
 * SAFETY (all enforced here): notional clamped to $0.10–$0.25 ; BUY the under-priced only ; never
 * the near-zero sell wall (sellSafe must be true to sell) ; exact approvals ; routes only through
 * the working fill route the scanner chose.
 *
 *   node citizen/tools/trade.js <gapId> [usd]          # plan to close a gap (default $0.10)
 *   node citizen/tools/trade.js <gapId> 0.20 --execute # live (refused unless funded+ALLOW_LIVE)
 */
const { ethers } = require('ethers');
const gs = require('../../gap-scan.js');
const chain = require('../lib/chain.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
const clamp = (x) => Math.min(chain.MAX_USD_PER_TRADE, Math.max(chain.MIN_USD_PER_TRADE, x));

(async () => {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const pos = args.filter(a => !a.startsWith('--'));
  const gapId = pos[0];
  const usd = clamp(Number(pos[1] || chain.MIN_USD_PER_TRADE));
  if (!gapId) throw new Error('usage: trade.js <gapId> [usd] [--execute]');

  const gaps = await gs.scanGaps();
  const g = gaps.find(x => x.id === gapId);
  if (!g) throw new Error(`unknown gap id "${gapId}" — run scan-gaps for valid ids`);

  // Decide the safe action.
  let refuse = null;
  if (g.priceUsd === null) refuse = 'no live price/route (LocationPool-gated or custom-pool quote unavailable)';
  else if (!g.actionable) refuse = `no safe trade: direction=${g.direction}, gap=${g.gapPct?.toFixed(2)}% (within band, or the only side is the near-zero sell wall)`;
  else if (g.direction === 'sell' && !g.sellSafe) refuse = 'sell side is a near-zero drain wall (sellSafe=false) — refusing until a two-sided market exists';

  const wallet = chain.walletAddress();
  const bals = await chain.balances().catch(() => null);

  // Build the route plan + a size quote where the route is a standard V3 fill.
  const reg = gs.loadRegistry().find(t => t.id === gapId);
  const plan = { action: g.direction, gapId, sym: g.sym, notionalUsd: usd, route: g.route };
  let executable = false;

  if (!refuse && reg) {
    if (reg.route.type === 'v3-single' && reg.route.via === 'money') {
      // buy via Money→token fee — quote at size for the effective fill
      const amtIn = ethers.parseUnits(usd.toFixed(6), 6);
      const o = await gs.quoteSingle(gs.ADDR.money, reg.token, reg.route.fee, amtIn);
      if (o && o > 0n) {
        const tokensOut = Number(ethers.formatUnits(o, 18));
        plan.path = ['USDC→Money (deposit 1:1)', `Money→${g.sym} fee${reg.route.fee}`];
        plan.tokenIn = 'Money'; plan.fee = reg.route.fee;
        plan.expectedTokensOut = tokensOut;
        plan.effectivePriceUsd = usd / tokensOut;
        plan.spotPriceUsd = g.priceUsd;
        plan.impliedMovePct = ((plan.effectivePriceUsd - g.priceUsd) / g.priceUsd) * 100;
        executable = true;
      }
    } else if (reg.route.type === 'v3-single') {
      // buy good via coin→good fee — need the coin first (USDC→Money→coin→good)
      const coinUsd = (await gs.liveCoinUsd())[reg.route.coin] ?? gs.COIN_USD[reg.route.coin];
      const coinUnits = usd / coinUsd;
      const amtIn = ethers.parseUnits(coinUnits.toFixed(6), 18);
      const o = await gs.quoteSingle(reg.route.tokenIn, reg.token, reg.route.fee, amtIn);
      if (o && o > 0n) {
        const tokensOut = Number(ethers.formatUnits(o, 18));
        plan.path = ['USDC→Money', `Money→${reg.route.coin}`, `${reg.route.coin}→${g.sym} fee${reg.route.fee}`];
        plan.tokenIn = reg.route.coin; plan.fee = reg.route.fee;
        plan.coinUnits = coinUnits; plan.expectedTokensOut = tokensOut;
        plan.effectivePriceUsd = usd / tokensOut;
        plan.spotPriceUsd = g.priceUsd;
        plan.impliedMovePct = ((plan.effectivePriceUsd - g.priceUsd) / g.priceUsd) * 100;
        executable = true; // executable via SwapRouter02 once the coin is held
      }
    } else if (reg.route.type === 'custom-pool') {
      // fish/lumber custom self-add AMM — needs the pool's own swap entrypoint, not SwapRouter02
      plan.path = [`buy ${g.sym} on custom pool ${reg.route.pool}`];
      plan.spotPriceUsd = g.priceUsd;
      plan.note = 'custom AMM — execution path (pool swap method) NOT wired yet; planning only';
      plan.executableTodo = true;
      executable = false;
    }
  }

  // DRY (default) — print the plan, broadcast nothing.
  if (!execute) {
    out({
      ok: true, tool: 'trade', mode: 'DRY', wallet, funded: bals ? bals.usdc > 0 : false,
      balances: bals, plan, executable,
      refused: refuse, would: refuse ? 'NOTHING (no safe trade)' : `BUY ~${usd} USD of ${g.sym} via ${plan.path ? plan.path.join(' → ') : plan.route}`,
      note: 'DRY mode — no transaction sent. Live requires --execute AND CITIZEN_ALLOW_LIVE=1 after funding.',
    });
    return;
  }

  // LIVE path — every guard must pass; otherwise refuse loudly (never fake success).
  if (refuse) throw new Error('refusing live trade: ' + refuse);
  if (!executable) throw new Error('this route is not executable yet (custom pool / no fill) — staying safe');
  if (!chain.loadWallet()) throw new Error('no Citizen wallet — run init-wallet.js and fund it');
  // Only the Money→token single-hop is wired for live execution today (the two-sided GOLD market).
  if (!(reg.route.type === 'v3-single' && reg.route.via === 'money')) {
    throw new Error('live execution wired only for Money→token single-hop (e.g. GOLD) so far; coin→good + custom pools are TODO');
  }
  const amtIn = ethers.parseUnits(usd.toFixed(6), 6);
  // NB: requires Money balance; minting USDC→Money is a separate funded step (TODO wire here).
  const quoted = await gs.quoteSingle(gs.ADDR.money, reg.token, reg.route.fee, amtIn);
  const hash = await chain.executeSwap({ tokenIn: gs.ADDR.money, tokenOut: reg.token, fee: reg.route.fee, amountInWei: amtIn, quotedOutWei: quoted });
  out({ ok: true, tool: 'trade', mode: 'LIVE', tx: hash, plan });
})().catch(e => { out({ ok: false, tool: 'trade', error: e.message }); process.exit(1); });
