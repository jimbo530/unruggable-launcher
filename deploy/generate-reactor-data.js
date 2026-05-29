// Generates static JSON data files for reactor pages
// Run on VPS via cron/PM2 — uses Alchemy RPC for reliability
// Writes to /var/www/tasern/api/reactor-{name}.json

// Load dotenv if available, otherwise rely on env vars
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch {}
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const OUTPUT_DIR = process.env.REACTOR_DATA_DIR || '/var/www/tasern/api';

const REACTORS = [
  {
    name: 'mft',
    address: '0xf8ea9545fbe51F0C859e155AD81964fFcE17E30d',
    burnToken: '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3',
    burnSymbol: 'MfT',
    burnDecimals: 18,
    // Only show MfTUSD pool (index 2)
    showPools: [2],
  },
  {
    name: 'tgn',
    address: '0x89Dc8A1fc77E066640C8C035c64FD673EA3F4B3e',
    burnToken: '0xD75dfa972C6136f1c594Fec1945302f885E1ab29',
    burnSymbol: 'TGN',
    burnDecimals: 18,
    showPools: null, // auto-detect MfTUSD pool
  },
  {
    name: 'burgers',
    address: '0xdBC32e17bCA40022560DC84915aBA tried8ed5bE3',
    burnToken: '0x06A05043eb2C1691b19c2C13219dB9212269dDc5',
    burnSymbol: 'BURGERS',
    burnDecimals: 18,
    showPools: null,
  },
];

const MFTUSD = '0x85C78B8104D874d17e698b8c5678e3B8072347B1';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

const REACTOR_ABI = [
  'function poolCount() view returns (uint256)',
  'function depositCount() view returns (uint256)',
  'function totalTGNBurned() view returns (uint256)',
  'function paused() view returns (bool)',
  'function pools(uint256) view returns (address v3Pool, address token0, address token1, uint24 fee, bool disabled)',
  'function getDeposit(uint256) view returns (address depositor, uint256 tokenId, uint256 poolIndex, uint128 liquidity, uint256 unlockTime, bool withdrawn)',
];
const ERC20_ABI = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
const NPM_ABI = ['function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)'];
const V3POOL_ABI = ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getAmountsFromLiquidity(liquidity, sqrtPriceX96, tickLower, tickUpper) {
  const Q96 = 2n ** 96n;
  const sqrtA = tickToSqrtPrice(tickLower);
  const sqrtB = tickToSqrtPrice(tickUpper);
  const sqrtP = sqrtPriceX96;
  let amount0 = 0n, amount1 = 0n;
  if (sqrtP <= sqrtA) {
    amount0 = liquidity * Q96 * (sqrtB - sqrtA) / (sqrtA * sqrtB);
  } else if (sqrtP < sqrtB) {
    amount0 = liquidity * Q96 * (sqrtB - sqrtP) / (sqrtP * sqrtB);
    amount1 = liquidity * (sqrtP - sqrtA) / Q96;
  } else {
    amount1 = liquidity * (sqrtB - sqrtA) / Q96;
  }
  return { amount0, amount1 };
}

function tickToSqrtPrice(tick) {
  const absTick = Math.abs(tick);
  let ratio = 1.0;
  if (absTick & 1) ratio *= 1.0001000050001667;
  if (absTick & 2) ratio *= 1.0002000100006667;
  if (absTick & 4) ratio *= 1.0004000600100015;
  if (absTick & 8) ratio *= 1.0008002800560084;
  if (absTick & 16) ratio *= 1.0016012802561024;
  if (absTick & 32) ratio *= 1.003204964963598;
  if (absTick & 64) ratio *= 1.0064196200298776;
  if (absTick & 128) ratio *= 1.0128735790058454;
  if (absTick & 256) ratio *= 1.0258173838037012;
  if (absTick & 512) ratio *= 1.051901844379487;
  if (absTick & 1024) ratio *= 1.1066568654937734;
  if (absTick & 2048) ratio *= 1.2250085700000538;
  if (absTick & 4096) ratio *= 1.500833627341028;
  if (absTick & 8192) ratio *= 2.2522482520378614;
  if (absTick & 16384) ratio *= 5.073296978766956;
  if (absTick & 32768) ratio *= 25.73785568754369;
  if (absTick & 65536) ratio *= 662.2698189455721;
  if (absTick & 131072) ratio *= 438782.024654041;
  if (absTick & 262144) ratio *= 192524482364.94757;
  if (absTick & 524288) ratio *= 3.706810603282079e19;
  if (tick < 0) ratio = 1.0 / ratio;
  const sqrtRatio = Math.sqrt(ratio);
  return BigInt(Math.round(sqrtRatio * Number(2n ** 96n)));
}

