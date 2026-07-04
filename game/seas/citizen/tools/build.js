#!/usr/bin/env node
'use strict';
/**
 * build.js — the bot's BUILD hand: raise a STRUCTURE (mill / farm) that produces a resource and
 * RE-LOCKS gold as a growing endowment. This is the founder's growth engine (memory:
 * project_seas_endowment_engine / project_seas_production / project_seas_pawn_hire):
 *
 *   pay GOLD (+ maybe materials) → create a structure with its OWN water vault → the structure
 *   PRODUCES (mill → lumber, farm → food/produce) AND the locked gold becomes endowment that grows
 *   the water (perpetual + accelerating). "part to mill water, part to coin water." Pay-to-BUILD,
 *   not pay-to-win. Built semi-modularly. Parallels the pawn-hire path (gold → swap → mint NFT +
 *   plantTree + depositAndWater seeds a WATER vault), just for a place instead of a person.
 *
 * WHAT EXISTS ON-CHAIN TODAY (verified 2026-06-27):
 *   • The resources + sell markets exist: LUMBER (mill LPs at loc 13001/14003, deploy/mill-lp-
 *     deployed.json), FISH (ocean), and the FARM produce tokens WHEAT/CORN + the CRAB/forageables
 *     (deploy/produce-deployed.json, deploy/forageables-deployed.json).
 *   • The WATER-vault pattern exists (WaterV2 — plantTree + depositAndWater, used by every job vault
 *     and by the pawn-hire path) and GOLD trades two-sided-ish on pool 0x18A880F2 (fee100).
 *   • The mill keeper (deploy/mill-keeper.js) already drives the produce/inject side of a mill LP.
 *
 * WHAT IS MISSING (so building can't be a real on-chain action yet):
 *   • There is NO StructureFactory / structure-NFT contract. "Create a structure + seed its own
 *     water vault from locked gold" needs a contract that (a) takes the gold, (b) deploys/links a
 *     WaterV2 vault as the structure's endowment, (c) mints a structure NFT to the builder, (d)
 *     wires its production to its LP. That is a FOUNDER-GATED deploy.
 *
 * So this tool is HONEST: `list` shows what's buildable + what already stands; `plan` designs + prices
 * a build, checks the builder's gold, GATES on GOLD exit-liquidity (the market-gate rule:
 * feedback_no_hands_for_hire — don't lock value you can't exit), and then reports the founder-gated
 * StructureFactory deploy that building REQUIRES. It NEVER deploys and NEVER fabricates a structure.
 *
 *   node citizen/tools/build.js list                          # buildable kinds + existing structures
 *   node citizen/tools/build.js plan mill                     # DRY: design + price a mill build
 *   node citizen/tools/build.js plan farm --gold 1000         # DRY: price a farm, lock 1000 GOLD
 *   node citizen/tools/build.js plan mill --execute           # still DRY (no factory) — reports the gate
 */
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const gs = require('../../gap-scan.js');
const chain = require('../lib/chain.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

const DEPLOY = path.join(__dirname, '..', '..', '..', '..', 'deploy'); // MfT-Launch/deploy
function readDeploy(name) {
  const p = path.join(DEPLOY, name);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`could not read ${name}: ${e.message}`); } // visible, never silent
}

// GOLD market (the one venue; same as convert-winnings.js): GOLD/Money fee100 pool 0x18A880F2.
const GOLD = gs.COIN_ADDR.gold;
const MONEY = gs.ADDR.money;
const FEE_GOLD = gs.FEE_WALL; // 100
const GOLD_USD = gs.COIN_USD.gold; // $0.01 anchor

// Builder market-gate: don't lock gold you can't exit. We probe the GOLD→Money SELL side at the
// intended lock size; if it returns near-zero relative to the $0.01 anchor, exit-liquidity is thin
// and we WARN (the founder's no-hands-for-hire / no-premature-lock discipline).
const EXIT_LIQ_TOLERANCE = 0.5; // sell side must realize ≥ 50% of anchor value or we flag it thin

