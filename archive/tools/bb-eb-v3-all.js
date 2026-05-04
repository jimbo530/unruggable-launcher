const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB    = '0xC89344F08fdE43aa65Dce4A7FcEb8284B201293e';
const EB    = '0x15e274AbAe2645E5fBAc29Ab790837b484Cb5bCe';
const USDC  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const cbBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const WETH  = '0x4200000000000000000000000000000000000006';
const AZUSD = '0x3595ca37596d5895b70efab592ac315d5b9809b2';
const MfT   = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const TGN   = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29';
const POOP  = '0x126555aecBAC290b25644e4b7f29c016aE95f4dc';
const BRUH  = '0xe61b190c0f0070e07de3bb4829fe5fdcf7d934f1';
const BURG  = '0x06A05043eb2C1691b19c2C13219dB9212269dDc5';
const NPM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F   = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 3000, TS = 60, MAX_TICK = 887220;

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL  = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function sqrtP(pr) { return BigInt(Math.floor(Math.sqrt(pr) * 79228162514264337593543950336)); }
function nftId(receipt) {
  const l = receipt.logs.find(x =>
    x.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    x.address.toLowerCase() === NPM.toLowerCase()
  );
  return l && l.topics.length >= 4 ? BigInt(l.topics[3]).toString() : 'unknown';
}

// Order tokens and compute raw price for init
// rawPrice = token1_smallest / token0_smallest
function orderAndPrice(tokenA, decA, priceA_usd, tokenB, decB, priceB_usd) {
  const aIsT0 = tokenA.toLowerCase() < tokenB.toLowerCase();
  const t0 = aIsT0 ? tokenA : tokenB;
  const t1 = aIsT0 ? tokenB : tokenA;
  const dec0 = aIsT0 ? decA : decB;
  const dec1 = aIsT0 ? decB : decA;
  const p0 = aIsT0 ? priceA_usd : priceB_usd;
  const p1 = aIsT0 ? priceB_usd : priceA_usd;
  // 1 unit t0 = (p0/p1) units t1 in human terms
  // raw = (p0/p1) * 10^dec1 / 10^dec0
  const raw = (p0 / p1) * Math.pow(10, dec1) / Math.pow(10, dec0);
  return { t0, t1, raw, dec0, dec1 };
}

