const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

// ─── Existing addresses ──────────────────────────────────────────────
const MFT       = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const cbBTC     = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const WETH      = '0x4200000000000000000000000000000000000006';
const USDC      = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NPM       = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const ROUTER    = '0x2626664c2603336E57B271c5C0b26F421741e481';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const MYCOPAD_RX = '0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045';

const SUPPLY = ethers.parseUnits('1000000', 18);
const FEE = 10000;
const TS = 200; // tick spacing for fee 10000
const MIN_TICK = -887200;
const MAX_TICK = 887200;

// Allocation
const BAND_EACH = ethers.parseUnits('450000', 18);
const MFT_BAND  = ethers.parseUnits('10000', 18);
const USDC_SEED = 1000000n; // 1 USDC (6 dec)
const BAND_SEED = ethers.parseUnits('1', 18);

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
  'function safeTransferFrom(address from, address to, uint256 tokenId) external'
];
const REACTOR_INIT_ABI = [
  'function initialize(address _token, address _mft, address _pm, address _router, address _factory, address _reactorPrime) external',
  'function admin() view returns (address)'
];
const REACTOR_ABI = [
  'function addPool(uint256 tokenId) external',
  'function poolCount() view returns (uint256)'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function sqrtP(price) { return BigInt(Math.floor(Math.sqrt(price) * 79228162514264337593543950336)); }

async function ensurePool(token0, token1, fee, sqrtPrice, label) {
  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);
  let addr = await factory.getPool(token0, token1, fee);
  if (addr === ethers.ZeroAddress) {
    console.log(`  Creating ${label} pool...`);
    await (await factory.createPool(token0, token1, fee, { gasLimit: 5000000 })).wait();
    await sleep(5000);
    addr = await factory.getPool(token0, token1, fee);
    if (addr === ethers.ZeroAddress) { await sleep(5000); addr = await factory.getPool(token0, token1, fee); }
    console.log(`  Pool: ${addr}`);
    const p = new ethers.Contract(addr, POOL_ABI, wallet);
    await (await p.initialize(sqrtPrice, { gasLimit: 500000 })).wait();
    console.log(`  Initialized`);
  } else {
    console.log(`  ${label} exists: ${addr}`);
    const p = new ethers.Contract(addr, POOL_ABI, provider);
    const [s] = await p.slot0();
    if (s === 0n) {
      await (await new ethers.Contract(addr, POOL_ABI, wallet).initialize(sqrtPrice, { gasLimit: 500000 })).wait();
      console.log(`  Initialized`);
    }
  }
  await sleep(3000);
  const p = new ethers.Contract(addr, POOL_ABI, provider);
  const [, tick] = await p.slot0();
  console.log(`  Tick: ${Number(tick)}`);
  return { addr, tick: Number(tick) };
}

async function mintPos(t0, t1, fee, tl, tu, a0, a1, label) {
  console.log(`  Minting ${label} [${tl}, ${tu}]...`);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const tx = await npm.mint({
    token0: t0, token1: t1, fee,
    tickLower: tl, tickUpper: tu,
    amount0Desired: a0, amount1Desired: a1,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 600
  }, { gasLimit: 5000000 });
  console.log(`  Tx: ${tx.hash}`);
  const r = await tx.wait();
  const log = r.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );
  const id = log && log.topics.length >= 4 ? BigInt(log.topics[3]).toString() : 'unknown';
  console.log(`  NFT: #${id}`);
  await sleep(2000);
  return id;
}

async function toReactor(id, rx, label) {
  console.log(`  ${label} #${id} → reactor...`);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  await (await npm.safeTransferFrom(wallet.address, rx, id, { gasLimit: 300000 })).wait();
  await sleep(1500);
  const r = new ethers.Contract(rx, REACTOR_ABI, wallet);
  await (await r.addPool(id, { gasLimit: 500000 })).wait();
  console.log(`  Pools: ${await r.poolCount()}`);
  await sleep(1500);
}

