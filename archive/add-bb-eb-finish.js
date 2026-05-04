/**
 * Finish: CHAR/EB (pool exists, just mint+add), TGN/BB+EB, AZUSD/BB+EB
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

const BB      = '0x4032bFe88eaeb0a9F5EBeFc14D66564DDf95CC29';
const EB      = '0x73B98EA6359b1289306e0E16ad8d32d088ea1cC8';
const CHAR    = '0x20b048fA035D5763685D695e66aDF62c5D9F5055';
const TGN     = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29';
const AZUSD   = '0x3595ca37596D5895B70EFAB592ac315D5B9809B2';

const CHAR_REACTOR    = '0xc2eBe90fB9bC7897f06DC00666951Fa9a49A397A';
const TGN_REACTOR     = '0xc3f09dAEF814177E52B4C04ec2872B564a36989D';
const AZUSD_REACTOR   = '0xD8AFb7caD1f8A3Ddc4E16c1516a94949eb119281';
const PM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

const PM_ABI = [
  'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
];
const REACTOR_ABI = ['function addPool(uint256 tokenId)'];
const ERC20_ABI = ['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'];

const pm = new ethers.Contract(PM, PM_ABI, wallet);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const e = ethers.parseEther;

function tickToSqrtPriceX96(tick) {
  const sqrtPrice = Math.pow(1.0001, tick / 2);
  const TWO_48 = 2 ** 48;
  return BigInt(Math.round(sqrtPrice * TWO_48)) * BigInt(Math.round(TWO_48));
}

async function mintAndAdd(token0, token1, amt0, amt1, reactorAddr, label) {
  console.log(`\n  Minting ${label} LP...`);
  const tx = await pm.mint({
    token0, token1, fee: 10000,
    tickLower: -887200, tickUpper: 887200,
    amount0Desired: amt0, amount1Desired: amt1,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now()/1000) + 600,
  });
  const rcpt = await tx.wait();
  const nftTopic = ethers.id('Transfer(address,address,uint256)');
  const xfer = rcpt.logs.find(l => l.address.toLowerCase() === PM.toLowerCase() && l.topics[0] === nftTopic);
  const tokenId = BigInt(xfer.topics[3]);
  console.log(`    NFT #${tokenId}: ${tx.hash}`);
  await sleep(2000);

  console.log(`  Transfer to reactor...`);
  const tx2 = await pm.safeTransferFrom(wallet.address, reactorAddr, tokenId);
  await tx2.wait();
  console.log(`    ${tx2.hash}`);
  await sleep(2000);

  console.log(`  addPool(${tokenId})...`);
  const reactor = new ethers.Contract(reactorAddr, REACTOR_ABI, wallet);
  const tx3 = await reactor.addPool(tokenId);
  await tx3.wait();
  console.log(`    ${tx3.hash}`);
  await sleep(1500);
  return tokenId;
}

async function createAndAdd(token0, token1, tick, amt0, amt1, reactorAddr, label) {
  console.log(`\n  Creating ${label} pool (tick ${tick})...`);
  const sqrtPriceX96 = tickToSqrtPriceX96(tick);
  const ctx = await pm.createAndInitializePoolIfNecessary(token0, token1, 10000, sqrtPriceX96);
  await ctx.wait();
  console.log(`    pool: ${ctx.hash}`);
  await sleep(2000);
  return mintAndAdd(token0, token1, amt0, amt1, reactorAddr, label);
}

async function main() {
  console.log('Agent:', wallet.address);

  // Ensure CHAR, TGN, AZUSD approved
  for (const [name, addr] of [['CHAR', CHAR], ['TGN', TGN], ['AZUSD', AZUSD]]) {
    const t = new ethers.Contract(addr, ERC20_ABI, wallet);
    const a = await t.allowance(wallet.address, PM);
    await sleep(500);
    if (a < e('10')) {
      console.log(`Approving ${name}...`);
      const tx = await t.approve(PM, ethers.MaxUint256);
      await tx.wait();
      await sleep(1000);
    }
  }

  // === CHAR/EB — pool already created, just mint ===
  console.log('\n=== CHAR/EB (pool exists) ===');
  // CHAR(0x20b0) < EB(0x73B9) → token0=CHAR, token1=EB
  // Use smaller amounts: 0.03 CHAR + 2 EB
  await mintAndAdd(CHAR, EB, e('0.03'), e('2'), CHAR_REACTOR, 'CHAR/EB');

  // === TGN REACTOR ===
  console.log('\n=== TGN REACTOR ===');
  // BB(0x4032) < TGN(0xD75d) → token0=BB, token1=TGN, tick=26800
  await createAndAdd(BB, TGN, 26800, e('0.5'), e('0.02'), TGN_REACTOR, 'BB/TGN');
  // EB(0x73B9) < TGN(0xD75d) → token0=EB, token1=TGN, tick=26800
  await createAndAdd(EB, TGN, 26800, e('0.5'), e('0.02'), TGN_REACTOR, 'EB/TGN');

  // === AZUSD REACTOR ===
  console.log('\n=== AZUSD REACTOR ===');
  // AZUSD(0x3595) < BB(0x4032) → token0=AZUSD, token1=BB, tick=-7400
  await createAndAdd(AZUSD, BB, -7400, e('1'), e('1'), AZUSD_REACTOR, 'AZUSD/BB');
  // AZUSD(0x3595) < EB(0x73B9) → token0=AZUSD, token1=EB, tick=-7400
  await createAndAdd(AZUSD, EB, -7400, e('1'), e('1'), AZUSD_REACTOR, 'AZUSD/EB');

  console.log('\n=== ALL DONE ===');
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
