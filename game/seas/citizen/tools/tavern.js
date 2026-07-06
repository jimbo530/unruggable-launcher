#!/usr/bin/env node
'use strict';
/**
 * tavern.js — the PLAYER-FACING food & water rail. A player brings a pawn to the tavern and spends
 * GOLD to feed & water it; each round restores/levels the pawn. This is the piece the wage loop was
 * missing (the old GOLD→USDC hop nobody could see).
 *
 *   node citizen/tools/tavern.js --pawn <distributor:tokenId> --rounds N [--target level|flow] [--execute]
 *
 * PLAYER VIEW (founder: "the path should be gold at the tavern"): the player pays ~100 GOLD per round,
 * and each round is one feed+water = one level. The human summary talks ONLY in GOLD and levels —
 * the money plumbing underneath is the tavern-keeper's business, never the player's.
 *
 * BACKEND PLUMBING (operator-only, kept OUT of the player summary — founder: "USDC would be back end,
 * players never see it"). Three sequential on-chain legs, exact approvals, each leg's balance delta
 * verified before the next fires:
 *   A. GOLD → Money   — Uniswap V3 fee-100 gold wall pool 0x18A880F2 (the only GOLD venue; $0.01 anchor)
 *   B. Money → USDC   — Money.redeem() 1:1 vault redeem (Money's on-chain symbol reads "MfT" — branding)
 *   C. USDC → level   — WaterV2.depositAndWater(treeIdFor(pawn), usdc): $1 = 1 water = 1 level.
 *                       --target level (default) = class-engine LEVEL vault 0x9789…f8B2;
 *                       --target flow = MayorVault job-wage FLOW vault 0x44c5…3131F.
 *
 * DRY by default (quotes the whole GOLD→level chain + prints the plan). LIVE only with --execute AND
 * CITIZEN_ALLOW_LIVE=1. Wallet must OWN the pawn (ownerOf). Hard cap $5 of GOLD per run. If the gold
 * wall quote drifts >5% off the $0.01/GOLD anchor we STOP and report (never trade a broken price).
 * Real-or-nothing: every leg is verified on-chain; a failed leg is surfaced, never faked.
 */
