// Verify LocationPool impl + LocationLPFactory on Basescan via Etherscan V2 API.
// PROVEN profile (byte-matched): solc v0.8.34+commit.80d5c536, viaIR true,
// optimizer runs 200, evmVersion cancun. Multi-file standard-json (LocationPool +
// LocationLPFactory + OZ imports inlined). Verification is off-chain — no tx.
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const API_URL = 'https://api.etherscan.io/v2/api';
const CHAIN_ID = '8453';
const KEY = (function () {
  const l = fs.readFileSync(path.join(__dirname, 'tools', '.env'), 'utf8').split(/\r?\n/).find(x => x.startsWith('BASESCAN_API_KEY='));
  return l ? l.split('=')[1].trim() : (process.env.BASESCAN_API_KEY || '');
})();

const ROOT = __dirname;
const NM = path.join(ROOT, 'node_modules');

// Recursively collect a source file + all its (relative + node_modules) imports.
const importRe = /import\s+(?:\{[^}]*\}\s+from\s+)?["']([^"']+)["']/g;
function resolvePath(spec, fromFile) {
  if (spec.startsWith('.')) return path.normalize(path.join(path.dirname(fromFile), spec));
  return path.join(NM, spec); // package import
}
function keyFor(absPath) {
  // Use a stable key: node_modules paths as the bare package spec, project files relative to ROOT
  if (absPath.startsWith(NM)) return path.relative(NM, absPath).replace(/\\/g, '/');
  return path.relative(ROOT, absPath).replace(/\\/g, '/');
}
function collect(entryAbs, sources = {}, seen = new Set()) {
  const abs = path.normalize(entryAbs);
  if (seen.has(abs)) return sources;
  seen.add(abs);
  const content = fs.readFileSync(abs, 'utf8');
  sources[keyFor(abs)] = { content };
  let m;
  importRe.lastIndex = 0;
  while ((m = importRe.exec(content)) !== null) {
    const dep = resolvePath(m[1], abs);
    collect(dep, sources, seen);
  }
  return sources;
}

const SETTINGS = {
  viaIR: true,
  optimizer: { enabled: true, runs: 200 },
  evmVersion: 'cancun',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
};
const COMPILER = 'v0.8.34+commit.80d5c536';

const TARGETS = [
  {
    label: 'LocationPool impl', addr: '0x6700ded62e5f773729dcb1Eb8C93F2Da7fDD7A9F',
    entry: path.join(ROOT, 'contracts', 'LocationPool.sol'),
    contractName: 'contracts/LocationPool.sol:LocationPool',
    args: '', // no-arg constructor (deployed as clone template via .deploy())
  },
  {
    label: 'LocationLPFactory', addr: '0x54868729015F0050B364729454a018f1FF7a2d01',
    entry: path.join(ROOT, 'contracts', 'LocationLPFactory.sol'),
    contractName: 'contracts/LocationLPFactory.sol:LocationLPFactory',
    args: ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address'],
      ['0x6700ded62e5f773729dcb1Eb8C93F2Da7fDD7A9F', '0xF426fEfB83dbd8F7398C2e7559178CDEb4C17db8']
    ).slice(2),
  },
];

async function poll(guid) {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const u = `${API_URL}?chainid=${CHAIN_ID}&apikey=${KEY}&module=contract&action=checkverifystatus&guid=${guid}`;
    const j = await (await fetch(u)).json();
    console.log('    status:', JSON.stringify(j.result));
    if (j.result && !String(j.result).includes('Pending')) return j.result;
  }
  return 'timeout';
}

async function verifyOne(t) {
  console.log('\n=== ' + t.label + ' — ' + t.addr + ' ===');
  const sources = collect(t.entry);
  console.log('  source files bundled:', Object.keys(sources).length);
  const standardJson = JSON.stringify({ language: 'Solidity', sources, settings: SETTINGS });
  const params = new URLSearchParams();
  params.append('apikey', KEY);
  params.append('module', 'contract');
  params.append('action', 'verifysourcecode');
  params.append('contractaddress', t.addr);
  params.append('sourceCode', standardJson);
  params.append('codeformat', 'solidity-standard-json-input');
  params.append('contractname', t.contractName);
  params.append('compilerversion', COMPILER);
  params.append('constructorArguements', t.args);
  const res = await fetch(`${API_URL}?chainid=${CHAIN_ID}`, { method: 'POST', body: params });
  const j = await res.json().catch(async () => ({ raw: await res.text() }));
  console.log('  submit:', JSON.stringify(j));
  if (j.status === '1' && j.result) return await poll(j.result);
  // "already verified" is a success case
  if (String(j.result || '').toLowerCase().includes('already verified')) return 'Already Verified';
  return 'SUBMIT-FAILED: ' + JSON.stringify(j.result || j);
}

async function main() {
  if (!KEY) { console.error('NO KEY'); process.exit(1); }
  console.log('Key loaded (len ' + KEY.length + '), compiler ' + COMPILER + ', viaIR runs200 cancun');
  const out = {};
  for (const t of TARGETS) out[t.label] = await verifyOne(t);
  console.log('\n==== RESULTS ====');
  for (const [k, v] of Object.entries(out)) console.log(' ', k.padEnd(20), '->', v);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
