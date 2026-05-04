const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB    = '0xFB6202590B424060DE325639C4160a42F5FE4740';
const EB    = '0xDD7E0869e600b91573a2b7646A2acd22f627B96C';
const USDC  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const cbBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const WETH  = '0x4200000000000000000000000000000000000006';
const AZUSD = '0x3595ca37596d5895b70efab592ac315d5b9809b2';
const MfT   = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const TGN   = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29';
const POOP  = '0x126555aecBAC290b25644e4b7f29c016aE95f4dc';
const BRUH  = '0xe61b190c0f0070e07de3bb4829fe5fdcf7d934f1';
const BURG  = '0x06A05043eb2C1691b19c2C13219dB9212269dDc5';
const EGP   = '0xc1BA76771bbF0dD841347630E57c793F9d5ACcEe';
const NPM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F   = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const ROUTER= '0x2626664c2603336E57B271c5C0b26F421741e481';
const BB_PRIME = '0x84FB78ac1E60d33de602cAf004eB5626cd2420bE'; // old BB reactor

const FEE = 3000, TS = 60, MAX_TICK = 887220;

// Prices
const BTC_USD  = 78742;
const ETH_USD  = 2325;
const MfT_USD  = 2.7488e-7;
const POOP_USD = 0.96;
const TGN_USD  = 0.14;
const EGP_USD  = 0.00024;
const BRUH_USD = 1.12e-9;   // from live WETH pool
const BURG_USD = 8.889e-7;

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL  = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external',
];
const RX_ABI = [
  'function initialize(address,address,address,address,address,address) external',
  'function addPool(uint256) external',
  'function poolCount() view returns (uint256)',
  'function token() view returns (address)',
];
const rxArtifact = require('../artifacts/contracts/SporeReactorV2.sol/SporeReactorV2.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function sqrtP(pr) { return BigInt(Math.floor(Math.sqrt(pr) * 79228162514264337593543950336)); }
function nftId(receipt) {
  const l = receipt.logs.find(x =>
    x.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    x.address.toLowerCase() === NPM.toLowerCase()
  );
  return l && l.topics.length >= 4 ? BigInt(l.topics[3]).toString() : 'unknown';
}

function order(a, b) { return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]; }

