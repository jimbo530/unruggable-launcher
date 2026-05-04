/**
 * Final: finish TGN reactor (transfer BB/TGN + create EB/TGN) + AZUSD reactor
 * Uses explicit gasLimit to avoid estimation failures.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

const BB    = '0x4032bFe88eaeb0a9F5EBeFc14D66564DDf95CC29';
const EB    = '0x73B98EA6359b1289306e0E16ad8d32d088ea1cC8';
const TGN   = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29';
const AZUSD = '0x3595ca37596D5895B70EFAB592ac315D5B9809B2';

const TGN_REACTOR   = '0xc3f09dAEF814177E52B4C04ec2872B564a36989D';
const AZUSD_REACTOR = '0xD8AFb7caD1f8A3Ddc4E16c1516a94949eb119281';
const PM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

const PM_ABI = [
  'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
];
const REACTOR_ABI = ['function addPool(uint256 tokenId)'];

const pm = new ethers.Contract(PM, PM_ABI, wallet);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const e = ethers.parseEther;

function tickToSqrtPriceX96(tick) {
  const sqrtPrice = Math.pow(1.0001, tick / 2);
  const TWO_48 = 2 ** 48;
  return BigInt(Math.round(sqrtPrice * TWO_48)) * BigInt(Math.round(TWO_48));
}

async function transferAndAdd(tokenId, reactorAddr, label) {
  console.log(`  Transfer NFT #${tokenId} to ${label}...`);
  const tx1 = await pm.safeTransferFrom(wallet.address, reactorAddr, tokenId);
  await tx1.wait();
  console.log(`    ${tx1.hash}`);
  await sleep(2000);

  console.log(`  addPool(${tokenId})...`);
  const reactor = new ethers.Contract(reactorAddr, REACTOR_ABI, wallet);
  const tx2 = await reactor.addPool(tokenId);
  await tx2.wait();
  console.log(`    ${tx2.hash}`);
  await sleep(1500);
}

async function fullCreateMintAdd(token0, token1, tick, amt0, amt1, reactorAddr, label) {
  console.log(`\n  Creating ${label} pool (tick ${tick})...`);
  const sqrtPriceX96 = tickToSqrtPriceX96(tick);
  const ctx = await pm.createAndInitializePoolIfNecessary(token0, token1, 10000, sqrtPriceX96);
  await ctx.wait();
  console.log(`    pool: ${ctx.hash}`);
  await sleep(2000);

  console.log(`  Minting ${label} LP...`);
  const tx = await pm.mint({
    token0, token1, fee: 10000,
    tickLower: -887200, tickUpper: 887200,
    amount0Desired: amt0, amount1Desired: amt1,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now()/1000) + 600,
  }, { gasLimit: 800000 });
  const rcpt = await tx.wait();
  const nftTopic = ethers.id('Transfer(address,address,uint256)');
  const xfer = rcpt.logs.find(l => l.address.toLowerCase() === PM.toLowerCase() && l.topics[0] === nftTopic);
  const tokenId = BigInt(xfer.topics[3]);
  console.log(`    NFT #${tokenId}: ${tx.hash}`);
  await sleep(2000);

  await transferAndAdd(tokenId, reactorAddr, label);
  return tokenId;
}

async function main() {
  console.log('Agent:', wallet.address);

  // === TGN REACTOR: finish ===
  console.log('\n=== TGN: transfer BB/TGN NFT #5056430 ===');
  await transferAndAdd(5056430n, TGN_REACTOR, 'TGN reactor');

  console.log('\n=== TGN: create EB/TGN ===');
  // EB(0x73B9) < TGN(0xD75d) → token0=EB, token1=TGN, tick=26800
  await fullCreateMintAdd(EB, TGN, 26800, e('0.5'), e('0.02'), TGN_REACTOR, 'EB/TGN');

  // === AZUSD REACTOR ===
  console.log('\n=== AZUSD: create AZUSD/BB ===');
  // AZUSD(0x3595) < BB(0x4032) → token0=AZUSD, token1=BB, tick=-7400
  await fullCreateMintAdd(AZUSD, BB, -7400, e('1'), e('1'), AZUSD_REACTOR, 'AZUSD/BB');

  console.log('\n=== AZUSD: create AZUSD/EB ===');
  // AZUSD(0x3595) < EB(0x73B9) → token0=AZUSD, token1=EB, tick=-7400
  await fullCreateMintAdd(AZUSD, EB, -7400, e('1'), e('1'), AZUSD_REACTOR, 'AZUSD/EB');

  console.log('\n=== ALL DONE ===');
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
