#!/usr/bin/env node
/**
 * deploy-materials.js — RAW/REFINED material tokens for the Seas production lines (founder
 * 2026-06-25). First loop = LOGGING CAMP → LUMBER MILL → SHIPYARD, so we need:
 *   LOGS   — raw timber, cut at a logging camp (forest)
 *   LUMBER — milled planks, refined from logs at a lumber mill (feeds the shipyard)
 * (MINES later add ORE → METAL the same way — add rows below.)
 *
 * LaunchToken (fixed supply, no owner/mint, 18 dec), uniform 100B each, 100% to treasury.
 * Resume-safe (skips recorded), retries the flaky RPC reads. Use Alchemy: BASE_RPC=<alchemy>.
 *
 * Usage:  node deploy/deploy-materials.js            (DRY RUN)
 *         BASE_RPC=<alchemy> node deploy/deploy-materials.js --execute
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
const OUT = path.join(__dirname, 'materials-deployed.json');

// id, name, symbol, stage (for the production-line wiring later)
const MATERIALS = [
  { id: 'logs',   name: 'Logs',   symbol: 'LOGS',   stage: 'raw',     from: 'logging-camp' },
  { id: 'lumber', name: 'Lumber', symbol: 'LUMBER', stage: 'refined', from: 'lumber-mill' },
];

async function retryRead(fn, tries = 8) { for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { if (i === tries-1) throw e; await new Promise(r=>setTimeout(r,2500)); } } }

async function main() {
  const artifact = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'LaunchToken.sol', 'LaunchToken.json'));
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const treasury = wallet.address;
  const rec = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { chain: 'base', chainId: 8453, treasury, materials: {} };
  if (!rec.materials) rec.materials = {};
  const todo = MATERIALS.filter((m) => !rec.materials[m.id]);

  console.log('Treasury:', treasury, ' ETH:', ethers.formatEther(await retryRead(() => provider.getBalance(treasury))));
  console.log('Materials:', MATERIALS.map(m => m.symbol).join(', '), ' | to mint:', todo.length, ' | 100B each');
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
    rec.materials[m.id] = { id: m.id, name: m.name, symbol: m.symbol, address: addr, decimals: 18, stage: m.stage, from: m.from, whole: SUPPLY.toString() };
    fs.writeFileSync(OUT, JSON.stringify(rec, null, 2));
  }
  console.log(`\nDone. ${Object.keys(rec.materials).length} material tokens in ${path.basename(OUT)}.`);
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
