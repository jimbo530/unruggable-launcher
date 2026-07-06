#!/usr/bin/env node
'use strict';
/**
 * convert-winnings.js — the Citizen's core income→build cycle: turn the Guards' cbBTC winnings
 * (the Guard achievement ladder pays cbBTC) into in-game GOLD = its building capital.
 *
 * THE REAL ROUTE (verified on-chain 2026-06-27 — see findings; differs from the brief):
 *   cbBTC --(Uniswap V3 fee500, deep)--> USDC --(Money.deposit, 1:1 MINT)--> Money
 *         --(Uniswap V3 fee100 pool 0x18A880F2)--> GOLD
 * Notes proven by factory getPool + QuoterV2:
 *   • cbBTC/Money has NO pool at any fee tier — the liquid leg is cbBTC/USDC (fee500 liq≈2.4e12).
 *     USDC→Money is the 1:1 mint, not a swap. So this is a 3-step route, NOT one Uniswap multi-hop.
 *   • GOLD's ONLY on-chain venue is the fee100 pool 0x18A880F2 (liq≈2e20); GOLD/USDC, GOLD/WETH,
 *     and GOLD/Money@other-tiers do NOT exist. It fills at the $0.01 anchor both ways. (The
 *     "near-zero wall" caution applies to the copper/silver coin-waters, not this GOLD market —
 *     and there is no alternative GOLD route regardless. Flagged in findings for reconciliation.)
 *
 * TRIGGER (founder-pinned): this is a WINNINGS BATCH, not a gap-trade — it is NOT bound by the
 * ≤$0.25 gap rail. Convert WHENEVER the Citizen holds ≥ $10 of cbBTC, batching the whole ~$10
 * through in one pass. Founder hard-stop above $50/run (pause + ask).
 *
 * SAFETY: EXACT approvals ; 2% slippage guard on each swap ; legs paced at 0.15 gwei (Base) ;
 * Money.deposit supplies to Aave and needs ~600k gas (200k starves it — learned the hard way) ;
 * real-or-nothing (if any leg won't fill we say so, never fake). DRY by default — broadcasts only
 * with --execute AND CITIZEN_ALLOW_LIVE=1. Operates on cbBTC in the CITIZEN's own wallet.
 *
 *   node citizen/tools/convert-winnings.js               # DRY: threshold-batch plan (whole balance if ≥$10)
 *   node citizen/tools/convert-winnings.js --usd 10      # DRY: quote a $10 batch (proof the path fills)
 *   node citizen/tools/convert-winnings.js --cbbtc 0.000165
 *   node citizen/tools/convert-winnings.js --execute     # live threshold-batch (needs CITIZEN_ALLOW_LIVE=1)
 */
