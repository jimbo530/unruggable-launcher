/**
 * Continue adding TOKEN/BB and TOKEN/EB pools — from EGP/EB onwards.
 * Adds explicit nonce management to avoid conflicts.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

const BB      = '0x4032bFe88eaeb0a9F5EBeFc14D66564DDf95CC29';
const EB      = '0x73B98EA6359b1289306e0E16ad8d32d088ea1cC8';
const EGP     = '0xc1BA76771bbF0dD841347630E57c793F9d5ACcEe';
const CHAR    = '0x20b048fA035D5763685D695e66aDF62c5D9F5055';
const TGN     = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29';
const AZUSD   = '0x3595ca37596D5895B70EFAB592ac315D5B9809B2';

const EGP_REACTOR     = '0x10A710fced92eB096F796F43BCCFb60884c13819';
const CHAR_REACTOR    = '0xc2eBe90fB9bC7897f06DC00666951Fa9a49A397A';
const TGN_REACTOR     = '0xc3f09dAEF814177E52B4C04ec2872B564a36989D';
const AZUSD_REACTOR   = '0xD8AFb7caD1f8A3Ddc4E16c1516a94949eb119281';

const PM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

const PM_ABI = [
  'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
];
const REACTOR_ABI = [
  'function addPool(uint256 tokenId)',
  'function poolCount() view returns (uint256)',
];

const pm = new ethers.Contract(PM, PM_ABI, wallet);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let currentNonce;

function tickToSqrtPriceX96(tick) {
  const sqrtPrice = Math.pow(1.0001, tick / 2);
  const TWO_48 = 2 ** 48;
  return BigInt(Math.round(sqrtPrice * TWO_48)) * BigInt(Math.round(TWO_48));
}

function sortTokens(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

async function sendTx(fn) {
  const nonce = currentNonce++;
  const tx = await fn({ nonce });
  const rcpt = await tx.wait();
  return { tx, rcpt };
}

async function createPoolMintAndAdd(tokenAddr, tokenName, bandAddr, bandName, tick, tokenAmt, bandAmt, reactorAddr) {
  const [token0, token1] = sortTokens(tokenAddr, bandAddr);
  const isTokenFirst = token0.toLowerCase() === tokenAddr.toLowerCase();
  const sqrtPriceX96 = tickToSqrtPriceX96(tick);

  console.log(`\n  Creating ${tokenName}/${bandName} pool (tick ${tick})...`);
  const { tx: ct } = await sendTx(opts => pm.createAndInitializePoolIfNecessary(token0, token1, 10000, sqrtPriceX96, opts));
  console.log(`    pool: ${ct.hash}`);
  await sleep(1000);

  const a0 = isTokenFirst ? tokenAmt : bandAmt;
  const a1 = isTokenFirst ? bandAmt : tokenAmt;
  console.log(`  Minting LP...`);
  const { tx: mt, rcpt: mr } = await sendTx(opts => pm.mint({
    token0, token1, fee: 10000,
    tickLower: -887200, tickUpper: 887200,
    amount0Desired: a0, amount1Desired: a1,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now()/1000) + 600,
  }, opts));

  const nftTopic = ethers.id('Transfer(address,address,uint256)');
  const xfer = mr.logs.find(l => l.address.toLowerCase() === PM.toLowerCase() && l.topics[0] === nftTopic);
  const tokenId = BigInt(xfer.topics[3]);
  console.log(`    NFT #${tokenId}: ${mt.hash}`);
  await sleep(1000);

  console.log(`  Transfer to reactor...`);
  const { tx: t1 } = await sendTx(opts => pm.safeTransferFrom(wallet.address, reactorAddr, tokenId, opts));
  console.log(`    ${t1.hash}`);
  await sleep(1000);

  console.log(`  addPool(${tokenId})...`);
  const reactor = new ethers.Contract(reactorAddr, REACTOR_ABI, wallet);
  const { tx: t2 } = await sendTx(opts => reactor.addPool(tokenId, opts));
  console.log(`    ${t2.hash}`);
  await sleep(1000);

  return tokenId;
}

const e = ethers.parseEther;

async function main() {
  console.log('Agent:', wallet.address);
  currentNonce = await provider.getTransactionCount(wallet.address);
  console.log('Starting nonce:', currentNonce);

  // === EGP/EB (BB/EGP was done, this is EB/EGP) ===
  console.log('\n=== EGP/EB ===');
  // EB(0x73B9) < EGP(0xc1BA) → token0=EB, token1=EGP, tick=90600
  await createPoolMintAndAdd(EGP, 'EGP', EB, 'EB', 90600, e('0.05'), e('0.05'), EGP_REACTOR);

  // === CHAR REACTOR ===
  console.log('\n=== CHAR REACTOR ===');
  // CHAR(0x20b0) < BB(0x4032) → token0=CHAR, token1=BB, tick=45200
  await createPoolMintAndAdd(CHAR, 'CHAR', BB, 'BB', 45200, e('0.05'), e('5'), CHAR_REACTOR);
  // CHAR(0x20b0) < EB(0x73B9) → token0=CHAR, token1=EB, tick=45200
  await createPoolMintAndAdd(CHAR, 'CHAR', EB, 'EB', 45200, e('0.05'), e('5'), CHAR_REACTOR);

  // === TGN REACTOR ===
  console.log('\n=== TGN REACTOR ===');
  // BB(0x4032) < TGN(0xD75d) → token0=BB, token1=TGN, tick=26800
  await createPoolMintAndAdd(TGN, 'TGN', BB, 'BB', 26800, e('0.02'), e('0.5'), TGN_REACTOR);
  // EB(0x73B9) < TGN(0xD75d) → token0=EB, token1=TGN, tick=26800
  await createPoolMintAndAdd(TGN, 'TGN', EB, 'EB', 26800, e('0.02'), e('0.5'), TGN_REACTOR);

  // === AZUSD REACTOR ===
  console.log('\n=== AZUSD REACTOR ===');
  // AZUSD(0x3595) < BB(0x4032) → token0=AZUSD, token1=BB, tick=-7400
  await createPoolMintAndAdd(AZUSD, 'AZUSD', BB, 'BB', -7400, e('1'), e('1'), AZUSD_REACTOR);
  // AZUSD(0x3595) < EB(0x73B9) → token0=AZUSD, token1=EB, tick=-7400
  await createPoolMintAndAdd(AZUSD, 'AZUSD', EB, 'EB', -7400, e('1'), e('1'), AZUSD_REACTOR);

  console.log('\n=== ALL DONE ===');
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
