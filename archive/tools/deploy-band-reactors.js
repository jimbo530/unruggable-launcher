const { ethers } = require('ethers');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

// ─── Addresses ───────────────────────────────────────────────────────
const BTCBAND     = '0x2988187BDa15c71eC8b3Eb9873457174733d2524';
const ETHBAND     = '0x1248e04075b7a191931E6C8a2999d2Fae4d13BEa';
const MFT         = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM         = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const ROUTER      = '0x2626664c2603336E57B271c5C0b26F421741e481';
const V3FACTORY   = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const MYCOPAD_RX  = '0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045';

// ─── Position NFTs ───────────────────────────────────────────────────
const BTC_NFTS = [5054185, 5054186, 5054246]; // Band1, Band2, USDC
const ETH_NFTS = [5054187, 5054188, 5054255]; // Band1, Band2, USDC

// ─── ABIs ────────────────────────────────────────────────────────────
const REACTOR_ABI = [
  'function initialize(address _token, address _mft, address _pm, address _router, address _factory, address _reactorPrime) external',
  'function addPool(uint256 tokenId) external',
  'function admin() view returns (address)',
  'function initialized() view returns (bool)',
  'function poolCount() view returns (uint256)',
  'function pools(uint256) view returns (uint256 tokenId, address xToken, address poolAddress, uint24 fee, bool tokenIsToken0, bool disabled)'
];

const NPM_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId) external',
  'function ownerOf(uint256 tokenId) view returns (address)'
];

// ─── Helpers ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForTx(tx, label) {
  console.log(`  Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  Confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  const artifact = require('../artifacts/contracts/SporeReactorV2.sol/SporeReactorV2.json');
  const BYTECODE = artifact.bytecode;

  console.log('Wallet:', wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log('ETH:', ethers.formatEther(bal));

  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: Deploy BTCband Reactor
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 1: Deploy BTCband Reactor ═══');
  const btcFactory = new ethers.ContractFactory(REACTOR_ABI, BYTECODE, wallet);
  const btcReactor = await btcFactory.deploy({ gasLimit: 6000000 });
  console.log('  Deploy tx:', btcReactor.deploymentTransaction().hash);
  await btcReactor.waitForDeployment();
  const btcAddr = await btcReactor.getAddress();
  console.log('  BTCband Reactor:', btcAddr);

  await sleep(3000);

  // Initialize BTCband Reactor
  console.log('\n  Initializing BTCband Reactor...');
  const btcRx = new ethers.Contract(btcAddr, REACTOR_ABI, wallet);
  await waitForTx(
    await btcRx.initialize(BTCBAND, MFT, NPM, ROUTER, V3FACTORY, MYCOPAD_RX, { gasLimit: 300000 }),
    'BTCband init'
  );
  console.log('  Admin:', await btcRx.admin());
  console.log('  Initialized:', await btcRx.initialized());

  await sleep(3000);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 2: Deploy ETHband Reactor
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 2: Deploy ETHband Reactor ═══');
  const ethFactory = new ethers.ContractFactory(REACTOR_ABI, BYTECODE, wallet);
  const ethReactorContract = await ethFactory.deploy({ gasLimit: 6000000 });
  console.log('  Deploy tx:', ethReactorContract.deploymentTransaction().hash);
  await ethReactorContract.waitForDeployment();
  const ethAddr = await ethReactorContract.getAddress();
  console.log('  ETHband Reactor:', ethAddr);

  await sleep(3000);

  // Initialize ETHband Reactor
  console.log('\n  Initializing ETHband Reactor...');
  const ethRx = new ethers.Contract(ethAddr, REACTOR_ABI, wallet);
  await waitForTx(
    await ethRx.initialize(ETHBAND, MFT, NPM, ROUTER, V3FACTORY, MYCOPAD_RX, { gasLimit: 300000 }),
    'ETHband init'
  );
  console.log('  Admin:', await ethRx.admin());
  console.log('  Initialized:', await ethRx.initialized());

  await sleep(3000);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 3: Transfer NFTs to BTCband Reactor
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 3: Transfer NFTs to BTCband Reactor ═══');
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);

  for (const nftId of BTC_NFTS) {
    const owner = await npm.ownerOf(nftId);
    if (owner.toLowerCase() === btcAddr.toLowerCase()) {
      console.log(`  NFT #${nftId} already in reactor`);
      continue;
    }
    console.log(`  Sending NFT #${nftId} to BTCband Reactor...`);
    await waitForTx(
      await npm.safeTransferFrom(wallet.address, btcAddr, nftId, { gasLimit: 300000 }),
      `transfer #${nftId}`
    );
    await sleep(2000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 4: Transfer NFTs to ETHband Reactor
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 4: Transfer NFTs to ETHband Reactor ═══');

  for (const nftId of ETH_NFTS) {
    const owner = await npm.ownerOf(nftId);
    if (owner.toLowerCase() === ethAddr.toLowerCase()) {
      console.log(`  NFT #${nftId} already in reactor`);
      continue;
    }
    console.log(`  Sending NFT #${nftId} to ETHband Reactor...`);
    await waitForTx(
      await npm.safeTransferFrom(wallet.address, ethAddr, nftId, { gasLimit: 300000 }),
      `transfer #${nftId}`
    );
    await sleep(2000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 5: Register pools on BTCband Reactor
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 5: Register pools on BTCband Reactor ═══');

  for (const nftId of BTC_NFTS) {
    console.log(`  addPool(${nftId})...`);
    await waitForTx(
      await btcRx.addPool(nftId, { gasLimit: 500000 }),
      `addPool #${nftId}`
    );
    await sleep(2000);
  }

  const btcPoolCount = await btcRx.poolCount();
  console.log(`  BTCband Reactor pools: ${btcPoolCount}`);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 6: Register pools on ETHband Reactor
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 6: Register pools on ETHband Reactor ═══');

  for (const nftId of ETH_NFTS) {
    console.log(`  addPool(${nftId})...`);
    await waitForTx(
      await ethRx.addPool(nftId, { gasLimit: 500000 }),
      `addPool #${nftId}`
    );
    await sleep(2000);
  }

  const ethPoolCount = await ethRx.poolCount();
  console.log(`  ETHband Reactor pools: ${ethPoolCount}`);

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  const endBal = await provider.getBalance(wallet.address);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║           BAND REACTORS DEPLOYED                    ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ BTCband Reactor: ${btcAddr}`);
  console.log(`║   Pool 0: #${BTC_NFTS[0]} (BTCband/cbBTC Band 1)`);
  console.log(`║   Pool 1: #${BTC_NFTS[1]} (BTCband/cbBTC Band 2)`);
  console.log(`║   Pool 2: #${BTC_NFTS[2]} (BTCband/USDC)`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ ETHband Reactor: ${ethAddr}`);
  console.log(`║   Pool 0: #${ETH_NFTS[0]} (ETHband/WETH Band 1)`);
  console.log(`║   Pool 1: #${ETH_NFTS[1]} (ETHband/WETH Band 2)`);
  console.log(`║   Pool 2: #${ETH_NFTS[2]} (ETHband/USDC)`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ Upstream: MycoPad Reactor (${MYCOPAD_RX})`);
  console.log(`║ Fuel: 10% of cbBTC/WETH/USDC → MycoPad → MfT network`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ ETH remaining: ${ethers.formatEther(endBal)}`);
  console.log('╚══════════════════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