/**
 * Structure catalog — the founder's design, parameterized. Each kind produces a resource via a
 * WaterV2 vault (the structure's endowment) the same way a job vault does. Costs use the founder's
 * "~1,000 gold per unskilled bunk" anchor (project_seas_pawn_hire) as the base build cost.
 * These are DESIGN values the StructureFactory would consume — NOT yet enforced on-chain.
 */
const STRUCTURES = {
  mill: {
    kind: 'mill',
    name: 'Lumber Mill',
    produces: { token: 'LUMBER', address: '0x7a97e5e76C93267e1FF2EBc38DCC7C7B6f40fF4c' },
    baseGoldCost: 1000,                 // founder anchor: ~1,000 gold per unskilled bunk
    goldSplit: { water: 0.5, coinWater: 0.5 }, // "part to mill water, part to coin water"
    vaultPattern: 'WaterV2 (plantTree + depositAndWater) — the SAME pattern as job vaults / pawn-hire',
    productionFlow: 'mill keeper injects LUMBER into the mill LP (deploy/mill-keeper.js); wages paid by a COPPER coin-water held in the vault (water-tokens.csv SIMPLIFY)',
    sellMarketRecord: 'mill-lp-deployed.json',
    note: 'Mills already have LIVE sell LPs + a keeper; what is missing is the per-structure endowment vault + the factory that creates one from locked gold.',
  },
  farm: {
    kind: 'farm',
    name: 'Farm',
    produces: { token: 'WHEAT', address: '0x969b59Dc55167450B2D5d9dEcf81bc857e4f2604', also: ['CORN'] },
    baseGoldCost: 1000,
    goldSplit: { water: 0.5, coinWater: 0.5 },
    vaultPattern: 'WaterV2 (plantTree + depositAndWater)',
    productionFlow: 'farm produces food/produce (WHEAT/CORN; produce-deployed.json) — same inject-to-LP + coin-water-wage model as a mill; needs a produce sell LP (NOT deployed yet)',
    sellMarketRecord: 'produce-deployed.json (tokens only — no sell LP/wall deployed yet)',
    note: 'Farm produce tokens exist; a farm has neither an endowment vault, a structure factory, NOR a produce sell market yet.',
  },
};

/** List existing built structures from the deploy records (mills are the only ones with LPs today). */
function existingStructures() {
  const mills = readDeploy('mill-lp-deployed.json');
  const list = [];
  if (mills && mills.mills) {
    for (const m of Object.values(mills.mills)) {
      list.push({ kind: 'mill', id: m.id, loc: m.loc, lp: m.pool, produces: 'LUMBER', priceGold: m.price, hasEndowmentVault: false });
    }
  }
  return list;
}

/** Probe GOLD exit-liquidity for a lock of `goldAmount`: realized Money vs anchor value. */
async function goldExitLiquidity(goldAmount) {
  const amt = ethers.parseUnits(String(Math.max(1, Math.floor(goldAmount))), 18);
  const moneyOutWei = await gs.quoteSingle(GOLD, MONEY, FEE_GOLD, amt);
  const anchorUsd = goldAmount * GOLD_USD;
  if (moneyOutWei === null || moneyOutWei === 0n) {
    return { ok: false, anchorUsd, realizedUsd: 0, ratio: 0, thin: true, note: 'GOLD→Money sell side returned nothing — cannot exit a gold lock right now.' };
  }
  const realizedUsd = Number(ethers.formatUnits(moneyOutWei, 6)); // Money ≈ $1
  const ratio = anchorUsd > 0 ? realizedUsd / anchorUsd : 0;
  return { ok: true, anchorUsd, realizedUsd: Number(realizedUsd.toFixed(4)), ratio: Number(ratio.toFixed(4)), thin: ratio < EXIT_LIQ_TOLERANCE,
    note: ratio < EXIT_LIQ_TOLERANCE ? `THIN: locking ${goldAmount} GOLD ($${anchorUsd.toFixed(2)} at anchor) would only sell back for ~$${realizedUsd.toFixed(2)} (${(ratio*100).toFixed(0)}%). Two-sided gold market is shallow (project: Phase-1 sell side not built). Build small or wait for deeper gold liquidity.` : 'gold exit-liquidity adequate for this lock' };
}

