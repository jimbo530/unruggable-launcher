// seed-prgt-usdc-lp.cjs — Seed a tight-band PRGT/USDC Uniswap V3 peg LP (0.01% fee, ~0.99–1.01).
// PRGT (0xEe6f…913D) is a $1 USDC-backed receipt (Money/CharityFund clone, 6 dec), so this mirrors
// the "Money V4 USDC LP": both legs ~$1, ultra-tight concentrated band = max fee capture, ~no IL.
// Mints PRGT 1:1 from USDC via deposit(), creates+inits the pool at 1.0, mints the concentrated
// position, KEEPS the NFT in the agent wallet (withdrawable — NOT burned; lock only when shipped).
// DRY by default; set CONFIRM=1 to send. Run on VPS from /root/mft-launch-tools (KEEPER key + ethers).
require('dotenv').config();
const { ethers } = require('ethers');

const CONFIRM = process.env.CONFIRM === '1';
const RPC  = 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';   // 6 dec
const PRGT = '0xEe6fB5f324B05efF95fD59F4574050a891e6913D';   // 6 dec, $1 receipt (deposit/redeem 1:1)
const V3F  = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';   // Uniswap V3 factory (Base)
const NPM  = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';   // NonfungiblePositionManager (Base)
const FEE  = 100;            // 0.01% tier -> tickSpacing 1

// $20 seed: ~$10 USDC + ~$10 PRGT (minted from $10 USDC). Both 6 decimals.
const USDC_LEG        = 10_000000n;   // $10 stays as the USDC side of the LP
const PRGT_LEG        = 10_000000n;   // 10 PRGT side of the LP
// tight band ~0.99–1.01 (price = PRGT per USDC ≈ 1.0; 1.0001^±100 ≈ 0.99005–1.01005)
const TICK_LOWER = -100, TICK_UPPER = 100;

const ERC20 = ['function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)','function allowance(address,address) view returns (uint256)','function decimals() view returns (uint8)','function symbol() view returns (string)'];
const VAULT = [...ERC20,'function deposit(uint256)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)'];
const POOL  = ['function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)','function token0() view returns (address)'];
const NPMABI= [
  'function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)'
];

