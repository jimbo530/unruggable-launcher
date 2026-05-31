require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'tgn-reactor-build', 'contracts_TGNReactor_sol_TGNReactor.abi'), 'utf8'));
const BYTECODE = '0x' + fs.readFileSync(path.join(__dirname, '..', 'contracts', 'tgn-reactor-build', 'contracts_TGNReactor_sol_TGNReactor.bin'), 'utf8').trim();

// Constructor args — Base mainnet
const POSITION_MANAGER = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';  // Uniswap V3 NPM on Base
const SWAP_ROUTER      = '0x2626664c2603336E57B271c5C0b26F421741e481';  // Uniswap V3 SwapRouter on Base
const TGN_TOKEN        = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29';  // TGN on Base
const MIN_LOCK         = 7 * 24 * 60 * 60;   // 7 days
const MAX_LOCK         = 365 * 24 * 60 * 60;  // 1 year

async function main() {
  const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  console.log('Deployer:', wallet.address);

  const bal = await provider.getBalance(wallet.address);
  console.log('ETH balance:', ethers.formatEther(bal));

  if (bal < ethers.parseEther('0.00005')) {
    console.log('ERROR: Insufficient ETH for deploy');
    process.exit(1);
  }

  console.log('\n--- Deploying TGNReactor ---');
  console.log('Position Manager:', POSITION_MANAGER);
  console.log('Swap Router:', SWAP_ROUTER);
  console.log('TGN Token:', TGN_TOKEN);
  console.log('Min lock:', MIN_LOCK, 'seconds (7 days)');
  console.log('Max lock:', MAX_LOCK, 'seconds (365 days)');
  console.log('Bytecode size:', (BYTECODE.length - 2) / 2, 'bytes');

  const factory = new ethers.ContractFactory(ABI, BYTECODE, wallet);
  const contract = await factory.deploy(POSITION_MANAGER, SWAP_ROUTER, TGN_TOKEN, MIN_LOCK, MAX_LOCK);
  console.log('Deploy TX:', contract.deploymentTransaction().hash);
  console.log('Waiting for confirmation...');

  await contract.waitForDeployment();
  const addr = await contract.getAddress();

  console.log('\nTGNReactor DEPLOYED:', addr);
  console.log('Admin:', wallet.address);
  console.log('BaseScan: https://basescan.org/address/' + addr);

  // Verify
  const rc = new ethers.Contract(addr, ABI, provider);
  console.log('\n--- Verification ---');
  console.log('admin():', await rc.admin());
  console.log('tgnToken():', await rc.tgnToken());
  console.log('positionManager():', await rc.positionManager());
  console.log('swapRouter():', await rc.swapRouter());
  console.log('minLockDuration():', (await rc.minLockDuration()).toString(), 'seconds');
  console.log('maxLockDuration():', (await rc.maxLockDuration()).toString(), 'seconds');
  console.log('poolCount():', (await rc.poolCount()).toString());
  console.log('paused():', await rc.paused());
  console.log('totalTGNBurned():', (await rc.totalTGNBurned()).toString());
  console.log('totalCompounded():', (await rc.totalCompounded()).toString());
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
