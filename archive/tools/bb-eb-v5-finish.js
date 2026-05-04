const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const BB    = '0xf967bf3dccF8b6826F82de1781C98E61Bda3b106';
const EB    = '0x17a176Ab2379b86F1E65D79b03bD8c75981244D8';
const EGP   = '0xc1BA76771bbF0dD841347630E57c793F9d5ACcEe';
const MfT   = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F   = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const ROUTER= '0x2626664c2603336E57B271c5C0b26F421741e481';
const EB_PRIME = '0xC28e64551816535d9ef06CE95844F2b5317353bA';

const FEE = 10000, TS = 200, MAX_TICK = 887200;

const POOL  = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
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

// Already minted NFTs from the first run
const bbNfts = [
  { id: '5055820', label: 'BB/USDC' },
  { id: '5055825', label: 'BB/cbBTC 500K' },
  { id: '5055827', label: 'AZUSD/BB 50K' },
  { id: '5055833', label: 'MfT/BB 50K' },
  { id: '5055842', label: 'BB/EB cross' },
  { id: '5055845', label: 'BB/TGN 10K' },
  { id: '5055847', label: 'POOP/BB 10K' },
  { id: '5055849', label: 'BB/BRUH 10K' },
  { id: '5055853', label: 'BURG/BB 10K' },
  { id: '5055858', label: 'EGP/BB 10K' },
];
const ebNfts = [
  { id: '5055822', label: 'EB/USDC' },
  { id: '5055826', label: 'WETH/EB 500K' },
  { id: '5055829', label: 'EB/AZUSD 50K' },
  { id: '5055840', label: 'EB/MfT 50K' },
  { id: '5055844', label: 'BB/EB cross' },
  { id: '5055846', label: 'EB/TGN 10K' },
  { id: '5055848', label: 'POOP/EB 10K' },
  { id: '5055850', label: 'EB/BRUH 10K' },
  { id: '5055857', label: 'BURG/EB 10K' },
  // EB/EGP will be added below
];

async function main() {
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  const factory = new ethers.Contract(V3F, FACT, w);
  const dl = Math.floor(Date.now() / 1000) + 1200;
  const K10 = ethers.parseUnits('10000', 18);

  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  // === FINISH EB/EGP POOL ===
  // EB(0x17a1) < EGP(0xc1BA) => EB=t0, EGP=t1
  // raw = priceEB / priceEGP = 1.0 / 0.00024 = 4166.67
  console.log('\n=== EB/EGP 10K ===');
  const t0 = EB, t1 = EGP;
  const rp = 1.0 / 0.00024; // 4166.67
  console.log('raw=' + rp.toExponential(3));

  // Check if pool already exists
  let addr = await factory.getPool(t0, t1, FEE);
  if (addr === '0x0000000000000000000000000000000000000000') {
    await (await factory.createPool(t0, t1, FEE, {gasLimit: 5000000})).wait();
    await sleep(3000);
    addr = await factory.getPool(t0, t1, FEE);
    await (await new ethers.Contract(addr, POOL, w).initialize(sqrtP(rp), {gasLimit: 300000})).wait();
    await sleep(2000);
    console.log('Pool created:', addr);
  } else {
    console.log('Pool exists:', addr);
  }

  // Sell wall: EB is t0, sell EB above tick
  const [, tick] = await new ethers.Contract(addr, POOL, p).slot0();
  const t = Number(tick);
  const start = Math.ceil(t / TS) * TS + TS;
  console.log('tick:', t, 'wall [' + start + ', ' + MAX_TICK + ']');
  const tx = await npm.mint({ token0: t0, token1: t1, fee: FEE, tickLower: start, tickUpper: MAX_TICK,
    amount0Desired: K10, amount1Desired: 0n, amount0Min: 0, amount1Min: 0,
    recipient: w.address, deadline: dl }, {gasLimit: 2000000});
  const r = await tx.wait();
  const egpId = nftId(r);
  console.log('NFT #' + egpId);
  ebNfts.push({ id: egpId, label: 'EB/EGP 10K' });
  await sleep(3000);

  // === DEPLOY BB REACTOR ===
  console.log('\n=== DEPLOY BB REACTOR ===');
  const bbRxDeploy = await new ethers.ContractFactory(rxArtifact.abi, rxArtifact.bytecode, w).deploy({gasLimit:5000000});
  await bbRxDeploy.waitForDeployment();
  const BB_RX = await bbRxDeploy.getAddress();
  console.log('BB Reactor:', BB_RX);
  await sleep(3000);
  const bbRx = new ethers.Contract(BB_RX, RX_ABI, w);
  await (await bbRx.initialize(BB, MfT, NPM, ROUTER, V3F, EB_PRIME, {gasLimit:300000})).wait();
  console.log('Initialized -> prime:', EB_PRIME);
  await sleep(3000);

  // === DEPLOY EB REACTOR ===
  console.log('\n=== DEPLOY EB REACTOR ===');
  const ebRxDeploy = await new ethers.ContractFactory(rxArtifact.abi, rxArtifact.bytecode, w).deploy({gasLimit:5000000});
  await ebRxDeploy.waitForDeployment();
  const EB_RX = await ebRxDeploy.getAddress();
  console.log('EB Reactor:', EB_RX);
  await sleep(3000);
  const ebRx = new ethers.Contract(EB_RX, RX_ABI, w);
  await (await ebRx.initialize(EB, MfT, NPM, ROUTER, V3F, EB_PRIME, {gasLimit:300000})).wait();
  console.log('Initialized -> prime:', EB_PRIME);
  await sleep(3000);

  // === SEND NFTs TO BB REACTOR ===
  console.log('\n=== SENDING ' + bbNfts.length + ' NFTs -> BB REACTOR ===');
  for (const nft of bbNfts) {
    try {
      await (await npm.safeTransferFrom(w.address, BB_RX, nft.id, {gasLimit:200000})).wait();
      await sleep(2000);
      await (await bbRx.addPool(nft.id, {gasLimit:200000})).wait();
      console.log(nft.label + ' #' + nft.id + ' OK');
    } catch(e) { console.error(nft.label + ' #' + nft.id + ' FAIL:', e.message.slice(0,80)); }
    await sleep(2000);
  }

  // === SEND NFTs TO EB REACTOR ===
  console.log('\n=== SENDING ' + ebNfts.length + ' NFTs -> EB REACTOR ===');
  for (const nft of ebNfts) {
    try {
      await (await npm.safeTransferFrom(w.address, EB_RX, nft.id, {gasLimit:200000})).wait();
      await sleep(2000);
      await (await ebRx.addPool(nft.id, {gasLimit:200000})).wait();
      console.log(nft.label + ' #' + nft.id + ' OK');
    } catch(e) { console.error(nft.label + ' #' + nft.id + ' FAIL:', e.message.slice(0,80)); }
    await sleep(2000);
  }

  // === SUMMARY ===
  console.log('\n===========================');
  console.log('BB:', BB);
  console.log('EB:', EB);
  console.log('BB Reactor:', BB_RX, 'pools:', (await new ethers.Contract(BB_RX,RX_ABI,p).poolCount()).toString());
  console.log('EB Reactor:', EB_RX, 'pools:', (await new ethers.Contract(EB_RX,RX_ABI,p).poolCount()).toString());
  console.log('Both feed -> EB Prime:', EB_PRIME);
  console.log('Chain: new reactors -> EB(0xC28e) -> BB(0x84FB) -> MycoPad(0xF5B9)');
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
