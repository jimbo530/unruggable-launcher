const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, p);

const BBT = '0xc9435B119ebc921Ae75056C2871DFDDDca1b4a86';
const EBT = '0xF021001e98CaE23eb8E72EA8384F8D7b3FCeA59D';
const MfT = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const V3F = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const MFT_PRIME = '0xed3aE91b2bb22307c07438EEebA2500C18EABcFE';

// BBT positions: USDC #5060923, cbBTC #5061180, WETH #5061273, MfT #5061302
const BBT_NFTS = [
  { id: '5060923', label: 'BBT/USDC' },
  { id: '5061180', label: 'BBT/cbBTC' },
  { id: '5061273', label: 'BBT/WETH' },
  { id: '5061302', label: 'BBT/MfT' },
];

// EBT positions: WETH #5061367, MfT #5061377, USDC #5061397, cbBTC #5061417
const EBT_NFTS = [
  { id: '5061367', label: 'EBT/WETH' },
  { id: '5061377', label: 'EBT/MfT' },
  { id: '5061397', label: 'EBT/USDC' },
  { id: '5061417', label: 'EBT/cbBTC' },
];

const rxArtifact = require('../artifacts/contracts/SporeReactorV2.sol/SporeReactorV2.json');

const RX_ABI = [
  'function initialize(address,address,address,address,address,address) external',
  'function addPool(uint256) external',
  'function poolCount() view returns (uint256)',
  'function token() view returns (address)',
];
const NPM_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId) external',
  'function ownerOf(uint256) view returns (address)',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function deployReactor(name, token, nfts) {
  console.log('\n=== DEPLOY ' + name + ' REACTOR ===');

  // Deploy
  const factory = new ethers.ContractFactory(rxArtifact.abi, rxArtifact.bytecode, w);
  const deploy = await factory.deploy({ gasLimit: 5000000 });
  await deploy.waitForDeployment();
  const addr = await deploy.getAddress();
  console.log(name + ' Reactor:', addr);
  await sleep(4000);

  // Initialize -> feeds MfT V1 Prime
  const rx = new ethers.Contract(addr, RX_ABI, w);
  await (await rx.initialize(token, MfT, NPM, ROUTER, V3F, MFT_PRIME, { gasLimit: 300000 })).wait();
  console.log('Initialized -> prime:', MFT_PRIME);
  await sleep(3000);

  // Transfer NFTs and addPool
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  for (const nft of nfts) {
    try {
      // Verify we own it
      const owner = await npm.ownerOf(nft.id);
      if (owner.toLowerCase() !== w.address.toLowerCase()) {
        console.log(nft.label + ' #' + nft.id + ' SKIP (owned by ' + owner.slice(0, 10) + ')');
        continue;
      }
      // Transfer
      await (await npm.safeTransferFrom(w.address, addr, nft.id, { gasLimit: 200000 })).wait();
      await sleep(2000);
      // Add pool
      await (await rx.addPool(nft.id, { gasLimit: 200000 })).wait();
      console.log(nft.label + ' #' + nft.id + ' OK');
    } catch (e) {
      console.error(nft.label + ' #' + nft.id + ' FAIL:', e.message.slice(0, 100));
    }
    await sleep(2000);
  }

  const count = await new ethers.Contract(addr, RX_ABI, p).poolCount();
  console.log(name + ' reactor pools:', count.toString());
  return addr;
}

async function main() {
  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  const bbtRx = await deployReactor('BBT', BBT, BBT_NFTS);
  const ebtRx = await deployReactor('EBT', EBT, EBT_NFTS);

  console.log('\n===========================');
  console.log('BBT:', BBT);
  console.log('EBT:', EBT);
  console.log('BBT Reactor:', bbtRx);
  console.log('EBT Reactor:', ebtRx);
  console.log('Both feed -> MfT V1 Prime:', MFT_PRIME);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
