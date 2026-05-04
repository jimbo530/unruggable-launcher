const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB    = '0xc70Da837A17D1f7eb196B92D0910F836367cB68B';
const EB    = '0xF3fC24d9e4Ad5F16552e9b12500f8dd0aF7d13aD';
const cbBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const WETH  = '0x4200000000000000000000000000000000000006';
const NPM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F   = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 3000, TS = 60, MAX_TICK = 887220;
const AMT = ethers.parseUnits('500000', 18); // 50%

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL  = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function sqrtPX96(rawPrice) { return BigInt(Math.floor(Math.sqrt(rawPrice) * 79228162514264337593543950336)); }
function nftId(receipt) {
  const l = receipt.logs.find(x =>
    x.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    x.address.toLowerCase() === NPM.toLowerCase()
  );
  return l && l.topics.length >= 4 ? BigInt(l.topics[3]).toString() : 'unknown';
}

async function main() {
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  const factory = new ethers.Contract(V3F, FACT, w);
  const dl = Math.floor(Date.now() / 1000) + 600;

  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // Get live prices
  // cbBTC from USDC pool (fee 500): USDC=token0(6dec), cbBTC=token1(8dec)
  const [, btcTick] = await new ethers.Contract('0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef', POOL, p).slot0();
  const cbBTCperUSDC = Math.pow(1.0001, Number(btcTick)) * Math.pow(10, 6-8);
  const btcUSD = 1 / cbBTCperUSDC;
  console.log('cbBTC: $' + btcUSD.toFixed(0));

  // ETH from USDC pool (fee 500): WETH=token0(18dec), USDC=token1(6dec)
  const [, ethTick] = await new ethers.Contract('0xd0b53D9277642d899DF5C87A3966A349A798F224', POOL, p).slot0();
  const ethUSD = Math.pow(1.0001, Number(ethTick)) * Math.pow(10, 18-6);
  console.log('WETH: $' + ethUSD.toFixed(2));

  // Approvals
  console.log('\nApproving BB, EB...');
  await (await new ethers.Contract(BB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);
  await (await new ethers.Contract(EB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);

  // === BB/cbBTC: BB(0xc70D) < cbBTC(0xcbB7)? ===
  // c70D vs cbB7: c7 < cb → BB=token0(18dec), cbBTC=token1(8dec)
  // 1 BB=$1 → 1 BB = (1/btcUSD) cbBTC
  // raw price = token1_raw/token0_raw = ((1/btcUSD)*1e8) / 1e18 = 1e8/(btcUSD*1e18)
  const bbBtcRaw = 1e8 / (btcUSD * 1e18);
  console.log('\n=== BB / cbBTC (BB=token0) ===');
  console.log('Creating pool...');
  await (await factory.createPool(BB, cbBTC, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  let poolAddr = await factory.getPool(BB, cbBTC, FEE);
  console.log('Pool:', poolAddr);
  await (await new ethers.Contract(poolAddr, POOL, w).initialize(sqrtPX96(bbBtcRaw), {gasLimit: 300000})).wait();
  console.log('Initialized (BB=$1)');
  await sleep(3000);

  const [, bbActTick] = await new ethers.Contract(poolAddr, POOL, p).slot0();
  console.log('Actual tick:', Number(bbActTick));
  const bbWallStart = Math.ceil(Number(bbActTick) / TS) * TS + TS;
  console.log('Wall [' + bbWallStart + ', ' + MAX_TICK + '] 500K BB');
  let tx = await npm.mint({
    token0: BB, token1: cbBTC, fee: FEE,
    tickLower: bbWallStart, tickUpper: MAX_TICK,
    amount0Desired: AMT, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  let r = await tx.wait();
  console.log('BB/cbBTC wall NFT #' + nftId(r));
  await sleep(3000);

  // === WETH/EB: WETH(0x4200) < EB(0xF3fC) → WETH=token0(18dec), EB=token1(18dec) ===
  // 1 WETH = $ethUSD, 1 EB = $1, so 1 WETH = ethUSD EB
  // raw price = ethUSD (same decimals)
  const wethEbRaw = ethUSD;
  console.log('\n=== WETH / EB (WETH=token0) ===');
  console.log('Creating pool...');
  await (await factory.createPool(WETH, EB, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  poolAddr = await factory.getPool(WETH, EB, FEE);
  console.log('Pool:', poolAddr);
  await (await new ethers.Contract(poolAddr, POOL, w).initialize(sqrtPX96(wethEbRaw), {gasLimit: 300000})).wait();
  console.log('Initialized (EB=$1)');
  await sleep(3000);

  const [, ebActTick] = await new ethers.Contract(poolAddr, POOL, p).slot0();
  console.log('Actual tick:', Number(ebActTick));
  const ebWallEnd = Math.floor(Number(ebActTick) / TS) * TS - TS;
  console.log('Wall [-' + MAX_TICK + ', ' + ebWallEnd + '] 500K EB');
  tx = await npm.mint({
    token0: WETH, token1: EB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: ebWallEnd,
    amount0Desired: 0n, amount1Desired: AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  console.log('WETH/EB wall NFT #' + nftId(r));

  console.log('\nDONE');
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
