// Deploy MycoPadV7 — Free launch, 2 pools, 1 reactor, no seed
const { ethers } = require('ethers');
const path = require('path');

const RPC = 'https://mainnet.base.org';

// Constructor args (8 params — simpler than V6's 12)
const ARGS = {
  meme:              '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3',  // Meme for Trees (18 dec)
  money:             '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072',  // Money for Trees (6 dec)
  v3Factory:         '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  pm:                '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  router:            '0x2626664c2603336E57B271c5C0b26F421741e481',
  reactorImpl:       '0x891587AD62bcBc6aceE9061D9C4306b9aB16cE45',  // SporeReactorV4 (50/50 launcher split)
  upstreamReactor:   '0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA',  // ReactorPrimeV3
  moneyMemeFee:      10000,                                          // 1% fee tier
};

(async () => {
  const artifact = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'MycoPadV7.sol', 'Unrugable.json'));
  const { abi, bytecode } = artifact;

  console.log('Bytecode size:', (bytecode.length - 2) / 2, 'bytes');
  console.log('Meme (18 dec):', ARGS.meme);
  console.log('Money (6 dec):', ARGS.money);

  // Load agent wallet key via grep (avoids dotenvx banner)
  const { execSync } = require('child_process');
  const key = execSync("grep AGENT_PRIVATE_KEY /c/Users/bigji/Documents/Baselings/api/.env | sed 's/.*=//'", { encoding: 'utf8' }).trim();
  if (!key) { console.error('No AGENT_PRIVATE_KEY in .env'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1 });
  const wallet = new ethers.Wallet(key, provider);
  console.log('Deployer:', wallet.address);

  const bal = await provider.getBalance(wallet.address);
  console.log('ETH balance:', ethers.formatEther(bal));

  if (bal < ethers.parseEther('0.001')) {
    console.error('Low ETH — need gas for deploy');
    process.exit(1);
  }

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  console.log('\nDeploying Unrugable V7 (free launch)...');
  const contract = await factory.deploy(
    ARGS.meme, ARGS.money,
    ARGS.v3Factory, ARGS.pm, ARGS.router,
    ARGS.reactorImpl, ARGS.upstreamReactor,
    ARGS.moneyMemeFee
  );

  console.log('TX:', contract.deploymentTransaction().hash);
  console.log('Waiting for confirmation...');
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('');
  console.log('=== V7 DEPLOYED ===');
  console.log('Factory:', addr);
  console.log('TX:', contract.deploymentTransaction().hash);
  console.log('BaseScan: https://basescan.org/address/' + addr);
  console.log('');
  console.log('Changes from V6:');
  console.log('  - FREE launch (no seed required)');
  console.log('  - 2 pools: TOKEN/Money (70%) + TOKEN/Meme (30%)');
  console.log('  - 1 reactor managing both positions');
  console.log('  - Single launch(name, symbol, upstream) function');
})();
