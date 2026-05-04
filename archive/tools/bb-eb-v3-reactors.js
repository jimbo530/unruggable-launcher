const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB    = '0xC89344F08fdE43aa65Dce4A7FcEb8284B201293e';
const EB    = '0x15e274AbAe2645E5fBAc29Ab790837b484Cb5bCe';
const MfT   = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const ROUTER= '0x2626664c2603336E57B271c5C0b26F421741e481';
const V3F   = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const PRIME = '0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045'; // MycoPad Reactor

const artifact = require('../artifacts/contracts/SporeReactorV2.sol/SporeReactorV2.json');

const RX_ABI = [
  'function initialize(address _token, address _mft, address _pm, address _router, address _factory, address _reactorPrime) external',
  'function addPool(uint256 tokenId) external',
  'function poolCount() view returns (uint256)',
  'function admin() view returns (address)',
  'function token() view returns (address)',
];
const NPM_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId) external',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// BB reactor NFTs (in order from the all-in-one script + EGP)
const BB_NFTS = [
  { id: '5055678', label: 'BB/USDC ref' },
  { id: '5055680', label: 'BB/cbBTC 500K' },
  { id: '5055682', label: 'AZUSD/BB 50K' },
  { id: '5055684', label: 'MfT/BB 50K' },
  { id: '5055687', label: 'EB/BB cross 50K+50K' },
  { id: '5055690', label: 'BB/TGN 10K' },
  { id: '5055693', label: 'POOP/BB 10K' },
  { id: '5055697', label: 'BB/BRUH 10K' },
  { id: '5055699', label: 'BURG/BB 10K' },
  { id: '5055703', label: 'EGP/BB 10K' },
];

const EB_NFTS = [
  { id: '5055679', label: 'EB/USDC ref' },
  { id: '5055681', label: 'WETH/EB 500K' },
  { id: '5055683', label: 'EB/AZUSD 50K' },
  { id: '5055685', label: 'EB/MfT 50K' },
  { id: '5055692', label: 'EB/TGN 10K' },
  { id: '5055696', label: 'POOP/EB 10K' },
  { id: '5055698', label: 'EB/BRUH 10K' },
  { id: '5055700', label: 'BURG/EB 10K' },
  { id: '5055709', label: 'EB/EGP 10K' },
];

async function main() {
  const npm = new ethers.Contract(NPM, NPM_ABI, w);

  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // ═══ DEPLOY BB REACTOR ═══
  console.log('\n═══ DEPLOY BB REACTOR ═══');
  const bbFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, w);
  const bbDeploy = await bbFactory.deploy({gasLimit: 5000000});
  await bbDeploy.waitForDeployment();
  const BB_RX = await bbDeploy.getAddress();
  console.log('BB Reactor:', BB_RX);
  await sleep(3000);

  console.log('Initializing...');
  const bbRx = new ethers.Contract(BB_RX, RX_ABI, w);
  await (await bbRx.initialize(BB, MfT, NPM, ROUTER, V3F, PRIME, {gasLimit: 300000})).wait();
  console.log('Token:', await bbRx.token());
  console.log('Admin:', await bbRx.admin());
  await sleep(2000);

  // ═══ DEPLOY EB REACTOR ═══
  console.log('\n═══ DEPLOY EB REACTOR ═══');
  const ebFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, w);
  const ebDeploy = await ebFactory.deploy({gasLimit: 5000000});
  await ebDeploy.waitForDeployment();
  const EB_RX = await ebDeploy.getAddress();
  console.log('EB Reactor:', EB_RX);
  await sleep(3000);

  console.log('Initializing...');
  const ebRx = new ethers.Contract(EB_RX, RX_ABI, w);
  await (await ebRx.initialize(EB, MfT, NPM, ROUTER, V3F, PRIME, {gasLimit: 300000})).wait();
  console.log('Token:', await ebRx.token());
  console.log('Admin:', await ebRx.admin());
  await sleep(2000);

  // ═══ SEND NFTs TO BB REACTOR ═══
  console.log('\n═══ SENDING ' + BB_NFTS.length + ' NFTs TO BB REACTOR ═══');
  for (const nft of BB_NFTS) {
    console.log(nft.label + ' #' + nft.id);
    try {
      await (await npm.safeTransferFrom(w.address, BB_RX, nft.id, {gasLimit: 200000})).wait();
      await sleep(1000);
      await (await bbRx.addPool(nft.id, {gasLimit: 200000})).wait();
      console.log('  Added');
    } catch(e) { console.error('  FAILED:', e.message.slice(0,120)); }
    await sleep(1500);
  }

  // ═══ SEND NFTs TO EB REACTOR ═══
  console.log('\n═══ SENDING ' + EB_NFTS.length + ' NFTs TO EB REACTOR ═══');
  for (const nft of EB_NFTS) {
    console.log(nft.label + ' #' + nft.id);
    try {
      await (await npm.safeTransferFrom(w.address, EB_RX, nft.id, {gasLimit: 200000})).wait();
      await sleep(1000);
      await (await ebRx.addPool(nft.id, {gasLimit: 200000})).wait();
      console.log('  Added');
    } catch(e) { console.error('  FAILED:', e.message.slice(0,120)); }
    await sleep(1500);
  }

  const bbCount = await bbRx.poolCount();
  const ebCount = await ebRx.poolCount();
  console.log('\n═══ DONE ═══');
  console.log('BB Reactor:', BB_RX, '(' + bbCount + ' pools)');
  console.log('EB Reactor:', EB_RX, '(' + ebCount + ' pools)');
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
