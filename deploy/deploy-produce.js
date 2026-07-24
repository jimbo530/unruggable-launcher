#!/usr/bin/env node
/**
 * deploy-produce.js — FARMED produce for the Seas vineyard/farm economy (founder 2026-06-26:
 * "vinyards and farms for difrent produce"). Grown at PRODUCTION buildings (world-features
 * PRODUCTION_TYPES: vineyard→grapes, farm→wheat/corn) on PLAINS hexes, NOT foraged by hand.
 * Feeds the craft chain (grapes → WINE) and the gated location-keyed pools.
 *
 * GATING DOCTRINE (founder): made-in-game = IN-GAME-ONLY supply — no public sell wall. Mint the
 * fixed cap to treasury, dispense only via farm production, trade only through gated LocationPools.
 *
 * LaunchToken (fixed supply, no owner/mint, 18 dec), uniform 100B each, 100% to treasury.
 * Resume-safe (skips recorded), retries the flaky RPC reads. Use Alchemy: BASE_RPC=<alchemy>.
 *
 * Usage:  node deploy/deploy-produce.js            (DRY RUN)
 *         BASE_RPC=<alchemy> node deploy/deploy-produce.js --execute
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');
const ONE = 10n ** 18n, SUPPLY = 100_000_000_000n;
const OUT = path.join(__dirname, 'produce-deployed.json');

// id, name, symbol, building (where it's grown), food (morale via upkeep), craftsInto (downstream)
const PRODUCE = [
  { id: 'grapes', name: 'Grapes', symbol: 'GRAPE', building: 'vineyard', food: 1, craftsInto: 'wine'  },
  { id: 'wheat',  name: 'Wheat',  symbol: 'WHEAT', building: 'farm',     food: 1, craftsInto: 'bread' },
  { id: 'corn',   name: 'Corn',   symbol: 'CORN',  building: 'farm',     food: 1, craftsInto: null    },
];

async function retryRead(fn, tries = 8) { for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { if (i === tries-1) throw e; await new Promise(r=>setTimeout(r,2500)); } } }

async function main() {
  const artifact = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'LaunchToken.sol', 'LaunchToken.json'));
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const treasury = wallet.address;
  const rec = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { chain: 'base', chainId: 8453, treasury, produce: {} };
  if (!rec.produce) rec.produce = {};
  const todo = PRODUCE.filter((m) => !rec.produce[m.id]);

  console.log('Treasury:', treasury, ' ETH:', ethers.formatEther(await retryRead(() => provider.getBalance(treasury))));
  console.log('Produce:', PRODUCE.map(m => m.symbol).join(', '), ' | to mint:', todo.length, ' | 100B each (GATED — no public wall)');
  console.log('Mode:', EXECUTE ? 'EXECUTE' : 'DRY RUN', '\n');
  if (!EXECUTE) { console.log('DRY RUN — re-run with --execute (BASE_RPC=<alchemy>).'); return; }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const fees = { maxFeePerGas: ethers.parseUnits('0.1', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  let nonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await retryRead(() => provider.getTransactionCount(treasury, 'pending'));

  for (const m of todo) {
    const supply = SUPPLY * ONE;
    console.log(`Deploying ${m.symbol} (${m.name}) nonce ${nonce} …`);
    const token = await factory.deploy(m.name, m.symbol, supply, treasury, '', { ...fees, nonce: nonce++ });
    await token.waitForDeployment();
    const addr = await token.getAddress();
    const ts = await retryRead(() => new ethers.Contract(addr, ['function totalSupply() view returns (uint256)'], provider).totalSupply());
    if (ts !== supply) throw new Error(`supply mismatch ${m.symbol}`);
    console.log(`  ${m.id} -> ${addr}`);
    rec.produce[m.id] = { id: m.id, name: m.name, symbol: m.symbol, address: addr, decimals: 18, building: m.building, food: m.food, craftsInto: m.craftsInto, whole: SUPPLY.toString() };
    fs.writeFileSync(OUT, JSON.stringify(rec, null, 2));
  }
  console.log(`\nDone. ${Object.keys(rec.produce).length} produce tokens in ${path.basename(OUT)}.`);
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