const { ethers } = require('ethers');
const gs = require('../../gap-scan.js');
const chain = require('../lib/chain.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

const ADDR = {
  cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', // 8 dec
  usdc:  gs.ADDR.usdc,   // 6 dec
  money: gs.ADDR.money,  // 6 dec
  gold:  gs.COIN_ADDR.gold, // 18 dec
};
const FEE_CBBTC_USDC = 500;  // deepest cbBTC/USDC pool (0xfBB6Eed8…)
const FEE_MONEY_GOLD = 100;  // GOLD's only venue: 0x18A880F2
const POOL_CBBTC_USDC = '0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef';
const POOL_MONEY_GOLD = '0x18A880F2EDe190B1dad8D11f8A22F1B273c16A08';
const THRESHOLD_USD = Number(process.env.CITIZEN_WINNINGS_THRESHOLD_USD || 10); // convert once cbBTC ≥ this
const HARD_STOP_USD = 50;    // founder-gate above this (memory: stop at the big stuff)
const DEPOSIT_GAS = 600000n; // Money.deposit supplies to Aave — needs ~600k (200k starves it)
const MONEY_ABI = ['function deposit(uint256 amount)'];

/** Read-only: quote the FULL cbBTC→GOLD path for a given cbBTC input. Returns null leg if it won't fill. */
async function quotePath(cbbtcHuman) {
  const cbbtcWei = ethers.parseUnits(cbbtcHuman.toFixed(8), 8);
  // leg 1: cbBTC → USDC
  const usdcWei = await gs.quoteSingle(ADDR.cbBTC, ADDR.usdc, FEE_CBBTC_USDC, cbbtcWei);
  if (!usdcWei || usdcWei === 0n) return { ok: false, failedLeg: 'cbBTC→USDC', cbbtcIn: cbbtcHuman };
  // leg 2: USDC → Money is a 1:1 mint (Money.deposit) — no slippage, same 6 dec.
  const moneyWei = usdcWei;
  // leg 3: Money → GOLD
  const goldWei = await gs.quoteSingle(ADDR.money, ADDR.gold, FEE_MONEY_GOLD, moneyWei);
  if (!goldWei || goldWei === 0n) return { ok: false, failedLeg: 'Money→GOLD', cbbtcIn: cbbtcHuman };

  const usdc = Number(ethers.formatUnits(usdcWei, 6));
  const gold = Number(ethers.formatUnits(goldWei, 18));
  return {
    ok: true,
    cbbtcIn: cbbtcHuman,
    legs: [
      { step: 'cbBTC→USDC', dex: `Uniswap V3 fee${FEE_CBBTC_USDC}`, pool: POOL_CBBTC_USDC, out: `${usdc} USDC` },
      { step: 'USDC→Money', dex: 'Money.deposit (1:1 mint)', pool: ADDR.money, out: `${usdc} Money` },
      { step: 'Money→GOLD', dex: `Uniswap V3 fee${FEE_MONEY_GOLD}`, pool: POOL_MONEY_GOLD, out: `${gold} GOLD` },
    ],
    usdValue: usdc,
    goldOut: gold,
    effectiveGoldPerCbbtc: gold / cbbtcHuman,
    impliedCbbtcUsd: cbbtcHuman > 0 ? usdc / cbbtcHuman : null, // ~ cbBTC market price
  };
}

(async () => {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const usdIdx = args.indexOf('--usd');
  const cbbtcIdx = args.indexOf('--cbbtc');

  // Reference price to size a USD-denominated run (quote a tiny fixed amount first).
  const refCbbtc = 0.00001; // ~$0.60
  const ref = await quotePath(refCbbtc);
  if (!ref.ok) { out({ ok: false, tool: 'convert-winnings', error: `route leg failed: ${ref.failedLeg}`, hint: 'the cbBTC→USDC→Money→GOLD path has a leg that will not fill right now — wait and retry; not faking a route.' }); process.exit(1); }
  const cbbtcUsd = ref.impliedCbbtcUsd; // USD per 1 cbBTC

  // Decide the cbBTC amount for THIS run.
  const addr = chain.walletAddress();
  const bal = addr ? await chain.balances(addr) : null;
  const cbbtcBalWei = addr ? await chain.erc(ADDR.cbBTC).balanceOf(addr) : 0n;
  const cbbtcBal = Number(ethers.formatUnits(cbbtcBalWei, 8));

  let cbbtcAmount, sizing;
  if (cbbtcIdx >= 0) { cbbtcAmount = Number(args[cbbtcIdx + 1]); sizing = 'cbbtc-arg'; }
  else if (usdIdx >= 0) { cbbtcAmount = Number(args[usdIdx + 1]) / cbbtcUsd; sizing = 'usd-arg'; }
  else { cbbtcAmount = cbbtcBal; sizing = 'threshold-batch'; } // default: batch the whole balance

  const runUsd = cbbtcAmount * cbbtcUsd;
  // Founder hard-stop: never auto-move more than $50 in one run.
  if (runUsd > HARD_STOP_USD) { out({ ok: false, tool: 'convert-winnings', error: `run is $${runUsd.toFixed(2)} > $${HARD_STOP_USD} hard stop — founder-gated`, hint: `pass a smaller --usd/--cbbtc (≤ $${HARD_STOP_USD}) or ask the founder before moving this much.`, cbbtcMarketUsd: Number(cbbtcUsd.toFixed(2)) }); process.exit(1); }
  // Threshold gate (only on the auto path; explicit --usd/--cbbtc are allowed for testing).
  const belowThreshold = sizing === 'threshold-batch' && runUsd < THRESHOLD_USD;

  const plan = await quotePath(cbbtcAmount > 0 ? cbbtcAmount : THRESHOLD_USD / cbbtcUsd); // show a $10 quote even at 0 balance
  const haveEnough = cbbtcBal >= cbbtcAmount && cbbtcAmount > 0;

  if (!execute) {
    let would;
    if (belowThreshold) would = `HOLD — $${runUsd.toFixed(2)} cbBTC < $${THRESHOLD_USD} threshold; accumulate more winnings before converting.`;
    else if (!haveEnough) would = `NOTHING — wallet holds ${cbbtcBal} cbBTC ($${(cbbtcBal * cbbtcUsd).toFixed(2)}). Route Guard winnings here first.`;
    else would = `convert ${cbbtcAmount.toExponential(4)} cbBTC ($${runUsd.toFixed(2)}) → ~${plan.goldOut.toFixed(2)} GOLD via cbBTC→USDC→Money→GOLD`;
    out({
      ok: true, tool: 'convert-winnings', mode: 'DRY',
      wallet: addr, cbbtcBalance: cbbtcBal, cbbtcBalanceUsd: Number((cbbtcBal * cbbtcUsd).toFixed(2)), balances: bal,
      cbbtcMarketUsd: Number(cbbtcUsd.toFixed(2)),
      trigger: { thresholdUsd: THRESHOLD_USD, met: cbbtcBal * cbbtcUsd >= THRESHOLD_USD, hardStopUsd: HARD_STOP_USD },
      run: { sizing, cbbtcIn: cbbtcAmount, usdValue: Number(runUsd.toFixed(4)) },
      quote: plan,
      effectiveGoldPerCbbtc: plan.ok ? plan.effectiveGoldPerCbbtc : null,
      executable: haveEnough && !belowThreshold,
      would,
      note: 'DRY — no tx sent. Live needs --execute AND CITIZEN_ALLOW_LIVE=1 after funding. The `quote` above is sized to a $10 batch even at 0 balance so the path is proven real. cbBTC must sit in the Citizen wallet (Guard winnings currently accrue to the treasury that holds the Guard pawns — routing them to the Citizen wallet is a separate founder-gated step).',
    });
    return;
  }

  // LIVE — every guard must pass.
  if (!plan.ok) throw new Error(`route leg failed: ${plan.failedLeg} — refusing`);
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 after founder approval');
  if (!chain.loadWallet()) throw new Error('no Citizen wallet — run init-wallet.js + fund');
  if (belowThreshold) throw new Error(`below $${THRESHOLD_USD} threshold ($${runUsd.toFixed(2)}) — hold winnings, do not convert dust`);
  if (!haveEnough) throw new Error(`not enough cbBTC: have ${cbbtcBal}, need ${cbbtcAmount}`);

  const w = chain.loadWallet();
  const cbbtcWei = ethers.parseUnits(cbbtcAmount.toFixed(8), 8);

  // Step 1: cbBTC → USDC (exact approval + slippage via chain.executeSwap)
  const usdcQuoted = await gs.quoteSingle(ADDR.cbBTC, ADDR.usdc, FEE_CBBTC_USDC, cbbtcWei);
  const tx1 = await chain.executeSwap({ tokenIn: ADDR.cbBTC, tokenOut: ADDR.usdc, fee: FEE_CBBTC_USDC, amountInWei: cbbtcWei, quotedOutWei: usdcQuoted });

  // Step 2: USDC → Money (mint 1:1). Approve exact USDC to Money, then deposit.
  const usdcBal = await chain.erc(ADDR.usdc).balanceOf(w.address); // mint exactly what we just received
  const fees = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const nonceRef = { n: await chain.provider().getTransactionCount(w.address, 'pending') };
  await chain.ensureAllowance(ADDR.usdc, ADDR.money, usdcBal, fees, nonceRef);
  const money = new ethers.Contract(ADDR.money, MONEY_ABI, w);
  const txm = await money.deposit(usdcBal, { ...fees, nonce: nonceRef.n++, gasLimit: DEPOSIT_GAS });
  await txm.wait();

  // Step 3: Money → GOLD
  const moneyBal = await chain.erc(ADDR.money).balanceOf(w.address);
  const goldQuoted = await gs.quoteSingle(ADDR.money, ADDR.gold, FEE_MONEY_GOLD, moneyBal);
  const tx3 = await chain.executeSwap({ tokenIn: ADDR.money, tokenOut: ADDR.gold, fee: FEE_MONEY_GOLD, amountInWei: moneyBal, quotedOutWei: goldQuoted });

  out({ ok: true, tool: 'convert-winnings', mode: 'LIVE', txs: { cbbtcToUsdc: tx1, usdcToMoney: txm.hash, moneyToGold: tx3 }, cbbtcIn: cbbtcAmount, goldOut: plan.goldOut });
})().catch((e) => { out({ ok: false, tool: 'convert-winnings', error: e.message || String(e), hint: 'run DRY (no --execute) to see the cbBTC→GOLD quote; needs cbBTC winnings in the wallet and a filling route. Live needs --execute AND CITIZEN_ALLOW_LIVE=1.' }); process.exit(1); });
