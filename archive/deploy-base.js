/**
 * deploy-base.js — Deploy all MfT Launch contracts to Base mainnet
 *
 * Deploys: LaunchReactor (impl) → TokenLaunchFactory → WildcardManager
 */

const fs = require('fs');
const path = require('path');

// Load .env manually
const envPath = path.join(__dirname, '..', 'Baselings', 'api', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
});

const { ethers } = require(path.join(__dirname, 'node_modules', 'ethers'));

const BASE_RPC = 'https://mainnet.base.org';
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY;

// Base chain addresses
const BASE = {
  weth:       '0x4200000000000000000000000000000000000006',
  usdc:       '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  wrappedBtc: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  v3Factory:  '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  pm:         '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  router:     '0x2626664c2603336E57B271c5C0b26F421741e481',
  wethUsdcFee: 500,
  wethBtcFee:  3000,
};

async function main() {
  if (!PRIVATE_KEY) { console.error('No AGENT_PRIVATE_KEY in Baselings/api/.env'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log('Deployer:', wallet.address);

  const bal = await provider.getBalance(wallet.address);
  console.log('ETH balance:', ethers.formatEther(bal));

  // Resolve memefortrees.base.eth — use L2 resolver
  // Base ENS uses the universal resolver, but basename resolution via RPC may not work
  // Use known address if resolution fails
  let treasury;
  try {
    // Try mainnet ENS first for basename
    const mainProvider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
    treasury = await mainProvider.resolveName('memefortrees.base.eth');
    if (!treasury) throw new Error('Could not resolve');
  } catch(e) {
    // Fallback: the deployer wallet owner is the user, but treasury should be their main wallet
    // Let's check if there's a known address in the project
    console.log('Could not resolve memefortrees.base.eth, checking project for treasury address...');
    treasury = null;
  }

  if (!treasury) {
    // Look for the user's main wallet in existing configs
    console.error('ERROR: Could not resolve treasury address. Please provide it as an argument:');
    console.error('  node deploy-base.js 0xYourTreasuryAddress');

    if (process.argv[2] && process.argv[2].startsWith('0x')) {
      treasury = process.argv[2];
    } else {
      process.exit(1);
    }
  }

  console.log('MfT Treasury:', treasury);
  console.log('');

  const deployDir = path.join(__dirname, 'deploy');

  // ═══════════════════════════════════════════════════════════════
  //  Step 1: Deploy LaunchReactor implementation
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ Step 1: Deploying LaunchReactor implementation ═══');
  const reactorBin = fs.readFileSync(path.join(deployDir, 'LaunchReactor.bin'), 'utf8');
  const reactorAbi = JSON.parse(fs.readFileSync(path.join(deployDir, 'LaunchReactor.abi'), 'utf8'));

  const reactorFactory = new ethers.ContractFactory(reactorAbi, reactorBin, wallet);
  const reactor = await reactorFactory.deploy();
  console.log('Tx:', reactor.deploymentTransaction().hash);
  await reactor.waitForDeployment();
  const reactorAddr = await reactor.getAddress();
  console.log('LaunchReactor impl:', reactorAddr);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  //  Step 2: Deploy TokenLaunchFactory
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ Step 2: Deploying TokenLaunchFactory ═══');
  const factoryBin = fs.readFileSync(path.join(deployDir, 'TokenLaunchFactory.bin'), 'utf8');
  const factoryAbi = JSON.parse(fs.readFileSync(path.join(deployDir, 'TokenLaunchFactory.abi'), 'utf8'));

  const factoryFactory = new ethers.ContractFactory(factoryAbi, factoryBin, wallet);
  const factory = await factoryFactory.deploy(
    BASE.weth,
    BASE.usdc,
    BASE.wrappedBtc,
    BASE.v3Factory,
    BASE.pm,
    BASE.router,
    reactorAddr,
    treasury,
    BASE.wethUsdcFee,
    BASE.wethBtcFee
  );
  console.log('Tx:', factory.deploymentTransaction().hash);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log('TokenLaunchFactory:', factoryAddr);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  //  Step 3: Deploy WildcardManager
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ Step 3: Deploying WildcardManager ═══');
  const wildcardBin = fs.readFileSync(path.join(deployDir, 'WildcardManager.bin'), 'utf8');
  const wildcardAbi = JSON.parse(fs.readFileSync(path.join(deployDir, 'WildcardManager.abi'), 'utf8'));

  const wildcardFactory = new ethers.ContractFactory(wildcardAbi, wildcardBin, wallet);
  const wildcard = await wildcardFactory.deploy(
    BASE.weth,
    BASE.v3Factory,
    BASE.pm,
    BASE.router
  );
  console.log('Tx:', wildcard.deploymentTransaction().hash);
  await wildcard.waitForDeployment();
  const wildcardAddr = await wildcard.getAddress();
  console.log('WildcardManager:', wildcardAddr);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  //  Summary
  // ═══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════');
  console.log('  DEPLOYMENT COMPLETE — Base (8453)');
  console.log('═══════════════════════════════════════════');
  console.log('LaunchReactor impl:', reactorAddr);
  console.log('TokenLaunchFactory:', factoryAddr);
  console.log('WildcardManager:   ', wildcardAddr);
  console.log('MfT Treasury:      ', treasury);
  console.log('Owner:             ', wallet.address);
  console.log('');
  console.log('Basescan links:');
  console.log('  https://basescan.org/address/' + reactorAddr);
  console.log('  https://basescan.org/address/' + factoryAddr);
  console.log('  https://basescan.org/address/' + wildcardAddr);

  // Save deployment info
  const deployment = {
    chain: 'Base',
    chainId: 8453,
    timestamp: new Date().toISOString(),
    deployer: wallet.address,
    treasury: treasury,
    contracts: {
      LaunchReactor: reactorAddr,
      TokenLaunchFactory: factoryAddr,
      WildcardManager: wildcardAddr
    }
  };
  fs.writeFileSync(path.join(__dirname, 'deployments-base.json'), JSON.stringify(deployment, null, 2));
  console.log('\nSaved to deployments-base.json');

  const remaining = await provider.getBalance(wallet.address);
  console.log('Remaining ETH:', ethers.formatEther(remaining));
}

main().catch(err => { console.error('DEPLOY ERROR:', err.message); process.exit(1); });
