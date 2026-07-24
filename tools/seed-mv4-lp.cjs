// Seed a Money-V4 / <token> V3 LP so the token joins the Impact leaderboard + starts funding trees.
// Mints MV4 via deposit() (1:1 USDC-backed), creates+inits the pool at the token's real price,
// mints a full-range position, keeps the NFT in the agent wallet.
// DRY by default; set CONFIRM=1 to send. Run on VPS from /root/mft-launch-tools (has KEEPER key + ethers).
require('dotenv').config();
const { ethers } = require('ethers');

const CONFIRM = process.env.CONFIRM === '1';
const RPC = 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';   // 6
const MV4  = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';   // 6  (Money V4)
const NPM  = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3F  = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const FEE  = 10000, SPACING = 200, MINT_USDC = 5_000000n; // $5 -> 5 MV4

// --- target token (WALL) ---
const TOKEN = '0x89B689462Cd57f14d5d1a714d102B3EE5F0dCEF2';
const TSYM  = 'WALL';
const TDEC  = 18;

const ERC20 = ['function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)','function allowance(address,address) view returns (uint256)','function decimals() view returns (uint8)'];
const VAULT = [...ERC20,'function deposit(uint256)'];
const FACT  = ['function getPool(address,address,uint24) view returns (address)'];
const POOL  = ['function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)','function token0() view returns (address)'];
const NPMABI= [
  'function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)'
];

async function tokenPriceUsd(provider, token, dec){
  const f = new ethers.Contract(V3F, FACT, provider);
  for (const fee of [10000,3000,500,100]){
    const pool = await f.getPool(token, USDC, fee);
    if (pool === ethers.ZeroAddress) continue;
    const s = await new ethers.Contract(pool, POOL, provider).slot0();
    const sp = Number(s.sqrtPriceX96)/2**96, p01 = sp*sp;
    const isTok0 = token.toLowerCase() < USDC.toLowerCase();
    const price = isTok0 ? p01*10**(dec-6) : (1/p01)*10**(dec-6);
    if (price>0 && isFinite(price)) return price;
  }
  throw new Error('no USDC price pool for token');
}

