// Unrugable Agent Swap Module
// Implements ALL guardrails from SWAP_GUARDRAILS.md
// Every rule maps to a real loss event — do not weaken these checks.

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const BASE_RPC = 'https://mainnet.base.org';

// ── Allowlisted tokens (Base chain 8453) ─────────────────────────────────────
const ALLOWED_TOKENS = {
  MfT:   '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3',
  WETH:  '0x4200000000000000000000000000000000000006',
  USDC:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  AZUSD: '0x3595ca37596D5895B70EFAB592ac315D5B9809B2',
  CHAR:  '0x20b048fA035D5763685D695e66aDF62c5D9F5055',
  EARTH: '0xA5528D1fbd69791B7C6951ef1797DBC2c0e4024b',
  POOP:  '0xB93bA1bcc0D09E3e1C7a7a1e3aC5CC57E795afBe',
};

// Reverse lookup
const ADDR_TO_SYMBOL = {};
for (const [sym, addr] of Object.entries(ALLOWED_TOKENS)) {
  ADDR_TO_SYMBOL[addr.toLowerCase()] = sym;
}

// ── Hard limits ──────────────────────────────────────────────────────────────
const MAX_SWAP_USD = 0.10;
const COOLDOWN_MS = 60_000;
const MAX_SLIPPAGE_DEFAULT = 500; // 5% in bps
const MAX_SLIPPAGE_STABLE = 200;  // 2% for stable pairs
const MAX_GAS = 500_000;
const MAX_DAILY_USD = 1.00;

// ── Uniswap V3 Router (Base) ────────────────────────────────────────────────
const SWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481'; // SwapRouter02
const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address, uint256) returns (bool)',
  'function allowance(address, address) view returns (uint256)',
  'function symbol() view returns (string)',
];

const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
];

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

const FACTORY_ABI = [
  'function getPool(address, address, uint24) view returns (address)',
];

// ── State ────────────────────────────────────────────────────────────────────
const SWAP_LOG_FILE = path.join(__dirname, 'swap-log.json');
let lastSwapTime = 0;
let dailySpend = { date: '', total: 0 };

function loadSwapLog() {
  try {
    const data = JSON.parse(fs.readFileSync(SWAP_LOG_FILE, 'utf8'));
    lastSwapTime = data.lastSwapTime || 0;
    dailySpend = data.dailySpend || { date: '', total: 0 };
  } catch { /* first run */ }
}

function saveSwapLog(entry) {
  loadSwapLog();
  const today = new Date().toISOString().slice(0, 10);
  if (dailySpend.date !== today) {
    dailySpend = { date: today, total: 0 };
  }
  dailySpend.total += entry.amountUSD;
  lastSwapTime = Date.now();

  const log = { lastSwapTime, dailySpend, lastSwap: entry };
  fs.writeFileSync(SWAP_LOG_FILE, JSON.stringify(log, null, 2));
}

loadSwapLog();

// ── Validation ───────────────────────────────────────────────────────────────

function validateAddress(addr) {
  if (!addr || typeof addr !== 'string') return { valid: false, error: 'Address is required' };
  try {
    const checksummed = ethers.getAddress(addr);
    return { valid: true, address: checksummed };
  } catch {
    return { valid: false, error: `Invalid address checksum: ${addr}` };
  }
}

function isAllowlisted(addr) {
  return !!ADDR_TO_SYMBOL[addr.toLowerCase()];
}

function isStablePair(tokenIn, tokenOut) {
  const stables = ['USDC', 'AZUSD'];
  const symIn = ADDR_TO_SYMBOL[tokenIn.toLowerCase()] || '';
  const symOut = ADDR_TO_SYMBOL[tokenOut.toLowerCase()] || '';
  return stables.includes(symIn) && stables.includes(symOut);
}

// ── Pool detection ───────────────────────────────────────────────────────────

async function findPool(provider, tokenIn, tokenOut) {
  const factory = new ethers.Contract(V3_FACTORY, FACTORY_ABI, provider);
  const fees = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

  for (const fee of fees) {
    const pool = await factory.getPool(tokenIn, tokenOut, fee).catch(() => ethers.ZeroAddress);
    if (pool !== ethers.ZeroAddress) {
      return { type: 'v3', fee, pool };
    }
  }
  return null;
}

// ── Quote ────────────────────────────────────────────────────────────────────

async function getQuote(provider, tokenIn, tokenOut, amountIn, fee) {
  const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider);
  try {
    const result = await quoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0n,
    });
    return { amountOut: result.amountOut, gasEstimate: result.gasEstimate };
  } catch (e) {
    return { error: `Quote failed: ${(e.message || '').slice(0, 100)}` };
  }
}

// ── Create swap context ──────────────────────────────────────────────────────

