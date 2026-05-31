/**
 * Add CHAR/MfT pools to V5.2 CHAR reactors via factory.addPoolToReactor().
 * Factory is admin on these reactors, so NFT transfer must go through factory.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

const CHAR = '0x20b048fA035D5763685D695e66aDF62c5D9F5055';
const MFT  = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const PM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const FACTORY = '0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51';

const REACTORS = [
  { name: 'Myco',   addr: '0x4618fB5b9914BEEF00C22A1082dCdC4064dcA8c3' },
  { name: 'RT',     addr: '0x230a642e12b5Fabb4F4A99789a152548b39a1BE9' },
  { name: 'BP',     addr: '0x22988bCB84e635c79F570711ea5477C548140a0d' },
  { name: 'bAGI',   addr: '0xbB6Ec399365a8E64ab7d5f7162aE19B441cbEcba' },
  { name: 'Turtle', addr: '0x707d226a67CE96aaD18f3594e08d868bc43D388c' },
];

const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];
const PM_ABI = [
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function approve(address to, uint256 tokenId)',
];
const FACTORY_ABI = [
  'function addPoolToReactor(address reactor, uint256 tokenId)',
  'function owner() view returns (address)',
];
const REACTOR_ABI = ['function poolCount() view returns (uint256)'];

const pm = new ethers.Contract(PM, PM_ABI, wallet);
const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('Agent:', wallet.address);

  // Verify we own the factory
  const owner = await factory.owner();
  console.log('Factory owner:', owner);
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error('We do not own the V5.2 factory!');
    process.exit(1);
  }

  // Check balances
  const char = new ethers.Contract(CHAR, ERC20_ABI, provider);
  const mft  = new ethers.Contract(MFT, ERC20_ABI, provider);
  const [charBal, mftBal] = await Promise.all([char.balanceOf(wallet.address), mft.balanceOf(wallet.address)]);
  console.log('CHAR:', ethers.formatEther(charBal));
  console.log('MfT:', ethers.formatEther(mftBal));

  // Approve CHAR + MfT to PM (for minting)
  console.log('\n=== Approvals ===');
  const charToken = new ethers.Contract(CHAR, ERC20_ABI, wallet);
  const mftToken  = new ethers.Contract(MFT, ERC20_ABI, wallet);

  const charAllowance = await charToken.allowance(wallet.address, PM);
  if (charAllowance < ethers.parseEther('1')) {
    console.log('  Approving CHAR to PM...');
    const tx = await charToken.approve(PM, ethers.MaxUint256);
    await tx.wait();
    console.log('    tx:', tx.hash);
    await sleep(2000);
  } else {
    console.log('  CHAR already approved to PM');
  }

  const mftAllowance = await mftToken.allowance(wallet.address, PM);
  if (mftAllowance < ethers.parseEther('10000000')) {
    console.log('  Approving MfT to PM...');
    const tx = await mftToken.approve(PM, ethers.MaxUint256);
    await tx.wait();
    console.log('    tx:', tx.hash);
    await sleep(2000);
  } else {
    console.log('  MfT already approved to PM');
  }

  // Process each reactor
  const results = [];
  for (const reactor of REACTORS) {
    console.log(`\n=== ${reactor.name} (${reactor.addr.slice(0,8)}) ===`);
    try {
      // Mint
      console.log('  Minting CHAR/MfT LP...');
      const mintTx = await pm.mint({
        token0: CHAR,
        token1: MFT,
        fee: 10000,
        tickLower: -887200,
        tickUpper: 887200,
        amount0Desired: ethers.parseEther('0.001'),
        amount1Desired: ethers.parseEther('700000'),
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
      console.log(`    NFT #${tokenId}: ${mintTx.hash}`);
      await sleep(2000);

      // Approve factory to pull this specific NFT
      console.log(`  Approving factory for NFT #${tokenId}...`);
      const appTx = await pm.approve(FACTORY, tokenId);
      await appTx.wait();
      await sleep(1000);

      // addPoolToReactor via factory
      console.log(`  factory.addPoolToReactor(${reactor.addr.slice(0,8)}, ${tokenId})...`);
      const addTx = await factory.addPoolToReactor(reactor.addr, tokenId);
      await addTx.wait();

      const rc = new ethers.Contract(reactor.addr, REACTOR_ABI, provider);
      const count = await rc.poolCount();
      console.log(`    done: ${addTx.hash} (pools: ${count})`);
      await sleep(1000);

      results.push({ name: reactor.name, tokenId: tokenId.toString(), status: 'OK' });
    } catch (err) {
      console.error(`  FAILED: ${err.message.slice(0, 200)}`);
      results.push({ name: reactor.name, status: 'FAILED' });
    }
  }

  console.log('\n=== RESULTS ===');
  for (const r of results) {
    console.log(`  ${r.name}: ${r.status}${r.tokenId ? ' (NFT #' + r.tokenId + ')' : ''}`);
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
