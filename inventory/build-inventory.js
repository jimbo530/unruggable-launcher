// build-inventory.js — scan the Seas deploy records and emit byte-exact CSV spreadsheets.
// READ-ONLY: reads deploy JSONs, copies every 0x address verbatim (no retyping), writes CSVs.
// Run: node MfT-Launch/inventory/build-inventory.js
const fs = require('fs');
const path = require('path');

const DOCS = 'C:/Users/bigji/Documents';
const OUT = path.join(DOCS, 'MfT-Launch', 'inventory');
fs.mkdirSync(OUT, { recursive: true });

// Source dirs + which files count as deployed economy records (skip compiler/build artifacts).
const SOURCES = [
  {
    dir: path.join(DOCS, 'MfT-Launch', 'deploy'),
    include: f => /-deployed\.json$/.test(f) || f === 'harvest-grounds.json',
  },
  {
    dir: path.join(DOCS, 'mftusd-build'),
    include: f => /(deployed|prize|tier|water|court|reward|endow|lootpool)/i.test(f)
      && !/(compile|_input|_output|artifact|\.abi|\.dbg|package|tsconfig)/i.test(f),
  },
];

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const rows = []; // {category,type,name,address,chain,file,context}

function fileCategory(file) {
  const f = file.toLowerCase();
  if (/crew|distributor|pawn/.test(f)) return 'Crew';
  if (/lootpool|prize|tier|court|reward|endow/.test(f)) return 'Prize-Loot Pool';
  if (/water/.test(f)) return 'Water';
  if (/shipyard|beacon|pawnmarket|dock/.test(f)) return 'Infra-Tool';
  if (/pool|walls|wall|lp|ocean|mill|harvest|gem-peg|coin-pools|port-keyed|port-royal/.test(f)) return 'Location LP';
  if (/coins|gems|foods|materials|forageables|produce|gear|crate|shells|black-tide|fish|brick|ingot|ore|stone|rice|flour|metal|wood|plank|cloth|leather/.test(f)) return 'Token';
  return 'Other';
}
function typeOf(key, category) {
  const k = String(key || '').toLowerCase();
  if (k === 'factory') return 'factory';
  if (['owner', 'deployer', 'wallet', 'treasury', 'creator'].includes(k)) return 'wallet';
  if (k === 'pool' || k === 'pair' || k === 'lp' || k.endsWith('pool') || k.endsWith('wall')) return 'pool';
  if (k === 'distributor' || k === 'crew' || k === 'collection') return 'nft';
  if (['impl', 'implementation', 'router', 'keeper', 'signer', 'relayer', 'oracle'].includes(k)) return 'contract';
  if (['goodaddr', 'tokenaddr', 'token', 'good', 'fish', 'gold', 'coin', 'gem', 'money', 'mft', 'usdc', 'address', 'addr', 'reward', 'rewardtoken'].includes(k)) return 'token';
  if (category === 'Token') return 'token';
  if (category === 'Location LP' || category === 'Prize-Loot Pool') return 'pool';
  return 'contract';
}
function contextOf(parent) {
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return '';
  const keep = {};
  for (const [k, v] of Object.entries(parent)) {
    if (typeof v === 'string' && ADDR_RE.test(v)) continue;
    if (['tx', 'txhash', 'hash', 'blocknumber', 'block'].includes(k.toLowerCase())) continue;
    if (v && typeof v === 'object') continue;
    keep[k] = v;
  }
  return Object.keys(keep).length ? JSON.stringify(keep) : '';
}
function deriveName(key, parent) {
  if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
    for (const c of ['name', 'good', 'symbol', 'sym', 'label', 'ticker', 'tier']) {
      if (typeof parent[c] === 'string' && !ADDR_RE.test(parent[c])) return parent[c];
    }
  }
  return (key != null && key !== '') ? String(key) : '';
}
function walk(node, parent, key, file, category) {
  if (node == null) return;
  if (typeof node === 'string') {
    if (ADDR_RE.test(node)) {
      rows.push({ category, type: typeOf(key, category), name: deriveName(key, parent), address: node, chain: 'base', file, context: contextOf(parent) });
    }
    return;
  }
  if (Array.isArray(node)) { node.forEach(v => walk(v, parent, key, file, category)); return; }
  if (typeof node === 'object') { for (const [k, v] of Object.entries(node)) walk(v, node, k, file, category); }
}

const scanned = [];
for (const src of SOURCES) {
  let files = [];
  try { files = fs.readdirSync(src.dir); } catch (e) { console.log('skip dir', src.dir, '-', e.message); continue; }
  for (const f of files) {
    if (!f.endsWith('.json') || !src.include(f)) continue;
    const full = path.join(src.dir, f);
    let j;
    try { j = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { console.log('bad json', f, '-', e.message); continue; }
    const before = rows.length;
    walk(j, null, null, f, fileCategory(f));
    scanned.push({ file: f, dir: path.basename(src.dir), addrs: rows.length - before });
  }
}

// de-dup identical rows (same address+name+file)
const seen = new Set();
const uniq = rows.filter(r => { const k = r.address.toLowerCase() + '|' + r.name + '|' + r.file; if (seen.has(k)) return false; seen.add(k); return true; });

const COLS = ['category', 'type', 'name', 'address', 'chain', 'file', 'context'];
const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const toCsv = arr => [COLS.join(','), ...arr.map(r => COLS.map(c => esc(r[c])).join(','))].join('\n');
const write = (name, arr) => { fs.writeFileSync(path.join(OUT, name), toCsv(arr)); return arr.length; };

// sheets
write('MASTER-inventory.csv', uniq);
const tokens = (() => { const s = new Set(); return uniq.filter(r => r.type === 'token').filter(r => { const a = r.address.toLowerCase(); if (s.has(a)) return false; s.add(a); return true; }); })();
write('tokens-unique.csv', tokens);
write('pools-and-LPs.csv', uniq.filter(r => r.type === 'pool'));
write('prize-loot-pools.csv', uniq.filter(r => r.category === 'Prize-Loot Pool'));
write('water.csv', uniq.filter(r => r.category === 'Water'));
write('infra-tools.csv', uniq.filter(r => r.type === 'factory' || r.type === 'contract' || r.category === 'Infra-Tool'));
write('crew-distributors.csv', uniq.filter(r => r.category === 'Crew'));

// summary
const byCat = {}; for (const r of uniq) byCat[r.category] = (byCat[r.category] || 0) + 1;
const byType = {}; for (const r of uniq) byType[r.type] = (byType[r.type] || 0) + 1;
console.log('=== FILES SCANNED (' + scanned.length + ') ===');
for (const s of scanned) console.log('  [' + s.dir + '] ' + s.file + ' -> ' + s.addrs + ' addrs');
console.log('=== TOTAL unique address rows:', uniq.length, '===');
console.log('by category:', JSON.stringify(byCat));
console.log('by type:', JSON.stringify(byType));
console.log('unique tokens:', tokens.length, '| pools:', uniq.filter(r => r.type === 'pool').length);
console.log('CSVs ->', OUT);
