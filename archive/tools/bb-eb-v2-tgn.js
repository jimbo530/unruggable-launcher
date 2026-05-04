const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB  = '0xc70Da837A17D1f7eb196B92D0910F836367cB68B';
const EB  = '0xF3fC24d9e4Ad5F16552e9b12500f8dd0aF7d13aD';
const TGN = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 3000, MAX_TICK = 887220;
const AMT = ethers.parseUnits('10000', 18); // 1%

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

  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // Approvals
  console.log('Approving BB, EB...');
  await (await new ethers.Contract(BB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);
  await (await new ethers.Contract(EB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);

  // BB(0xc70D) vs TGN(0xD75d): 0xc70D < 0xD75d → BB=token0, TGN=token1
  // Both 18 dec, both ~$1. Init at 1:1. Sell BB (token0) above: [120, MAX_TICK]
  console.log('\n=== BB / TGN (BB=token0) ===');
  console.log('Creating pool...');
  await (await factory.createPool(BB, TGN, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  let poolAddr = await factory.getPool(BB, TGN, FEE);
  console.log('Pool:', poolAddr);
  await (await new ethers.Contract(poolAddr, POOL, w).initialize(sqrtP(1.0), {gasLimit: 300000})).wait();
  console.log('Initialized at $1:$1');
  await sleep(3000);

  console.log('Minting 10K BB wall [120, 887220]...');
  let tx = await npm.mint({
    token0: BB, token1: TGN, fee: FEE,
    tickLower: 120, tickUpper: MAX_TICK,
    amount0Desired: AMT, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  let r = await tx.wait();
  console.log('BB/TGN wall NFT #' + nftId(r));
  await sleep(3000);

  // EB(0xF3fC) vs TGN(0xD75d): 0xD75d < 0xF3fC → TGN=token0, EB=token1
  // Both 18 dec. Init at 1:1. Sell EB (token1) below: [-MAX_TICK, -120]
  console.log('\n=== TGN / EB (TGN=token0) ===');
  console.log('Creating pool...');
  await (await factory.createPool(TGN, EB, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  poolAddr = await factory.getPool(TGN, EB, FEE);
  console.log('Pool:', poolAddr);
  await (await new ethers.Contract(poolAddr, POOL, w).initialize(sqrtP(1.0), {gasLimit: 300000})).wait();
  console.log('Initialized at $1:$1');
  await sleep(3000);

  console.log('Minting 10K EB wall [-887220, -120]...');
  tx = await npm.mint({
    token0: TGN, token1: EB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: -120,
    amount0Desired: 0n, amount1Desired: AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  console.log('TGN/EB wall NFT #' + nftId(r));

  console.log('\nDONE');
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
