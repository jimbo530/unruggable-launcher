// READ-ONLY recon. Scans /root/*/.env for a key that derives to the agent wallet.
// SECURITY: prints only dir + var NAME + derived ADDRESS. NEVER prints key values.
const fs = require('fs');
const { ethers } = require('ethers');
const TARGET = '0xe2a4a8b9d77080c57799a94ba8edeb2dd6e0ac10';

let dirs = [];
try { dirs = fs.readdirSync('/root').filter(d => { try { return fs.statSync('/root/' + d).isDirectory(); } catch { return false; } }); } catch {}
const seen = new Set();
let agentFound = null;
for (const d of dirs) {
  const f = '/root/' + d + '/.env';
  let env; try { env = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const l of env.split(/\r?\n/)) {
    if (!l || l.trim().startsWith('#')) continue;
    const i = l.indexOf('='); if (i < 0) continue;
    const name = l.slice(0, i).trim();
    const val = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!/KEY|PRIV|PK|MNEMONIC|SEED/i.test(name)) continue;
    let w = null;
    try { w = new ethers.Wallet(val.startsWith('0x') ? val : '0x' + val); } catch { try { w = ethers.Wallet.fromPhrase(val); } catch {} }
    if (!w) continue;
    const a = w.address.toLowerCase();
    const isAgent = a === TARGET;
    if (isAgent) agentFound = d + '/.env (' + name + ')';
    const tag = isAgent ? '  <== AGENT 0xE2a4 ✅' : '';
    const dedupe = d + '|' + w.address;
    if (!seen.has(dedupe)) { seen.add(dedupe); console.log(`${d}/.env  ${name}  -> ${w.address}${tag}`); }
  }
}
console.log('\nAGENT KEY PRESENT:', agentFound || 'NOT FOUND in /root/*/.env');
