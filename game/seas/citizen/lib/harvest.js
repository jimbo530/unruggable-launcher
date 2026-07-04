// @ts-check
'use strict';
/**
 * harvest.js — the REUSABLE flow-gated, skill-gated HARVEST mechanic (founder 2026-06-27).
 *
 * UNIVERSAL RULE: a pawn produces (fishes / crabs / forages / logs / works) only up to its WATER FLOW
 * — its endowment yield = its productive capacity. More water/level = more output. It is SKILL-GATED
 * and NEVER random, and it is NEVER a market-buy/swap. A harvest is a metered draw of the supply that
 * a WATER source's FLOW has already produced — bounded by BOTH the pawn's skill AND that standing
 * supply. (A free swap-buy — e.g. 100 fish for $0.10 — is exactly what this prevents.)
 *
 * This module is the ONE place that computes a harvest, so fishing / crabbing / (later) logging &
 * foraging all share it — only the RESOURCE, its WATER/SUPPLY source, the SKILL stat, and the LOCATION
 * gate differ. It computes; it does not move tokens (the dispensing mechanism is founder-gated and
 * flagged by the caller). Deterministic — same inputs, same output (feedback_skill_based_prizes).
 *
 *   SKILL: a pawn's stat = its on-chain water/level via the class-engine. We read the relevant job
 *          vault's treeWater → a LEVEL (same curve as jobs/index.html backingToLevel). The honest
 *          boundary (as in pawns.js/play.js): a full on-chain stat decode is still TODO; the skill
 *          vault's water is the cleanest REAL skill signal today.
 *   SUPPLY: the fish/crab/etc the flow has produced — read live on-chain by the caller (e.g. the
 *          ocean LP's FISH reserve = what the ocean-water keeper injected from yield).
 *   CATCH:  min( skillCatch(level), supply * MAX_SUPPLY_FRAC ). No dice.
 */
const { ethers } = require('ethers');
const chain = require('./chain.js');

const WATERV2_ABI = [
  'function treeIdFor(address,uint256) view returns (uint256)',
  'function treeWater(uint256) view returns (uint256)',
];

// LEVEL curve mirrors jobs/index.html: level n needs cumulative $ = 0.25*n*(n+1). Inverse → level.
function backingToLevel(backingUsd) {
  const n = Math.floor((-1 + Math.sqrt(1 + 16 * backingUsd)) / 2);
  return Math.max(0, n);
}

/**
 * Read a pawn's harvest SKILL from a WaterV2 skill vault (treeWater → level). A pawn with no water in
 * that vault is unskilled (level 0 → minimum output). 6-dec WaterV2 (USDC-backed).
 * @returns {Promise<{ level:number, backingUsd:number, planted:boolean }>}
 */
async function readSkill(skillVault, collection, tokenId) {
  const v = new ethers.Contract(skillVault, WATERV2_ABI, chain.provider());
  const idPlus = await v.treeIdFor(collection, tokenId);
  if (idPlus === 0n) return { level: 0, backingUsd: 0, planted: false };
  const water = await v.treeWater(idPlus - 1n);
  const backingUsd = Number(ethers.formatUnits(water, 6));
  return { level: backingToLevel(backingUsd), backingUsd, planted: true };
}

// Harvest dials (placeholders; the founder sets the real numbers when the catch mechanism is built).
const CATCH_BASE = 5;            // units a level-0 pawn harvests per attempt
const MAX_SUPPLY_FRAC = 0.0001;  // one harvest can take ≤ 0.01% of the standing flow-supply

/**
 * The deterministic skill+supply-bounded harvest amount. Skill-based, never random.
 *   skillCatch = BASE * (1 + level)            // each level adds BASE
 *   supplyCap  = supplyUnits * MAX_SUPPLY_FRAC // can never drain the flow-produced supply
 *   amount     = min(skillCatch, supplyCap)
 * @param {number} level       harvest skill level (from readSkill)
 * @param {number} supplyUnits the flow-produced supply (caller reads it live on-chain)
 */
function computeHarvest(level, supplyUnits) {
  const skillCatch = CATCH_BASE * (1 + Math.max(0, level));
  const supplyCap = Math.max(0, supplyUnits) * MAX_SUPPLY_FRAC;
  const amount = Math.max(0, Math.min(skillCatch, supplyCap));
  return {
    amount: Number(amount.toFixed(4)),
    skillCatch: Number(skillCatch.toFixed(4)),
    supplyCap: Number(supplyCap.toFixed(4)),
    limitedBy: skillCatch <= supplyCap ? 'skill' : 'supply',
    formula: `min(${CATCH_BASE}*(1+level), supply*${MAX_SUPPLY_FRAC})`,
  };
}

/**
 * A harvest PROFILE = the per-resource config. fishing/crabbing/etc each declare one. `status:'flow-live'`
 * means the flow SUPPLY source exists on-chain (so supply + skill + projected catch are all REAL);
 * `status:'planned'` means the water/flow source for this resource is not deployed yet (founder-gated).
 * In BOTH cases the DISPENSING mechanism (the actual catch tx) is not built yet — flagged, never faked.
 *
 * @typedef {Object} HarvestProfile
 * @property {string} id
 * @property {string} resource          token symbol harvested (FISH/CRAB/…)
 * @property {string} resourceToken     token address
 * @property {string} skillStat         the skill (e.g. 'WIS')
 * @property {string} skillVault        WaterV2 vault read for the skill level
 * @property {string|null} terrainGate  required terrain (e.g. 'beach') or null
 * @property {'flow-live'|'planned'} status
 * @property {string|null} supplySource how the caller reads the flow-produced supply (or null if none yet)
 * @property {string} note
 */

module.exports = { readSkill, computeHarvest, backingToLevel, CATCH_BASE, MAX_SUPPLY_FRAC };
