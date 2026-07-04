// ============================================================================
//  forge-title.js — the ROGUES GUILD "Forge a Title" referee (compute/read only).
//
//  WHAT THIS IS (founder 2026-06-27: "build it and put it in game")
//    A pawn that has EARNED the ROGUES GUILD 1-WEEK rung may FORGE A TITLE: a magic-ink
//    prestige artifact (a forged name/rank that "alters reality") which also confers a
//    perpetual IN-GAME GOLD STIPEND. The player pays USDC; that USDC seeds a PERMANENT
//    GOLD-water endowment into the pawn's vault (depositAndWater → locked forever, on
//    purpose), and the endowment's Aave yield is harvested to GOLD and trickled to the
//    pawn's owner (claimPayout). The forged TITLE is a name/rank attribute on the pawn.
//
//  COMPLIANCE (HARD LINE — founder): this is a forged MAGIC TITLE you earn the right to +
//    buy. It is NOT a financial product. NEVER frame the gold as yield / returns / interest
//    / passive income / an investment. In-game gold + prestige ONLY. (Strings live in the
//    UI + catalog; this module exposes only the mechanism + the neutral words.)
//
//  THE GATE (the special part)
//    LOCKED until the pawn has earned the ROGUES GUILD 1-week achievement. On-chain that is
//    achievement id 1002 ("Guard the Port" rung 2 / "Dockside Enforcer"), ADMIN_ATTESTED, on
//    the cbBTC (rogue / Black Coin / Redrum Raiders) Mayor PrizePool 0xB10f… A pawn has
//    EARNED it iff PrizePool.isEligible(1002, collection, tokenId)  (watcher-attested, not
//    yet claimed)  OR  PrizePool.hasClaimed(1002, collection, tokenId)  (already claimed it).
//    REAL OR NOTHING — we read the live chain; we never fake an achievement.
//
//  ON-CHAIN FLOW (per forge) — the buyer's wallet does the value-moving steps:
//    1. RELAYER/keeper: TitlesVault.plantTree(pawnCollection, pawnId)   (idempotent; registers
//       the pawn as a "tree" so its owner receives the gold trickle). No funds; anyone can call.
//    2. BUYER wallet: USDC.approve(TitlesVault, EXACT price)            (exact approval only — never MaxUint256)
//    3. BUYER wallet: TitlesVault.depositAndWater(treeId, price)        (LOCKS the principal forever — correct here)
//    4. Title attribute granted to the pawn (name/rank in the NameRegistry / catalog).
//    Ongoing: keeper harvest()s the vault → GOLD; claimPayout(treeId) sends GOLD to the pawn owner.
//
//  This module is the REFEREE the server + UI call. It:
//    • reads the gate on-chain (isEligible || hasClaimed),
//    • resolves/derives the treeId for a pawn in the Titles vault,
//    • computes the EXACT on-chain step list (addresses, calldata-ready args, exact USDC),
//    It MOVES NO FUNDS and SIGNS NOTHING. The buyer's wallet sends 2+3; a relayer sends 1.
//    No silent catches — every read failure propagates.
// ============================================================================
'use strict';

const { ethers } = require('ethers');

// ── canonical addresses (verified on-chain 2026-06-27) ───────────────────────────────────────
// ROGUES GUILD ladder = the cbBTC line (founder reskin: Redrum Raiders / Black Coin / dark side).
const ROGUE_PRIZE_POOL = '0xB10fbbCB67d68d1f43E566089FFa0f36Bd057193'; // cbBTC Mayor PrizePool (holds the rogue ladder)
const ROGUE_1WEEK_ID   = 1002;                                         // "Guard the Port" rung 2 (1 week) — the Rogues Guild 1-week rung
const USDC             = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base USDC (6 decimals)
const GOLD             = '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004'; // GOLD coin (the in-game stipend token)

// The Titles GOLD-water vault (WaterV2, payout=GOLD). DRY-prepped; the coordinator deploys it
// (deploy-ocean-water.cjs with WATER_NAME=TITLEw) and records its address here + in forge-deployed.json.
// Until deployed it is null; the server returns a clear 503 (never a fake forge).
const TITLES_VAULT = '0xC8C3fc3e37834568F33905A36F1DCd26cbc45221'; // Titles GOLD-water vault (WaterV2 payout=GOLD), deployed 2026-06-27

