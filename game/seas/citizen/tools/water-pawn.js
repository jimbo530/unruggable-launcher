#!/usr/bin/env node
'use strict';
/**
 * water-pawn.js (a.k.a. level-up) — spend USDC into a pawn's WaterV2 endowment to LEVEL IT UP. This is
 * the compounding loop's last hop: GOLD winnings → (convert) USDC → water a pawn → +level (and, on the
 * FLOW vault, +job-wage flow) → the leveled pawn earns more → repeat.
 *
 *   depositAndWater(treeIdFor(pawn), usdcAmount) on a WaterV2 vault. $1 USDC (1e6) = 1 water = 1 level.
 *   The deposit LOCKS the USDC as that pawn-tree's permanent backing — BY DESIGN this is the endowment
 *   (USDC → Aave; never withdrawn). The class-engine reads the LEVEL off the vault.
 *
 * TWO LIVE VAULTS, SAME ABI, DIFFERENT MEANING (verified on-chain 2026-06-28):
 *   --target level  (DEFAULT) → 0x9789…f8B2  generic WATER vault = class-engine base LEVEL only.
 *   --target flow             → 0x44c504Ce…  MayorVault = the Guard-the-Port JOB vault. Its harvest
 *                               buys cbBTC → 45% systems → the Mayor prize-pool tap = the JOB-WAGE
 *                               FLOW source. Watering HERE raises the job's backing/flow (water-crew.cjs
 *                               seeds it), NOT the generic class level. So: level ≠ flow. Pick the vault
 *                               for the effect you want (or water both, separately).
 *
 * READ mode (default): each addressed pawn's current water/level in the chosen vault + the USDC cost to
 *   add N levels (--levels N, default 1) + whether the Citizen holds enough USDC (and, if short, the
 *   convert-winnings.js funding hop to report — NOT auto-chained).
 * WATER mode (--execute): plant (idempotent) + depositAndWater for the chosen pawn. Gated by --execute
 *   AND CITIZEN_ALLOW_LIVE=1. Owner-checked, EXACT approval (never MaxUint), Aave-gas (600k), paced,
 *   real-or-nothing. Requires an explicit single --pawn (no wide watering).
 *
 *   node citizen/tools/water-pawn.js --pawn 0                       # READ: pawn #0 level + cost +1
 *   node citizen/tools/water-pawn.js --pawn 0 --levels 3            # READ: cost to add 3 levels
 *   node citizen/tools/water-pawn.js --pawn 0 --target flow         # READ: against the JOB/flow vault
 *   node citizen/tools/water-pawn.js --pawn 0 --levels 1 --execute  # LIVE water (needs CITIZEN_ALLOW_LIVE=1 + USDC)
 *
 * MONEY note: watering LOCKS the USDC forever (endowment). It is not a loss to the ecosystem (it backs
 * the pawn + earns Aave yield routed to prizes), but it IS irreversible for the wallet. Water deliberately.
 */
