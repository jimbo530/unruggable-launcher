#!/usr/bin/env node
/**
 * deploy-forageables.js — FORAGEABLE raw goods for the Seas wild-economy (founder 2026-06-26:
 * "black berry and blue berry token … work an empty grass or forest space to get some … also meat
 * tokens, fish, bear, elk, pork"). These are GATHERED in the field (forage/hunt jobs at wild hexes),
 * not bought — they feed pawns on expedition (upkeep food) AND seed crafting (berries → WINE, etc.).
 *
 * GATING DOCTRINE (founder): everything MADE/GATHERED in-game has IN-GAME-ONLY supply — no public
 * sell wall. We mint the fixed cap to the treasury, then DISPENSE only via gameplay (forage grants)
 * and trade only through GATED LocationPools. No open buy path → wine + magic items + all the RP
 * goods become a genuinely scarce, player-driven economy.
 *
 * LaunchToken (fixed supply, no owner/mint, 18 dec), uniform 100B each, 100% to treasury.
 * Resume-safe (skips recorded), retries the flaky RPC reads. Use Alchemy: BASE_RPC=<alchemy>.
 *
 * Usage:  node deploy/deploy-forageables.js            (DRY RUN)
 *         BASE_RPC=<alchemy> node deploy/deploy-forageables.js --execute
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
const OUT = path.join(__dirname, 'forageables-deployed.json');

// id, name, symbol, kind, terrain (where it's foraged/hunted), food (morale value via upkeep)
const FORAGEABLES = [
  { id: 'blackberry', name: 'Blackberry', symbol: 'BLKBRY', kind: 'berry', terrain: ['forest','plains'], food: 1 },
  { id: 'blueberry',  name: 'Blueberry',  symbol: 'BLUBRY', kind: 'berry', terrain: ['forest','plains'], food: 1 },
  { id: 'fish',       name: 'Fish',       symbol: 'FISH',   kind: 'meat',  terrain: ['water'],            food: 3 },
  { id: 'crab',       name: 'Crab',       symbol: 'CRAB',   kind: 'meat',  terrain: ['water'],            food: 3 },
  { id: 'pork',       name: 'Pork',       symbol: 'PORK',   kind: 'meat',  terrain: ['plains'],           food: 4 },
  { id: 'elk',        name: 'Elk',        symbol: 'ELK',    kind: 'meat',  terrain: ['forest'],           food: 5 },
  { id: 'bear',       name: 'Bear',       symbol: 'BEAR',   kind: 'meat',  terrain: ['forest'],           food: 5 },
];

async function retryRead(fn, tries = 8) { for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { if (i === tries-1) throw e; await new Promise(r=>setTimeout(r,2500)); } } }

async function main() {
  const artifact = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'LaunchToken.sol', 'LaunchToken.json'));
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const treasury = wallet.address;
  const rec = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { chain: 'base', chainId: 8453, treasury, forageables: {} };
  if (!rec.forageables) rec.forageables = {};
  const todo = FORAGEABLES.filter((m) => !rec.forageables[m.id]);

  console.log('Treasury:', treasury, ' ETH:', ethers.formatEther(await retryRead(() => provider.getBalance(treasury))));
  console.log('Forageables:', FORAGEABLES.map(m => m.symbol).join(', '), ' | to mint:', todo.length, ' | 100B each (GATED — no public wall)');
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
    rec.forageables[m.id] = { id: m.id, name: m.name, symbol: m.symbol, address: addr, decimals: 18, kind: m.kind, terrain: m.terrain, food: m.food, whole: SUPPLY.toString() };
    fs.writeFileSync(OUT, JSON.stringify(rec, null, 2));
  }
  console.log(`\nDone. ${Object.keys(rec.forageables).length} forageable tokens in ${path.basename(OUT)}.`);
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
