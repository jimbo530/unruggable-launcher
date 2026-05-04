const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

const BB = '0x4032bFe88eaeb0a9F5EBeFc14D66564DDf95CC29';
const EB = '0x73B98EA6359b1289306e0E16ad8d32d088ea1cC8';
const MFT = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const BTC_RX = '0x5375817c1798d43036d3b2DAAfaFB8e2247bAcF2';
const ETH_RX = '0x361A4E356847c5a0C60B510b2531b640aC51f090';

const NEW_FEE = 3000;
const TS = 60;
const MAX_TICK = 887220;
const BAND_AMT = ethers.parseUnits('10000', 18);

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL_ABI = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external'
];
const RX_ABI = ['function addPool(uint256 tokenId) external', 'function poolCount() view returns (uint256)'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function sqrtP(price) { return BigInt(Math.floor(Math.sqrt(price) * 79228162514264337593543950336)); }

async function main() {
  console.log('Wallet:', wallet.address);

  // MfT price from user/market: $0.000000276
  const mftPriceUsd = 0.000000276;
  const mftPerDollar = 1 / mftPriceUsd;
  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);

  console.log('MfT: $' + mftPriceUsd.toExponential(4));
  console.log('MfT per $1:', mftPerDollar.toExponential(4));

  // BB/MfT at $0.86
  // BB(0x4032) < MfT(0x8FB8) → BB=token0, MfT=token1
  const bbMftPrice = mftPerDollar * 0.86;
  console.log('\n=== BB/MfT fee=3000 (BB=$0.86) ===');
  console.log('Init price:', bbMftPrice.toExponential(4), 'MfT per BB');

  let bbMftAddr = await factory.getPool(BB, MFT, NEW_FEE);
  if (bbMftAddr === ethers.ZeroAddress) {
    console.log('Creating pool...');
    await (await factory.createPool(BB, MFT, NEW_FEE, { gasLimit: 5000000 })).wait();
    await sleep(5000);
    bbMftAddr = await factory.getPool(BB, MFT, NEW_FEE);
    if (bbMftAddr === ethers.ZeroAddress) { await sleep(5000); bbMftAddr = await factory.getPool(BB, MFT, NEW_FEE); }
    console.log('Pool:', bbMftAddr);
    const p = new ethers.Contract(bbMftAddr, POOL_ABI, wallet);
    await (await p.initialize(sqrtP(bbMftPrice), { gasLimit: 500000 })).wait();
    console.log('Initialized');
  } else {
    console.log('Pool exists:', bbMftAddr);
  }
  await sleep(3000);
  const [, bbTick] = await (new ethers.Contract(bbMftAddr, POOL_ABI, provider)).slot0();
  const bbt = Number(bbTick);
  console.log('Tick:', bbt);
  const bbStart = Math.ceil(bbt / TS) * TS + TS;
  const bbWallUsd = Math.exp(bbStart * Math.log(1.0001)) * mftPriceUsd;
  console.log('Wall at tick', bbStart, '= $' + bbWallUsd.toFixed(4));

  // EB/MfT at $1.00
  // EB(0x73B9) < MfT(0x8FB8) → EB=token0, MfT=token1
  const ebMftPrice = mftPerDollar * 1.0;
  console.log('\n=== EB/MfT fee=3000 (EB=$1.00) ===');
  console.log('Init price:', ebMftPrice.toExponential(4), 'MfT per EB');

  let ebMftAddr = await factory.getPool(EB, MFT, NEW_FEE);
  if (ebMftAddr === ethers.ZeroAddress) {
    console.log('Creating pool...');
    await (await factory.createPool(EB, MFT, NEW_FEE, { gasLimit: 5000000 })).wait();
    await sleep(5000);
    ebMftAddr = await factory.getPool(EB, MFT, NEW_FEE);
    if (ebMftAddr === ethers.ZeroAddress) { await sleep(5000); ebMftAddr = await factory.getPool(EB, MFT, NEW_FEE); }
    console.log('Pool:', ebMftAddr);
    const p = new ethers.Contract(ebMftAddr, POOL_ABI, wallet);
    await (await p.initialize(sqrtP(ebMftPrice), { gasLimit: 500000 })).wait();
    console.log('Initialized');
  } else {
    console.log('Pool exists:', ebMftAddr);
  }
  await sleep(3000);
  const [, ebTick] = await (new ethers.Contract(ebMftAddr, POOL_ABI, provider)).slot0();
  const ebt = Number(ebTick);
  console.log('Tick:', ebt);
  const ebStart = Math.ceil(ebt / TS) * TS + TS;
  const ebWallUsd = Math.exp(ebStart * Math.log(1.0001)) * mftPriceUsd;
  console.log('Wall at tick', ebStart, '= $' + ebWallUsd.toFixed(4));

  // Approve
  console.log('\nApproving...');
  await (await new ethers.Contract(BB, ERC20, wallet).approve(NPM, BAND_AMT, { gasLimit: 100000 })).wait();
  await sleep(2000);
  await (await new ethers.Contract(EB, ERC20, wallet).approve(NPM, BAND_AMT, { gasLimit: 100000 })).wait();
  await sleep(2000);

  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  console.log('Minting BB wall [' + bbStart + ', ' + MAX_TICK + ']...');
  const tx1 = await npm.mint({
    token0: BB, token1: MFT, fee: NEW_FEE,
    tickLower: bbStart, tickUpper: MAX_TICK,
    amount0Desired: BAND_AMT, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
  }, { gasLimit: 5000000 });
  console.log('Tx:', tx1.hash);
  const r1 = await tx1.wait();
  const log1 = r1.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );
  const nft1 = log1 && log1.topics.length >= 4 ? BigInt(log1.topics[3]).toString() : 'unknown';
  console.log('NFT:', nft1);
  await sleep(3000);

  console.log('Minting EB wall [' + ebStart + ', ' + MAX_TICK + ']...');
  const tx2 = await npm.mint({
    token0: EB, token1: MFT, fee: NEW_FEE,
    tickLower: ebStart, tickUpper: MAX_TICK,
    amount0Desired: BAND_AMT, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
  }, { gasLimit: 5000000 });
  console.log('Tx:', tx2.hash);
  const r2 = await tx2.wait();
  const log2 = r2.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );
  const nft2 = log2 && log2.topics.length >= 4 ? BigInt(log2.topics[3]).toString() : 'unknown';
  console.log('NFT:', nft2);
  await sleep(3000);

  // Send to reactors
  console.log('\n#' + nft1 + ' → BTC Reactor...');
  await (await npm.safeTransferFrom(wallet.address, BTC_RX, nft1, { gasLimit: 300000 })).wait();
  await sleep(2000);
  const btcRx = new ethers.Contract(BTC_RX, RX_ABI, wallet);
  await (await btcRx.addPool(nft1, { gasLimit: 500000 })).wait();
  console.log('BTC pools:', (await btcRx.poolCount()).toString());
  await sleep(2000);

  console.log('#' + nft2 + ' → ETH Reactor...');
  await (await npm.safeTransferFrom(wallet.address, ETH_RX, nft2, { gasLimit: 300000 })).wait();
  await sleep(2000);
  const ethRx = new ethers.Contract(ETH_RX, RX_ABI, wallet);
  await (await ethRx.addPool(nft2, { gasLimit: 500000 })).wait();
  console.log('ETH pools:', (await ethRx.poolCount()).toString());

  const gas = await provider.getBalance(wallet.address);
  console.log('\n=== MfT SELL WALLS LIVE ===');
  console.log('BB/MfT (3000):', bbMftAddr, '| wall $' + bbWallUsd.toFixed(2) + ' | NFT #' + nft1);
  console.log('EB/MfT (3000):', ebMftAddr, '| wall $' + ebWallUsd.toFixed(2) + ' | NFT #' + nft2);
  console.log('ETH left:', ethers.formatEther(gas));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
