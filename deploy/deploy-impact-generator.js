require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Money for Trees V4 (deposit receipt — the central token)
const MONEY = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';

// Base Uniswap V3 infra
const POSITION_MANAGER = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const SWAP_ROUTER      = '0x2626664c2603336E57B271c5C0b26F421741e481';
const V3_FACTORY       = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

async function main() {
  const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  console.log('Deployer:', wallet.address);

  const bal = await provider.getBalance(wallet.address);
  console.log('ETH balance:', ethers.formatEther(bal));

  if (bal < ethers.parseEther('0.0005')) {
    console.log('ERROR: Insufficient ETH for deploy');
    process.exit(1);
  }

  // Load Hardhat artifact
  const artifact = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'artifacts', 'contracts', 'ImpactGenerator.sol', 'ImpactGenerator.json'), 'utf8'
  ));

  console.log('\n--- Deploying ImpactGenerator ---');
  console.log('Money (MfT V4):', MONEY);
  console.log('Position Manager:', POSITION_MANAGER);
  console.log('Swap Router:', SWAP_ROUTER);
  console.log('V3 Factory:', V3_FACTORY);
  console.log('Bytecode size:', (artifact.bytecode.length - 2) / 2, 'bytes');

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  console.log('\nDeploy TX:', contract.deploymentTransaction().hash);
  console.log('Waiting for confirmation...');

  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('DEPLOYED:', addr);

  // Initialize
  console.log('\nInitializing...');
  const tx = await contract.initialize(MONEY, POSITION_MANAGER, SWAP_ROUTER, V3_FACTORY);
  await tx.wait();
  console.log('Initialized! TX:', tx.hash);

  // Verify state
  console.log('\n=== ImpactGenerator Ready ===');
  console.log('Address:', addr);
  console.log('Money:', await contract.money());
  console.log('Admin:', await contract.admin());
  console.log('Pool count:', (await contract.poolCount()).toString());
  console.log('Paused:', await contract.paused());
  console.log('Cooldown:', (await contract.cooldown()).toString());
  console.log('BaseScan: https://basescan.org/address/' + addr);
  console.log('\nNext: Create Money/X V3 positions, safeTransferFrom NFTs to generator, call depositPosition()');
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
