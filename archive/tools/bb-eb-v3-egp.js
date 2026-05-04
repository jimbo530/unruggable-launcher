const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB  = '0xC89344F08fdE43aa65Dce4A7FcEb8284B201293e';
const EB  = '0x15e274AbAe2645E5fBAc29Ab790837b484Cb5bCe';
const EGP = '0xc1BA76771bbF0dD841347630E57c793F9d5ACcEe';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 3000, TS = 60, MAX_TICK = 887220;
const AMT = ethers.parseUnits('10000', 18);
const EGP_USD = 0.00024; // $0.00024 → 4167 EGP per $1

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL  = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
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
  console.log('EGP per $1:', (1/EGP_USD).toFixed(0));

  console.log('Approving BB, EB...');
  await (await new ethers.Contract(BB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(2000);
  await (await new ethers.Contract(EB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(2000);

  // EGP/BB: EGP(0xc1BA) < BB(0xC893)? 0xc1BA < 0xC893 → EGP=t0(18), BB=t1(18)
  // raw = BB_per_EGP = EGP_USD/BB_USD = 0.00024
  console.log('\n=== EGP / BB (EGP=token0) ===');
  await (await factory.createPool(EGP, BB, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  let addr = await factory.getPool(EGP, BB, FEE);
  console.log('Pool:', addr);
  await (await new ethers.Contract(addr, POOL, w).initialize(sqrtP(EGP_USD), {gasLimit: 300000})).wait();
  await sleep(2000);
  const [, t1] = await new ethers.Contract(addr, POOL, p).slot0();
  const wallEnd1 = Math.floor(Number(t1) / TS) * TS - TS;
  console.log('tick:', Number(t1), 'wall [-887220,' + wallEnd1 + '] 10K BB');
  let tx = await npm.mint({
    token0: EGP, token1: BB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: wallEnd1,
    amount0Desired: 0n, amount1Desired: AMT,
    amount0Min: 0, amount1Min: 0, recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  let r = await tx.wait();
  console.log('NFT#' + nftId(r));
  await sleep(2000);

  // EB/EGP: EB(0x15e2) < EGP(0xc1BA) → EB=t0(18), EGP=t1(18)
  // raw = EGP_per_EB = 1/EGP_USD = 4167
  console.log('\n=== EB / EGP (EB=token0) ===');
  await (await factory.createPool(EB, EGP, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  addr = await factory.getPool(EB, EGP, FEE);
  console.log('Pool:', addr);
  await (await new ethers.Contract(addr, POOL, w).initialize(sqrtP(1/EGP_USD), {gasLimit: 300000})).wait();
  await sleep(2000);
  const [, t2] = await new ethers.Contract(addr, POOL, p).slot0();
  const wallStart2 = Math.ceil(Number(t2) / TS) * TS + TS;
  console.log('tick:', Number(t2), 'wall [' + wallStart2 + ', 887220] 10K EB');
  tx = await npm.mint({
    token0: EB, token1: EGP, fee: FEE,
    tickLower: wallStart2, tickUpper: MAX_TICK,
    amount0Desired: AMT, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0, recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  console.log('NFT#' + nftId(r));

  console.log('\nDONE');
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
