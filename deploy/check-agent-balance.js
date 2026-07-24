// Read-only: derive the agent wallet address from the deploy key (prints ONLY
// the address, never the key) and check its Base ETH + USDC balances.
const { ethers } = require('ethers');
const path = require('path');

// Load env from the known locations (does not print anything secret)
for (const p of [
  path.join(__dirname, '..', '..', 'Baselings', 'api', '.env'),
  path.join(__dirname, '..', '.env'),
]) {
  try { require('dotenv').config({ path: p }); } catch (e) {}
}

const key = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!key) { console.error('No AGENT_PRIVATE_KEY / DEPLOY_PRIVATE_KEY found in env'); process.exit(1); }

const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

(async () => {
  const wallet = new ethers.Wallet(key);
  const addr = wallet.address;
  console.log('AGENT WALLET:', addr);

  const provider = new ethers.JsonRpcProvider(RPC);
  const ethBal = await provider.getBalance(addr);
  const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider);
  const usdcBal = await usdc.balanceOf(addr);

  console.log('ETH :', ethers.formatEther(ethBal), 'ETH');
  console.log('USDC:', ethers.formatUnits(usdcBal, 6), 'USDC');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