async function createPool(factory, tA, tB, rawPrice) {
  const [t0, t1] = order(tA, tB);
  await (await factory.createPool(t0, t1, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  const addr = await factory.getPool(t0, t1, FEE);
  await (await new ethers.Contract(addr, POOL, w).initialize(sqrtP(rawPrice), {gasLimit: 300000})).wait();
  await sleep(2000);
  return { addr, t0, t1 };
}

async function sellWall(npm, addr, t0, t1, sellToken, amt, dl) {
  const [, tick] = await new ethers.Contract(addr, POOL, p).slot0();
  const t = Number(tick);
  let tx;
  if (sellToken.toLowerCase() === t0.toLowerCase()) {
    const start = Math.ceil(t / TS) * TS + TS;
    tx = await npm.mint({ token0: t0, token1: t1, fee: FEE, tickLower: start, tickUpper: MAX_TICK,
      amount0Desired: amt, amount1Desired: 0n, amount0Min: 0, amount1Min: 0,
      recipient: w.address, deadline: dl }, {gasLimit: 2000000});
  } else {
    const end = Math.floor(t / TS) * TS - TS;
    tx = await npm.mint({ token0: t0, token1: t1, fee: FEE, tickLower: -MAX_TICK, tickUpper: end,
      amount0Desired: 0n, amount1Desired: amt, amount0Min: 0, amount1Min: 0,
      recipient: w.address, deadline: dl }, {gasLimit: 2000000});
  }
  const r = await tx.wait();
  return nftId(r);
}

// rawPrice = token1_per_token0 in smallest units. For same-decimal tokens: priceT0_usd / priceT1_usd
// For different decimals: (priceT0 / priceT1) * 10^(dec1) / 10^(dec0)
function rawPrice(t0, t1, prices, decimals) {
  const p0 = prices[t0.toLowerCase()];
  const p1 = prices[t1.toLowerCase()];
  const d0 = decimals[t0.toLowerCase()];
  const d1 = decimals[t1.toLowerCase()];
  return (p0 / p1) * Math.pow(10, d1 - d0);
}

async function main() {
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  const factory = new ethers.Contract(V3F, FACT, w);
  const dl = Math.floor(Date.now() / 1000) + 1200;
  const bbNfts = [];
  const ebNfts = [];

  const prices = {};
  prices[BB.toLowerCase()] = 1.0;
  prices[EB.toLowerCase()] = 1.0;
  prices[USDC.toLowerCase()] = 1.0;
  prices[AZUSD.toLowerCase()] = 1.0;
  prices[cbBTC.toLowerCase()] = BTC_USD;
  prices[WETH.toLowerCase()] = ETH_USD;
  prices[MfT.toLowerCase()] = MfT_USD;
  prices[POOP.toLowerCase()] = POOP_USD;
  prices[TGN.toLowerCase()] = TGN_USD;
  prices[BRUH.toLowerCase()] = BRUH_USD;
  prices[BURG.toLowerCase()] = BURG_USD;
  prices[EGP.toLowerCase()] = EGP_USD;

  const decimals = {};
  [BB,EB,AZUSD,WETH,MfT,POOP,TGN,BRUH,BURG,EGP].forEach(t => decimals[t.toLowerCase()] = 18);
  decimals[USDC.toLowerCase()] = 6;
  decimals[cbBTC.toLowerCase()] = 8;

  const K500 = ethers.parseUnits('500000', 18);
  const K50  = ethers.parseUnits('50000', 18);
  const K10  = ethers.parseUnits('10000', 18);

  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // ═══ APPROVALS ═══
  console.log('\n═══ APPROVALS ═══');
  for (const [tok,name] of [[BB,'BB'],[EB,'EB'],[USDC,'USDC']]) {
    await (await new ethers.Contract(tok, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit:60000})).wait();
    console.log(name + ' approved');
    await sleep(2000);
  }

  // Helper
  async function wall(label, tA, tB, sellToken, amt, list) {
    const [t0, t1] = order(tA, tB);
    const rp = rawPrice(t0, t1, prices, decimals);
    console.log('\n' + label + ' (raw=' + rp.toExponential(3) + ')');
    const {addr} = await createPool(factory, tA, tB, rp);
    console.log('Pool: ' + addr);
    const id = await sellWall(npm, addr, t0, t1, sellToken, amt, dl);
    console.log('NFT #' + id);
    list.push({id, label, addr});
    await sleep(2000);
  }

  // ═══ USDC REFS ═══
  console.log('\n═══ USDC REFS ═══');
  // BB/USDC
  let [t0,t1] = order(BB, USDC);
  let rp = rawPrice(t0, t1, prices, decimals);
  let {addr} = await createPool(factory, BB, USDC, rp);
  console.log('BB/USDC:', addr);
  let tx = await npm.mint({ token0:t0, token1:t1, fee:FEE, tickLower:-MAX_TICK, tickUpper:MAX_TICK,
    amount0Desired: t0===USDC ? 1000000n : ethers.parseUnits('1',18),
    amount1Desired: t1===USDC ? 1000000n : ethers.parseUnits('1',18),
    amount0Min:0, amount1Min:0, recipient:w.address, deadline:dl }, {gasLimit:2000000});
  let r = await tx.wait();
  let id = nftId(r);
  console.log('NFT #' + id);
  bbNfts.push({id, label:'BB/USDC', addr});
  await sleep(2000);

  // EB/USDC
  [t0,t1] = order(EB, USDC);
  rp = rawPrice(t0, t1, prices, decimals);
  ({addr} = await createPool(factory, EB, USDC, rp));
  console.log('EB/USDC:', addr);
  tx = await npm.mint({ token0:t0, token1:t1, fee:FEE, tickLower:-MAX_TICK, tickUpper:MAX_TICK,
    amount0Desired: t0===USDC ? 1000000n : ethers.parseUnits('1',18),
    amount1Desired: t1===USDC ? 1000000n : ethers.parseUnits('1',18),
    amount0Min:0, amount1Min:0, recipient:w.address, deadline:dl }, {gasLimit:2000000});
  r = await tx.wait();
  id = nftId(r);
  console.log('NFT #' + id);
  ebNfts.push({id, label:'EB/USDC', addr});
  await sleep(2000);

  // ═══ BAND WALLS 50% ═══
  console.log('\n═══ BAND WALLS 50% ═══');
  await wall('BB/cbBTC 500K', BB, cbBTC, BB, K500, bbNfts);
  await wall('WETH/EB 500K', WETH, EB, EB, K500, ebNfts);

  // ═══ AZUSD 5% ═══
  console.log('\n═══ AZUSD 5% ═══');
  await wall('AZUSD/BB 50K', AZUSD, BB, BB, K50, bbNfts);
  await wall('EB/AZUSD 50K', EB, AZUSD, EB, K50, ebNfts);

  // ═══ MfT 5% ═══
  console.log('\n═══ MfT 5% ═══');
  await wall('MfT/BB 50K', MfT, BB, BB, K50, bbNfts);
  await wall('EB/MfT 50K', EB, MfT, EB, K50, ebNfts);

  // ═══ BB/EB CROSS 5% (two NFTs) ═══
  console.log('\n═══ BB/EB CROSS 5% (2 NFTs) ═══');
  [t0,t1] = order(BB, EB);
  rp = rawPrice(t0, t1, prices, decimals);
  ({addr} = await createPool(factory, BB, EB, rp));
  console.log('BB/EB pool:', addr);
  // NFT 1 → BB reactor
  tx = await npm.mint({ token0:t0, token1:t1, fee:FEE, tickLower:-MAX_TICK, tickUpper:MAX_TICK,
    amount0Desired:K50, amount1Desired:K50, amount0Min:0, amount1Min:0,
    recipient:w.address, deadline:dl }, {gasLimit:2000000});
  r = await tx.wait(); id = nftId(r);
  console.log('Cross #1 NFT #' + id + ' → BB');
  bbNfts.push({id, label:'BB/EB cross', addr});
  await sleep(2000);
  // NFT 2 → EB reactor
  tx = await npm.mint({ token0:t0, token1:t1, fee:FEE, tickLower:-MAX_TICK, tickUpper:MAX_TICK,
    amount0Desired:K50, amount1Desired:K50, amount0Min:0, amount1Min:0,
    recipient:w.address, deadline:dl }, {gasLimit:2000000});
  r = await tx.wait(); id = nftId(r);
  console.log('Cross #2 NFT #' + id + ' → EB');
  ebNfts.push({id, label:'BB/EB cross', addr});
  await sleep(2000);

  // ═══ TGN 1% ═══
  console.log('\n═══ TGN 1% ═══');
  await wall('BB/TGN 10K', BB, TGN, BB, K10, bbNfts);
  await wall('EB/TGN 10K', EB, TGN, EB, K10, ebNfts);

  // ═══ POOP 1% ═══
  console.log('\n═══ POOP 1% ═══');
  await wall('POOP/BB 10K', POOP, BB, BB, K10, bbNfts);
  await wall('POOP/EB 10K', POOP, EB, EB, K10, ebNfts);

  // ═══ BRUH 1% ═══
  console.log('\n═══ BRUH 1% ═══');
  await wall('BB/BRUH 10K', BB, BRUH, BB, K10, bbNfts);
  await wall('EB/BRUH 10K', EB, BRUH, EB, K10, ebNfts);

  // ═══ BURGERS 1% ═══
  console.log('\n═══ BURGERS 1% ═══');
  await wall('BURG/BB 10K', BURG, BB, BB, K10, bbNfts);
  await wall('BURG/EB 10K', BURG, EB, EB, K10, ebNfts);

  // ═══ EGP 1% ═══
  console.log('\n═══ EGP 1% ═══');
  await wall('EGP/BB 10K', EGP, BB, BB, K10, bbNfts);
  await wall('EB/EGP 10K', EB, EGP, EB, K10, ebNfts);

  // ═══ DEPLOY REACTORS ═══
  console.log('\n═══ DEPLOY BB REACTOR ═══');
  const bbRxDeploy = await new ethers.ContractFactory(rxArtifact.abi, rxArtifact.bytecode, w).deploy({gasLimit:5000000});
  await bbRxDeploy.waitForDeployment();
  const BB_RX = await bbRxDeploy.getAddress();
  console.log('BB Reactor:', BB_RX);
  await sleep(3000);
  const bbRx = new ethers.Contract(BB_RX, RX_ABI, w);
  await (await bbRx.initialize(BB, MfT, NPM, ROUTER, V3F, BB_PRIME, {gasLimit:300000})).wait();
  console.log('Initialized → prime:', BB_PRIME);
  await sleep(2000);

  console.log('\n═══ DEPLOY EB REACTOR ═══');
  const ebRxDeploy = await new ethers.ContractFactory(rxArtifact.abi, rxArtifact.bytecode, w).deploy({gasLimit:5000000});
  await ebRxDeploy.waitForDeployment();
  const EB_RX = await ebRxDeploy.getAddress();
  console.log('EB Reactor:', EB_RX);
  await sleep(3000);
  const ebRx = new ethers.Contract(EB_RX, RX_ABI, w);
  await (await ebRx.initialize(EB, MfT, NPM, ROUTER, V3F, BB_PRIME, {gasLimit:300000})).wait();
  console.log('Initialized → prime:', BB_PRIME);
  await sleep(2000);

  // ═══ SEND NFTs ═══
  console.log('\n═══ SENDING ' + bbNfts.length + ' NFTs → BB REACTOR ═══');
  for (const nft of bbNfts) {
    try {
      await (await npm.safeTransferFrom(w.address, BB_RX, nft.id, {gasLimit:200000})).wait();
      await sleep(2000);
      await (await bbRx.addPool(nft.id, {gasLimit:200000})).wait();
      console.log(nft.label + ' #' + nft.id + ' ✓');
    } catch(e) { console.error(nft.label + ' #' + nft.id + ' FAIL:', e.message.slice(0,80)); }
    await sleep(2000);
  }

  console.log('\n═══ SENDING ' + ebNfts.length + ' NFTs → EB REACTOR ═══');
  for (const nft of ebNfts) {
    try {
      await (await npm.safeTransferFrom(w.address, EB_RX, nft.id, {gasLimit:200000})).wait();
      await sleep(2000);
      await (await ebRx.addPool(nft.id, {gasLimit:200000})).wait();
      console.log(nft.label + ' #' + nft.id + ' ✓');
    } catch(e) { console.error(nft.label + ' #' + nft.id + ' FAIL:', e.message.slice(0,80)); }
    await sleep(2000);
  }

  // ═══ SUMMARY ═══
  console.log('\n═══════════════════════════');
  console.log('BB:', BB);
  console.log('EB:', EB);
  console.log('BB Reactor:', BB_RX, 'pools:', (await new ethers.Contract(BB_RX,RX_ABI,p).poolCount()).toString());
  console.log('EB Reactor:', EB_RX, 'pools:', (await new ethers.Contract(EB_RX,RX_ABI,p).poolCount()).toString());
  console.log('Both feed → BB Prime:', BB_PRIME);
  console.log('');
  console.log('BB pools:');
  for (const n of bbNfts) console.log('  ' + n.label + ': ' + n.addr + ' #' + n.id);
  console.log('EB pools:');
  for (const n of ebNfts) console.log('  ' + n.label + ': ' + n.addr + ' #' + n.id);
  console.log('');
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
