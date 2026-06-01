#!/usr/bin/env node
/**
 * launch-charity-fund.js — Create a new charity fund + Impact Generator V3
 *
 * Creates fund via CharityFundFactory, deploys a dedicated Impact Generator V3,
 * and logs everything to launches.json for tracking.
 *
 * Usage:
 *   node deploy/launch-charity-fund.js "Fund Name" "SYMBOL" <charityWallet> <charityBps>
 *
 * Example:
 *   node deploy/launch-charity-fund.js "Save the Reef" "REEF" 0x1234...abcd 5000
 *   (5000 bps = 50% of yield to charity)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';

// --- Deployed infrastructure ---
const CHARITY_FACTORY = '0x955383723E8A1AD82800406D6f492260918DF882';
const GENERATOR_BIN   = path.join(__dirname, '..', 'build', 'contracts_ImpactGenerator_sol_ImpactGenerator.bin');
const GENERATOR_ABI   = path.join(__dirname, '..', 'build', 'contracts_ImpactGenerator_sol_ImpactGenerator.abi');
const LAUNCHES_FILE   = path.join(__dirname, '..', 'launches.json');

// Base mainnet
const PM      = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const ROUTER  = '0x2626664c2603336E57B271c5C0b26F421741e481';
const V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FACTORY_ABI = [
  'function createFund(string name, string symbol, address charityWallet, uint256 charityBps) returns (address)',
  'event FundCreated(address indexed fund, string name, string symbol, address charityWallet)'
];

function loadLaunches() {
  if (fs.existsSync(LAUNCHES_FILE)) {
    return JSON.parse(fs.readFileSync(LAUNCHES_FILE, 'utf8'));
  }
  return { funds: [] };
}

function saveLaunches(data) {
  fs.writeFileSync(LAUNCHES_FILE, JSON.stringify(data, null, 2));
}

async function main() {
  const [,, name, symbol, charityWallet, charityBpsStr] = process.argv;

  if (!name || !symbol || !charityWallet || !charityBpsStr) {
    console.error('Usage: node deploy/launch-charity-fund.js "Fund Name" "SYMBOL" <charityWallet> <charityBps>');
    console.error('  charityBps: basis points of yield to charity (e.g. 5000 = 50%)');
    process.exit(1);
  }

  const charityBps = parseInt(charityBpsStr);
  if (isNaN(charityBps) || charityBps < 1 || charityBps > 9000) {
    console.error('charityBps must be 1-9000');
    process.exit(1);
  }

  if (!ethers.isAddress(charityWallet)) {
    console.error('Invalid charity wallet address');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  console.log('Deployer:', wallet.address);
  console.log('ETH balance:', ethers.formatEther(await provider.getBalance(wallet.address)));

  // ======================== STEP 1: Create Charity Fund ========================

  console.log(`\n=== Step 1: Create Charity Fund "${name}" (${symbol}) ===`);
  console.log(`  Charity wallet: ${charityWallet}`);
  console.log(`  Charity share:  ${charityBps} bps (${(charityBps / 100).toFixed(1)}%)`);

  const factory = new ethers.Contract(CHARITY_FACTORY, FACTORY_ABI, wallet);
  const createTx = await factory.createFund(name, symbol, charityWallet, charityBps);
  const receipt = await createTx.wait();

  // Find the FundCreated event to get the fund address
  const createdEvent = receipt.logs.find(l => {
    try {
      return factory.interface.parseLog({ topics: l.topics, data: l.data })?.name === 'FundCreated';
    } catch { return false; }
  });

  let fundAddress;
  if (createdEvent) {
    const parsed = factory.interface.parseLog({ topics: createdEvent.topics, data: createdEvent.data });
    fundAddress = parsed.args.fund;
  } else {
    // Fallback: check logs for new contract address
    console.error('Could not find FundCreated event — check tx:', createTx.hash);
    process.exit(1);
  }

  console.log('Fund created:', fundAddress);
  console.log('TX:', createTx.hash);

  // ======================== STEP 2: Deploy Impact Generator V3 ========================

  console.log(`\n=== Step 2: Deploy Impact Generator V3 for ${symbol} ===`);

  const bytecode = '0x' + fs.readFileSync(GENERATOR_BIN, 'utf8').trim();
  const abi = JSON.parse(fs.readFileSync(GENERATOR_ABI, 'utf8'));

  const genFactory = new ethers.ContractFactory(abi, bytecode, wallet);
  const generator = await genFactory.deploy();
  await generator.waitForDeployment();
  const genAddress = await generator.getAddress();
  console.log('Generator deployed:', genAddress);

  console.log('Initializing generator...');
  const initTx = await generator.initialize(fundAddress, PM, ROUTER, V3_FACTORY);
  await initTx.wait();
  console.log('Generator initialized with', symbol, 'as money token');

  // ======================== STEP 3: Log Launch ========================

  const launches = loadLaunches();
  const entry = {
    name,
    symbol,
    fund: fundAddress,
    generator: genAddress,
    charityWallet,
    charityBps,
    deployer: wallet.address,
    factory: CHARITY_FACTORY,
    date: new Date().toISOString(),
    createTx: createTx.hash,
    network: 'base',
    chainId: 8453
  };
  launches.funds.push(entry);
  saveLaunches(launches);
  console.log('\nLogged to launches.json');

  // ======================== SUMMARY ========================

  console.log('\n========================================');
  console.log(`  ${name} (${symbol}) — LAUNCHED`);
  console.log('========================================');
  console.log('  Fund:           ', fundAddress);
  console.log('  Generator:      ', genAddress);
  console.log('  Charity wallet: ', charityWallet);
  console.log('  Charity share:  ', `${charityBps} bps (${(charityBps / 100).toFixed(1)}%)`);
  console.log('  Admin:          ', wallet.address);
  console.log('========================================');
  console.log('\nNext steps:');
  console.log('  1. Verify contracts on Basescan');
  console.log('  2. Add fund to money-for-trees.html UI');
  console.log('  3. Crypto users deposit LP into generator via safeTransferFrom');
  console.log('  4. Normies deposit USDC into fund directly');
}

main().catch(e => { console.error('FAILED:', e.message || e); process.exit(1); });
