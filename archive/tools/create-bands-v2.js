const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

// ─── Addresses ───────────────────────────────────────────────────────
const BTCBAND   = '0x11DFE729F1211904efB99F4d4a3f9FAF6C93CCB5';
const ETHBAND   = '0xd7ac547B8a5d7756F36b593287431Bad7Feb7864';
const cbBTC     = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const WETH      = '0x4200000000000000000000000000000000000006';
const MFT       = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM       = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const BTC_REACTOR = '0x038B87f2Abc1dcE269FF7DE4d3e721b5b57eD8cf';
const ETH_REACTOR = '0xeB02d1137342cD08C1c4bf61C188d86C5253b631';

const FEE = 10000;
const TICK_SPACING = 200;
const MIN_TICK = -887200;
const MAX_TICK = 887200;

// ─── ABIs ────────────────────────────────────────────────────────────
const ERC20_ABI = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL_ABI = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external'
];
const REACTOR_ABI = ['function addPool(uint256 tokenId) external', 'function poolCount() view returns (uint256)'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function computeSqrtPriceX96(priceFloat) {
  const sqrtPrice = Math.sqrt(priceFloat);
  return BigInt(Math.floor(sqrtPrice * 79228162514264337593543950336));
}

async function ensurePool(token0, token1, fee, sqrtPrice, label) {
  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);
  let poolAddr = await factory.getPool(token0, token1, fee);

  if (poolAddr === ethers.ZeroAddress) {
    console.log(`  Creating ${label} pool...`);
    const tx = await factory.createPool(token0, token1, fee, { gasLimit: 5000000 });
    console.log(`  Tx: ${tx.hash}`);
    await tx.wait();
    await sleep(5000); // wait for RPC to catch up
    poolAddr = await factory.getPool(token0, token1, fee);
    if (poolAddr === ethers.ZeroAddress) {
      // retry
      await sleep(5000);
      poolAddr = await factory.getPool(token0, token1, fee);
    }
    console.log(`  Pool: ${poolAddr}`);

    const pool = new ethers.Contract(poolAddr, POOL_ABI, wallet);
    const initTx = await pool.initialize(sqrtPrice, { gasLimit: 500000 });
    console.log(`  Init tx: ${initTx.hash}`);
    await initTx.wait();
    console.log(`  Initialized`);
  } else {
    console.log(`  ${label} pool exists: ${poolAddr}`);
    // Check if initialized
    const poolCheck = new ethers.Contract(poolAddr, POOL_ABI, provider);
    const [sqrtP] = await poolCheck.slot0();
    if (sqrtP === 0n) {
      console.log(`  Pool not initialized, initializing...`);
      const poolW = new ethers.Contract(poolAddr, POOL_ABI, wallet);
      const initTx = await poolW.initialize(sqrtPrice, { gasLimit: 500000 });
      console.log(`  Init tx: ${initTx.hash}`);
      await initTx.wait();
      console.log(`  Initialized`);
    }
  }
  await sleep(3000);

  const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
  const [, tick] = await pool.slot0();
  console.log(`  Current tick: ${Number(tick)}`);
  return { poolAddr, tick: Number(tick) };
}