(async () => {
  const key = process.env.KEEPER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error('no KEEPER_PRIVATE_KEY/AGENT_PRIVATE_KEY in env');
  const net = new ethers.Network('base', 8453);
  const provider = new ethers.JsonRpcProvider(RPC, net, { staticNetwork: net });
  const wallet = new ethers.Wallet(key.startsWith('0x')?key:'0x'+key, provider);
  console.log('MODE:', CONFIRM ? 'LIVE (will send)' : 'DRY (no txs)');
  console.log('wallet:', wallet.address);

  const usdc = new ethers.Contract(USDC, ERC20, wallet);
  const mv4  = new ethers.Contract(MV4, VAULT, wallet);
  const tok  = new ethers.Contract(TOKEN, ERC20, wallet);

  const [usdcBal, mv4Bal, tokBal, ethBal] = await Promise.all([
    usdc.balanceOf(wallet.address), mv4.balanceOf(wallet.address), tok.balanceOf(wallet.address), provider.getBalance(wallet.address)
  ]);
  console.log(`USDC ${ethers.formatUnits(usdcBal,6)}  MV4 ${ethers.formatUnits(mv4Bal,6)}  ${TSYM} ${ethers.formatUnits(tokBal,TDEC)}  ETH ${ethers.formatEther(ethBal)}`);
  if (usdcBal < MINT_USDC) throw new Error('not enough USDC to mint $5 MV4');

  const priceUsd = await tokenPriceUsd(provider, TOKEN, TDEC);
  console.log(`${TSYM} price: $${priceUsd.toPrecision(5)}`);

  // pool ordering + sqrtPrice (price = token1 raw per token0 raw)
  const tokIs0 = TOKEN.toLowerCase() < MV4.toLowerCase();
  const token0 = tokIs0 ? TOKEN : MV4, token1 = tokIs0 ? MV4 : TOKEN;
  const d0 = tokIs0 ? TDEC : 6, d1 = tokIs0 ? 6 : TDEC;
  // MV4 ~$1. price of token0 in token1 (human) then to raw
  const mv4PerTok = priceUsd; // 1 token = priceUsd MV4 (MV4~$1)
  const humanP = tokIs0 ? mv4PerTok : 1/mv4PerTok;          // token1 per token0 (human)
  const rawP = humanP * 10**(d1 - d0);
  const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(rawP) * 2**96));
  console.log(`pool token0=${token0===TOKEN?TSYM:'MV4'} token1=${token1===TOKEN?TSYM:'MV4'}  humanP(t1/t0)=${humanP.toPrecision(5)}  sqrtPriceX96=${sqrtPriceX96}`);

  // amounts: $5 MV4 + matching token at price (+15% token buffer, mins 0 on fresh pool)
  const mv4Amt = MINT_USDC;                                   // 5 MV4 (6dec)
  const tokAmtHuman = (5 / priceUsd) * 1.15;
  const tokAmt = ethers.parseUnits(tokAmtHuman.toFixed(TDEC), TDEC);
  if (tokBal < tokAmt) throw new Error(`not enough ${TSYM} held (${ethers.formatUnits(tokBal,TDEC)} < ${tokAmtHuman})`);
  const amount0Desired = token0===TOKEN ? tokAmt : mv4Amt;
  const amount1Desired = token1===TOKEN ? tokAmt : mv4Amt;
  console.log(`plan: mint 5 MV4 (deposit $5 USDC) + ${tokAmtHuman.toFixed(4)} ${TSYM} into full-range LP, keep NFT in wallet`);

  if (!CONFIRM){ console.log('\nDRY done — re-run with CONFIRM=1 to execute.'); return; }

  // 1. ensure >= mv4Amt MV4 (mint via deposit only if needed; RPC-lag tolerant)
  let have = await mv4.balanceOf(wallet.address);
  if (have < mv4Amt) {
    if ((await usdc.allowance(wallet.address, MV4)) < MINT_USDC){ console.log('approve USDC->vault'); await (await usdc.approve(MV4, MINT_USDC)).wait(); }
    console.log('deposit $5 USDC -> MV4...'); await (await mv4.deposit(MINT_USDC, {gasLimit:400000})).wait();
    for (let i=0; i<10 && have<mv4Amt; i++){ await new Promise(r=>setTimeout(r,2000)); have = await mv4.balanceOf(wallet.address); }
    console.log(`MV4 after deposit: ${ethers.formatUnits(have,6)}`);
    if (have < mv4Amt) throw new Error('still no MV4 after deposit (aborting before pool/LP)');
  } else {
    console.log(`already hold ${ethers.formatUnits(have,6)} MV4 — skipping deposit`);
  }

  // 2. create + init pool
  const npm = new ethers.Contract(NPM, NPMABI, wallet);
  console.log('createAndInitializePoolIfNecessary...');
  await (await npm.createAndInitializePoolIfNecessary(token0, token1, FEE, sqrtPriceX96, {gasLimit:6000000})).wait();

  // 3. verify pool price before adding liquidity (retry — fresh pool lags on public RPC)
  let poolAddr, s;
  for (let i=0; i<12; i++){
    try {
      poolAddr = await new ethers.Contract(V3F, FACT, provider).getPool(token0, token1, FEE);
      if (poolAddr && poolAddr !== ethers.ZeroAddress){ s = await new ethers.Contract(poolAddr, POOL, provider).slot0(); if (s) break; }
    } catch(e){}
    await new Promise(r=>setTimeout(r,2500));
  }
  if (!s) throw new Error('could not read pool slot0 after retries');
  const sp = Number(s.sqrtPriceX96)/2**96; const gotRaw = sp*sp; const gotHumanT0inUsd = (token0===TOKEN ? gotRaw*10**(d0-d1) : (1/gotRaw)*10**(d0-d1));
  const impliedTokUsd = token0===TOKEN ? gotHumanT0inUsd : gotHumanT0inUsd; // token price in MV4(~$1)
  console.log(`pool ${poolAddr} implied ${TSYM} price ~$${impliedTokUsd.toPrecision(5)} (target $${priceUsd.toPrecision(5)})`);
  if (Math.abs(impliedTokUsd - priceUsd)/priceUsd > 0.05) throw new Error('pool price off >5% — aborting before LP');

  // 4. approve + mint position (full range)
  if ((await tok.allowance(wallet.address, NPM)) < tokAmt){ console.log(`approve ${TSYM}->NPM`); await (await tok.approve(NPM, tokAmt)).wait(); }
  if ((await mv4.allowance(wallet.address, NPM)) < mv4Amt){ console.log('approve MV4->NPM'); await (await mv4.approve(NPM, mv4Amt)).wait(); }
  const params = { token0, token1, fee:FEE, tickLower:-887200, tickUpper:887200, amount0Desired, amount1Desired, amount0Min:0, amount1Min:0, recipient:wallet.address, deadline: Math.floor(Date.now()/1000)+600 };
  console.log('mint position...');
  const tx = await npm.mint(params, {gasLimit:1500000});
  const rc = await tx.wait();
  console.log('SEEDED ✅ tx', rc.hash);
  console.log('pool', poolAddr, '— WALL now has an MV4 LP and will appear on the leaderboard next run.');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