(async () => {
  const key = process.env.KEEPER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error('no KEEPER_PRIVATE_KEY/AGENT_PRIVATE_KEY in env');
  const net = new ethers.Network('base', 8453);
  const provider = new ethers.JsonRpcProvider(RPC, net, { staticNetwork: net });
  const wallet = new ethers.Wallet(key.startsWith('0x')?key:'0x'+key, provider);
  console.log('MODE:', CONFIRM ? 'LIVE (will send)' : 'DRY (no txs)');
  console.log('wallet:', wallet.address);

  const usdc = new ethers.Contract(USDC, ERC20, wallet);
  const prgt = new ethers.Contract(PRGT, VAULT, wallet);

  // sanity: PRGT really is a 6-dec contract with code (verify before any tx)
  const [uDec, pDec, pSym, code] = await Promise.all([
    usdc.decimals(), prgt.decimals().catch(()=>null), prgt.symbol().catch(()=>'PRGT'), provider.getCode(PRGT)
  ]);
  if (code === '0x') throw new Error('PRGT has no code at '+PRGT);
  console.log(`USDC ${uDec}dec  PRGT(${pSym}) ${pDec}dec  code=${(code.length-2)/2} bytes`);
  if (Number(pDec) !== 6) console.log(`⚠ PRGT decimals = ${pDec} (expected 6) — STOP and recheck before live`);

  const [usdcBal, prgtBal, ethBal] = await Promise.all([
    usdc.balanceOf(wallet.address), prgt.balanceOf(wallet.address), provider.getBalance(wallet.address)
  ]);
  console.log(`balances: USDC ${ethers.formatUnits(usdcBal,6)}  PRGT ${ethers.formatUnits(prgtBal,6)}  ETH ${ethers.formatEther(ethBal)}`);

  // mint only the PRGT shortfall (1:1 from USDC); reuse any PRGT already held
  const prgtShort   = prgtBal >= PRGT_LEG ? 0n : (PRGT_LEG - prgtBal);
  const usdcForMint = prgtShort; // 1:1, both 6 dec
  const usdcNeeded  = USDC_LEG + usdcForMint;
  console.log(`\nplan: pool USDC/PRGT fee ${FEE} (0.01%), ticks ${TICK_LOWER}..${TICK_UPPER} (~0.99–1.01)`);
  console.log(`  total USDC needed: ${ethers.formatUnits(usdcNeeded,6)}  = ${ethers.formatUnits(USDC_LEG,6)} USDC leg + ${ethers.formatUnits(usdcForMint,6)} to mint ${ethers.formatUnits(prgtShort,6)} PRGT`);
  console.log(`  position: ~${ethers.formatUnits(USDC_LEG,6)} USDC + ${ethers.formatUnits(PRGT_LEG,6)} PRGT, NFT -> ${wallet.address}`);
  if (usdcBal < usdcNeeded) throw new Error(`not enough USDC: have ${ethers.formatUnits(usdcBal,6)}, need ${ethers.formatUnits(usdcNeeded,6)}`);

  // pool ordering: token0 < token1 by address; price(token1/token0) = 1.0 -> sqrtPriceX96 = 2^96
  const usdcIs0 = USDC.toLowerCase() < PRGT.toLowerCase();
  const token0 = usdcIs0 ? USDC : PRGT, token1 = usdcIs0 ? PRGT : USDC;
  const sqrtPriceX96 = 1n << 96n;
  const amount0Desired = usdcIs0 ? USDC_LEG : PRGT_LEG;
  const amount1Desired = usdcIs0 ? PRGT_LEG : USDC_LEG;
  console.log(`  pool token0=${token0===USDC?'USDC':'PRGT'} token1=${token1===USDC?'USDC':'PRGT'} sqrtPriceX96=${sqrtPriceX96}`);

  if (!CONFIRM){ console.log('\nDRY done — re-run with CONFIRM=1 to execute.'); return; }

  // 1. mint PRGT shortfall via deposit() (EXACT approval — never MaxUint256)
  if (prgtShort > 0n) {
    if ((await usdc.allowance(wallet.address, PRGT)) < usdcForMint){ console.log('approve USDC->PRGT (exact)'); await (await usdc.approve(PRGT, usdcForMint)).wait(); }
    console.log(`deposit ${ethers.formatUnits(usdcForMint,6)} USDC -> PRGT...`);
    await (await prgt.deposit(usdcForMint, {gasLimit:400000})).wait();
    let have = await prgt.balanceOf(wallet.address);
    for (let i=0;i<10 && have<PRGT_LEG;i++){ await new Promise(r=>setTimeout(r,2000)); have = await prgt.balanceOf(wallet.address); }
    console.log(`PRGT after deposit: ${ethers.formatUnits(have,6)}`);
    if (have < PRGT_LEG) throw new Error('not enough PRGT after deposit — aborting before pool/LP');
  }

  // 2. create + init pool at 1.0
  const npm = new ethers.Contract(NPM, NPMABI, wallet);
  console.log('createAndInitializePoolIfNecessary...');
  await (await npm.createAndInitializePoolIfNecessary(token0, token1, FEE, sqrtPriceX96, {gasLimit:6000000})).wait();

  // 3. verify pool price ~1.0 before adding liquidity (retry — fresh pool lags on public RPC)
  let poolAddr, s;
  for (let i=0;i<12;i++){
    try { poolAddr = await new ethers.Contract(V3F, FACT, provider).getPool(token0, token1, FEE);
      if (poolAddr && poolAddr !== ethers.ZeroAddress){ s = await new ethers.Contract(poolAddr, POOL, provider).slot0(); if (s) break; } } catch(e){}
    await new Promise(r=>setTimeout(r,2500));
  }
  if (!s) throw new Error('could not read pool slot0 after retries');
  const sp = Number(s.sqrtPriceX96)/2**96, gotPrice = sp*sp;
  console.log(`pool ${poolAddr} price(t1/t0)=${gotPrice.toPrecision(6)} tick=${s.tick}`);
  if (Math.abs(gotPrice - 1) > 0.05) throw new Error('pool price off >5% from 1.0 — aborting before LP');

  // 4. approve (EXACT) + mint concentrated position
  if ((await usdc.allowance(wallet.address, NPM)) < USDC_LEG){ console.log('approve USDC->NPM (exact)'); await (await usdc.approve(NPM, USDC_LEG)).wait(); }
  if ((await prgt.allowance(wallet.address, NPM)) < PRGT_LEG){ console.log('approve PRGT->NPM (exact)'); await (await prgt.approve(NPM, PRGT_LEG)).wait(); }
  const params = { token0, token1, fee:FEE, tickLower:TICK_LOWER, tickUpper:TICK_UPPER, amount0Desired, amount1Desired, amount0Min:0, amount1Min:0, recipient:wallet.address, deadline: Math.floor(Date.now()/1000)+600 };
  console.log('mint position...');
  const rc = await (await npm.mint(params, {gasLimit:1500000})).wait();
  console.log('SEEDED ✅ tx', rc.hash, '\npool', poolAddr, '— PRGT/USDC 0.01% tight-band LP live; NFT held by agent wallet.');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
