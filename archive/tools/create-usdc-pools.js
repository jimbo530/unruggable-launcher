const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

// ─── Addresses ───────────────────────────────────────────────────────
const BTCBAND  = '0x2988187BDa15c71eC8b3Eb9873457174733d2524';
const ETHBAND  = '0x1248e04075b7a191931E6C8a2999d2Fae4d13BEa';
const USDC     = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const NPM      = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

const FEE = 10000;  // 1%
const TICK_SPACING = 200;
const MIN_TICK = -887200;
const MAX_TICK = 887200;

// ─── Pricing ─────────────────────────────────────────────────────────
// Set BTCband/ETHband at ~$1e-10 each (FDV ~$100 for 1T supply)
// This is "low end" — bands are cheap, arb bots buy through them easily
//
// BTCband(18dec) is token0, USDC(6dec) is token1 (0x2988 < 0x8335)
// ETHband(18dec) is token0, USDC(6dec) is token1 (0x1248 < 0x8335)
//
// price_raw = USDC_raw_per_BTCband_raw = (1e-10 * 1e6) / 1e18 = 1e-22
// sqrtPriceX96 = sqrt(1e-22) * 2^96
//             = 1e-11 * 79228162514264337593543950336
//             = ~792281625142643376

const SQRT_PRICE = 792281625142643376n;

// 4 USDC each pool (6 decimals)
const USDC_AMOUNT = 4000000n;  // 4.0 USDC

// Approve plenty of band tokens — V3 only uses what's needed
const BAND_APPROVE = ethers.parseUnits('50000000000', 18);  // 50B

// ─── ABIs ────────────────────────────────────────────────────────────
const FACTORY_ABI = [
  'function createPool(address,address,uint24) returns (address)',
  'function getPool(address,address,uint24) view returns (address)'
];
const POOL_ABI = [
  'function initialize(uint160) external',
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'
];
const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
];

function sortTokens(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

async function createPoolWithLP(bandAddr, bandName) {
  const [token0, token1] = sortTokens(bandAddr, USDC);
  const bandIsToken0 = token0.toLowerCase() === bandAddr.toLowerCase();

  console.log(`\n═══ ${bandName}/USDC ═══`);
  console.log(`  token0: ${bandIsToken0 ? bandName : 'USDC'} (${token0})`);
  console.log(`  token1: ${bandIsToken0 ? 'USDC' : bandName} (${token1})`);

  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);

  // Create pool if needed
  let poolAddr = await factory.getPool(token0, token1, FEE);
  if (poolAddr === ethers.ZeroAddress) {
    console.log('  Creating pool...');
    const tx = await factory.createPool(token0, token1, FEE, { gasLimit: 5000000 });
    console.log('  Tx:', tx.hash);
    await tx.wait();
    poolAddr = await factory.getPool(token0, token1, FEE);
  }
  console.log('  Pool:', poolAddr);

  // Initialize (skip if already done)
  const pool = new ethers.Contract(poolAddr, POOL_ABI, wallet);
  const [existingSqrt] = await pool.slot0();
  if (existingSqrt === 0n) {
    const initTx = await pool.initialize(SQRT_PRICE, { gasLimit: 1000000 });
    console.log('  Init tx:', initTx.hash);
    await initTx.wait();
  } else {
    console.log('  Already initialized');
  }

  const [sqrtP, tick] = await pool.slot0();
  console.log('  Current tick:', tick.toString());

  // Approve band token + USDC to NPM
  const bandToken = new ethers.Contract(bandAddr, ERC20_ABI, wallet);
  const usdcToken = new ethers.Contract(USDC, ERC20_ABI, wallet);

  console.log('  Approving tokens...');
  const app1 = await bandToken.approve(NPM, BAND_APPROVE);
  await app1.wait();
  const app2 = await usdcToken.approve(NPM, USDC_AMOUNT);
  await app2.wait();

  // Mint full-range position
  // band is token0, USDC is token1
  const amount0 = bandIsToken0 ? BAND_APPROVE : USDC_AMOUNT;
  const amount1 = bandIsToken0 ? USDC_AMOUNT : BAND_APPROVE;

  console.log(`  Minting full-range LP...`);
  console.log(`  amount0Desired: ${amount0.toString()}`);
  console.log(`  amount1Desired: ${amount1.toString()}`);

  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  const tx = await npm.mint({
    token0, token1, fee: FEE,
    tickLower: MIN_TICK,
    tickUpper: MAX_TICK,
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min: 0,
    amount1Min: 0,
    recipient: wallet.address,
    deadline
  }, { gasLimit: 5000000 });

  console.log('  Mint tx:', tx.hash);
  const receipt = await tx.wait();

  // Extract tokenId
  const transferLog = receipt.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );
  let tokenId = 'unknown';
  if (transferLog && transferLog.topics.length >= 4) {
    tokenId = BigInt(transferLog.topics[3]).toString();
  }
  console.log(`  Position NFT: #${tokenId}`);

  // Check remaining balances
  const bandBal = await bandToken.balanceOf(wallet.address);
  const usdcBal = await usdcToken.balanceOf(wallet.address);
  console.log(`  ${bandName} remaining: ${ethers.formatUnits(bandBal, 18)}`);
  console.log(`  USDC remaining: ${ethers.formatUnits(usdcBal, 6)}`);

  return { poolAddr, tokenId };
}

async function main() {
  console.log('Wallet:', wallet.address);

  // Check balances
  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
  const btcband = new ethers.Contract(BTCBAND, ERC20_ABI, provider);
  const ethband = new ethers.Contract(ETHBAND, ERC20_ABI, provider);

  const [uBal, bBal, eBal, ethBal] = await Promise.all([
    usdc.balanceOf(wallet.address),
    btcband.balanceOf(wallet.address),
    ethband.balanceOf(wallet.address),
    provider.getBalance(wallet.address)
  ]);

  console.log('USDC:', ethers.formatUnits(uBal, 6));
  console.log('BTCband:', ethers.formatUnits(bBal, 18));
  console.log('ETHband:', ethers.formatUnits(eBal, 18));
  console.log('ETH:', ethers.formatEther(ethBal));

  // Create BTCband/USDC pool + LP
  const btcResult = await createPoolWithLP(BTCBAND, 'BTCband');

  // Create ETHband/USDC pool + LP
  const ethResult = await createPoolWithLP(ETHBAND, 'ETHband');

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       USDC REFERENCE POOLS COMPLETE      ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║ BTCband/USDC pool: ${btcResult.poolAddr}`);
  console.log(`║ BTCband/USDC NFT:  #${btcResult.tokenId}`);
  console.log(`║ ETHband/USDC pool: ${ethResult.poolAddr}`);
  console.log(`║ ETHband/USDC NFT:  #${ethResult.tokenId}`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║ Price: ~$0.0000000001 per token           ║');
  console.log('║ FDV: ~$100 (infrastructure pricing)       ║');
  console.log('║ Arb: BTC/ETH move vs USDC = instant gap   ║');
  console.log('╚══════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
