require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// MfT-stable is the "native token" for this reactor
const MFT_STABLE = '0xe96fa44b4b82F085a457F9B7a0F85ea26FF1652F';

// Recipient — user's wallet (memefortrees.base.eth)
const RECIPIENT = '0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2';

// Base Uniswap V3 infra
const POSITION_MANAGER = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const SWAP_ROUTER      = '0x2626664c2603336E57B271c5C0b26F421741e481';
const V3_FACTORY       = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';


async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  console.log('Deployer:', wallet.address);

  const bal = await provider.getBalance(wallet.address);
  console.log('ETH balance:', ethers.formatEther(bal));

  const abi = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'HarvestReactor_sol_HarvestReactor.abi'), 'utf8'));
  const bytecode = '0x' + fs.readFileSync(path.join(__dirname, '..', 'contracts', 'HarvestReactor_sol_HarvestReactor.bin'), 'utf8').trim();

  console.log('\nDeploying HarvestReactor...');
  console.log('  Token (MfT-stable):', MFT_STABLE);
  console.log('  Recipient:', RECIPIENT);
  console.log('  Position Manager:', POSITION_MANAGER);
  console.log('  Swap Router:', SWAP_ROUTER);
  console.log('  V3 Factory:', V3_FACTORY);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  console.log('\nDeploy TX:', contract.deploymentTransaction().hash);
  console.log('Waiting for confirmation...');

  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('DEPLOYED:', addr);

  // Initialize the reactor
  console.log('\nInitializing...');
  const tx = await contract.initialize(
    MFT_STABLE,
    RECIPIENT,
    POSITION_MANAGER,
    SWAP_ROUTER,
    V3_FACTORY
  );
  await tx.wait();
  console.log('Initialized! TX:', tx.hash);

  console.log('\n=== HarvestReactor Ready ===');
  console.log('Address:', addr);
  console.log('Token:', MFT_STABLE);
  console.log('Recipient:', RECIPIENT);
  console.log('Admin:', wallet.address);
  console.log('\nNext: Create V3 positions for MfT-stable/X pairs, transfer NFTs to reactor, call addPool()');
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
