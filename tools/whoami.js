// READ-ONLY. Derives wallet ADDRESS(es) from tools/.env keys and shows balances.
// SECURITY: prints only env var NAMES + derived ADDRESSES + balances. NEVER prints key values.
const fs = require('fs');
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const PATHS = [
  'C:\\Users\\bigji\\Documents\\MfT-Launch\\tools\\.env',
  'C:\\Users\\bigji\\Documents\\MfT-Launch\\marketing\\.env',
  'C:\\Users\\bigji\\Documents\\MfT-Launch\\.env',
];
const map = {};
for (const path of PATHS) {
  let env; try { env = fs.readFileSync(path, 'utf8'); } catch { continue; }
  for (const l of env.split(/\r?\n/)) {
    if (!l || l.trim().startsWith('#')) continue;
    const i = l.indexOf('='); if (i > 0) { const k = l.slice(0, i).trim(); if (!map[k]) map[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  }
}

console.log('env var names present:', Object.keys(map).join(', ') || '(none)');

function toWallet(v) {
  if (!v) return null;
  try { return new ethers.Wallet(v.startsWith('0x') ? v : '0x' + v); } catch {}
  try { return ethers.Wallet.fromPhrase(v); } catch {}
  return null;
}

(async () => {
  let found = 0;
  for (const [k, v] of Object.entries(map)) {
    const w = toWallet(v); if (!w) continue;
    found++;
    let eth = 0, usdc = 0;
    try { eth = Number(ethers.formatEther(await provider.getBalance(w.address))); } catch {}
    try { usdc = Number(ethers.formatUnits(await new ethers.Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider).balanceOf(w.address), 6)); } catch {}
    console.log(`${k.padEnd(22)} → ${w.address}   ETH:${eth.toFixed(5)}  USDC:${usdc.toFixed(2)}`);
  }
  if (!found) console.log('No private key / mnemonic found among those vars.');
})();
