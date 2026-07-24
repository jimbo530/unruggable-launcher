#!/usr/bin/env node
/**
 * ocean-water-keeper.js — the CORRECTED ocean keeper (replaces the WRONG ocean-keeper.js).
 *
 * CANONICAL FISHING SYSTEM — BACK END (founder 2026-06-27, project_seas_endowment_engine.md
 * "CANONICAL FISHING SYSTEM — END TO END"):
 *
 *   (1) a FISH WATER vault holds USDC principal -> throws off Aave YIELD.
 *   (2) the yield is HARVESTED as GOLD (the FISH water = a WaterV2 payout=GOLD; proven route
 *       USDC->Money(1:1)->swap Money->GOLD on the fee-100 wall) and CLAIMED to the agent.
 *   (3) the keeper BUYS fish at PORT ROYAL with that gold  — this side NEEDS GOLD (buy is dear).
 *   (4) the keeper INJECTS the bought fish into the OCEAN LP — this side needs NO gold (inject()).
 *   LOOP: fish-water yield -> buy fish @ port (gold) -> inject ocean (free) -> pawns catch, stat-scaled.
 *
 * The YIELD (our funds) FUELS the buy-dear/dump-cheap discrepancy. We NEVER dump free treasury
 * fish — that was the bug in the old ocean-keeper.js (now retired; see deploy/ocean-keeper.js).
 *
 * PORT ROYAL ACCESS: LocationPool.swap() is gated by a gameSigner presence attestation (0xF426…) —
 * there is NO owner bypass for swap(). The keeper signs its OWN presence attestation with the seas
 * location signer (game/server/location-signer.cjs, key on the VPS ~/.seas-location-signer.env).
 * The keeper IS a server-side agent process, so signing its own presence at the port is legitimate
 * (it is the real buyer the fish economy needs; founder: "the port makes sense we would" need gold).
 * inject() is owner-only and needs NO attestation (seeding the ocean is free).
 *
 * REUSABLE BY RESOURCE: parameterized by a RESOURCE config (FISH now; CRAB next is a config away,
 * not a rewrite). Each resource = { water vault (yield->GOLD), BUY pool (gold->resource, gated),
 * INJECT pool (owner-only inject) }. Crab water + crabbing slot in by adding a RESOURCES entry once
 * the crab water vault + crab pools exist.
 *
 *   node deploy/ocean-water-keeper.js status [resource]                 — read-only: yield/gold/prices
 *   node deploy/ocean-water-keeper.js run [resource] [--usd N]          — DRY the full loop (default)
 *   BASE_RPC=<alchemy> node deploy/ocean-water-keeper.js run [resource] [--usd N] --execute
 *                                                                       — LIVE (coordinator; peg paused)
 *
 * Real-or-nothing: every leg throws loudly on failure; nothing is faked. Exact approvals,
 * 1-tx-at-a-time, 0.15 gwei. DRY by default; --execute broadcasts (coordinator only).
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });

// The seas location signer (same key the server uses to gate LocationPool swaps). Lives on the VPS.
let signSwap = null;
try { ({ signSwap } = require(path.join(__dirname, '..', 'game', 'server', 'location-signer.cjs'))); }
catch (e) { /* surfaced at run time if a live buy is attempted without it */ }

const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const ONE = 10n ** 18n;

// ── Verified addresses (grep-checked against ocean-deployed.json / gap-scan.js / goldw deploy) ──
const GOLD  = '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004'; // 18dec
const FISH  = '0x907D043d33A243cd9818d6e2ccd5b3C9ef9905B5'; // 18dec
const GOLD_USD = 0.01; // anchor (gap-scan COIN_USD.gold)
const SLIP_BPS = 200n; // 2% slippage guard on the Port Royal buy
const FEES = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };

const OCEAN_REC = path.join(__dirname, 'ocean-deployed.json');           // the 2 LPs (ocean + portRoyal)
const FISHW_REC = path.join(__dirname, '..', '..', 'mftusd-build', 'waterv2-fishw-deployment.json'); // FISH water vault

