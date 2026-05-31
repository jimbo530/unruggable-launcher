require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'partner-build', 'PartnerReactor_sol_PartnerReactor.abi'), 'utf8'));
const BYTECODE = '0x' + fs.readFileSync(path.join(__dirname, '..', 'contracts', 'partner-build', 'PartnerReactor_sol_PartnerReactor.bin'), 'utf8').trim();

// Constructor args
const V2_ROUTER = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';  // Uniswap V2 Router on Base
const MIN_LOCK  = 7 * 24 * 60 * 60;   // 7 days in seconds
const MAX_LOCK  = 365 * 24 * 60 * 60;  // 1 year in seconds

async function main() {
  const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  console.log('Deployer:', wallet.address);

  const bal = await provider.getBalance(wallet.address);
  console.log('ETH balance:', ethers.formatEther(bal));

  if (bal < ethers.parseEther('0.0003')) {
    console.log('ERROR: Insufficient ETH for deploy');
    process.exit(1);
  }

  console.log('\n--- Deploying PartnerReactor ---');
  console.log('V2 Router:', V2_ROUTER);
  console.log('Min lock:', MIN_LOCK, 'seconds (7 days)');
  console.log('Max lock:', MAX_LOCK, 'seconds (365 days)');
  console.log('Bytecode size:', (BYTECODE.length - 2) / 2, 'bytes');

  const factory = new ethers.ContractFactory(ABI, BYTECODE, wallet);
  const contract = await factory.deploy(V2_ROUTER, MIN_LOCK, MAX_LOCK);
  console.log('Deploy TX:', contract.deploymentTransaction().hash);
  console.log('Waiting for confirmation...');

  await contract.waitForDeployment();
  const addr = await contract.getAddress();

  console.log('\nPartnerReactor DEPLOYED:', addr);
  console.log('Admin:', wallet.address);
  console.log('BaseScan: https://basescan.org/address/' + addr);

  // Verify it's working
  const rc = new ethers.Contract(addr, ABI, provider);
  console.log('\n--- Verification ---');
  console.log('admin():', await rc.admin());
  console.log('router():', await rc.router());
  console.log('minLockDuration():', (await rc.minLockDuration()).toString(), 'seconds');
  console.log('maxLockDuration():', (await rc.maxLockDuration()).toString(), 'seconds');
  console.log('poolCount():', (await rc.poolCount()).toString());
  console.log('paused():', await rc.paused());
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
