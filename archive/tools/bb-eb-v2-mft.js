const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB  = '0xc70Da837A17D1f7eb196B92D0910F836367cB68B';
const EB  = '0xF3fC24d9e4Ad5F16552e9b12500f8dd0aF7d13aD';
const MfT = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 3000, TS = 60, MAX_TICK = 887220;
const AMT = ethers.parseUnits('50000', 18); // 5%

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL  = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const V2    = ['function getReserves() view returns (uint112,uint112,uint32)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function sqrtP(pr) { return BigInt(Math.floor(Math.sqrt(pr) * 79228162514264337593543950336)); }
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

  // Get MfT price from USDGLO V2 pool
  // USDGLO=token0, MfT=token1. MfT price = r0/r1 (USDGLO per MfT)
  const [r0, r1] = await new ethers.Contract('0x74af6fd7f98d4ec868156e7d33c6db81fc222e84', V2, p).getReserves();
  const mftPrice = Number(r0) / Number(r1); // ~2.748e-7
  const mftPerDollar = 1 / mftPrice;
  console.log('MfT price: $' + mftPrice.toExponential(4));
  console.log('MfT per $1:', mftPerDollar.toFixed(0));

  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // Approvals
  console.log('\nApproving BB, EB...');
  await (await new ethers.Contract(BB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);
  await (await new ethers.Contract(EB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);

  // Both: MfT(0x8FB8) < BB(0xc70D) and MfT(0x8FB8) < EB(0xF3fC) → MfT=token0
  // Both 18 dec. price = token1/token0 = BB_per_MfT = 1/mftPerDollar = mftPrice
  // Init at $1.00
  const initPrice = mftPrice; // ~2.748e-7 BB per MfT

  // === MfT/BB ===
  console.log('\n=== MfT / BB (MfT=token0) ===');
  console.log('Creating pool...');
  await (await factory.createPool(MfT, BB, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  let poolAddr = await factory.getPool(MfT, BB, FEE);
  console.log('Pool:', poolAddr);
  await (await new ethers.Contract(poolAddr, POOL, w).initialize(sqrtP(initPrice), {gasLimit: 300000})).wait();
  console.log('Initialized (BB=$1)');
  await sleep(3000);

  // Verify tick
  const [, bbTick] = await new ethers.Contract(poolAddr, POOL, p).slot0();
  console.log('Actual tick:', Number(bbTick));

  // Sell BB (token1) below current tick at $1.01
  // At $1.01: mftPerBB = mftPerDollar * 1.01, price = 1/(mftPerDollar*1.01) — more negative tick
  const wallEnd = Math.floor(Number(bbTick) / TS) * TS - TS;
  console.log('Wall [-' + MAX_TICK + ', ' + wallEnd + '] 10K BB');
  let tx = await npm.mint({
    token0: MfT, token1: BB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: wallEnd,
    amount0Desired: 0n, amount1Desired: AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  let r = await tx.wait();
  console.log('MfT/BB wall NFT #' + nftId(r));
  await sleep(3000);

  // === MfT/EB ===
  console.log('\n=== MfT / EB (MfT=token0) ===');
  console.log('Creating pool...');
  await (await factory.createPool(MfT, EB, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  poolAddr = await factory.getPool(MfT, EB, FEE);
  console.log('Pool:', poolAddr);
  await (await new ethers.Contract(poolAddr, POOL, w).initialize(sqrtP(initPrice), {gasLimit: 300000})).wait();
  console.log('Initialized (EB=$1)');
  await sleep(3000);

  const [, ebTick] = await new ethers.Contract(poolAddr, POOL, p).slot0();
  console.log('Actual tick:', Number(ebTick));

  const wallEnd2 = Math.floor(Number(ebTick) / TS) * TS - TS;
  console.log('Wall [-' + MAX_TICK + ', ' + wallEnd2 + '] 10K EB');
  tx = await npm.mint({
    token0: MfT, token1: EB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: wallEnd2,
    amount0Desired: 0n, amount1Desired: AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  console.log('MfT/EB wall NFT #' + nftId(r));

  console.log('\nDONE');
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
