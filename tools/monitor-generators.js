#!/usr/bin/env node
/**
 * monitor-generators.js — Check all generator pool counts.
 * Auto-deploys a new generator when one hits 20/20 (MAX_POOLS).
 *
 * Usage:
 *   node tools/monitor-generators.js          — check only
 *   node tools/monitor-generators.js --deploy  — check + auto-deploy if full
 *
 * Run on a schedule (e.g. daily cron or PM2 cron).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const LAUNCHES_FILE = path.join(__dirname, '..', 'launches.json');
const GENERATOR_BIN = path.join(__dirname, '..', 'build', 'contracts_ImpactGenerator_sol_ImpactGenerator.bin');
const GENERATOR_ABI_FILE = path.join(__dirname, '..', 'build', 'contracts_ImpactGenerator_sol_ImpactGenerator.abi');

const PM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const MAX_POOLS = 20;

const autoDeploy = process.argv.includes('--deploy');

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const launches = JSON.parse(fs.readFileSync(LAUNCHES_FILE, 'utf8'));

  const genAbi = ['function activePoolCount() view returns (uint256)', 'function poolCount() view returns (uint256)'];

  console.log('=== Generator Monitor ===\n');

  for (const fund of launches.funds) {
    if (!fund.generator && (!fund.generators || fund.generators.length === 0)) {
      console.log(`${fund.name} (${fund.symbol}) — NO GENERATOR`);
      continue;
    }

    // Support both single generator field and generators array
    const generators = fund.generators || [fund.generator].filter(Boolean);

    for (const genAddr of generators) {
      const gen = new ethers.Contract(genAddr, genAbi, provider);
      try {
        const active = Number(await gen.activePoolCount());
        const total = Number(await gen.poolCount());
        const pct = Math.round((total / MAX_POOLS) * 100);
        const status = total >= MAX_POOLS ? 'FULL' : total >= 18 ? 'NEARLY FULL' : 'OK';
        const icon = total >= MAX_POOLS ? '🔴' : total >= 18 ? '🟡' : '🟢';

        console.log(`${icon} ${fund.name} (${fund.symbol})`);
        console.log(`   Generator: ${genAddr}`);
        console.log(`   Pools: ${active} active / ${total} total / ${MAX_POOLS} max (${pct}%)`);
        console.log(`   Status: ${status}`);

        if (total >= MAX_POOLS && autoDeploy) {
          console.log(`\n   >>> Auto-deploying new generator for ${fund.symbol}...`);
          const newAddr = await deployNewGenerator(provider, fund);
          if (newAddr) {
            // Add to generators array in launches.json
            if (!fund.generators) fund.generators = [fund.generator];
            fund.generators.push(newAddr);
            fs.writeFileSync(LAUNCHES_FILE, JSON.stringify(launches, null, 2));
            console.log(`   >>> New generator: ${newAddr}`);
            console.log(`   >>> Updated launches.json`);
            console.log(`   >>> IMPORTANT: Update site/generator.html FUNDS array with new address`);
          }
        }
      } catch (e) {
        console.log(`⚠ ${fund.name} (${fund.symbol}) — Error: ${e.message}`);
        console.log(`   Generator: ${genAddr}`);
      }
      console.log();
    }
  }
}

async function deployNewGenerator(provider, fund) {
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const bal = await provider.getBalance(wallet.address);
  if (bal < ethers.parseEther('0.001')) {
    console.error('   Not enough ETH for deployment');
    return null;
  }

  const bytecode = '0x' + fs.readFileSync(GENERATOR_BIN, 'utf8').trim();
  const abi = JSON.parse(fs.readFileSync(GENERATOR_ABI_FILE, 'utf8'));

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const gen = await factory.deploy();
  await gen.waitForDeployment();
  const addr = await gen.getAddress();

  const moneyAddr = fund.money || fund.fund;
  const tx = await gen.initialize(moneyAddr, PM, ROUTER, V3_FACTORY);
  await tx.wait();

  return addr;
}

main().catch(e => { console.error(e); process.exit(1); });
