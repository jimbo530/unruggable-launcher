const { ethers } = require('ethers');
const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const DOCK = '0x5A9185666551012B1ef381dA4cA309599AdF85D4';
const RELAYER = '0xC4040cD3C6f899065d9d6e27A72B4dDF2B4dE023';
(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  console.log('relayer ETH   :', ethers.formatEther(await p.getBalance(RELAYER)));
  const fee = await p.getFeeData();
  console.log('gasPrice gwei :', ethers.formatUnits(fee.gasPrice ?? 0n, 'gwei'));
  const dock = new ethers.Contract(DOCK, [
    'function fulfill(uint256)',
    'function isFulfilled(uint256) view returns (bool)',
  ], p);
  console.log('isFulfilled(0):', await dock.isFulfilled(0));
  try {
    const g = await dock.fulfill.estimateGas(0, { from: RELAYER });
    console.log('estimateGas fulfill(0):', g.toString(), '(no revert — likely a transient RPC error; a retry should land)');
  } catch (e) {
    console.log('estimateGas REVERT msg:', e.shortMessage || e.message);
    console.log('reason:', e.reason || '(none)');
    if (e.info) console.log('info:', JSON.stringify(e.info).slice(0, 400));
  }
})().catch(e => console.error('ERR', e.shortMessage || e.message));
