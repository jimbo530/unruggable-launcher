/**
 * garden-keeper-multi.js — Keeper bot for CommunityGardenMulti contract.
 *
 * Runs via PM2 every 4 hours. Single execution, then exits.
 *
 * Flow:
 *  1. harvestAll() — collects V3 position fees to keeper wallet
 *  2. For each registered reward token:
 *       - 50% distributed to players via distributeReward()
 *       - 50% held by keeper for manual LP reinvestment
 *  3. For POOP specifically (also collected as fees):
 *       - 50% used to buy MfT and burn (swap POOP→MfT, send to dead address)
 *       - 50% held for LP reinvestment
 *  4. Logs everything, saves stats to garden-keeper-stats.json
 *
 * Env vars:
 *   GARDEN_MULTI_ADDRESS  — CommunityGardenMulti contract address
 *   KEEPER_PRIVATE_KEY    — keeper wallet private key
 *
 * PM2 example:
 *   pm2 start garden-keeper-multi.js --cron "0 *\/4 * * *" --no-autorestart
 */

require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────

const BASE_RPC          = 'https://mainnet.base.org';
const POOP_ADDRESS      = '0x126555aecBAC290b25644e4b7f29c016aE95f4dc';
const MFT_ADDRESS       = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const SWAP_ROUTER       = '0x2626664c2603336E57B271c5C0b26F421741e481';
const DEAD_ADDRESS      = '0x000000000000000000000000000000000000dEaD';
const STATS_FILE        = path.join(__dirname, 'garden-keeper-stats.json');
const FEE_RATES_FILE    = path.join(__dirname, 'pool-fee-rates.json');

// V2 LP pair addresses — food pools that baselings hold LP in
const FOOD_LP_POOLS = [
  { pair: 'tgn',     addr: '0xbd0cc3b0aaf91b80c862dbcaf39faa4705ee2d7a' },
  { pair: 'burgers', addr: '0xa2A61fD7816951A0bCf8C67eA8f153C1AB5De288' },
  { pair: 'azusd',   addr: '0xecc664757da0c71ba32dfed527580a26783b6697' },
  { pair: 'weth',    addr: '0x23ac5919b710b6a62bd2acf8be5cd29560bf1a78' },
  { pair: 'btc',     addr: '0x5ea3608d81f39b39c769b3f168991f743b03cc14' },
];
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Supabase (shared with server.js via .env)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

// 50/50 split for reward tokens  (player share / keeper reinvest hold)
const PLAYER_SHARE_BPS  = 5000; // 50%

// Gas auto-refill: if ETH balance drops below threshold, unwrap WETH to cover gas
const GAS_MIN_ETH       = ethers.parseEther('0.0002'); // refill when below this
const GAS_REFILL_ETH    = ethers.parseEther('0.001');  // unwrap this much WETH
const WETH_ADDRESS      = '0x4200000000000000000000000000000000000006';

// Swap settings (amountOutMinimum=0 since pools may be thin; keeper is trusted)

// ── ABIs (minimal) ──────────────────────────────────────────────────────

const GARDEN_ABI = [
  'function harvestAll() external',
  'function harvest(uint256 positionId) external',
  'function deposit(address gardener, uint256 poopAmount) external',
  'function distributeReward(address token, uint256 amount) external',
  'function rewardTokenCount() external view returns (uint256)',
  'function rewardTokens(uint256) external view returns (address)',
  'function positionCount() external view returns (uint256)',
  'function positions(uint256) external view returns (uint256)',
  'function keeper() external view returns (address)',
  'function totalSupply() external view returns (uint256)',
  'function totalDistributed(address) external view returns (uint256)',
  'function totalPOOPDeposited() external view returns (uint256)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
];

const WETH_ABI = [
  'function withdraw(uint256 amount)',
  'function deposit() payable',
  'function balanceOf(address) view returns (uint256)',
];

// ── Logging ─────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function logErr(msg, err) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ERROR: ${msg}`, err?.message || err);
}

