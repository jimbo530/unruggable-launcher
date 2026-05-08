const { ethers } = require('ethers');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, p);

const cbBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const USDC  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH  = '0x4200000000000000000000000000000000000006';
const NPM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F   = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 10000, TS = 200;

const abi = JSON.parse(fs.readFileSync(path.join(__dirname, '../archive/LaunchToken.abi'), 'utf8'));
const bin = fs.readFileSync(path.join(__dirname, '../archive/LaunchToken.bin'), 'utf8').trim();

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL  = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
];

function nftId(receipt) {
  const l = receipt.logs.find(x =>
    x.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    x.address.toLowerCase() === NPM.toLowerCase()
  );
  return l && l.topics.length >= 4 ? BigInt(l.topics[3]).toString() : 'unknown';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // Step 1: Deploy WALL token - 1M supply to wallet
  console.log('\n=== DEPLOYING WALL TOKEN ===');
  const factory = new ethers.ContractFactory(abi, bin, w);
  const token = await factory.deploy('Wall', 'WALL', ethers.parseEther('1000000'), w.address, { gasLimit: 2000000 });
  await token.waitForDeployment();
  const WALL = await token.getAddress();
  console.log('WALL:', WALL);
  await sleep(3000);

  // Verify balance
  const bal = await new ethers.Contract(WALL, ['function balanceOf(address) view returns (uint256)'], p).balanceOf(w.address);
  console.log('Balance:', ethers.formatEther(bal));

  // Step 2: Get live BTC price
  const v3f = new ethers.Contract(V3F, FACT, p);
  const btcPool = await v3f.getPool(cbBTC, USDC, 500);
  const bs = await new ethers.Contract(btcPool, POOL, p).slot0();
  const btcPrice = 1 / (Math.pow(1.0001, Number(bs[1])) * 0.01);
  console.log('BTC price: $' + btcPrice.toFixed(2));

  // Step 3: Figure out ordering
  const wallIsToken0 = WALL.toLowerCase() < cbBTC.toLowerCase();
  console.log('WALL is token0:', wallIsToken0);

  // WALL(18dec) vs cbBTC(8dec)
  // If WALL is token0: price = cbBTC_raw/WALL_raw = 1.0001^tick
  //   At $1 WALL: cbBTC per WALL = 1/btcPrice, raw = (1/btcPrice) * 10^(18-8) = 10^10/btcPrice  // Hmm wait.
  //   price_raw = token1_raw / token0_raw. If token0=WALL(18dec), token1=cbBTC(8dec):
  //   For 1 WALL ($1) = 1/btcPrice cbBTC. raw: (1/btcPrice * 1e8) / (1 * 1e18) = 1e8/(btcPrice*1e18) = 1/(btcPrice*1e10)
  //   tick = log(1/(btcPrice*1e10)) / log(1.0001)
  // If WALL is token1: price = WALL_raw/cbBTC_raw = 1.0001^tick
  //   For 1 cbBTC ($btcPrice) = btcPrice WALL. raw: (btcPrice*1e18)/(1*1e8) = btcPrice*1e10
  //   tick = log(btcPrice*1e10) / log(1.0001)

  let initRatio, initTick, tickLower, tickUpper;

  if (wallIsToken0) {
    // token0=WALL(18), token1=cbBTC(8)
    // ratio = 1/(btcPrice * 1e10)
    initRatio = 1 / (btcPrice * 1e10);
    initTick = Math.round(Math.log(initRatio) / Math.log(1.0001) / TS) * TS;
    // For sell wall (100% WALL = token0): need currentTick < tickLower
    tickLower = initTick + TS; // one above current
    tickUpper = tickLower + TS; // single tick spacing
  } else {
    // token0=cbBTC(8), token1=WALL(18)
    // ratio = btcPrice * 1e10
    initRatio = btcPrice * 1e10;
    initTick = Math.round(Math.log(initRatio) / Math.log(1.0001) / TS) * TS;
    // For sell wall (100% WALL = token1): need currentTick > tickUpper
    tickUpper = initTick - TS; // one below current
    tickLower = tickUpper - TS; // single tick spacing
  }

  console.log('Init ratio:', initRatio.toExponential(6));
  console.log('Init tick:', initTick);
  console.log('Sell wall: single tick', tickLower, 'to', tickUpper);

  // Verify the tick gives ~$1
  if (wallIsToken0) {
    const wallPrice = (1 / Math.pow(1.0001, tickLower)) * btcPrice / 1e10;
    const wallPriceHi = (1 / Math.pow(1.0001, tickUpper)) * btcPrice / 1e10;
    console.log('WALL price at tickLower: $' + wallPrice.toFixed(4));
    console.log('WALL price at tickUpper: $' + wallPriceHi.toFixed(4));
  } else {
    const wallPriceLo = Math.pow(1.0001, tickLower) / (btcPrice * 1e10) * btcPrice;
    // Simpler: at tick T, WALL_per_cbBTC = 1.0001^T / 1e10, WALL price = btcPrice / WALL_per_cbBTC...
    // Let me just compute directly
    const lo = btcPrice / (Math.pow(1.0001, tickLower) / 1e10);
    const hi = btcPrice / (Math.pow(1.0001, tickUpper) / 1e10);
    console.log('WALL price at tickLower: $' + lo.toFixed(4));
    console.log('WALL price at tickUpper: $' + hi.toFixed(4));
  }

  // Step 4: Create pool
  console.log('\n=== CREATING POOL ===');
  const factW = new ethers.Contract(V3F, FACT, w);
  const tx1 = await factW.createPool(WALL, cbBTC, FEE, { gasLimit: 5000000 });
  await tx1.wait();
  await sleep(4000);
  const poolAddr = await v3f.getPool(WALL, cbBTC, FEE);
  console.log('Pool:', poolAddr);

  // Step 5: Initialize
  const sqrtP = BigInt(Math.floor(Math.sqrt(initRatio) * 79228162514264337593543950336));
  console.log('Initializing...');
  const pool = new ethers.Contract(poolAddr, POOL, w);
  await (await pool.initialize(sqrtP, { gasLimit: 300000 })).wait();
  await sleep(3000);
  const s = await new ethers.Contract(poolAddr, POOL, p).slot0();
  const ct = Number(s[1]);
  console.log('Current tick:', ct);

  // Verify position is one-sided
  if (wallIsToken0) {
    console.log('Need ct < tickLower:', ct < tickLower);
    if (ct >= tickLower) { console.log('ERROR: tick inside range'); process.exit(1); }
  } else {
    console.log('Need ct > tickUpper:', ct > tickUpper);
    if (ct <= tickUpper) { console.log('ERROR: tick inside range'); process.exit(1); }
  }

  // Step 6: Approve and mint
  console.log('\n=== MINTING 600K WALL SELL WALL ===');
  await (await new ethers.Contract(WALL, ERC20, w).approve(NPM, ethers.MaxUint256, { gasLimit: 100000 })).wait();
  await sleep(2000);

  const AMOUNT = ethers.parseEther('600000');
  const npm = new ethers.Contract(NPM, NPM_ABI, w);

  const [t0, t1] = wallIsToken0 ? [WALL, cbBTC] : [cbBTC, WALL];
  const [a0, a1] = wallIsToken0 ? [AMOUNT, 0] : [0, AMOUNT];

  const tx = await npm.mint({
    token0: t0, token1: t1, fee: FEE,
    tickLower, tickUpper,
    amount0Desired: a0, amount1Desired: a1,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address,
    deadline: Math.floor(Date.now() / 1000) + 600
  }, { gasLimit: 600000 });
  const receipt = await tx.wait();
  const id = nftId(receipt);

  console.log('\n===========================');
  console.log('WALL token:', WALL);
  console.log('WALL/cbBTC pool:', poolAddr);
  console.log('Position NFT #' + id);
  console.log('600K WALL on single tick:', tickLower, 'to', tickUpper);
  console.log('400K WALL in wallet');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
