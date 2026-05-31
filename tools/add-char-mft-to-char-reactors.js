/**
 * Add CHAR/MfT pools to all CHAR reactors.
 * Pool already exists on Uniswap V3 (1% fee): 0x25ADdFab07b3A4aEDf38117a471c4E5f84366Fe7
 * Mints tiny full-range LP positions, transfers to each reactor, calls addPool.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

// Tokens (CHAR < MfT by address, so CHAR=token0, MfT=token1)
const CHAR = '0x20b048fA035D5763685D695e66aDF62c5D9F5055';
const MFT  = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';

// Position Manager (Uniswap V3 on Base)
const PM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

// All CHAR reactors: 9 per-launch + 1 standalone
const CHAR_REACTORS = [
  { name: 'Myco',    addr: '0x4618fB5b9914BEEF00C22A1082dCdC4064dcA8c3' },
  { name: 'RT',      addr: '0x230a642e12b5Fabb4F4A99789a152548b39a1BE9' },
  { name: 'BP',      addr: '0x22988bCB84e635c79F570711ea5477C548140a0d' },
  { name: 'bAGI',    addr: '0xbB6Ec399365a8E64ab7d5f7162aE19B441cbEcba' },
  { name: 'Turtle',  addr: '0x707d226a67CE96aaD18f3594e08d868bc43D388c' },
  { name: 'Flowers', addr: '0xfb3B709882a48b185F266Fc6f37156A92771a558' },
  { name: 'NMB',     addr: '0x3C69C3d620616b6840c65145eCbCf7e45CAdf241' },
  { name: 'MR',      addr: '0x15FFF1286807FA96b4CaC8B9Bc262A492494c6D8' },
  { name: 'NFS',     addr: '0x2eE4029E8d83d80B01B9CD7C0a4EE81e584b87e9' },
  { name: 'Standalone', addr: '0xc2eBe90fB9bC7897f06DC00666951Fa9a49A397A' },
];

const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];
const PM_ABI = [
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
];
const REACTOR_ABI = [
  'function addPool(uint256 tokenId)',
  'function poolCount() view returns (uint256)',
];

const pm = new ethers.Contract(PM, PM_ABI, wallet);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function approveIfNeeded(name, tokenAddr) {
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
  const allowance = await token.allowance(wallet.address, PM);
  if (allowance < ethers.parseEther('1000000')) {
    console.log(`  Approving ${name} to PM...`);
    const tx = await token.approve(PM, ethers.MaxUint256);
    await tx.wait();
    console.log(`    tx: ${tx.hash}`);
    await sleep(1000);
  } else {
    console.log(`  ${name} already approved`);
  }
}

async function mintTransferAdd(reactor) {
  const charAmount = ethers.parseEther('0.001');
  const mftAmount  = ethers.parseEther('700000'); // ~0.001 CHAR worth at current price, with buffer

  console.log(`\n  Minting CHAR/MfT LP for ${reactor.name}...`);
  const mintTx = await pm.mint({
    token0: CHAR,
    token1: MFT,
    fee: 10000,
    tickLower: -887200,
    tickUpper: 887200,
    amount0Desired: charAmount,
    amount1Desired: mftAmount,
    amount0Min: 0,
    amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 600,
  });
  const receipt = await mintTx.wait();

  const nftTopic = ethers.id('Transfer(address,address,uint256)');
  const transfer = receipt.logs.find(l =>
    l.address.toLowerCase() === PM.toLowerCase() && l.topics[0] === nftTopic
  );
  const tokenId = BigInt(transfer.topics[3]);
  console.log(`    minted NFT #${tokenId}: ${mintTx.hash}`);
  await sleep(2000);

  console.log(`  Transferring NFT #${tokenId} to ${reactor.name} (${reactor.addr.slice(0,8)})...`);
  const xferTx = await pm.safeTransferFrom(wallet.address, reactor.addr, tokenId);
  await xferTx.wait();
  console.log(`    transferred: ${xferTx.hash}`);
  await sleep(2000);

  console.log(`  addPool(${tokenId})...`);
  const reactorContract = new ethers.Contract(reactor.addr, REACTOR_ABI, wallet);
  const addTx = await reactorContract.addPool(tokenId);
  await addTx.wait();
  const count = await reactorContract.poolCount();
  console.log(`    added: ${addTx.hash} (pool count now: ${count})`);
  await sleep(1000);

  return tokenId;
}

async function main() {
  console.log('Agent:', wallet.address);

  // Check balances
  const char = new ethers.Contract(CHAR, ERC20_ABI, provider);
  const mft  = new ethers.Contract(MFT, ERC20_ABI, provider);
  const [charBal, mftBal] = await Promise.all([char.balanceOf(wallet.address), mft.balanceOf(wallet.address)]);
  console.log('CHAR balance:', ethers.formatEther(charBal));
  console.log('MfT balance:', ethers.formatEther(mftBal));

  const needed = ethers.parseEther('0.01'); // 0.001 x 10
  if (charBal < needed) {
    console.error(`Not enough CHAR. Need 0.01, have ${ethers.formatEther(charBal)}`);
    process.exit(1);
  }

  // Approvals
  console.log('\n=== Approvals ===');
  await approveIfNeeded('CHAR', CHAR);
  await approveIfNeeded('MfT', MFT);

  // Process each reactor
  const results = [];
  for (const reactor of CHAR_REACTORS) {
    console.log(`\n=== ${reactor.name} CHAR Reactor (${reactor.addr.slice(0,8)}) ===`);
    try {
      const tokenId = await mintTransferAdd(reactor);
      results.push({ name: reactor.name, tokenId: tokenId.toString(), status: 'OK' });
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      results.push({ name: reactor.name, tokenId: null, status: err.message });
    }
  }

  console.log('\n=== RESULTS ===');
  for (const r of results) {
    console.log(`  ${r.name}: ${r.status}${r.tokenId ? ' (NFT #' + r.tokenId + ')' : ''}`);
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
