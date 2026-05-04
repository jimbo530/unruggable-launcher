// RT Sell Wall — mint position + register in reactor (admin already transferred, broken pool already removed)
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require(require('path').join(__dirname, '..', 'node_modules', 'ethers'));

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

const RT      = '0xe340713af65785f96e9Df242d6C76257bac4CA10';
const MFT     = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const REACTOR = '0x7821179863d894817fD6a1F73f6484B0b80dD17b';
const PM      = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const POOL    = '0xb8C634D96327ff6Ca2AdE724F071fC0444CA5250';

const TICK_SPACE = 200;
const MIN_TICK = -887200;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function retry(fn, label, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch(e) {
      if (i < attempts - 1 && e.message.includes('rate limit')) {
        console.log(label + ' rate limited, waiting 5s...');
        await sleep(5000);
      } else throw e;
    }
  }
}

async function main() {
  console.log('Agent wallet:', wallet.address);

  // Get RT balance
  const rt = new ethers.Contract(RT, ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'], wallet);
  const rtBalance = await retry(() => rt.balanceOf(wallet.address), 'balanceOf');
  console.log('RT balance:', ethers.formatUnits(rtBalance, 18));
  if (rtBalance === 0n) throw new Error('No RT tokens');

  // Get current tick
  await sleep(2000);
  const pool = new ethers.Contract(POOL, ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'], provider);
  const slot0 = await retry(() => pool.slot0(), 'slot0');
  const currentTick = Number(slot0[1]);
  console.log('Current tick:', currentTick);

  // Sell wall: range BELOW current tick for single-sided token1 (RT)
  const roundedTick = Math.floor(currentTick / TICK_SPACE) * TICK_SPACE;
  const tickLower = MIN_TICK;
  const tickUpper = roundedTick;
  console.log('Range: [' + tickLower + ', ' + tickUpper + '] (current ' + currentTick + ' > upper => all RT)');

  // Approve
  await sleep(2000);
  console.log('Approving RT...');
  const txApprove = await rt.approve(PM, rtBalance);
  console.log('approve tx:', txApprove.hash);
  await txApprove.wait();
  console.log('Approved.');

  // Mint sell wall
  await sleep(2000);
  console.log('Minting sell wall...');
  const pm = new ethers.Contract(PM, [
    'function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
    'function transferFrom(address,address,uint256) external',
  ], wallet);

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const txMint = await pm.mint(
    [MFT, RT, 10000, tickLower, tickUpper, 0, rtBalance, 0, 0, wallet.address, deadline],
    { gasLimit: 600000 }
  );
  console.log('mint tx:', txMint.hash);
  const receipt = await txMint.wait();
  console.log('Gas used:', receipt.gasUsed.toString());

  // Parse tokenId from events
  const pmIface = new ethers.Interface([
    'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  ]);
  let newTokenId;
  for (const log of receipt.logs) {
    try {
      const parsed = pmIface.parseLog(log);
      if (parsed && parsed.name === 'IncreaseLiquidity') {
        newTokenId = parsed.args.tokenId;
        console.log('Position tokenId:', newTokenId.toString());
        console.log('Liquidity:', parsed.args.liquidity.toString());
        console.log('RT deposited:', ethers.formatUnits(parsed.args.amount1, 18));
        break;
      }
    } catch {}
  }
  if (!newTokenId) throw new Error('No tokenId found');

  // Transfer NFT to reactor
  await sleep(2000);
  console.log('Transferring NFT to reactor...');
  const txXfer = await pm.transferFrom(wallet.address, REACTOR, newTokenId);
  console.log('transfer tx:', txXfer.hash);
  await txXfer.wait();
  console.log('NFT in reactor.');

  // Register in reactor
  await sleep(2000);
  console.log('Registering pool...');
  const reactor = new ethers.Contract(REACTOR, ['function addPool(uint256) external'], wallet);
  const txAdd = await reactor.addPool(newTokenId);
  console.log('addPool tx:', txAdd.hash);
  await txAdd.wait();
  console.log('Pool registered!');

  // Check remaining balance
  await sleep(2000);
  const left = await retry(() => rt.balanceOf(wallet.address), 'final balance');
  console.log('RT remaining in wallet:', ethers.formatUnits(left, 18));
  console.log('\nDone! 78.3M RT locked in reactor sell wall.');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
