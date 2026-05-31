/**
 * cycle-arb.js — True cycle arbitrage bot
 *
 * Finds 2-3 hop V3 cycles that return MORE of the starting token.
 * No price oracles. amountOut > amountIn = real profit. Period.
 *
 * Designed for local Base node: scans every block (2s), unlimited RPC,
 * quotes ALL cycles, executes ALL profitable ones per block.
 *
 * Usage:
 *   node cycle-arb.js           — run continuous (block-by-block)
 *   node cycle-arb.js dry       — scan only, no execution
 *   node cycle-arb.js scan      — single scan, then exit
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { ethers } = require('ethers');

// ── Config ──────────────────────────────────────────────────────────────
const MIN_ETH = ethers.parseEther('0.0001');
const DRY_RUN = process.argv.includes('dry');
const SINGLE_SCAN = process.argv.includes('scan');

const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const QUOTER = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const WETH_ADDR = '0x4200000000000000000000000000000000000006';
const USDC_ADDR = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ── Token Registry ──────────────────────────────────────────────────────
const TOKENS = {
  // Stables & blue chips
  USDC:    { addr: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', dec: 6 },
  WETH:    { addr: '0x4200000000000000000000000000000000000006', dec: 18 },
  cbBTC:   { addr: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', dec: 8 },

  // Money for Trees V2 stablecoin
  MfT:     { addr: '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072', dec: 6 },

  // Tree tokens
  TETH:    { addr: '0x7D545427c8f548F3A00C1c09B5360BF3D4B842ef', dec: 18 },
  TBTC:    { addr: '0x53B6De1726856c4615dc3B05d45993Bc1aa3403c', dec: 18 },

  // Meme for Trees
  MFT:     { addr: '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3', dec: 18 },

  // Ecosystem tokens
  POOP:    { addr: '0x126555aecBAC290b25644e4b7f29c016aE95f4dc', dec: 18 },
  BURGERS: { addr: '0x06A05043eb2C1691b19c2C13219dB9212269dDc5', dec: 18 },
  TGN:     { addr: '0xD75dfa972C6136f1c594Fec1945302f885E1ab29', dec: 18 },
  PIZZA:   { addr: '0x84BF55C117bc97323d332f08782ADBCAf3B15468', dec: 18 },
  MR:      { addr: '0x9265BfDD02B61D864923371C63f68DDbF7e17656', dec: 18 },
  NFS:     { addr: '0xb9630280DC93c503aEE06d1Eca8E125fc19AB3c5', dec: 18 },
  BAGI:    { addr: '0x7311a6975a173Ee637D199F8123a409EC82b1992', dec: 18 },
  CHAR:    { addr: '0x20b048fa035d5763685d695e66adf62c5d9f5055', dec: 18 },
  EGP:     { addr: '0xc1ba76771bbf0dd841347630e57c793f9d5accee', dec: 18 },
  FUN:     { addr: '0x16EE7ecAc70d1028E7712751E2Ee6BA808a7dd92', dec: 18 },
  AZUSD:   { addr: '0x3595ca37596D5895B70EFAB592ac315D5B9809B2', dec: 18 },
  BRETT:   { addr: '0x532f27101965dd16442E59d40670FaF5eBB142E4', dec: 18 },
  BUSTER:  { addr: '0xBFC5cD421bBC91A2Ca976C4AB1754748634b7D41', dec: 9 },

  // Launched tokens
  NZ:      { addr: '0xCd79F05197F79E0f08D1f4599aA7BBf02EA36098', dec: 18 },
  BRUH:    { addr: '0x6743D2E9c06afeC5d2a0bcdec2A53e2af328a10E', dec: 18 },
  DD:      { addr: '0x3EeCC1c07d0a8BdEAF495a1300486a376cc959FF', dec: 18 },
  MYCO:    { addr: '0xD377fcADE46CDA9C7B6Bc5ea6450CA53994b6577', dec: 18 },
  TURTLE:  { addr: '0x2999f1Bfa1Bd65Aa908bef41A8BF4d8CB7C370FB', dec: 18 },
  RT:      { addr: '0x5d565fE46D285ab3e1e8d7fB6d0B2ecF4ba3B90B', dec: 18 },
  BP:      { addr: '0x33c5e3362A9ddfD453FF655D7DdbC8C2Eff4A062', dec: 18 },
  FLWR:    { addr: '0x5bF510BFc635598D77b6Ac5fDE45CDa888A0C4c1', dec: 18 },
  NMB:     { addr: '0x64908eF36C85feEA39625d2F653f3bCDDAea5e9b', dec: 18 },
  BAT:     { addr: '0xc720FFf033E70E11AE6b80A0Bb88C77911EEBc7D', dec: 18 },
};

// ── V3 Pool Registry ────────────────────────────────────────────────────
// Each entry: [tokenA_sym, tokenB_sym, fee]
// All pools are bidirectional in the graph
const POOLS = [
  // ── POOP hub ──
  ['POOP', 'WETH', 10000],
  ['POOP', 'USDC', 10000],
  ['POOP', 'cbBTC', 10000],
  ['BURGERS', 'POOP', 10000],
  ['TGN', 'POOP', 10000],
  ['BRETT', 'POOP', 10000],
  ['BUSTER', 'POOP', 10000],
  ['CHAR', 'POOP', 10000],
  ['EGP', 'POOP', 10000],
  ['FUN', 'POOP', 10000],
  ['AZUSD', 'POOP', 10000],

  // ── MFT (Meme for Trees) hub ──
  ['NZ', 'MFT', 10000],
  ['BRUH', 'MFT', 10000],
  ['DD', 'MFT', 10000],
  ['MYCO', 'MFT', 10000],
  ['BAGI', 'MFT', 10000],
  ['TURTLE', 'MFT', 10000],
  ['RT', 'MFT', 10000],
  ['BP', 'MFT', 10000],
  ['FLWR', 'MFT', 10000],
  ['NMB', 'MFT', 10000],
  ['MR', 'MFT', 10000],
  ['NFS', 'MFT', 10000],
  ['BAT', 'MFT', 10000],
  ['PIZZA', 'MFT', 10000],

  // ── WETH pairs ──
  ['NZ', 'WETH', 10000],
  ['BRUH', 'WETH', 10000],
  ['DD', 'WETH', 10000],
  ['MYCO', 'WETH', 10000],
  ['BAGI', 'WETH', 10000],
  ['TURTLE', 'WETH', 10000],
  ['RT', 'WETH', 10000],
  ['BP', 'WETH', 10000],
  ['BAT', 'WETH', 10000],
  ['WETH', 'USDC', 500],     // deep 0.05% pool
  ['TETH', 'WETH', 10000],

  // ── USDC pairs ──
  ['NZ', 'USDC', 10000],
  ['BRUH', 'USDC', 10000],
  ['BAT', 'USDC', 10000],
  ['PIZZA', 'USDC', 10000],

  // ── MfT (Money for Trees) hub ──
  ['TETH', 'MfT', 10000],
  ['TBTC', 'MfT', 10000],
  ['USDC', 'MfT', 10000],
  ['MFT', 'MfT', 10000],     // bridge between Meme and Money
  ['cbBTC', 'MfT', 10000],
  ['BURGERS', 'MfT', 10000],
  ['POOP', 'MfT', 10000],
  ['PIZZA', 'MfT', 10000],
  ['TGN', 'MfT', 10000],
  ['MR', 'MfT', 10000],
  ['NFS', 'MfT', 10000],
  ['BAGI', 'MfT', 10000],

  // ── Tree token pegs ──
  ['TBTC', 'cbBTC', 10000],

  // ── Deep cbBTC pools (0.05% fee = high liquidity) ──
  ['cbBTC', 'WETH', 500],
  ['cbBTC', 'USDC', 500],

  // ── TGN reactor pools ──
  ['TGN', 'MFT', 10000],
  ['TGN', 'TETH', 10000],
  ['TGN', 'TBTC', 10000],

  // ── BURGERS reactor pools ──
  ['BURGERS', 'MFT', 10000],
  ['BURGERS', 'TETH', 10000],
  ['BURGERS', 'TBTC', 10000],
];

// ── ABIs ────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];
const ROUTER_ABI = [
  'function exactInput(tuple(bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256)',
];
const QUOTER_ABI = [
  'function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[], uint32[], uint256)',
];
const WETH_ABI = [
  'function withdraw(uint256) external',
  'function balanceOf(address) view returns (uint256)',
];

// ── Globals ─────────────────────────────────────────────────────────────
let provider, wallet, router, quoter, wethContract;
let tokenContracts = {};
let allCycles = [];
let scanning = false;
let stats = { scans: 0, trades: 0, started: null, profitByToken: {} };

const ts = () => new Date().toISOString().slice(11, 19);

// ── Path encoding ───────────────────────────────────────────────────────
function encodePath(tokenAddrs, fees) {
  let encoded = '0x';
  for (let i = 0; i < tokenAddrs.length; i++) {
    encoded += tokenAddrs[i].slice(2).toLowerCase();
    if (i < fees.length) {
      encoded += fees[i].toString(16).padStart(6, '0');
    }
  }
  return encoded;
}

// ── Graph + Cycle Discovery ─────────────────────────────────────────────
function buildGraph() {
  const adj = {};
  for (const sym of Object.keys(TOKENS)) adj[sym] = [];

  for (let i = 0; i < POOLS.length; i++) {
    const [a, b, fee] = POOLS[i];
    if (!TOKENS[a] || !TOKENS[b]) continue;
    adj[a].push({ to: b, fee, idx: i });
    adj[b].push({ to: a, fee, idx: i });
  }
  return adj;
}

function discoverCycles(adj) {
  const cycles = [];
  const tokenSyms = Object.keys(TOKENS);

  for (const start of tokenSyms) {
    // 2-hop: start->B->start using TWO DIFFERENT pools
    for (const e1 of adj[start]) {
      for (const e2 of adj[e1.to]) {
        if (e2.to === start && e2.idx !== e1.idx) {
          cycles.push({
            label: `${start}->${e1.to}->${start}`,
            tokens: [start, e1.to, start],
            fees: [e1.fee, e2.fee],
            poolIdxs: [e1.idx, e2.idx],
          });
        }
      }
    }

    // 3-hop: start->B->C->start using THREE DIFFERENT pools
    for (const e1 of adj[start]) {
      for (const e2 of adj[e1.to]) {
        if (e2.to === start) continue;
        if (e2.idx === e1.idx) continue;
        for (const e3 of adj[e2.to]) {
          if (e3.to === start && e3.idx !== e1.idx && e3.idx !== e2.idx) {
            cycles.push({
              label: `${start}->${e1.to}->${e2.to}->${start}`,
              tokens: [start, e1.to, e2.to, start],
              fees: [e1.fee, e2.fee, e3.fee],
              poolIdxs: [e1.idx, e2.idx, e3.idx],
            });
          }
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const c of cycles) {
    const key = c.poolIdxs.join(',') + ':' + c.tokens[0];
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }
  return unique;
}

// ── Pre-encode all cycle paths (do once at startup) ─────────────────────
function preEncodeCycles() {
  for (const c of allCycles) {
    c.encodedPath = encodePath(
      c.tokens.map(sym => TOKENS[sym].addr),
      c.fees
    );
  }
}

// ── Quote a cycle (uses pre-encoded path) ───────────────────────────────
async function quoteCycle(cycle, amountIn) {
  try {
    const result = await quoter.quoteExactInput.staticCall(cycle.encodedPath, amountIn);
    return result[0];
  } catch {
    return 0n;
  }
}

// ── Fetch all balances in parallel ──────────────────────────────────────
async function fetchBalances() {
  const bals = {};
  const entries = Object.entries(TOKENS);
  const results = await Promise.all(
    entries.map(([sym]) =>
      tokenContracts[sym].balanceOf(wallet.address).catch(() => 0n)
    )
  );
  for (let i = 0; i < entries.length; i++) {
    bals[entries[i][0]] = results[i];
  }
  return bals;
}

// ── Setup ───────────────────────────────────────────────────────────────
async function setup() {
  const rpc = process.env.ALCHEMY_RPC || 'https://base.publicnode.com';
  const BASE_NET = new ethers.Network('base', 8453);
  provider = new ethers.JsonRpcProvider(rpc, BASE_NET, { staticNetwork: BASE_NET });
  wallet = new ethers.Wallet(process.env.SHARK_PRIVATE_KEY, provider);
  router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  quoter = new ethers.Contract(QUOTER, QUOTER_ABI, provider);
  wethContract = new ethers.Contract(WETH_ADDR, WETH_ABI, wallet);

  console.log(`[${ts()}] Wallet: ${wallet.address}`);
  console.log(`[${ts()}] RPC: ${rpc}`);
  console.log(`[${ts()}] Mode: ${DRY_RUN ? 'DRY RUN' : SINGLE_SCAN ? 'SINGLE SCAN' : 'LIVE — every block'}`);

  // Create token contracts
  for (const [sym, tok] of Object.entries(TOKENS)) {
    tokenContracts[sym] = new ethers.Contract(tok.addr, ERC20_ABI, wallet);
  }

  // Build graph, discover cycles, pre-encode paths
  const adj = buildGraph();
  allCycles = discoverCycles(adj);
  preEncodeCycles();
  console.log(`[${ts()}] Pools: ${POOLS.length} | Tokens: ${Object.keys(TOKENS).length} | Cycles: ${allCycles.length}`);

  // Show cycle breakdown
  const byStart = {};
  for (const c of allCycles) {
    byStart[c.tokens[0]] = (byStart[c.tokens[0]] || 0) + 1;
  }
  const topStarts = Object.entries(byStart).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`[${ts()}] Top cycle tokens: ${topStarts.map(([s, n]) => `${s}(${n})`).join(', ')}`);

  // Approve all held tokens to router
  console.log(`[${ts()}] Checking approvals...`);
  const bals = await fetchBalances();
  for (const [sym, bal] of Object.entries(bals)) {
    if (bal === 0n) continue;
    const allowance = await tokenContracts[sym].allowance(wallet.address, ROUTER);
    if (allowance < ethers.MaxUint256 / 2n) {
      console.log(`[${ts()}] Approving ${sym}...`);
      try {
        await (await tokenContracts[sym].approve(ROUTER, ethers.MaxUint256)).wait();
      } catch (e) {
        console.error(`[${ts()}] Approve ${sym} failed: ${e.message?.slice(0, 60)}`);
      }
    }
  }

  // Print balances
  const ethBal = await provider.getBalance(wallet.address);
  console.log(`[${ts()}] ETH: ${ethers.formatEther(ethBal)}`);
  const held = Object.entries(bals)
    .filter(([, b]) => b > 0n)
    .map(([sym, b]) => `${sym}:${ethers.formatUnits(b, TOKENS[sym].dec).slice(0, 10)}`);
  console.log(`[${ts()}] Holdings: ${held.join(', ') || 'none'}`);

  stats.started = new Date().toISOString();
}

// ── Execute a cycle ─────────────────────────────────────────────────────
async function execute(cycle, amountIn, amountOut) {
  const sym = cycle.tokens[0];
  const dec = TOKENS[sym].dec;
  const profit = amountOut - amountIn;
  const profitFmt = ethers.formatUnits(profit, dec);
  const inFmt = ethers.formatUnits(amountIn, dec);
  const pctGain = ((Number(profit) / Number(amountIn)) * 100).toFixed(2);

  console.log(`[${ts()}] EXEC ${cycle.label} | in:${inFmt} out:${ethers.formatUnits(amountOut, dec)} | +${profitFmt} ${sym} (+${pctGain}%)`);

  if (DRY_RUN) {
    console.log(`[${ts()}]   (dry run — skipped)`);
    return true;
  }

  try {
    const tx = await router.exactInput({
      path: cycle.encodedPath,
      recipient: wallet.address,
      amountIn,
      amountOutMinimum: amountIn, // break-even minimum
    }, { gasLimit: 500000 });
    const receipt = await tx.wait();
    const gasEth = ethers.formatEther(receipt.fee);

    stats.trades++;
    if (!stats.profitByToken[sym]) stats.profitByToken[sym] = 0n;
    stats.profitByToken[sym] += profit;

    console.log(`[${ts()}]   OK +${profitFmt} ${sym} | gas: ${gasEth} ETH | #${stats.trades}`);
    return true;
  } catch (e) {
    console.error(`[${ts()}]   REVERTED: ${e.reason || e.message?.slice(0, 80)}`);
    return false;
  }
}

// ── Gas refuel ──────────────────────────────────────────────────────────
async function refuelIfNeeded() {
  const ethBal = await provider.getBalance(wallet.address);
  if (ethBal > MIN_ETH) return;

  const usdcBal = await tokenContracts.USDC.balanceOf(wallet.address);
  if (usdcBal < 500000n) {
    console.log(`[${ts()}] LOW ETH + LOW USDC — cannot refuel`);
    return;
  }

  console.log(`[${ts()}] REFUEL: $0.50 USDC -> ETH`);
  const path = encodePath([USDC_ADDR, WETH_ADDR], [500]);
  try {
    const tx = await router.exactInput({
      path, recipient: wallet.address,
      amountIn: 500000n, amountOutMinimum: 0n,
    }, { gasLimit: 500000 });
    await tx.wait();
    const wethBal = await wethContract.balanceOf(wallet.address);
    if (wethBal > 0n) {
      await (await wethContract.withdraw(wethBal, { gasLimit: 100000 })).wait();
    }
    console.log(`[${ts()}] REFUELED: ${ethers.formatEther(await provider.getBalance(wallet.address))} ETH`);
  } catch (e) {
    console.error(`[${ts()}] REFUEL FAILED: ${e.message?.slice(0, 60)}`);
  }
}

// ── Scan: quote ALL cycles, execute ALL profitable ones ─────────────────
async function scan(blockNum) {
  if (scanning) return; // skip if previous scan still running
  scanning = true;

  try {
    await refuelIfNeeded();
    const bals = await fetchBalances();

    // Filter to cycles where we hold the starting token
    const heldTokens = new Set(
      Object.entries(bals).filter(([, b]) => b > 0n).map(([s]) => s)
    );
    const activeCycles = allCycles.filter(c => heldTokens.has(c.tokens[0]));

    if (activeCycles.length === 0) {
      console.log(`[${ts()}] blk:${blockNum || '?'} | scan #${stats.scans} — no held tokens with cycles`);
      scanning = false;
      return;
    }

    // Quote ALL cycles in parallel — no limit on local node
    const quoteResults = await Promise.all(
      activeCycles.map(async (cycle) => {
        const sym = cycle.tokens[0];
        const bal = bals[sym];
        // Try 50% of balance
        const trySize = bal / 2n;
        if (trySize === 0n) return null;

        const out = await quoteCycle(cycle, trySize);
        if (out > trySize) {
          return { cycle, amountIn: trySize, amountOut: out, profit: out - trySize };
        }
        // Try 25%
        const qSize = trySize / 2n;
        if (qSize === 0n) return null;
        const out2 = await quoteCycle(cycle, qSize);
        if (out2 > qSize) {
          return { cycle, amountIn: qSize, amountOut: out2, profit: out2 - qSize };
        }
        // Try 12.5%
        const eSize = qSize / 2n;
        if (eSize === 0n) return null;
        const out3 = await quoteCycle(cycle, eSize);
        if (out3 > eSize) {
          return { cycle, amountIn: eSize, amountOut: out3, profit: out3 - eSize };
        }
        return null;
      })
    );

    const opportunities = quoteResults.filter(Boolean);
    stats.scans++;

    if (opportunities.length === 0) {
      const held = Object.entries(bals)
        .filter(([, b]) => b > 0n)
        .map(([sym, b]) => `${sym}:${ethers.formatUnits(b, TOKENS[sym].dec).slice(0, 8)}`)
        .join(' ');
      const msg = `[${ts()}] blk:${blockNum || '?'} | #${stats.scans} | ${activeCycles.length} cyc | 0 arb | t:${stats.trades} | ${held}`;
      // Log full line every 30 scans (~5 min) so PM2 captures it; carriage-return the rest
      if (stats.scans % 30 === 0) {
        console.log(msg);
      } else {
        process.stdout.write(`\r${msg}   `);
      }
      scanning = false;
      return;
    }

    // Sort by profit ratio (best % first)
    opportunities.sort((a, b) => {
      const ratioA = Number(a.profit * 10000n / a.amountIn);
      const ratioB = Number(b.profit * 10000n / b.amountIn);
      return ratioB - ratioA;
    });

    console.log(`\n[${ts()}] blk:${blockNum || '?'} | ${opportunities.length} profitable cycles:`);
    for (const opp of opportunities.slice(0, 5)) {
      const sym = opp.cycle.tokens[0];
      const pct = ((Number(opp.profit) / Number(opp.amountIn)) * 100).toFixed(2);
      console.log(`  ${opp.cycle.label} | +${ethers.formatUnits(opp.profit, TOKENS[sym].dec)} ${sym} (+${pct}%)`);
    }

    // Execute ALL profitable cycles (sequentially — balances change after each)
    for (const opp of opportunities) {
      // Re-check balance before each execution (previous trade may have changed it)
      const sym = opp.cycle.tokens[0];
      const currentBal = await tokenContracts[sym].balanceOf(wallet.address);
      if (currentBal < opp.amountIn) {
        // Balance changed, re-quote at current balance
        const newSize = currentBal / 2n;
        if (newSize === 0n) continue;
        const newOut = await quoteCycle(opp.cycle, newSize);
        if (newOut <= newSize) continue;
        await execute(opp.cycle, newSize, newOut);
      } else {
        await execute(opp.cycle, opp.amountIn, opp.amountOut);
      }
    }
  } catch (e) {
    console.error(`\n[${ts()}] SCAN ERROR: ${e.reason || e.message?.slice(0, 100)}`);
  }

  scanning = false;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  await setup();
  console.log(`\n[${ts()}] Cycle ARB — ${allCycles.length} cycles | ${POOLS.length} pools | every block\n`);

  if (SINGLE_SCAN) {
    await scan();
    console.log('\n');
    return;
  }

  // Poll mode for public RPC, block subscription for local node
  const rpc = process.env.ALCHEMY_RPC || '';
  const isLocal = rpc.includes('localhost') || rpc.includes('127.0.0.1');

  if (isLocal) {
    console.log(`[${ts()}] LOCAL NODE — subscribing to blocks (every 2s)`);
    provider.on('block', (blockNum) => { scan(blockNum); });
  } else {
    console.log(`[${ts()}] PUBLIC RPC — polling every 10s`);
    await scan();
    setInterval(() => { if (!scanning) scan(); }, 10_000);
  }
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
