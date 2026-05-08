const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, p);

const BBT   = '0xc9435B119ebc921Ae75056C2871DFDDDca1b4a86';
const cbBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const NPM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const POOL_ADDR = '0x032F005FE617fDc1484cDde233067856FcE843f7';

const FEE = 10000;
// BBT is token0 (lower address), cbBTC is token1
// Current tick: -343193, liquidity: 0
// For 100% BBT deposit: currentTick < tickLower
// One tick spacing (200) above current = -343000
const TICK_LOWER = -343000;
const TICK_UPPER = -342400; // ~$1.02 - $1.09 band

// 60% of 1M = 600,000 BBT
const BBT_AMOUNT = ethers.parseEther('600000');

const ERC20 = ['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'];
const POOL  = ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
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

async function main() {
  console.log('Wallet:', w.address);

  // Verify pool state
  const pool = new ethers.Contract(POOL_ADDR, POOL, p);
  const s = await pool.slot0();
  const ct = Number(s[1]);
  console.log('Current tick:', ct);
  console.log('tickLower:', TICK_LOWER, '| tickUpper:', TICK_UPPER);
  console.log('currentTick < tickLower?', ct < TICK_LOWER, '(need true for 100% BBT)');

  if (ct >= TICK_LOWER) {
    console.log('ERROR: current tick is inside or above range. Cannot do 100% BBT deposit.');
    process.exit(1);
  }

  // Approve BBT for NPM
  const bbt = new ethers.Contract(BBT, ERC20, w);
  const allowance = await bbt.allowance(w.address, NPM);
  if (allowance < BBT_AMOUNT) {
    console.log('Approving BBT...');
    const tx = await bbt.approve(NPM, ethers.MaxUint256, { gasLimit: 100000 });
    await tx.wait();
    console.log('Approved.');
  } else {
    console.log('BBT already approved.');
  }

  // Mint position - 100% BBT (token0), 0 cbBTC (token1)
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  console.log('Minting 600,000 BBT sell wall...');
  const tx = await npm.mint({
    token0: BBT,
    token1: cbBTC,
    fee: FEE,
    tickLower: TICK_LOWER,
    tickUpper: TICK_UPPER,
    amount0Desired: BBT_AMOUNT,
    amount1Desired: 0,
    amount0Min: 0,
    amount1Min: 0,
    recipient: w.address,
    deadline: Math.floor(Date.now() / 1000) + 600
  }, { gasLimit: 600000 });

  const receipt = await tx.wait();
  const id = nftId(receipt);
  console.log('SUCCESS! Position NFT #' + id);
  console.log('BBT/cbBTC: 600,000 BBT | ticks', TICK_LOWER, 'to', TICK_UPPER);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
