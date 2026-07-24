// Reads value-inventory.json, writes lp-graph.html (a self-contained visual). No network.
const fs = require('fs');
const v = JSON.parse(fs.readFileSync('C:\\Users\\bigji\\value-inventory.json', 'utf8'));

const owners = v.owners.map(o => {
  const valued = (o.positions || []).filter(p => p.hardUsd > 0).sort((a, b) => b.hardUsd - a.hardUsd);
  return { name: o.name, usd: o.hardUsd || 0, top: valued.slice(0, 3).map(p => `${p.pair} $${p.hardUsd}`), nPos: (o.positions || []).length };
}).sort((a, b) => b.usd - a.usd);

const grand = v.grandHardUsd || owners.reduce((s, o) => s + o.usd, 0);
const max = Math.max(1, ...owners.map(o => o.usd));
const withVal = owners.filter(o => o.usd >= 0.5).length;
const compost = owners.filter(o => o.usd < 0.5).length;
const color = u => u >= 5 ? '#3ad07a' : u >= 0.5 ? '#e8b14a' : '#5b6472';

const show = owners.filter(o => o.usd > 0 || true).slice(0, 40);
const rows = show.map(o => {
  const w = Math.max(0.4, (o.usd / max) * 100);
  const sym = o.top.length ? o.top.join(' · ') : '— no hard-asset value (compost) —';
  return `<div class="row">
    <div class="name">${o.name}</div>
    <div class="track"><div class="bar" style="width:${w}%;background:${color(o.usd)}"></div></div>
    <div class="usd" style="color:${color(o.usd)}">$${o.usd.toFixed(2)}</div>
    <div class="sym">${sym}</div>
  </div>`;
}).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0f141b;color:#e7edf3;font:16px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;padding:28px 34px;width:1180px}
  h1{font-size:30px;margin:0 0 4px} .sub{color:#8b97a6;margin-bottom:18px;font-size:15px}
  .chips{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}
  .chip{background:#1a2230;border:1px solid #2a3547;border-radius:9px;padding:9px 14px;font-size:15px}
  .chip b{font-size:18px}
  .row{display:grid;grid-template-columns:170px 360px 90px 1fr;align-items:center;gap:14px;padding:5px 0;border-bottom:1px solid #1a2230}
  .name{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .track{background:#161d28;border-radius:6px;height:22px;overflow:hidden}
  .bar{height:100%;border-radius:6px;min-width:3px}
  .usd{text-align:right;font-weight:700;font-size:16px}
  .sym{color:#9fb0c3;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .legend{margin-top:18px;color:#8b97a6;font-size:14px}
  .g{color:#3ad07a}.a{color:#e8b14a}.x{color:#5b6472}
</style></head><body>
  <h1>🏴‍☠️ LP Inventory — Hard-Asset Value</h1>
  <div class="sub">Value = USDC / WETH / cbBTC content only (the reliable floor). Failed-token sides count as $0 = compost. Block ${v.pricedAt} · WETH $${(v.wethP||0).toFixed(0)} · cbBTC $${(v.btcP||0).toFixed(0)}</div>
  <div class="chips">
    <div class="chip">Total hard value <b>$${grand.toFixed(2)}</b></div>
    <div class="chip"><span class="g">●</span> with value (≥$0.50) <b>${withVal}</b></div>
    <div class="chip"><span class="x">●</span> compost (&lt;$0.50) <b>${compost}</b></div>
    <div class="chip">owners <b>${owners.length}</b></div>
  </div>
  ${rows}
  <div class="legend"><span class="g">● ≥$5</span>  ·  <span class="a">● $0.50–$5</span>  ·  <span class="x">● &lt;$0.50 (compost)</span> — bars relative to the largest holder. Top-40 shown.</div>
</body></html>`;

fs.writeFileSync('C:\\Users\\bigji\\lp-graph.html', html);
console.log('wrote C:\\Users\\bigji\\lp-graph.html');