// ── ABIs (minimal, read-only here) ────────────────────────────────────────────────────────────
const PRIZE_POOL_ABI = [
  'function isEligible(uint256,address,uint256) view returns (bool)',
  'function hasClaimed(uint256,address,uint256) view returns (bool)',
];
const VAULT_ABI = [
  'function treeIdFor(address,uint256) view returns (uint256)', // treeId+1, 0 = unplanted
  'function treeWater(uint256) view returns (uint256)',
  'function pendingPayout(uint256) view returns (uint256)',
];
const ERC721_ABI = ['function ownerOf(uint256) view returns (address)'];

// ── pricing ─────────────────────────────────────────────────────────────────────────────────
// The forge price (USDC that becomes the permanent endowment). 6-decimals like USDC. A single
// flat price for the v1 Rogues Guild title; the deploy/config can tier it later. NOT hardcoded
// elsewhere — the server reads it from here so there is ONE source of truth.
const FORGE_PRICE_USDC = 10_000_000; // 10.00 USDC (6 decimals)

/** Earned-the-rogue-1-week-rung gate. Reads the LIVE chain. true iff watcher-attested OR claimed. */
async function hasEarnedRogue1Week(provider, collection, tokenId, opts = {}) {
  const poolAddr = opts.prizePool || ROGUE_PRIZE_POOL;
  const id = opts.achievementId || ROGUE_1WEEK_ID;
  const pool = new ethers.Contract(poolAddr, PRIZE_POOL_ABI, provider);
  const coll = ethers.getAddress(collection);
  const tid = BigInt(tokenId);
  // attested-but-unclaimed (isEligible) OR already-claimed (hasClaimed) both mean "earned".
  const [eligible, claimed] = await Promise.all([
    pool.isEligible(id, coll, tid),
    pool.hasClaimed(id, coll, tid),
  ]);
  return { earned: !!(eligible || claimed), eligible: !!eligible, claimed: !!claimed, achievementId: id, prizePool: poolAddr };
}

/** Resolve a pawn's treeId in the Titles vault (or null if not planted yet). Reads live chain. */
async function treeIdForPawn(provider, vaultAddr, collection, tokenId) {
  const v = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
  const idPlus = await v.treeIdFor(ethers.getAddress(collection), BigInt(tokenId));
  return idPlus === 0n ? null : (idPlus - 1n);
}

/** Live view of a pawn's forged-title endowment (locked principal + GOLD ready to claim). */
async function forgedStipendView(provider, vaultAddr, collection, tokenId) {
  const treeId = await treeIdForPawn(provider, vaultAddr, collection, tokenId);
  if (treeId === null) return { forged: false, treeId: null, endowmentWater: '0', pendingGold: '0' };
  const v = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
  const [water, pending] = await Promise.all([v.treeWater(treeId), v.pendingPayout(treeId)]);
  return { forged: water > 0n, treeId: treeId.toString(), endowmentWater: water.toString(), pendingGold: pending.toString() };
}

/**
 * Build the EXACT on-chain step list a forge requires, given a treeId (which the server obtains
 * by ensuring plantTree has run). Returns calldata-ready args for the buyer's wallet. EXACT USDC
 * approval only (never MaxUint256). MOVES NO FUNDS — the caller (buyer wallet) sends these.
 */
function forgeSteps({ vaultAddr, treeId, priceUsdc = FORGE_PRICE_USDC }) {
  if (!vaultAddr) throw new Error('Titles vault not deployed yet');
  if (treeId === null || treeId === undefined) throw new Error('treeId required (plantTree first)');
  const price = BigInt(priceUsdc);
  if (!(price > 0n)) throw new Error('price must be > 0');
  return [
    {
      step: 1, by: 'relayer', target: vaultAddr, method: 'plantTree(address,uint256)',
      note: 'register the pawn as a tree (idempotent; no funds). The relayer/keeper does this before the buyer pays.',
    },
    {
      step: 2, by: 'buyer', target: USDC, method: 'approve(address,uint256)',
      args: { spender: vaultAddr, amount: price.toString() },
      note: 'EXACT approval only — approve precisely the forge price, never MaxUint256.',
    },
    {
      step: 3, by: 'buyer', target: vaultAddr, method: 'depositAndWater(uint256,uint256)',
      args: { treeId: String(treeId), usdcAmount: price.toString() },
      note: 'LOCKS the principal forever — correct here (a permanent endowment; the forged title trickles gold for good).',
    },
  ];
}

module.exports = {
  // addresses / ids (verified)
  ROGUE_PRIZE_POOL, ROGUE_1WEEK_ID, USDC, GOLD, TITLES_VAULT, FORGE_PRICE_USDC,
  // gate + reads
  hasEarnedRogue1Week, treeIdForPawn, forgedStipendView,
  // step builder
  forgeSteps,
};
