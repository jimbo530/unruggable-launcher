// Digest lp-inventory.json into a compact markdown summary. No network calls.
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:\\Users\\bigji\\lp-inventory.json', 'utf8'));

let totPos = 0, totAlive = 0, totDead = 0;
const pairTotals = {};   // pair -> {alive, dead}
const deadList = [];     // {owner, pair, tokenId}
const lines = [];

for (const o of data.owners) {
  const ps = o.positions.filter(p => !p.error);
  const errs = o.positions.filter(p => p.error).length;
  if (!ps.length && !o.error) { lines.push(`- **${o.name}** \`${o.address}\` — empty (0 positions)`); continue; }
  if (o.error) { lines.push(`- **${o.name}** \`${o.address}\` — ERROR ${o.error}`); continue; }
  const byPair = {};
  for (const p of ps) {
    totPos++; if (p.alive) totAlive++; else { totDead++; deadList.push({ owner: o.name, pair: p.pair, tokenId: p.tokenId }); }
    pairTotals[p.pair] = pairTotals[p.pair] || { alive: 0, dead: 0 };
    p.alive ? pairTotals[p.pair].alive++ : pairTotals[p.pair].dead++;
    byPair[p.pair] = byPair[p.pair] || { a: 0, d: 0 };
    p.alive ? byPair[p.pair].a++ : byPair[p.pair].d++;
  }
  const pairStr = Object.entries(byPair).map(([k, v]) => `${k}${v.d ? ` (${v.a}✓/${v.d}✗)` : v.a > 1 ? ` ×${v.a}` : ''}`).join(', ');
  lines.push(`- **${o.name}** — ${ps.length} pos${errs ? ` (+${errs} read-err)` : ''}: ${pairStr}`);
}

console.log(`# LIVE LP SWEEP DIGEST (block ${data.generatedAtBlock})\n`);
console.log(`TOTAL ${totPos} positions · ${totAlive} alive · ${totDead} dead/empty\n`);
console.log(`## Per owner`);
console.log(lines.join('\n'));

console.log(`\n## Distinct pairs (alive / dead across all owners)`);
const sorted = Object.entries(pairTotals).sort((a, b) => (b[1].alive + b[1].dead) - (a[1].alive + a[1].dead));
for (const [pair, v] of sorted) console.log(`- ${pair}: ${v.alive} alive${v.dead ? `, ${v.dead} dead` : ''}`);

console.log(`\n## Dead / empty positions (${deadList.length})`);
for (const d of deadList) console.log(`- ${d.owner}: ${d.pair} (#${d.tokenId})`);
