require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ── Contract artifacts ──────────────────────────────────────────────────
const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'MycoPadV5_8_flat_sol_Unruggable2.abi'), 'utf8'));
const BIN = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'MycoPadV5_8_flat_sol_Unruggable2.bin'), 'utf8');

// ── Ecosystem token addresses (Base mainnet) ───────────────────────────
const TETH       = '0x7D545427c8f548F3A00C1c09B5360BF3D4B842ef';
const TBTC       = '0x53B6De1726856c4615dc3B05d45993Bc1aa3403c';
const MFT_MEME   = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const CHAR       = '0x20b048fA035D5763685D695e66aDF62c5D9F5055';
const MFT_STABLE = '0xe96fa44b4b82F085a457F9B7a0F85ea26FF1652F';

// ── External references (for MfT meme price derivation only) ───────────
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ── Uniswap V3 infrastructure (Base) ───────────────────────────────────
const V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const POSITION_MANAGER = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const SWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';

// ── Reactor + vesting implementation addresses ─────────────────────────
// SporeReactorV3 implementation (used for cloning)
const REACTOR_IMPL = '0x9c7005Ba0b56e345CCF6CFa03B0c4C58bE0c9b86'; // SporeV3
// VolumeVesting implementation
const VESTING_IMPL = '0xbDA1Ab36BCeC8e16Fe1A4E617bbb3C277A413508';

// ── Upstream reactor (MfT V1 Prime or whichever is the main hub) ──────
const UPSTREAM_REACTOR = '0xAE75CbBF6C94A0607c810fD17de3c940b8D8c958'; // MfT Prime

// ── Fee tiers for swap routing ─────────────────────────────────────────
const MFT_STABLE_TBTC_FEE = 10000;  // MfTUSD/TBTC pool = 1%
const MFT_STABLE_TETH_FEE = 10000;  // MfTUSD/TETH pool = 1%
const MFT_STABLE_MFT_FEE  = 10000;  // MfTUSD/MfT(meme) = 1% (CHAR 2-hop leg 1)
const MFT_MEME_CHAR_FEE   = 10000;  // MfT(meme)/CHAR = 1% (CHAR 2-hop leg 2)
const MFT_MEME_WETH_FEE   = 10000;  // MfT(meme)/WETH = 1% (price oracle only)
const WETH_USDC_FEE        = 500;   // WETH/USDC = 0.05% (deep pool, price oracle only)

async function main() {
  const provider = new ethers.JsonRpcProvider('https://base.publicnode.com');
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

  console.log('Deployer:', wallet.address);
  console.log('ETH balance:', ethers.formatEther(await provider.getBalance(wallet.address)));

  // ── Verify all referenced pools exist ─────────────────────────────
  const factoryABI = ['function getPool(address,address,uint24) view returns (address)'];
  const factory = new ethers.Contract(V3_FACTORY, factoryABI, provider);

  console.log('\nVerifying swap pools exist...');
  const pools = [
    ['MfTUSD/TBTC', MFT_STABLE, TBTC, MFT_STABLE_TBTC_FEE],
    ['MfTUSD/TETH', MFT_STABLE, TETH, MFT_STABLE_TETH_FEE],
    ['MfTUSD/MfT',  MFT_STABLE, MFT_MEME, MFT_STABLE_MFT_FEE],
    ['MfT/CHAR',    MFT_MEME,   CHAR, MFT_MEME_CHAR_FEE],
    ['MfT/WETH',    MFT_MEME,   WETH, MFT_MEME_WETH_FEE],
    ['WETH/USDC',   WETH,       USDC, WETH_USDC_FEE],
  ];

  for (const [name, a, b, fee] of pools) {
    const pool = await factory.getPool(a, b, fee);
    const exists = pool !== ethers.ZeroAddress;
    console.log(`  ${name} (fee ${fee}): ${exists ? pool : 'MISSING!'}`);
    if (!exists) {
      console.error(`FATAL: Required pool ${name} does not exist. Cannot deploy.`);
      process.exit(1);
    }
  }

  // ── Deploy ────────────────────────────────────────────────────────
  console.log('\nDeploying Unrugable V5.8...');
  const Factory = new ethers.ContractFactory(ABI, BIN, wallet);

  const contract = await Factory.deploy(
    TETH,               // _teth
    TBTC,               // _tbtc
    MFT_MEME,           // _mft
    CHAR,               // _char
    MFT_STABLE,         // _mftStable
    WETH,               // _weth (price oracle only)
    USDC,               // _usdc (price oracle only)
    V3_FACTORY,         // _v3Factory
    POSITION_MANAGER,   // _pm
    SWAP_ROUTER,        // _router
    REACTOR_IMPL,       // _reactorImpl
    VESTING_IMPL,       // _vestingImpl
    UPSTREAM_REACTOR,   // _upstreamReactor
    MFT_STABLE_TBTC_FEE,   // _mftStableTbtcFee
    MFT_STABLE_TETH_FEE,   // _mftStableTethFee
    MFT_STABLE_MFT_FEE,    // _mftStableMftFee (CHAR 2-hop leg 1)
    MFT_MEME_CHAR_FEE,     // _mftMemeCharFee (CHAR 2-hop leg 2)
    MFT_MEME_WETH_FEE,     // _mftMemeWethFee
    WETH_USDC_FEE,          // _wethUsdcFee
    { gasLimit: 8_000_000 }
  );

  console.log('TX:', contract.deploymentTransaction().hash);
  console.log('Waiting for confirmation...');
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log('\n========================================');
  console.log('Unrugable V5.8 deployed at:', addr);
  console.log('========================================');

  // Save address
  fs.writeFileSync(
    path.join(__dirname, '..', 'contracts', 'MycoPadV5_8.address'),
    addr
  );

  // Verify immutables
  console.log('\nVerifying immutables...');
  const c = new ethers.Contract(addr, ABI, provider);
  console.log('  teth:', await c.teth());
  console.log('  tbtc:', await c.tbtc());
  console.log('  mft:', await c.mft());
  console.log('  char:', await c.char());
  console.log('  mftStable:', await c.mftStable());
  console.log('  owner:', await c.owner());
  console.log('  reactorImpl:', await c.reactorImpl());
  console.log('  upstreamReactor:', await c.upstreamReactor());

  console.log('\nDone! Update the launcher UI to use this address.');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
