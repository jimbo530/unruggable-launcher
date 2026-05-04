const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB   = '0xc70Da837A17D1f7eb196B92D0910F836367cB68B';
const EB   = '0xF3fC24d9e4Ad5F16552e9b12500f8dd0aF7d13aD';
const BRUH = '0xe61b190c0f0070e07de3bb4829fe5fdcf7d934f1';
const NPM  = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F  = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 3000, TS = 60, MAX_TICK = 887220;
const AMT = ethers.parseUnits('10000', 18); // 1%

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

  // Get live BRUH price from WETH pool
  const [, bruhTick] = await new ethers.Contract('0xFa6ba5fC25F751042ede6c0691705dCA64Cc60F8', POOL, p).slot0();
  const bruhPerWeth = Math.pow(1.0001, Number(bruhTick));
  const ethUsd = 2311;
  const bruhPerDollar = bruhPerWeth / ethUsd; // ~897M BRUH per $1
  console.log('BRUH per $1:', bruhPerDollar.toExponential(4));

  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // Approvals
  console.log('\nApproving BB, EB...');
  await (await new ethers.Contract(BB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);
  await (await new ethers.Contract(EB, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(3000);

  // === BB/BRUH: BB(0xc70D) < BRUH(0xe61b) → BB=token0, BRUH=token1 ===
  // Both 18 dec. 1 BB = bruhPerDollar BRUH
  // raw price = token1/token0 = bruhPerDollar (same decimals)
  const bbBruhPrice = bruhPerDollar;
  const bbBruhInitTick = Math.round(Math.log(bbBruhPrice) / Math.log(1.0001));
  console.log('\n=== BB / BRUH (BB=token0) ===');
  console.log('Init price:', bbBruhPrice.toExponential(4), 'BRUH per BB, tick≈' + bbBruhInitTick);

  console.log('Creating pool...');
  await (await factory.createPool(BB, BRUH, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  let poolAddr = await factory.getPool(BB, BRUH, FEE);
  console.log('Pool:', poolAddr);
  await (await new ethers.Contract(poolAddr, POOL, w).initialize(sqrtP(bbBruhPrice), {gasLimit: 300000})).wait();
  console.log('Initialized');
  await sleep(3000);

  // Verify
  const [, bbActTick] = await new ethers.Contract(poolAddr, POOL, p).slot0();
  console.log('Actual tick:', Number(bbActTick));

  // Sell BB (token0) above current tick
  const bbWallStart = Math.ceil(Number(bbActTick) / TS) * TS + TS;
  console.log('Wall [' + bbWallStart + ', ' + MAX_TICK + '] 10K BB');
  let tx = await npm.mint({
    token0: BB, token1: BRUH, fee: FEE,
    tickLower: bbWallStart, tickUpper: MAX_TICK,
    amount0Desired: AMT, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  let r = await tx.wait();
  console.log('BB/BRUH wall NFT #' + nftId(r));
  await sleep(3000);

  // === BRUH/EB: BRUH(0xe61b) < EB(0xF3fC) → BRUH=token0, EB=token1 ===
  // Both 18 dec. 1 EB = bruhPerDollar BRUH
  // raw price = token1/token0 = EB/BRUH = 1/bruhPerDollar
  const bruhEbPrice = 1 / bruhPerDollar;
  const bruhEbInitTick = Math.round(Math.log(bruhEbPrice) / Math.log(1.0001));
  console.log('\n=== BRUH / EB (BRUH=token0) ===');
  console.log('Init price:', bruhEbPrice.toExponential(4), 'EB per BRUH, tick≈' + bruhEbInitTick);

  console.log('Creating pool...');
  await (await factory.createPool(BRUH, EB, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  poolAddr = await factory.getPool(BRUH, EB, FEE);
  console.log('Pool:', poolAddr);
  await (await new ethers.Contract(poolAddr, POOL, w).initialize(sqrtP(bruhEbPrice), {gasLimit: 300000})).wait();
  console.log('Initialized');
  await sleep(3000);

  // Verify
  const [, ebActTick] = await new ethers.Contract(poolAddr, POOL, p).slot0();
  console.log('Actual tick:', Number(ebActTick));

  // Sell EB (token1) below current tick
  const ebWallEnd = Math.floor(Number(ebActTick) / TS) * TS - TS;
  console.log('Wall [-' + MAX_TICK + ', ' + ebWallEnd + '] 10K EB');
  tx = await npm.mint({
    token0: BRUH, token1: EB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: ebWallEnd,
    amount0Desired: 0n, amount1Desired: AMT,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  console.log('BRUH/EB wall NFT #' + nftId(r));

  console.log('\nDONE');
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
