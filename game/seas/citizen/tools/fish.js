#!/usr/bin/env node
'use strict';
/**
 * fish.js — the FISHING (+ CRABBING) hand. CANONICAL LP MECHANIC (founder 2026-06-28, REVERTED):
 *
 *   "we decided the LP was right and NOT the harvest thing you made — they trade FLOW for FISH in the LP."
 *
 * UNIVERSAL JOB MECHANIC ([[project_seas_production_economy]]): a working pawn SWEEPS its WATER FLOW to
 * GOLD, and that GOLD BUYS the good from THAT LOCATION's gated LP, SKILL-SCALED (a higher-level hero
 * sweeps more flow → buys more per action). The pawn's flow is its productive capacity; the LOCATION LP
 * is the priced venue that turns gold into the good. This is NOT a free buy — it spends gold (the
 * swept-flow), it is presence-gated to the location, and the gap between a cheap source and a dear
 * destination is the player's transport income. (The earlier "skill-CATCH-from-flow harvest" — a
 * HarvestGround dispenser — is SUPERSEDED and OUT of this path. harvest.js is left in the tree but is
 * no longer used here.)
 *
 * FISHING (the loop):
 *   1) flow → GOLD : the pawn's WIS flow, swept to gold (the gold the bot holds = its swept flow).
 *   2) GOLD → FISH : BUY fish from the OCEAN LocationPool (loc 8004, presence-gated), skill-scaled —
 *                    higher WIS level sweeps more flow, so buys a larger notional per action.
 *   3) sail → PORT ROYAL : SELL the fish into the Port Royal LP (loc 8003) for the ~10x
 *                    (ocean ~0.1g/fish → Port Royal ~1g/fish). That spread is the fisher's wage.
 *   CRABBING: SHELVED (founder 2026-07-06). There are NO zero-capital income rails — "no pawn should
 *   have zero capital": pawns FIGHT to earn coin, get WATERED so capital flows, or ROW the ship for
 *   crew flow. The free crab dispenser was retired (seed recovered, ground paused); the crab command
 *   below returns the server's honest 503 until the founder designs the real crab flow.
 *
 *   node citizen/tools/fish.js                       # loop: ocean buy price + skill-scaled size + PR sell value (DRY)
 *   node citizen/tools/fish.js catch [--pawn d:t]    # DRY plan: flow→GOLD→buy fish at the ocean LP (skill-scaled)
 *   node citizen/tools/fish.js catch --execute       # LIVE buy (needs CITIZEN_ALLOW_LIVE=1, gold on hand, AT loc 8004)
 *   node citizen/tools/fish.js crab  [--pawn d:t]    # SHELVED by founder design — returns the server's honest 503
 *   node citizen/tools/fish.js sell  [--usd N]       # sell caught FISH dear at Port Royal (real buyer)
 *   node citizen/tools/fish.js sell  --execute       # LIVE sell (needs CITIZEN_ALLOW_LIVE=1 AND AT loc 8003)
 */
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const gs = require('../../gap-scan.js');
const chain = require('../lib/chain.js');
const seas = require('../lib/seas-api.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

const OCEAN_REC = path.join(__dirname, '..', '..', '..', '..', 'deploy', 'ocean-deployed.json');
const GOLD_USD = gs.COIN_USD.gold; // $0.01 anchor
const human = (wei, d = 18) => Number(ethers.formatUnits(wei, d));

// Skill vault (the readable on-chain skill signal today; same vault the jobs page trains).
const WIS_VAULT = '0x8C121fC0171944C3EA40d14FE549dFf7107BDf39'; // Sea-calling rites (WIS) — fishing/crabbing
const SOL_DEL_MAR = '0x9500880DEC9B310b4a728C75A271a25615A2443E'; // the fisher pawn collection

// ── Skill → buy-size scaling ───────────────────────────────────────────────────────────────────
// A pawn's flow is its productive capacity; a higher-level hero sweeps MORE flow → BUYS MORE per
// action. We scale the GOLD notional spent at the ocean LP by the WIS level, clamped to the toolbelt's
// hard per-trade USD caps (small + paced + exact). Skill-based, deterministic — never random.
const LEVEL_STEP = 0.5; // each WIS level adds 50% to the base notional (before the hard clamp)
function skillScaledUsd(level, baseUsd) {
  const raw = baseUsd * (1 + LEVEL_STEP * Math.max(0, level));
  return Math.min(chain.MAX_USD_PER_TRADE, Math.max(chain.MIN_USD_PER_TRADE, raw));
}

// LEVEL curve mirrors jobs/index.html: level n needs cumulative $ = 0.25*n*(n+1). Inverse → level.
// (Same curve harvest.js used; inlined here so the fish path no longer depends on the harvest module.)
function backingToLevel(backingUsd) {
  const n = Math.floor((-1 + Math.sqrt(1 + 16 * backingUsd)) / 2);
  return Math.max(0, n);
}
const WATERV2_SKILL_ABI = [
  'function treeIdFor(address,uint256) view returns (uint256)',
  'function treeWater(uint256) view returns (uint256)',
];
/** Read a pawn's WIS skill (treeWater → level) from the sea-calling vault. Unplanted → level 0. 6-dec. */
async function readSkill(collection, tokenId) {
  const v = new ethers.Contract(WIS_VAULT, WATERV2_SKILL_ABI, chain.provider());
  const idPlus = await v.treeIdFor(collection, tokenId);
  if (idPlus === 0n) return { level: 0, backingUsd: 0, planted: false };
  const water = await v.treeWater(idPlus - 1n);
  const backingUsd = Number(ethers.formatUnits(water, 6));
  return { level: backingToLevel(backingUsd), backingUsd, planted: true };
}

function loadOcean() {
  if (!fs.existsSync(OCEAN_REC)) throw new Error(`ocean deploy record missing at ${OCEAN_REC} — cannot fish`);
  return JSON.parse(fs.readFileSync(OCEAN_REC, 'utf8'));
}
/** Read a site's LocationPool + whether GOLD is token0 (so we know the swap direction). */
async function siteState(ocean, siteKey) {
  const s = ocean[siteKey];
  if (!s || !s.pool) throw new Error(`unknown site "${siteKey}" — known: ${Object.keys(ocean).filter((k) => ocean[k] && ocean[k].pool).join(', ')}`);
  const pool = await chain.readLocationPool(s.pool);
  const goldIsT0 = pool.token0.toLowerCase() === ocean.gold.toLowerCase();
  return { s, pool, goldIsT0 };
}
function parsePawn(str) {
  const i = String(str).lastIndexOf(':');
  if (i < 0) throw new Error(`bad pawn "${str}" — expected "distributor:tokenId"`);
  return { collection: ethers.getAddress(str.slice(0, i)), tokenId: str.slice(i + 1) };
}

(async () => {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const usdIdx = args.indexOf('--usd');
  const pawnIdx = args.indexOf('--pawn');
  const usdArg = usdIdx >= 0 ? Number(args[usdIdx + 1]) : null;
  const pawnArg = pawnIdx >= 0 ? args[pawnIdx + 1] : null;
  const action = (args.find((a, i) => !a.startsWith('--') && (usdIdx < 0 || i !== usdIdx + 1) && (pawnIdx < 0 || i !== pawnIdx + 1)) || 'loop').toLowerCase();

  const ocean = loadOcean();
  const FISH = ocean.fish;
  const GOLD = ocean.gold;
  const addr = chain.walletAddress();
  const fishOnHand = addr ? human(await chain.erc(FISH).balanceOf(addr), 18) : 0;
  const goldOnHand = addr ? human(await chain.erc(GOLD).balanceOf(addr), 18) : 0;
  const pawn = pawnArg ? parsePawn(pawnArg) : { collection: SOL_DEL_MAR, tokenId: '0' };

  // ── LOOP / READ: ocean buy price + skill-scaled buy + PR sell value (the ~10x) ──
  if (action === 'loop' || action === 'read') {
    const oceanS = await siteState(ocean, 'ocean');
    const pr = await siteState(ocean, 'portRoyal');
    const skill = await readSkill(pawn.collection, pawn.tokenId);
    const spendUsd = skillScaledUsd(skill.level, chain.MIN_USD_PER_TRADE);
    const goldSpend = spendUsd / GOLD_USD;
    // Buy quote at the ocean LP: GOLD in → FISH out (gold is token0 → zeroForOne = goldIsT0).
    const goldInWei = ethers.parseUnits(goldSpend.toFixed(18), 18);
    const fishOutWei = await chain.quoteLocationPool(oceanS.s.pool, oceanS.goldIsT0, goldInWei);
    const fishCaught = human(fishOutWei);
    // Sell quote at Port Royal: 1 FISH → GOLD.
    const goldPerFishPR = human(await chain.quoteLocationPool(pr.s.pool, !pr.goldIsT0, ethers.parseUnits('1', 18)));
    const sellGold = fishCaught * goldPerFishPR;
    out({
      ok: true, tool: 'fish', mode: 'LOOP', fisher: addr, pawn: `${pawn.collection}:${pawn.tokenId}`,
      onHand: { fish: fishOnHand, gold: goldOnHand },
      skill: { stat: 'WIS (sea-calling)', level: skill.level, backingUsd: skill.backingUsd, planted: skill.planted,
        scaling: `flow→gold spend = clamp(base $${chain.MIN_USD_PER_TRADE} * (1 + ${LEVEL_STEP}*level), $${chain.MIN_USD_PER_TRADE}..$${chain.MAX_USD_PER_TRADE})`,
        note: skill.planted ? 'read from the WIS job vault' : 'pawn has no WIS water yet → unskilled (smallest buy). Train WIS (jobs page) to fish bigger.' },
      buyAtOcean: { loc: oceanS.s.loc, pool: oceanS.s.pool, open: oceanS.pool.open, feeBps: oceanS.pool.feeBps,
        spendGold: Number(goldSpend.toFixed(4)), spendUsd: Number(spendUsd.toFixed(4)),
        fishCaught: Number(fishCaught.toFixed(4)), fishPerGold: Number((fishCaught / goldSpend).toFixed(4)),
        direction: 'GOLD → FISH', via: 'OCEAN LocationPool.swap (presence-gated, exact, paced)' },
      sellAtPortRoyal: { loc: pr.s.loc, pool: pr.s.pool, goldPerFish: Number(goldPerFishPR.toFixed(4)),
        projectedGold: Number(sellGold.toFixed(4)), projectedUsd: Number((sellGold * GOLD_USD).toFixed(4)) },
      grossMultiple: goldSpend > 0 ? Number((sellGold / goldSpend).toFixed(2)) : null,
      theLoop: '1) sail to the OCEAN fishing grounds — loc 8004, hex (8,4) [`sail.js 8 4`] → BUY fish from the ocean LP with swept-flow GOLD (skill-scaled) ; 2) sail to PORT ROYAL — loc 8003, hex (8,3) [`sail.js 8 3`] → SELL the fish dear into the PR LP. The ocean→PR price gap (~0.1g → ~1g) is the fisher\'s wage.',
      note: 'Read-only — ocean buy + PR sell quotes are LIVE on-chain. Catching = a GOLD→FISH swap at the ocean LP (presence-gated), skill-scaled. No HarvestGround/dispenser is involved (that model is superseded).',
    });
    return;
  }

  // ── CATCH (fish) / CRAB — flow→GOLD→buy-the-good-from-its-LOCATION-LP, presence-gated, skill-scaled ──
  // CATCH = a real GOLD→FISH swap at the OCEAN LocationPool (loc 8004). It is presence-gated exactly like
  // trade.js / the sell leg: we GO THROUGH the seas-server /seas/trade-attest gate (proves the pawn is AT
  // the ocean), then chain.swapLocationPool with the server's { expiry, sig }. We never forge presence.
  // CRAB is the SAME shape vs a BEACH crab LP — but no crab LP is deployed, so it's flagged PLANNED.
  if (action === 'catch' || action === 'crab') {
    const skill = await readSkill(pawn.collection, pawn.tokenId);
    const spendUsd = skillScaledUsd(skill.level, chain.MIN_USD_PER_TRADE);
    const goldSpend = spendUsd / GOLD_USD;
    const goldInWei = ethers.parseUnits(goldSpend.toFixed(18), 18);

    // CRAB — the FREE, zero-resource income path (founder 2026-07-01: "they need NOTHING to go
    // crabbing and make coin"). CRABBING IS A HARVEST, NOT A BUY: it uses the server-authoritative
    // CATCH dispenser (seas-server /seas/harvest → HarvestGround.dispense), so a poor peasant with NO
    // gold, NO gear, NO approval catches crabs for free — the ground releases the server-signed amount
    // to the pawn's owner. (This is the FISH-buy path's OPPOSITE: no GOLD is spent.) We ask the server
    // for a catch authorization; if the crab ground isn't deployed yet the server returns an honest
    // 503 (real-or-nothing — never a faked catch). The dispense itself is a gasless owner/relayer tx.
    if (action === 'crab') {
      const auth = addr ? await seas.harvest(addr, pawn.collection, pawn.tokenId, 'crab') : { ok: false, reason: 'no crabber wallet' };
      const ready = !!(auth && auth.ok && auth.authorization && auth.authorization.sig);

      if (!execute) {
        let would;
        if (!addr) would = 'NOTHING — no crabber wallet';
        else if (!ready) would = `NOTHING — ${auth.reason || auth.transport || 'no catch authorization'} (${auth.httpStatus || 'n/a'}). ${auth.status === 503 ? 'The crab beach ground / signer is unavailable on this host (signer key lives on the VPS).' : 'Sail to the crab beach — Bonewater Atoll, loc 2006, hex (2,6) [`sail.js 2 6`] — first.'}`;
        else would = `CATCH ${auth.catch.amount} CRAB for FREE at the beach ground (skill-scaled, cooldown-gated) — no gold, no gear. Trade-good progress you sell later for coin.`;
        out({
          ok: true, tool: 'fish', action: 'crab', mode: 'DRY',
          crabber: addr, pawn: `${pawn.collection}:${pawn.tokenId}`,
          skill: ready ? auth.skill : { stat: 'WIS', level: skill.level, backingUsd: skill.backingUsd, planted: skill.planted },
          catch: ready ? auth.catch : null,
          gate: { authorized: ready, serverBase: seas.BASE, detail: ready ? { ground: auth.ground, resource: auth.resource, supplyUnits: auth.supplyUnits } : { reason: auth.reason || auth.transport || 'unavailable', httpStatus: auth.httpStatus, status: auth.status } },
          free: true, executable: ready, would,
          note: 'DRY — no tx. CRAB = a FREE server-authoritative CATCH (HarvestGround.dispense), NOT a gold buy. Zero-resource income (founder). The crab beach ground is LIVE. Re-run with --execute (CITIZEN_ALLOW_LIVE=1, AT the crab beach — loc 2006, hex (2,6) [`sail.js 2 6`]) to dispense.',
        });
        return;
      }

      // ── LIVE: dispense the free crab catch against the server authorization ──
      if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 after founder approval');
      if (!chain.loadWallet()) throw new Error('no crabber wallet — run init-wallet.js + fund gas');
      if (!ready) throw new Error(`no catch authorization: ${auth.reason || auth.transport || 'unavailable'} (status ${auth.status || 'n/a'}) — must be AT the crab beach (loc 2006, hex (2,6) — sail 2 6) AND the crab ground live; NOT forging a catch.`);
      const a = auth.authorization;
      const hash = await chain.dispenseHarvest({ ground: a.ground, collection: a.collection, tokenId: a.tokenId, resource: a.resource, amount: a.amount, expiry: a.expiry, nonce: a.nonce, sig: a.sig });
      out({ ok: true, tool: 'fish', mode: 'LIVE', action: 'crab', crabber: addr, catch: auth.catch, tx: hash,
        note: 'LIVE — caught crabs for FREE (server-signed dispense; no gold, no gear). The catch is a trade good you sell later for coin.' });
      return;
    }

    // FISH catch — the ocean LP buy. Quote, presence-gate, then (live) swap.
    const oceanS = await siteState(ocean, 'ocean');
    const { s, pool, goldIsT0 } = oceanS;
    if (!pool.open) throw new Error(`ocean LP ${s.pool} is closed — cannot fish`);
    const zeroForOne = goldIsT0; // buying FISH = GOLD in (gold is token0 here)
    if (pool.maxSwapIn > 0n && goldInWei > pool.maxSwapIn) throw new Error(`buy input exceeds ocean LP maxSwapIn ${human(pool.maxSwapIn)}`);
    const fishOutWei = await chain.quoteLocationPool(s.pool, zeroForOne, goldInWei);
    if (!fishOutWei || fishOutWei === 0n) throw new Error('ocean LP quote returned 0 — buy side not filling; NOT faking it');
    const fishCaught = human(fishOutWei);
    const haveGold = goldOnHand >= goldSpend && goldSpend > 0;
    const attest = addr ? await seas.tradeAttest(addr, s.pool) : { ok: false, reason: 'no fisher wallet' };
    const attestOk = attest && attest.ok && attest.sig;
    const leg = { action: 'catch', site: 'ocean', pool: s.pool, location: s.loc,
      spendGold: Number(goldSpend.toFixed(4)), getFish: Number(fishCaught.toFixed(4)),
      direction: 'GOLD → FISH', zeroForOne };

    if (!execute) {
      let would;
      if (!addr) would = 'NOTHING — no fisher wallet';
      else if (!haveGold) would = `NOTHING — fisher holds ${goldOnHand} GOLD, needs ${goldSpend.toFixed(4)} (its swept-flow). Sweep more flow→gold first (the pawn's WIS flow funds the buy).`;
      else if (!attestOk) would = `priced + funded, but not gated in at the ocean (loc ${s.loc}): ${attest.reason || attest.transport || 'no attestation'}. Sail to the ocean grounds first; signer is on the VPS.`;
      else would = `BUY ${leg.getFish} FISH for ${leg.spendGold} GOLD at the ocean LP (presence-gated), then sail to Port Royal to SELL dear.`;
      out({
        ok: true, tool: 'fish', mode: 'DRY', action: 'catch', fisher: addr, pawn: `${pawn.collection}:${pawn.tokenId}`,
        onHand: { fish: fishOnHand, gold: goldOnHand },
        skill: { stat: 'WIS', level: skill.level, backingUsd: skill.backingUsd, planted: skill.planted,
          scaling: `spend $${chain.MIN_USD_PER_TRADE}*(1+${LEVEL_STEP}*level) clamped $${chain.MIN_USD_PER_TRADE}..$${chain.MAX_USD_PER_TRADE} = ${goldSpend.toFixed(4)} GOLD` },
        leg,
        gate: { attested: !!attestOk, serverBase: seas.BASE, detail: attestOk ? { location: attest.location, expiry: attest.expiry } : { reason: attest.reason || attest.transport || 'unavailable', httpStatus: attest.httpStatus } },
        haveGold, executable: !!(haveGold && attestOk), would,
        note: 'DRY — no tx. CATCH = a GOLD→FISH swap at the ocean LP (presence-gated, exact, paced), skill-scaled. Re-run with --execute (CITIZEN_ALLOW_LIVE=1, AT loc 8004, gold funded) to buy. Then `fish sell` at Port Royal.',
      });
      return;
    }

    // ── LIVE: buy fish from the ocean LP with swept-flow gold ──
    if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 after founder approval');
    if (!chain.loadWallet()) throw new Error('no fisher wallet — run init-wallet.js + fund');
    if (!haveGold) throw new Error(`not enough GOLD to fish: have ${goldOnHand}, need ${goldSpend.toFixed(4)} — sweep the pawn's WIS flow to gold first`);
    if (!attestOk) throw new Error(`location gate not satisfied: ${attest.reason || 'no attestation'} — must be AT the ocean grounds (loc ${s.loc}); NOT forging presence.`);
    const hash = await chain.swapLocationPool({ pool: s.pool, tokenIn: GOLD, zeroForOne, amountInWei: goldInWei, quotedOutWei: fishOutWei, expiry: attest.expiry, sig: attest.sig });
    const after = addr ? human(await chain.erc(FISH).balanceOf(addr), 18) : null;
    out({ ok: true, tool: 'fish', mode: 'LIVE', action: 'catch', fisher: addr, leg, tx: hash, fishOnHandAfter: after,
      note: 'LIVE — bought fish from the ocean LP with swept-flow gold (presence-gated, exact, paced). Now sail to Port Royal and SELL the catch dear.' });
    return;
  }

  // ── SELL caught fish at Port Royal (the dear-buyer leg — the ~10x) ──
  if (action === 'sell') {
    const usd = usdArg != null ? usdArg : chain.MIN_USD_PER_TRADE;
    const usdClamped = Math.min(chain.MAX_USD_PER_TRADE, Math.max(chain.MIN_USD_PER_TRADE, usd));
    const { s, pool, goldIsT0 } = await siteState(ocean, 'portRoyal');
    if (!pool.open) throw new Error(`Port Royal LP ${s.pool} is closed — cannot sell`);
    const zeroForOne = !goldIsT0; // selling FISH = fish in
    let fishToSell = usdClamped / GOLD_USD;
    if (fishOnHand > 0) fishToSell = Math.min(fishToSell, fishOnHand);
    const amountInWei = ethers.parseUnits(fishToSell.toFixed(18), 18);
    if (pool.maxSwapIn > 0n && amountInWei > pool.maxSwapIn) throw new Error(`sell input exceeds pool maxSwapIn ${human(pool.maxSwapIn)}`);
    const outWei = await chain.quoteLocationPool(s.pool, zeroForOne, amountInWei);
    if (!outWei || outWei === 0n) throw new Error('Port Royal LP quote returned 0 — sell side not filling; NOT faking it');
    const goldOut = human(outWei);
    const haveEnough = fishOnHand >= fishToSell && fishToSell > 0;
    const attest = addr ? await seas.tradeAttest(addr, s.pool) : { ok: false, reason: 'no fisher wallet' };
    const attestOk = attest && attest.ok && attest.sig;
    const leg = { action: 'sell', site: 'portRoyal', pool: s.pool, location: s.loc, sellFish: Number(fishToSell.toFixed(4)), getGold: Number(goldOut.toFixed(4)), direction: 'FISH → GOLD', zeroForOne };

    if (!execute) {
      let would;
      if (!addr) would = 'NOTHING — no fisher wallet';
      else if (!haveEnough) would = `NOTHING — fisher holds ${fishOnHand} FISH. CATCH fish first (buy from the ocean LP) — you can't sell what you haven't caught.`;
      else if (!attestOk) would = `priced + ready, but not gated in at Port Royal (loc ${s.loc}): ${attest.reason || 'no attestation'}. Sail to Port Royal first; signer is on the VPS.`;
      else would = `SELL ${leg.sellFish} FISH → ${leg.getGold} GOLD at Port Royal (real buyer)`;
      out({ ok: true, tool: 'fish', mode: 'DRY', action: 'sell', fisher: addr, fishOnHand, leg,
        gate: { attested: !!attestOk, serverBase: seas.BASE, detail: attestOk ? { location: attest.location, expiry: attest.expiry } : { reason: attest.reason || attest.transport || 'unavailable', httpStatus: attest.httpStatus } },
        haveEnough, executable: !!(haveEnough && attestOk), would,
        note: 'DRY — no tx. Selling caught fish at Port Royal is the dear-buyer leg (the ~10x). You can only sell fish you actually CAUGHT (bought at the ocean LP).' });
      return;
    }

    if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 after founder approval');
    if (!chain.loadWallet()) throw new Error('no fisher wallet — run init-wallet.js + fund');
    if (!haveEnough) throw new Error(`not enough FISH to sell: have ${fishOnHand}, need ${fishToSell.toFixed(2)} — CATCH first (buy at the ocean LP)`);
    if (!attestOk) throw new Error(`location gate not satisfied: ${attest.reason || 'no attestation'} — must be AT Port Royal (loc ${s.loc}); NOT forging presence.`);
    const hash = await chain.swapLocationPool({ pool: s.pool, tokenIn: FISH, zeroForOne, amountInWei, quotedOutWei: outWei, expiry: attest.expiry, sig: attest.sig });
    const after = await chain.balances(addr);
    out({ ok: true, tool: 'fish', mode: 'LIVE', action: 'sell', fisher: addr, leg, tx: hash, goldAfter: after ? after.gold : null });
    return;
  }

  throw new Error(`unknown action "${action}" — use: loop | catch | crab | sell. Fishing = flow→GOLD→buy-fish-from-the-ocean-LP (skill-scaled, presence-gated), then sell dear at Port Royal.`);
})().catch((e) => { out({ ok: false, tool: 'fish', error: e.message || String(e), hint: 'run `node citizen/tools/fish.js loop` to see flow-supply + your WIS skill + the catch/sell plan; catch/sell take --pawn <distributor:tokenId> and are location-gated (must be at the ocean / Port Royal).' }); process.exit(1); });
