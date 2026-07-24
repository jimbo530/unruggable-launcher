#!/usr/bin/env node
/**
 * deploy-coins.js — Deploy the three in-game currency tokens for Tales-of-Tasern.
 *
 *   Copper Coin (COPPER) — 1,000,000,000,000   (1 trillion)
 *   Silver Coin (SILVER) —   100,000,000,000   (100 billion)
 *   Gold Coin   (GOLD)   —    10,000,000,000   (10 billion)
 *
 * Conversion (defined by us, NOT a market price):
 *   10 copper = 1 silver,  10 silver = 1 gold,  100 copper = 1 gold
 *
 * Each tier holds the SAME total value (1 trillion copper-equivalent), which is
 * why the peg pools (deploy-coin-pools.js) come out perfectly balanced.
 *
 * Uses LaunchToken.sol — fixed supply, NO owner, NO mint, NO burn, immutable.
 * 100% of each supply mints to the treasury (the deployer wallet itself).
 *
 * Usage:  node deploy/deploy-coins.js          (DRY RUN — prints plan, sends nothing)
 *         node deploy/deploy-coins.js --execute (broadcasts to Base mainnet)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found in env'); process.exit(1); }

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

// LaunchToken constructor: (name, symbol, supply, recipient, baseURI)
const DECIMALS = 18n;
const ONE = 10n ** DECIMALS;
const COINS = [
  { name: 'Copper Coin', symbol: 'COPPER', whole: 1_000_000_000_000n }, // 1T
  { name: 'Silver Coin', symbol: 'SILVER', whole:   100_000_000_000n }, // 100B
  { name: 'Gold Coin',   symbol: 'GOLD',   whole:    10_000_000_000n }, // 10B
];

const OUT = path.join(__dirname, 'coins-deployed.json');

async function main() {
  const artifact = require(path.join(
    __dirname, '..', 'artifacts', 'contracts', 'LaunchToken.sol', 'LaunchToken.json'
  ));

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const treasury = wallet.address;

  const bal = await provider.getBalance(treasury);
  console.log('Treasury / deployer:', treasury);
  console.log('ETH balance        :', ethers.formatEther(bal), 'ETH');
  console.log('Mode               :', EXECUTE ? 'EXECUTE (broadcasting)' : 'DRY RUN (nothing sent)');
  console.log('');

  console.log('Planned tokens:');
  for (const c of COINS) {
    console.log(`  ${c.symbol.padEnd(6)} ${c.name.padEnd(12)} supply ${c.whole.toLocaleString()} (= ${c.whole}e18)`);
  }
  console.log('');

  if (!EXECUTE) {
    console.log('DRY RUN complete. Re-run with --execute to deploy.');
    return;
  }

  if (bal < ethers.parseEther('0.0003')) {
    console.error('Refusing to deploy: ETH balance too low for 3 deploys.');
    process.exit(1);
  }

  const deployed = {};
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  for (const c of COINS) {
    const supply = c.whole * ONE;
    console.log(`Deploying ${c.symbol} ...`);
    const token = await factory.deploy(c.name, c.symbol, supply, treasury, '');
    await token.waitForDeployment();
    const addr = await token.getAddress();
    console.log(`  ${c.symbol} deployed at ${addr}`);

    // Verify supply landed in treasury
    const t = new ethers.Contract(addr, [
      'function totalSupply() view returns (uint256)',
      'function balanceOf(address) view returns (uint256)',
    ], provider);
    const ts = await t.totalSupply();
    const tb = await t.balanceOf(treasury);
    if (ts !== supply || tb !== supply) {
      throw new Error(`Supply mismatch for ${c.symbol}: total=${ts} treasury=${tb} expected=${supply}`);
    }
    console.log(`  verified: totalSupply == treasury balance == ${c.whole.toLocaleString()} ${c.symbol}`);

    deployed[c.symbol] = { name: c.name, address: addr, decimals: 18, whole: c.whole.toString(), supplyWei: supply.toString() };
  }

  const record = { chain: 'base', chainId: 8453, treasury, deployedAt: new Date().toISOString(), coins: deployed };
  fs.writeFileSync(OUT, JSON.stringify(record, null, 2));
  console.log('\nSaved addresses to', OUT);
  console.log('\nNext: node deploy/deploy-coin-pools.js   (dry run, then --execute)');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
