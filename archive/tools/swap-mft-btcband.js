const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

const MFT = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const BTCBAND = '0x11DFE729F1211904efB99F4d4a3f9FAF6C93CCB5';
const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const FEE = 10000; // target the mispriced pool

const ERC20 = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'];
const ROUTER_ABI = ['function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'];

// ~$0.10 of MfT at ~9.46M MfT/$1
const SWAP_AMT = ethers.parseUnits('946000', 18);
const INTERVAL = 60000; // 1 min

async function doSwap(round) {
  const mft = new ethers.Contract(MFT, ERC20, wallet);
  const bal = await mft.balanceOf(wallet.address);

  if (bal < SWAP_AMT) {
    console.log(`[${round}] MfT balance too low: ${ethers.formatUnits(bal, 18)} — stopping`);
    return false;
  }

  // Check allowance
  const allowance = await mft.allowance(wallet.address, ROUTER);
  if (allowance < SWAP_AMT) {
    console.log(`[${round}] Approving MfT...`);
    await (await mft.approve(ROUTER, ethers.MaxUint256, { gasLimit: 100000 })).wait();
  }

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  const tx = await router.exactInputSingle({
    tokenIn: MFT,
    tokenOut: BTCBAND,
    fee: FEE,
    recipient: wallet.address,
    amountIn: SWAP_AMT,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  }, { gasLimit: 300000 });

  console.log(`[${round}] Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  const gasUsed = receipt.gasUsed;

  const newBal = await mft.balanceOf(wallet.address);
  const btcBand = new ethers.Contract(BTCBAND, ERC20, provider);
  const bandBal = await btcBand.balanceOf(wallet.address);
  console.log(`[${round}] Done. MfT left: ${ethers.formatUnits(newBal, 18)} | BTCband: ${ethers.formatUnits(bandBal, 18)}`);
  return true;
}

async function main() {
  console.log('Wallet:', wallet.address);
  console.log('Swapping ~$0.10 MfT → BTCband every 60s via fee=10000 pool');
  console.log('Amount per swap:', ethers.formatUnits(SWAP_AMT, 18), 'MfT\n');

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
