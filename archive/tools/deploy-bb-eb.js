const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NPM  = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const SUPPLY = ethers.parseUnits('1000000', 18);
const BB_LP = ethers.parseUnits('10', 18);       // 10 BB
const EB_LP = ethers.parseUnits('10', 18);       // 10 EB
const USDC_LP = 10000000n;                        // $10 USDC (6 dec)
const FEE = 3000;
const TS = 60;
const MAX_TICK = 887220;

const ERC20 = ['function approve(address,uint256) returns (bool)'];
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)', 'function createPool(address,address,uint24) returns (address)'];
const POOL_ABI = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// sqrtPriceX96 for a price ratio accounting for decimal difference
function sqrtPriceX96(price) {
  return BigInt(Math.floor(Math.sqrt(price) * 79228162514264337593543950336));
}

function extractNftId(receipt) {
  const log = receipt.logs.find(l =>
    l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    l.address.toLowerCase() === NPM.toLowerCase()
  );
  return log && log.topics.length >= 4 ? BigInt(log.topics[3]).toString() : 'unknown';
}

async function main() {
  console.log('Wallet:', wallet.address);
  console.log('ETH:', ethers.formatEther(await provider.getBalance(wallet.address)));

  // ═══ STEP 1: Deploy BB ═══
  console.log('\n═══ Deploy BB ═══');
  const artifact = require('../artifacts/contracts/LaunchToken.sol/LaunchToken.json');
  const bbFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const bbDeploy = await bbFactory.deploy('BB', 'BB', SUPPLY, wallet.address);
  await bbDeploy.waitForDeployment();
  const BB = await bbDeploy.getAddress();
  console.log('BB:', BB);
  await sleep(3000);

  // ═══ STEP 2: Deploy EB ═══
  console.log('\n═══ Deploy EB ═══');
  const ebFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const ebDeploy = await ebFactory.deploy('EB', 'EB', SUPPLY, wallet.address);
  await ebDeploy.waitForDeployment();
  const EB = await ebDeploy.getAddress();
  console.log('EB:', EB);
  await sleep(3000);

  // ═══ STEP 3: Create USDC pools ═══
  console.log('\n═══ Create USDC Pools (fee=3000) ═══');
  const factory = new ethers.Contract(V3FACTORY, FACTORY_ABI, wallet);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  // Approvals
  console.log('Approving...');
  await (await new ethers.Contract(BB, ERC20, wallet).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(1000);
  await (await new ethers.Contract(EB, ERC20, wallet).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(1000);
  await (await new ethers.Contract(USDC, ERC20, wallet).approve(NPM, ethers.MaxUint256, {gasLimit: 60000})).wait();
  await sleep(2000);

  // BB/USDC pool
  // Token ordering: compare addresses
  const bbIsToken0 = BB.toLowerCase() < USDC.toLowerCase();
  const [bbT0, bbT1] = bbIsToken0 ? [BB, USDC] : [USDC, BB];
  // Price: at $1, 1 token(18dec) = 1 USDC(6dec)
  // If token(18)=token0, USDC(6)=token1: price = 1e6/1e18 = 1e-12
  // If USDC(6)=token0, token(18)=token1: price = 1e18/1e6 = 1e12
  const bbPrice = bbIsToken0 ? 1e-12 : 1e12;
  const [bbAmt0, bbAmt1] = bbIsToken0 ? [BB_LP, USDC_LP] : [USDC_LP, BB_LP];

  console.log('\nBB/USDC: BB is token' + (bbIsToken0 ? '0' : '1'));
  console.log('Creating pool...');
  await (await factory.createPool(bbT0, bbT1, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  const bbPool = await factory.getPool(bbT0, bbT1, FEE);
  console.log('Pool:', bbPool);
  await (await new ethers.Contract(bbPool, POOL_ABI, wallet).initialize(sqrtPriceX96(bbPrice), {gasLimit: 300000})).wait();
  console.log('Initialized at $1');
  await sleep(2000);

  console.log('Minting LP (10 BB + $10 USDC)...');
  const tx1 = await npm.mint({
    token0: bbT0, token1: bbT1, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: MAX_TICK,
    amount0Desired: bbAmt0, amount1Desired: bbAmt1,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
  }, {gasLimit: 2000000});
  const r1 = await tx1.wait();
  console.log('BB/USDC NFT #' + extractNftId(r1));
  await sleep(2000);

  // EB/USDC pool
  const ebIsToken0 = EB.toLowerCase() < USDC.toLowerCase();
  const [ebT0, ebT1] = ebIsToken0 ? [EB, USDC] : [USDC, EB];
  const ebPrice = ebIsToken0 ? 1e-12 : 1e12;
  const [ebAmt0, ebAmt1] = ebIsToken0 ? [EB_LP, USDC_LP] : [USDC_LP, EB_LP];

  console.log('\nEB/USDC: EB is token' + (ebIsToken0 ? '0' : '1'));
  console.log('Creating pool...');
  await (await factory.createPool(ebT0, ebT1, FEE, {gasLimit: 5000000})).wait();
  await sleep(3000);
  const ebPool = await factory.getPool(ebT0, ebT1, FEE);
  console.log('Pool:', ebPool);
  await (await new ethers.Contract(ebPool, POOL_ABI, wallet).initialize(sqrtPriceX96(ebPrice), {gasLimit: 300000})).wait();
  console.log('Initialized at $1');
  await sleep(2000);

  console.log('Minting LP (10 EB + $10 USDC)...');
  const tx2 = await npm.mint({
    token0: ebT0, token1: ebT1, fee: FEE,
    tickLower: -MAX_TICK, tickUpper: MAX_TICK,
    amount0Desired: ebAmt0, amount1Desired: ebAmt1,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline
  }, {gasLimit: 2000000});
  const r2 = await tx2.wait();
  console.log('EB/USDC NFT #' + extractNftId(r2));

  console.log('\n═══ DONE ═══');
  console.log('BB:', BB);
  console.log('EB:', EB);
  console.log('BB/USDC pool:', bbPool);
  console.log('EB/USDC pool:', ebPool);
  console.log('ETH left:', ethers.formatEther(await provider.getBalance(wallet.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
