#!/usr/bin/env node
/**
 * deploy-location-lp.js — Deploy the location-keyed LP system for "Seize the Seas":
 *
 *   1) LocationPool      — the x*y=k clone TEMPLATE (no funds; just the implementation).
 *   2) game-signer key   — a DEDICATED keypair whose private key the game backend holds to
 *                          sign position attestations {pool, player, location, expiry, chainid}.
 *                          Stored OUTSIDE the repo (~/.seas-location-signer.env), rotatable
 *                          on-chain any time via factory.setSigner(newAddr).
 *   3) LocationLPFactory  — clones pools per (location x token pair); holds owner + gameSigner.
 *
 * The factory holds NO funds and the pools are ADD-ONLY (seed/inject, never admin-withdraw).
 * This deploys the machinery only — pools are created + seeded separately (Port Royal first).
 *
 * Usage:  node deploy/deploy-location-lp.js            (DRY RUN — prints plan, sends nothing)
 *         node deploy/deploy-location-lp.js --execute  (broadcasts to Base mainnet)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const os = require('os');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found in env'); process.exit(1); }

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

const SIGNER_ENV = path.join(os.homedir(), '.seas-location-signer.env');
const OUT = path.join(__dirname, 'location-lp-deployed.json');

function loadArtifact(name) {
  return require(path.join(__dirname, '..', 'artifacts', 'contracts', `${name}.sol`, `${name}.json`));
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const treasury = wallet.address;

  const bal = await provider.getBalance(treasury);
  console.log('Treasury / deployer:', treasury);
  console.log('ETH balance        :', ethers.formatEther(bal), 'ETH');
  console.log('Mode               :', EXECUTE ? 'EXECUTE (broadcasting)' : 'DRY RUN (nothing sent)');
  console.log('');

  // ── game signer key: reuse if it already exists, else generate a fresh one ───────────────
  let signerWallet;
  if (fs.existsSync(SIGNER_ENV)) {
    const existing = fs.readFileSync(SIGNER_ENV, 'utf8').match(/SEAS_LOCATION_SIGNER_KEY=(0x[0-9a-fA-F]{64})/);
    if (!existing) throw new Error(`signer env ${SIGNER_ENV} exists but has no SEAS_LOCATION_SIGNER_KEY`);
    signerWallet = new ethers.Wallet(existing[1]);
    console.log('Game signer        :', signerWallet.address, '(reused from', SIGNER_ENV + ')');
  } else {
    signerWallet = ethers.Wallet.createRandom();
    console.log('Game signer        :', signerWallet.address, '(NEW — will write key to', SIGNER_ENV + ')');
  }
  console.log('');
  console.log('Plan:');
  console.log('  1. deploy LocationPool implementation (template, no funds)');
  console.log('  2. deploy LocationLPFactory(impl, gameSigner) — owner = treasury');
  console.log('  3. save addresses ->', OUT);
  console.log('');

  if (!EXECUTE) {
    console.log('DRY RUN complete. Re-run with --execute to deploy.');
    return;
  }

  if (bal < ethers.parseEther('0.0005')) {
    console.error('Refusing to deploy: ETH balance too low.');
    process.exit(1);
  }

  // Persist the signer key FIRST (before it's referenced on-chain) so we never lose it.
  if (!fs.existsSync(SIGNER_ENV)) {
    fs.writeFileSync(SIGNER_ENV,
      `# Seize the Seas — location-pool game attestation signer (rotatable via factory.setSigner)\n` +
      `SEAS_LOCATION_SIGNER_KEY=${signerWallet.privateKey}\n` +
      `SEAS_LOCATION_SIGNER_ADDR=${signerWallet.address}\n`,
      { mode: 0o600 });
    console.log('Wrote signer key to', SIGNER_ENV, '(keep this safe + out of git)');
  }

  // Low, basefee-clearing fee (per tx-pacing notes) — cheap at Base levels.
  const fees = { maxFeePerGas: ethers.parseUnits('0.1', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  let nextNonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await provider.getTransactionCount(treasury, 'pending');

  // 1. LocationPool implementation
  const poolArt = loadArtifact('LocationPool');
  const PoolF = new ethers.ContractFactory(poolArt.abi, poolArt.bytecode, wallet);
  console.log(`Deploying LocationPool implementation ... (nonce ${nextNonce})`);
  const impl = await PoolF.deploy({ ...fees, nonce: nextNonce }); nextNonce++;
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log('  LocationPool impl  :', implAddr);

  // 2. LocationLPFactory
  const facArt = loadArtifact('LocationLPFactory');
  const FacF = new ethers.ContractFactory(facArt.abi, facArt.bytecode, wallet);
  console.log(`Deploying LocationLPFactory ... (nonce ${nextNonce})`);
  const factory = await FacF.deploy(implAddr, signerWallet.address, { ...fees, nonce: nextNonce }); nextNonce++;
  await factory.waitForDeployment();
  const facAddr = await factory.getAddress();
  console.log('  LocationLPFactory  :', facAddr);

  // verify wiring
  const f = new ethers.Contract(facAddr, [
    'function owner() view returns (address)',
    'function gameSigner() view returns (address)',
    'function implementation() view returns (address)',
  ], provider);
  const [o, gs, im] = await Promise.all([f.owner(), f.gameSigner(), f.implementation()]);
  if (o.toLowerCase() !== treasury.toLowerCase()) throw new Error(`owner mismatch: ${o}`);
  if (gs.toLowerCase() !== signerWallet.address.toLowerCase()) throw new Error(`signer mismatch: ${gs}`);
  if (im.toLowerCase() !== implAddr.toLowerCase()) throw new Error(`impl mismatch: ${im}`);
  console.log('  verified: owner=treasury, gameSigner set, implementation set');

  const record = {
    chain: 'base', chainId: 8453, treasury, deployedAt: new Date().toISOString(),
    implementation: implAddr, factory: facAddr, gameSigner: signerWallet.address,
    signerKeyFile: SIGNER_ENV,
    locationIdScheme: 'q*1000 + r  (hex coords from game/lib/location.js)',
    locations: { port_royal: { q: 8, r: 3, locationId: 8003 } },
  };
  fs.writeFileSync(OUT, JSON.stringify(record, null, 2));
  console.log('\nSaved addresses to', OUT);
  console.log('\nNext: create + seed Port Royal pools (deploy/seed-port-royal.js).');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
