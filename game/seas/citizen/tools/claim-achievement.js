#!/usr/bin/env node
'use strict';
/**
 * claim-achievement.js — the CITIZEN-side half of the achievement payout: call claim(id, collection,
 * tokenId) on a PrizePool for a rung that is ATTESTED + EARNED + unclaimed, so the GOLD reward lands
 * on the pawn's owner (the Citizen). This is step 2 of the two-step the contract enforces:
 *
 *     1) HOUSE (admin = treasury 0xE2a4…)  attest(id, collection, tokenId, true)   ← NOT this tool
 *     2) OWNER (the Citizen)               claim(id, collection, tokenId)           ← THIS tool
 *
 * The PrizePool (verified against mftusd-build/PrizePool.sol) registers the Guard-the-Port rungs as
 * eligMode = ADMIN_ATTESTED, RewardType = BPS_OF_POOL @ 100bps (1% of the LIVE pool balance), and
 * oneTimePerNFT. Because the rungs are one-time, the contract REQUIRES `msg.sender == ownerOf(tokenId)`
 * for claim() (anti-grief). So a player-held pawn can ONLY be claimed by its owner — exactly the
 * Citizen's job here. The house cannot claim a Citizen-held pawn on its behalf; it can only attest.
 *
 * READ mode (default): for each of the Citizen's pawns, list which rungs are EARNED (run >= threshold),
 *   ATTESTED on-chain by the house, and NOT YET claimed → the GOLD it would pay right now (1% of the
 *   live pool). It also surfaces rungs that are EARNED but NOT attested ("blocked on the house attest").
 * CLAIM mode (--execute): claim those eligible rungs from the CITIZEN wallet. Triple-checked on-chain
 *   first (owner-held + attested + active + not claimed + pool can cover) so we never send revert-bait.
 *   Gated by --execute AND CITIZEN_ALLOW_LIVE=1. Paced, explicit nonces, await each, resume-safe via the
 *   on-chain hasClaimed gate, real-or-nothing (a revert is printed, never faked, never silently caught).
 *
 *   node citizen/tools/claim-achievement.js                         # READ: all eligible GOLD claims
 *   node citizen/tools/claim-achievement.js --line GOLD --rung 1001 # READ: a specific line/rung
 *   node citizen/tools/claim-achievement.js --pawns 0,1,2           # READ/CLAIM only these guard tokenIds
 *   node citizen/tools/claim-achievement.js --execute --pawns 0     # LIVE claim (needs CITIZEN_ALLOW_LIVE=1)
 *
 * MONEY-LEAK GUARD: every claim pays 1% of the LIVE pool balance, so N claims drain ~N% of the pool
 * (compounding down). This tool will NOT auto-claim a wide set — it requires an EXPLICIT --pawns list
 * in --execute mode and caps the batch (default 5, --max N) so a single run can never empty the pool.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const chain = require('../lib/chain.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? null) : null; }
function has(name) { return process.argv.includes(name); }

// ── The Guard-the-Port crew + WorkClock job target (the rung is earned by TIME on this job) ──
const GUARD_COLL = '0x8C1f935F6DbB17d593BF3EC8114A2f045e350545'; // Harbor Guard crew
const GUARD_TARGET = '0x44c504Ce08635536635f153B6Ae5d9D6d8b3131F'; // Guard-the-Port job (WorkClock target)
const WORKCLOCK = '0xE5DE012B9123C8594abb032471b6E7511f0bC601';
const HOUSE = '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10'; // pool admin (does the attest step)

// Rungs (ids 1001-1006) → time threshold + which tier pool holds the prize. Mirrors
// achievement-claim-fire.cjs / guard-ladder-keeper.cjs. We still re-read each rung's on-chain
// existence/active state — this table only maps id→tier, it is never trusted for eligibility.
const RUNGS = [
  { id: 1001, secs: 86400,    tier: 'Mayor',     label: '1d' },
  { id: 1002, secs: 604800,   tier: 'Mayor',     label: '1w' },
  { id: 1003, secs: 2592000,  tier: 'Lord',      label: '1mo' },
  { id: 1004, secs: 7776000,  tier: 'PettyKing', label: '3mo' },
  { id: 1005, secs: 15552000, tier: 'HighKing',  label: '6mo' },
  { id: 1006, secs: 31536000, tier: 'Emperor',   label: '1yr' },
];

// cbBTC tier pools are typed in the keepers (no deploy-json for the BTC rogue line); GOLD/ETH come
// from the deploy record (never typed). Default LINE=GOLD = the civic Guard-the-Port reward.
const BTC_POOLS = {
  Mayor: '0xB10fbbCB67d68d1f43E566089FFa0f36Bd057193',
  Lord: '0x4cC809378135F9501e37532dFDF3df6aED2B3342',
  PettyKing: '0x1D6dA6b28a62A45588411eEE66C94AC951A461D2',
  HighKing: '0x2983E3d4250d01ba05013F1E9995Cd457D7aBa65',
  Emperor: '0xF3dA6a1D7d1a57F4E4782213D831646C7E45d6B0',
};
// GOLD-line fallback ONLY if the mftusd-build deploy record is unreachable (e.g. the sibling repo
// moved). Verified against prize-ladders-deployment.json AND on-chain (pool.admin()==house 0xE2a4,
// pool.cbBtc()==GOLD 0x2065d87b) on 2026-06-28. The deploy record is still preferred (read first).
const GOLD_POOLS_FALLBACK = {
  Mayor: '0xC76A9F461Be6253BD8676e0db41A6b2E03e318F8',
  Lord: '0x684698ae06Bba12bEf5e7684d8ed466AFD841F5A',
  PettyKing: '0x6C3208D0a637eB2a993AA60bF9838b39D218F2e7',
  HighKing: '0x784D25403f0677A4EB29dD4d8e2887c6Bf9341C3',
  Emperor: '0x5DFfBF9B20b7A1d7155d54C8c750BF60d4CdE5B4',
};

const POOL_ABI = [
  'function admin() view returns (address)',
  'function cbBtc() view returns (address)', // the prize token (named cbBtc even on GOLD/ETH pools)
  'function achievements(uint256) view returns (bool exists,bool active,uint8 rt,uint256 amt,uint8 em,bool one,uint8 tier,address cond,uint256 thr)',
  'function attested(uint256, bytes32) view returns (bool)',
  'function hasClaimed(uint256, address, uint256) view returns (bool)',
  'function poolBalance() view returns (uint256)',
  'function claim(uint256 achievementId, address collection, uint256 tokenId) external',
];
const WC_ABI = [
  'function currentTarget(address,uint256) view returns (address)',
  'function currentRun(address,uint256) view returns (uint256)',
];
const ERC20_ABI = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
const ERC721_ABI = ['function ownerOf(uint256) view returns (address)'];

const keyOf = (c, t) => ethers.solidityPackedKeccak256(['address', 'uint256'], [c, t]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolve the tier→pool map for a line. GOLD/ETH read the deploy record (preferred source of truth);
 *  BTC is the typed rogue set; GOLD has a verified fallback if the sibling deploy record is missing. */