async function createPoolAndInit(factory, t0, t1, rawPrice) {
  await (await factory.createPool(t0, t1, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  const addr = await factory.getPool(t0, t1, FEE);
  await (await new ethers.Contract(addr, POOL, w).initialize(sqrtP(rawPrice), {gasLimit: 300000})).wait();
  await sleep(2000);
  return addr;
}

// Sell tokenX as one-sided wall. Returns NFT id.
// If tokenX is token0: sell above → [wallStart, MAX_TICK], amt in amount0
// If tokenX is token1: sell below → [-MAX_TICK, wallEnd], amt in amount1
async function mintSellWall(npm, poolAddr, t0, t1, sellToken, amt, dl) {
  const [, tick] = await new ethers.Contract(poolAddr, POOL, p).slot0();
  const t = Number(tick);
  let tx;
  if (sellToken.toLowerCase() === t0.toLowerCase()) {
    const wallStart = Math.ceil(t / TS) * TS + TS;
    console.log('  wall [' + wallStart + ', ' + MAX_TICK + '] token0 above');
    tx = await npm.mint({
      token0: t0, token1: t1, fee: FEE,
      tickLower: wallStart, tickUpper: MAX_TICK,
      amount0Desired: amt, amount1Desired: 0n,
      amount0Min: 0, amount1Min: 0,
      recipient: w.address, deadline: dl
    }, {gasLimit: 2000000});
  } else {
    const wallEnd = Math.floor(t / TS) * TS - TS;
    console.log('  wall [-' + MAX_TICK + ', ' + wallEnd + '] token1 below');
    tx = await npm.mint({
      token0: t0, token1: t1, fee: FEE,
      tickLower: -MAX_TICK, tickUpper: wallEnd,
      amount0Desired: 0n, amount1Desired: amt,
      amount0Min: 0, amount1Min: 0,
      recipient: w.address, deadline: dl
    }, {gasLimit: 2000000});
  }
  const r = await tx.wait();
  return nftId(r);
}

async function main() {
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  const factory = new ethers.Contract(V3F, FACT, w);
  const dl = Math.floor(Date.now() / 1000) + 1200;
  const results = [];

  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // Prices in USD
  const BTC_USD = 78742;
  const ETH_USD = 2325;
  const BB_USD = 1.0;
  const EB_USD = 1.0;
  const AZUSD_USD = 1.0;
  const MfT_USD = 2.7488e-7;
  const POOP_USD = 0.96;
  const TGN_USD = 0.14;
  const BRUH_USD = 0.00000001;
  const BURG_USD = 0.0000008889;

  // ═══ APPROVALS ═══
  console.log('\n═══ APPROVALS ═══');
  for (const [tok, name] of [[BB,'BB'],[EB,'EB'],[USDC,'USDC']]) {
    console.log('Approving ' + name + '...');
    await (await new ethers.Contract(tok, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
    await sleep(2000);
  }

  // ═══ 1. USDC REFS (1 token + $1) ═══
  console.log('\n═══ USDC REF POOLS ═══');
  // BB/USDC: USDC(0x8335) < BB(0xC893) → USDC=t0(6dec), BB=t1(18dec)
  // raw = (1.0/1.0) * 1e18/1e6 = 1e12
  let addr = await createPoolAndInit(factory, USDC, BB, 1e12);
  console.log('BB/USDC pool:', addr);
  let tx = await npm.mint({
    token0: USDC, token1: BB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: MAX_TICK,
    amount0Desired: 1000000n, amount1Desired: ethers.parseUnits('1', 18),
    amount0Min: 0, amount1Min: 0, recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  let r = await tx.wait();
  results.push('BB/USDC: ' + addr + ' NFT#' + nftId(r));
  console.log('  NFT#' + nftId(r));
  await sleep(2000);

  // EB/USDC: EB(0x15e2) < USDC(0x8335) → EB=t0(18dec), USDC=t1(6dec)
  // raw = (1.0/1.0) * 1e6/1e18 = 1e-12
  addr = await createPoolAndInit(factory, EB, USDC, 1e-12);
  console.log('EB/USDC pool:', addr);
  tx = await npm.mint({
    token0: EB, token1: USDC, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: MAX_TICK,
    amount0Desired: ethers.parseUnits('1', 18), amount1Desired: 1000000n,
    amount0Min: 0, amount1Min: 0, recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  results.push('EB/USDC: ' + addr + ' NFT#' + nftId(r));
  console.log('  NFT#' + nftId(r));
  await sleep(2000);

  // ═══ 2. BTC/ETH BAND WALLS (50%) ═══
  console.log('\n═══ BTC/ETH BAND WALLS (500K each) ═══');
  const K500 = ethers.parseUnits('500000', 18);

  // BB/cbBTC: BB(0xC893) < cbBTC(0xcbB7) → BB=t0(18dec), cbBTC=t1(8dec)
  // 1 BB=$1, 1 cbBTC=$78742. raw = (1/78742) * 1e8/1e18 = 1e8/(78742*1e18)
  const bbBtcRaw = 1e8 / (BTC_USD * 1e18);
  addr = await createPoolAndInit(factory, BB, cbBTC, bbBtcRaw);
  console.log('BB/cbBTC pool:', addr);
  let id = await mintSellWall(npm, addr, BB, cbBTC, BB, K500, dl);
  results.push('BB/cbBTC: ' + addr + ' NFT#' + id + ' 500K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // WETH/EB: EB(0x15e2) < WETH(0x4200) → EB=t0(18dec), WETH=t1(18dec)
  // 1 EB=$1, 1 WETH=$2325. raw = (1/2325) = WETH per EB
  const ebWethRaw = 1 / ETH_USD;
  addr = await createPoolAndInit(factory, EB, WETH, ebWethRaw);
  console.log('WETH/EB pool:', addr);
  id = await mintSellWall(npm, addr, EB, WETH, EB, K500, dl);
  results.push('WETH/EB: ' + addr + ' NFT#' + id + ' 500K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // ═══ 3. AZUSD WALLS (5%) ═══
  console.log('\n═══ AZUSD WALLS (50K each) ═══');
  const K50 = ethers.parseUnits('50000', 18);

  // BB/AZUSD: AZUSD(0x3595) < BB(0xC893) → AZUSD=t0(18), BB=t1(18). raw=1.0
  addr = await createPoolAndInit(factory, AZUSD, BB, 1.0);
  console.log('AZUSD/BB pool:', addr);
  id = await mintSellWall(npm, addr, AZUSD, BB, BB, K50, dl);
  results.push('AZUSD/BB: ' + addr + ' NFT#' + id + ' 50K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // EB/AZUSD: EB(0x15e2) < AZUSD(0x3595) → EB=t0(18), AZUSD=t1(18). raw=1.0
  addr = await createPoolAndInit(factory, EB, AZUSD, 1.0);
  console.log('EB/AZUSD pool:', addr);
  id = await mintSellWall(npm, addr, EB, AZUSD, EB, K50, dl);
  results.push('EB/AZUSD: ' + addr + ' NFT#' + id + ' 50K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // ═══ 4. MfT WALLS (5%) ═══
  console.log('\n═══ MfT WALLS (50K each) ═══');
  // BB/MfT: MfT(0x8FB8) < BB(0xC893) → MfT=t0(18), BB=t1(18)
  // raw = BB_per_MfT = MfT_USD/BB_USD = 2.7488e-7
  addr = await createPoolAndInit(factory, MfT, BB, MfT_USD);
  console.log('MfT/BB pool:', addr);
  id = await mintSellWall(npm, addr, MfT, BB, BB, K50, dl);
  results.push('MfT/BB: ' + addr + ' NFT#' + id + ' 50K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // EB/MfT: EB(0x15e2) < MfT(0x8FB8) → EB=t0(18), MfT=t1(18)
  // raw = MfT_per_EB = 1/MfT_USD = 3637907
  addr = await createPoolAndInit(factory, EB, MfT, 1/MfT_USD);
  console.log('EB/MfT pool:', addr);
  id = await mintSellWall(npm, addr, EB, MfT, EB, K50, dl);
  results.push('EB/MfT: ' + addr + ' NFT#' + id + ' 50K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // ═══ 5. BB/EB CROSS (5%) ═══
  console.log('\n═══ BB/EB CROSS (50K+50K) ═══');
  // EB(0x15e2) < BB(0xC893) → EB=t0, BB=t1. Both $1. raw=1.0
  addr = await createPoolAndInit(factory, EB, BB, 1.0);
  console.log('EB/BB pool:', addr);
  tx = await npm.mint({
    token0: EB, token1: BB, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: MAX_TICK,
    amount0Desired: K50, amount1Desired: K50,
    amount0Min: 0, amount1Min: 0, recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  results.push('EB/BB: ' + addr + ' NFT#' + nftId(r) + ' 50K+50K');
  console.log('  NFT#' + nftId(r));
  await sleep(2000);

  // ═══ 6. TGN WALLS (1%) ═══
  console.log('\n═══ TGN WALLS (10K each) ═══');
  const K10 = ethers.parseUnits('10000', 18);

  // BB/TGN: BB(0xC893) < TGN(0xD75d) → BB=t0(18), TGN=t1(18)
  // 1 BB=$1, 1 TGN=$0.14. raw = TGN_per_BB = 1/0.14 = 7.1429
  addr = await createPoolAndInit(factory, BB, TGN, 1/TGN_USD);
  console.log('BB/TGN pool:', addr);
  id = await mintSellWall(npm, addr, BB, TGN, BB, K10, dl);
  results.push('BB/TGN: ' + addr + ' NFT#' + id + ' 10K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // EB/TGN: EB(0x15e2) < TGN(0xD75d) → EB=t0(18), TGN=t1(18)
  // raw = TGN_per_EB = 1/0.14 = 7.1429
  addr = await createPoolAndInit(factory, EB, TGN, 1/TGN_USD);
  console.log('EB/TGN pool:', addr);
  id = await mintSellWall(npm, addr, EB, TGN, EB, K10, dl);
  results.push('EB/TGN: ' + addr + ' NFT#' + id + ' 10K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // ═══ 7. POOP WALLS (1%) ═══
  console.log('\n═══ POOP WALLS (10K each) ═══');
  // BB/POOP: POOP(0x1265) < BB(0xC893) → POOP=t0(18), BB=t1(18)
  // 1 POOP=$0.96, 1 BB=$1. raw = BB_per_POOP = 0.96/1 = 0.96
  addr = await createPoolAndInit(factory, POOP, BB, POOP_USD/BB_USD);
  console.log('POOP/BB pool:', addr);
  id = await mintSellWall(npm, addr, POOP, BB, BB, K10, dl);
  results.push('POOP/BB: ' + addr + ' NFT#' + id + ' 10K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // EB/POOP: POOP(0x1265) < EB(0x15e2)? 0x1265 < 0x15e2 → POOP=t0(18), EB=t1(18)
  addr = await createPoolAndInit(factory, POOP, EB, POOP_USD/EB_USD);
  console.log('POOP/EB pool:', addr);
  id = await mintSellWall(npm, addr, POOP, EB, EB, K10, dl);
  results.push('POOP/EB: ' + addr + ' NFT#' + id + ' 10K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // ═══ 8. BRUH WALLS (1%) ═══
  console.log('\n═══ BRUH WALLS (10K each) ═══');
  // BB/BRUH: BB(0xC893) < BRUH(0xe61b) → BB=t0(18), BRUH=t1(18)
  // 1 BB=$1, 1 BRUH=$0.00000001. raw = BRUH_per_BB = 1/0.00000001 = 100000000
  addr = await createPoolAndInit(factory, BB, BRUH, 1/BRUH_USD);
  console.log('BB/BRUH pool:', addr);
  id = await mintSellWall(npm, addr, BB, BRUH, BB, K10, dl);
  results.push('BB/BRUH: ' + addr + ' NFT#' + id + ' 10K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // EB/BRUH: EB(0x15e2) < BRUH(0xe61b) → EB=t0(18), BRUH=t1(18)
  addr = await createPoolAndInit(factory, EB, BRUH, 1/BRUH_USD);
  console.log('EB/BRUH pool:', addr);
  id = await mintSellWall(npm, addr, EB, BRUH, EB, K10, dl);
  results.push('EB/BRUH: ' + addr + ' NFT#' + id + ' 10K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // ═══ 9. BURGERS WALLS (1%) ═══
  console.log('\n═══ BURGERS WALLS (10K each) ═══');
  // BB/BURG: BURG(0x06A0) < BB(0xC893) → BURG=t0(18), BB=t1(18)
  // 1 BURG=$0.0000008889, 1 BB=$1. raw = BB_per_BURG = 0.0000008889
  addr = await createPoolAndInit(factory, BURG, BB, BURG_USD/BB_USD);
  console.log('BURG/BB pool:', addr);
  id = await mintSellWall(npm, addr, BURG, BB, BB, K10, dl);
  results.push('BURG/BB: ' + addr + ' NFT#' + id + ' 10K');
  console.log('  NFT#' + id);
  await sleep(2000);

  // EB/BURG: BURG(0x06A0) < EB(0x15e2) → BURG=t0(18), EB=t1(18)
  addr = await createPoolAndInit(factory, BURG, EB, BURG_USD/EB_USD);
  console.log('BURG/EB pool:', addr);
  id = await mintSellWall(npm, addr, BURG, EB, EB, K10, dl);
  results.push('BURG/EB: ' + addr + ' NFT#' + id + ' 10K');
  console.log('  NFT#' + id);

  // ═══ SUMMARY ═══
  console.log('\n═══════════════════════════');
  console.log('BB: ' + BB);
  console.log('EB: ' + EB);
  console.log('');
  for (const line of results) console.log(line);
  console.log('');
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