async function getMftPricePerDollar() {
  // MfT/WETH pool: WETH=token0, MfT=token1, both 18 dec
  const mftWeth = new ethers.Contract('0x02d75D63a3dBeAe0FE6A73e4b2Fcc1c7469B78EC', POOL_ABI, provider);
  const [mftSqrt] = await mftWeth.slot0();
  const mftPerWeth = Number(mftSqrt) ** 2 / (2 ** 192);

  // WETH/USDC for ETH price (USDC=token0, WETH=token1 on Base 500 fee pool)
  // Use a known WETH/USDC pool to get ETH price
  const wethUsdc = await new ethers.Contract(V3FACTORY, FACTORY_ABI, provider).getPool(WETH, USDC, 500);
  const wuPool = new ethers.Contract(wethUsdc, POOL_ABI, provider);
  const [wuSqrt] = await wuPool.slot0();
  // USDC(0x8335) < WETH(0x4200)? 0x4200 > 0x8335 → USDC=token0, WETH=token1
  // Wait: USDC=0x833589... WETH=0x420000...
  // 0x4200 < 0x8335 → WETH=token0, USDC=token1
  const wethPerUsdc = Number(wuSqrt) ** 2 / (2 ** 192);
  // price = USDC_raw / WETH_raw, USDC=6dec, WETH=18dec
  // real ETH price = wethPerUsdc * 1e18 / 1e6 = wethPerUsdc * 1e12
  // Wait: WETH=token0, USDC=token1 → price = USDC_per_WETH_raw
  // real ETH price in USD = price * 10^(6) / 10^(18)... no.
  // sqrtPriceX96 → price = token1/token0 in raw = USDC_raw / WETH_raw
  // To get USD per ETH: price * 10^(18-6) = price * 10^12
  const ethPriceUsd = wethPerUsdc * 1e12;

  const mftPerDollar = mftPerWeth / ethPriceUsd;
  return { mftPerDollar, ethPriceUsd, mftPerWeth };
}

