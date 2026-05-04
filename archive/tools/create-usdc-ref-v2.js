const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

// ─── Addresses ───────────────────────────────────────────────────────
const BTCBAND   = '0x11DFE729F1211904efB99F4d4a3f9FAF6C93CCB5';
const ETHBAND   = '0xd7ac547B8a5d7756F36b593287431Bad7Feb7864';
const USDC      = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NPM       = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 10000;
const MIN_TICK = -887200;
const MAX_TICK = 887200;

// 4 USDC per pool, 4 band tokens per pool (1:1 at $1)
const USDC_AMOUNT = 4000000n; // 4 USDC (6 dec)
const BAND_AMOUNT = ethers.parseUnits('4', 18); // 4 tokens

// ─── Token ordering ──────────────────────────────────────────────────
// BTCband (0x11DF) < USDC (0x8335) → BTCband=token0, USDC=token1
// ETHband (0xd7ac) > USDC (0x8335) → USDC=token0, ETHband=token1

// BTCband/USDC: price = USDC_raw / BTCband_raw = 1e6 / 1e18 = 1e-12
// sqrtPriceX96 = sqrt(1e-12) * 2^96 = 1e-6 * 2^96
const BTC_SQRT_PRICE = 79228162514264337593544n; // 1e-6 * 2^96

// USDC/ETHband: price = ETHband_raw / USDC_raw = 1e18 / 1e6 = 1e12
// sqrtPriceX96 = sqrt(1e12) * 2^96 = 1e6 * 2^96
const ETH_SQRT_PRICE = 79228162514264337593543950336000000n; // 1e6 * 2^96

// ─── ABIs ────────────────────────────────────────────────────────────
const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)'
];
const FACTORY_ABI = [
  'function getPool(address,address,uint24) view returns (address)',
  'function createPool(address,address,uint24) returns (address)'
];
const POOL_ABI = [
  'function initialize(uint160) external',
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'
];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function createRefPool(token0, token1, sqrtPrice, amt0, amt1, label) {
  console.log(`\n═══ ${label} ═══`);
  console.log(`  token0: ${token0}`);
  console.log(`  token1: ${token1}`);

  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);

  // Create pool
  let poolAddr = await factory.getPool(token0, token1, FEE);
  if (poolAddr === ethers.ZeroAddress) {
    console.log('  Creating pool...');
    const tx = await factory.createPool(token0, token1, FEE, { gasLimit: 5000000 });
    console.log('  Tx:', tx.hash);
    await tx.wait();
    poolAddr = await factory.getPool(token0, token1, FEE);
    console.log('  Pool:', poolAddr);
    await sleep(2000);

    // Initialize
    console.log(`  Initializing at sqrtPriceX96: ${sqrtPrice}`);
    const pool = new ethers.Contract(poolAddr, POOL_ABI, wallet);
    const initTx = await pool.initialize(sqrtPrice, { gasLimit: 500000 });
    console.log('  Init tx:', initTx.hash);
    await initTx.wait();
  } else {
    console.log('  Pool exists:', poolAddr);
    const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
    const [sqrtP] = await pool.slot0();
    if (sqrtP === 0n) {
      const poolW = new ethers.Contract(poolAddr, POOL_ABI, wallet);
      await (await poolW.initialize(sqrtPrice, { gasLimit: 500000 })).wait();
    }
  }
  await sleep(2000);

  // Approve
  const t0 = new ethers.Contract(token0, ERC20_ABI, wallet);
  const t1 = new ethers.Contract(token1, ERC20_ABI, wallet);
  console.log('  Approving token0...');
  await (await t0.approve(NPM, amt0)).wait();
  await sleep(1000);
  console.log('  Approving token1...');
  await (await t1.approve(NPM, amt1)).wait();
  await sleep(1000);

  // Mint full-range LP
  console.log('  Minting full-range LP...');
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  const tx = await npm.mint({
    token0, token1, fee: FEE,
    tickLower: MIN_TICK, tickUpper: MAX_TICK,
    amount0Desired: amt0, amount1Desired: amt1,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
  }, { gasLimit: 5000000 });

  console.log('  Mint tx:', tx.hash);
  const receipt = await tx.wait();

  const transferLog = receipt.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );
  let tokenId = 'unknown';
  if (transferLog && transferLog.topics.length >= 4) {
    tokenId = BigInt(transferLog.topics[3]).toString();
  }
  console.log(`  Position NFT: #${tokenId}`);
  return { poolAddr, tokenId };
}

async function main() {
  console.log('Wallet:', wallet.address);

  // BTCband/USDC: BTCband(0x11DF)=token0, USDC(0x8335)=token1
  const btcResult = await createRefPool(
    BTCBAND, USDC, BTC_SQRT_PRICE,
    BAND_AMOUNT, USDC_AMOUNT,
    'BTCband/USDC ($1 reference)'
  );

  await sleep(3000);

  // ETHband/USDC: USDC(0x8335)=token0, ETHband(0xd7ac)=token1
  const ethResult = await createRefPool(
    USDC, ETHBAND, ETH_SQRT_PRICE,
    USDC_AMOUNT, BAND_AMOUNT,
    'ETHband/USDC ($1 reference)'
  );

  // Final balances
  await sleep(2000);
  const usdcToken = new ethers.Contract(USDC, ERC20_ABI, provider);
  const btcToken = new ethers.Contract(BTCBAND, ERC20_ABI, provider);
  const ethToken = new ethers.Contract(ETHBAND, ERC20_ABI, provider);
  const [uBal, bBal, eBal, gasBal] = await Promise.all([
    usdcToken.balanceOf(wallet.address),
    btcToken.balanceOf(wallet.address),
    ethToken.balanceOf(wallet.address),
    provider.getBalance(wallet.address)
  ]);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║       USDC REFERENCE POOLS v2 LIVE                  ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ BTCband/USDC pool: ${btcResult.poolAddr}`);
  console.log(`║ BTCband/USDC NFT:  #${btcResult.tokenId}`);
  console.log(`║ ETHband/USDC pool: ${ethResult.poolAddr}`);
  console.log(`║ ETHband/USDC NFT:  #${ethResult.tokenId}`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ Price: $1.00 per token (1:1 with USDC)`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ BTCband left: ${ethers.formatUnits(bBal, 18)}`);
  console.log(`║ ETHband left: ${ethers.formatUnits(eBal, 18)}`);
  console.log(`║ USDC left:    ${ethers.formatUnits(uBal, 6)}`);
  console.log(`║ ETH left:     ${ethers.formatEther(gasBal)}`);
  console.log('╚══════════════════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
