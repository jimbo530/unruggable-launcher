/**
 * Add MfT/BB and MfT/EB pools to V1 Prime reactor
 * Pools already exist — just mint tiny LPs, transfer, addPool
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

// Addresses
const MFT  = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const BB   = '0x4032bFe88eaeb0a9F5EBeFc14D66564DDf95CC29';
const EB   = '0x73B98EA6359b1289306e0E16ad8d32d088ea1cC8';
const PM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V1PRIME = '0xed3aE91b2bb22307c07438EEebA2500C18EABcFE';

const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];
const PM_ABI = [
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
];
const REACTOR_ABI = [
  'function addPool(uint256 tokenId)',
  'function poolCount() view returns (uint256)',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('Agent:', wallet.address);

  const pm = new ethers.Contract(PM, PM_ABI, wallet);
  const reactor = new ethers.Contract(V1PRIME, REACTOR_ABI, wallet);

  // Step 1: Approve tokens to PM (max approve if needed)
  const MAX = ethers.MaxUint256;
  for (const [name, addr] of [['MfT', MFT], ['BB', BB], ['EB', EB]]) {
    const token = new ethers.Contract(addr, ERC20_ABI, wallet);
    const allowance = await token.allowance(wallet.address, PM);
    await sleep(500);
    if (allowance < ethers.parseEther('1000')) {
      console.log(`Approving ${name} to PM...`);
      const tx = await token.approve(PM, MAX);
      await tx.wait();
      console.log(`  approved: ${tx.hash}`);
      await sleep(1000);
    } else {
      console.log(`${name} already approved`);
    }
  }

  // Step 2: Mint MfT/BB LP
  // BB (0x4032) < MfT (0x8FB8) → token0=BB, token1=MfT
  console.log('\nMinting MfT/BB full-range LP...');
  const mintBB = await pm.mint({
    token0: BB,
    token1: MFT,
    fee: 10000,
    tickLower: -887200,
    tickUpper: 887200,
    amount0Desired: ethers.parseEther('0.001'),   // 0.001 BB
    amount1Desired: ethers.parseEther('100'),      // 100 MfT
    amount0Min: 0,
    amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now()/1000) + 600,
  });
  const rcptBB = await mintBB.wait();
  // Parse tokenId from IncreaseLiquidity event or Transfer event
  const nftTransferTopic = ethers.id('Transfer(address,address,uint256)');
  const bbTransfer = rcptBB.logs.find(l => l.address.toLowerCase() === PM.toLowerCase() && l.topics[0] === nftTransferTopic);
  const bbTokenId = BigInt(bbTransfer.topics[3]);
  console.log(`  MfT/BB LP minted: NFT #${bbTokenId} tx:${mintBB.hash}`);
  await sleep(2000);

  // Step 3: Mint MfT/EB LP
  // EB (0x73B9) < MfT (0x8FB8) → token0=EB, token1=MfT
  console.log('Minting MfT/EB full-range LP...');
  const mintEB = await pm.mint({
    token0: EB,
    token1: MFT,
    fee: 10000,
    tickLower: -887200,
    tickUpper: 887200,
    amount0Desired: ethers.parseEther('0.001'),   // 0.001 EB
    amount1Desired: ethers.parseEther('100'),      // 100 MfT
    amount0Min: 0,
    amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now()/1000) + 600,
  });
  const rcptEB = await mintEB.wait();
  const ebTransfer = rcptEB.logs.find(l => l.address.toLowerCase() === PM.toLowerCase() && l.topics[0] === nftTransferTopic);
  const ebTokenId = BigInt(ebTransfer.topics[3]);
  console.log(`  MfT/EB LP minted: NFT #${ebTokenId} tx:${mintEB.hash}`);
  await sleep(2000);

  // Step 4: Transfer NFTs to V1 Prime and addPool
  console.log(`\nTransferring NFT #${bbTokenId} to V1 Prime...`);
  const tx1 = await pm.safeTransferFrom(wallet.address, V1PRIME, bbTokenId);
  await tx1.wait();
  console.log(`  transferred: ${tx1.hash}`);
  await sleep(2000);

  console.log(`Calling addPool(${bbTokenId})...`);
  const tx2 = await reactor.addPool(bbTokenId);
  await tx2.wait();
  console.log(`  added: ${tx2.hash}`);
  await sleep(2000);

  console.log(`\nTransferring NFT #${ebTokenId} to V1 Prime...`);
  const tx3 = await pm.safeTransferFrom(wallet.address, V1PRIME, ebTokenId);
  await tx3.wait();
  console.log(`  transferred: ${tx3.hash}`);
  await sleep(2000);

  console.log(`Calling addPool(${ebTokenId})...`);
  const tx4 = await reactor.addPool(ebTokenId);
  await tx4.wait();
  console.log(`  added: ${tx4.hash}`);

  const count = await reactor.poolCount();
  console.log(`\nV1 Prime now has ${count} pools`);
  console.log('DONE');
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