async function generateReactorData(provider, config) {
  console.log(`\n--- ${config.name.toUpperCase()} Reactor ---`);
  const reactor = new ethers.Contract(config.address, REACTOR_ABI, provider);
  const npmContract = new ethers.Contract(NPM, NPM_ABI, provider);

  // Stats
  const [poolCt, depCt, burned, paused] = await Promise.all([
    reactor.poolCount(), reactor.depositCount(), reactor.totalTGNBurned(), reactor.paused()
  ]);
  let compounded = 0n;
  try { compounded = await reactor.totalCompounded(); } catch {}

  console.log(`  Pools: ${poolCt}, Deposits: ${depCt}, Burned: ${ethers.formatUnits(burned, config.burnDecimals)}`);

  // Find MfTUSD pool(s)
  const pools = [];
  for (let i = 0; i < Number(poolCt); i++) {
    await sleep(200);
    const p = await reactor.pools(i);
    if (p.disabled) continue;

    // If showPools specified, only include those
    if (config.showPools && !config.showPools.includes(i)) continue;

    // Otherwise auto-detect: only include pools that have MfTUSD
    if (!config.showPools) {
      const hasMftusd = p.token0.toLowerCase() === MFTUSD.toLowerCase() ||
                        p.token1.toLowerCase() === MFTUSD.toLowerCase();
      if (!hasMftusd) continue;
    }

    await sleep(200);
    const [sym0, sym1, dec0, dec1] = await Promise.all([
      new ethers.Contract(p.token0, ERC20_ABI, provider).symbol(),
      new ethers.Contract(p.token1, ERC20_ABI, provider).symbol(),
      new ethers.Contract(p.token0, ERC20_ABI, provider).decimals(),
      new ethers.Contract(p.token1, ERC20_ABI, provider).decimals(),
    ]);

    pools.push({
      index: i,
      v3Pool: p.v3Pool,
      token0: p.token0, token1: p.token1,
      fee: Number(p.fee),
      sym0, sym1,
      dec0: Number(dec0), dec1: Number(dec1),
    });
    console.log(`  Pool ${i}: ${sym0}/${sym1} fee:${Number(p.fee)/10000}%`);
  }

  // Deposits + position details
  const deposits = [];
  for (let i = 0; i < Number(depCt); i++) {
    await sleep(200);
    const dep = await reactor.getDeposit(i);
    if (dep.withdrawn) continue;

    const poolIdx = Number(dep.poolIndex);
    const pool = pools.find(p => p.index === poolIdx);
    if (!pool) continue; // not a displayed pool

    // Get position details from NPM
    await sleep(200);
    let amounts = null;
    try {
      const v3Pool = new ethers.Contract(pool.v3Pool, V3POOL_ABI, provider);
      const slot = await v3Pool.slot0();
      const sqrtPriceX96 = slot[0];

      await sleep(200);
      const pos = await npmContract.positions(dep.tokenId);
      const tickLower = Number(pos[5]);
      const tickUpper = Number(pos[6]);
      const liquidity = pos[7];
      const tokensOwed0 = pos[10];
      const tokensOwed1 = pos[11];

      const { amount0, amount1 } = getAmountsFromLiquidity(liquidity, sqrtPriceX96, tickLower, tickUpper);

      amounts = {
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        fees0: tokensOwed0.toString(),
        fees1: tokensOwed1.toString(),
      };
    } catch (e) {
      console.log(`  Deposit ${i} position details failed: ${e.message}`);
    }

    deposits.push({
      id: i,
      owner: dep.depositor,
      tokenId: dep.tokenId.toString(),
      poolIndex: poolIdx,
      liquidity: dep.liquidity.toString(),
      unlockTime: Number(dep.unlockTime),
      amounts,
    });
    console.log(`  Deposit ${i}: owner=${dep.depositor.slice(0,10)}... pool=${poolIdx} tokenId=${dep.tokenId}`);
  }

  // Calculate MfTUSD in pools (for tree stats)
  let totalMftusdWei = 0n;
  const mftusdContract = new ethers.Contract(MFTUSD, ERC20_ABI, provider);
  for (const pool of pools) {
    const hasMftusd = pool.token0.toLowerCase() === MFTUSD.toLowerCase() ||
                      pool.token1.toLowerCase() === MFTUSD.toLowerCase();
    if (!hasMftusd) continue;
    await sleep(200);
    try {
      const bal = await mftusdContract.balanceOf(pool.v3Pool);
      totalMftusdWei += bal;
    } catch {}
  }
  const mftusdInLP = Number(totalMftusdWei) / 1e6;
  const treesPerYear = mftusdInLP * 0.135; // 3% APY * 45% to trees / $0.10 per tree
  console.log(`  MfTUSD in LP: $${mftusdInLP.toFixed(2)}, Trees/yr: ${treesPerYear.toFixed(2)}`);

  const data = {
    updated: new Date().toISOString(),
    reactor: config.address,
    burnToken: config.burnToken,
    burnSymbol: config.burnSymbol,
    burnDecimals: config.burnDecimals,
    stats: {
      poolCount: Number(poolCt),
      depositCount: Number(depCt),
      totalBurned: ethers.formatUnits(burned, config.burnDecimals),
      totalCompounded: compounded.toString(),
      paused,
    },
    treeStats: {
      mftusdInLP: mftusdInLP.toFixed(2),
      treesPerYear: treesPerYear.toFixed(2),
    },
    pools,
    deposits,
  };

  const outFile = path.join(OUTPUT_DIR, `reactor-${config.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  console.log(`  Wrote ${outFile}`);
  return data;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  console.log('RPC:', RPC.includes('alchemy') ? 'Alchemy' : RPC);

  // Ensure output dir exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Only generate for reactors specified as args, or all
  const targets = process.argv.slice(2);
  const configs = targets.length > 0
    ? REACTORS.filter(r => targets.includes(r.name))
    : REACTORS;

  for (const config of configs) {
    try {
      await generateReactorData(provider, config);
    } catch (e) {
      console.error(`  FAILED ${config.name}: ${e.message}`);
    }
  }
  console.log('\nDone.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
