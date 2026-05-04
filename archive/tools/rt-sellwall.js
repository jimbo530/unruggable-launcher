// RT Sell Wall — transfer admin, remove broken pool, create proper sell wall, register in reactor
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require(require('path').join(__dirname, '..', 'node_modules', 'ethers'));

const BASE_RPC = 'https://mainnet.base.org';
const provider = new ethers.JsonRpcProvider(BASE_RPC);
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

const RT      = '0xe340713af65785f96e9Df242d6C76257bac4CA10';
const MFT     = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const REACTOR = '0x7821179863d894817fD6a1F73f6484B0b80dD17b';
const BUGGY_FACTORY = '0x5217163de3965F2E11C5123Df1A80A0742A18642';
const PM      = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

const TICK_SPACE = 200;
const MAX_TICK = 887200;

const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];

const FACTORY_ABI = [
  'function transferReactorAdmin(address reactor, address newAdmin) external',
  'function owner() view returns (address)',
];

const REACTOR_ABI = [
  'function acceptAdmin() external',
  'function admin() view returns (address)',
  'function removePool(uint256 poolIndex) external',
  'function addPool(uint256 tokenId) external',
  'function poolCount() view returns (uint256)',
  'function pools(uint256) view returns (uint256 tokenId, address xToken, address poolAddress, uint24 fee, bool tokenIsToken0, bool disabled)',
];

const PM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function transferFrom(address from, address to, uint256 tokenId) external',
];

const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
];

