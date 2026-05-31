require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const BURGERS_REACTOR = '0x4114C992F6E4A0597df92eE71b5186d731358B33';
const BURGERS = '0x06A05043eb2C1691b19c2C13219dB9212269dDc5';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

// Paired tokens
const MfT    = ethers.getAddress('0x8fb87d13b40b1a67b22ed1a17e2835fe7e3a9ba3');
const MfTUSD = ethers.getAddress('0xe96fa44b4b82f085a457f9b7a0f85ea26ff1652f');
const TETH   = ethers.getAddress('0x7d545427c8f548f3a00c1c09b5360bf3d4b842ef');
const TBTC   = ethers.getAddress('0x53b6de1726856c4615dc3b05d45993bc1aa3403c');

const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

const NPM_ABI = [
  'function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)',
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
];

const REACTOR_ABI = [
  'function addPool(address)',
  'function poolCount() view returns (uint256)'
];

const FEE = 10000; // 1%
const TICK_SPACING = 200;
const MAX_TICK = Math.floor(887272 / TICK_SPACING) * TICK_SPACING; // 887200
const TICK_LOW = -MAX_TICK;
const TICK_HIGH = MAX_TICK;

// Prices: BURGERS ~$0.0000011, MfT ~$0.000000408, TETH/TBTC/MfTUSD ~$1.00
// All tokens 18 dec except MfTUSD = 6 dec

function sortTokens(tokenA, tokenB) {
  return tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
}

function calcSqrtPriceX96(priceToken1PerToken0) {
  // sqrtPriceX96 = sqrt(price) * 2^96
  const sqrtPrice = Math.sqrt(priceToken1PerToken0);
  const Q96 = BigInt(2) ** BigInt(96);
  // Use BigInt for precision
  const sqrtPriceBig = BigInt(Math.round(sqrtPrice * 1e18));
  return (sqrtPriceBig * Q96) / BigInt(1e18);
}

