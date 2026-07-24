#!/usr/bin/env node
/*
  build-commodity-sheet.cjs — compile ALL in-game COMMODITY tokens (coins, gems, food, materials,
  forageables, produce, gear, fish) from the deploy records into one CSV. Companion to the existing
  water-tokens registry. READ-ONLY (reads deploy/*.json, writes commodity-tokens.csv). No chain calls.
*/
'use strict';
const fs = require('fs'); const path = require('path');
const DIR = __dirname; // MfT-Launch/deploy
const OUT = path.join(DIR, '..', 'game', 'seas', 'commodity-tokens.csv');

const read = (f) => { const p = path.join(DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const rows = [];
function push(cat, key, e, extraNote) {
  if (!e || !e.address) return;
  const sym = e.symbol || key.toUpperCase();
  const notes = [];
  for (const k of ['from','building','stage','craftsInto','kind','gold','food','hp','mana','premium','terrain']) {
    if (e[k] !== undefined) notes.push(`${k}=${Array.isArray(e[k]) ? e[k].join('|') : e[k]}`);
  }
  if (extraNote) notes.unshift(extraNote);
  rows.push([cat, sym, e.name || key, e.address, e.decimals ?? 18, notes.join('; ')]);
}

// (file, containerKey, category)
const SRC = [
  ['coins-deployed.json',       'coins',       'coin'],
  ['gems-deployed.json',        'coins',       'gem'],
  ['foods-deployed.json',       'coins',       'food'],
  ['materials-deployed.json',   'materials',   'material'],
  ['stone-deployed.json',       'stones',      'stone'],   // raw quarried stone (deploy-raw-materials.js)
  ['ore-deployed.json',         'ores',        'ore'],     // raw mined ore   (deploy-raw-materials.js)
  ['ingot-deployed.json',       'ingots',      'ingot'],   // smelted metal ingots (deploy-raw-materials.js)
  ['brick-deployed.json',       'bricks',      'brick'],   // fired clay bricks    (deploy-raw-materials.js)
  ['potion-deployed.json',      'potions',     'potion'],  // health + mana potions (deploy-potions.js)
  ['orb-deployed.json',         'orbs',        'orb'],     // chrono orb (cooldown-skip consumable) (deploy-chrono-orb.js)
  ['forageables-deployed.json', 'forageables', 'forageable'],
  ['produce-deployed.json',     'produce',     'produce'],
  ['gear-deployed.json',        'gear',        'gear'],
  ['../../mftusd-build/rice-flour-deployed.json', 'tokens', 'food'], // RICE + FLOUR (goblin loot staples; FLOUR=milled-wheat intermediate)
];
for (const [file, key, cat] of SRC) {
  const j = read(file);
  if (!j || !j[key]) { console.log(`(skip ${file} — missing/empty)`); continue; }
  for (const [k, e] of Object.entries(j[key])) push(cat, k, e);
}
// FISH — ocean record (special shape)
const ocean = read('ocean-deployed.json');
if (ocean && ocean.fish) rows.push(['fish', 'FISH', 'Fish', ocean.fish, 18, ocean.portRoyal ? `Port Royal wall price=${ocean.portRoyal.price}g` : 'ocean economy']);

rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
const header = '# Seize the Seas — COMMODITY TOKENS (trade goods / resources). Companion to water-tokens.csv.\n'
  + `# Auto-built from MfT-Launch/deploy/*.json by build-commodity-sheet.cjs on ${new Date().toISOString().slice(0,10)}. Re-run to refresh.\n`
  + '# All ERC20 on Base (chainId 8453), 18 decimals unless noted. Treasury/deployer 0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10.\n'
  + 'category,symbol,name,address,decimals,notes\n';
fs.writeFileSync(OUT, header + rows.map(r => r.map(x => /[",]/.test(String(x)) ? `"${x}"` : x).join(',')).join('\n') + '\n');
const byCat = {}; for (const r of rows) byCat[r[0]] = (byCat[r[0]] || 0) + 1;
console.log(`wrote ${rows.length} commodity tokens -> ${OUT}`);
console.log('by category:', JSON.stringify(byCat));
