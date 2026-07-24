#!/usr/bin/env node
/**
 * forge-title-keeper.js — the RELAYER/keeper for the Rogues Guild "Forge a Title" system.
 *
 * THREE JOBS (all on the Titles GOLD-water vault — a WaterV2 payout=GOLD, deployed by the
 * coordinator via deploy-ocean-water.cjs WATER_NAME=TITLEw):
 *   1. plant <collection> <tokenId>   — TitlesVault.plantTree(pawn) so the pawn becomes a "tree"
 *      that receives the gold trickle. Permissionless + idempotent; the relayer fronts it so the
 *      buyer's wallet only has to approve + depositAndWater. NO funds move here.
 *   2. harvest [--minGold N]          — TitlesVault.harvest(minGoldOut): turns the endowment's Aave
 *      yield into GOLD (50% grows the pool, 50% buys GOLD for the title-holders). Keeper-gated.
 *   3. claim [treeIds...]             — TitlesVault.claimPayout / claimMany: sends each title's GOLD
 *      to the pawn's CURRENT OWNER. Permissionless; the keeper sweeps so holders needn't.
 *
 * The buyer's wallet does the value-moving forge steps (USDC.approve EXACT + depositAndWater) — see
 * game/seas/forge-title.js forgeSteps(). depositAndWater LOCKS the principal forever (correct: a
 * permanent endowment; the forged title trickles gold for good).
 *
 *   node deploy/forge-title-keeper.js status                          — read-only (vault, trees, gold)
 *   node deploy/forge-title-keeper.js plant 0x<coll> <id>             — DRY plant (default)
 *   node deploy/forge-title-keeper.js plant 0x<coll> <id> --execute   — LIVE (coordinator; peg paused)
 *   node deploy/forge-title-keeper.js harvest [--minGold N] [--execute]
 *   node deploy/forge-title-keeper.js claim [t0 t1 ...] [--execute]
 *
 * Real-or-nothing: every leg throws loudly on failure; nothing faked. Exact approvals, 1-tx-at-a-time,
 * 0.15 gwei. DRY by default; --execute broadcasts (coordinator only, after peg-onehop paused).
 */
'use strict';
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });

const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');
const FEES = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };

// The Titles vault deploy record (written by deploy-ocean-water.cjs WATER_NAME=TITLEw). Until the
// coordinator deploys it, this file is absent and the keeper exits with a clear message (no fake).
const TITLES_REC = path.join(__dirname, '..', '..', 'mftusd-build', 'waterv2-titlew-deployment.json');

const VAULT_ABI = [
  'function plantTree(address,uint256) returns (uint256)',
  'function treeIdFor(address,uint256) view returns (uint256)',
  'function treeWater(uint256) view returns (uint256)',
  'function pendingPayout(uint256) view returns (uint256)',
  'function pendingYield() view returns (uint256)',
  'function totalBacking() view returns (uint256)',
  'function treeCount() view returns (uint256)',
  'function harvest(uint256)',
  'function claimPayout(uint256)',
  'function claimMany(uint256[])',
];

function loadVault() {
  if (!fs.existsSync(TITLES_REC)) {
    throw new Error(`Titles vault not deployed yet — ${TITLES_REC} missing. Coordinator: deploy it first\n  WATER_NAME=TITLEw RESOURCE_SYM=GOLD WATER_LABEL="Rogues Guild titles" SKIP_CSV=0 node deploy-ocean-water.cjs --live`);
  }
  const rec = JSON.parse(fs.readFileSync(TITLES_REC, 'utf8'));
  if (!rec.vault) throw new Error(`Titles vault record ${TITLES_REC} has no .vault address`);
  return rec.vault;
}

async function main() {
  const cmd = process.argv[2] || 'status';
  const provider = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true });
  const vaultAddr = loadVault();
  console.log('Titles vault:', vaultAddr, '| mode:', EXECUTE ? 'LIVE (--execute)' : 'DRY');

  if (cmd === 'status') {
    const v = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
    const [count, backing, pending] = await Promise.all([v.treeCount(), v.totalBacking(), v.pendingYield()]);
    console.log('  forged titles (trees):', count.toString());
    console.log('  total endowment backing (USDC, 6dec):', ethers.formatUnits(backing, 6));
    console.log('  yield ready to harvest (USDC, 6dec):', ethers.formatUnits(pending, 6));
    return;
  }

  if (!PRIVATE_KEY && EXECUTE) throw new Error('AGENT_PRIVATE_KEY/DEPLOY_PRIVATE_KEY required for --execute');
  const wallet = EXECUTE ? new ethers.Wallet(PRIVATE_KEY, provider) : null;
  const v = new ethers.Contract(vaultAddr, VAULT_ABI, EXECUTE ? wallet : provider);

  if (cmd === 'plant') {
    const coll = ethers.getAddress(process.argv[3]);
    const tid = BigInt(process.argv[4]);
    const existing = await new ethers.Contract(vaultAddr, VAULT_ABI, provider).treeIdFor(coll, tid);
    if (existing !== 0n) { console.log(`  pawn ${coll} #${tid} already planted (treeId ${existing - 1n}) — nothing to do.`); return; }
    console.log(`  plantTree(${coll}, ${tid})`);
    if (!EXECUTE) { console.log('  DRY — re-run with --execute (coordinator, peg paused).'); return; }
    const tx = await v.plantTree(coll, tid, { ...FEES });
    console.log('  tx:', tx.hash); await tx.wait();
    const newId = await new ethers.Contract(vaultAddr, VAULT_ABI, provider).treeIdFor(coll, tid);
    console.log(`  PLANTED — treeId ${newId - 1n}. Buyer can now approve EXACT USDC + depositAndWater(${newId - 1n}, price).`);
    return;
  }

  if (cmd === 'harvest') {
    const i = process.argv.indexOf('--minGold');
    if (i < 0) throw new Error('harvest requires --minGold <wei> (the keeper supplies a live-priced floor — sandwich guard)');
    const minGold = BigInt(process.argv[i + 1]);
    const pending = await new ethers.Contract(vaultAddr, VAULT_ABI, provider).pendingYield();
    console.log('  yield ready (USDC):', ethers.formatUnits(pending, 6), '| minGoldOut (wei):', minGold.toString());
    if (!EXECUTE) { console.log('  DRY — re-run with --execute.'); return; }
    const tx = await v.harvest(minGold, { ...FEES }); console.log('  tx:', tx.hash); await tx.wait();
    console.log('  HARVESTED — gold credited to title-holders pro-rata. Run `claim` to sweep it to owners.');
    return;
  }

  if (cmd === 'claim') {
    const ids = process.argv.slice(3).filter((a) => /^\d+$/.test(a)).map((a) => BigInt(a));
    if (!ids.length) throw new Error('claim requires one or more treeIds (e.g. claim 0 1 2)');
    console.log('  claimMany(', ids.map(String).join(','), ') → sends each title\'s GOLD to its pawn owner');
    if (!EXECUTE) { console.log('  DRY — re-run with --execute.'); return; }
    const tx = await v.claimMany(ids, { ...FEES }); console.log('  tx:', tx.hash); await tx.wait();
    console.log('  CLAIMED — gold delivered to current pawn owners.');
    return;
  }

  throw new Error(`unknown command "${cmd}" — use: status | plant | harvest | claim`);
}

main().catch((e) => { console.error('FORGE KEEPER FAILED:', e.reason || e.shortMessage || e.message); process.exit(1); });
