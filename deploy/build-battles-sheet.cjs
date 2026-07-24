#!/usr/bin/env node
/*
  build-battles-sheet.cjs — compile ALL combat/battle reward pools into one CSV: the per-location
  LootPools (bilge, goblin) + the tiered achievement PrizePools (cbBTC/GOLD/WETH × Mayor→Emperor).
  Companion to commodity-tokens.csv + water-tokens.csv. READ-ONLY (reads deploy records). No chain calls.
*/
'use strict';
const fs = require('fs'); const path = require('path');
const DIR = __dirname;                       // MfT-Launch/deploy
const MB = path.join(DIR, '..', '..', 'mftusd-build');
const OUT = path.join(DIR, '..', 'game', 'seas', 'battles-loot-pools.csv');
const read = (p) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
const rows = [];

// 1) Per-location LootPools (combat loot — copper floor + item drops + weapon jackpots)
for (const f of ['bilge-lootpool-deployed.json', 'goblin-lootpool-deployed.json']) {
  const j = read(path.join(MB, f));
  if (!j) { console.log(`(skip ${f})`); continue; }
  const drops = (j.tokens || []).map(t => `${t.symbol}@${(t.bps/100)}%`).join(' ');
  rows.push(['LootPool', j.label, j.lootPool, 'per-location combat loot', '-', `cooldown ${j.cooldown}s/pawn; drops: ${drops || 'see chain'}`, 'LIVE+stocked']);
}
// bilge record only captured COPPER; its full live stock = 11 tokens (added via finish-bilge):
rows.push(['note', 'Bilge Rats (full stock)', '0xE07CE9Ec642d42C5c8A0068203068BAc6042bF57', 'per-location combat loot', '-', 'COPPER+SALT+RATIONS+APPLE+HONEY+COD+ALE+JERKY+CINNAMON @1% + EMERALD+AMETHYST jackpots (record lists copper only)', 'LIVE+stocked']);

// 2) Tiered achievement PrizePools (the noble ladders: Guard-the-Port + stat/ship achievements)
const pl = read(path.join(MB, 'prize-ladders-deployment.json'));
if (pl && pl.pools) for (const [k, e] of Object.entries(pl.pools)) {
  rows.push(['PrizePool', `${e.line} ${e.tier}`, e.prizePool, `achievement ladder (${e.line})`, e.tier, `prize token ${e.token}`, e.line === 'GOLD' ? 'civic line (seeded Mayor 50k)' : 'WETH line (unfilled)']);
}
// cbBTC line (the ROGUE line; full addrs from guard-ladder-keeper poolsForLine('BTC'))
const CBBTC = { token: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  Mayor: '0xB10fbbCB67d68d1f43E566089FFa0f36Bd057193', Lord: '0x4cC809378135F9501e37532dFDF3df6aED2B3342',
  PettyKing: '0x1D6dA6b28a62A45588411eEE66C94AC951A461D2', HighKing: '0x2983E3d4250d01ba05013F1E9995Cd457D7aBa65',
  Emperor: '0xF3dA6a1D7d1a57F4E4782213D831646C7E45d6B0' };
for (const tier of ['Mayor','Lord','PettyKing','HighKing','Emperor'])
  rows.push(['PrizePool', `cbBTC ${tier}`, CBBTC[tier], 'achievement ladder (cbBTC) — ROGUE line', tier, `prize token ${CBBTC.token}`, tier === 'Mayor' ? 'rogue line (funded)' : 'rogue line']);

rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
const header = '# Seize the Seas — BATTLES / LOOT & PRIZE POOLS. Companion to commodity-tokens.csv + water-tokens.csv.\n'
  + `# Auto-built from deploy records by build-battles-sheet.cjs on ${new Date().toISOString().slice(0,10)}. Re-run to refresh.\n`
  + '# LootPool = per-combat-location loot (canonical LootPool.sol). PrizePool = tiered achievement ladder (canonical PrizePool.sol, BPS_OF_POOL). Admin/treasury 0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10.\n'
  + 'type,name,address,role,tier,detail,status\n';
fs.writeFileSync(OUT, header + rows.map(r => r.map(x => /[",]/.test(String(x)) ? `"${x}"` : x).join(',')).join('\n') + '\n');
console.log(`wrote ${rows.length} battle/loot/prize pools -> ${OUT}`);
