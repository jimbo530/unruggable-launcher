// Send ~$2 of ETH from the agent wallet to the Relayer to bootstrap its gas.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const RPC     = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const RELAYER = '0xC4040cD3C6f899065d9d6e27A72B4dDF2B4dE023';
const AMOUNT  = ethers.parseEther('0.00115'); // ~$2 at ~$1748/ETH
const KEY     = process.env.DEPLOY_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  console.log('From  :', wallet.address);
  console.log('To    :', RELAYER);
  console.log('Amount:', ethers.formatEther(AMOUNT), 'ETH');
  const before = await provider.getBalance(RELAYER);
  const tx = await wallet.sendTransaction({ to: RELAYER, value: AMOUNT });
  console.log('tx:', tx.hash);
  await tx.wait();
  const after = await provider.getBalance(RELAYER);
  console.log('Relayer ETH:', ethers.formatEther(before), '->', ethers.formatEther(after));
})().catch(e => { console.error('ERROR:', e.shortMessage || e.message); process.exit(1); });
