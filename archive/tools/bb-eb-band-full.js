const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB    = '0x0a8D80645DB5fC0c34552422db14163614a45940';
const EB    = '0xeF1C31a18969d7b44898c7D685386a0660761FE3';
const cbBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const WETH  = '0x4200000000000000000000000000000000000006';
const NPM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

const FEE = 3000, TS = 60, MAX_TICK = 887220;
const AMT = ethers.parseUnits('499000', 18); // 499K (already used 1K in test)

const POOL = ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
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

async function main() {
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  const dl = Math.floor(Date.now() / 1000) + 600;

  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // BB/cbBTC pool already exists and is initialized
  const bbPool = '0x67DaA47E11B32f3aA051e9ECbE7197Fe27a5d678';
  const [, bbTick] = await new ethers.Contract(bbPool, POOL, p).slot0();
  const bbWallStart = Math.ceil(Number(bbTick) / TS) * TS + TS;
  console.log('\nBB/cbBTC tick:', Number(bbTick), '→ wall [' + bbWallStart + ', ' + MAX_TICK + '] 499K BB');

  // BB is token0, sell above
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

  // WETH/EB pool already exists and is initialized
  const ebPool = '0xB9268c221A1AF489313a97ea4E05F49d8CEa654d';
  const [, ebTick] = await new ethers.Contract(ebPool, POOL, p).slot0();
  const ebWallEnd = Math.floor(Number(ebTick) / TS) * TS - TS;
  console.log('\nWETH/EB tick:', Number(ebTick), '→ wall [-' + MAX_TICK + ', ' + ebWallEnd + '] 499K EB');

  // EB is token1, sell below
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
