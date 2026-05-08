const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, p);

const EBT  = '0xF021001e98CaE23eb8E72EA8384F8D7b3FCeA59D';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const cbBTC= '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const MfT  = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM  = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F  = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const FEE = 10000, TS = 200;

const ERC20 = ['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'];
const FACT = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function doPool(name, token0Addr, ebtAmount, ebtPerToken0) {
  console.log('\n=== EBT/' + name + ' (' + ethers.formatEther(ebtAmount) + ' EBT) ===');
  const fact = new ethers.Contract(V3F, FACT, p);
  const factW = new ethers.Contract(V3F, FACT, w);

  // EBT is always token1 (0xF0 > everything)
  // price = 1.0001^tick = EBT per token0
  const initTick = Math.round(Math.log(ebtPerToken0) / Math.log(1.0001) / TS) * TS;

  // Sell wall: EBT is token1, need currentTick > tickUpper
  const tickUpper = initTick - TS;
  const tickLower = tickUpper - 600;
  console.log('Init tick:', initTick, '| Sell wall:', tickLower, 'to', tickUpper);

  // Create pool
  let poolAddr = await fact.getPool(token0Addr, EBT, FEE);
  if (poolAddr === ethers.ZeroAddress) {
    console.log('Creating pool...');
    const tx = await factW.createPool(token0Addr, EBT, FEE, { gasLimit: 5000000 });
    await tx.wait();
    await sleep(4000);
    poolAddr = await fact.getPool(token0Addr, EBT, FEE);
    console.log('Pool:', poolAddr);
  } else {
    console.log('Pool exists:', poolAddr);
  }

  // Initialize
  const pool = new ethers.Contract(poolAddr, POOL, w);
  let ct;
  try {
    const s = await new ethers.Contract(poolAddr, POOL, p).slot0();
    if (s[0] === 0n) throw new Error('not init');
    ct = Number(s[1]);
    console.log('Already initialized, tick:', ct);
  } catch {
    const sqrtP = BigInt(Math.floor(Math.sqrt(ebtPerToken0) * 79228162514264337593543950336));
    console.log('Initializing sqrtP:', sqrtP.toString());
    await (await pool.initialize(sqrtP, { gasLimit: 300000 })).wait();
    await sleep(3000);
    const s = await new ethers.Contract(poolAddr, POOL, p).slot0();
    ct = Number(s[1]);
    console.log('Initialized, tick:', ct);
  }

  if (ct <= tickUpper) {
    console.log('ERROR: currentTick', ct, '<= tickUpper', tickUpper, '- skipping');
    return null;
  }

  // Approve EBT
  const ebt = new ethers.Contract(EBT, ERC20, w);
  const allow = await ebt.allowance(w.address, NPM);
  if (allow < ebtAmount) {
    console.log('Approving EBT...');
    await (await ebt.approve(NPM, ethers.MaxUint256, { gasLimit: 100000 })).wait();
    await sleep(2000);
  }

  // Mint: token0=other, token1=EBT
  console.log('Minting...');
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  const tx = await npm.mint({
    token0: token0Addr,
    token1: EBT,
    fee: FEE,
    tickLower, tickUpper,
    amount0Desired: 0,
    amount1Desired: ebtAmount,
    amount0Min: 0, amount1Min: 0,
    recipient: w.address,
    deadline: Math.floor(Date.now() / 1000) + 600
  }, { gasLimit: 600000 });
  const receipt = await tx.wait();
  const id = nftId(receipt);
  console.log('SUCCESS! Position #' + id + ' | ticks', tickLower, 'to', tickUpper);
  await sleep(3000);
  return id;
}

async function main() {
  console.log('Wallet:', w.address);
  const fact = new ethers.Contract(V3F, FACT, p);

  // Get live prices
  const ethPool = await fact.getPool(WETH, USDC, 500);
  const es = await new ethers.Contract(ethPool, POOL, p).slot0();
  const ethPrice = Math.pow(1.0001, Number(es[1])) * 1e12;
  console.log('ETH price: $' + ethPrice.toFixed(2));

  // BTC price
  const btcPool = await fact.getPool(cbBTC, USDC, 500);
  const bs = await new ethers.Contract(btcPool, POOL, p).slot0();
  // USDC(0x83) is token0, cbBTC(0xcb) is token1 — wait no
  // cbBTC(0xcb) vs USDC(0x83): 0x83 < 0xcb, so USDC is token0, cbBTC is token1
  // price = 1.0001^tick * 10^(6-8) = cbBTC per USDC * decimal adj
  // Actually: token0=USDC(6dec), token1=cbBTC(8dec)
  // price_raw = 1.0001^tick. price_human = price_raw * 10^(6-8) = price_raw * 0.01
  // That's cbBTC/USDC. BTC price = 1/price_human
  const btcPrice = 1 / (Math.pow(1.0001, Number(bs[1])) * 0.01);
  console.log('BTC price: $' + btcPrice.toFixed(2));

  // MfT price from WETH pair (with retry for rate limits)
  await sleep(2000);
  const mftPool = await fact.getPool(MfT, WETH, 10000);
  await sleep(1000);
  let ms;
  for (let i = 0; i < 3; i++) {
    try { ms = await new ethers.Contract(mftPool, POOL, p).slot0(); break; }
    catch { console.log('Rate limited, retrying...'); await sleep(3000); }
  }
  const mftPerWeth = Math.pow(1.0001, Number(ms[1]));
  const mftPrice = ethPrice / mftPerWeth;
  console.log('MfT price: $' + mftPrice.toFixed(8));

  // EBT = $1 target. Calculate EBT per token0 for each pair:
  // EBT/WETH: WETH is token0(18dec), EBT is token1(18dec). Same dec -> EBT per WETH = ethPrice
  const ebtPerWeth = ethPrice;
  // EBT/USDC: USDC is token0(6dec), EBT is token1(18dec). price_raw = EBT_raw/USDC_raw = (1e18)/(1e6) = 1e12 at $1
  // Wait: at $1 EBT, 1 USDC = 1 EBT. raw: 1e18 EBT / 1e6 USDC = 1e12
  const ebtPerUsdc = 1e12;
  // EBT/cbBTC: cbBTC is token0(8dec), EBT is token1(18dec). At $1 EBT: 1 cbBTC = btcPrice EBT
  // raw: btcPrice * 1e18 / 1e8 = btcPrice * 1e10
  const ebtPerCbbtc = btcPrice * 1e10;
  // EBT/MfT: MfT is token0(18dec), EBT is token1(18dec). Same dec -> EBT per MfT = mftPrice
  const ebtPerMft = mftPrice;

  console.log('\nRatios:');
  console.log('  EBT/WETH:', ebtPerWeth.toFixed(2));
  console.log('  EBT/USDC:', ebtPerUsdc);
  console.log('  EBT/cbBTC:', ebtPerCbbtc.toFixed(2));
  console.log('  EBT/MfT:', ebtPerMft.toFixed(8));

  // Do pools one at a time: WETH(60%), MfT(20%), USDC(10%), cbBTC(10%)
  await doPool('WETH', WETH, ethers.parseEther('600000'), ebtPerWeth);
  await doPool('MfT', MfT, ethers.parseEther('200000'), ebtPerMft);
  await doPool('USDC', USDC, ethers.parseEther('100000'), ebtPerUsdc);
  await doPool('cbBTC', cbBTC, ethers.parseEther('100000'), ebtPerCbbtc);

  console.log('\n=== ALL EBT POOLS DONE ===');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
