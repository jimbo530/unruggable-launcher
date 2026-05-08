const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, p);

const BBT  = '0xc9435B119ebc921Ae75056C2871DFDDDca1b4a86';
const WETH = '0x4200000000000000000000000000000000000006';
const NPM  = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F  = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const FEE = 10000;
const TS = 200;
// 10% of 1M = 100,000 BBT
const BBT_AMOUNT = ethers.parseEther('100000');

const ERC20 = ['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'];
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

  // Get live ETH price
  const fact = new ethers.Contract(V3F, FACT, p);
  const ethPool = await fact.getPool(WETH, USDC, 500);
  const es = await new ethers.Contract(ethPool, POOL, p).slot0();
  const ethPrice = Math.pow(1.0001, Number(es[1])) * 1e12;
  console.log('ETH price: $' + ethPrice.toFixed(2));

  // WETH(0x42) is token0, BBT(0xc9) is token1 (both 18dec)
  // price = BBT per WETH. At $1 BBT: price = ethPrice
  const bbtPerWeth = ethPrice;
  const initTick = Math.round(Math.log(bbtPerWeth) / Math.log(1.0001) / TS) * TS;
  console.log('Init tick (rounded):', initTick, '-> $' + (ethPrice / Math.pow(1.0001, initTick)).toFixed(4) + '/BBT');

  // Sell wall: BBT is token1, need currentTick > tickUpper for 100% token1
  // Range just below init tick
  const tickUpper = initTick - TS;  // one below init
  const tickLower = tickUpper - 600; // 3 more spacings
  console.log('Sell wall: ticks', tickLower, 'to', tickUpper);

  for (const tk of [tickLower, tickLower+200, tickLower+400, tickUpper]) {
    const usd = ethPrice / Math.pow(1.0001, tk);
    console.log('  tick', tk, '-> $' + usd.toFixed(4));
  }
  console.log('initTick > tickUpper?', initTick > tickUpper);

  // Step 1: Create pool
  const factW = new ethers.Contract(V3F, FACT, w); // writable
  let poolAddr = await fact.getPool(BBT, WETH, FEE);
  if (poolAddr === ethers.ZeroAddress) {
    console.log('Creating BBT/WETH pool...');
    const tx = await factW.createPool(WETH, BBT, FEE, { gasLimit: 5000000 });
    await tx.wait();
    await sleep(3000);
    poolAddr = await fact.getPool(BBT, WETH, FEE);
    console.log('Pool created:', poolAddr);
  } else {
    console.log('Pool exists:', poolAddr);
  }

  // Step 2: Initialize
  const pool = new ethers.Contract(poolAddr, POOL, w);
  try {
    const s = await pool.slot0();
    if (s[0] === 0n) throw new Error('not init');
    console.log('Pool already initialized, tick:', Number(s[1]));
  } catch {
    const sqrtP = BigInt(Math.floor(Math.sqrt(bbtPerWeth) * 79228162514264337593543950336));
    console.log('Initializing at sqrtPriceX96:', sqrtP.toString());
    const tx = await pool.initialize(sqrtP, { gasLimit: 300000 });
    await tx.wait();
    await sleep(2000);
    const s = await pool.slot0();
    console.log('Initialized, tick:', Number(s[1]));
  }

  // Verify current tick is above our range
  const s = await pool.slot0();
  const ct = Number(s[1]);
  if (ct <= tickUpper) {
    console.log('ERROR: currentTick', ct, '<= tickUpper', tickUpper);
    process.exit(1);
  }

  // Step 3: Approve & Mint
  const bbt = new ethers.Contract(BBT, ERC20, w);
  const allowance = await bbt.allowance(w.address, NPM);
  if (allowance < BBT_AMOUNT) {
    console.log('Approving BBT...');
    await (await bbt.approve(NPM, ethers.MaxUint256, { gasLimit: 100000 })).wait();
  }

  // WETH is token0, BBT is token1 → amount0=0 (WETH), amount1=BBT
  console.log('Minting 100,000 BBT sell wall...');
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  const tx = await npm.mint({
    token0: WETH,
    token1: BBT,
    fee: FEE,
    tickLower: tickLower,
    tickUpper: tickUpper,
    amount0Desired: 0,
    amount1Desired: BBT_AMOUNT,
    amount0Min: 0,
    amount1Min: 0,
    recipient: w.address,
    deadline: Math.floor(Date.now() / 1000) + 600
  }, { gasLimit: 600000 });

  const receipt = await tx.wait();
  console.log('SUCCESS! Position NFT #' + nftId(receipt));
  console.log('BBT/WETH: 100,000 BBT | ticks', tickLower, 'to', tickUpper);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
