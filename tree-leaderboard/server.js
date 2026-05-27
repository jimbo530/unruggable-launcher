// Tree Leaderboard API
// Indexes MfTUSD deposits, calculates trees funded per holder
// Formula: trees = sum(balance_i * duration_i) * 0.03 * 0.45 / (0.10 * 365.25 * 86400)
// 3% APY, 45% to trees, $0.10 per tree

const { ethers } = require('ethers');
const http = require('http');

const PORT = 3008;
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const MFTUSD = '0xe96fa44b4b82F085a457F9B7a0F85ea26FF1652F';
const DECIMALS = 6;
const ZERO = '0x0000000000000000000000000000000000000000';
const DEPLOY_BLOCK = 46_429_325; // exact deploy block from tx receipt

// 3% APY, 45% to trees, $0.10/tree
// trees_per_usd_per_second = 0.03 * 0.45 / (0.10 * 365.25 * 86400)
const TREES_PER_USD_PER_SEC = (0.03 * 0.45) / (0.10 * 365.25 * 86400);

// Manual overrides for known non-pool addresses
const MANUAL_LABELS = {
  '0xe2a4a8b9d77080c57799a94ba8edeb2dd6e0ac10': 'Unruggable Operations',
};

// Auto-detected pool labels (populated on startup + after each index)
let autoLabels = {}; // addr -> label string

const provider = new ethers.JsonRpcProvider(RPC);

const V3_DETECT_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
];
const SYMBOL_ABI = ['function symbol() view returns (string)'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Try to identify a V3 pool and label it by its paired token
async function detectPoolLabel(addr) {
  try {
    const c = new ethers.Contract(addr, V3_DETECT_ABI, provider);
    const t0 = await c.token0();
    await sleep(300);
    const t1 = await c.token1();
    const isMftusd0 = t0.toLowerCase() === MFTUSD.toLowerCase();
    const isMftusd1 = t1.toLowerCase() === MFTUSD.toLowerCase();
    if (!isMftusd0 && !isMftusd1) return null;
    const otherAddr = isMftusd0 ? t1 : t0;
    await sleep(300);
    try {
      const tc = new ethers.Contract(ethers.getAddress(otherAddr), SYMBOL_ABI, provider);
      const sym = await tc.symbol();
      return sym + ' / MfTUSD Pool';
    } catch { return short(otherAddr) + ' / MfTUSD Pool'; }
  } catch { return null; }
}

async function labelAllHolders() {
  for (const addr of Object.keys(holders)) {
    if (addr === ZERO) continue;
    if (MANUAL_LABELS[addr] || autoLabels[addr]) continue;
    await sleep(500);
    const label = await detectPoolLabel(addr);
    if (label) {
      autoLabels[addr] = label;
      console.log(`Auto-labeled ${addr} as "${label}"`);
    }
  }
}

function getLabel(addr) {
  return MANUAL_LABELS[addr] || autoLabels[addr] || null;
}
const contract = new ethers.Contract(MFTUSD, [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)'
], provider);

// State
let holders = {};       // addr -> { balance: bigint, lastUpdate: timestamp, treeSecs: number }
let deposits = [];      // { id, addr, amount, timestamp, withdrawn: bool, withdrawnAt }
let lastBlock = DEPLOY_BLOCK;
let totalTreesFunded = 0;
let totalDeposited = 0;
let lastRefresh = 0;

function now() { return Math.floor(Date.now() / 1000); }

function updateHolderTreeSecs(addr, timestamp) {
  const h = holders[addr];
  if (!h || h.balance === 0n) return;
  const elapsed = timestamp - h.lastUpdate;
  if (elapsed <= 0) return;
  const balUsd = Number(h.balance) / (10 ** DECIMALS);
  h.treeSecs += balUsd * elapsed;
  h.lastUpdate = timestamp;
}

function treesFromTreeSecs(treeSecs) {
  return treeSecs * TREES_PER_USD_PER_SEC;
}

async function getBlockTimestamp(blockNum) {
  const block = await provider.getBlock(blockNum);
  return block ? block.timestamp : now();
}