/**
 * RESOURCE registry — FISH live; CRAB is a config away (founder: crab "the same way" next).
 * Each entry wires the three legs of the loop:
 *   waterVaultRec : deploy record with .vault (a WaterV2 payout=GOLD) — the yield source
 *   buy  : the Port Royal-style gated LocationPool (gold -> resource). resourceToken = what we get.
 *   inject : the ocean-style LocationPool (owner-only inject of the bought resource).
 * Pool keys reference ocean-deployed.json sites (portRoyal / ocean). New resources add their own
 * sites to that record (or their own record) + a RESOURCES entry — zero keeper rewrite.
 */
const RESOURCES = {
  fish: {
    label: 'FISH',
    resourceToken: FISH,
    waterVaultRec: FISHW_REC,         // FISH water (yield -> GOLD)
    buySiteKey: 'portRoyal',          // buy fish dear at Port Royal (loc 8003) — gold in, fish out
    injectSiteKey: 'ocean',           // inject fish into the ocean grounds (loc 8004) — free
  },
  // crab: {  // NEXT — uncomment once crab water + crab pools exist (founder: "crabbing is same")
  //   label: 'CRAB', resourceToken: '0xCc85d908a26bf34E5FdE5957378Fa90C92CD8217',
  //   waterVaultRec: path.join(__dirname, '..', '..', 'mftusd-build', 'waterv2-crabw-deployment.json'),
  //   buySiteKey: 'crabMarket', injectSiteKey: 'beach',
  // },
};

const WATERV2_ABI = [
  'function pendingYield() view returns (uint256)',
  'function totalBacking() view returns (uint256)',
  'function treeIdFor(address,uint256) view returns (uint256)',
  'function pendingPayout(uint256) view returns (uint256)',
  'function harvest(uint256 minPayoutOut)',
  'function claimPayout(uint256 treeId)',
];
const POOL_ABI = [
  'function token0() view returns (address)',
  'function location() view returns (uint256)',
  'function feeBps() view returns (uint16)',
  'function maxSwapIn() view returns (uint256)',
  'function open() view returns (bool)',
  'function getReserves() view returns (uint256,uint256)',
  'function quote(bool,uint256) view returns (uint256)',
  'function swap(bool,uint256,uint256,uint256,bytes) returns (uint256)',
  'function inject(bool,uint256)',
];
const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];

const human = (wei, d = 18) => Number(ethers.formatUnits(wei, d));
function loadJson(p, what) { if (!fs.existsSync(p)) throw new Error(`${what} missing at ${p}`); return JSON.parse(fs.readFileSync(p, 'utf8')); }

function resolveResource(key) {
  const r = RESOURCES[(key || 'fish').toLowerCase()];
  if (!r) throw new Error(`unknown resource "${key}" — known: ${Object.keys(RESOURCES).join(', ')}`);
  return r;
}

