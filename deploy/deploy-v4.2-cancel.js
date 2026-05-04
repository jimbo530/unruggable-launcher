// Deploy MycoPadV4 with cancelPending() — same constructor params as 0x73dA
const path = require('path');
const fs = require('fs');
const localEnv = path.join(__dirname, '..', '..', 'Baselings', 'api', '.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '.env') });
const { ethers } = require('ethers');

const RPC = 'https://mainnet.base.org';
const PK = process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY;

async function main() {
  if (!PK) { console.error('No private key'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const bal = await provider.getBalance(wallet.address);
  console.log('Wallet:', wallet.address);
  console.log('ETH:', ethers.formatEther(bal));

  // Load compiled artifact
  const artifact = require('../artifacts/contracts/MycoPadV4.sol/MycoPadV4.json');
  console.log('Bytecode size:', artifact.bytecode.length / 2 - 1, 'bytes');

  // Constructor args — same as current 0x73dA factory
  const args = [
    '0x4200000000000000000000000000000000000006', // weth
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // usdc
    '0x3595ca37596D5895B70EFAB592ac315D5B9809B2', // azusd
    '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', // wrappedBtc (cbBTC)
    '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3', // mft
    '0xf967bf3dccF8b6826F82de1781C98E61Bda3b106', // bb
    '0x17a176Ab2379b86F1E65D79b03bD8c75981244D8', // eb
    '0x20b048fA035D5763685D695e66aDF62c5D9F5055', // char
    '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', // v3Factory
    '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1', // positionManager
    '0x2626664c2603336E57B271c5C0b26F421741e481', // swapRouter
    '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5', // aeroRouter
    '0x6E46Db4B596F4f1dc0d4b6A22B7F924FACd62709', // reactorImpl
    '0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045', // upstreamReactor (MycoPad)
    '0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045', // charUpstream (MycoPad)
    500,   // wethUsdcFee
    50,    // aeroTickSpacing
    500,   // wethBtcFee
    10000, // btcBbFee
    10000, // wethEbFee
    10000  // mftPriceFee
  ];

  console.log('\nConstructor args (21):');
  const labels = ['weth','usdc','azusd','cbBTC','mft','bb','eb','char','v3Factory','pm','router','aeroRouter','reactorImpl','upstream','charUpstream','wethUsdcFee','aeroTick','wethBtcFee','btcBbFee','wethEbFee','mftPriceFee'];
  args.forEach((a, i) => console.log('  ' + (i+1) + '. ' + labels[i].padEnd(16) + ' ' + a));

  console.log('\nDeploying MycoPadV4 (with cancelPending)...');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(...args);
  console.log('Tx:', contract.deploymentTransaction().hash);

  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('\n=== DEPLOYED ===');
  console.log('MycoPadV4 Factory:', addr);
  console.log('https://basescan.org/address/' + addr);
  console.log('\nUpdate chains.js factory to:', addr);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