async function mintBand(token0, token1, fee, tickLower, tickUpper, amt0, amt1, label) {
  console.log(`  Minting ${label} [${tickLower}, ${tickUpper}]...`);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const tx = await npm.mint({
    token0, token1, fee,
    tickLower, tickUpper,
    amount0Desired: amt0, amount1Desired: amt1,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 600
  }, { gasLimit: 5000000 });
  console.log(`  Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  const log = receipt.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );
  const tokenId = log && log.topics.length >= 4 ? BigInt(log.topics[3]).toString() : 'unknown';
  console.log(`  NFT: #${tokenId}`);
  await sleep(2000);
  return tokenId;
}

async function sendToReactor(nftId, reactorAddr, label) {
  console.log(`  ${label} #${nftId} → reactor...`);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  await (await npm.safeTransferFrom(wallet.address, reactorAddr, nftId, { gasLimit: 300000 })).wait();
  await sleep(1500);
  const rx = new ethers.Contract(reactorAddr, REACTOR_ABI, wallet);
  await (await rx.addPool(nftId, { gasLimit: 500000 })).wait();
  const count = await rx.poolCount();
  console.log(`  Registered. Reactor pools: ${count}`);
  await sleep(1500);
}

async function main() {
  console.log('Wallet:', wallet.address);
  console.log('ETH:', ethers.formatEther(await provider.getBalance(wallet.address)));

  // Allocation per token (1M supply, 4 already in USDC pool):
  // 90% = 900K → cbBTC/WETH bands (450K x 2)
  // 1%  = 10K  → MfT band
  // ~9% = ~90K → reserved for future reactor LPs
  const BAND_EACH = ethers.parseUnits('450000', 18);
  const MFT_BAND  = ethers.parseUnits('10000', 18);

  // ═══════════════════════════════════════════════════════════════════
  // 1. BTCband/cbBTC — BTCband(0x11DF)=token0, cbBTC(0xcbB7)=token1
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ BTCband/cbBTC Bands ═══');
  // 1 BTCband=$1, BTC=$97K → 1 BTCband = (1/97000) cbBTC
  // cbBTC=8dec, BTCband=18dec → price_raw = (1/97000 * 1e8) / 1e18
  const btcPriceRaw = (1/97000) * 1e8 / 1e18;
  const { tick: btcTick } = await ensurePool(BTCBAND, cbBTC, FEE,
    computeSqrtPriceX96(btcPriceRaw), 'BTCband/cbBTC');

  // One-sided BTCband (token0) goes ABOVE current tick
  const btcStart = Math.ceil(btcTick / TICK_SPACING) * TICK_SPACING + TICK_SPACING;
  const btcMid = btcStart + 200 * 50; // 50 ticks up
  const btcEnd = MAX_TICK;

  const btcToken = new ethers.Contract(BTCBAND, ERC20_ABI, wallet);
  console.log('  Approving BTCband...');
  await (await btcToken.approve(NPM, BAND_EACH * 2n + MFT_BAND)).wait();
  await sleep(1000);

  const btcNft1 = await mintBand(BTCBAND, cbBTC, FEE,
    btcStart, btcMid, BAND_EACH, 0n, 'BTCband Band 1');
  const btcNft2 = await mintBand(BTCBAND, cbBTC, FEE,
    btcMid - TICK_SPACING, btcEnd, BAND_EACH, 0n, 'BTCband Band 2');

  // ═══════════════════════════════════════════════════════════════════
  // 2. WETH/ETHband — WETH(0x4200)=token0, ETHband(0xd7ac)=token1
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ WETH/ETHband Bands ═══');
  // 1 ETHband=$1, ETH=$1850 → 1 WETH = 1850 ETHband
  // Both 18dec → price_raw = 1850
  const { tick: ethTick } = await ensurePool(WETH, ETHBAND, FEE,
    computeSqrtPriceX96(1850), 'WETH/ETHband');

  // One-sided ETHband (token1) goes BELOW current tick
  const ethEnd = Math.floor(ethTick / TICK_SPACING) * TICK_SPACING;
  const ethMid = ethEnd - 200 * 50;
  const ethStart = MIN_TICK;

  const ethToken = new ethers.Contract(ETHBAND, ERC20_ABI, wallet);
  console.log('  Approving ETHband...');
  await (await ethToken.approve(NPM, BAND_EACH * 2n + MFT_BAND)).wait();
  await sleep(1000);

  const ethNft1 = await mintBand(WETH, ETHBAND, FEE,
    ethMid, ethEnd, 0n, BAND_EACH, 'ETHband Band 1');
  const ethNft2 = await mintBand(WETH, ETHBAND, FEE,
    ethStart, ethMid + TICK_SPACING, 0n, BAND_EACH, 'ETHband Band 2');

  // ═══════════════════════════════════════════════════════════════════
  // 3. MfT bands — 1% each
  // BTCband(0x11DF) < MfT(0x8FB8) → BTCband=token0, MfT=token1
  // ETHband(0xd7ac) > MfT(0x8FB8) → MfT=token0, ETHband=token1
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ MfT Bands ═══');

  // BTCband/MfT — need to figure MfT price of BTCband
  // MfT price unknown but we just need a pool — init at some ratio
  // Both 18 dec. If MfT = $0.001 and BTCband = $1, then 1 BTCband = 1000 MfT
  // price_raw = MfT/BTCband = 1000
  const { tick: btcMftTick } = await ensurePool(BTCBAND, MFT, FEE,
    computeSqrtPriceX96(1000), 'BTCband/MfT');

  // One-sided BTCband (token0) ABOVE current tick
  const btcMftStart = Math.ceil(btcMftTick / TICK_SPACING) * TICK_SPACING + TICK_SPACING;
  const btcMftNft = await mintBand(BTCBAND, MFT, FEE,
    btcMftStart, MAX_TICK, MFT_BAND, 0n, 'BTCband over MfT');

  // MfT/ETHband — MfT(0x8fb8)=token0, ETHband(0xd7ac)=token1
  // If MfT=$0.001 and ETHband=$1, price = ETHband/MfT = 1000 (raw, both 18dec)? No.
  // price = token1/token0 = ETHband_per_MfT = 0.001 (1 MfT buys 0.001 ETHband)
  // Actually: 1 MfT = $0.001, 1 ETHband = $1, so 1 MfT = 0.001 ETHband
  // price_raw = 0.001
  const { tick: ethMftTick } = await ensurePool(MFT, ETHBAND, FEE,
    computeSqrtPriceX96(0.001), 'MfT/ETHband');

  // One-sided ETHband (token1) BELOW current tick
  const ethMftEnd = Math.floor(ethMftTick / TICK_SPACING) * TICK_SPACING;
  const ethMftNft = await mintBand(MFT, ETHBAND, FEE,
    MIN_TICK, ethMftEnd, 0n, MFT_BAND, 'ETHband over MfT');

  // ═══════════════════════════════════════════════════════════════════
  // 4. Send all NFTs to reactors
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Sending to Reactors ═══');
  await sendToReactor(btcNft1, BTC_REACTOR, 'BTCband Band 1');
  await sendToReactor(btcNft2, BTC_REACTOR, 'BTCband Band 2');
  await sendToReactor(btcMftNft, BTC_REACTOR, 'BTCband/MfT');
  await sendToReactor(ethNft1, ETH_REACTOR, 'ETHband Band 1');
  await sendToReactor(ethNft2, ETH_REACTOR, 'ETHband Band 2');
  await sendToReactor(ethMftNft, ETH_REACTOR, 'ETHband/MfT');

  // ═══════════════════════════════════════════════════════════════════
  const [bBal, eBal, endGas] = await Promise.all([
    btcToken.balanceOf(wallet.address),
    ethToken.balanceOf(wallet.address),
    provider.getBalance(wallet.address)
  ]);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           BAND v2 — ALL POSITIONS LIVE                  ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ BTCband Reactor: ${BTC_REACTOR}`);
  console.log(`║   Band 1: #${btcNft1} (cbBTC low)`);
  console.log(`║   Band 2: #${btcNft2} (cbBTC high)`);
  console.log(`║   MfT:    #${btcMftNft} (BTCband over MfT)`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ ETHband Reactor: ${ETH_REACTOR}`);
  console.log(`║   Band 1: #${ethNft1} (WETH near)`);
  console.log(`║   Band 2: #${ethNft2} (WETH deep)`);
  console.log(`║   MfT:    #${ethMftNft} (ETHband over MfT)`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ BTCband reserved: ${ethers.formatUnits(bBal, 18)}`);
  console.log(`║ ETHband reserved: ${ethers.formatUnits(eBal, 18)}`);
  console.log(`║ ETH remaining:    ${ethers.formatEther(endGas)}`);
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