async function indexEvents() {
  const currentBlock = await provider.getBlockNumber();
  if (currentBlock <= lastBlock) return;

  // Fetch in chunks of 10k blocks
  const CHUNK = 10000;
  let from = lastBlock + 1;

  while (from <= currentBlock) {
    const to = Math.min(from + CHUNK - 1, currentBlock);
    try {
      const logs = await contract.queryFilter('Transfer', from, to);

      for (const log of logs) {
        const fromAddr = log.args.from.toLowerCase();
        const toAddr = log.args.to.toLowerCase();
        const value = log.args.value;
        const ts = await getBlockTimestamp(log.blockNumber);

        // Initialize holders
        if (!holders[toAddr]) holders[toAddr] = { balance: 0n, lastUpdate: ts, treeSecs: 0 };
        if (!holders[fromAddr]) holders[fromAddr] = { balance: 0n, lastUpdate: ts, treeSecs: 0 };

        // Accrue tree-seconds before balance change
        updateHolderTreeSecs(fromAddr, ts);
        updateHolderTreeSecs(toAddr, ts);

        // Update balances
        holders[fromAddr].balance -= value;
        holders[toAddr].balance += value;
        holders[fromAddr].lastUpdate = ts;
        holders[toAddr].lastUpdate = ts;

        // Track deposits (mint = from zero) and withdrawals (to zero)
        if (fromAddr === ZERO) {
          deposits.push({
            id: deposits.length,
            addr: toAddr,
            amount: Number(value) / (10 ** DECIMALS),
            timestamp: ts,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            withdrawn: false,
            withdrawnAt: null
          });
        } else if (toAddr === ZERO) {
          // Mark oldest unmatched deposit as withdrawn
          const amt = Number(value) / (10 ** DECIMALS);
          let remaining = amt;
          for (const d of deposits) {
            if (d.addr === fromAddr && !d.withdrawn && remaining > 0) {
              d.withdrawn = true;
              d.withdrawnAt = ts;
              remaining -= d.amount;
            }
          }
        }
      }
    } catch (e) {
      console.error(`Error fetching blocks ${from}-${to}:`, e.message);
      break;
    }
    from = to + 1;
  }

  lastBlock = currentBlock;
  lastRefresh = now();
  recalcTotals();
  console.log(`Indexed to block ${currentBlock}. ${Object.keys(holders).length} holders, ${deposits.length} deposits.`);
}

function recalcTotals() {
  const ts = now();
  totalTreesFunded = 0;
  totalDeposited = 0;

  for (const [addr, h] of Object.entries(holders)) {
    if (addr === ZERO) continue;
    updateHolderTreeSecs(addr, ts);
    totalTreesFunded += treesFromTreeSecs(h.treeSecs);
    totalDeposited += Number(h.balance) / (10 ** DECIMALS);
  }
}

function getLeaderboard() {
  const ts = now();
  const board = [];

  for (const [addr, h] of Object.entries(holders)) {
    if (addr === ZERO) continue;
    if (h.treeSecs === 0 && h.balance === 0n) continue;

    updateHolderTreeSecs(addr, ts);
    const trees = treesFromTreeSecs(h.treeSecs);
    if (trees < 0.001) continue;

    board.push({
      address: addr,
      balance: Number(h.balance) / (10 ** DECIMALS),
      treesFunded: Math.floor(trees * 100) / 100,
      treesPerYear: Number(h.balance) / (10 ** DECIMALS) * 0.135,
    });
  }

  board.sort((a, b) => b.treesFunded - a.treesFunded);
  return board.map((entry, i) => ({ rank: i + 1, ...entry }));
}

function getProjectLeaderboard() {
  const ts = now();
  const projects = {}; // name -> { balance, treeSecs, addresses[] }

  for (const [addr, h] of Object.entries(holders)) {
    if (addr === ZERO) continue;
    if (h.treeSecs === 0 && h.balance === 0n) continue;

    updateHolderTreeSecs(addr, ts);
    const label = getLabel(addr);
    // Group labeled addresses by project; unlabeled get their own entry
    const key = label || addr;

    if (!projects[key]) {
      projects[key] = { name: label || short(addr), balance: 0, treeSecs: 0, addresses: [], isProject: !!label };
    }
    projects[key].balance += Number(h.balance) / (10 ** DECIMALS);
    projects[key].treeSecs += h.treeSecs;
    projects[key].addresses.push(addr);
  }

  const board = [];
  for (const [key, p] of Object.entries(projects)) {
    const trees = treesFromTreeSecs(p.treeSecs);
    if (trees < 0.001) continue;
    board.push({
      name: p.name,
      isProject: p.isProject,
      balance: Math.floor(p.balance * 100) / 100,
      treesFunded: Math.floor(trees * 100) / 100,
      treesPerYear: Math.floor(p.balance * 0.135 * 100) / 100,
      addresses: p.addresses,
    });
  }

  board.sort((a, b) => b.treesFunded - a.treesFunded);
  return board.map((entry, i) => ({ rank: i + 1, ...entry }));
}