function poolsForLine(line) {
  if (line === 'BTC') return { ...BTC_POOLS };
  const recPath = path.join(__dirname, '..', '..', '..', '..', '..', 'mftusd-build', 'prize-ladders-deployment.json');
  if (fs.existsSync(recPath)) {
    const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    const out_ = {};
    for (const tier of ['Mayor', 'Lord', 'PettyKing', 'HighKing', 'Emperor']) {
      const e = rec.pools[`${line}-${tier}`];
      if (!e || !e.prizePool) throw new Error(`deploy record missing ${line}-${tier} in ${recPath}`);
      out_[tier] = ethers.getAddress(e.prizePool);
    }
    return out_;
  }
  if (line === 'GOLD') return Object.fromEntries(Object.entries(GOLD_POOLS_FALLBACK).map(([t, a]) => [t, ethers.getAddress(a)]));
  throw new Error(`deploy record not found at ${recPath} and no verified fallback for line ${line} — cannot resolve pools (never typing addresses)`);
}

async function main() {
  const player = chain.walletAddress();
  if (!player) throw new Error('no Citizen wallet — run init-wallet.js (or set CITIZEN_WALLET_ENV / CITIZEN_KEY_NAME for a bot profile)');
  const provider = chain.provider();

  const line = (flag('--line') || process.env.SEAS_ACHV_LINE || 'GOLD').toUpperCase();
  const onlyRung = flag('--rung') ? Number(flag('--rung')) : null;
  const execute = has('--execute');
  const maxBatch = flag('--max') ? Number(flag('--max')) : 5; // money-leak cap: small batch per run
  // which guard tokenIds to consider (default 0-69 — the Citizen's guard set).
  const pawnsArg = flag('--pawns');
  const pawnIds = pawnsArg
    ? String(pawnsArg).split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n))
    : Array.from({ length: 70 }, (_, i) => i);

  const LP = poolsForLine(line);
  const wc = new ethers.Contract(WORKCLOCK, WC_ABI, provider);
  const nft = new ethers.Contract(GUARD_COLL, ERC721_ABI, provider);

  // pool metadata cache (admin, token, decimals, symbol, live balance).
  const poolCache = new Map();
  async function getPool(tier) {
    const addr = LP[tier];
    const kk = addr.toLowerCase();
    if (poolCache.has(kk)) return poolCache.get(kk);
    const ro = new ethers.Contract(addr, POOL_ABI, provider);
    const admin = await ro.admin();
    const token = await ro.cbBtc();
    const erc = new ethers.Contract(token, ERC20_ABI, provider);
    const [symbol, decimals, balance] = [
      await erc.symbol().catch(() => '???'),
      Number(await erc.decimals().catch(() => 18)),
      await ro.poolBalance(),
    ];
    const rec = { addr, ro, admin, token, symbol, decimals, balance };
    poolCache.set(kk, rec);
    return rec;
  }

  // ── Build the eligibility picture FROM CHAIN TRUTH ──
  // For each Citizen-owned pawn on the guard job, classify every earned rung as:
  //   claimable  → attested + active + not claimed + pool covers it  (the Citizen can claim NOW)
  //   blocked    → earned but NOT attested (waiting on the house attest step)
  //   claimed    → already paid (skip)
  const claimable = []; // { tier, id, label, tokenId, pool, rewardWei }
  const blockedOnAttest = []; // { tier, id, label, tokenId }
  let owned = 0, onJob = 0, scanned = 0;

  for (const id of pawnIds) {
    scanned++;
    let owner;
    try { owner = await nft.ownerOf(id); } catch (e) { continue; } // not minted / burned
    if (owner.toLowerCase() !== player.toLowerCase()) continue; // only the Citizen's own pawns
    owned++;

    let target, run;
    try { target = await wc.currentTarget(GUARD_COLL, id); run = Number(await wc.currentRun(GUARD_COLL, id)); }
    catch (e) { continue; } // can't prove eligibility without the work read
    if (target.toLowerCase() !== GUARD_TARGET.toLowerCase()) continue; // lose-on-switch: not on the guard job
    onJob++;

    for (const r of RUNGS) {
      if (onlyRung && r.id !== onlyRung) continue;
      if (run < r.secs) continue; // threshold not met
      const pool = await getPool(r.tier);
      let ach;
      try { ach = await pool.ro.achievements(r.id); } catch (e) { continue; }
      if (!ach.exists || !ach.active) continue; // not registered/active on this line/pool
      let claimed, attested;
      try { claimed = await pool.ro.hasClaimed(r.id, GUARD_COLL, id); } catch (e) { continue; }
      if (claimed) continue; // already paid — the real anti-double gate
      try { attested = await pool.ro.attested(r.id, keyOf(GUARD_COLL, id)); } catch (e) { attested = false; }

      if (!attested) { blockedOnAttest.push({ tier: r.tier, id: r.id, label: r.label, tokenId: id }); continue; }
      // attested + earned + unclaimed → claimable. Reward = 1% of the LIVE balance (BPS_OF_POOL).
      const rewardWei = (pool.balance * 100n) / 10000n;
      claimable.push({ tier: r.tier, id: r.id, label: r.label, tokenId: id, pool, rewardWei });
    }
  }

  // Reward sizing for the report (uses live balance, same math as the contract).
  const describe = (c) => ({
    rung: c.id, label: c.label, tier: c.tier, tokenId: c.tokenId,
    crewId: `${GUARD_COLL}:${c.tokenId}`,
    pool: c.pool.addr, prizeToken: c.pool.symbol,
    rewardNow: `${ethers.formatUnits(c.rewardWei, c.pool.decimals)} ${c.pool.symbol}`,
    rewardNote: '1% of the LIVE pool balance at claim time (drops as the pool is drained)',
  });

  // ── READ mode ──
  if (!execute) {
    out({
      ok: true, tool: 'claim-achievement', mode: 'READ', line, player,
      scanned, citizenOwnedGuardPawns: owned, onGuardJob: onJob,
      claimableNow: claimable.map(describe),
      blockedOnHouseAttest: blockedOnAttest.map((b) => ({ rung: b.id, label: b.label, tier: b.tier, tokenId: b.tokenId, crewId: `${GUARD_COLL}:${b.tokenId}`, note: 'EARNED but the house has not attested yet — the Coordinator must run the house attest (achievement-claim-fire.cjs / guard-ladder-keeper.cjs) before the Citizen can claim.' })),
      summary: {
        claimable: claimable.length,
        blockedOnAttest: blockedOnAttest.length,
        moneyLeakNote: claimable.length
          ? `each claim pays 1% of the live pool (≈${ethers.formatUnits((claimable[0].pool.balance * 100n) / 10000n, claimable[0].pool.decimals)} ${claimable[0].pool.symbol} on the first), so claiming N pawns drains ~N% of the pool (compounding down). Claim deliberately, in small batches — this tool caps --execute at --max ${maxBatch}/run and requires an explicit --pawns list.`
          : 'nothing claimable right now.',
      },
      runSequence: [
        '1) HOUSE (Coordinator, treasury wallet, peg-onehop PAUSED): attest the earned rungs — `cd mftusd-build && SEAS_ACHV_FIRE=YES node achievement-claim-fire.cjs --execute` (attest-only for Citizen-held pawns; it CANNOT claim them).',
        '2) CITIZEN (this tool): `node claim-achievement.js --execute --pawns <ids>` with CITIZEN_ALLOW_LIVE=1 — claims the now-attested rungs; GOLD lands on the Citizen wallet.',
        '3) WATER: `node water-pawn.js --execute --pawn <id>` to spend the GOLD-funded USDC into a level (see water-pawn.js for the GOLD→USDC funding hop via convert-winnings.js).',
      ],
      note: 'READ-ONLY — no transaction sent. The claim is gated by --execute AND CITIZEN_ALLOW_LIVE=1, and requires an explicit --pawns list.',
    });
    return;
  }

  // ── CLAIM (LIVE) ──
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
  if (!pawnsArg) throw new Error('refusing a wide claim: pass an EXPLICIT --pawns <ids> list in --execute mode (money-leak guard — each claim drains 1% of the pool)');
  const w = chain.loadWallet();
  if (!w) throw new Error('no Citizen wallet loaded — run init-wallet.js + fund');
  if (!claimable.length) { out({ ok: true, tool: 'claim-achievement', mode: 'LIVE', line, player, claimed: 0, note: 'nothing claimable for the given --pawns (either not attested by the house yet, already claimed, or not earned).' }); return; }

  const fees = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  let nonce = await provider.getTransactionCount(w.address, 'pending');
  const results = [];
  let fired = 0;

  for (const c of claimable) {
    if (fired >= maxBatch) { results.push({ rung: c.id, tokenId: c.tokenId, skipped: `batch cap ${maxBatch} reached — re-run to continue (hasClaimed is the resume-safe gate)` }); continue; }
    // Re-verify the full gate IMMEDIATELY before sending (no revert-bait): owner-held, attested,
    // not claimed, active, pool covers the reward.
    const poolRo = c.pool.ro;
    let owner, attested, claimed, ach, liveBal;
    try {
      owner = await nft.ownerOf(c.tokenId);
      attested = await poolRo.attested(c.id, keyOf(GUARD_COLL, c.tokenId));
      claimed = await poolRo.hasClaimed(c.id, GUARD_COLL, c.tokenId);
      ach = await poolRo.achievements(c.id);
      liveBal = await poolRo.poolBalance();
    } catch (e) {
      results.push({ rung: c.id, tokenId: c.tokenId, skipped: `pre-check read failed: ${e.shortMessage || e.message}` });
      continue;
    }
    if (owner.toLowerCase() !== w.address.toLowerCase()) { results.push({ rung: c.id, tokenId: c.tokenId, skipped: `not owner-held (owner ${owner})` }); continue; }
    if (!attested) { results.push({ rung: c.id, tokenId: c.tokenId, skipped: 'not attested by the house yet — run the house attest first' }); continue; }
    if (claimed) { results.push({ rung: c.id, tokenId: c.tokenId, skipped: 'already claimed (resume-safe)' }); continue; }
    if (!ach.active) { results.push({ rung: c.id, tokenId: c.tokenId, skipped: 'achievement paused on-chain' }); continue; }
    const rewardWei = (liveBal * 100n) / 10000n;
    if (rewardWei === 0n || liveBal < rewardWei) { results.push({ rung: c.id, tokenId: c.tokenId, skipped: 'pool underfunded / zero reward' }); continue; }

    const poolW = new ethers.Contract(c.pool.addr, POOL_ABI, w);
    try {
      const tx = await poolW.claim(c.id, GUARD_COLL, c.tokenId, { nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, gasLimit: 200000 });
      const rc = await tx.wait();
      if (rc.status !== 1) { results.push({ rung: c.id, tokenId: c.tokenId, txHash: tx.hash, reverted: true }); nonce++; continue; }
      nonce++; fired++;
      results.push({ rung: c.id, tokenId: c.tokenId, txHash: tx.hash, paid: `${ethers.formatUnits(rewardWei, c.pool.decimals)} ${c.pool.symbol}`, to: w.address, block: rc.blockNumber });
    } catch (e) {
      results.push({ rung: c.id, tokenId: c.tokenId, failed: e.shortMessage || e.reason || e.code || e.message });
      try { nonce = await provider.getTransactionCount(w.address, 'pending'); } catch (e2) { results.push({ note: `nonce resync failed (${e2.message}); aborting` }); break; }
      continue;
    }
    await sleep(4000); // Base pacing
  }

  out({ ok: true, tool: 'claim-achievement', mode: 'LIVE', line, player, claimed: fired, batchCap: maxBatch, results,
        note: fired >= maxBatch ? 'hit the per-run batch cap — re-run to claim more (hasClaimed prevents double-claim).' : 'claim run complete; GOLD reward(s) landed on the Citizen wallet.' });
}

main().catch((e) => { out({ ok: false, tool: 'claim-achievement', error: e.message || String(e), hint: 'run `node citizen/tools/claim-achievement.js` (no args) to see earned+attested rungs; claiming needs --pawns "0,1,.." + --execute (live).' }); process.exit(1); });