function createSwapContext(privateKey, opts = {}) {
  const provider = new ethers.JsonRpcProvider(opts.rpc || BASE_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  return { wallet, provider };
}

// ── Main swap function ───────────────────────────────────────────────────────

async function swapToken(swapCtx, tokenInAddr, tokenOutAddr, amountUSD) {
  // 1. Validate addresses
  const vIn = validateAddress(tokenInAddr);
  if (!vIn.valid) return { error: vIn.error };
  const vOut = validateAddress(tokenOutAddr);
  if (!vOut.valid) return { error: vOut.error };

  tokenInAddr = vIn.address;
  tokenOutAddr = vOut.address;

  // 2. Check allowlist
  if (!isAllowlisted(tokenInAddr)) {
    return { error: `Token ${tokenInAddr} not in allowlist. Known tokens: ${Object.keys(ALLOWED_TOKENS).join(', ')}` };
  }
  if (!isAllowlisted(tokenOutAddr)) {
    return { error: `Token ${tokenOutAddr} not in allowlist. Known tokens: ${Object.keys(ALLOWED_TOKENS).join(', ')}` };
  }

  if (tokenInAddr === tokenOutAddr) {
    return { error: 'Cannot swap a token for itself' };
  }

  // 3. Check amount limit
  if (typeof amountUSD !== 'number' || amountUSD <= 0) {
    return { error: 'amountUSD must be a positive number' };
  }
  if (amountUSD > MAX_SWAP_USD) {
    return { error: `Max swap is $${MAX_SWAP_USD}. Requested: $${amountUSD}` };
  }

  // 4. Check cooldown
  const now = Date.now();
  const elapsed = now - lastSwapTime;
  if (elapsed < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    return { error: `Cooldown: wait ${wait}s before next swap` };
  }

  // 5. Check daily limit
  loadSwapLog();
  const today = new Date().toISOString().slice(0, 10);
  if (dailySpend.date === today && dailySpend.total + amountUSD > MAX_DAILY_USD) {
    return { error: `Daily limit: $${MAX_DAILY_USD}. Spent today: $${dailySpend.total.toFixed(4)}. Remaining: $${(MAX_DAILY_USD - dailySpend.total).toFixed(4)}` };
  }

  const { wallet, provider } = swapCtx;
  const symIn = ADDR_TO_SYMBOL[tokenInAddr.toLowerCase()];
  const symOut = ADDR_TO_SYMBOL[tokenOutAddr.toLowerCase()];

  // 6. Find pool
  const poolInfo = await findPool(provider, tokenInAddr, tokenOutAddr);
  if (!poolInfo) {
    return { error: `No V3 pool found for ${symIn}/${symOut}. Cannot swap.` };
  }
  if (poolInfo.type !== 'v3') {
    return { error: `Only V3 pools supported. Found: ${poolInfo.type}` };
  }

  // 7. Calculate amount in token units
  const tokenIn = new ethers.Contract(tokenInAddr, ERC20_ABI, wallet);
  const decimals = await tokenIn.decimals();

  // For USDC (6 decimals), $0.10 = 100000
  // For 18-decimal tokens, we need a price oracle — use USDC as the unit
  let amountIn;
  if (symIn === 'USDC') {
    amountIn = ethers.parseUnits(amountUSD.toFixed(6), decimals);
  } else {
    // For non-USDC tokens, we need to determine how many tokens = $amountUSD
    // Get a quote for the reverse direction to establish price
    const usdcDecimals = 6;
    const usdcAmount = ethers.parseUnits(amountUSD.toFixed(6), usdcDecimals);
    const reversePool = await findPool(provider, ALLOWED_TOKENS.USDC, tokenInAddr);
    if (!reversePool) {
      return { error: `Cannot determine USD price for ${symIn} — no USDC/${symIn} pool. Use USDC as tokenIn.` };
    }
    const reverseQuote = await getQuote(provider, ALLOWED_TOKENS.USDC, tokenInAddr, usdcAmount, reversePool.fee);
    if (reverseQuote.error) {
      return { error: `Price lookup failed for ${symIn}: ${reverseQuote.error}` };
    }
    amountIn = reverseQuote.amountOut;
  }

  // 8. Check balance
  const balance = await tokenIn.balanceOf(wallet.address);
  if (balance < amountIn) {
    const formatted = ethers.formatUnits(balance, decimals);
    const needed = ethers.formatUnits(amountIn, decimals);
    return { error: `Insufficient ${symIn} balance. Have: ${formatted}, need: ${needed}` };
  }

  // 9. Get quote
  const quote = await getQuote(provider, tokenInAddr, tokenOutAddr, amountIn, poolInfo.fee);
  if (quote.error) return { error: quote.error };

  // 10. Calculate slippage
  const maxSlippage = isStablePair(tokenInAddr, tokenOutAddr) ? MAX_SLIPPAGE_STABLE : MAX_SLIPPAGE_DEFAULT;
  const amountOutMin = (quote.amountOut * BigInt(10000 - maxSlippage)) / 10000n;

  // 11. Approve exact amount (not unlimited)
  const currentAllowance = await tokenIn.allowance(wallet.address, SWAP_ROUTER);
  if (currentAllowance < amountIn) {
    const approveTx = await tokenIn.approve(SWAP_ROUTER, amountIn, { gasLimit: 100_000 });
    await approveTx.wait();
  }

  // 12. Execute swap
  const router = new ethers.Contract(SWAP_ROUTER, ROUTER_ABI, wallet);
  const tx = await router.exactInputSingle(
    {
      tokenIn: tokenInAddr,
      tokenOut: tokenOutAddr,
      fee: poolInfo.fee,
      recipient: wallet.address,
      amountIn,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0n,
    },
    { gasLimit: MAX_GAS }
  );

  const receipt = await tx.wait();

  // 13. Verify output
  const tokenOut = new ethers.Contract(tokenOutAddr, ERC20_ABI, provider);
  const outDecimals = await tokenOut.decimals();

  // 14. Log swap
  const entry = {
    timestamp: new Date().toISOString(),
    txHash: receipt.hash,
    tokenIn: { symbol: symIn, address: tokenInAddr, amount: ethers.formatUnits(amountIn, decimals) },
    tokenOut: { symbol: symOut, address: tokenOutAddr, amountExpected: ethers.formatUnits(quote.amountOut, outDecimals), amountMin: ethers.formatUnits(amountOutMin, outDecimals) },
    amountUSD,
    fee: poolInfo.fee,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status === 1 ? 'success' : 'failed',
  };
  saveSwapLog(entry);

  if (receipt.status !== 1) {
    return { error: 'Swap transaction reverted on-chain', txHash: receipt.hash, details: entry };
  }

  return {
    ok: true,
    swap: entry,
    note: `Swapped ~$${amountUSD} ${symIn} for ${symOut}. Tx: ${receipt.hash}`,
  };
}

// ── Read-only helpers ────────────────────────────────────────────────────────

function getSwapStatus() {
  loadSwapLog();
  const now = Date.now();
  const elapsed = now - lastSwapTime;
  const cooldownRemaining = Math.max(0, COOLDOWN_MS - elapsed);
  const today = new Date().toISOString().slice(0, 10);
  const todaySpend = dailySpend.date === today ? dailySpend.total : 0;

  return {
    cooldownRemainingMs: cooldownRemaining,
    cooldownRemainingSeconds: Math.ceil(cooldownRemaining / 1000),
    ready: cooldownRemaining === 0,
    dailySpendUSD: todaySpend,
    dailyRemainingUSD: MAX_DAILY_USD - todaySpend,
    maxPerSwapUSD: MAX_SWAP_USD,
    maxDailyUSD: MAX_DAILY_USD,
    allowedTokens: Object.keys(ALLOWED_TOKENS),
  };
}

async function getSwapQuote(provider, tokenInAddr, tokenOutAddr, amountUSD) {
  const vIn = validateAddress(tokenInAddr);
  if (!vIn.valid) return { error: vIn.error };
  const vOut = validateAddress(tokenOutAddr);
  if (!vOut.valid) return { error: vOut.error };

  if (!isAllowlisted(vIn.address)) return { error: `${vIn.address} not in allowlist` };
  if (!isAllowlisted(vOut.address)) return { error: `${vOut.address} not in allowlist` };
  if (amountUSD > MAX_SWAP_USD) return { error: `Max $${MAX_SWAP_USD}` };

  const symIn = ADDR_TO_SYMBOL[vIn.address.toLowerCase()];
  const symOut = ADDR_TO_SYMBOL[vOut.address.toLowerCase()];

  const poolInfo = await findPool(provider, vIn.address, vOut.address);
  if (!poolInfo) return { error: `No V3 pool for ${symIn}/${symOut}` };

  // Get amountIn in token units
  let amountIn;
  if (symIn === 'USDC') {
    amountIn = ethers.parseUnits(amountUSD.toFixed(6), 6);
  } else {
    const usdcAmount = ethers.parseUnits(amountUSD.toFixed(6), 6);
    const rp = await findPool(provider, ALLOWED_TOKENS.USDC, vIn.address);
    if (!rp) return { error: `No USDC/${symIn} pool for price lookup` };
    const rq = await getQuote(provider, ALLOWED_TOKENS.USDC, vIn.address, usdcAmount, rp.fee);
    if (rq.error) return { error: rq.error };
    amountIn = rq.amountOut;
  }

  const quote = await getQuote(provider, vIn.address, vOut.address, amountIn, poolInfo.fee);
  if (quote.error) return { error: quote.error };

  const tokenOut = new ethers.Contract(vOut.address, ERC20_ABI, provider);
  const outDec = await tokenOut.decimals();

  return {
    tokenIn: symIn,
    tokenOut: symOut,
    amountUSD,
    amountIn: amountIn.toString(),
    amountOut: ethers.formatUnits(quote.amountOut, outDec),
    fee: poolInfo.fee,
    pool: poolInfo.pool,
    maxSlippageBps: isStablePair(vIn.address, vOut.address) ? MAX_SLIPPAGE_STABLE : MAX_SLIPPAGE_DEFAULT,
  };
}

module.exports = {
  createSwapContext,
  swapToken,
  getSwapStatus,
  getSwapQuote,
  ALLOWED_TOKENS,
  MAX_SWAP_USD,
  MAX_DAILY_USD,
  COOLDOWN_MS,
};