async function main() {
  console.log('Wallet:', wallet.address);
  console.log('ETH:', ethers.formatEther(await provider.getBalance(wallet.address)));

  // ─── Get MfT price ─────────────────────────────────────────────────
  const { mftPerDollar, ethPriceUsd } = await getMftPricePerDollar();
  console.log(`\nMfT per $1: ${mftPerDollar.toExponential(4)}`);
  console.log(`ETH price: $${ethPriceUsd.toFixed(2)}`);

  const tokenArtifact = require('../artifacts/contracts/LaunchToken.sol/LaunchToken.json');
  const reactorArtifact = require('../artifacts/contracts/SporeReactorV2.sol/SporeReactorV2.json');

  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: Deploy tokens
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 1: Deploy BTCband v3 ═══');
  const btcFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, wallet);
  const btcDeploy = await btcFactory.deploy('BTCband', 'BTCBAND', SUPPLY, wallet.address);
  await btcDeploy.waitForDeployment();
  const BB = await btcDeploy.getAddress();
  console.log('  BTCband:', BB);
  await sleep(3000);

  console.log('\n═══ STEP 2: Deploy ETHband v3 ═══');
  const ethFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, wallet);
  const ethDeploy = await ethFactory.deploy('ETHband', 'ETHBAND', SUPPLY, wallet.address);
  await ethDeploy.waitForDeployment();
  const EB = await ethDeploy.getAddress();
  console.log('  ETHband:', EB);
  await sleep(3000);

  // Token ordering
  const bbIsToken0vsCbbtc = BB.toLowerCase() < cbBTC.toLowerCase();
  const ebIsToken0vsWeth = EB.toLowerCase() < WETH.toLowerCase();
  const bbIsToken0vsMft = BB.toLowerCase() < MFT.toLowerCase();
  const ebIsToken0vsMft = EB.toLowerCase() < MFT.toLowerCase();
  const bbIsToken0vsUsdc = BB.toLowerCase() < USDC.toLowerCase();
  const ebIsToken0vsUsdc = EB.toLowerCase() < USDC.toLowerCase();
  console.log(`\n  BB vs cbBTC: BB is token${bbIsToken0vsCbbtc ? '0' : '1'}`);
  console.log(`  EB vs WETH:  EB is token${ebIsToken0vsWeth ? '0' : '1'}`);
  console.log(`  BB vs MfT:   BB is token${bbIsToken0vsMft ? '0' : '1'}`);
  console.log(`  EB vs MfT:   EB is token${ebIsToken0vsMft ? '0' : '1'}`);
  console.log(`  BB vs USDC:  BB is token${bbIsToken0vsUsdc ? '0' : '1'}`);
  console.log(`  EB vs USDC:  EB is token${ebIsToken0vsUsdc ? '0' : '1'}`);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 3: Deploy reactors
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 3: Deploy BTCband Reactor ═══');
  const btcRxFact = new ethers.ContractFactory(REACTOR_INIT_ABI, reactorArtifact.bytecode, wallet);
  const btcRxDeploy = await btcRxFact.deploy({ gasLimit: 6000000 });
  await btcRxDeploy.waitForDeployment();
  const BTC_RX = await btcRxDeploy.getAddress();
  console.log('  Reactor:', BTC_RX);
  await sleep(2000);
  const btcRxInit = new ethers.Contract(BTC_RX, REACTOR_INIT_ABI, wallet);
  await (await btcRxInit.initialize(BB, MFT, NPM, ROUTER, V3FACTORY, MYCOPAD_RX, { gasLimit: 300000 })).wait();
  console.log('  Initialized. Admin:', await btcRxInit.admin());
  await sleep(2000);

  console.log('\n═══ STEP 4: Deploy ETHband Reactor ═══');
  const ethRxFact = new ethers.ContractFactory(REACTOR_INIT_ABI, reactorArtifact.bytecode, wallet);
  const ethRxDeploy = await ethRxFact.deploy({ gasLimit: 6000000 });
  await ethRxDeploy.waitForDeployment();
  const ETH_RX = await ethRxDeploy.getAddress();
  console.log('  Reactor:', ETH_RX);
  await sleep(2000);
  const ethRxInit = new ethers.Contract(ETH_RX, REACTOR_INIT_ABI, wallet);
  await (await ethRxInit.initialize(EB, MFT, NPM, ROUTER, V3FACTORY, MYCOPAD_RX, { gasLimit: 300000 })).wait();
  console.log('  Initialized. Admin:', await ethRxInit.admin());
  await sleep(2000);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 5: USDC reference pools ($1 anchor)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 5: USDC Reference Pools ═══');

  // BB/USDC price depends on token ordering
  let bbUsdcT0, bbUsdcT1, bbUsdcSqrt, bbUsdcA0, bbUsdcA1;
  if (bbIsToken0vsUsdc) {
    // BB=token0, USDC=token1: price = USDC_raw/BB_raw = 1e6/1e18 = 1e-12
    bbUsdcT0 = BB; bbUsdcT1 = USDC;
    bbUsdcSqrt = sqrtP(1e-12);
    bbUsdcA0 = BAND_SEED; bbUsdcA1 = USDC_SEED;
  } else {
    // USDC=token0, BB=token1: price = BB_raw/USDC_raw = 1e18/1e6 = 1e12
    bbUsdcT0 = USDC; bbUsdcT1 = BB;
    bbUsdcSqrt = sqrtP(1e12);
    bbUsdcA0 = USDC_SEED; bbUsdcA1 = BAND_SEED;
  }

  let ebUsdcT0, ebUsdcT1, ebUsdcSqrt, ebUsdcA0, ebUsdcA1;
  if (ebIsToken0vsUsdc) {
    ebUsdcT0 = EB; ebUsdcT1 = USDC;
    ebUsdcSqrt = sqrtP(1e-12);
    ebUsdcA0 = BAND_SEED; ebUsdcA1 = USDC_SEED;
  } else {
    ebUsdcT0 = USDC; ebUsdcT1 = EB;
    ebUsdcSqrt = sqrtP(1e12);
    ebUsdcA0 = USDC_SEED; ebUsdcA1 = BAND_SEED;
  }

  // Approve tokens for USDC pools
  const bbToken = new ethers.Contract(BB, ERC20_ABI, wallet);
  const ebToken = new ethers.Contract(EB, ERC20_ABI, wallet);
  const usdcToken = new ethers.Contract(USDC, ERC20_ABI, wallet);
  console.log('  Approving BB...');
  await (await bbToken.approve(NPM, SUPPLY)).wait();
  await sleep(1000);
  console.log('  Approving EB...');
  await (await ebToken.approve(NPM, SUPPLY)).wait();
  await sleep(1000);
  console.log('  Approving USDC...');
  await (await usdcToken.approve(NPM, USDC_SEED * 2n)).wait();
  await sleep(1000);

  const { addr: bbUsdcPool } = await ensurePool(bbUsdcT0, bbUsdcT1, FEE, bbUsdcSqrt, 'BB/USDC');
  const bbUsdcNft = await mintPos(bbUsdcT0, bbUsdcT1, FEE, MIN_TICK, MAX_TICK, bbUsdcA0, bbUsdcA1, 'BB/USDC ref');

  const { addr: ebUsdcPool } = await ensurePool(ebUsdcT0, ebUsdcT1, FEE, ebUsdcSqrt, 'EB/USDC');
  const ebUsdcNft = await mintPos(ebUsdcT0, ebUsdcT1, FEE, MIN_TICK, MAX_TICK, ebUsdcA0, ebUsdcA1, 'EB/USDC ref');

  // ═══════════════════════════════════════════════════════════════════
  // STEP 6: cbBTC / WETH band pools + one-sided positions
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 6: cbBTC/WETH Bands ═══');

  // BB/cbBTC: 1 BB=$1, BTC≈$97K → price depends on ordering
  // cbBTC has 8 decimals, BB has 18
  if (bbIsToken0vsCbbtc) {
    // BB=token0, cbBTC=token1: price = cbBTC_raw/BB_raw = (1/97000*1e8)/1e18
    const btcPrice = (1/97000) * 1e8 / 1e18;
    var { tick: btcTick, addr: btcPoolAddr } = await ensurePool(BB, cbBTC, FEE, sqrtP(btcPrice), 'BB/cbBTC');
    // One-sided BB (token0) above tick
    const b1Start = Math.ceil(btcTick / TS) * TS + TS;
    const b1Mid = b1Start + 200 * 50;
    var btcNft1 = await mintPos(BB, cbBTC, FEE, b1Start, b1Mid, BAND_EACH, 0n, 'BB Band 1');
    var btcNft2 = await mintPos(BB, cbBTC, FEE, b1Mid - TS, MAX_TICK, BAND_EACH, 0n, 'BB Band 2');
  } else {
    // cbBTC=token0, BB=token1: price = BB_raw/cbBTC_raw = (97000*1e18)/1e8
    const btcPrice = 97000 * 1e18 / 1e8;
    var { tick: btcTick, addr: btcPoolAddr } = await ensurePool(cbBTC, BB, FEE, sqrtP(btcPrice), 'cbBTC/BB');
    // One-sided BB (token1) below tick
    const b1End = Math.floor(btcTick / TS) * TS;
    const b1Mid = b1End - 200 * 50;
    var btcNft1 = await mintPos(cbBTC, BB, FEE, b1Mid, b1End, 0n, BAND_EACH, 'BB Band 1');
    var btcNft2 = await mintPos(cbBTC, BB, FEE, MIN_TICK, b1Mid + TS, 0n, BAND_EACH, 'BB Band 2');
  }

  // EB/WETH bands
  if (ebIsToken0vsWeth) {
    // EB=token0, WETH=token1: price = WETH/EB = (1/1850) both 18dec
    var { tick: ethTick, addr: ethPoolAddr } = await ensurePool(EB, WETH, FEE, sqrtP(1/ethPriceUsd), 'EB/WETH');
    const e1Start = Math.ceil(ethTick / TS) * TS + TS;
    const e1Mid = e1Start + 200 * 50;
    var ethNft1 = await mintPos(EB, WETH, FEE, e1Start, e1Mid, BAND_EACH, 0n, 'EB Band 1');
    var ethNft2 = await mintPos(EB, WETH, FEE, e1Mid - TS, MAX_TICK, BAND_EACH, 0n, 'EB Band 2');
  } else {
    // WETH=token0, EB=token1: price = EB/WETH = ethPriceUsd (both 18dec)
    var { tick: ethTick, addr: ethPoolAddr } = await ensurePool(WETH, EB, FEE, sqrtP(ethPriceUsd), 'WETH/EB');
    const e1End = Math.floor(ethTick / TS) * TS;
    const e1Mid = e1End - 200 * 50;
    var ethNft1 = await mintPos(WETH, EB, FEE, e1Mid, e1End, 0n, BAND_EACH, 'EB Band 1');
    var ethNft2 = await mintPos(WETH, EB, FEE, MIN_TICK, e1Mid + TS, 0n, BAND_EACH, 'EB Band 2');
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 7: MfT bands — CORRECT PRICING
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 7: MfT Bands (correctly priced) ═══');
  console.log(`  1 band token = $1 = ${mftPerDollar.toExponential(4)} MfT`);

  // BB/MfT
  if (bbIsToken0vsMft) {
    // BB=token0, MfT=token1: price = MfT/BB = mftPerDollar
    const { tick: bmTick, addr: bmPool } = await ensurePool(BB, MFT, FEE, sqrtP(mftPerDollar), 'BB/MfT');
    const bmStart = Math.ceil(bmTick / TS) * TS + TS;
    var bbMftNft = await mintPos(BB, MFT, FEE, bmStart, MAX_TICK, MFT_BAND, 0n, 'BB over MfT');
    var bbMftPool = bmPool;
  } else {
    // MfT=token0, BB=token1: price = BB/MfT = 1/mftPerDollar
    const { tick: bmTick, addr: bmPool } = await ensurePool(MFT, BB, FEE, sqrtP(1/mftPerDollar), 'MfT/BB');
    const bmEnd = Math.floor(bmTick / TS) * TS;
    var bbMftNft = await mintPos(MFT, BB, FEE, MIN_TICK, bmEnd, 0n, MFT_BAND, 'BB over MfT');
    var bbMftPool = bmPool;
  }

  // EB/MfT
  if (ebIsToken0vsMft) {
    // EB=token0, MfT=token1: price = MfT/EB = mftPerDollar
    const { tick: emTick, addr: emPool } = await ensurePool(EB, MFT, FEE, sqrtP(mftPerDollar), 'EB/MfT');
    const emStart = Math.ceil(emTick / TS) * TS + TS;
    var ebMftNft = await mintPos(EB, MFT, FEE, emStart, MAX_TICK, MFT_BAND, 0n, 'EB over MfT');
    var ebMftPool = emPool;
  } else {
    // MfT=token0, EB=token1: price = EB/MfT = 1/mftPerDollar
    const { tick: emTick, addr: emPool } = await ensurePool(MFT, EB, FEE, sqrtP(1/mftPerDollar), 'MfT/EB');
    const emEnd = Math.floor(emTick / TS) * TS;
    var ebMftNft = await mintPos(MFT, EB, FEE, MIN_TICK, emEnd, 0n, MFT_BAND, 'EB over MfT');
    var ebMftPool = emPool;
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 8: Send ALL to reactors
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 8: Send to Reactors ═══');
  await toReactor(btcNft1, BTC_RX, 'BB Band 1');
  await toReactor(btcNft2, BTC_RX, 'BB Band 2');
  await toReactor(bbMftNft, BTC_RX, 'BB/MfT');
  await toReactor(ethNft1, ETH_RX, 'EB Band 1');
  await toReactor(ethNft2, ETH_RX, 'EB Band 2');
  await toReactor(ebMftNft, ETH_RX, 'EB/MfT');

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  const [bBal, eBal, uBal, gasBal] = await Promise.all([
    bbToken.balanceOf(wallet.address),
    ebToken.balanceOf(wallet.address),
    usdcToken.balanceOf(wallet.address),
    provider.getBalance(wallet.address)
  ]);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           BAND v3 — FULL LAUNCH COMPLETE                ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ BTCband v3:     ${BB}`);
  console.log(`║ ETHband v3:     ${EB}`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ BTCband Reactor: ${BTC_RX}`);
  console.log(`║   Band 1: #${btcNft1}`);
  console.log(`║   Band 2: #${btcNft2}`);
  console.log(`║   MfT:    #${bbMftNft}`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ ETHband Reactor: ${ETH_RX}`);
  console.log(`║   Band 1: #${ethNft1}`);
  console.log(`║   Band 2: #${ethNft2}`);
  console.log(`║   MfT:    #${ebMftNft}`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ BB/USDC ref: ${bbUsdcPool} (#${bbUsdcNft})`);
  console.log(`║ EB/USDC ref: ${ebUsdcPool} (#${ebUsdcNft})`);
  console.log(`║ BB/cbBTC:    ${btcPoolAddr}`);
  console.log(`║ EB/WETH:     ${ethPoolAddr}`);
  console.log(`║ BB/MfT:      ${bbMftPool}`);
  console.log(`║ EB/MfT:      ${ebMftPool}`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ MfT price: $${(1/mftPerDollar).toExponential(4)} | ${mftPerDollar.toExponential(2)} MfT/$1`);
  console.log(`║ BB reserved: ${ethers.formatUnits(bBal, 18)}`);
  console.log(`║ EB reserved: ${ethers.formatUnits(eBal, 18)}`);
  console.log(`║ USDC left:   ${ethers.formatUnits(uBal, 6)}`);
  console.log(`║ ETH left:    ${ethers.formatEther(gasBal)}`);
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
