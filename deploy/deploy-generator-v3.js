#!/usr/bin/env node
/**
 * deploy-generator-v3.js — Deploy ImpactGenerator V3 (atomic deposit via onERC721Received)
 *
 * Fix: onERC721Received now auto-registers positions with `from` as depositor.
 * No more orphan window where anyone could steal unregistered NFTs.
 *
 * Usage: node deploy/deploy-generator-v3.js
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load agent wallet
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';

// Base mainnet addresses
const MONEY   = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';
const PM      = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const ROUTER  = '0x2626664c2603336E57B271c5C0b26F421741e481';
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log('Deployer:', wallet.address);

  const bal = await provider.getBalance(wallet.address);
  console.log('ETH balance:', ethers.formatEther(bal));
  if (bal < ethers.parseEther('0.001')) {
    console.error('Not enough ETH for deployment');
    process.exit(1);
  }

  // Load compiled bytecode and ABI
  const binPath = path.join(__dirname, '..', 'build', 'contracts_ImpactGenerator_sol_ImpactGenerator.bin');
  const abiPath = path.join(__dirname, '..', 'build', 'contracts_ImpactGenerator_sol_ImpactGenerator.abi');
  const bytecode = '0x' + fs.readFileSync(binPath, 'utf8').trim();
  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

  console.log('Bytecode size:', (bytecode.length - 2) / 2, 'bytes');
  console.log('\nDeploying ImpactGenerator V3...');

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('Deployed at:', addr);

  console.log('\nInitializing...');
  const tx = await contract.initialize(MONEY, PM, ROUTER, FACTORY);
  await tx.wait();
  console.log('Initialized! Admin:', wallet.address);

  console.log('\n=== ImpactGenerator V3 ===');
  console.log('Address:', addr);
  console.log('Money:', MONEY);
  console.log('Admin:', wallet.address);
  console.log('\nNext steps:');
  console.log('1. Update GENERATOR address in site/generator.html');
  console.log('2. Withdraw positions from V2 (0xe0cD43F031A9F8b3C5A2eB89EA0B1fCa06B6C4b1)');
  console.log('3. Send positions to V3 via safeTransferFrom — auto-registers atomically');
  console.log('4. Verify on Basescan');
}

main().catch(e => { console.error(e); process.exit(1); });
