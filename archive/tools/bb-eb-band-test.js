const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB    = '0x0a8D80645DB5fC0c34552422db14163614a45940';
const EB    = '0xeF1C31a18969d7b44898c7D685386a0660761FE3';
const cbBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const WETH  = '0x4200000000000000000000000000000000000006';
const USDC  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NPM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F   = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 3000, TS = 60, MAX_TICK = 887220;
const TEST_AMT = ethers.parseUnits('1000', 18); // tiny test

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL  = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function nftId(receipt) {
  const l = receipt.logs.find(x =>
    x.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    x.address.toLowerCase() === NPM.toLowerCase()
  );
  return l && l.topics.length >= 4 ? BigInt(l.topics[3]).toString() : 'unknown';
}

// Get price from tick, accounting for decimals
function priceFromTick(tick, dec0, dec1) {
  // price_raw = 1.0001^tick = token1_smallest / token0_smallest
  // human price (token1 per token0) = price_raw * 10^dec0 / 10^dec1
  const rawPrice = Math.pow(1.0001, tick);
  return rawPrice * Math.pow(10, dec0 - dec1);
}

// sqrtPriceX96 from a raw price (token1_smallest / token0_smallest)
function sqrtPX96(rawPrice) {
  return BigInt(Math.floor(Math.sqrt(rawPrice) * 79228162514264337593543950336));
}

