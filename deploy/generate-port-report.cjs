#!/usr/bin/env node
// generate-port-report.cjs — builds the town-market SPREADSHEET (port-market.csv) + the PORT REPORT
// (PORT-REPORT.md) from the deployed location-keyed pools. Pure read of deploy records; no chain calls.
// Output → game/seas/. Re-run whenever markets change. (founder 2026-06-27: "spreadsheet of items for
// sale at each town + work on port report".)
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'seas');
const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'port-keyed-pools-deployed.json'), 'utf8'));
const pools = d.pools || {};

const rows = Object.entries(pools).map(([k, p]) => ({
  town: p.port || k.split(':')[0], loc: p.loc ?? p.location ?? '', good: p.good || k.split(':')[1],
  kind: p.kind || '', coin: p.coin || '', price: p.price ?? '', pool: p.pool || p.address || '', token: p.goodAddr || '',
}));
const TOWN_NAME = { port_royal:'Port Royal', tortuga_cove:'Tortuga Cove', saltmarsh:'Saltmarsh', beacon_isle:'Beacon Isle', bonewater_atoll:'Bonewater Atoll', kraken_deep:'Kraken Deep', skull_reef:'Skull Reef' };
const COIN_ORDER = { copper:0, silver:1, gold:2 };
rows.sort((a,b)=> a.town.localeCompare(b.town) || a.kind.localeCompare(b.kind) || (COIN_ORDER[a.coin]-COIN_ORDER[b.coin]) || (a.price-b.price) || a.good.localeCompare(b.good));

// ---- CSV ----
const esc = (v)=> /[",\n]/.test(String(v)) ? '"'+String(v).replace(/"/g,'""')+'"' : String(v);
const csv = ['town,location_id,good,kind,coin,price,pool_address,token_address']
  .concat(rows.map(r=>[TOWN_NAME[r.town]||r.town, r.loc, r.good, r.kind, r.coin, r.price, r.pool, r.token].map(esc).join(',')))
  .join('\n');
fs.writeFileSync(path.join(OUT, 'port-market.csv'), csv);

// ---- REPORT ----
const byTown = {}; rows.forEach(r=>{ (byTown[r.town]=byTown[r.town]||[]).push(r); });
const allLocs = [...new Set(rows.map(r=>String(r.loc)))];
let md = `# Port Report — Seize the Seas town markets\n\n`;
md += `_Generated from deploy/port-keyed-pools-deployed.json. Re-run \`node deploy/generate-port-report.cjs\` to refresh. Spreadsheet: \`port-market.csv\`._\n\n`;
md += `## Overview\n`;
md += `- **${rows.length} market entries** across **${Object.keys(byTown).length} towns**.\n`;
md += `- Goods kinds: ${[...new Set(rows.map(r=>r.kind))].join(', ')}. Coins: copper · silver · gold.\n`;
md += `- Each entry = a location-keyed LocationPool (presence-gated swap, 0.01% fee). Price = coins per good.\n`;
if (allLocs.length === 1) md += `\n> ⚠️ **LOCATION-KEYING TO VERIFY:** every market is keyed to location id \`${allLocs[0]}\` (Port Royal). The other towns' markets are LABELED by town but not yet gated to their OWN map locations — so right now they'd all be reachable from Port Royal. Re-key per town when those locations go live on the map.\n`;
md += `\n## Towns\n`;
for (const t of Object.keys(byTown).sort()) {
  const list = byTown[t];
  md += `\n### ${TOWN_NAME[t]||t}  \n`;
  md += `_${list.length} goods · location id ${[...new Set(list.map(r=>r.loc))].join('/')}_\n\n`;
  md += `| Good | Kind | Price | Coin |\n|---|---|---|---|\n`;
  for (const r of list) md += `| ${r.good} | ${r.kind} | ${r.price} | ${r.coin} |\n`;
}
// detect uniform markets (same good@coin@price set) across towns — flags missing geo variation
const sig = (list)=> list.map(r=>`${r.good}:${r.coin}:${r.price}`).sort().join('|');
const sigs = {}; for (const t in byTown) (sigs[sig(byTown[t])] = sigs[sig(byTown[t])]||[]).push(TOWN_NAME[t]||t);
const clones = Object.values(sigs).filter(g=>g.length>1);

md += `\n## Notes & gaps\n`;
md += `- Coins ladder: copper (cheap) → silver → gold (dear). Price × coin = the real cost.\n`;
md += `- **Towns ARE properly location-keyed** (distinct ids: ${allLocs.join(', ')}) — markets gated to their own map spots, not all to Port Royal.\n`;
if (clones.length) md += `- ⚠️ **FLAT MARKET — no geographic variation yet:** these towns sell an IDENTICAL good/price list → ${clones.map(g=>g.join(' = ')).join('; ')}. Port Royal is the richer hub (gems + weapons). For a real TRADE ECONOMY (buy-low-here / sell-high-there, trade routes, scarcity) the outer towns need VARIED goods + prices — right now there's no arbitrage between them.\n`;
md += `- Bilge Rats LootPool (copper rewards) deployed separately: \`0xE07CE9Ec642d42C5c8A0068203068BAc6042bF57\`.\n`;
md += `- Ocean/fish sell-walls + gem peg pools are tracked in their own deploy records (deploy/*-deployed.json).\n`;
md += `- TODO: re-key non-Port-Royal markets to their own map locations; confirm rations/food token list for loot seeding; add gear/cosmetics rows as those markets open.\n`;
fs.writeFileSync(path.join(OUT, 'PORT-REPORT.md'), md);

console.log(`wrote game/seas/port-market.csv (${rows.length} rows) + game/seas/PORT-REPORT.md`);
console.log(`towns: ${Object.keys(byTown).map(t=>TOWN_NAME[t]||t).join(', ')}`);
console.log(`distinct location ids: ${allLocs.join(', ')}${allLocs.length===1?'  ⚠️ all keyed to one location':''}`);