async function main() {
  const provider = new ethers.JsonRpcProvider('https://base.publicnode.com');
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const reactor = new ethers.Contract(BURGERS_REACTOR, REACTOR_ABI, wallet);

  console.log('Deployer:', wallet.address);
  console.log('ETH:', ethers.formatEther(await provider.getBalance(wallet.address)));

  const pairs = [
    { name: 'BURGERS/MfT',    token: MfT,    dec: 18, price: 0.000000408 },
    { name: 'BURGERS/MfTUSD', token: MfTUSD, dec: 6,  price: 1.0 },
    { name: 'BURGERS/TETH',   token: TETH,   dec: 18, price: 1.0 },
    { name: 'BURGERS/TBTC',   token: TBTC,   dec: 18, price: 1.0 },
  ];

  const burgersPrice = 0.0000011;

  // Approve all tokens to NPM (max)
  console.log('\n--- Approving tokens to NPM ---');
  const allTokens = [BURGERS, MfT, MfTUSD, TETH, TBTC];
  for (const addr of allTokens) {
    const c = new ethers.Contract(addr, ERC20_ABI, wallet);
    const sym = await c.symbol();
    const tx = await c.approve(NPM, ethers.MaxUint256);
    await tx.wait();
    console.log('Approved', sym);
  }

  for (const pair of pairs) {
    console.log(`\n=== ${pair.name} ===`);
    const [token0, token1] = sortTokens(BURGERS, pair.token);
    const burgersIsToken0 = token0.toLowerCase() === BURGERS.toLowerCase();
    console.log('token0:', token0, burgersIsToken0 ? '(BURGERS)' : '(X)');
    console.log('token1:', token1, burgersIsToken0 ? '(X)' : '(BURGERS)');

    // Calculate price ratio: token1 per token0 in raw units
    // BURGERS price / X price = how many X tokens per 1 BURGERS (in USD terms)
    // Then adjust for decimals
    const burgersPerX = pair.price / burgersPrice; // X tokens worth in BURGERS
    // priceToken1PerToken0_human = token1_amount / token0_amount for equal value
    let priceHuman;
    if (burgersIsToken0) {
      // token0=BURGERS(18), token1=X(pair.dec)
      // 1 BURGERS is worth (burgersPrice/pair.price) X tokens in human
      priceHuman = burgersPrice / pair.price;
      // raw price = priceHuman * 10^(token1_dec) / 10^(token0_dec) = priceHuman * 10^(pair.dec - 18)
    } else {
      // token0=X(pair.dec), token1=BURGERS(18)
      // 1 X token is worth (pair.price/burgersPrice) BURGERS in human
      priceHuman = pair.price / burgersPrice;
      // raw price = priceHuman * 10^(18) / 10^(pair.dec) = priceHuman * 10^(18 - pair.dec)
    }

    let rawPrice;
    if (burgersIsToken0) {
      rawPrice = priceHuman * Math.pow(10, pair.dec - 18);
    } else {
      rawPrice = priceHuman * Math.pow(10, 18 - pair.dec);
    }

    console.log('priceHuman:', priceHuman, 'rawPrice:', rawPrice);
    const sqrtPriceX96 = calcSqrtPriceX96(rawPrice);
    console.log('sqrtPriceX96:', sqrtPriceX96.toString());

    // Create pool
    console.log('Creating pool...');
    let poolAddr;
    try {
      const tx = await npm.createAndInitializePoolIfNecessary(token0, token1, FEE, sqrtPriceX96);
      const receipt = await tx.wait();
      console.log('Pool created, tx:', tx.hash);
      // Find pool address from event
      const poolCreatedTopic = ethers.id('PoolCreated(address,address,uint24,int24,address)');
      const poolLog = receipt.logs.find(l => l.topics[0] === poolCreatedTopic);
      if (poolLog) {
        poolAddr = '0x' + poolLog.data.slice(-40);
        // Actually it's the last 20 bytes of the last topic or data
        const iface = new ethers.Interface(['event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)']);
        const decoded = iface.parseLog({ topics: poolLog.topics, data: poolLog.data });
        poolAddr = decoded.args.pool;
      }
    } catch(e) {
      // Pool might already exist
      console.log('Pool may exist:', e.message?.slice(0, 80));
      // Get pool address from factory
      const factory = new ethers.Contract('0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
        ['function getPool(address,address,uint24) view returns (address)'], provider);
      poolAddr = await factory.getPool(token0, token1, FEE);
    }
    console.log('Pool address:', poolAddr);

    // Seed amounts: 27000 BURGERS per pool
    const burgersAmount = ethers.parseUnits('27000', 18);
    let xAmount;
    if (pair.dec === 6) {
      // MfTUSD: 27000 * $0.0000011 / $1.0 = 0.0297
      xAmount = ethers.parseUnits('0.0297', 6);
    } else if (pair.token === MfT) {
      // MfT: 27000 * $0.0000011 / $0.000000408 = ~72794
      xAmount = ethers.parseUnits('72794', 18);
    } else {
      // TETH/TBTC: 27000 * $0.0000011 / $1.0 = 0.0297
      xAmount = ethers.parseUnits('0.0297', 18);
    }

    const amount0 = burgersIsToken0 ? burgersAmount : xAmount;
    const amount1 = burgersIsToken0 ? xAmount : burgersAmount;

    console.log('Minting position... amount0:', amount0.toString(), 'amount1:', amount1.toString());
    const deadline = Math.floor(Date.now() / 1000) + 600;

    try {
      const mintTx = await npm.mint({
        token0, token1, fee: FEE,
        tickLower: TICK_LOW, tickUpper: TICK_HIGH,
        amount0Desired: amount0, amount1Desired: amount1,
        amount0Min: 0n, amount1Min: 0n,
        recipient: wallet.address, deadline
      });
      const receipt = await mintTx.wait();
      const transferTopic = ethers.id('Transfer(address,address,uint256)');
      const transferLog = receipt.logs.find(l =>
        l.address.toLowerCase() === NPM.toLowerCase() && l.topics[0] === transferTopic
      );
      const tokenId = transferLog ? BigInt(transferLog.topics[3]) : 'unknown';
      console.log('Minted NFT #' + tokenId);
    } catch(e) {
      console.log('Mint failed:', e.message?.slice(0, 120));
    }

    // Add pool to reactor
    if (poolAddr && poolAddr !== ethers.ZeroAddress) {
      console.log('Adding pool to reactor...');
      try {
        const tx = await reactor.addPool(poolAddr);
        await tx.wait();
        console.log('Pool added to reactor!');
      } catch(e) {
        console.log('addPool failed:', e.message?.slice(0, 80));
      }
    }

    // Small delay between pools
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n=== DONE ===');
  console.log('Reactor:', BURGERS_REACTOR);
  console.log('Pool count:', (await reactor.poolCount()).toString());
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
