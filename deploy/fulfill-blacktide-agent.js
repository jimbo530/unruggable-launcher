// Fulfill the Black Tide (Dock id 0) — buy-in already disabled, estimateGas clears.
// Send from the AGENT (fulfill is permissionless) via the OFFICIAL Base RPC
// (mainnet.base.org → guaranteed sequencer propagation; drpc silently dropped the
// earlier sends). Poll the receipt via Alchemy.
const { ethers } = require('ethers');
const { execSync } = require('child_process');

const BASE = 'https://mainnet.base.org';
const ALCHEMY = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const DOCK = '0x5A9185666551012B1ef381dA4cA309599AdF85D4';
const FEE = { maxFeePerGas: ethers.parseUnits('0.04', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.004', 'gwei') };
const ABI = [
  'function fulfill(uint256)',
  'function isFulfilled(uint256) view returns (bool)',
  'event LaunchFulfilled(uint256 indexed id, address indexed user, address token, address reactor, address distributor)',
];

(async () => {
  const alch = new ethers.JsonRpcProvider(ALCHEMY, undefined, { batchMaxCount: 1 });
  const seq = new ethers.JsonRpcProvider('https://mainnet.base.org', undefined, { batchMaxCount: 1 });
  const key = execSync("grep AGENT_PRIVATE_KEY /c/Users/bigji/Documents/Baselings/api/.env | sed 's/.*=//'", { encoding: 'utf8' }).trim();
  const agentRead = new ethers.Wallet(key, alch);
  const agentSend = new ethers.Wallet(key, seq);   // official sequencer RPC — accepts block-sized gas + propagates directly
  console.log('agent:', agentRead.address, '| ETH:', ethers.formatEther(await alch.getBalance(agentRead.address)));

  const dock = new ethers.Contract(DOCK, ABI, agentRead);
  if (await dock.isFulfilled(0)) { console.log('already fulfilled.'); return; }

  const gas = await dock.fulfill.estimateGas(0);
  const gasLimit = 16_700_000n;   // just above the ~16.66M estimate, under the ~17M provider send cap
  console.log('estimateGas:', gas.toString(), '→ sending fulfill(0) via Base sequencer, gasLimit', gasLimit.toString());
  const tx = await new ethers.Contract(DOCK, ABI, agentSend).fulfill(0, { gasLimit, ...FEE });
  console.log('  tx:', tx.hash);
  // confirm drpc actually propagated it (it silently dropped an earlier send)
  await new Promise(r => setTimeout(r, 6000));
  const seen = await alch.getTransaction(tx.hash).catch(() => null);
  console.log('  Alchemy sees tx:', seen ? 'yes — propagated ✅' : 'NOT YET (will keep polling)');
  console.log('  polling receipt via Alchemy...');

  let rc = null;
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 3000));
    rc = await alch.getTransactionReceipt(tx.hash).catch(() => null);
    if (rc) break;
    process.stdout.write('.');
  }
  if (!rc) { console.log('\n  no receipt yet — checking isFulfilled anyway...'); console.log('  isFulfilled(0):', await alch.contract ? '' : await new ethers.Contract(DOCK, ABI, alch).isFulfilled(0)); throw new Error('no receipt; tx=' + tx.hash); }
  console.log('\n  status:', rc.status, '| gasUsed:', rc.gasUsed.toString());
  if (rc.status !== 1) throw new Error('REVERTED on-chain');

  const dockA = new ethers.Contract(DOCK, ABI, alch);
  console.log('  isFulfilled(0):', await dockA.isFulfilled(0));
  const ev = rc.logs.map(l => { try { return dockA.interface.parseLog(l); } catch { return null; } }).find(e => e && e.name === 'LaunchFulfilled');
  if (ev) {
    console.log('\n=== 🏴‍☠️ THE BLACK TIDE IS LAUNCHED ===');
    console.log('  token (ship): ', ev.args.token);
    console.log('  reactor     : ', ev.args.reactor);
    console.log('  crew (100)  : ', ev.args.distributor);
    console.log('  BaseScan    :  https://basescan.org/token/' + ev.args.token);
    const fs = require('fs');
    fs.writeFileSync(__dirname + '/black-tide-deployed.json', JSON.stringify({ token: ev.args.token, reactor: ev.args.reactor, distributor: ev.args.distributor, tx: tx.hash }, null, 2));
  }
})().catch(e => { console.error('FATAL:', e.shortMessage || e.message); if (e.error) console.error('  rpc error:', JSON.stringify(e.error).slice(0, 300)); if (e.info) console.error('  info:', JSON.stringify(e.info).slice(0, 300)); process.exit(1); });
