// Deploy SporeReactorV4 implementation (clone template)
const { ethers } = require('ethers');
const path = require('path');

const RPC = 'https://mainnet.base.org';

(async () => {
  const artifact = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'SporeReactorV4.sol', 'SporeReactorV4.json'));
  const { abi, bytecode } = artifact;

  console.log('SporeReactorV4 bytecode:', (bytecode.length - 2) / 2, 'bytes');

  const { execSync } = require('child_process');
  const key = execSync("grep AGENT_PRIVATE_KEY /c/Users/bigji/Documents/Baselings/api/.env | sed 's/.*=//'", { encoding: 'utf8' }).trim();
  if (!key) { console.error('No AGENT_PRIVATE_KEY'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1 });
  const wallet = new ethers.Wallet(key, provider);
  console.log('Deployer:', wallet.address);

  const bal = await provider.getBalance(wallet.address);
  console.log('ETH balance:', ethers.formatEther(bal));

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  console.log('\nDeploying SporeReactorV4 impl...');
  const contract = await factory.deploy();

  console.log('TX:', contract.deploymentTransaction().hash);
  console.log('Waiting for confirmation...');
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('');
  console.log('=== SporeReactorV4 DEPLOYED ===');
  console.log('Impl:', addr);
  console.log('TX:', contract.deploymentTransaction().hash);
  console.log('BaseScan: https://basescan.org/address/' + addr);
})();