(async () => {
  const args = process.argv.slice(2);
  const cmd = (args[0] || 'list').toLowerCase();

  if (cmd === 'list') {
    out({
      ok: true, tool: 'build', mode: 'LIST',
      buildable: Object.values(STRUCTURES).map((s) => ({ kind: s.kind, name: s.name, produces: s.produces.token, baseGoldCost: s.baseGoldCost, goldSplit: s.goldSplit })),
      existing: existingStructures(),
      mechanism: {
        summary: 'pay GOLD → StructureFactory creates a structure + seeds its OWN WaterV2 endowment vault from the locked gold → structure produces (mill→lumber, farm→food) + the gold endowment grows the water (perpetual, accelerating). Pay-to-build, not pay-to-win.',
        reuses: ['WaterV2 vault pattern (job vaults / pawn-hire)', 'GOLD/Money pool 0x18A880F2 (fee100)', 'mill-keeper.js production/inject', 'coin-water wages (COPPER) per water-tokens.csv SIMPLIFY'],
        missingContract: 'StructureFactory (+ structure NFT) — NOT deployed. Building cannot be a real on-chain action until the founder approves + this deploys.',
      },
      note: 'Read-only. Use `build plan <mill|farm>` to design + price a specific build (still DRY — no factory deployed).',
    });
    return;
  }

  if (cmd === 'plan') {
    const kind = (args[1] || '').toLowerCase();
    const s = STRUCTURES[kind];
    if (!s) throw new Error(`unknown structure "${kind}" — buildable: ${Object.keys(STRUCTURES).join(', ')}`);
    const siteIdx = args.indexOf('--site');
    const goldIdx = args.indexOf('--gold');
    const site = siteIdx >= 0 ? args[siteIdx + 1] : null;
    const goldToLock = goldIdx >= 0 ? Number(args[goldIdx + 1]) : s.baseGoldCost;
    const execute = args.includes('--execute');

    // Builder's gold on hand (read-only).
    const addr = chain.walletAddress();
    const bal = addr ? await chain.balances(addr) : null;
    const goldOnHand = bal ? bal.gold : 0;
    const haveEnough = goldOnHand >= goldToLock;

    // Market-gate: can this gold lock be exited? (the no-hands-for-hire / no-premature-lock rule)
    const exitLiq = await goldExitLiquidity(goldToLock);

    const split = {
      toStructureWater: Math.round(goldToLock * s.goldSplit.water),
      toCoinWater:      Math.round(goldToLock * s.goldSplit.coinWater),
    };

    // Is the StructureFactory deployed? If so, building is a REAL on-chain action (gated). Read the
    // on-chain kind so we price off the CONTRACT's gold cost (single source of truth), not the design table.
    const factoryAddr = chain.structureFactoryAddress();
    let onChainKind = null;
    if (factoryAddr) {
      const sf = chain.structureFactory();
      const kindId = ethers.id(s.kind); // keccak256(utf8(kind)) — matches the contract's keccak256(bytes(kindId))
      try {
        const k = await sf.kinds(kindId);
        if (k.exists) onChainKind = { goldCostWei: k.goldCost, goldCost: Number(ethers.formatUnits(k.goldCost, 18)), producedGood: k.producedGood, endowmentVault: k.endowmentVault, label: k.label };
      } catch (e) { throw new Error(`StructureFactory.kinds(${s.kind}) read failed: ${e.message}`); } // visible, never silent
    }

    // If executing AND the factory + kind are live AND gates pass, do the REAL build.
    let executed = null;
    if (execute && onChainKind && exitLiq.ok && !exitLiq.thin) {
      const goldCostWei = onChainKind.goldCostWei;
      // Price minMoneyOut off the live GOLD/Money pool at the EXACT cost, with the same 50% floor the
      // gate uses (real slippage guard; build.js owns the market read, the contract enforces it).
      const moneyOutWei = await gs.quoteSingle(GOLD, MONEY, FEE_GOLD, goldCostWei);
      if (moneyOutWei === null || moneyOutWei === 0n) throw new Error('GOLD->Money quote returned nothing — refusing to build into a dead market');
      const minMoneyOutWei = (moneyOutWei * 90n) / 100n; // 10% slippage floor on the live quote
      const hash = await chain.buildStructure({ kindId: s.kind, loc: site || 0, structName: `${s.name}`, goldCostWei, minMoneyOutWei });
      executed = { txHash: hash, kindId: s.kind, goldSpent: onChainKind.goldCost, minMoneyOut: Number(ethers.formatUnits(minMoneyOutWei, 6)), note: 'LIVE build broadcast. Structure starts UNSEALED (withdrawable) — call seal() to lock the endowment when shipped.' };
    }

    out({
      ok: true, tool: 'build', mode: 'DRY-PLAN', kind: s.kind, name: s.name, site: site || `(auto — next ${s.kind} site)`,
      wallet: addr, goldOnHand,
      cost: { goldToLock, split, baseGoldCost: s.baseGoldCost, anchorUsd: Number((goldToLock * GOLD_USD).toFixed(2)) },
      haveEnoughGold: haveEnough,
      produces: s.produces, vaultPattern: s.vaultPattern, productionFlow: s.productionFlow,
      marketGate: {
        rule: 'no-hands-for-hire / no-premature-lock: only lock gold as endowment if it can be exited.',
        goldExitLiquidity: exitLiq,
        pass: exitLiq.ok && !exitLiq.thin,
      },
      factory: factoryAddr
        ? { deployed: true, address: factoryAddr, kindRegistered: !!onChainKind, onChainKind }
        : { deployed: false, founderGated: true, whatBuildingNeeds: [
            'Deploy StructureFactory (StructureFactory.sol, fork-tested) via deploy-structure-factory.cjs --live (founder-gated).',
            'Deploy/point a per-good WaterV2 endowment vault (payout = LUMBER for mills, WHEAT for farms).',
            s.kind === 'farm' ? 'Deploy a produce sell LP/wall for WHEAT/CORN (none exists yet).' : 'Reuse the existing mill LP + mill-keeper.js for the production market.',
            'addKind(kind, label, goldCost, producedGood, endowmentVault) on the factory (add-only).',
          ] },
      executeRequested: execute,
      executed,
      would: executed
        ? `BUILT: ${executed.note}`
        : !factoryAddr
          ? 'CANNOT execute: the StructureFactory is not deployed. Reporting the founder-gated deploy instead of faking a build (real-or-nothing).'
          : !onChainKind
            ? `CANNOT execute: StructureFactory is deployed but kind "${s.kind}" is not registered (addKind needed) — never fakes a build.`
            : execute
              ? `BLOCKED by market gate or CITIZEN_ALLOW_LIVE — not building. exitLiquidity pass=${exitLiq.ok && !exitLiq.thin}.`
              : `design + price only. Build would lock ${goldToLock} GOLD (split ${split.toStructureWater}→structure water / ${split.toCoinWater}→coin water) to raise a ${s.name} producing ${s.produces.token}. Pass --execute (with CITIZEN_ALLOW_LIVE=1) to build for real.`,
      note: factoryAddr
        ? 'StructureFactory is live. plan --execute builds for real when the kind is registered, the market gate passes, and CITIZEN_ALLOW_LIVE=1. Structure starts UNSEALED (reclaimable) — seal() locks the endowment.'
        : 'DRY by definition until the founder approves + deploys the StructureFactory. This tool never deploys a contract and never fabricates a structure.',
    });
    return;
  }

  throw new Error(`unknown command "${cmd}" — use: list | plan <mill|farm> [--site <id>] [--gold N] [--execute]`);
})().catch((e) => { out({ ok: false, tool: 'build', error: e.message }); process.exit(1); });
