// Manually fulfill Dock request 0 (The Black Tide) from the relayer with an
// explicit high gas limit — to get past estimateGas choking on the buy-in
// nested try/catch self-call. If it lands, the ship launches.
const path = require('path'); const os = require('os');
require('dotenv').config({ path: path.join(os.homedir(), '.shipyard-wallets.env') });
const { ethers } = require('ethers');

const RPC = process.env.ALT_RPC || 'https://base.drpc.org';
const DOCK = '0x5A9185666551012B1ef381dA4cA309599AdF85D4';
const KEY = process.env.RELAYER_PRIVATE_KEY;

(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const w = new ethers.Wallet(KEY, p);
  console.log('relayer:', w.address, '| ETH:', ethers.formatEther(await p.getBalance(w.address)));
  const dock = new ethers.Contract(DOCK, [
    'function fulfill(uint256)',
    'function isFulfilled(uint256) view returns (bool)',
  ], w);
  if (await dock.isFulfilled(0)) { console.log('already fulfilled.'); return; }
  const tx = await dock.fulfill(0, {
    gasLimit: 24_000_000n,
    maxFeePerGas: ethers.parseUnits('0.02', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('0.003', 'gwei'),
  });
  console.log('fulfill tx:', tx.hash, '— waiting...');
  const rc = await tx.wait();
  console.log('status:', rc.status, '| gasUsed:', rc.gasUsed.toString(), '| block:', rc.blockNumber);
})().catch(e => { console.error('REVERTED/ERR:', e.shortMessage || e.message); if (e.receipt) console.error('gasUsed:', e.receipt.gasUsed?.toString()); process.exit(1); });
