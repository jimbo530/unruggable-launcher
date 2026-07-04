#!/usr/bin/env node
'use strict';
/**
 * quote.js — quote ONE Uniswap V3 route (read-only) and print JSON. The agent's "what would I get?"
 * tool. Accepts token SYMBOLS (money, usdc, gold, silver, copper, mft, or any good id like
 * emerald/salt) or raw 0x addresses. Tries the given fee, else scans common tiers and picks the
 * first that fills. Never trades.
 *
 *   node citizen/tools/quote.js money gold 0.02
 *   node citizen/tools/quote.js gold emerald 2 100
 */
const { ethers } = require('ethers');
const gs = require('../../gap-scan.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

// symbol → {addr, dec}
function resolve(sym) {
  const s = String(sym).toLowerCase();
  if (s.startsWith('0x') && s.length === 42) return { addr: ethers.getAddress(s), dec: 18, sym };
  const known = {
    money: { addr: gs.ADDR.money, dec: 6 }, usdc: { addr: gs.ADDR.usdc, dec: 6 },
    mft: { addr: gs.ADDR.mftMeme, dec: 18 },
    gold: { addr: gs.COIN_ADDR.gold, dec: 18 }, silver: { addr: gs.COIN_ADDR.silver, dec: 18 }, copper: { addr: gs.COIN_ADDR.copper, dec: 18 },
  };
  if (known[s]) return { ...known[s], sym: s };
  // goods from the live registry
  const reg = gs.loadRegistry();
  const hit = reg.find(t => t.id === s || t.sym.toLowerCase() === s);
  if (hit) return { addr: hit.token, dec: 18, sym: hit.sym };
  throw new Error(`unknown token "${sym}" — use money|usdc|gold|silver|copper|mft, a good id, or a 0x address`);
}

(async () => {
  const [inArg, outArg, amtArg, feeArg] = process.argv.slice(2);
  if (!inArg || !outArg || !amtArg) throw new Error('usage: quote.js <tokenIn> <tokenOut> <amountHuman> [fee]');
  const tin = resolve(inArg), tout = resolve(outArg);
  const amountIn = ethers.parseUnits(String(amtArg), tin.dec);
  const fees = feeArg ? [Number(feeArg)] : [100, 500, 3000, 10000];

  for (const fee of fees) {
    const o = await gs.quoteSingle(tin.addr, tout.addr, fee, amountIn);
    if (o && o > 0n) {
      const amountOut = Number(ethers.formatUnits(o, tout.dec));
      const inHuman = Number(amtArg);
      out({
        ok: true, tool: 'quote',
        tokenIn: tin.sym, tokenInAddr: tin.addr, tokenOut: tout.sym, tokenOutAddr: tout.addr,
        fee, amountIn: inHuman, amountOut,
        pricePerOut: amountOut > 0 ? inHuman / amountOut : null,
        route: `${tin.sym}→${tout.sym} fee${fee}`,
      });
      return;
    }
  }
  out({ ok: false, tool: 'quote', error: `no V3 pool filled for ${tin.sym}→${tout.sym} at fees [${fees}]`, note: 'pair may be LocationPool-gated or a custom AMM (use scan-gaps for those)' });
  process.exit(1);
})().catch(e => { out({ ok: false, tool: 'quote', error: e.message }); process.exit(1); });
