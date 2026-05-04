/**
 * Add TOKEN/BB and TOKEN/EB pools to all chain reactors.
 * Creates pools on Uniswap V3, mints tiny full-range LPs,
 * transfers to reactors, calls addPool.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

// Token addresses
const BB      = '0x4032bFe88eaeb0a9F5EBeFc14D66564DDf95CC29';
const EB      = '0x73B98EA6359b1289306e0E16ad8d32d088ea1cC8';
const BURGERS = '0x06A05043eb2C1691b19c2C13219dB9212269dDc5';
const EGP     = '0xc1BA76771bbF0dD841347630E57c793F9d5ACcEe';
const CHAR    = '0x20b048fA035D5763685D695e66aDF62c5D9F5055';
const TGN     = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29';
const AZUSD   = '0x3595ca37596D5895B70EFAB592ac315D5B9809B2';

// Reactors
const BURGERS_REACTOR = '0xc858026Ec5D30280137032BC6EA86F46ea23C2CA';
const EGP_REACTOR     = '0x10A710fced92eB096F796F43BCCFb60884c13819';
const CHAR_REACTOR    = '0xc2eBe90fB9bC7897f06DC00666951Fa9a49A397A';
const TGN_REACTOR     = '0xc3f09dAEF814177E52B4C04ec2872B564a36989D';
const AZUSD_REACTOR   = '0xD8AFb7caD1f8A3Ddc4E16c1516a94949eb119281';

const PM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];
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

// Compute sqrtPriceX96 from tick
function tickToSqrtPriceX96(tick) {
  const sqrtPrice = Math.pow(1.0001, tick / 2);
  const TWO_48 = 2 ** 48;
  const val = sqrtPrice * TWO_48;
  return BigInt(Math.round(val)) * BigInt(Math.round(TWO_48));
}

// Sort token pair by address
function sortTokens(addrA, addrB) {
  if (addrA.toLowerCase() < addrB.toLowerCase()) return [addrA, addrB];
  return [addrB, addrA];
}

async function approveIfNeeded(name, tokenAddr) {
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
  const allowance = await token.allowance(wallet.address, PM);
  await sleep(300);
  if (allowance < ethers.parseEther('100000')) {
    console.log(`  Approving ${name}...`);
    const tx = await token.approve(PM, ethers.MaxUint256);
    await tx.wait();
    console.log(`    tx: ${tx.hash}`);
    await sleep(1000);
  }
}

async function createPoolAndMintLP(tokenAddr, tokenName, bandAddr, bandName, tick, tokenAmount, bandAmount, reactorAddr) {
  const [token0, token1] = sortTokens(tokenAddr, bandAddr);
  const isTokenFirst = token0.toLowerCase() === tokenAddr.toLowerCase();

  // The tick is for the pool where: if tokenAddr < bandAddr → token0=TOKEN, token1=BAND
  // We already computed ticks with correct ordering
  const sqrtPriceX96 = tickToSqrtPriceX96(tick);

  console.log(`\n  Creating ${tokenName}/${bandName} pool (tick ${tick})...`);
  const createTx = await pm.createAndInitializePoolIfNecessary(token0, token1, 10000, sqrtPriceX96);
  const createRcpt = await createTx.wait();
  console.log(`    pool created: ${createTx.hash} gas:${createRcpt.gasUsed}`);
  await sleep(2000);

  const amount0Desired = isTokenFirst ? tokenAmount : bandAmount;
  const amount1Desired = isTokenFirst ? bandAmount : tokenAmount;

  console.log(`  Minting LP (${ethers.formatEther(amount0Desired)} token0 + ${ethers.formatEther(amount1Desired)} token1)...`);
  const mintTx = await pm.mint({
    token0, token1,
    fee: 10000,
    tickLower: -887200,
    tickUpper: 887200,
    amount0Desired,
    amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now()/1000) + 600,
  });
  const mintRcpt = await mintTx.wait();

  const nftTopic = ethers.id('Transfer(address,address,uint256)');
  const transfer = mintRcpt.logs.find(l => l.address.toLowerCase() === PM.toLowerCase() && l.topics[0] === nftTopic);
  const tokenId = BigInt(transfer.topics[3]);
  console.log(`    minted NFT #${tokenId}: ${mintTx.hash}`);
  await sleep(2000);

  console.log(`  Transferring NFT #${tokenId} to reactor ${reactorAddr.slice(0,8)}...`);
  const xferTx = await pm.safeTransferFrom(wallet.address, reactorAddr, tokenId);
  await xferTx.wait();
  console.log(`    transferred: ${xferTx.hash}`);
  await sleep(2000);

  console.log(`  Calling addPool(${tokenId})...`);
  const reactor = new ethers.Contract(reactorAddr, REACTOR_ABI, wallet);
  const addTx = await reactor.addPool(tokenId);
  await addTx.wait();
  console.log(`    added: ${addTx.hash}`);
  await sleep(1000);

  return tokenId;
}

async function main() {
  console.log('Agent:', wallet.address);

  // Approve all tokens to PM
  console.log('\n=== Approvals ===');
  await approveIfNeeded('BURGERS', BURGERS);
  await approveIfNeeded('EGP', EGP);
  await approveIfNeeded('CHAR', CHAR);
  await approveIfNeeded('TGN', TGN);
  await approveIfNeeded('AZUSD', AZUSD);
  await approveIfNeeded('BB', BB);
  await approveIfNeeded('EB', EB);

  const e = ethers.parseEther;

  // ========== BURGERS REACTOR ==========
  console.log('\n=== BURGERS REACTOR (0xc858) ===');
  // BURGERS(0x06A0) < BB(0x4032) → token0=BURGERS, token1=BB, tick=-147200
  // BURGERS(0x06A0) < EB(0x73B9) → token0=BURGERS, token1=EB, tick=-147200
  await createPoolAndMintLP(BURGERS, 'BURG', BB, 'BB', -147200, e('100'), e('1'), BURGERS_REACTOR);
  await createPoolAndMintLP(BURGERS, 'BURG', EB, 'EB', -147200, e('100'), e('1'), BURGERS_REACTOR);

  // ========== EGP REACTOR ==========
  console.log('\n=== EGP REACTOR (0x10A7) ===');
  // BB(0x4032) < EGP(0xc1BA) → token0=BB, token1=EGP, tick=90600
  // EB(0x73B9) < EGP(0xc1BA) → token0=EB, token1=EGP, tick=90600
  await createPoolAndMintLP(EGP, 'EGP', BB, 'BB', 90600, e('0.05'), e('0.05'), EGP_REACTOR);
  await createPoolAndMintLP(EGP, 'EGP', EB, 'EB', 90600, e('0.05'), e('0.05'), EGP_REACTOR);

  // ========== CHAR REACTOR ==========
  console.log('\n=== CHAR REACTOR (0xc2eB) ===');
  // CHAR(0x20b0) < BB(0x4032) → token0=CHAR, token1=BB, tick=45200
  // CHAR(0x20b0) < EB(0x73B9) → token0=CHAR, token1=EB, tick=45200
  await createPoolAndMintLP(CHAR, 'CHAR', BB, 'BB', 45200, e('0.05'), e('5'), CHAR_REACTOR);
  await createPoolAndMintLP(CHAR, 'CHAR', EB, 'EB', 45200, e('0.05'), e('5'), CHAR_REACTOR);

  // ========== TGN REACTOR ==========
  console.log('\n=== TGN REACTOR (0xc3f0) ===');
  // BB(0x4032) < TGN(0xD75d) → token0=BB, token1=TGN, tick=26800
  // EB(0x73B9) < TGN(0xD75d) → token0=EB, token1=TGN, tick=26800
  await createPoolAndMintLP(TGN, 'TGN', BB, 'BB', 26800, e('0.02'), e('0.5'), TGN_REACTOR);
  await createPoolAndMintLP(TGN, 'TGN', EB, 'EB', 26800, e('0.02'), e('0.5'), TGN_REACTOR);

  // ========== AZUSD REACTOR ==========
  console.log('\n=== AZUSD REACTOR (0xD8AF) ===');
  // AZUSD(0x3595) < BB(0x4032) → token0=AZUSD, token1=BB, tick=-7400
  // AZUSD(0x3595) < EB(0x73B9) → token0=AZUSD, token1=EB, tick=-7400
  await createPoolAndMintLP(AZUSD, 'AZUSD', BB, 'BB', -7400, e('1'), e('1'), AZUSD_REACTOR);
  await createPoolAndMintLP(AZUSD, 'AZUSD', EB, 'EB', -7400, e('1'), e('1'), AZUSD_REACTOR);

  console.log('\n=== ALL DONE ===');
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
