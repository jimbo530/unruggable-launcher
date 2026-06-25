// @ts-check
/**
 * gold.js — the in-game GOLD wallet engine (Base). GOLD is the one in-game currency.
 *
 *   Buy gold:  USDC -> Money (Money.deposit, 1:1) -> GOLD (swap on the fee-100 pool)  [market price]
 *   Spend on NFTs (USDC stores): GOLD -> Money (swap) -> USDC (Money.redeem, 1:1)
 *
 * No fixed price — the gold/Money pool sets the rate. Exact approvals only (no MaxUint256).
 * Slippage protected via a live QuoterV2 quote. Browser ethers (window.ethers, v6).
 */

export const ADDR = {
  gold:   '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004', // 18 dec
  money:  '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072', // 6 dec, USDC-backed receipt
  usdc:   '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // 6 dec
  router: '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap SwapRouter02
  quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a', // QuoterV2
};
export const FEE = 100;          // 0.01% gold/Money pool
export const BASE_CHAIN = 8453n;
const SLIP_BPS = 200n;           // 2% default slippage guard

const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
];
const MONEY_ABI = [
  'function deposit(uint256 amount)',          // USDC in -> Money 1:1 to caller
  'function redeem(uint256 amount)',           // Money in -> USDC 1:1 to caller
];
const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
];
const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)',
];

let provider = null, signer = null, account = null;

export function isConnected() { return !!account; }
export function getAccount() { return account; }

export async function connect() {
  const eth = window.ethereum;
  if (!eth) throw new Error('No wallet found — install a Base-compatible wallet.');
  provider = new window.ethers.BrowserProvider(eth);
  await provider.send('eth_requestAccounts', []);
  const net = await provider.getNetwork();
  if (net.chainId !== BASE_CHAIN) {
    try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }); }
    catch (e) { throw new Error('Switch your wallet to Base.'); }
    provider = new window.ethers.BrowserProvider(eth);
  }
  signer = await provider.getSigner();
  account = await signer.getAddress();
  return account;
}

const erc = (a, ro) => new window.ethers.Contract(a, ERC20, ro ? provider : signer);
const fmt = (v, d) => Number(window.ethers.formatUnits(v, d));

/** Read balances (human numbers). */
export async function balances() {
  if (!account) return { gold: 0, usdc: 0, money: 0 };
  const [g, u, m] = await Promise.all([
    erc(ADDR.gold, true).balanceOf(account),
    erc(ADDR.usdc, true).balanceOf(account),
    erc(ADDR.money, true).balanceOf(account),
  ]);
  return { gold: fmt(g, 18), usdc: fmt(u, 6), money: fmt(m, 6) };
}

/** Live quote: how much GOLD a given USDC amount buys right now (human). */
export async function quoteGoldForUsdc(usdcHuman) {
  const amtIn = window.ethers.parseUnits(String(usdcHuman), 6); // USDC->Money is 1:1, both 6dec
  const q = new window.ethers.Contract(ADDR.quoter, QUOTER_ABI, provider);
  const out = await q.quoteExactInputSingle.staticCall({
    tokenIn: ADDR.money, tokenOut: ADDR.gold, amountIn: amtIn, fee: FEE, sqrtPriceLimitX96: 0n,
  });
  return fmt(out[0], 18);
}

async function ensureAllowance(token, spender, amount) {
  const c = erc(token, false);
  const cur = await c.allowance(account, spender);
  if (cur >= amount) return;
  await (await c.approve(spender, amount)).wait(); // exact amount, no MaxUint256
}

/**
 * Buy gold with USDC at market: USDC -> Money (1:1) -> GOLD (swap).
 * @returns {Promise<{goldOut:number,tx:string}>}
 */
export async function buyGold(usdcHuman) {
  if (!account) await connect();
  const usdcWei = window.ethers.parseUnits(String(usdcHuman), 6);
  if (usdcWei <= 0n) throw new Error('Enter a USDC amount.');
  const bal = await erc(ADDR.usdc, true).balanceOf(account);
  if (bal < usdcWei) throw new Error('Not enough USDC.');

  // 1) USDC -> Money (mint 1:1)
  await ensureAllowance(ADDR.usdc, ADDR.money, usdcWei);
  const money = new window.ethers.Contract(ADDR.money, MONEY_ABI, signer);
  await (await money.deposit(usdcWei)).wait();
  const moneyWei = usdcWei; // 1:1, both 6 dec

  // 2) Money -> GOLD (swap, slippage-guarded)
  const q = new window.ethers.Contract(ADDR.quoter, QUOTER_ABI, provider);
  const quoted = (await q.quoteExactInputSingle.staticCall({
    tokenIn: ADDR.money, tokenOut: ADDR.gold, amountIn: moneyWei, fee: FEE, sqrtPriceLimitX96: 0n,
  }))[0];
  const minOut = (quoted * (10000n - SLIP_BPS)) / 10000n;
  await ensureAllowance(ADDR.money, ADDR.router, moneyWei);
  const router = new window.ethers.Contract(ADDR.router, ROUTER_ABI, signer);
  const rc = await (await router.exactInputSingle({
    tokenIn: ADDR.money, tokenOut: ADDR.gold, fee: FEE, recipient: account,
    amountIn: moneyWei, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n,
  })).wait();
  return { goldOut: fmt(quoted, 18), tx: rc.hash };
}

/**
 * Spend gold -> USDC for NFT/USDC stores: GOLD -> Money (swap) -> USDC (redeem 1:1).
 * Returns the USDC received (human). Used by NFT checkout flows.
 * @returns {Promise<{usdcOut:number,tx:string}>}
 */
export async function sellGoldForUsdc(goldHuman) {
  if (!account) await connect();
  const goldWei = window.ethers.parseUnits(String(goldHuman), 18);
  if (goldWei <= 0n) throw new Error('Enter a gold amount.');
  const bal = await erc(ADDR.gold, true).balanceOf(account);
  if (bal < goldWei) throw new Error('Not enough gold.');

  const q = new window.ethers.Contract(ADDR.quoter, QUOTER_ABI, provider);
  const quoted = (await q.quoteExactInputSingle.staticCall({
    tokenIn: ADDR.gold, tokenOut: ADDR.money, amountIn: goldWei, fee: FEE, sqrtPriceLimitX96: 0n,
  }))[0];
  const minOut = (quoted * (10000n - SLIP_BPS)) / 10000n;
  await ensureAllowance(ADDR.gold, ADDR.router, goldWei);
  const router = new window.ethers.Contract(ADDR.router, ROUTER_ABI, signer);
  await (await router.exactInputSingle({
    tokenIn: ADDR.gold, tokenOut: ADDR.money, fee: FEE, recipient: account,
    amountIn: goldWei, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n,
  })).wait();
  // Money -> USDC (redeem 1:1)
  const money = new window.ethers.Contract(ADDR.money, MONEY_ABI, signer);
  const rc = await (await money.redeem(quoted)).wait();
  return { usdcOut: fmt(quoted, 6), tx: rc.hash };
}
