const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

const ETHBAND = '0xd7ac547B8a5d7756F36b593287431Bad7Feb7864';
const BTCBAND = '0x11DFE729F1211904efB99F4d4a3f9FAF6C93CCB5';
const WETH = '0x4200000000000000000000000000000000000006';
const MFT = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const BTC_REACTOR = '0x038B87f2Abc1dcE269FF7DE4d3e721b5b57eD8cf';
const ETH_REACTOR = '0xeB02d1137342cD08C1c4bf61C188d86C5253b631';
const FEE = 10000;
const MIN_TICK = -887200;
const MAX_TICK = 887200;
const TS = 200;

const ERC20 = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
const POOL_ABI = ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)', 'function initialize(uint160) external'];
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external'
];
const RX_ABI = ['function addPool(uint256 tokenId) external', 'function poolCount() view returns (uint256)'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function sqrtP(p) { return BigInt(Math.floor(Math.sqrt(p) * 79228162514264337593543950336)); }

async function mint(t0, t1, fee, tl, tu, a0, a1, label) {
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
  const r = new ethers.Contract(rx, RX_ABI, wallet);
  await (await r.addPool(id, { gasLimit: 500000 })).wait();
  console.log(`  Done. Pools: ${await r.poolCount()}`);
  await sleep(1500);
}

async function ensurePoolInit(tokenA, tokenB, fee, price, label) {
  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);
  let addr = await factory.getPool(tokenA, tokenB, fee);
  if (addr === ethers.ZeroAddress) {
    console.log(`  Creating ${label} pool...`);
    await (await factory.createPool(tokenA, tokenB, fee, { gasLimit: 5000000 })).wait();
    await sleep(5000);
    addr = await factory.getPool(tokenA, tokenB, fee);
    if (addr === ethers.ZeroAddress) { await sleep(5000); addr = await factory.getPool(tokenA, tokenB, fee); }
    console.log(`  Pool: ${addr}`);
    const p = new ethers.Contract(addr, POOL_ABI, wallet);
    await (await p.initialize(price, { gasLimit: 500000 })).wait();
    console.log(`  Initialized`);
  } else {
    console.log(`  ${label} exists: ${addr}`);
    const p = new ethers.Contract(addr, POOL_ABI, provider);
    const [s] = await p.slot0();
    if (s === 0n) {
      const pw = new ethers.Contract(addr, POOL_ABI, wallet);
      await (await pw.initialize(price, { gasLimit: 500000 })).wait();
      console.log(`  Initialized`);
    }
  }
  await sleep(3000);
  const p = new ethers.Contract(addr, POOL_ABI, provider);
  const [, tick] = await p.slot0();
  console.log(`  Tick: ${Number(tick)}`);
  return { addr, tick: Number(tick) };
}

async function main() {
  console.log('Wallet:', wallet.address);
  const BAND = ethers.parseUnits('450000', 18);
  const MBAND = ethers.parseUnits('10000', 18);

  // ═══ ETHband/WETH bands ═══
  console.log('\n=== WETH/ETHband Bands ===');
  const ethPoolAddr = '0xe4b68937c2D8675E7DE2bc334Af57A2e4363c938';
  const ethPool = new ethers.Contract(ethPoolAddr, POOL_ABI, provider);
  const [, ethTick] = await ethPool.slot0();
  const et = Number(ethTick);
  console.log('  Current tick:', et);

  const eEnd = Math.floor(et / TS) * TS;
  const eMid = eEnd - 200 * 50;

  const ethToken = new ethers.Contract(ETHBAND, ERC20, wallet);
  console.log('  Approving ETHband...');
  await (await ethToken.approve(NPM, BAND * 2n + MBAND)).wait();
  await sleep(1000);

  const ethNft1 = await mint(WETH, ETHBAND, FEE, eMid, eEnd, 0n, BAND, 'ETHband Band 1');
  const ethNft2 = await mint(WETH, ETHBAND, FEE, MIN_TICK, eMid + TS, 0n, BAND, 'ETHband Band 2');

  // ═══ MfT bands ═══
  console.log('\n=== MfT Bands ===');

  // BTCband/MfT: BTCband=token0, MfT=token1, price=1000 (1 BTCband = 1000 MfT)
  const { tick: bmt } = await ensurePoolInit(BTCBAND, MFT, FEE, sqrtP(1000), 'BTCband/MfT');
  const btcToken = new ethers.Contract(BTCBAND, ERC20, wallet);
  console.log('  Approving BTCband...');
  await (await btcToken.approve(NPM, MBAND)).wait();
  await sleep(1000);
  const btcStart = Math.ceil(bmt / TS) * TS + TS;
  const btcMftNft = await mint(BTCBAND, MFT, FEE, btcStart, MAX_TICK, MBAND, 0n, 'BTCband over MfT');

  // MfT/ETHband: MfT=token0, ETHband=token1, price=0.001 (1 MfT = 0.001 ETHband)
  const { tick: met } = await ensurePoolInit(MFT, ETHBAND, FEE, sqrtP(0.001), 'MfT/ETHband');
  console.log('  Approving ETHband for MfT band...');
  await (await ethToken.approve(NPM, MBAND)).wait();
  await sleep(1000);
  const ethMftEnd = Math.floor(met / TS) * TS;
  const ethMftNft = await mint(MFT, ETHBAND, FEE, MIN_TICK, ethMftEnd, 0n, MBAND, 'ETHband over MfT');

  // ═══ Send ALL to reactors ═══
  console.log('\n=== Sending to Reactors ===');
  await toReactor('5054495', BTC_REACTOR, 'BTCband Band 1');
  await toReactor('5054496', BTC_REACTOR, 'BTCband Band 2');
  await toReactor(btcMftNft, BTC_REACTOR, 'BTCband/MfT');
  await toReactor(ethNft1, ETH_REACTOR, 'ETHband Band 1');
  await toReactor(ethNft2, ETH_REACTOR, 'ETHband Band 2');
  await toReactor(ethMftNft, ETH_REACTOR, 'ETHband/MfT');

  const [bBal, eBal, gas] = await Promise.all([
    btcToken.balanceOf(wallet.address),
    ethToken.balanceOf(wallet.address),
    provider.getBalance(wallet.address)
  ]);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           BAND v2 — ALL POSITIONS LIVE                  ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ BTCband Reactor (${BTC_REACTOR}):`);
  console.log(`║   Band 1: #5054495 (cbBTC)`);
  console.log(`║   Band 2: #5054496 (cbBTC)`);
  console.log(`║   MfT:    #${btcMftNft}`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ ETHband Reactor (${ETH_REACTOR}):`);
  console.log(`║   Band 1: #${ethNft1} (WETH)`);
  console.log(`║   Band 2: #${ethNft2} (WETH)`);
  console.log(`║   MfT:    #${ethMftNft}`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ BTCband reserved: ${ethers.formatUnits(bBal, 18)}`);
  console.log(`║ ETHband reserved: ${ethers.formatUnits(eBal, 18)}`);
  console.log(`║ ETH remaining:    ${ethers.formatEther(gas)}`);
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