// ── Pool fee snapshot (1 multicall = all V2 pools) ─────────────────────

const PAIR_ABI_IFACE = new ethers.Interface([
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function totalSupply() view returns (uint256)',
]);

function loadFeeRates() {
  try { return JSON.parse(fs.readFileSync(FEE_RATES_FILE, 'utf8')); }
  catch { return { ts: 0, pools: {} }; }
}

function saveFeeRates(data) {
  fs.writeFileSync(FEE_RATES_FILE, JSON.stringify(data, null, 2));
}

/**
 * Snapshot all V2 pool reserves + totalSupply in ONE multicall.
 * Compares to previous snapshot to compute real fee rate per pool.
 * V2 LP value-per-token = 2*sqrt(r0*r1) / totalSupply
 * Rate of change between snapshots = real fee yield.
 */
async function snapshotPoolFees(provider) {
  log('=== Pool fee snapshot (multicall) ===');
  const prev = loadFeeRates();

  // Build multicall: 2 calls per pool (getReserves + totalSupply)
  const calls = [];
  for (const pool of FOOD_LP_POOLS) {
    calls.push({
      target: pool.addr,
      callData: PAIR_ABI_IFACE.encodeFunctionData('getReserves'),
    });
    calls.push({
      target: pool.addr,
      callData: PAIR_ABI_IFACE.encodeFunctionData('totalSupply'),
    });
  }

  const mc = new ethers.Contract(MULTICALL3, [
    'function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)',
  ], provider);

  let results;
  try {
    const [, returnData] = await mc.aggregate(calls);
    results = returnData;
    log(`Multicall OK — ${results.length} results for ${FOOD_LP_POOLS.length} pools`);
  } catch (err) {
    logErr('Multicall failed', err);
    return;
  }

  const now = Date.now();
  const newPools = {};

  for (let i = 0; i < FOOD_LP_POOLS.length; i++) {
    const pool = FOOD_LP_POOLS[i];
    try {
      const reservesData = PAIR_ABI_IFACE.decodeFunctionResult('getReserves', results[i * 2]);
      const supplyData = PAIR_ABI_IFACE.decodeFunctionResult('totalSupply', results[i * 2 + 1]);

      const r0 = Number(reservesData[0]);
      const r1 = Number(reservesData[1]);
      const supply = Number(supplyData[0]);

      if (supply === 0) {
        log(`  ${pool.pair}: no liquidity, skipping`);
        newPools[pool.pair] = { vplt: 0, ts: now, feeRate: 0 };
        continue;
      }

      // Value-per-LP-token (geometric mean of reserves, normalized by supply)
      const vplt = 2 * Math.sqrt(r0 * r1) / supply;

      // Compare to previous snapshot to get real fee rate
      let feeRate = 0;
      const prevPool = prev.pools?.[pool.pair];
      if (prevPool && prevPool.vplt > 0 && prev.ts > 0) {
        const elapsed = (now - prev.ts) / (4 * 3600 * 1000); // in 4hr cycles
        if (elapsed > 0) {
          const growth = (vplt - prevPool.vplt) / prevPool.vplt;
          feeRate = Math.max(0, growth / elapsed); // rate per 4hr cycle
        }
      }

      newPools[pool.pair] = { vplt, ts: now, feeRate };
      log(`  ${pool.pair}: vplt=${vplt.toExponential(4)}, feeRate=${(feeRate * 100).toFixed(6)}% per cycle`);
    } catch (err) {
      logErr(`  ${pool.pair} decode failed`, err);
      newPools[pool.pair] = { vplt: 0, ts: now, feeRate: 0 };
    }
  }

  const feeData = { ts: now, pools: newPools };
  saveFeeRates(feeData);
  log('Pool fee rates saved.');
  return feeData;
}

// ── Stats ───────────────────────────────────────────────────────────────

function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch {
    return { runs: [], lastRun: null };
  }
}

function saveStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

// ── Supabase helpers ────────────────────────────────────────────────────

async function fetchPendingDeposits() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log('Supabase not configured — skipping deposit processing.');
    return [];
  }
  const url = `${SUPABASE_URL}/rest/v1/tree_deposits?status=eq.pending&order=created_at.asc&limit=50`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase query failed: ${res.status} ${errText}`);
  }
  return res.json();
}

async function updateDepositStatus(id, status, txHash) {
  const url = `${SUPABASE_URL}/rest/v1/tree_deposits?id=eq.${id}`;
  const body = { status };
  if (txHash) body.tx_hash = txHash;
  body.processed_at = new Date().toISOString();
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    log(`  Warning: status update for deposit ${id} failed: ${errText}`);
  }
}

// Process pending garden deposits: read from Supabase, call garden.deposit() on-chain
async function processDeposits(garden, poopToken, wallet, gardenAddress, runStats) {
  let deposits;
  try {
    deposits = await fetchPendingDeposits();
  } catch (err) {
    logErr('Failed fetching pending deposits', err);
    runStats.errors.push(`deposits fetch: ${err.message}`);
    return;
  }

  if (deposits.length === 0) {
    log('No pending deposits.');
    runStats.depositsProcessed = 0;
    return;
  }

  log(`Found ${deposits.length} pending deposit(s).`);

  // Check keeper POOP balance
  const poopBalance = await poopToken.balanceOf(wallet.address);
  let poopAvailable = poopBalance;
  log(`Keeper POOP balance for deposits: ${ethers.formatEther(poopBalance)}`);

  // Ensure garden is approved to pull POOP from keeper
  const gardenAllowance = await poopToken.allowance(wallet.address, gardenAddress);
  if (gardenAllowance < poopBalance && poopBalance > 0n) {
    log('Approving garden to spend keeper POOP...');
    const appTx = await poopToken.approve(gardenAddress, ethers.MaxUint256);
    await appTx.wait();
    log('Approved.');
  }

  let processed = 0;
  let deferred = 0;

  for (const dep of deposits) {
    const amount = ethers.parseEther(String(dep.poop_amount));
    const gardener = dep.wallet_address;

    if (amount <= 0n) {
      await updateDepositStatus(dep.id, 'invalid', null);
      continue;
    }

    if (amount > poopAvailable) {
      log(`  Deposit ${dep.id}: need ${ethers.formatEther(amount)} POOP but only ${ethers.formatEther(poopAvailable)} available — deferring.`);
      deferred++;
      continue;
    }

    try {
      log(`  Processing deposit ${dep.id}: ${dep.poop_amount} POOP → ${gardener}`);
      const tx = await garden.deposit(gardener, amount);
      const receipt = await tx.wait();
      log(`  Deposit confirmed — tx: ${receipt.hash}, gas: ${receipt.gasUsed.toString()}`);

      await updateDepositStatus(dep.id, 'confirmed', receipt.hash);
      poopAvailable -= amount;
      processed++;
    } catch (err) {
      logErr(`  Deposit ${dep.id} failed`, err);
      await updateDepositStatus(dep.id, 'failed', null);
      runStats.errors.push(`deposit ${dep.id}: ${err.message}`);
    }
  }

  log(`Deposits: ${processed} processed, ${deferred} deferred (insufficient POOP).`);
  runStats.depositsProcessed = processed;
  runStats.depositsDeferred = deferred;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  log('=== Garden Keeper Multi — starting ===');

  // ── Validate env ──
  const GARDEN_ADDRESS = process.env.GARDEN_MULTI_ADDRESS;
  const PRIVATE_KEY    = process.env.KEEPER_PRIVATE_KEY;

  if (!GARDEN_ADDRESS) {
    logErr('GARDEN_MULTI_ADDRESS env var not set');
    process.exit(1);
  }
  if (!PRIVATE_KEY) {
    logErr('KEEPER_PRIVATE_KEY env var not set');
    process.exit(1);
  }

  // ── Connect ──
  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
  const garden   = new ethers.Contract(GARDEN_ADDRESS, GARDEN_ABI, wallet);
  const poopToken = new ethers.Contract(POOP_ADDRESS, ERC20_ABI, wallet);

  log(`Keeper wallet: ${wallet.address}`);
  log(`Garden contract: ${GARDEN_ADDRESS}`);

  // ── Step 0: Gas auto-refill ──
  // If ETH balance is low, unwrap WETH to cover future gas costs
  try {
    const ethBalance = await provider.getBalance(wallet.address);
    log(`ETH balance: ${ethers.formatEther(ethBalance)}`);

    if (ethBalance < GAS_MIN_ETH) {
      const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
      const wethBalance = await weth.balanceOf(wallet.address);
      log(`ETH low! Checking WETH: ${ethers.formatEther(wethBalance)}`);

      if (wethBalance >= GAS_REFILL_ETH) {
        log(`Unwrapping ${ethers.formatEther(GAS_REFILL_ETH)} WETH → ETH for gas...`);
        const tx = await weth.withdraw(GAS_REFILL_ETH);
        await tx.wait();
        log('Gas refill complete.');
      } else if (wethBalance > 0n) {
        log(`Unwrapping all WETH (${ethers.formatEther(wethBalance)}) → ETH for gas...`);
        const tx = await weth.withdraw(wethBalance);
        await tx.wait();
        log('Partial gas refill complete.');
      } else {
        log('WARNING: Low ETH and no WETH available for gas refill!');
      }
    }
  } catch (err) {
    logErr('Gas refill check failed', err);
  }

  // Verify keeper role
  const onChainKeeper = await garden.keeper();
  if (onChainKeeper.toLowerCase() !== wallet.address.toLowerCase()) {
    logErr(`Wallet ${wallet.address} is not the keeper. On-chain keeper: ${onChainKeeper}`);
    process.exit(1);
  }

  const runStats = {
    timestamp: new Date().toISOString(),
    harvested: false,
    positionCount: 0,
    depositsProcessed: 0,
    depositsDeferred: 0,
    rewardTokens: [],
    distributed: {},
    poopBuyBurn: { swapped: '0', mftBurned: '0' },
    errors: [],
  };

  // ── Step 1: Harvest all positions ──
  try {
    const posCount = await garden.positionCount();
    runStats.positionCount = Number(posCount);
    log(`Positions in garden: ${posCount}`);

    if (posCount > 0) {
      log('Calling harvestAll()...');
      const tx = await garden.harvestAll();
      const receipt = await tx.wait();
      log(`harvestAll() confirmed — tx: ${receipt.hash}, gas: ${receipt.gasUsed.toString()}`);
      runStats.harvested = true;
    } else {
      log('No positions to harvest, skipping.');
    }
  } catch (err) {
    logErr('harvestAll() failed', err);
    runStats.errors.push(`harvest: ${err.message}`);
  }

  // ── Step 1a: Mint pending flower purchases ──
  try {
    if (SUPABASE_URL && SUPABASE_KEY) {
      const flowerRes = await fetch(`${SUPABASE_URL}/rest/v1/flower_purchases?status=eq.pending&order=created_at.asc&limit=20`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      });
      if (flowerRes.ok) {
        const purchases = await flowerRes.json();
        if (purchases.length > 0) {
          log(`Found ${purchases.length} pending flower mint(s).`);
          const FLOWER_ADDR = process.env.FLOWER_NFT_ADDRESS;
          if (FLOWER_ADDR) {
            const flowerABI = ['function mint(address,uint8,uint8) returns (uint256)'];
            const flowerContract = new ethers.Contract(FLOWER_ADDR, flowerABI, wallet);
            for (const p of purchases) {
              try {
                log(`  Minting flower type=${p.flower_type} rarity=${p.rarity} → ${p.wallet_address}`);
                const tx = await flowerContract.mint(p.wallet_address, p.flower_type, p.rarity);
                const receipt = await tx.wait();
                // Extract tokenId from Transfer event (topic[3])
                let tokenId = null;
                for (const l of receipt.logs) {
                  if (l.topics.length === 4 && l.topics[0] === ethers.id('Transfer(address,address,uint256)')) {
                    tokenId = Number(BigInt(l.topics[3]));
                    break;
                  }
                }
                log(`  Minted flower #${tokenId} — tx: ${receipt.hash}`);
                await updateDepositStatus(p.id, 'confirmed', receipt.hash);
                // Update with token_id
                await fetch(`${SUPABASE_URL}/rest/v1/flower_purchases?id=eq.${p.id}`, {
                  method: 'PATCH',
                  headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'confirmed', tx_hash: receipt.hash, token_id: tokenId, processed_at: new Date().toISOString() }),
                });
              } catch (mintErr) {
                logErr(`  Flower mint failed for ${p.id}`, mintErr);
                await fetch(`${SUPABASE_URL}/rest/v1/flower_purchases?id=eq.${p.id}`, {
                  method: 'PATCH',
                  headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'failed', processed_at: new Date().toISOString() }),
                });
              }
            }
          } else {
            log('FLOWER_NFT_ADDRESS not set — skipping flower mints.');
          }
        }
      }
    }
  } catch (err) {
    logErr('Flower mint processing failed', err);
    runStats.errors.push(`flower mints: ${err.message}`);
  }

  // ── Step 1b: Process pending player deposits ──
  // Runs after harvest (so keeper has fresh POOP from fees) but before
  // reward distribution (so new depositors receive gPOOP shares first)
  await processDeposits(garden, poopToken, wallet, GARDEN_ADDRESS, runStats);

  // ── Step 2: Get reward token list ──
  let rewardTokenAddresses = [];
  try {
    const tokenCount = await garden.rewardTokenCount();
    log(`Registered reward tokens: ${tokenCount}`);

    for (let i = 0; i < Number(tokenCount); i++) {
      const addr = await garden.rewardTokens(i);
      rewardTokenAddresses.push(addr);
    }
  } catch (err) {
    logErr('Failed reading reward tokens', err);
    runStats.errors.push(`rewardTokens: ${err.message}`);
  }

  // ── Step 3: Process each reward token ──
  //  - For non-POOP tokens: 50% distribute to players, 50% hold for LP reinvest
  //  - For POOP: handled separately in step 4

  const totalSupply = await garden.totalSupply();
  const hasDepositors = totalSupply > 0n;
  log(`Garden totalSupply (gPOOP): ${ethers.formatEther(totalSupply)}`);

  for (const tokenAddr of rewardTokenAddresses) {
    // Skip POOP (handled in step 4) and MfT (burned in step 3b)
    if (tokenAddr.toLowerCase() === POOP_ADDRESS.toLowerCase()) {
      log(`Skipping ${tokenAddr} in reward loop (POOP handled separately)`);
      runStats.rewardTokens.push({ address: tokenAddr, symbol: 'POOP', note: 'handled separately' });
      continue;
    }
    if (tokenAddr.toLowerCase() === MFT_ADDRESS.toLowerCase()) {
      log(`Skipping ${tokenAddr} in reward loop (MfT burned in step 3b)`);
      runStats.rewardTokens.push({ address: tokenAddr, symbol: 'MfT', note: 'burned' });
      continue;
    }

    try {
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
      let sym = 'UNKNOWN';
      try { sym = await token.symbol(); } catch {}
      let dec = 18;
      try { dec = Number(await token.decimals()); } catch {}

      const balance = await token.balanceOf(wallet.address);
      const formatted = ethers.formatUnits(balance, dec);
      log(`Token ${sym} (${tokenAddr}): keeper balance = ${formatted}`);

      if (balance === 0n) {
        log(`  No ${sym} to distribute, skipping.`);
        runStats.rewardTokens.push({ address: tokenAddr, symbol: sym, balance: '0', distributed: '0' });
        continue;
      }

      // 50% to players
      const playerAmount = balance * BigInt(PLAYER_SHARE_BPS) / 10000n;
      // remainder stays in keeper wallet for reinvesting
      const keeperAmount = balance - playerAmount;

      log(`  Split: ${ethers.formatUnits(playerAmount, dec)} ${sym} to players, ${ethers.formatUnits(keeperAmount, dec)} ${sym} held for reinvest`);

      if (playerAmount > 0n && hasDepositors) {
        // Approve garden to pull tokens
        const currentAllowance = await token.allowance(wallet.address, GARDEN_ADDRESS);
        if (currentAllowance < playerAmount) {
          log(`  Approving garden to spend ${sym}...`);
          const appTx = await token.approve(GARDEN_ADDRESS, ethers.MaxUint256);
          await appTx.wait();
          log(`  Approved.`);
        }

        log(`  Calling distributeReward(${sym}, ${ethers.formatUnits(playerAmount, dec)})...`);
        const distTx = await garden.distributeReward(tokenAddr, playerAmount);
        const distReceipt = await distTx.wait();
        log(`  distributeReward() confirmed — tx: ${distReceipt.hash}`);

        runStats.distributed[sym] = ethers.formatUnits(playerAmount, dec);
      } else if (!hasDepositors) {
        log(`  No depositors in garden — holding all ${sym} until players join.`);
      }

      runStats.rewardTokens.push({
        address: tokenAddr,
        symbol: sym,
        balance: formatted,
        distributed: hasDepositors ? ethers.formatUnits(playerAmount, dec) : '0',
        heldForReinvest: ethers.formatUnits(keeperAmount, dec),
      });
    } catch (err) {
      logErr(`Failed processing reward token ${tokenAddr}`, err);
      runStats.errors.push(`distribute ${tokenAddr}: ${err.message}`);
    }
  }

  // ── Step 3b: Burn all MfT fees (collected from token/MfT positions) ──
  try {
    const mftToken = new ethers.Contract(MFT_ADDRESS, ERC20_ABI, wallet);
    const mftBalance = await mftToken.balanceOf(wallet.address);
    log(`MfT balance (from position fees): ${ethers.formatEther(mftBalance)}`);

    if (mftBalance > 0n) {
      log(`  Burning ${ethers.formatEther(mftBalance)} MfT to dead address...`);
      const burnTx = await mftToken.transfer(DEAD_ADDRESS, mftBalance);
      const burnReceipt = await burnTx.wait();
      log(`  MfT burned — tx: ${burnReceipt.hash}`);
      runStats.mftBurned = ethers.formatEther(mftBalance);
    } else {
      log('  No MfT fees to burn.');
      runStats.mftBurned = '0';
    }
  } catch (err) {
    logErr('MfT fee burn failed', err);
    runStats.errors.push(`mft burn: ${err.message}`);
  }

  // ── Step 4: POOP — buy-and-burn MfT + hold for reinvest ──
  try {
    const poopBalance = await poopToken.balanceOf(wallet.address);
    const poopFormatted = ethers.formatEther(poopBalance);
    log(`POOP balance: ${poopFormatted}`);

    if (poopBalance > 0n) {
      // 50% for buy-and-burn, 50% hold for LP reinvest
      const burnAmount   = poopBalance * 5000n / 10000n;
      const reinvestHold = poopBalance - burnAmount;

      log(`  POOP split: ${ethers.formatEther(burnAmount)} for buy+burn MfT, ${ethers.formatEther(reinvestHold)} held for reinvest`);

      if (burnAmount > 0n) {
        // Approve SwapRouter to spend POOP
        const poopAllowance = await poopToken.allowance(wallet.address, SWAP_ROUTER);
        if (poopAllowance < burnAmount) {
          log('  Approving SwapRouter for POOP...');
          const appTx = await poopToken.approve(SWAP_ROUTER, ethers.MaxUint256);
          await appTx.wait();
          log('  Approved.');
        }

        // Swap POOP → MfT via Uniswap V3
        const router = new ethers.Contract(SWAP_ROUTER, SWAP_ROUTER_ABI, wallet);
        const mftToken = new ethers.Contract(MFT_ADDRESS, ERC20_ABI, wallet);
        const mftBefore = await mftToken.balanceOf(wallet.address);

        // Try 1% fee tier first, then 0.3%, then 0.05%
        const feeTiers = [10000, 3000, 500];
        let swapSuccess = false;
        let mftReceived = 0n;

        for (const fee of feeTiers) {
          try {
            log(`  Trying swap POOP→MfT with fee tier ${fee / 10000}%...`);

            const swapParams = {
              tokenIn: POOP_ADDRESS,
              tokenOut: MFT_ADDRESS,
              fee: fee,
              recipient: wallet.address, // receive MfT to keeper first
              amountIn: burnAmount,
              amountOutMinimum: burnAmount / 100n, // 1% minimum protects against sandwich attacks
              sqrtPriceLimitX96: 0n,
            };

            const swapTx = await router.exactInputSingle(swapParams);
            const swapReceipt = await swapTx.wait();

            // Measure delta to get exact amount received from this swap
            const mftAfter = await mftToken.balanceOf(wallet.address);
            mftReceived = mftAfter - mftBefore;

            log(`  Swap confirmed — tx: ${swapReceipt.hash}`);
            log(`  MfT received: ${ethers.formatEther(mftReceived)}`);
            swapSuccess = true;
            break;
          } catch (swapErr) {
            log(`  Fee tier ${fee} failed: ${swapErr.message}`);
          }
        }

        if (swapSuccess && mftReceived > 0n) {
          // Burn MfT by sending to dead address
          try {
            log(`  Burning ${ethers.formatEther(mftReceived)} MfT to dead address...`);
            const burnTx = await mftToken.transfer(DEAD_ADDRESS, mftReceived);
            const burnReceipt = await burnTx.wait();
            log(`  MfT burned — tx: ${burnReceipt.hash}`);

            runStats.poopBuyBurn = {
              poopSwapped: ethers.formatEther(burnAmount),
              mftBurned: ethers.formatEther(mftReceived),
            };
          } catch (burnErr) {
            logErr('MfT burn (transfer to dead) failed', burnErr);
            runStats.errors.push(`mft burn: ${burnErr.message}`);
          }
        } else if (!swapSuccess) {
          log('  All swap fee tiers failed — holding POOP for next run.');
          runStats.errors.push('poop→mft swap: all fee tiers failed');
        }
      }
    } else {
      log('No POOP balance, skipping buy-and-burn.');
    }
  } catch (err) {
    logErr('POOP buy-and-burn step failed', err);
    runStats.errors.push(`poop: ${err.message}`);
  }

  // ── Step 4b: Snapshot V2 pool fees (1 multicall, all pools) ──
  try {
    await snapshotPoolFees(provider);
  } catch (err) {
    logErr('Pool fee snapshot failed', err);
    runStats.errors.push(`fee snapshot: ${err.message}`);
  }

  // ── Step 5: Save stats ──
  const stats = loadStats();
  stats.lastRun = runStats.timestamp;
  stats.runs.push(runStats);
  // Keep last 100 runs
  if (stats.runs.length > 100) {
    stats.runs = stats.runs.slice(-100);
  }
  saveStats(stats);

  log(`Stats saved to ${STATS_FILE}`);
  log(`Errors this run: ${runStats.errors.length}`);
  if (runStats.errors.length > 0) {
    runStats.errors.forEach(e => log(`  - ${e}`));
  }
  log('=== Garden Keeper Multi — done ===');
}

main().catch(err => {
  logErr('Fatal error', err);
  process.exit(1);
});
