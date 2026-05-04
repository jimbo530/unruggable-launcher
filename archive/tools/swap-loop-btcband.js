const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MFT = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const BTCBAND = '0x11DFE729F1211904efB99F4d4a3f9FAF6C93CCB5';
const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const FEE = 10000;

const ERC20 = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'];
const ROUTER_ABI = ['function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'];

const MFT_AMT = ethers.parseUnits('946000', 18); // ~$0.10 of MfT
const USDC_AMT = 100000n; // $0.10 USDC (6 dec)
const INTERVAL = 60000;

async function ensureApproval(token, label) {
  const t = new ethers.Contract(token, ERC20, wallet);
  const allowance = await t.allowance(wallet.address, ROUTER);
  if (allowance < ethers.MaxUint256 / 2n) {
    console.log(`  Approving ${label}...`);
    await (await t.approve(ROUTER, ethers.MaxUint256, { gasLimit: 100000 })).wait();
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function swap(tokenIn, tokenOut, amountIn, label) {
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  const tx = await router.exactInputSingle({
    tokenIn, tokenOut, fee: FEE,
    recipient: wallet.address,
    amountIn,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  }, { gasLimit: 300000 });
  console.log(`  ${label} tx: ${tx.hash}`);
  await tx.wait();
  await new Promise(r => setTimeout(r, 2000));
}

async function main() {
  console.log('Wallet:', wallet.address);
  console.log('Combined BTCband buy loop: MfT + USDC, $0.10 each, every 60s\n');

  // Approve both upfront
  await ensureApproval(MFT, 'MfT');
  await ensureApproval(USDC, 'USDC');

  let round = 1;
  while (true) {
    const mftBal = await new ethers.Contract(MFT, ERC20, provider).balanceOf(wallet.address);
    const usdcBal = await new ethers.Contract(USDC, ERC20, provider).balanceOf(wallet.address);
    const hasMft = mftBal >= MFT_AMT;
    const hasUsdc = usdcBal >= USDC_AMT;

    if (!hasMft && !hasUsdc) {
      console.log(`[${round}] Both balances too low — stopping`);
      break;
    }

    try {
      if (hasMft) {
        await swap(MFT, BTCBAND, MFT_AMT, `[${round}] MfT→BTCband`);
      } else {
        console.log(`[${round}] MfT too low, skipping`);
      }

      if (hasUsdc) {
        await swap(USDC, BTCBAND, USDC_AMT, `[${round}] USDC→BTCband`);
      } else {
        console.log(`[${round}] USDC too low, skipping`);
      }
    } catch (e) {
      console.error(`[${round}] Error: ${e.message}`);
    }

    const bandBal = await new ethers.Contract(BTCBAND, ERC20, provider).balanceOf(wallet.address);
    console.log(`[${round}] BTCband: ${ethers.formatUnits(bandBal, 18)}`);
    round++;
    console.log(`  Waiting 60s...`);
    await new Promise(r => setTimeout(r, INTERVAL));
  }
  console.log('Stopped.');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
