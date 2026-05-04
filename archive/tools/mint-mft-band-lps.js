const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

// ─── Addresses ───────────────────────────────────────────────────────
const BTCBAND    = '0x2988187BDa15c71eC8b3Eb9873457174733d2524';
const ETHBAND    = '0x1248e04075b7a191931E6C8a2999d2Fae4d13BEa';
const MFT        = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM        = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3FACTORY  = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const BTC_REACTOR = '0x2879706E115150BBB9ffb5C432024264dEE0852F';
const ETH_REACTOR = '0x7018660EFBd7CfE3219388322417D405fC15b23B';

const FEE = 10000;
const MIN_TICK = -887200;
const MAX_TICK = 887200;

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
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external',
  'function ownerOf(uint256 tokenId) view returns (address)'
];
const REACTOR_ABI = [
  'function addPool(uint256 tokenId) external',
  'function poolCount() view returns (uint256)'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function computeSqrtPriceX96(amount0, amount1) {
  // price = token1/token0 = amount1/amount0 (both 18 dec)
  const price = Number(amount1) / Number(amount0);
  const sqrtPrice = Math.sqrt(price);
  const Q96 = 79228162514264337593543950336; // 2^96
  return BigInt(Math.floor(sqrtPrice * Q96));
}

async function createPoolAndMint(bandAddr, bandName, bandAmount, mftAmount, reactorAddr) {
  // Both band tokens < MfT address, so band=token0, MfT=token1
  const token0 = bandAddr;
  const token1 = MFT;
  console.log(`\n═══ ${bandName}/MfT ═══`);
  console.log(`  token0: ${bandName} (${token0})`);
  console.log(`  token1: MfT (${token1})`);
  console.log(`  ${bandName}: ${ethers.formatUnits(bandAmount, 18)}`);
  console.log(`  MfT: ${ethers.formatUnits(mftAmount, 18)}`);

  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);

  // Create pool if needed
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
    const sqrtPrice = computeSqrtPriceX96(bandAmount, mftAmount);
    console.log(`  sqrtPriceX96: ${sqrtPrice}`);
    const pool = new ethers.Contract(poolAddr, POOL_ABI, wallet);
    const initTx = await pool.initialize(sqrtPrice, { gasLimit: 500000 });
    console.log('  Init tx:', initTx.hash);
    await initTx.wait();
    console.log('  Initialized');
  } else {
    console.log('  Pool exists:', poolAddr);
    const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
    const [sqrtP, tick] = await pool.slot0();
    if (sqrtP === 0n) {
      const sqrtPrice = computeSqrtPriceX96(bandAmount, mftAmount);
      console.log(`  Initializing at sqrtPriceX96: ${sqrtPrice}`);
      const poolW = new ethers.Contract(poolAddr, POOL_ABI, wallet);
      const initTx = await poolW.initialize(sqrtPrice, { gasLimit: 500000 });
      await initTx.wait();
    } else {
      console.log('  Already initialized, tick:', tick.toString());
    }
  }
  await sleep(2000);

  // Approve both tokens to NPM
  const bandToken = new ethers.Contract(bandAddr, ERC20_ABI, wallet);
  const mftToken = new ethers.Contract(MFT, ERC20_ABI, wallet);

  console.log(`  Approving ${bandName}...`);
  await (await bandToken.approve(NPM, bandAmount)).wait();
  await sleep(1000);
  console.log('  Approving MfT...');
  await (await mftToken.approve(NPM, mftAmount)).wait();
  await sleep(1000);

  // Mint full-range LP
  console.log('  Minting full-range LP...');
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  const tx = await npm.mint({
    token0, token1, fee: FEE,
    tickLower: MIN_TICK, tickUpper: MAX_TICK,
    amount0Desired: bandAmount, amount1Desired: mftAmount,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
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
  await sleep(2000);

  // Transfer NFT to reactor
  console.log(`  Sending NFT #${tokenId} to reactor ${reactorAddr}...`);
  const sendTx = await npm.safeTransferFrom(wallet.address, reactorAddr, tokenId, { gasLimit: 300000 });
  console.log('  Tx:', sendTx.hash);
  await sendTx.wait();
  await sleep(2000);

  // addPool on reactor
  console.log(`  addPool(${tokenId}) on reactor...`);
  const reactor = new ethers.Contract(reactorAddr, REACTOR_ABI, wallet);
  const addTx = await reactor.addPool(tokenId, { gasLimit: 500000 });
  console.log('  Tx:', addTx.hash);
  await addTx.wait();

  const poolCount = await reactor.poolCount();
  console.log(`  Reactor now has ${poolCount} pools`);

  return tokenId;
}

async function main() {
  console.log('Wallet:', wallet.address);

  const mftToken = new ethers.Contract(MFT, ERC20_ABI, provider);
  const btcToken = new ethers.Contract(BTCBAND, ERC20_ABI, provider);
  const ethToken = new ethers.Contract(ETHBAND, ERC20_ABI, provider);

  const [mftBal, btcBal, ethBal, gasBal] = await Promise.all([
    mftToken.balanceOf(wallet.address),
    btcToken.balanceOf(wallet.address),
    ethToken.balanceOf(wallet.address),
    provider.getBalance(wallet.address)
  ]);

  console.log('MfT:', ethers.formatUnits(mftBal, 18));
  console.log('BTCband:', ethers.formatUnits(btcBal, 18));
  console.log('ETHband:', ethers.formatUnits(ethBal, 18));
  console.log('ETH:', ethers.formatEther(gasBal));

  const mftPerPool = mftBal / 2n;

  // BTCband/MfT → send to BTCband reactor
  const btcNft = await createPoolAndMint(BTCBAND, 'BTCband', btcBal, mftPerPool, BTC_REACTOR);

  await sleep(3000);

  // ETHband/MfT → send to ETHband reactor
  // Re-check MfT balance (first pool used some)
  const mftLeft = await mftToken.balanceOf(wallet.address);
  const ethNft = await createPoolAndMint(ETHBAND, 'ETHband', ethBal, mftLeft, ETH_REACTOR);

  // Final balances
  const [mBal, bBal, eBal, gBal] = await Promise.all([
    mftToken.balanceOf(wallet.address),
    btcToken.balanceOf(wallet.address),
    ethToken.balanceOf(wallet.address),
    provider.getBalance(wallet.address)
  ]);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║           MfT BAND LPs COMPLETE                     ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ BTCband/MfT NFT: #${btcNft} → BTCband Reactor`);
  console.log(`║ ETHband/MfT NFT: #${ethNft} → ETHband Reactor`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ MfT left:     ${ethers.formatUnits(mBal, 18)}`);
  console.log(`║ BTCband left: ${ethers.formatUnits(bBal, 18)}`);
  console.log(`║ ETHband left: ${ethers.formatUnits(eBal, 18)}`);
  console.log(`║ ETH left:     ${ethers.formatEther(gBal)}`);
  console.log('╚══════════════════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
