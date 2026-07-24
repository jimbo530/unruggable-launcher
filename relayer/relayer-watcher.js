// Read-only watcher: checks the relayer's ETH and writes an agent-bus alert when
// it runs low, so you can top it up (from Vault profit: swap USDC→ETH→relayer)
// before the gasless flow stalls. No key, no txs — purely observational.
//   node relayer-watcher.js --once     # single check
//   node relayer-watcher.js            # loop (POLL_MS, default 5 min)
const path = require('path');
const os = require('os');
const fs = require('fs');
const { ethers } = require('ethers');

const RPC       = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const RELAYER   = '0xC4040cD3C6f899065d9d6e27A72B4dDF2B4dE023';
const ALERT_ETH = parseFloat(process.env.ALERT_ETH || '0.0004');   // ~$0.70 → top up soon
const GAS_PER   = parseFloat(process.env.GAS_PER_LAUNCH || '0.0001'); // ~16M gas @ low Base gas
const BUS_DIR   = path.join(os.homedir(), '.claude', 'agent-bus', 'messages');
const ONCE      = process.argv.includes('--once');
const POLL_MS   = parseInt(process.env.POLL_MS || '300000', 10);

const provider = new ethers.JsonRpcProvider(RPC);

async function check() {
  const eth = Number(ethers.formatEther(await provider.getBalance(RELAYER)));
  const left = Math.floor(eth / GAS_PER);
  const low = eth < ALERT_ETH;
  console.log(`[${new Date().toISOString()}] relayer ${RELAYER} = ${eth} ETH (~${left} launches left) ${low ? '⚠ LOW — TOP UP' : 'ok'}`);
  if (low) writeAlert(eth, left);
}

function writeAlert(eth, left) {
  try {
    const body = `---\nfrom: relayer-watcher\nto: all\nstatus: new\npriority: high\ntopic: Relayer gas LOW — top up to keep gasless launches running\n---\n\nRelayer \`${RELAYER}\` is at ${eth} ETH (~${left} launches left).\nTop up from Vault profit: swap a little treasury USDC → ETH → relayer.\n`;
    fs.writeFileSync(path.join(BUS_DIR, 'relayer-low-gas-alert.md'), body);
    console.log('  -> wrote agent-bus alert (relayer-low-gas-alert.md)');
  } catch (e) { console.error('  alert write failed:', e.message); }
}

(async () => {
  if (ONCE) return check();
  while (true) {
    try { await check(); } catch (e) { console.error('check failed:', e.message); }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
})();