function short(addr) { return addr.slice(0,6) + '...' + addr.slice(-4); }

function getDeposits(addr) {
  const ts = now();
  const filtered = addr ? deposits.filter(d => d.addr === addr.toLowerCase()) : deposits;

  return filtered.map(d => {
    const endTs = d.withdrawn ? d.withdrawnAt : ts;
    const durationSecs = endTs - d.timestamp;
    const treeSecs = d.amount * durationSecs;
    const trees = treeSecs * TREES_PER_USD_PER_SEC;

    return {
      id: d.id,
      address: d.addr,
      amount: d.amount,
      depositDate: new Date(d.timestamp * 1000).toISOString(),
      withdrawn: d.withdrawn,
      withdrawnDate: d.withdrawnAt ? new Date(d.withdrawnAt * 1000).toISOString() : null,
      durationDays: Math.floor(durationSecs / 86400 * 10) / 10,
      treesFunded: Math.floor(trees * 100) / 100,
      txHash: d.txHash
    };
  });
}

function getSummary() {
  recalcTotals();
  const board = getLeaderboard();
  return {
    totalTreesFunded: Math.floor(totalTreesFunded * 100) / 100,
    totalDeposited: Math.floor(totalDeposited * 100) / 100,
    treesPerYear: Math.floor(totalDeposited * 0.135 * 100) / 100,
    holderCount: board.length,
    depositCount: deposits.length,
    lastBlock,
    lastRefresh: new Date(lastRefresh * 1000).toISOString()
  };
}

// HTTP server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const path = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (path === '/leaderboard' || path === '/') {
    const board = getProjectLeaderboard();
    const summary = getSummary();
    res.end(JSON.stringify({ summary, leaderboard: board }));
  } else if (path === '/leaderboard/wallets') {
    // Original per-wallet leaderboard
    const board = getLeaderboard();
    const summary = getSummary();
    res.end(JSON.stringify({ summary, leaderboard: board }));
  } else if (path === '/summary') {
    res.end(JSON.stringify(getSummary()));
  } else if (path === '/deposits') {
    const addr = url.searchParams.get('address');
    res.end(JSON.stringify(getDeposits(addr)));
  } else if (path === '/holder') {
    const addr = url.searchParams.get('address');
    if (!addr) { res.statusCode = 400; res.end('{"error":"address required"}'); return; }
    const h = holders[addr.toLowerCase()];
    if (!h) { res.end('{"error":"not found"}'); return; }
    updateHolderTreeSecs(addr.toLowerCase(), now());
    const trees = treesFromTreeSecs(h.treeSecs);
    res.end(JSON.stringify({
      address: addr.toLowerCase(),
      balance: Number(h.balance) / (10 ** DECIMALS),
      treesFunded: Math.floor(trees * 100) / 100,
      treesPerYear: Number(h.balance) / (10 ** DECIMALS) * 0.135,
      deposits: getDeposits(addr)
    }));
  } else {
    res.statusCode = 404;
    res.end('{"error":"not found"}');
  }
});

// Start
async function main() {
  console.log('Tree Leaderboard API starting...');
  console.log(`MfTUSD: ${MFTUSD}`);
  console.log(`Trees/USD/year: ${TREES_PER_USD_PER_SEC * 365.25 * 86400} = 0.135`);

  // Start server immediately, index in background
  server.listen(PORT, () => console.log(`Tree Leaderboard API on port ${PORT}`));

  try {
    await indexEvents();
    console.log(`Initial index complete. ${deposits.length} deposits found.`);
    await labelAllHolders();
  } catch(e) { console.error('Initial index error:', e.message); }

  // Re-index every 5 minutes, then label any new holders
  setInterval(async () => {
    try {
      await indexEvents();
      await labelAllHolders();
    } catch (e) { console.error('Re-index error:', e.message); }
  }, 5 * 60 * 1000);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