const { ethers } = require('ethers');
const chain = require('../lib/chain.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? null) : null; }
function has(name) { return process.argv.includes(name); }

const GUARD_COLL = '0x8C1f935F6DbB17d593BF3EC8114A2f045e350545'; // Harbor Guard crew (the Citizen's pawns)
const ONE_LEVEL_USDC = 1_000_000n; // $1 = 1 water = 1 level (USDC 6dec)

function vaultFor(target) {
  const t = (target || 'level').toLowerCase();
  if (t === 'level') return { addr: chain.WATER_LEVEL_VAULT, kind: 'level', desc: 'generic WATER vault — class-engine base LEVEL (does NOT pay job wages)' };
  if (t === 'flow' || t === 'job') return { addr: chain.WATER_FLOW_VAULT, kind: 'flow', desc: 'MayorVault (Guard-the-Port JOB vault) — backs JOB-WAGE FLOW (harvest→cbBTC→45% systems→Mayor prize tap), NOT the generic class level' };
  throw new Error(`--target must be "level" (0x9789, class level) or "flow"|"job" (0x44c5, job wages); got "${target}"`);
}

async function main() {
  const player = chain.walletAddress();
  if (!player) throw new Error('no Citizen wallet — run init-wallet.js (or set CITIZEN_WALLET_ENV / CITIZEN_KEY_NAME for a bot profile)');

  const v = vaultFor(flag('--target'));
  const levels = flag('--levels') ? Number(flag('--levels')) : 1;
  if (!Number.isFinite(levels) || levels <= 0) throw new Error('--levels must be a positive number');
  const collection = flag('--collection') ? ethers.getAddress(flag('--collection')) : GUARD_COLL;
  const pawnArg = flag('--pawn');
  if (pawnArg === null) throw new Error('pass --pawn <tokenId> (and optionally --target level|flow, --levels N)');
  const tokenId = Number(pawnArg);
  if (!Number.isInteger(tokenId) || tokenId < 0) throw new Error('--pawn must be a non-negative integer tokenId');
  const execute = has('--execute');

  const addUsdcWei = ONE_LEVEL_USDC * BigInt(levels);

  // Read current state (owner, current water/level, USDC balance).
  const nft = new ethers.Contract(collection, ['function ownerOf(uint256) view returns (address)'], chain.provider());
  let owner;
  try { owner = await nft.ownerOf(tokenId); } catch (e) { throw new Error(`pawn #${tokenId} ownerOf failed (${e.shortMessage || e.message}) — not minted/burned?`); }
  const ownerHeld = owner.toLowerCase() === player.toLowerCase();

  const cur = await chain.readWater(v.addr, collection, tokenId);
  const usdcBalWei = await chain.erc(chain.USDC_ADDR).balanceOf(player);
  const usdcBal = Number(ethers.formatUnits(usdcBalWei, 6));
  const haveEnough = usdcBalWei >= addUsdcWei;
  const shortfallUsdc = haveEnough ? 0 : Number(ethers.formatUnits(addUsdcWei - usdcBalWei, 6));

  const state = {
    vault: v.addr, vaultKind: v.kind, vaultDesc: v.desc,
    collection, tokenId, crewId: `${collection}:${tokenId}`,
    ownerHeldByCitizen: ownerHeld, owner,
    planted: cur.planted, treeId: cur.treeId !== null ? Number(cur.treeId) : null,
    currentWaterUsd: cur.waterUsd, currentLevel: cur.waterUsd, // $1 = 1 level
    addLevels: levels, addCostUsdc: Number(ethers.formatUnits(addUsdcWei, 6)),
    levelAfter: cur.waterUsd + levels,
    citizenUsdc: usdcBal, haveEnough,
  };

  // ── READ mode ──
  if (!execute) {
    const funding = haveEnough ? null : {
      shortfallUsdc,
      fundingHop: 'convert-winnings.js (cbBTC→USDC→Money→GOLD provides GOLD; for USDC specifically the cbBTC→USDC leg is the source). Run `node citizen/tools/convert-winnings.js` to size a batch — NOT auto-chained here.',
      note: `Citizen holds ${usdcBal} USDC; needs ${state.addCostUsdc} for ${levels} level(s). Short by ${shortfallUsdc} USDC. Fund first (cbBTC winnings → USDC), then re-run with --execute.`,
    };
    out({
      ok: true, tool: 'water-pawn', mode: 'READ', player,
      ...state,
      funding,
      vaultChoiceNote: 'level vs flow are DIFFERENT on-chain vaults: --target level (0x9789) raises the class-engine LEVEL only; --target flow (0x44c5) backs the JOB-WAGE FLOW. They do not affect each other. Water both (separately) if you want both effects.',
      lockNote: 'depositAndWater LOCKS the USDC as the pawn-tree endowment (Aave-backed, never withdrawn) — irreversible for the wallet by design.',
      executable: ownerHeld && haveEnough,
      would: !ownerHeld
        ? `NOTHING — pawn #${tokenId} is held by ${owner}, not the Citizen (${player}). Water only pawns you hold.`
        : haveEnough
          ? `water pawn #${tokenId} +${levels} level(s) = $${state.addCostUsdc} USDC into ${v.kind} vault (level ${cur.waterUsd} → ${state.levelAfter})`
          : `HOLD — need $${state.addCostUsdc} USDC, have $${usdcBal}. Fund via convert-winnings.js first.`,
      note: 'READ-ONLY — no transaction sent. Live needs --execute AND CITIZEN_ALLOW_LIVE=1, an owner-held pawn, and enough USDC.',
    });
    return;
  }

  // ── WATER (LIVE) ──
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
  if (!ownerHeld) throw new Error(`pawn #${tokenId} held by ${owner}, not the Citizen — refusing to water a pawn we don't hold`);
  if (!haveEnough) throw new Error(`insufficient USDC: have ${usdcBal}, need ${state.addCostUsdc} — fund via convert-winnings.js (cbBTC→USDC) first; short by ${shortfallUsdc} USDC`);

  const res = await chain.waterPawn({ vault: v.addr, collection, tokenId, usdcAmountWei: addUsdcWei });

  // Verify the new level on-chain (chain is truth).
  const after = await chain.readWater(v.addr, collection, tokenId);
  out({
    ok: true, tool: 'water-pawn', mode: 'LIVE', player,
    vault: v.addr, vaultKind: v.kind, collection, tokenId, crewId: `${collection}:${tokenId}`,
    plantTx: res.plantTx, waterTx: res.waterTx, treeId: Number(res.treeId),
    addedLevels: levels, spentUsdc: state.addCostUsdc,
    levelBefore: cur.waterUsd, levelAfter: after.waterUsd,
    note: `Watered pawn #${tokenId} into the ${v.kind} vault. USDC locked as endowment (Aave-backed). Verified on-chain level ${cur.waterUsd} → ${after.waterUsd}.`,
  });
}

main().catch((e) => { out({ ok: false, tool: 'water-pawn', error: e.message || String(e), hint: 'players should feed at the tavern (GOLD): `node citizen/tools/tavern.js --pawn <distributor:tokenId> --rounds N`. This tool is the USDC-side plumbing; needs --pawn <tokenId> + USDC on hand.' }); process.exit(1); });
