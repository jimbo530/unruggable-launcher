// Buy BRUH with AZUSD — $0.10 per swap, 1 per minute
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require(path.join(__dirname, '..', 'node_modules', 'ethers'));

const BASE_RPC = 'https://mainnet.base.org';
const AZUSD = '0x3595ca37596D5895B70EFAB592ac315D5B9809B2';
const BRUH = '0xe61b190c0f0070e07de3bb4829fe5fdcf7d934f1';
const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const FEE = 10000;
const SWAP_AMOUNT = ethers.parseUnits('0.1', 18); // 0.1 AZUSD = $0.10
const INTERVAL_MS = 60_000; // 1 minute

const provider = new ethers.JsonRpcProvider(BASE_RPC);
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

const azusd = new ethers.Contract(AZUSD, [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
], wallet);

const router = new ethers.Contract(ROUTER, [
  'function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) payable returns (uint256)',
], wallet);

let swapCount = 0;

async function doSwap() {
  const bal = await azusd.balanceOf(wallet.address);
  if (bal < SWAP_AMOUNT) {
    console.log(`[${new Date().toISOString()}] AZUSD balance ${ethers.formatUnits(bal, 18)} < 0.1 — DONE. ${swapCount} swaps total.`);
    process.exit(0);
  }

  // Approve if needed
  const allowance = await azusd.allowance(wallet.address, ROUTER);
  if (allowance < SWAP_AMOUNT) {
    console.log('Approving AZUSD...');
    const tx = await azusd.approve(ROUTER, ethers.MaxUint256);
    await tx.wait();
    console.log('Approved.');
  }

  try {
    const tx = await router.exactInputSingle([
      AZUSD,           // tokenIn
      BRUH,            // tokenOut
      FEE,             // fee
      wallet.address,  // recipient
      SWAP_AMOUNT,     // amountIn
      0,               // amountOutMinimum
      0                // sqrtPriceLimitX96
    ]);
    const receipt = await tx.wait();
    swapCount++;
    const remaining = ethers.formatUnits(await azusd.balanceOf(wallet.address), 18);
    console.log(`[${new Date().toISOString()}] Swap #${swapCount} OK | tx: ${receipt.hash.slice(0,10)}... | AZUSD left: ${remaining}`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Swap failed: ${e.shortMessage || e.message}`);
  }
}

async function main() {
  console.log(`Buy BRUH with AZUSD — $0.10/swap, 1/min`);
  console.log(`Wallet: ${wallet.address}`);
  const bal = await azusd.balanceOf(wallet.address);
  console.log(`AZUSD balance: ${ethers.formatUnits(bal, 18)}`);
  console.log(`Estimated swaps: ~${Math.floor(Number(ethers.formatUnits(bal, 18)) / 0.1)}`);
  console.log('Starting...\n');

  await doSwap(); // first swap immediately
  setInterval(doSwap, INTERVAL_MS);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
