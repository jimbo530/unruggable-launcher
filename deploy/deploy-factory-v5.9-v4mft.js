// Deploy MycoPadV5.9 factory with V4 MfT (0xe3dd) as mftStable
// Same bytecode as 0x72ef, only constructor arg mftStable changes
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = 'https://mainnet.base.org';

// Constructor args — same as 0x72ef except mftStable → V4
const ARGS = {
  usdc:             '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  mft:              '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3',   // MfT-m (meme)
  char:             '0x20b048fA035D5763685D695e66aDF62c5D9F5055',
  mftStable:        '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072',   // V4 MfT (was V2 0x85C7)
  v3Factory:        '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  pm:               '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  router:           '0x2626664c2603336E57B271c5C0b26F421741e481',
  reactorImpl:      '0x82eC86F4536167A95eF302056162b1c8b9c7F4FA',
  vestingImpl:      '0x2976Aa6AeE15A29d8d38A95d46a58D545242558c',
  upstreamReactor:  '0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA',
  mftStableMftFee:  10000,
  mftCharFee:       10000,
};

(async () => {
  // Load compiled output
  const out = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'v59_output.json'), 'utf8'));
  const compiled = out.contracts['MycoPadV5_9.sol']['Unruggable2'];
  const abi = compiled.abi;
  const bytecode = '0x' + compiled.evm.bytecode.object;

  console.log('Bytecode size:', bytecode.length / 2 - 1, 'bytes');
  console.log('mftStable (V4):', ARGS.mftStable);

  // Load agent wallet
  const key = process.env.AGENT_WALLET_KEY;
  if (!key) { console.error('Set AGENT_WALLET_KEY env var'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(key, provider);
  console.log('Deployer:', wallet.address);

  const bal = await provider.getBalance(wallet.address);
  console.log('ETH balance:', ethers.formatEther(bal));

  // Deploy
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  console.log('Deploying...');
  const contract = await factory.deploy(
    ARGS.usdc, ARGS.mft, ARGS.char, ARGS.mftStable,
    ARGS.v3Factory, ARGS.pm, ARGS.router,
    ARGS.reactorImpl, ARGS.vestingImpl, ARGS.upstreamReactor,
    ARGS.mftStableMftFee, ARGS.mftCharFee
  );

  console.log('TX:', contract.deploymentTransaction().hash);
  console.log('Waiting for confirmation...');
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('');
  console.log('=== DEPLOYED ===');
  console.log('Factory:', addr);
  console.log('TX:', contract.deploymentTransaction().hash);
  console.log('BaseScan: https://basescan.org/address/' + addr);
})();