const { ethers } = require('ethers');
const gs = require('../../gap-scan.js');
const chain = require('../lib/chain.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? null) : null; }
function has(name) { return process.argv.includes(name); }
function fail(error, hint) { out({ ok: false, tool: 'tavern', error, hint }); process.exit(1); }

const GOLD = gs.COIN_ADDR.gold;   // 18dec, $0.01 anchor
const MONEY = gs.ADDR.money;      // 6dec, USDC 1:1 receipt (on-chain symbol "MfT")
const USDC = gs.ADDR.usdc;        // 6dec
const POOL_GOLD_MONEY = '0x18A880F2EDe190B1dad8D11f8A22F1B273c16A08'; // GOLD's only venue (fee-100)
const FEE_GOLD_MONEY = 100;

const GOLD_PER_ROUND = 100;       // player pays ~100 GOLD per feed+water round (100 GOLD ≈ $1 ≈ 1 level)
const GOLD_USD = gs.COIN_USD.gold;         // $0.01 anchor (per-round ≈ GOLD_PER_ROUND × GOLD_USD ≈ $1)
const HARD_CAP_USD = 5;           // never move more than $5 of GOLD per run
const MONEY_REDEEM_ABI = ['function redeem(uint256 amount)'];
const MONEY_BACKING_ABI = ['function totalBacking() view returns (uint256)']; // aUSDC that backs redeem (6dec)
// MEMBRANE GATE (founder 2026-07-05): the tavern only serves while the Money membrane can back it.
// The wall must KEEP at least $1 of in-range Money AFTER the trade — the standing "Money-LP > $1"
// rule the hiring halls use (HIRING-HALL.md). Never drain the membrane below its floor.
const MEMBRANE_FLOOR_WEI = 1_000_000n;     // $1 (Money 6dec) the wall must retain after the trade
const COVER_TOL_NUM = 98n, COVER_TOL_DEN = 100n; // allow 2% for the 0.01% fee + minor slippage

/** distributor:tokenId → { collection, tokenId } (checksummed). Throws on garbage. */
function parsePawn(s) {
  if (typeof s !== 'string') throw new Error('pawn must be "distributor:tokenId"');
  const i = s.lastIndexOf(':');
  if (i < 0) throw new Error(`bad pawn "${s}" — expected "distributor:tokenId" (e.g. 0x8C1f…0545:7)`);
  const collection = ethers.getAddress(s.slice(0, i));
  const tokenId = s.slice(i + 1);
  if (tokenId === '' || !/^\d+$/.test(tokenId)) throw new Error(`bad tokenId in "${s}"`);
  return { collection, tokenId };
}

/** Pick the WaterV2 vault the levels flow into (matches water-pawn.js labels). */
function vaultFor(target) {
  const t = (target || 'level').toLowerCase();
  if (t === 'level') return { addr: chain.WATER_LEVEL_VAULT, kind: 'level' };
  if (t === 'flow' || t === 'job') return { addr: chain.WATER_FLOW_VAULT, kind: 'flow' };
  throw new Error(`--target must be "level" (default) or "flow"; got "${target}"`);
}

async function main() {
  const player = chain.walletAddress();
  if (!player) return fail('no wallet loaded', 'run citizen/tools/init-wallet.js, or set CITIZEN_WALLET_ENV / CITIZEN_KEY_NAME for a bot profile.');

  const pawnArg = flag('--pawn');
  if (!pawnArg) return fail('missing --pawn', 'pass --pawn <distributor:tokenId>. Run `node citizen/tools/pawns.js` to list your pawns (myCrewIds).');
  let collection, tokenId;
  try { ({ collection, tokenId } = parsePawn(pawnArg)); }
  catch (e) { return fail(e.message, 'the pawn id is "distributor:tokenId", e.g. 0x8C1f935F6DbB17d593BF3EC8114A2f045e350545:7 — get it from pawns.js myCrewIds.'); }

  const rounds = flag('--rounds') ? Number(flag('--rounds')) : 1;
  if (!Number.isInteger(rounds) || rounds <= 0) return fail(`--rounds must be a positive integer (got "${flag('--rounds')}")`, 'e.g. --rounds 1 to feed+water once (1 round = 1 level).');
  const v = vaultFor(flag('--target'));       // may throw → caught below
  const execute = has('--execute');

  const goldSpendHuman = rounds * GOLD_PER_ROUND;
  const goldInWei = ethers.parseUnits(goldSpendHuman.toString(), 18);

  // ── quote the whole chain: GOLD → Money (→ USDC 1:1 → levels 1:1) ──
  const moneyOutWei = await gs.quoteSingle(GOLD, MONEY, FEE_GOLD_MONEY, goldInWei);
  if (!moneyOutWei || moneyOutWei === 0n) {
    return fail('gold wall quote returned 0 — the GOLD venue is not filling right now', 'try again shortly; if it persists the gold/Money pool 0x18A880F2 needs a look (coordinator).');
  }
  const moneyOut = Number(ethers.formatUnits(moneyOutWei, 6));   // ≈ USD value of the GOLD spent
  const usdcOut = moneyOut;                                       // Money→USDC is 1:1
  const levelsGained = usdcOut;                                   // $1 = 1 level

  // ── MEMBRANE GATE (runs in BOTH dry + live, before any other check) ──
  // The tavern's stock IS the Money membrane. Three things must hold or the keeper has "no supplies":
  //   (a) the quoted Money out must COVER rounds × $1 (2% tol for the fee) — a drained wall under-fills;
  //   (b) the wall must KEEP ≥ $1 of Money AFTER the trade (never drain the membrane below its floor);
  //   (c) the redeem leg's backing (Money.totalBacking = aUSDC) must cover the redeem, so leg B can't
  //       fail halfway. Reads only; no approvals; refuses cleanly (out of stock) when any fails.
  const requiredMoneyWei = BigInt(rounds) * 1_000_000n;          // $1 per round the purchase must cover
  const wallMoneyWei = await chain.erc(MONEY).balanceOf(POOL_GOLD_MONEY); // wall's Money float = membrane depth
  let backingWei = 0n;
  try { backingWei = await new ethers.Contract(MONEY, MONEY_BACKING_ABI, chain.provider()).totalBacking(); }
  catch (e) { return fail(`could not read Money redeem backing (${e.shortMessage || e.message})`, 'the membrane backing read failed — try again shortly; not feeding blind.'); }
  const wallAfterWei = wallMoneyWei > moneyOutWei ? wallMoneyWei - moneyOutWei : 0n;
  const coversPurchase = moneyOutWei >= (requiredMoneyWei * COVER_TOL_NUM) / COVER_TOL_DEN;
  const keepsFloor = wallAfterWei >= MEMBRANE_FLOOR_WEI;
  const redeemOk = backingWei >= moneyOutWei;
  const wallUsd = Number(ethers.formatUnits(wallMoneyWei, 6));
  const backingUsd = Number(ethers.formatUnits(backingWei, 6));
  const perRoundUsd = GOLD_PER_ROUND * GOLD_USD;                 // ≈ $1
  // how many rounds the membrane can serve right now while keeping its $1 floor (planning hint)
  const availableRounds = Math.max(0, Math.floor(Math.min(wallUsd - 1, backingUsd) / perRoundUsd));
  const membrane = {
    _note: 'Money membrane capacity — the tavern serves only while this holds',
    moneyDepthUsd: Number(wallUsd.toFixed(4)),
    floorUsd: 1,
    redeemBackingUsd: Number(backingUsd.toFixed(2)),
    availableRounds,
    coversThisOrder: coversPurchase && keepsFloor && redeemOk,
    blocked: coversPurchase && keepsFloor && redeemOk ? null
      : { coversPurchase, keepsFloor, redeemOk },
  };
  if (!membrane.coversThisOrder) {
    out({
      ok: false, tool: 'tavern', mode: execute ? 'LIVE' : 'DRY',
      summary: `The tavern is short on supplies — the keeper can serve about ${availableRounds} round(s) right now, not ${rounds}.`,
      error: `the tavern is out of stock — the Money membrane can't cover ${rounds} rounds right now`,
      hint: 'try fewer rounds, or come back when the membrane refills',
      membrane,
    });
    process.exit(1);
  }

  // price sanity: 100 GOLD should buy ~1 Money ($0.01/GOLD). Drift >5% ⇒ STOP (never trade broken price).
  const moneyPerRound = moneyOut / rounds;
  const drift = Math.abs(moneyPerRound - 1) / 1;                  // 1.0 Money/round is the anchor
  if (drift > 0.05) {
    return fail(
      `gold wall price is off by ${(drift * 100).toFixed(1)}% from the $0.01/GOLD anchor (100 GOLD → ${moneyPerRound.toFixed(4)}, expected ~1.00)`,
      'the gold market moved — do NOT feed at a broken price. Flag the coordinator to check the gold/Money wall.');
  }

  // hard cap: never move more than $5 of GOLD in one run.
  if (usdcOut > HARD_CAP_USD + 1e-6) {
    return fail(`this run would spend ~$${usdcOut.toFixed(2)} of GOLD (${goldSpendHuman} GOLD) — over the $${HARD_CAP_USD}/run cap`,
      `lower --rounds (max ${Math.floor(HARD_CAP_USD / GOLD_PER_ROUND * 100)} at ${GOLD_PER_ROUND} GOLD/round ≈ $1 each).`);
  }

  // ── read current state: ownership, gold on hand, current level ──
  const nft = new ethers.Contract(collection, ['function ownerOf(uint256) view returns (address)'], chain.provider());
  let owner;
  try { owner = await nft.ownerOf(tokenId); }
  catch (e) { return fail(`pawn ${pawnArg} ownerOf failed (${e.shortMessage || e.message})`, 'check the pawn id — it may not be minted, or the distributor address is wrong.'); }
  const ownerHeld = owner.toLowerCase() === player.toLowerCase();

  const goldBalWei = await chain.erc(GOLD).balanceOf(player);
  const goldBal = Number(ethers.formatUnits(goldBalWei, 18));
  const haveGold = goldBalWei >= goldInWei;
  const cur = await chain.readWater(v.addr, collection, tokenId);

  // Player-facing summary — GOLD + levels ONLY. Money/USDC never appear here (founder: players never see it).
  const player_summary = {
    pawn: pawnArg,
    goldToSpend: goldSpendHuman,
    rounds,
    restores: `${rounds} feed+water round(s) at the tavern`,
    levelNow: cur.waterUsd,
    levelAfter: cur.waterUsd + Math.round(levelsGained),
    ownedByYou: ownerHeld,
    haveEnoughGold: haveGold,
    tavernStock: `about ${availableRounds} round(s) in stock right now (the tavern serves while supplies hold)`,
  };

  // Backend plumbing — OPERATOR-ONLY (kept out of the player summary above).
  const backend = {
    _note: 'internal plumbing — NOT shown to players',
    legA_goldToMoney: { pool: POOL_GOLD_MONEY, fee: FEE_GOLD_MONEY, goldIn: goldSpendHuman, moneyOut: Number(moneyOut.toFixed(6)) },
    legB_moneyToUsdc: { via: 'Money.redeem (1:1)', usdcOut: Number(usdcOut.toFixed(6)) },
    legC_water: { vault: v.addr, vaultKind: v.kind, usdcIn: Number(usdcOut.toFixed(6)), levelsAdded: Number(levelsGained.toFixed(6)) },
  };

  // ── DRY ──
  if (!execute) {
    let would;
    if (!ownerHeld) would = `NOTHING — that pawn belongs to ${owner}, not you. Bring a pawn you own to the tavern.`;
    else if (!haveGold) would = `HOLD — you have ${goldBal.toFixed(2)} GOLD, need ${goldSpendHuman} GOLD for ${rounds} round(s). Earn or convert more GOLD first.`;
    else would = `feed & water ${pawnArg}: spend ${goldSpendHuman} GOLD → +${Math.round(levelsGained)} level (level ${cur.waterUsd} → ${player_summary.levelAfter}).`;
    return out({
      ok: true, tool: 'tavern', mode: 'DRY', player,
      summary: `Tavern: ${goldSpendHuman} GOLD feeds & waters your pawn ${rounds} round(s) → +${Math.round(levelsGained)} level.`,
      tavern: player_summary,
      would,
      executable: ownerHeld && haveGold,
      membrane,
      backend,
      note: 'DRY — no GOLD spent. Re-run with --execute AND CITIZEN_ALLOW_LIVE=1 to feed for real. You must own the pawn and hold the GOLD. The tavern only serves while the Money membrane holds (see membrane.availableRounds).',
    });
  }

  // ── LIVE ──
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') return fail('live disabled', 'set CITIZEN_ALLOW_LIVE=1 (only after the founder funds + approves) to spend GOLD at the tavern.');
  if (!ownerHeld) return fail(`pawn ${pawnArg} is owned by ${owner}, not you`, 'feed only pawns you hold — bring one of your own to the tavern.');
  if (!haveGold) return fail(`not enough GOLD: have ${goldBal.toFixed(2)}, need ${goldSpendHuman}`, 'earn/convert more GOLD before feeding this many rounds.');
  const w = chain.loadWallet();
  if (!w) return fail('no wallet key loaded', 'run init-wallet.js + fund the wallet.');

  const money = chain.erc(MONEY);
  const usdc = chain.erc(USDC);

  // LEG A: GOLD → Money (exact approval + slippage inside chain.executeSwap). Verify Money delta.
  const moneyBefore = await money.balanceOf(w.address);
  const txA = await chain.executeSwap({ tokenIn: GOLD, tokenOut: MONEY, fee: FEE_GOLD_MONEY, amountInWei: goldInWei, quotedOutWei: moneyOutWei });
  const moneyAfter = await money.balanceOf(w.address);
  const moneyDelta = moneyAfter - moneyBefore;
  if (moneyDelta <= 0n) return fail(`leg A (GOLD→Money) produced no Money (tx ${txA})`, 'the gold swap did not deliver — check the tx on Basescan; nothing further was fired.');

  // LEG B: Money → USDC via Money.redeem(moneyDelta) — 1:1, no approval (burns own balance). Verify USDC delta.
  const usdcBefore = await usdc.balanceOf(w.address);
  const fees = { maxFeePerGas: ethers.parseUnits('0.2', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const nonce = await chain.provider().getTransactionCount(w.address, 'pending');
  const moneyC = new ethers.Contract(MONEY, MONEY_REDEEM_ABI, w);
  const txB = await moneyC.redeem(moneyDelta, { ...fees, nonce, gasLimit: 300000 });
  await txB.wait();
  const usdcAfter = await usdc.balanceOf(w.address);
  const usdcDelta = usdcAfter - usdcBefore;
  if (usdcDelta <= 0n) return fail(`leg B (Money→USDC redeem) produced no USDC (tx ${txB.hash})`, 'the redeem did not deliver USDC — check the tx; watering was NOT attempted.');

  // LEG C: USDC → water/level via chain.waterPawn (plants idempotently, exact USDC approval, owner-checked).
  const before = cur.waterUsd;
  const res = await chain.waterPawn({ vault: v.addr, collection, tokenId, usdcAmountWei: usdcDelta });
  const afterWater = await chain.readWater(v.addr, collection, tokenId);

  return out({
    ok: true, tool: 'tavern', mode: 'LIVE', player,
    summary: `Fed & watered ${pawnArg} at the tavern: spent ${goldSpendHuman} GOLD → level ${before} → ${afterWater.waterUsd}.`,
    tavern: {
      pawn: pawnArg, goldSpent: goldSpendHuman, rounds,
      levelBefore: before, levelAfter: afterWater.waterUsd, vaultKind: v.kind,
    },
    backend: {
      _note: 'internal plumbing — NOT shown to players',
      txGoldToMoney: txA, moneyReceived: Number(ethers.formatUnits(moneyDelta, 6)),
      txMoneyToUsdc: txB.hash, usdcReceived: Number(ethers.formatUnits(usdcDelta, 6)),
      plantTx: res.plantTx, waterTx: res.waterTx, treeId: Number(res.treeId),
    },
    note: 'Verified on-chain each leg. GOLD spent at the tavern; the pawn is fed & leveled.',
  });
}

main().catch((e) => { out({ ok: false, tool: 'tavern', error: e.message, hint: 'unexpected failure — re-run DRY (drop --execute) to see the quoted plan, or check the pawn id and GOLD balance.' }); process.exit(1); });
