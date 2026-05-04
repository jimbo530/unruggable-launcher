const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const RPC = 'https://mainnet.base.org';
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY;
if (!AGENT_KEY) { console.error('ERROR: AGENT_PRIVATE_KEY not found'); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(AGENT_KEY, provider);

// ─── Addresses ───────────────────────────────────────────────────────
const BTCBAND  = '0x2988187BDa15c71eC8b3Eb9873457174733d2524';
const ETHBAND  = '0x1248e04075b7a191931E6C8a2999d2Fae4d13BEa';
const cbBTC    = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const WETH     = '0x4200000000000000000000000000000000000006';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const NPM      = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

const FEE = 10000;           // 1% fee tier
const TICK_SPACING = 200;    // for fee 10000
const MAX_TICK = 887200;     // 887272 rounded to 200
const MIN_TICK = -887200;

// One-sided bands: token0 above current tick
// Initialize at MIN_SQRT_RATIO+1 so current tick ~ MIN_TICK
// Band 1: MIN_TICK+200 to midpoint (0)
// Band 2: midpoint-200 to MAX_TICK (overlap at -200 to 0)
const BAND1_LOWER = MIN_TICK + TICK_SPACING;  // -887000
const BAND1_UPPER = 0;
const BAND2_LOWER = -TICK_SPACING;            // -200
const BAND2_UPPER = MAX_TICK;                 // 887200

const MIN_SQRT_RATIO = 4295128739n;
const INIT_SQRT_PRICE = MIN_SQRT_RATIO + 1n;

const BAND_AMOUNT = ethers.parseUnits('450000000000', 18); // 450B per band

// ─── ABIs ────────────────────────────────────────────────────────────
const FACTORY_ABI = [
  'function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool)',
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

const POOL_ABI = [
  'function initialize(uint160 sqrtPriceX96) external',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)'
];

const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) calldata params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function positions(uint256 tokenId) external view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)'
];

