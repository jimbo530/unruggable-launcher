const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

const BB = '0x4032bFe88eaeb0a9F5EBeFc14D66564DDf95CC29';
const EB = '0x73B98EA6359b1289306e0E16ad8d32d088ea1cC8';
const MFT = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const AZUSD = '0x3595ca37596D5895B70EFAB592ac315D5B9809B2';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const BTC_RX = '0x5375817c1798d43036d3b2DAAfaFB8e2247bAcF2';
const ETH_RX = '0x361A4E356847c5a0C60B510b2531b640aC51f090';

const FEE = 3000;
const TS = 60;
const MAX_TICK = 887220;
const WALL_AMT = ethers.parseUnits('10000', 18);

// MfT wall pools (already created & initialized last session)
const BB_MFT_POOL = '0x1BC32a2c9ddE894133D936aeb15254e9DeFB0235';
const EB_MFT_POOL = '0xb02c496a10596ecCf1729A8207A391c70Df2270d';

const ERC20 = ['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'];
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL_ABI = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external'
];
const RX_ABI = ['function addPool(uint256 tokenId) external'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function sqrtP(price) { return BigInt(Math.floor(Math.sqrt(price) * 79228162514264337593543950336)); }

function extractNftId(receipt) {
  const log = receipt.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );
  return log && log.topics.length >= 4 ? BigInt(log.topics[3]).toString() : 'unknown';
}

async function ensureApproval(token, label) {
  const t = new ethers.Contract(token, ERC20, wallet);
  const allowance = await t.allowance(wallet.address, NPM);
  if (allowance < WALL_AMT) {
    console.log(`Approving ${label}...`);
    await (await t.approve(NPM, ethers.MaxUint256, { gasLimit: 60000 })).wait();
    await sleep(2000);
  } else {
    console.log(`${label} already approved`);
  }
}

