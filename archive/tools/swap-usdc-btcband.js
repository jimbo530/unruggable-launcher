const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BTCBAND = '0x11DFE729F1211904efB99F4d4a3f9FAF6C93CCB5';
const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const FEE = 10000;

const ERC20 = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'];
const ROUTER_ABI = ['function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'];

const SWAP_AMT = 100000n; // $0.10 USDC (6 dec)
const INTERVAL = 60000;

async function doSwap(round) {
  const usdc = new ethers.Contract(USDC, ERC20, wallet);
  const bal = await usdc.balanceOf(wallet.address);

  if (bal < SWAP_AMT) {
    console.log(`[${round}] USDC balance too low: ${ethers.formatUnits(bal, 6)} — stopping`);
    return false;
  }

  const allowance = await usdc.allowance(wallet.address, ROUTER);
  if (allowance < SWAP_AMT) {
    console.log(`[${round}] Approving USDC...`);
    await (await usdc.approve(ROUTER, ethers.MaxUint256, { gasLimit: 100000 })).wait();
  }

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  const tx = await router.exactInputSingle({
    tokenIn: USDC,
    tokenOut: BTCBAND,
    fee: FEE,
    recipient: wallet.address,
    amountIn: SWAP_AMT,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  }, { gasLimit: 300000 });

  console.log(`[${round}] Tx: ${tx.hash}`);
  await tx.wait();

  const [usdcBal, bandBal] = await Promise.all([
    usdc.balanceOf(wallet.address),
    new ethers.Contract(BTCBAND, ERC20, provider).balanceOf(wallet.address)
  ]);
  console.log(`[${round}] Done. USDC: ${ethers.formatUnits(usdcBal, 6)} | BTCband: ${ethers.formatUnits(bandBal, 18)}`);
  return true;
}

async function main() {
  console.log('Wallet:', wallet.address);
  console.log('Swapping $0.10 USDC → BTCband every 60s via fee=10000 pool\n');

  let round = 1;
  while (true) {
    try {
      const ok = await doSwap(round);
      if (!ok) break;
    } catch (e) {
      console.error(`[${round}] Error: ${e.message}`);
    }
    round++;
    console.log(`  Waiting 60s...`);
    await new Promise(r => setTimeout(r, INTERVAL));
  }
  console.log('Stopped.');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