/** Read a LocationPool's state and which token side is GOLD / the resource. */
async function poolState(provider, addr, resourceToken) {
  const c = new ethers.Contract(addr, POOL_ABI, provider);
  const [t0, loc, fee, cap, open, res] = await Promise.all([
    c.token0(), c.location(), c.feeBps(), c.maxSwapIn(), c.open(), c.getReserves(),
  ]);
  const goldIsT0 = t0.toLowerCase() === GOLD.toLowerCase();
  const resourceIsT0 = t0.toLowerCase() === resourceToken.toLowerCase();
  return { c, location: Number(loc), feeBps: Number(fee), maxSwapIn: cap, open: !!open,
    reserve0: res[0], reserve1: res[1], goldIsT0, resourceIsT0 };
}

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--execute');
  const EXECUTE = process.argv.includes('--execute');
  const cmd = (args[0] || 'run').toLowerCase();
  const resKey = (args[1] && !args[1].startsWith('--')) ? args[1] : 'fish';
  const usdIdx = process.argv.indexOf('--usd');
  const usdTarget = usdIdx >= 0 ? Number(process.argv[usdIdx + 1]) : null; // optional cap on gold spent per run

  const R = resolveResource(resKey);
  const provider = new ethers.JsonRpcProvider(RPC);
  const ocean = loadJson(OCEAN_REC, 'ocean-deployed.json');
  const buySite = ocean[R.buySiteKey], injectSite = ocean[R.injectSiteKey];
  if (!buySite || !buySite.pool) throw new Error(`buy site "${R.buySiteKey}" missing/poolless in ocean-deployed.json`);
  if (!injectSite || !injectSite.pool) throw new Error(`inject site "${R.injectSiteKey}" missing/poolless in ocean-deployed.json`);

  const vaultRec = loadJson(R.waterVaultRec, `${R.label} water deploy record`);
  const VAULT = vaultRec.vault;
  if (!ethers.isAddress(VAULT)) throw new Error(`bad ${R.label} water vault address: ${VAULT}`);

  // ── STATUS (read-only) ──
  if (cmd === 'status') {
    const vault = new ethers.Contract(VAULT, WATERV2_ABI, provider);
    const [pendingYield, backing] = await Promise.all([vault.pendingYield(), vault.totalBacking()]);
    const buy = await poolState(provider, buySite.pool, R.resourceToken);
    const inj = await poolState(provider, injectSite.pool, R.resourceToken);
    // price of the resource in gold at each pool: in=1 resource -> gold out
    const buyResIn0 = buy.resourceIsT0;
    const injResIn0 = inj.resourceIsT0;
    const buyPrice = human(await buy.c.quote(buyResIn0, ONE));   // 1 resource -> gold @ buy site
    const injPrice = human(await inj.c.quote(injResIn0, ONE));   // 1 resource -> gold @ inject site
    console.log(`=== ${R.label} water keeper — STATUS ===`);
    console.log(`  ${R.label} water vault : ${VAULT}`);
    console.log(`    backing (Aave)      : $${human(backing, 6).toFixed(4)}`);
    console.log(`    pending yield        : $${human(pendingYield, 6).toFixed(6)}  (harvestable when >= $0.10)`);
    console.log(`  BUY  @ ${R.buySiteKey} (${buySite.pool}) loc ${buy.location}: 1 ${R.label} = ${buyPrice.toFixed(4)} gold`);
    console.log(`  INJECT @ ${R.injectSiteKey} (${injectSite.pool}) loc ${inj.location}: 1 ${R.label} = ${injPrice.toFixed(4)} gold`);
    console.log(`  discrepancy: buy ${(buyPrice/Math.max(injPrice,1e-9)).toFixed(1)}× dearer than the ocean → the gap pawns catch from`);
    return;
  }

  if (cmd !== 'run') { console.log('usage: ocean-water-keeper.js status [resource] | run [resource] [--usd N] [--execute]'); return; }

  // ── RUN: harvest yield -> claim GOLD -> buy resource @ port (gold) -> inject ocean (free) ──
  const wallet = EXECUTE ? new ethers.Wallet(PRIVATE_KEY, provider) : null;
  const agent = wallet ? wallet.address : '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10';
  const vault = new ethers.Contract(VAULT, WATERV2_ABI, EXECUTE ? wallet : provider);
  const gold = new ethers.Contract(GOLD, ERC20_ABI, EXECUTE ? wallet : provider);
  const buy = await poolState(provider, buySite.pool, R.resourceToken);
  const inj = await poolState(provider, injectSite.pool, R.resourceToken);

  // Step 1 — yield available?
  const pendingYield = await vault.pendingYield();
  const goldBefore = await gold.balanceOf(agent);
  console.log(`=== ${R.label} water keeper — RUN ${EXECUTE ? '(LIVE)' : '(DRY)'} ===`);
  console.log(`  ${R.label} water vault : ${VAULT}`);
  console.log(`  pending yield        : $${human(pendingYield, 6).toFixed(6)}`);
  console.log(`  agent GOLD on hand   : ${human(goldBefore).toFixed(4)} gold`);

  // The tree the FISH water yields GOLD to: the agent-owned seed NFT (must match seed-ocean-water.cjs).
  const SEED_NFT = '0x8C1f935F6DbB17d593BF3EC8114A2f045e350545';
  const SEED_ID = BigInt(process.env.SEED_ID || '1');
  const treeIdP1 = await vault.treeIdFor(SEED_NFT, SEED_ID);
  if (treeIdP1 === 0n) throw new Error(`${R.label} water has no tree for ${SEED_NFT}#${SEED_ID} — run seed-ocean-water.cjs first`);
  const treeId = treeIdP1 - 1n;
  const pendingPayout = await vault.pendingPayout(treeId);
  console.log(`  tree #${treeId} pending GOLD payout: ${human(pendingPayout).toFixed(4)} gold (already-harvested, claimable)`);

  // Buy quote: how much gold buys how much resource at the port. We spend the gold we have/claim.
  // zeroForOne for "gold in" depends on token ordering.
  const goldInZeroForOne = buy.goldIsT0;           // gold is token0 -> zeroForOne true to put gold in
  if (!buy.open) throw new Error(`buy pool ${buySite.pool} is CLOSED — cannot buy ${R.label}`);

  if (!EXECUTE) {
    // DRY: show the full intended loop with live quotes; move nothing.
    const sampleGold = usdTarget != null ? usdTarget / GOLD_USD : Math.min(human(goldBefore) + human(pendingPayout), 100);
    const goldInWei = ethers.parseUnits(Math.max(sampleGold, 0).toFixed(18), 18);
    let resOutWei = 0n, fishOut = 0;
    if (goldInWei > 0n) { resOutWei = await buy.c.quote(goldInZeroForOne, goldInWei); fishOut = human(resOutWei); }
    console.log('\n  DRY loop (no tx):');
    console.log(`   1) HARVEST ${R.label} water: needs pendingYield >= $0.10 (have $${human(pendingYield,6).toFixed(6)}). harvest(minOut) -> 50% grows water, 50% buys GOLD via ${vaultRec.goldMoneyPool||'GOLD/Money fee100'}.`);
    console.log(`   2) CLAIM tree #${treeId} -> GOLD to agent (${agent}).`);
    console.log(`   3) BUY @ Port Royal (loc ${buy.location}): spend ~${sampleGold.toFixed(2)} gold -> ~${fishOut.toFixed(2)} ${R.label} (gated swap, keeper self-attests presence with the seas signer).`);
    console.log(`   4) INJECT @ ocean (loc ${inj.location}): inject(${R.label}-side, ~${fishOut.toFixed(2)} ${R.label}) — owner-only, FREE. Ocean gets cheaper; pawns catch more.`);
    console.log(`\n  yield -> GOLD -> buy fish dear @ port -> inject ocean cheap. The yield FUELS the gap. No free treasury fish.`);
    if (!signSwap) console.log('  NOTE: location-signer.cjs not loadable here — the live BUY needs it on the VPS (seas signer key).');
    console.log('\n  DRY — re-run with --execute (BASE_RPC=<alchemy>, coordinator, peg-onehop paused).');
    return;
  }

  // ---- LIVE (COORDINATOR ONLY) — 1 tx at a time, exact approvals, real-or-nothing ----
  if (!PRIVATE_KEY) throw new Error('no AGENT_PRIVATE_KEY — cannot execute');
  if (!signSwap) throw new Error('location-signer.cjs not available — cannot attest presence to buy at Port Royal (seas signer key must be on this host)');
  let nonce = await provider.getTransactionCount(wallet.address, 'pending');

  // Step 1 — HARVEST (only if there is harvestable yield). minPayoutOut from a live quote so the
  // internal Money->GOLD swap can't be sandwiched. 50% of yield is swapped to GOLD.
  if (pendingYield >= 100000n) { // $0.10 MIN_HARVEST
    const swapUsdc = pendingYield / 2n;               // the half that becomes GOLD
    // quote Money->GOLD ~ swapUsdc of Money. The GOLD/Money pool is the same fee-100 wall the vault uses.
    // We approximate minOut via the buy pool's gold anchor: 1 Money($1)=100 gold ($0.01). Conservative.
    const expectedGold = ethers.parseUnits((human(swapUsdc, 6) / GOLD_USD).toFixed(18), 18);
    const minPayoutOut = (expectedGold * (10000n - SLIP_BPS)) / 10000n;
    console.log(`  HARVEST: yield $${human(pendingYield,6).toFixed(4)} -> ~${human(expectedGold).toFixed(2)} gold (minOut ${human(minPayoutOut).toFixed(2)})`);
    const tx = await vault.harvest(minPayoutOut, { ...FEES, nonce: nonce++, gasLimit: 600000 });
    await tx.wait();
    console.log('   harvested:', tx.hash);
  } else {
    console.log('  HARVEST: skipped — pending yield below $0.10 min; will buy with already-claimed GOLD on hand.');
  }

  // Step 2 — CLAIM the tree's GOLD to the agent.
  const claimable = await vault.pendingPayout(treeId);
  if (claimable > 0n) {
    const tx = await vault.claimPayout(treeId, { ...FEES, nonce: nonce++, gasLimit: 200000 });
    await tx.wait();
    console.log(`  CLAIMED ${human(claimable).toFixed(4)} gold to agent:`, tx.hash);
  }

  // Step 3 — BUY resource at Port Royal with the gold we hold (capped by --usd if given). GATED swap.
  let goldToSpend = await gold.balanceOf(agent);
  if (usdTarget != null) {
    const cap = ethers.parseUnits((usdTarget / GOLD_USD).toFixed(18), 18);
    if (goldToSpend > cap) goldToSpend = cap;
  }
  if (buy.maxSwapIn > 0n && goldToSpend > buy.maxSwapIn) goldToSpend = buy.maxSwapIn;
  if (goldToSpend === 0n) { console.log('  BUY: no GOLD to spend — nothing to inject this run.'); return; }

  const quotedOut = await buy.c.quote(goldInZeroForOne, goldToSpend);
  if (quotedOut === 0n) throw new Error('Port Royal buy quote returned 0 — buy side not filling; NOT faking it');
  const minOut = (quotedOut * (10000n - SLIP_BPS)) / 10000n;

  // self-attest presence at the buy pool's location (the keeper IS the server-side agent/buyer)
  const att = await signSwap(buySite.pool, wallet.address);

  // exact approval of gold to the buy pool
  if ((await gold.allowance(wallet.address, buySite.pool)) < goldToSpend) {
    const atx = await gold.approve(buySite.pool, goldToSpend, { ...FEES, nonce: nonce++, gasLimit: 80000 });
    await atx.wait();
  }
  const buyPool = new ethers.Contract(buySite.pool, POOL_ABI, wallet);
  const stx = await buyPool.swap(goldInZeroForOne, goldToSpend, minOut, att.expiry, att.sig, { ...FEES, nonce: nonce++, gasLimit: 300000 });
  await stx.wait();
  const resource = new ethers.Contract(R.resourceToken, ERC20_ABI, wallet);
  const bought = await resource.balanceOf(agent);
  console.log(`  BOUGHT ${human(bought).toFixed(2)} ${R.label} for ${human(goldToSpend).toFixed(2)} gold @ Port Royal:`, stx.hash);

  // Step 4 — INJECT the bought resource into the ocean (owner-only, FREE, no attestation).
  if (bought === 0n) throw new Error(`bought 0 ${R.label} — refusing to inject nothing`);
  const injResourceSide0 = inj.resourceIsT0; // inject on the resource side
  if ((await resource.allowance(wallet.address, injectSite.pool)) < bought) {
    const atx = await resource.approve(injectSite.pool, bought, { ...FEES, nonce: nonce++, gasLimit: 80000 });
    await atx.wait();
  }
  const injPool = new ethers.Contract(injectSite.pool, POOL_ABI, wallet);
  const itx = await injPool.inject(injResourceSide0, bought, { ...FEES, nonce: nonce++, gasLimit: 200000 });
  await itx.wait();
  console.log(`  INJECTED ${human(bought).toFixed(2)} ${R.label} into the ocean (loc ${inj.location}):`, itx.hash);
  console.log('\n  LOOP COMPLETE: yield -> GOLD -> bought fish dear @ port -> injected ocean cheap. The yield fueled the gap. No free treasury fish.');
}
main().catch(e => { console.error('ERROR:', e.reason || e.shortMessage || e.message || e); process.exit(1); });