// ─── Helpers ─────────────────────────────────────────────────────────
function sortTokens(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

async function createAndInitPool(factoryContract, token0, token1, fee, sqrtPrice, label) {
  console.log(`\n--- Creating ${label} pool ---`);

  // Check if pool exists
  let poolAddr = await factoryContract.getPool(token0, token1, fee);
  if (poolAddr !== ethers.ZeroAddress) {
    console.log(`  Pool already exists: ${poolAddr}`);
    const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
    const [sqrtPriceX96, tick] = await pool.slot0();
    console.log(`  Current tick: ${tick}, sqrtPriceX96: ${sqrtPriceX96}`);
    return poolAddr;
  }

  // Create pool
  const tx = await factoryContract.createPool(token0, token1, fee, { gasLimit: 5000000 });
  console.log(`  Create tx: ${tx.hash}`);
  const receipt = await tx.wait();

  // Get pool address from factory
  poolAddr = await factoryContract.getPool(token0, token1, fee);
  console.log(`  Pool created: ${poolAddr}`);

  // Initialize
  const pool = new ethers.Contract(poolAddr, POOL_ABI, wallet);
  const initTx = await pool.initialize(sqrtPrice, { gasLimit: 1000000 });
  console.log(`  Init tx: ${initTx.hash}`);
  await initTx.wait();

  const [sqrtPriceX96, tick] = await pool.slot0();
  console.log(`  Initialized at tick: ${tick}, sqrtPriceX96: ${sqrtPriceX96}`);

  return poolAddr;
}

async function mintBand(npmContract, token0, token1, fee, tickLower, tickUpper, amount0, amount1, label) {
  console.log(`\n--- Minting ${label} ---`);
  console.log(`  Range: [${tickLower}, ${tickUpper}]`);
  console.log(`  amount0: ${ethers.formatUnits(amount0, 18)}`);
  console.log(`  amount1: ${ethers.formatUnits(amount1, 18)}`);

  const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min

  const tx = await npmContract.mint({
    token0, token1, fee,
    tickLower, tickUpper,
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min: 0,
    amount1Min: 0,
    recipient: wallet.address,
    deadline
  }, { gasLimit: 5000000 });

  console.log(`  Mint tx: ${tx.hash}`);
  const receipt = await tx.wait();

  // Extract tokenId from Transfer event (ERC721)
  const transferLog = receipt.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );

  let tokenId = 'unknown';
  if (transferLog && transferLog.topics.length >= 4) {
    tokenId = BigInt(transferLog.topics[3]).toString();
  }

  console.log(`  Position NFT #${tokenId}`);
  return tokenId;
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('Wallet:', wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log('ETH:', ethers.formatEther(bal));

  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);

  // Verify token ordering
  const [btcT0, btcT1] = sortTokens(BTCBAND, cbBTC);
  const [ethT0, ethT1] = sortTokens(ETHBAND, WETH);
  const [crossT0, crossT1] = sortTokens(BTCBAND, ETHBAND);

  console.log(`\nBTCband/cbBTC: token0=${btcT0 === BTCBAND ? 'BTCband' : 'cbBTC'}`);
  console.log(`ETHband/WETH:  token0=${ethT0 === ETHBAND ? 'ETHband' : 'WETH'}`);
  console.log(`Cross-pool:    token0=${crossT0 === ETHBAND ? 'ETHband' : 'BTCband'}`);

  // ═══ BTCband/cbBTC ═══════════════════════════════════════════════
  // BTCband is token0 → bands above current tick → one-sided token0
  await createAndInitPool(factory, btcT0, btcT1, FEE, INIT_SQRT_PRICE, 'BTCband/cbBTC');

  // Approve 90% to NPM
  const btcToken = new ethers.Contract(BTCBAND, ERC20_ABI, wallet);
  const totalApproval = BAND_AMOUNT * 2n;
  console.log(`\nApproving ${ethers.formatUnits(totalApproval, 18)} BTCband to NPM...`);
  const appTx1 = await btcToken.approve(NPM, totalApproval);
  await appTx1.wait();
  console.log('Approved.');

  // Band 1: low range (cheap tokens → BTC accumulation starts immediately)
  const btcBand1Id = await mintBand(npm, btcT0, btcT1, FEE,
    BAND1_LOWER, BAND1_UPPER, BAND_AMOUNT, 0n,
    'BTCband Band 1 (low range)');

  // Band 2: high range (expensive tokens → BTC accumulation at higher prices)
  const btcBand2Id = await mintBand(npm, btcT0, btcT1, FEE,
    BAND2_LOWER, BAND2_UPPER, BAND_AMOUNT, 0n,
    'BTCband Band 2 (high range)');

  // ═══ ETHband/WETH ═══════════════════════════════════════════════
  await createAndInitPool(factory, ethT0, ethT1, FEE, INIT_SQRT_PRICE, 'ETHband/WETH');

  const ethToken = new ethers.Contract(ETHBAND, ERC20_ABI, wallet);
  console.log(`\nApproving ${ethers.formatUnits(totalApproval, 18)} ETHband to NPM...`);
  const appTx2 = await ethToken.approve(NPM, totalApproval);
  await appTx2.wait();
  console.log('Approved.');

  const ethBand1Id = await mintBand(npm, ethT0, ethT1, FEE,
    BAND1_LOWER, BAND1_UPPER, BAND_AMOUNT, 0n,
    'ETHband Band 1 (low range)');

  const ethBand2Id = await mintBand(npm, ethT0, ethT1, FEE,
    BAND2_LOWER, BAND2_UPPER, BAND_AMOUNT, 0n,
    'ETHband Band 2 (high range)');

  // ═══ Cross-pool BTCband/ETHband ═══════════════════════════════════
  // ETHband (0x1248) is token0, BTCband (0x2988) is token1
  // Initialize at tick 0 (1:1 ratio) — just needs to exist for arb
  const CROSS_SQRT = 79228162514264337593543950336n; // sqrt(1) * 2^96 = 2^96
  await createAndInitPool(factory, crossT0, crossT1, FEE, CROSS_SQRT, 'BTCband/ETHband cross');

  // ═══ Results ═══════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║         BAND DEPLOYMENT COMPLETE         ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║ BTCband Band 1 NFT: #${btcBand1Id}`);
  console.log(`║ BTCband Band 2 NFT: #${btcBand2Id}`);
  console.log(`║ ETHband Band 1 NFT: #${ethBand1Id}`);
  console.log(`║ ETHband Band 2 NFT: #${ethBand2Id}`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║ BTCband/cbBTC pool: fee ${FEE}`);
  console.log(`║ ETHband/WETH pool:  fee ${FEE}`);
  console.log(`║ Cross-pool:         fee ${FEE}`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║ Band 1 range: [${BAND1_LOWER}, ${BAND1_UPPER}]`);
  console.log(`║ Band 2 range: [${BAND2_LOWER}, ${BAND2_UPPER}]`);
  console.log(`║ Overlap zone: [${BAND2_LOWER}, ${BAND1_UPPER}]`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║ 10% of each token saved in agent wallet  ║');
  console.log('╚══════════════════════════════════════════╝');

  // Check remaining balances
  const btcBal = await btcToken.balanceOf(wallet.address);
  const ethBal = await ethToken.balanceOf(wallet.address);
  console.log(`\nRemaining BTCband: ${ethers.formatUnits(btcBal, 18)}`);
  console.log(`Remaining ETHband: ${ethers.formatUnits(ethBal, 18)}`);

  // Gas used
  const newBal = await provider.getBalance(wallet.address);
  console.log(`ETH remaining: ${ethers.formatEther(newBal)}`);
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
