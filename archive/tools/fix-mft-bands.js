const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

const BTCBAND = '0x11DFE729F1211904efB99F4d4a3f9FAF6C93CCB5';
const ETHBAND = '0xd7ac547B8a5d7756F36b593287431Bad7Feb7864';
const MFT = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const BTC_REACTOR = '0x038B87f2Abc1dcE269FF7DE4d3e721b5b57eD8cf';
const ETH_REACTOR = '0xeB02d1137342cD08C1c4bf61C188d86C5253b631';

const NEW_FEE = 3000;
const TS = 60; // tick spacing for fee 3000
const MIN_TICK = -887220;
const MAX_TICK = 887220;
const BAND_AMT = ethers.parseUnits('10000', 18);

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const POOL_ABI = ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)', 'function initialize(uint160) external'];
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external'
];
const RX_ABI = ['function addPool(uint256 tokenId) external', 'function poolCount() view returns (uint256)'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function sqrtP(price) { return BigInt(Math.floor(Math.sqrt(price) * 79228162514264337593543950336)); }

async function main() {
  console.log('Wallet:', wallet.address);

  // Get current MfT price from MfT/WETH pool
  // WETH(0x4200)=token0, MfT(0x8FB8)=token1, both 18 dec
  const mftWethPool = new ethers.Contract('0x02d75D63a3dBeAe0FE6A73e4b2Fcc1c7469B78EC', POOL_ABI, provider);
  const [mftSqrt] = await mftWethPool.slot0();
  const mftPerWeth = Number(mftSqrt) ** 2 / (2 ** 192);

  // Get ETH price from WETH/ETHband pool (ETHband=$1 each)
  // WETH(0x4200)=token0, ETHband(0xd7ac)=token1, both 18 dec
  const wethEthPool = new ethers.Contract('0xe4b68937c2D8675E7DE2bc334Af57A2e4363c938', POOL_ABI, provider);
  const [, ethTick] = await wethEthPool.slot0();
  const ethPrice = Math.exp(Number(ethTick) * Math.log(1.0001));

  const mftPerDollar = mftPerWeth / ethPrice;
  console.log('MfT per WETH:', mftPerWeth.toExponential(4));
  console.log('ETH price (ETHband ref):', ethPrice.toFixed(2));
  console.log('MfT per $1:', mftPerDollar.toExponential(4));
  console.log('$ per MfT:', (1 / mftPerDollar).toExponential(4));

  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);

  // ═══ BTCband/MfT (fee 3000) ═══
  // BTCband(0x11DF) < MfT(0x8FB8) → BTCband=token0, MfT=token1
  // price = MfT per BTCband = mftPerDollar
  console.log('\n=== BTCband/MfT (fee 3000) ===');
  console.log('Init price:', mftPerDollar.toExponential(4), 'MfT per BTCband');

  let btcMftAddr = await factory.getPool(BTCBAND, MFT, NEW_FEE);
  if (btcMftAddr === ethers.ZeroAddress) {
    console.log('Creating pool...');
    await (await factory.createPool(BTCBAND, MFT, NEW_FEE, { gasLimit: 5000000 })).wait();
    await sleep(5000);
    btcMftAddr = await factory.getPool(BTCBAND, MFT, NEW_FEE);
    if (btcMftAddr === ethers.ZeroAddress) { await sleep(5000); btcMftAddr = await factory.getPool(BTCBAND, MFT, NEW_FEE); }
    console.log('Pool:', btcMftAddr);
    const pool = new ethers.Contract(btcMftAddr, POOL_ABI, wallet);
    await (await pool.initialize(sqrtP(mftPerDollar), { gasLimit: 500000 })).wait();
    console.log('Initialized');
  } else {
    console.log('Pool exists:', btcMftAddr);
    const pool = new ethers.Contract(btcMftAddr, POOL_ABI, provider);
    const [s] = await pool.slot0();
    if (s === 0n) {
      const pw = new ethers.Contract(btcMftAddr, POOL_ABI, wallet);
      await (await pw.initialize(sqrtP(mftPerDollar), { gasLimit: 500000 })).wait();
      console.log('Initialized');
    }
  }
  await sleep(3000);

  const btcMftPool = new ethers.Contract(btcMftAddr, POOL_ABI, provider);
  const [, bmTick] = await btcMftPool.slot0();
  const bmt = Number(bmTick);
  console.log('Tick:', bmt);

  // One-sided BTCband (token0) above current tick
  const btcStart = Math.ceil(bmt / TS) * TS + TS;
  console.log('Band:', btcStart, '→', MAX_TICK);

  const btcToken = new ethers.Contract(BTCBAND, ERC20, wallet);
  console.log('Approving BTCband...');
  await (await btcToken.approve(NPM, BAND_AMT)).wait();
  await sleep(1000);

  console.log('Minting...');
  const tx1 = await npm.mint({
    token0: BTCBAND, token1: MFT, fee: NEW_FEE,
    tickLower: btcStart, tickUpper: MAX_TICK,
    amount0Desired: BAND_AMT, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 600
  }, { gasLimit: 5000000 });
  console.log('Tx:', tx1.hash);
  const r1 = await tx1.wait();
  const log1 = r1.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );
  const btcMftNft = log1 && log1.topics.length >= 4 ? BigInt(log1.topics[3]).toString() : 'unknown';
  console.log('NFT:', btcMftNft);
  await sleep(2000);

  // ═══ MfT/ETHband (fee 3000) ═══
  // MfT(0x8FB8) < ETHband(0xd7ac) → MfT=token0, ETHband=token1
  // price = ETHband per MfT = 1/mftPerDollar
  const mftEthPrice = 1 / mftPerDollar;
  console.log('\n=== MfT/ETHband (fee 3000) ===');
  console.log('Init price:', mftEthPrice.toExponential(4), 'ETHband per MfT');

  let mftEthAddr = await factory.getPool(MFT, ETHBAND, NEW_FEE);
  if (mftEthAddr === ethers.ZeroAddress) {
    console.log('Creating pool...');
    await (await factory.createPool(MFT, ETHBAND, NEW_FEE, { gasLimit: 5000000 })).wait();
    await sleep(5000);
    mftEthAddr = await factory.getPool(MFT, ETHBAND, NEW_FEE);
    if (mftEthAddr === ethers.ZeroAddress) { await sleep(5000); mftEthAddr = await factory.getPool(MFT, ETHBAND, NEW_FEE); }
    console.log('Pool:', mftEthAddr);
    const pool = new ethers.Contract(mftEthAddr, POOL_ABI, wallet);
    await (await pool.initialize(sqrtP(mftEthPrice), { gasLimit: 500000 })).wait();
    console.log('Initialized');
  } else {
    console.log('Pool exists:', mftEthAddr);
    const pool = new ethers.Contract(mftEthAddr, POOL_ABI, provider);
    const [s] = await pool.slot0();
    if (s === 0n) {
      const pw = new ethers.Contract(mftEthAddr, POOL_ABI, wallet);
      await (await pw.initialize(sqrtP(mftEthPrice), { gasLimit: 500000 })).wait();
      console.log('Initialized');
    }
  }
  await sleep(3000);

  const mftEthPool = new ethers.Contract(mftEthAddr, POOL_ABI, provider);
  const [, meTick] = await mftEthPool.slot0();
  const met = Number(meTick);
  console.log('Tick:', met);

  // One-sided ETHband (token1) below current tick
  const ethEnd = Math.floor(met / TS) * TS;
  console.log('Band:', MIN_TICK, '→', ethEnd);

  const ethToken = new ethers.Contract(ETHBAND, ERC20, wallet);
  console.log('Approving ETHband...');
  await (await ethToken.approve(NPM, BAND_AMT)).wait();
  await sleep(1000);

  console.log('Minting...');
  const tx2 = await npm.mint({
    token0: MFT, token1: ETHBAND, fee: NEW_FEE,
    tickLower: MIN_TICK, tickUpper: ethEnd,
    amount0Desired: 0n, amount1Desired: BAND_AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 600
  }, { gasLimit: 5000000 });
  console.log('Tx:', tx2.hash);
  const r2 = await tx2.wait();
  const log2 = r2.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );
  const mftEthNft = log2 && log2.topics.length >= 4 ? BigInt(log2.topics[3]).toString() : 'unknown';
  console.log('NFT:', mftEthNft);
  await sleep(2000);

  // ═══ Send to reactors ═══
  console.log('\n=== Sending to Reactors ===');

  console.log('BTCband/MfT #' + btcMftNft + ' → BTC Reactor...');
  await (await npm.safeTransferFrom(wallet.address, BTC_REACTOR, btcMftNft, { gasLimit: 300000 })).wait();
  await sleep(1500);
  const btcRx = new ethers.Contract(BTC_REACTOR, RX_ABI, wallet);
  await (await btcRx.addPool(btcMftNft, { gasLimit: 500000 })).wait();
  console.log('BTC Reactor pools:', (await btcRx.poolCount()).toString());
  await sleep(1500);

  console.log('MfT/ETHband #' + mftEthNft + ' → ETH Reactor...');
  await (await npm.safeTransferFrom(wallet.address, ETH_REACTOR, mftEthNft, { gasLimit: 300000 })).wait();
  await sleep(1500);
  const ethRx = new ethers.Contract(ETH_REACTOR, RX_ABI, wallet);
  await (await ethRx.addPool(mftEthNft, { gasLimit: 500000 })).wait();
  console.log('ETH Reactor pools:', (await ethRx.poolCount()).toString());

  const gas = await provider.getBalance(wallet.address);
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║   MfT BAND FIX — CORRECTLY PRICED            ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log(`║ BTCband/MfT pool (3000): ${btcMftAddr}`);
  console.log(`║   NFT #${btcMftNft} → BTC Reactor`);
  console.log(`║ MfT/ETHband pool (3000): ${mftEthAddr}`);
  console.log(`║   NFT #${mftEthNft} → ETH Reactor`);
  console.log(`║ Price: 1 band = $1 = ${mftPerDollar.toExponential(2)} MfT`);
  console.log(`║ ETH remaining: ${ethers.formatEther(gas)}`);
  console.log('╚═══════════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
