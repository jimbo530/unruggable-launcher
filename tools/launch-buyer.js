#!/usr/bin/env node
/**
 * launch-buyer.js — watches factory for new launches, auto-buys via DCA
 *
 * Polls factory every 60s. When a new token is detected:
 *   - Waits 2 minutes (let pools settle)
 *   - DCA buys $2 total in $0.10 chunks, 60s apart
 *   - Route: WETH → MfT → TOKEN via V3 multi-hop (10000 fee tiers)
 *   - Uses TRADE_PRIVATE_KEY (trade wallet)
 *
 * Usage: node launch-buyer.js
 * PM2:   pm2 start launch-buyer.js --name launch-buyer
 */

const path = require('path');
const fs = require('fs');
const localEnv = path.join(__dirname, '..', '..', 'Baselings', 'api', '.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '.env') });
const { ethers } = require('ethers');

// --- Config ---
const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const PK  = process.env.TRADE_PRIVATE_KEY;

const FACTORY       = '0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51';
const FACTORY_BLOCK  = 45639600;
const POLL_MS        = 60_000;       // check for new launches every 60s
const SETTLE_MS      = 120_000;      // wait 2min after launch before buying
const BUY_PER_SWAP   = 0.10;         // $0.10 max per swap (project rule)
const BUY_INTERVAL   = 60_000;       // 60s between swaps (project rule: 1/min)
const SLIPPAGE_BPS   = 300;          // 3% slippage protection
const GAS_RESERVE    = ethers.parseEther('0.0003');

const STATE_FILE = path.join(__dirname, 'launch-buyer-state.json');

// --- Addresses ---
const WETH_ADDR = '0x4200000000000000000000000000000000000006';
const MFT_ADDR  = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const USDC_ADDR = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const V2_ROUTER = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';
const V3_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';

// --- ABIs ---
const FACTORY_ABI = [
  'event TokenLaunched(address indexed token, address indexed reactor, address indexed charReactor, address launcher, string name, string symbol, uint256 supply, uint256 seed)'
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

const V2_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
];

const V3_ABI = [
  {
    inputs: [{ components: [
      { name: 'path', type: 'bytes' }, { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' },
    ], name: 'params', type: 'tuple' }],
    name: 'exactInput', outputs: [{ type: 'uint256' }],
    stateMutability: 'payable', type: 'function',
  },
];

const WETH_ABI = ['function deposit() payable', ...ERC20_ABI];

// --- Helpers ---
function ts() { return new Date().toISOString().slice(11, 19); }
function short(a) { return a.slice(0, 6) + '...' + a.slice(-4); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function encodePath(tokens, fees) {
  let encoded = '0x';
  for (let i = 0; i < tokens.length; i++) {
    encoded += tokens[i].slice(2).toLowerCase();
    if (i < fees.length) encoded += fees[i].toString(16).padStart(6, '0');
  }
  return encoded;
}

async function getEthPrice(provider) {
  const v2 = new ethers.Contract(V2_ROUTER, V2_ABI, provider);
  try {
    const out = await v2.getAmountsOut(ethers.parseEther('0.001'), [WETH_ADDR, USDC_ADDR]);
    return Number(out[1]) / 1e6 * 1000;
  } catch (e) {
    console.warn('[launch-buyer] ETH price fallback $2500:', e.message || e);
    return 2500;
  }
}

// --- State ---
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return { lastBlock: 0, bought: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Buy logic ---
async function buyToken(wallet, provider, tokenAddr, symbol, seedUsd) {
  const ethPrice = await getEthPrice(provider);

  // Dynamic total: 10% of seed, clamped $1-$10
  const buyTotal = Math.max(1, Math.min(10, seedUsd * 0.10));
  const swapsNeeded = Math.ceil(buyTotal / BUY_PER_SWAP);

  console.log(`[${ts()}] DCA buying $${buyTotal.toFixed(2)} of ${symbol} (${short(tokenAddr)}) [10% of $${seedUsd} seed]`);
  console.log(`[${ts()}]   ${swapsNeeded} swaps of $${BUY_PER_SWAP}, ${BUY_INTERVAL / 1000}s apart`);
  console.log(`[${ts()}]   Route: WETH -> MfT -> ${symbol} (V3 multi-hop, ${SLIPPAGE_BPS / 100}% slippage)`);

  const weth = new ethers.Contract(WETH_ADDR, WETH_ABI, wallet);
  const v3 = new ethers.Contract(V3_ROUTER, V3_ABI, wallet);
  // WETH(10000)→MfT(10000)→TOKEN
  const path = encodePath([WETH_ADDR, MFT_ADDR, tokenAddr], [10000, 10000]);

  // Upfront: wrap total ETH needed + approve once (saves gas vs per-swap)
  const totalEthNeeded = buyTotal / ethPrice;
  const totalWei = ethers.parseEther(totalEthNeeded.toFixed(18));
  const bal = await provider.getBalance(wallet.address);
  if (bal < totalWei + GAS_RESERVE) {
    console.log(`[${ts()}]   Not enough ETH. Need ~${ethers.formatEther(totalWei)}, have ${ethers.formatEther(bal)}`);
    return { bought: 0, spent: 0 };
  }

  // Wrap all WETH upfront
  await (await weth.deposit({ value: totalWei })).wait();
  console.log(`[${ts()}]   Wrapped ${ethers.formatEther(totalWei)} ETH → WETH`);

  // Approve once
  const allowance = await weth.allowance(wallet.address, V3_ROUTER);
  if (allowance < totalWei) {
    await (await weth.approve(V3_ROUTER, ethers.MaxUint256)).wait();
  }

  let bought = 0;
  let spent = 0;

  for (let i = 0; i < swapsNeeded; i++) {
    const thisUsd = Math.min(BUY_PER_SWAP, buyTotal - spent);
    const ethAmt = thisUsd / ethPrice;
    const ethWei = ethers.parseEther(ethAmt.toFixed(18));

    try {
      // Get quote for slippage calc (use V2 as rough oracle)
      let minOut = 0n;
      try {
        const v2 = new ethers.Contract(V2_ROUTER, V2_ABI, provider);
        const amts = await v2.getAmountsOut(ethWei, [WETH_ADDR, MFT_ADDR]);
        // 3% slippage tolerance on quoted amount
        minOut = amts[1] * 97n / 100n;
      } catch (e) { console.warn('[launch-buyer] V2 quote failed, using 0 minOut:', e.message || e); }

      const tx = await v3.exactInput({
        path,
        recipient: wallet.address,
        amountIn: ethWei,
        amountOutMinimum: minOut,
      });
      const r = await tx.wait();

      spent += thisUsd;
      bought++;
      console.log(`[${ts()}]   ${bought}/${swapsNeeded} | $${spent.toFixed(2)}/$${buyTotal.toFixed(2)} | gas: ${r.gasUsed} | tx: ${r.hash.slice(0, 14)}...`);

    } catch (e) {
      console.log(`[${ts()}]   Swap ${i + 1} failed: ${(e.reason || e.message || '').slice(0, 100)}`);
    }

    if (i < swapsNeeded - 1) {
      await sleep(BUY_INTERVAL);
    }
  }

  // Show final balance
  const tokenContract = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
  try {
    const finalBal = await tokenContract.balanceOf(wallet.address);
    console.log(`[${ts()}]   Done! ${symbol} balance: ${ethers.formatUnits(finalBal, 18)}`);
  } catch (e) {
    console.warn('[launch-buyer] final balance read:', e.message || e);
    console.log(`[${ts()}]   Done! ${bought} swaps, ~$${spent.toFixed(2)} spent`);
  }

  return { bought, spent };
}

// --- Poller ---
async function poll(provider, wallet, state) {
  try {
    const currentBlock = await provider.getBlockNumber();

    // Fresh start: seed from current block (only catch NEW launches)
    if (!state.lastBlock) state.lastBlock = currentBlock;
    if (currentBlock <= state.lastBlock) return;

    const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
    const CHUNK = 9999;
    const newLaunches = [];

    for (let from = state.lastBlock + 1; from <= currentBlock; from += CHUNK + 1) {
      const to = Math.min(from + CHUNK, currentBlock);
      try {
        const events = await factory.queryFilter('TokenLaunched', from, to);
        for (const ev of events) {
          const token = ev.args.token;
          if (!state.bought[token]) {
            newLaunches.push({
              token,
              symbol: ev.args.symbol,
              name: ev.args.name,
              seed: ethers.formatUnits(ev.args.seed, 6),
              launcher: ev.args.launcher,
              block: ev.blockNumber,
            });
          }
        }
      } catch (e) {
        console.error(`[${ts()}] Chunk ${from}-${to} failed: ${e.message.slice(0, 80)}`);
      }
    }

    state.lastBlock = currentBlock;
    saveState(state);

    for (const launch of newLaunches) {
      console.log('');
      console.log(`[${ts()}] NEW LAUNCH: ${launch.symbol} (${launch.name})`);
      console.log(`[${ts()}]   Token: ${launch.token}`);
      console.log(`[${ts()}]   Seed: $${launch.seed} USDC | Launcher: ${short(launch.launcher)}`);
      console.log(`[${ts()}]   Waiting ${SETTLE_MS / 1000}s for pools to settle...`);

      await sleep(SETTLE_MS);

      const result = await buyToken(wallet, provider, launch.token, launch.symbol, parseFloat(launch.seed));
      state.bought[launch.token] = {
        symbol: launch.symbol,
        swaps: result.bought,
        spent: result.spent,
        timestamp: new Date().toISOString(),
      };
      saveState(state);
    }
  } catch (e) {
    console.error(`[${ts()}] Poll error: ${e.message}`);
  }
}

// --- Main ---
async function main() {
  if (!PK) {
    console.error('Set TRADE_PRIVATE_KEY in Baselings/api/.env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const bal = await provider.getBalance(wallet.address);
  const state = loadState();

  console.log('=== Launch Buyer ===');
  console.log(`[${ts()}] Trade wallet: ${wallet.address}`);
  console.log(`[${ts()}] ETH balance: ${ethers.formatEther(bal)}`);
  console.log(`[${ts()}] Buy: 10% of seed ($1-$10), $${BUY_PER_SWAP}/swap, ${BUY_INTERVAL / 1000}s apart, ${SLIPPAGE_BPS / 100}% slippage`);
  console.log(`[${ts()}] Factory: ${short(FACTORY)}`);
  console.log(`[${ts()}] Scanning from block ${state.lastBlock || 'current'}`);
  console.log(`[${ts()}] Already bought: ${Object.keys(state.bought).length} token(s)`);
  console.log(`[${ts()}] Polling every ${POLL_MS / 1000}s for new launches...`);
  console.log('');

  // Initial scan
  await poll(provider, wallet, state);

  // Keep polling
  setInterval(() => poll(provider, wallet, state), POLL_MS);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
