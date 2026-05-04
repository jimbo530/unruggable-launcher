const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

const BTCBAND  = '0x2988187BDa15c71eC8b3Eb9873457174733d2524';
const ETHBAND  = '0x1248e04075b7a191931E6C8a2999d2Fae4d13BEa';
const USDC     = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NPM      = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 10000;
const MIN_TICK = -887200;
const MAX_TICK = 887200;
const SQRT_PRICE = 792281625142643376n;

const USDC_PER_POOL = 4000000n;  // 4.0 USDC (6 dec)
const BAND_APPROVE = ethers.parseUnits('50000000000', 18); // 50B

const ERC20_ABI = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL_ABI = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = ['function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'];

async function ensurePool(token0, token1, label) {
  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);
  let poolAddr = await factory.getPool(token0, token1, FEE);
  if (poolAddr === ethers.ZeroAddress) {
    console.log(`  Creating ${label} pool...`);
    const tx = await factory.createPool(token0, token1, FEE, { gasLimit: 5000000 });
    await tx.wait();
    poolAddr = await factory.getPool(token0, token1, FEE);
    console.log(`  Pool: ${poolAddr}`);
    // Initialize
    const pool = new ethers.Contract(poolAddr, POOL_ABI, wallet);
    const initTx = await pool.initialize(SQRT_PRICE, { gasLimit: 500000 });
    await initTx.wait();
    console.log(`  Initialized`);
  } else {
    console.log(`  ${label} pool exists: ${poolAddr}`);
  }
  return poolAddr;
}

async function mintLP(token0, token1, amount0, amount1, label) {
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  console.log(`\n  Minting ${label} full-range LP...`);
  const tx = await npm.mint({
    token0, token1, fee: FEE,
    tickLower: MIN_TICK, tickUpper: MAX_TICK,
    amount0Desired: amount0, amount1Desired: amount1,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
  }, { gasLimit: 5000000 });

  console.log(`  Tx: ${tx.hash}`);
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
  return tokenId;
}

async function main() {
  console.log('Wallet:', wallet.address);

  // ─── BTCband/USDC ───
  // BTCband (0x2988) < USDC (0x8335) → BTCband=token0, USDC=token1
  console.log('\n═══ BTCband/USDC ═══');
  const btcPool = await ensurePool(BTCBAND, USDC, 'BTCband/USDC');

  // Approve
  const btcToken = new ethers.Contract(BTCBAND, ERC20_ABI, wallet);
  const usdcToken = new ethers.Contract(USDC, ERC20_ABI, wallet);

  console.log('  Approving BTCband...');
  await (await btcToken.approve(NPM, BAND_APPROVE)).wait();
  console.log('  Approving USDC...');
  await (await usdcToken.approve(NPM, USDC_PER_POOL)).wait();

  // Mint: token0=BTCband, token1=USDC
  const btcNft = await mintLP(BTCBAND, USDC, BAND_APPROVE, USDC_PER_POOL, 'BTCband/USDC');

  // ─── ETHband/USDC ───
  // ETHband (0x1248) < USDC (0x8335) → ETHband=token0, USDC=token1
  console.log('\n═══ ETHband/USDC ═══');
  const ethPool = await ensurePool(ETHBAND, USDC, 'ETHband/USDC');

  const ethToken = new ethers.Contract(ETHBAND, ERC20_ABI, wallet);

  console.log('  Approving ETHband...');
  await (await ethToken.approve(NPM, BAND_APPROVE)).wait();

  // Check remaining USDC
  const usdcLeft = await usdcToken.balanceOf(wallet.address);
  console.log('  USDC available:', ethers.formatUnits(usdcLeft, 6));
  console.log('  Approving USDC...');
  const usdcForEth = usdcLeft < USDC_PER_POOL ? usdcLeft : USDC_PER_POOL;
  await (await usdcToken.approve(NPM, usdcForEth)).wait();

  const ethNft = await mintLP(ETHBAND, USDC, BAND_APPROVE, usdcForEth, 'ETHband/USDC');

  // ─── Summary ───
  const [bBal, eBal, uBal, gasBal] = await Promise.all([
    btcToken.balanceOf(wallet.address),
    ethToken.balanceOf(wallet.address),
    usdcToken.balanceOf(wallet.address),
    provider.getBalance(wallet.address)
  ]);

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       USDC REFERENCE POOLS LIVE          ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║ BTCband/USDC NFT: #${btcNft}`);
  console.log(`║ ETHband/USDC NFT: #${ethNft}`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║ BTCband left: ${ethers.formatUnits(bBal, 18)}`);
  console.log(`║ ETHband left: ${ethers.formatUnits(eBal, 18)}`);
  console.log(`║ USDC left:    ${ethers.formatUnits(uBal, 6)}`);
  console.log(`║ ETH left:     ${ethers.formatEther(gasBal)}`);
  console.log('╚══════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