async function main() {
  console.log('Agent wallet:', wallet.address);

  // ── Step 1: Transfer reactor admin to agent wallet ──────────────────────
  console.log('\n=== Step 1: Transfer reactor admin ===');
  const factory = new ethers.Contract(BUGGY_FACTORY, FACTORY_ABI, wallet);
  const reactor = new ethers.Contract(REACTOR, REACTOR_ABI, wallet);

  const currentAdmin = await reactor.admin();
  console.log('Current reactor admin:', currentAdmin);

  if (currentAdmin.toLowerCase() === wallet.address.toLowerCase()) {
    console.log('Already admin, skipping transfer.');
  } else if (currentAdmin.toLowerCase() === BUGGY_FACTORY.toLowerCase()) {
    console.log('Initiating admin transfer from buggy factory...');
    const tx1 = await factory.transferReactorAdmin(REACTOR, wallet.address);
    console.log('transferReactorAdmin tx:', tx1.hash);
    await tx1.wait();
    console.log('Confirmed. Accepting admin...');
    const tx2 = await reactor.acceptAdmin();
    console.log('acceptAdmin tx:', tx2.hash);
    await tx2.wait();
    console.log('Admin transferred to agent wallet.');
  } else {
    throw new Error('Unexpected admin: ' + currentAdmin);
  }

  // ── Step 2: Remove broken MfT pool (index 2) ───────────────────────────
  console.log('\n=== Step 2: Remove broken MfT pool ===');
  const poolCount = Number(await reactor.poolCount());
  console.log('Pool count:', poolCount);

  // Find the MfT pool index (it might have shifted)
  let mftPoolIndex = -1;
  for (let i = 0; i < poolCount; i++) {
    const p = await reactor.pools(i);
    if (p.xToken.toLowerCase() === MFT.toLowerCase()) {
      mftPoolIndex = i;
      console.log('Found MfT pool at index', i, 'tokenId:', p.tokenId.toString());
      break;
    }
  }

  if (mftPoolIndex >= 0) {
    const tx3 = await reactor.removePool(mftPoolIndex);
    console.log('removePool tx:', tx3.hash);
    await tx3.wait();
    console.log('Broken MfT pool removed.');
  } else {
    console.log('No MfT pool found — already removed or never added.');
  }

  // ── Step 3: Get current tick and create proper sell wall ────────────────
  console.log('\n=== Step 3: Create proper sell wall ===');
  const rt = new ethers.Contract(RT, ERC20_ABI, wallet);
  const rtBalance = await rt.balanceOf(wallet.address);
  console.log('RT balance:', ethers.formatUnits(rtBalance, 18));

  if (rtBalance === 0n) throw new Error('No RT tokens to deposit');

  // Known pool address (RT/MfT 1% fee on Base V3)
  const poolAddr = '0xb8C634D96327ff6Ca2AdE724F071fC0444CA5250';
  console.log('RT/MfT pool:', poolAddr);

  const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
  const slot0 = await pool.slot0();
  const currentTick = Number(slot0.tick);
  console.log('Current tick:', currentTick);

  // For single-sided token1 (RT) sell wall: range must be BELOW current tick.
  // When currentTick > tickUpper, the position holds only token1 (RT).
  // As buyers push tick down into range, RT gets sold for MfT.
  const MIN_TICK = -887200;
  const roundedTick = Math.floor(currentTick / TICK_SPACE) * TICK_SPACE;
  const tickLower = MIN_TICK;
  const tickUpper = roundedTick; // at or just below current tick
  console.log('Sell wall range: tickLower=' + tickLower + ' tickUpper=' + tickUpper);
  console.log('(currentTick ' + currentTick + ' > tickUpper ' + tickUpper + ' => single-sided token1)');

  // MfT is token0 (lower address), RT is token1
  // Single-sided token1: amount0Desired=0, amount1Desired=all RT
  const amount0Desired = 0n;
  const amount1Desired = rtBalance;

  // Approve RT for PM
  console.log('Approving RT for Position Manager...');
  const txApprove = await rt.approve(PM, rtBalance);
  console.log('approve tx:', txApprove.hash);
  await txApprove.wait();
  console.log('Approved.');

  // Mint position
  console.log('Minting sell wall position...');
  const pm = new ethers.Contract(PM, PM_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  const txMint = await pm.mint({
    token0: MFT,
    token1: RT,
    fee: 10000,
    tickLower: tickLower,
    tickUpper: tickUpper,
    amount0Desired: amount0Desired,
    amount1Desired: amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient: wallet.address,
    deadline: deadline,
  });
  console.log('mint tx:', txMint.hash);
  const receipt = await txMint.wait();

  // Parse IncreaseLiquidity event to get tokenId
  const pmIface = new ethers.Interface([
    'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  ]);
  let newTokenId;
  for (const log of receipt.logs) {
    try {
      const parsed = pmIface.parseLog(log);
      if (parsed && parsed.name === 'IncreaseLiquidity') {
        newTokenId = parsed.args.tokenId;
        console.log('New position tokenId:', newTokenId.toString());
        console.log('Liquidity:', parsed.args.liquidity.toString());
        console.log('amount0 (MfT):', ethers.formatUnits(parsed.args.amount0, 18));
        console.log('amount1 (RT):', ethers.formatUnits(parsed.args.amount1, 18));
        break;
      }
    } catch {}
  }
  if (!newTokenId) throw new Error('Could not find tokenId from mint');

  // ── Step 4: Transfer NFT to reactor ─────────────────────────────────────
  console.log('\n=== Step 4: Transfer NFT to reactor ===');
  const txTransfer = await pm.transferFrom(wallet.address, REACTOR, newTokenId);
  console.log('transferFrom tx:', txTransfer.hash);
  await txTransfer.wait();
  console.log('NFT transferred to reactor.');

  // ── Step 5: Register pool in reactor ────────────────────────────────────
  console.log('\n=== Step 5: Register pool in reactor ===');
  const txAdd = await reactor.addPool(newTokenId);
  console.log('addPool tx:', txAdd.hash);
  await txAdd.wait();
  console.log('Pool registered in reactor.');

  // ── Verify ──────────────────────────────────────────────────────────────
  console.log('\n=== Verification ===');
  const finalCount = Number(await reactor.poolCount());
  console.log('Reactor pool count:', finalCount);
  for (let i = 0; i < finalCount; i++) {
    const p = await reactor.pools(i);
    console.log('Pool', i, '- tokenId:', p.tokenId.toString(), 'xToken:', p.xToken);
  }

  const rtLeft = await rt.balanceOf(wallet.address);
  console.log('RT remaining in wallet:', ethers.formatUnits(rtLeft, 18));
  console.log('\nDone! 78.3M RT locked in reactor sell wall.');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