async function main() {
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  const factory = new ethers.Contract(V3F, FACT, w);
  const dl = Math.floor(Date.now() / 1000) + 600;

  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // === GET LIVE PRICES ===
  // cbBTC price from USDC pool (fee 500)
  const btcPool = new ethers.Contract('0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef', POOL, p);
  const [, btcTick] = await btcPool.slot0();
  // USDC(0x8335) < cbBTC(0xcbB7) → USDC=token0(6dec), cbBTC=token1(8dec)
  // priceFromTick gives cbBTC per USDC (human). BTC in USD = 1/that
  const cbBTCperUSDC = priceFromTick(Number(btcTick), 6, 8);
  const btcUSD = 1 / cbBTCperUSDC;
  console.log('\ncbBTC price: $' + btcUSD.toFixed(0), '(tick ' + btcTick + ')');

  // ETH price from USDC pool (fee 500 - 0xd0b53D)
  const ethPool = new ethers.Contract('0xd0b53D9277642d899DF5C87A3966A349A798F224', POOL, p);
  const [, ethTick] = await ethPool.slot0();
  // WETH(0x4200) < USDC(0x8335) → WETH=token0(18dec), USDC=token1(6dec)
  // priceFromTick gives USDC per WETH (human) = ETH price
  const ethUSD = priceFromTick(Number(ethTick), 18, 6);
  console.log('WETH price: $' + ethUSD.toFixed(2), '(tick ' + ethTick + ')');

  // === COMPUTE INIT PRICES ===
  // BB/cbBTC: BB(0x0a8D) < cbBTC(0xcbB7) → BB=token0(18dec), cbBTC=token1(8dec)
  // 1 BB = $1, so 1 BB = (1/btcUSD) cbBTC
  // raw price = token1_smallest/token0_smallest = ((1/btcUSD)*1e8) / 1e18 = 1e8/(btcUSD*1e18)
  const bbBtcRaw = 1e8 / (btcUSD * 1e18);
  const bbBtcTick = Math.round(Math.log(bbBtcRaw) / Math.log(1.0001));
  const bbBtcTickAligned = Math.round(bbBtcTick / TS) * TS;
  console.log('\nBB/cbBTC init: raw=' + bbBtcRaw.toExponential(4) + ' tick≈' + bbBtcTickAligned);

  // WETH/EB: WETH(0x4200) < EB(0xeF1C) → WETH=token0(18dec), EB=token1(18dec)
  // 1 WETH = $ethUSD, 1 EB = $1, so 1 WETH buys ethUSD EB
  // raw price = token1_smallest/token0_smallest = ethUSD (same decimals)
  const wethEbRaw = ethUSD;
  const wethEbTick = Math.round(Math.log(wethEbRaw) / Math.log(1.0001));
  const wethEbTickAligned = Math.round(wethEbTick / TS) * TS;
  console.log('WETH/EB init: raw=' + wethEbRaw.toFixed(2) + ' tick≈' + wethEbTickAligned);

  // Approvals
  console.log('\nApproving BB, EB...');
  await (await new ethers.Contract(BB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);
  await (await new ethers.Contract(EB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);

  // === BB / cbBTC pool ===
  console.log('\n=== BB / cbBTC (BB=token0) ===');
  let poolAddr = await factory.getPool(BB, cbBTC, FEE);
  if (poolAddr === ethers.ZeroAddress) {
    console.log('Creating pool...');
    await (await factory.createPool(BB, cbBTC, FEE, {gasLimit: 5000000})).wait();
    await sleep(3000);
    poolAddr = await factory.getPool(BB, cbBTC, FEE);
    console.log('Pool:', poolAddr);
    const sqrtInit = sqrtPX96(bbBtcRaw);
    console.log('Init sqrtPriceX96:', sqrtInit.toString().slice(0,20) + '...');
    await (await new ethers.Contract(poolAddr, POOL, w).initialize(sqrtInit, {gasLimit: 300000})).wait();
    console.log('Initialized (BB=$1)');
  } else {
    console.log('Pool exists:', poolAddr);
  }
  await sleep(3000);

  // Verify tick
  const [, bbActualTick] = await new ethers.Contract(poolAddr, POOL, p).slot0();
  const bbActualPrice = priceFromTick(Number(bbActualTick), 18, 8) * btcUSD;
  console.log('Actual tick:', Number(bbActualTick), '→ BB=$' + bbActualPrice.toFixed(4));

  // Sell BB (token0) above current tick: wall starts 1 TS above
  const bbWallStart = Math.ceil(Number(bbActualTick) / TS) * TS + TS;
  console.log('Wall [' + bbWallStart + ', ' + MAX_TICK + '] 1000 BB');
  let tx = await npm.mint({
    token0: BB, token1: cbBTC, fee: FEE,
    tickLower: bbWallStart, tickUpper: MAX_TICK,
    amount0Desired: TEST_AMT, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  let r = await tx.wait();
  console.log('BB/cbBTC wall NFT #' + nftId(r));
  await sleep(3000);

  // === WETH / EB pool ===
  console.log('\n=== WETH / EB (WETH=token0) ===');
  poolAddr = await factory.getPool(WETH, EB, FEE);
  if (poolAddr === ethers.ZeroAddress) {
    console.log('Creating pool...');
    await (await factory.createPool(WETH, EB, FEE, {gasLimit: 5000000})).wait();
    await sleep(3000);
    poolAddr = await factory.getPool(WETH, EB, FEE);
    console.log('Pool:', poolAddr);
    const sqrtInit = sqrtPX96(wethEbRaw);
    console.log('Init sqrtPriceX96:', sqrtInit.toString().slice(0,20) + '...');
    await (await new ethers.Contract(poolAddr, POOL, w).initialize(sqrtInit, {gasLimit: 300000})).wait();
    console.log('Initialized (EB=$1)');
  } else {
    console.log('Pool exists:', poolAddr);
  }
  await sleep(3000);

  // Verify tick
  const [, ebActualTick] = await new ethers.Contract(poolAddr, POOL, p).slot0();
  const ebActualPrice = priceFromTick(Number(ebActualTick), 18, 18);
  console.log('Actual tick:', Number(ebActualTick), '→ 1 WETH = ' + ebActualPrice.toFixed(2) + ' EB → EB=$' + (ethUSD / ebActualPrice).toFixed(4));

  // Sell EB (token1) below current tick: wall ends 1 TS below
  const ebWallEnd = Math.floor(Number(ebActualTick) / TS) * TS - TS;
  console.log('Wall [-' + MAX_TICK + ', ' + ebWallEnd + '] 1000 EB');
  tx = await npm.mint({
    token0: WETH, token1: EB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: ebWallEnd,
    amount0Desired: 0n, amount1Desired: TEST_AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  console.log('WETH/EB wall NFT #' + nftId(r));

  console.log('\nDONE — check these on-chain before adding more');
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
