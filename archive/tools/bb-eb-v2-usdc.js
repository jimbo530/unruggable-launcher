const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB   = '0xc70Da837A17D1f7eb196B92D0910F836367cB68B';
const EB   = '0xF3fC24d9e4Ad5F16552e9b12500f8dd0aF7d13aD';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NPM  = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F  = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 3000, MAX_TICK = 887220;
// 1 BB/EB (18 dec) + $1 USDC (6 dec)
const TOKEN_AMT = ethers.parseUnits('1', 18);
const USDC_AMT  = 1000000n; // $1

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL  = ['function initialize(uint160) external'];
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

  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // Approvals
  console.log('\nApproving BB, EB, USDC...');
  await (await new ethers.Contract(BB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);
  await (await new ethers.Contract(EB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);
  await (await new ethers.Contract(USDC, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);

  // Both pools: USDC(0x8335) < BB(0xc70D) and USDC(0x8335) < EB(0xF3fC) → USDC=token0
  // USDC(6dec)=token0, token(18dec)=token1
  // At $1: 1 USDC(6dec) = 1 token(18dec)
  // price = token1_raw/token0_raw = 1e18/1e6 = 1e12
  const price = 1e12;

  // === USDC/BB ===
  console.log('\n=== USDC / BB (USDC=token0) ===');
  console.log('Creating pool...');
  await (await factory.createPool(USDC, BB, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  const bbPool = await factory.getPool(USDC, BB, FEE);
  console.log('Pool:', bbPool);
  await (await new ethers.Contract(bbPool, POOL, w).initialize(sqrtP(price), {gasLimit: 300000})).wait();
  console.log('Initialized at $1');
  await sleep(3000);

  console.log('Minting 1 BB + $1 USDC full range...');
  let tx = await npm.mint({
    token0: USDC, token1: BB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: MAX_TICK,
    amount0Desired: USDC_AMT, amount1Desired: TOKEN_AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  let r = await tx.wait();
  console.log('BB/USDC NFT #' + nftId(r));
  await sleep(3000);

  // === USDC/EB ===
  console.log('\n=== USDC / EB (USDC=token0) ===');
  console.log('Creating pool...');
  await (await factory.createPool(USDC, EB, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  const ebPool = await factory.getPool(USDC, EB, FEE);
  console.log('Pool:', ebPool);
  await (await new ethers.Contract(ebPool, POOL, w).initialize(sqrtP(price), {gasLimit: 300000})).wait();
  console.log('Initialized at $1');
  await sleep(3000);

  console.log('Minting 1 EB + $1 USDC full range...');
  tx = await npm.mint({
    token0: USDC, token1: EB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: MAX_TICK,
    amount0Desired: USDC_AMT, amount1Desired: TOKEN_AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  console.log('EB/USDC NFT #' + nftId(r));

  console.log('\n=== DONE ===');
  console.log('BB pool:', bbPool);
  console.log('EB pool:', ebPool);
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
