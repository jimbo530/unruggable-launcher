const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BTV2 = '0x11DFE729F1211904efB99F4d4a3f9FAF6C93CCB5';
const ETV2 = '0xd7ac547B8a5d7756F36b593287431Bad7Feb7864';
const TGN  = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29';
const NPM  = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F  = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const BT_RX = '0x038B87f2Abc1dcE269FF7DE4d3e721b5b57eD8cf'; // v2 BTCband reactor
const ET_RX = '0xeB02d1137342cD08C1c4bf61C188d86C5253b631'; // v2 ETHband reactor

const FEE = 3000, TS = 60, MAX_TICK = 887220;
const K10 = ethers.parseUnits('10000', 18);
const K50 = ethers.parseUnits('50000', 18);

// Previously minted AZUSD wall NFTs (in wallet, need to go to reactors)
const AZUSD_BT_NFT = '5055262'; // BTCband_v2/AZUSD wall
const AZUSD_ET_NFT = '5055264'; // AZUSD/ETHband_v2 wall

const ERC20 = ['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'];
const FACT = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external'
];
const RX_ABI = ['function addPool(uint256 tokenId) external', 'function poolCount() view returns (uint256)'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function sqrtP(pr) { return BigInt(Math.floor(Math.sqrt(pr) * 79228162514264337593543950336)); }
function nftId(receipt) {
  const l = receipt.logs.find(x =>
    x.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    x.address.toLowerCase() === NPM.toLowerCase()
  );
  return l && l.topics.length >= 4 ? BigInt(l.topics[3]).toString() : 'unknown';
}

async function getOrCreatePool(factory, t0, t1, label) {
  let addr = await factory.getPool(t0, t1, FEE);
  if (addr === ethers.ZeroAddress) {
    console.log('Creating ' + label + '...');
    await (await factory.createPool(t0, t1, FEE, { gasLimit: 5000000 })).wait();
    await sleep(3000);
    addr = await factory.getPool(t0, t1, FEE);
    console.log('Pool:', addr);
    await (await new ethers.Contract(addr, POOL, w).initialize(sqrtP(1.0), { gasLimit: 300000 })).wait();
    console.log('Init at tick 0 ($1:$1)');
  } else { console.log(label + ' exists:', addr); }
  await sleep(2000);
  return addr;
}

async function main() {
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  const factory = new ethers.Contract(V3F, FACT, w);
  const dl = Math.floor(Date.now() / 1000) + 600;
  const sends = []; // {id, rx, label}

  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // Ensure approvals (BTV2 + ETV2 already approved from AZUSD walls)
  for (const [tok, lab] of [[BTV2,'BTV2'],[ETV2,'ETV2']]) {
    const al = await new ethers.Contract(tok, ERC20, w).allowance(w.address, NPM);
    if (al < K50) {
      console.log('Approving ' + lab + '...');
      await (await new ethers.Contract(tok, ERC20, w).approve(NPM, ethers.MaxUint256, {gasLimit:60000})).wait();
      await sleep(2000);
    }
  }

  // === 1. TGN SELL WALLS ===
  // BTV2(0x11DF) < TGN(0xD75d) → BTV2=token0, TGN=token1
  // Sell BTV2: token0 above tick → [TS, MAX_TICK]
  console.log('\n=== BTCband_v2 / TGN ===');
  const btTgnPool = await getOrCreatePool(factory, BTV2, TGN, 'BTV2/TGN');
  const [,btTgnTick] = await new ethers.Contract(btTgnPool, POOL, p).slot0();
  const btTgnStart = Math.ceil(Number(btTgnTick) / TS) * TS + TS;
  console.log('Wall [' + btTgnStart + ', ' + MAX_TICK + '] 10K BTV2');
  let tx = await npm.mint({
    token0: BTV2, token1: TGN, fee: FEE,
    tickLower: btTgnStart, tickUpper: MAX_TICK,
    amount0Desired: K10, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0, recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  let r = await tx.wait();
  let id = nftId(r);
  console.log('NFT #' + id);
  sends.push({id, rx: BT_RX, label: 'BTV2/TGN'});
  await sleep(2000);

  // TGN(0xD75d) < ETV2(0xd7ac)? 0xD75d vs 0xd7ac — need to check
  // 0xD75d < 0xd7ac → TGN=token0, ETV2=token1
  // Sell ETV2: token1 below tick → [-MAX_TICK, -TS]
  console.log('\n=== TGN / ETHband_v2 ===');
  const tgnEtPool = await getOrCreatePool(factory, TGN, ETV2, 'TGN/ETV2');
  const [,tgnEtTick] = await new ethers.Contract(tgnEtPool, POOL, p).slot0();
  const tgnEtEnd = Math.floor(Number(tgnEtTick) / TS) * TS - TS;
  console.log('Wall [-' + MAX_TICK + ', ' + tgnEtEnd + '] 10K ETV2');
  tx = await npm.mint({
    token0: TGN, token1: ETV2, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: tgnEtEnd,
    amount0Desired: 0n, amount1Desired: K10,
    amount0Min: 0, amount1Min: 0, recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  id = nftId(r);
  console.log('NFT #' + id);
  sends.push({id, rx: ET_RX, label: 'TGN/ETV2'});
  await sleep(2000);

  // === 2. CROSS-PAIR: BTV2 / ETV2 ===
  // BTV2(0x11DF) < ETV2(0xd7ac) → BTV2=token0, ETV2=token1
  console.log('\n=== BTCband_v2 / ETHband_v2 CROSS ===');
  const crossPool = await getOrCreatePool(factory, BTV2, ETV2, 'BTV2/ETV2');
  const [,crossTick] = await new ethers.Contract(crossPool, POOL, p).slot0();
  const ct = Number(crossTick);

  // 10K BTV2 sell wall above (token0 above)
  const crossAbove = Math.ceil(ct / TS) * TS + TS;
  console.log('BTV2 wall [' + crossAbove + ', ' + MAX_TICK + '] 10K');
  tx = await npm.mint({
    token0: BTV2, token1: ETV2, fee: FEE,
    tickLower: crossAbove, tickUpper: MAX_TICK,
    amount0Desired: K10, amount1Desired: 0n,
    amount0Min: 0, amount1Min: 0, recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  id = nftId(r);
  console.log('NFT #' + id);
  sends.push({id, rx: BT_RX, label: 'BTV2 wall in cross'});
  await sleep(2000);

  // 10K ETV2 sell wall below (token1 below)
  const crossBelow = Math.floor(ct / TS) * TS - TS;
  console.log('ETV2 wall [-' + MAX_TICK + ', ' + crossBelow + '] 10K');
  tx = await npm.mint({
    token0: BTV2, token1: ETV2, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: crossBelow,
    amount0Desired: 0n, amount1Desired: K10,
    amount0Min: 0, amount1Min: 0, recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  id = nftId(r);
  console.log('NFT #' + id);
  sends.push({id, rx: ET_RX, label: 'ETV2 wall in cross'});
  await sleep(2000);

  // Full range with remaining ~50K each
  console.log('Full range 50K+50K');
  tx = await npm.mint({
    token0: BTV2, token1: ETV2, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: MAX_TICK,
    amount0Desired: K50, amount1Desired: K50,
    amount0Min: 0, amount1Min: 0, recipient: w.address, deadline: dl
  }, {gasLimit: 2000000});
  r = await tx.wait();
  id = nftId(r);
  console.log('NFT #' + id);
  sends.push({id, rx: BT_RX, label: 'BTV2/ETV2 full range'});
  await sleep(2000);

  // === 3. SEND ALL TO REACTORS (including earlier AZUSD walls) ===
  // Add the AZUSD wall NFTs from earlier
  sends.unshift({id: AZUSD_BT_NFT, rx: BT_RX, label: 'BTV2/AZUSD wall'});
  sends.unshift({id: AZUSD_ET_NFT, rx: ET_RX, label: 'AZUSD/ETV2 wall'});

  console.log('\n=== SENDING ' + sends.length + ' NFTs TO REACTORS ===');
  for (const s of sends) {
    console.log(s.label + ' #' + s.id + ' → ' + (s.rx === BT_RX ? 'BTCband' : 'ETHband') + ' v2 Rx');
    try {
      await (await npm.safeTransferFrom(w.address, s.rx, s.id, {gasLimit: 200000})).wait();
      await sleep(1000);
      await (await new ethers.Contract(s.rx, RX_ABI, w).addPool(s.id, {gasLimit: 200000})).wait();
      console.log('  Added');
    } catch(e) { console.error('  FAILED:', e.message.slice(0,100)); }
    await sleep(1500);
  }

  const btCount = await new ethers.Contract(BT_RX, RX_ABI, p).poolCount();
  await sleep(500);
  const etCount = await new ethers.Contract(ET_RX, RX_ABI, p).poolCount();
  console.log('\nBTCband v2 Rx pools:', btCount.toString());
  console.log('ETHband v2 Rx pools:', etCount.toString());
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
