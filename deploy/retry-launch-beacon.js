// Retry ONLY the BEACON launch (router + launchpad already deployed).
// Alchemy chokes on the high-gas launch send ("could not coalesce"), same as the
// Black Tide saga — so: estimateGas via Alchemy (confirms it won't revert + gives
// real gas), SEND via drpc (accepts high-gas Base txs), POLL the receipt via Alchemy.
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ALCHEMY = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const DRPC = 'https://base.drpc.org';
const PAD = '0xc0b891c9A56aF3Eb4cEB9B34CC9c3cE3E8C7074b';
const ROUTER = '0x203e8d717712965F6650506DeFD824225E4Ee0E1';
const VAULT = '0x799CfafABA99e9779fA8779B56dE62E193cb7B30';
const FEE = { maxFeePerGas: ethers.parseUnits('0.05', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.005', 'gwei') };

const PAD_ABI = [
  'function launch(string,string,address) returns (address,address)',
  'function launchCount() view returns (uint256)',
  'function owner() view returns (address)',
  'function transferOwnership(address)',
  'event CharityTokenLaunched(address indexed token, address reactor, address indexed charityRouter, address indexed launcher, string name, string symbol)',
];

(async () => {
  const key = execSync("grep AGENT_PRIVATE_KEY /c/Users/bigji/Documents/Baselings/api/.env | sed 's/.*=//'", { encoding: 'utf8' }).trim();
  const alch = new ethers.JsonRpcProvider(ALCHEMY, undefined, { batchMaxCount: 1 });
  const drpc = new ethers.JsonRpcProvider(DRPC, undefined, { batchMaxCount: 1 });
  const wRead = new ethers.Wallet(key, alch);
  const wSend = new ethers.Wallet(key, drpc);

  const padRead = new ethers.Contract(PAD, PAD_ABI, wRead);
  if ((await padRead.launchCount()) > 0n) { console.log('already launched.'); return; }

  // 1. estimateGas via Alchemy — confirms the launch will NOT revert on live state.
  console.log('Estimating launch gas via Alchemy...');
  let gas;
  try {
    gas = await padRead.launch.estimateGas('Beacon', 'BEACON', ROUTER);
    console.log('  estimateGas OK:', gas.toString(), '(no revert)');
  } catch (e) {
    console.error('  LAUNCH WOULD REVERT:', e.shortMessage || e.message, '| reason:', e.reason || '(none)');
    process.exit(1);
  }
  const gasLimit = gas * 130n / 100n; // +30% headroom

  // 2. Send via drpc.
  const padSend = new ethers.Contract(PAD, PAD_ABI, wSend);
  console.log('\nSending launch via drpc, gasLimit', gasLimit.toString(), '...');
  const tx = await padSend.launch('Beacon', 'BEACON', ROUTER, { gasLimit, ...FEE });
  console.log('  launch tx:', tx.hash);

  // 3. Poll the receipt via Alchemy (reliable reads).
  console.log('  polling receipt via Alchemy...');
  let rc = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    rc = await alch.getTransactionReceipt(tx.hash);
    if (rc) break;
    process.stdout.write('.');
  }
  if (!rc) throw new Error('no receipt after 180s — check ' + tx.hash);
  console.log('\n  status:', rc.status, '| gasUsed:', rc.gasUsed.toString(), '| block:', rc.blockNumber);
  if (rc.status !== 1) throw new Error('launch tx REVERTED on-chain');

  const ev = rc.logs.map(l => { try { return padRead.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === 'CharityTokenLaunched');
  if (!ev) throw new Error('CharityTokenLaunched not found');

  const out = JSON.parse(fs.readFileSync(path.join(__dirname, 'beacon-deployed.json'), 'utf8'));
  out.beaconToken = ev.args.token;
  out.reactor = ev.args.reactor;
  out.launchTx = tx.hash;
  fs.writeFileSync(path.join(__dirname, 'beacon-deployed.json'), JSON.stringify(out, null, 2));
  console.log('\n  BEACON token:', out.beaconToken);
  console.log('  reactor     :', out.reactor);

  const reactor = new ethers.Contract(out.reactor, ['function distributor() view returns (address)','function poolCount() view returns (uint256)'], alch);
  console.log('  reactor.distributor():', await reactor.distributor());
  console.log('  reactor.poolCount()  :', (await reactor.poolCount()).toString());

  // 4. Transfer launchpad ownership → Vault (small tx, via Alchemy).
  if ((await padRead.owner()).toLowerCase() === wRead.address.toLowerCase()) {
    console.log('\nTransferring launchpad ownership → Vault...');
    const t2 = await padRead.transferOwnership(VAULT, FEE);
    await alch.waitForTransaction(t2.hash);
    out.launchpadOwner = VAULT;
    fs.writeFileSync(path.join(__dirname, 'beacon-deployed.json'), JSON.stringify(out, null, 2));
    console.log('  owner now:', await padRead.owner());
  }

  console.log('\n=== BEACON LIVE ===\n' + JSON.stringify(out, null, 2));
  console.log('\nBaseScan: https://basescan.org/token/' + out.beaconToken);
})().catch(e => { console.error('FATAL:', e.shortMessage || e.message); process.exit(1); });
