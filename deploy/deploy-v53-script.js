const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

const html = fs.readFileSync(path.join(__dirname, 'deploy-factory-v5.3.html'), 'utf8');
const match = html.match(/const BYTECODE\s*=\s*"(0x[0-9a-fA-F]+)"/);
if (!match) { console.error('No bytecode found'); process.exit(1); }

const bytecode = match[1];
console.log('Deployer:', wallet.address);
console.log('Bytecode:', bytecode.length, 'chars');

const ABI = [{
  inputs: [
    { type: 'address', name: '_weth' },
    { type: 'address', name: '_usdc' },
    { type: 'address', name: '_wrappedBtc' },
    { type: 'address', name: '_mft' },
    { type: 'address', name: '_char' },
    { type: 'address', name: '_v3Factory' },
    { type: 'address', name: '_pm' },
    { type: 'address', name: '_router' },
    { type: 'address', name: '_reactorImpl' },
    { type: 'address', name: '_upstreamReactor' },
    { type: 'uint24', name: '_wethUsdcFee' },
    { type: 'uint24', name: '_mftWethFee' },
    { type: 'uint24', name: '_charUsdcFee' },
    { type: 'uint24', name: '_usdcBtcFee' }
  ],
  stateMutability: 'nonpayable',
  type: 'constructor'
}];

const args = [
  '0x4200000000000000000000000000000000000006',  // weth
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',  // usdc
  '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',  // cbBTC
  '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3',  // mft
  '0x20b048fA035D5763685D695e66aDF62c5D9F5055',  // char
  '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',  // v3Factory
  '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',  // positionManager
  '0x2626664c2603336E57B271c5C0b26F421741e481',  // swapRouter
  '0x82eC86F4536167A95eF302056162b1c8b9c7F4FA',  // reactorImpl
  '0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045',  // upstreamReactor (hub)
  500,    // wethUsdcFee
  10000,  // mftWethFee
  3000,   // charUsdcFee
  500     // usdcBtcFee
];

async function main() {
  const factory = new ethers.ContractFactory(ABI, bytecode, wallet);
  console.log('Sending deploy transaction...');
  const contract = await factory.deploy(...args);
  console.log('TX:', contract.deploymentTransaction().hash);
  console.log('Waiting for confirmation...');
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('SUCCESS - V5.3 Factory deployed at:', addr);
}

main().catch(e => { console.error('DEPLOY FAILED:', e.message); process.exit(1); });
