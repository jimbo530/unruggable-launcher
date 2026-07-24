const { ethers } = require('ethers');
const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const RELAYER = '0xC4040cD3C6f899065d9d6e27A72B4dDF2B4dE023';
const AGENT   = '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10';
const TX = '0x004c5a7f38728fbcd99674017eb22c71a5a8058330ba107f8a72b355e3f2d400';
(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const rcpt = await p.getTransactionReceipt(TX);
  const tx = await p.getTransaction(TX);
  console.log('tx status   :', rcpt ? rcpt.status : 'NULL (not found/pending)');
  console.log('tx to       :', tx ? tx.to : 'n/a');
  console.log('tx value    :', tx ? ethers.formatEther(tx.value) + ' ETH' : 'n/a');
  console.log('block       :', rcpt ? rcpt.blockNumber : 'n/a');
  console.log('RELAYER bal :', ethers.formatEther(await p.getBalance(RELAYER)), 'ETH');
  console.log('AGENT bal   :', ethers.formatEther(await p.getBalance(AGENT)), 'ETH');
})().catch(e => { console.error('ERROR:', e.shortMessage || e.message); process.exit(1); });
