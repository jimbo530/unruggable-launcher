#!/usr/bin/env node
/**
 * deploy-gear-armory.js — Mint the FULL Seize the Seas gear armory as ERC20s (founder
 * 2026-06-25: "list and mint all other gear tokens we want from equipment lists", full
 * 155 incl. steel, uniform 100B supply each).
 *
 * Source of truth = game/battle-grid/gear-data.js buildArmory() (155 items: 133 weapons
 * across 49 types × material tiers, 18 armor, 4 trinkets). Each → a LaunchToken (fixed
 * supply, no owner/mint, 18 dec, 100% to treasury). id = armory id (e.g. longsword-iron);
 * `gold` (book price × material mult) is recorded for the Port Royal wall step.
 *
 * RESUME-SAFE: merges into deploy/gear-deployed.json and SKIPS ids already recorded (so the
 * 12 already-deployed sword/spear/shield pieces are untouched). Retries the flaky RPC reads,
 * explicit nonce + low fee, writes after each token. Use Alchemy: BASE_RPC=<alchemy url>.
 *
 * Usage:  node deploy/deploy-gear-armory.js            (DRY RUN — prints the full list)
 *         BASE_RPC=<alchemy> node deploy/deploy-gear-armory.js --execute
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');
const DECIMALS = 18n, ONE = 10n ** DECIMALS;
const SUPPLY = 100_000_000_000n;            // uniform 100B per token (founder)
const OUT = path.join(__dirname, 'gear-deployed.json');
// Budget-aware: mint until ETH hits MIN_ETH (leave gas headroom), then stop cleanly
// (resume-safe — re-run after a top-up to continue). Optional MAX_MINT caps the batch.
const MIN_ETH_WEI = (s => 10n ** 18n / 1000n * BigInt(Math.round(parseFloat(s) * 1000)))(process.env.MIN_ETH || '0.0008');
const MAX_MINT = process.env.MAX_MINT ? Number(process.env.MAX_MINT) : Infinity;

const symbolFor = (id) => id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
async function retryRead(fn, tries = 8) {
  for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { if (i === tries-1) throw e; await new Promise(r=>setTimeout(r,2500)); } }
}

async function main() {
  const { buildArmory } = await import('../game/battle-grid/gear-data.js');
  const armory = buildArmory();
  const list = Object.values(armory).filter((it) => !it.crafted).map((it) => {
    const gold = (typeof it.gold === 'number' && it.gold > 0) ? it.gold
      : (it.priceCp ? it.priceCp / 100 : 0);
    return { id: it.id, name: it.name, slot: it.slot, material: it.material || null, gold, symbol: symbolFor(it.id) };
  }).filter((g) => g.gold > 0);

  const artifact = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'LaunchToken.sol', 'LaunchToken.json'));
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const treasury = wallet.address;

  const record = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { chain: 'base', chainId: 8453, treasury, gear: {} };
  if (!record.gear) record.gear = {};
  const todo = list.filter((g) => !record.gear[g.id]);

  const bal = await retryRead(() => provider.getBalance(treasury));
  console.log('Treasury:', treasury, ' ETH:', ethers.formatEther(bal), ' RPC:', RPC.includes('alchemy') ? 'alchemy' : 'public');
  console.log(`Armory: ${list.length} items · already deployed: ${list.length - todo.length} · TO MINT: ${todo.length}`);
  console.log('Mode:', EXECUTE ? 'EXECUTE' : 'DRY RUN', ' supply: 100B each\n');

  // rough cost estimate (LaunchToken deploy ~ 0.00002–0.00006 ETH at 0.1 gwei)
  const estEth = (todo.length * 0.00006).toFixed(4);
  console.log(`Est. mint cost ~${estEth} ETH (walls are a separate step).`);
  if (!EXECUTE) {
    console.log('\nFirst 15 to mint:');
    for (const g of todo.slice(0, 15)) console.log(`  ${g.symbol.padEnd(11)} ${g.id.padEnd(22)} ${String(g.gold).padStart(7)}g  ${g.name}`);
    if (todo.length > 15) console.log(`  … +${todo.length - 15} more`);
    console.log('\nDRY RUN. Re-run with --execute (BASE_RPC=<alchemy>).');
    return;
  }
  if (bal <= MIN_ETH_WEI) {
    console.error(`ETH (${ethers.formatEther(bal)}) at/below floor ${ethers.formatEther(MIN_ETH_WEI)} — nothing to mint.`); process.exit(1);
  }
  console.log(`Budget mode: minting until ETH floor ${ethers.formatEther(MIN_ETH_WEI)} (resume-safe)${MAX_MINT!==Infinity?`, max ${MAX_MINT}`:''}.`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const fees = { maxFeePerGas: ethers.parseUnits('0.1','gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02','gwei') };
  let nextNonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await retryRead(() => provider.getTransactionCount(treasury, 'pending'));

  let n = 0;
  for (const g of todo) {
    if (n >= MAX_MINT) { console.log(`MAX_MINT ${MAX_MINT} reached — stopping (resume later).`); break; }
    const curBal = await retryRead(() => provider.getBalance(treasury));
    if (curBal <= MIN_ETH_WEI) { console.log(`\nETH floor reached (${ethers.formatEther(curBal)}) — stopping after ${n} mints. Re-run after a top-up to continue.`); break; }
    const supply = SUPPLY * ONE;
    console.log(`[${++n}/${todo.length}] ${g.symbol} (${g.name}) nonce ${nextNonce} …`);
    const token = await factory.deploy(g.name, g.symbol, supply, treasury, '', { ...fees, nonce: nextNonce++ });
    await token.waitForDeployment();
    const addr = await token.getAddress();
    const t = new ethers.Contract(addr, ['function totalSupply() view returns (uint256)'], provider);
    const ts = await retryRead(() => t.totalSupply());
    if (ts !== supply) throw new Error(`Supply mismatch ${g.symbol}: ${ts}`);
    console.log(`   ${g.id} -> ${addr}`);
    record.gear[g.id] = { id: g.id, name: g.name, symbol: g.symbol, address: addr, decimals: 18,
      slot: g.slot, material: g.material, gold: g.gold, whole: SUPPLY.toString(), supplyWei: supply.toString() };
    fs.writeFileSync(OUT, JSON.stringify(record, null, 2));
  }
  console.log(`\nDone. ${Object.keys(record.gear).length} total gear tokens in ${path.basename(OUT)}.`);
  console.log('Next: wall them — BASE_RPC=<alchemy> WALL_WHOLE=5000000 node deploy/deploy-port-royal-walls.js --execute');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