async function main() {
  console.log('Wallet:', wallet.address);
  console.log('ETH:', ethers.formatEther(await provider.getBalance(wallet.address)));

  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const nfts = [];

  // Approvals (check first to save gas)
  await ensureApproval(BB, 'BB');
  await ensureApproval(EB, 'EB');

  // ========== MfT SELL WALLS ==========
  console.log('\n=== MfT SELL WALLS (10K each) ===');

  // BB/MfT: BB(0x4032) < MfT(0x8FB8) → BB=token0
  const [, bbMftTick] = await (new ethers.Contract(BB_MFT_POOL, POOL_ABI, provider)).slot0();
  const bbStart = Math.ceil(Number(bbMftTick) / TS) * TS + TS;
  console.log('BB/MfT tick:', Number(bbMftTick), '→ wall [' + bbStart + ', ' + MAX_TICK + ']');

  const tx1 = await npm.mint({
    token0: BB, token1: MFT, fee: FEE,
    tickLower: bbStart, tickUpper: MAX_TICK,
    amount0Desired: WALL_AMT, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
  }, { gasLimit: 2000000 });
  console.log('Tx:', tx1.hash);
  const r1 = await tx1.wait();
  const nft1 = extractNftId(r1);
  console.log('BB/MfT NFT #' + nft1);
  nfts.push({ id: nft1, reactor: BTC_RX, label: 'BB/MfT' });
  await sleep(2000);

  // EB/MfT: EB(0x73B9) < MfT(0x8FB8) → EB=token0
  const [, ebMftTick] = await (new ethers.Contract(EB_MFT_POOL, POOL_ABI, provider)).slot0();
  const ebStart = Math.ceil(Number(ebMftTick) / TS) * TS + TS;
  console.log('EB/MfT tick:', Number(ebMftTick), '→ wall [' + ebStart + ', ' + MAX_TICK + ']');

  const tx2 = await npm.mint({
    token0: EB, token1: MFT, fee: FEE,
    tickLower: ebStart, tickUpper: MAX_TICK,
    amount0Desired: WALL_AMT, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
  }, { gasLimit: 2000000 });
  console.log('Tx:', tx2.hash);
  const r2 = await tx2.wait();
  const nft2 = extractNftId(r2);
  console.log('EB/MfT NFT #' + nft2);
  nfts.push({ id: nft2, reactor: ETH_RX, label: 'EB/MfT' });
  await sleep(2000);

  // ========== AZUSD SELL WALLS ==========
  console.log('\n=== AZUSD SELL WALLS (10K each) ===');

  // AZUSD/BB: AZUSD(0x3595) < BB(0x4032) → AZUSD=token0, BB=token1
  // BB=$0.86 → 1 AZUSD = 1/0.86 = 1.163 BB
  const azBbPrice = 1 / 0.86;
  console.log('\nAZUSD/BB price:', azBbPrice.toFixed(4), 'BB per AZUSD');

  let azBbAddr = await factory.getPool(AZUSD, BB, FEE);
  if (azBbAddr === ethers.ZeroAddress) {
    console.log('Creating AZUSD/BB pool...');
    await (await factory.createPool(AZUSD, BB, FEE, { gasLimit: 5000000 })).wait();
    await sleep(3000);
    azBbAddr = await factory.getPool(AZUSD, BB, FEE);
    if (azBbAddr === ethers.ZeroAddress) { await sleep(3000); azBbAddr = await factory.getPool(AZUSD, BB, FEE); }
    console.log('Pool:', azBbAddr);
    await (await new ethers.Contract(azBbAddr, POOL_ABI, wallet).initialize(sqrtP(azBbPrice), { gasLimit: 300000 })).wait();
    console.log('Initialized');
  } else {
    console.log('AZUSD/BB exists:', azBbAddr);
  }
  await sleep(2000);

  const [, azBbTick] = await (new ethers.Contract(azBbAddr, POOL_ABI, provider)).slot0();
  // BB sell wall below current tick (BB=token1, one-sided below = all token1)
  const azBbEnd = Math.floor(Number(azBbTick) / TS) * TS - TS;
  console.log('AZUSD/BB tick:', Number(azBbTick), '→ wall [-' + MAX_TICK + ', ' + azBbEnd + ']');

  const tx3 = await npm.mint({
    token0: AZUSD, token1: BB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: azBbEnd,
    amount0Desired: 0n, amount1Desired: WALL_AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
  }, { gasLimit: 2000000 });
  console.log('Tx:', tx3.hash);
  const r3 = await tx3.wait();
  const nft3 = extractNftId(r3);
  console.log('AZUSD/BB NFT #' + nft3);
  nfts.push({ id: nft3, reactor: BTC_RX, label: 'AZUSD/BB' });
  await sleep(2000);

  // AZUSD/EB: AZUSD(0x3595) < EB(0x73B9) → AZUSD=token0, EB=token1
  // EB=$1.00 → 1 AZUSD = 1 EB
  const azEbPrice = 1.0;
  console.log('\nAZUSD/EB price:', azEbPrice.toFixed(4), 'EB per AZUSD');

  let azEbAddr = await factory.getPool(AZUSD, EB, FEE);
  if (azEbAddr === ethers.ZeroAddress) {
    console.log('Creating AZUSD/EB pool...');
    await (await factory.createPool(AZUSD, EB, FEE, { gasLimit: 5000000 })).wait();
    await sleep(3000);
    azEbAddr = await factory.getPool(AZUSD, EB, FEE);
    if (azEbAddr === ethers.ZeroAddress) { await sleep(3000); azEbAddr = await factory.getPool(AZUSD, EB, FEE); }
    console.log('Pool:', azEbAddr);
    await (await new ethers.Contract(azEbAddr, POOL_ABI, wallet).initialize(sqrtP(azEbPrice), { gasLimit: 300000 })).wait();
    console.log('Initialized');
  } else {
    console.log('AZUSD/EB exists:', azEbAddr);
  }
  await sleep(2000);

  const [, azEbTick] = await (new ethers.Contract(azEbAddr, POOL_ABI, provider)).slot0();
  const azEbEnd = Math.floor(Number(azEbTick) / TS) * TS - TS;
  console.log('AZUSD/EB tick:', Number(azEbTick), '→ wall [-' + MAX_TICK + ', ' + azEbEnd + ']');

  const tx4 = await npm.mint({
    token0: AZUSD, token1: EB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: azEbEnd,
    amount0Desired: 0n, amount1Desired: WALL_AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
  }, { gasLimit: 2000000 });
  console.log('Tx:', tx4.hash);
  const r4 = await tx4.wait();
  const nft4 = extractNftId(r4);
  console.log('AZUSD/EB NFT #' + nft4);
  nfts.push({ id: nft4, reactor: ETH_RX, label: 'AZUSD/EB' });
  await sleep(2000);

  // ========== SEND ALL TO REACTORS ==========
  console.log('\n=== SENDING TO REACTORS ===');
  for (const { id, reactor, label } of nfts) {
    console.log(label + ' #' + id + ' → ' + (reactor === BTC_RX ? 'BTC' : 'ETH') + ' Reactor');
    await (await npm.safeTransferFrom(wallet.address, reactor, id, { gasLimit: 200000 })).wait();
    await sleep(1000);
    await (await new ethers.Contract(reactor, RX_ABI, wallet).addPool(id, { gasLimit: 200000 })).wait();
    console.log('  Added');
    await sleep(1000);
  }

  const gas = await provider.getBalance(wallet.address);
  console.log('\n=== ALL WALLS LIVE ===');
  console.log('BB/MfT NFT #' + nfts[0].id + ' → BTC Reactor');
  console.log('EB/MfT NFT #' + nfts[1].id + ' → ETH Reactor');
  console.log('AZUSD/BB pool:', azBbAddr, '| NFT #' + nfts[2].id + ' → BTC Reactor');
  console.log('AZUSD/EB pool:', azEbAddr, '| NFT #' + nfts[3].id + ' → ETH Reactor');
  console.log('ETH left:', ethers.formatEther(gas));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
