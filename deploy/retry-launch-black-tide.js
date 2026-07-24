// Retry the Black Tide launch (Dock.fulfill(0)) now that the buy-in is disabled.
// estimateGas via Alchemy FIRST: if it still reverts, the buy-in was NOT the cause
// (report + stop, don't burn gas). If it clears, SEND via drpc + poll receipt via Alchemy.
const { ethers } = require('ethers');
const { execSync } = require('child_process');
const path = require('path'); const os = require('os');

const ALCHEMY = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const DRPC = 'https://base.drpc.org';
const DOCK = '0x5A9185666551012B1ef381dA4cA309599AdF85D4';
const FEE = { maxFeePerGas: ethers.parseUnits('0.05', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.004', 'gwei') };
const DOCK_ABI = [
  'function fulfill(uint256)',
  'function isFulfilled(uint256) view returns (bool)',
  'event LaunchFulfilled(uint256 indexed id, address indexed user, address token, address reactor, address distributor)',
];
const grepKey = (file, name) => execSync(`grep ${name} "${file}" | sed 's/.*=//' | tr -d '"'`, { encoding: 'utf8' }).trim();

(async () => {
  const alch = new ethers.JsonRpcProvider(ALCHEMY, undefined, { batchMaxCount: 1 });
  const drpc = new ethers.JsonRpcProvider(DRPC, undefined, { batchMaxCount: 1 });
  const relayerKey = grepKey(path.join(os.homedir(), '.shipyard-wallets.env'), 'RELAYER_PRIVATE_KEY');
  const agentKey = grepKey('C:/Users/bigji/Documents/Baselings/api/.env', 'AGENT_PRIVATE_KEY');
  const rRead = new ethers.Wallet(relayerKey, alch);
  const rSend = new ethers.Wallet(relayerKey, drpc);
  const agent = new ethers.Wallet(agentKey, alch);

  const dock = new ethers.Contract(DOCK, DOCK_ABI, rRead);
  if (await dock.isFulfilled(0)) { console.log('already fulfilled.'); return; }

  // 1. estimateGas — does it still revert?
  console.log('Estimating fulfill(0) gas via Alchemy...');
  let gas;
  try {
    gas = await dock.fulfill.estimateGas(0);
    console.log('  estimateGas OK:', gas.toString(), '→ no revert, the buy-in WAS the blocker 🎉');
  } catch (e) {
    console.error('  STILL REVERTS:', e.shortMessage || e.message);
    console.error('  → the buy-in was NOT the cause. Needs a fork-trace, not a retry. Stopping (no gas burned).');
    process.exit(2);
  }
  const gasLimit = gas * 130n / 100n;

  // 2. Make sure the relayer has gas (fund from agent if thin).
  const need = gasLimit * FEE.maxFeePerGas;
  let rb = await alch.getBalance(rRead.address);
  console.log('relayer ETH:', ethers.formatEther(rb), '| reserve needed:', ethers.formatEther(need));
  if (rb < need) {
    console.log('Funding relayer 0.0006 ETH from agent...');
    await (await agent.sendTransaction({ to: rRead.address, value: ethers.parseEther('0.0006'), ...FEE })).wait();
    console.log('  relayer ETH now:', ethers.formatEther(await alch.getBalance(rRead.address)));
  }

  // 3. Send via drpc, poll receipt via Alchemy.
  const dockSend = new ethers.Contract(DOCK, DOCK_ABI, rSend);
  console.log('\nSending fulfill(0) via drpc, gasLimit', gasLimit.toString(), '...');
  const tx = await dockSend.fulfill(0, { gasLimit, ...FEE });
  console.log('  tx:', tx.hash, '— polling receipt via Alchemy...');
  let rc = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    rc = await alch.getTransactionReceipt(tx.hash);
    if (rc) break;
    process.stdout.write('.');
  }
  if (!rc) throw new Error('no receipt after 180s — check ' + tx.hash);
  console.log('\n  status:', rc.status, '| gasUsed:', rc.gasUsed.toString());
  if (rc.status !== 1) throw new Error('fulfill REVERTED on-chain (status 0) — fork-trace needed');

  console.log('\n  isFulfilled(0):', await dock.isFulfilled(0));
  const ev = rc.logs.map(l => { try { return dock.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === 'LaunchFulfilled');
  if (ev) {
    console.log('\n=== 🏴‍☠️ THE BLACK TIDE IS LAUNCHED ===');
    console.log('  token (ship)   :', ev.args.token);
    console.log('  reactor        :', ev.args.reactor);
    console.log('  distributor    :', ev.args.distributor, '(the 100 crew NFTs)');
    console.log('  BaseScan       : https://basescan.org/token/' + ev.args.token);
  } else {
    console.log('  (LaunchFulfilled event not found in logs — check the tx)');
  }
})().catch(e => { console.error('FATAL:', e.shortMessage || e.message); process.exit(1); });
