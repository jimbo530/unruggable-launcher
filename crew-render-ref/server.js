// ============================================================
//  server.js — the crew paper-doll HTTP service.
//
//  This is the dynamic-NFT image host. The two endpoints that matter for NFTs:
//    GET /crew/render/:id(.png)   -> the composited paper-doll PNG  (the NFT image)
//    GET /crew/meta/:id           -> the Metaplex metadata JSON (image = render URL)
//  Plus the closet API (mirrors MfT-Launch/memetree-meta/cosmetics.cjs):
//    GET  /crew/inventory/:owner
//    GET  /crew/look/:id
//    POST /crew/base    {id, base}
//    POST /crew/color   {id, color}
//    POST /crew/equip   {id, slot, variant}
//    POST /crew/stickers{id, stickers}
//    POST /crew/grant   {owner, variant, qty}        (dev grant; prod = verified buy)
//    GET  /crew/catalog                              (items + colours, for a store UI)
//
//  LOCAL: node src/server.js   ->   http://localhost:8790
//  LIVE:  this origin must be PUBLICLY hosted so wallets/marketplaces can fetch the
//         image. Set PUBLIC_BASE_URL to that origin so metadata links resolve.
//  NOTE: writes go to the LOCAL JSON closet (data/closet.json). Production swaps
//        closet.js for Supabase (creds were not available at build time).
// ============================================================
const express = require('express');
const path = require('path');
const { renderCrew } = require('./render');
const closet = require('./closet');
const { buildMetadata } = require('./metadata');
const cfg = require('./cosmetics-config');
const { mountWaterApi } = require('./water-api');
const { mountPlay } = require('./play');

const PORT = process.env.PORT || 8790;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const app = express();
app.use(express.json({ limit: '256kb' }));

const idOf = (raw) => String(raw).replace(/\.png$/i, '');

// ---- STATIC: Solana SPL token-metadata assets (logos + Metaplex JSON) ----
// Served at /crew/token/<file>. Scoped to /crew/token only, so it cannot shadow
// the dynamic /crew/render or /crew/meta routes below. Explicit Content-Types so
// .json resolves as application/json and .png as image/png for wallets/explorers.
app.use('/crew/token', express.static(path.join(__dirname, '..', 'token'), {
  setHeaders: (res, filePath) => {
    // CORS: allow cross-origin fetch of token assets (e.g. acorn base art from grok.com).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json');
    else if (filePath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
  },
}));

// ---- the dynamic NFT image ----
app.get('/crew/render/:id', async (req, res) => {
  try {
    const crewId = idOf(req.params.id);
    const look = closet.getLook(crewId);
    const { png } = await renderCrew(look);
    res.setHeader('Content-Type', 'image/png');
    // short cache so marketplaces refresh after a look change but don't hammer us
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.end(png);
  } catch (e) {
    console.error('[render] failed for', req.params.id, '-', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- the dynamic NFT metadata (image -> render endpoint) ----
app.get('/crew/meta/:id', (req, res) => {
  try {
    const crewId = idOf(req.params.id);
    res.json(buildMetadata(crewId, PUBLIC_BASE_URL));
  } catch (e) {
    console.error('[meta]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- closet reads ----
app.get('/crew/look/:id', (req, res) => {
  try { res.json({ id: idOf(req.params.id), look: closet.getLook(idOf(req.params.id)) }); }
  catch (e) { console.error('[look]', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/crew/inventory/:owner', (req, res) => {
  try { res.json({ owner: req.params.owner, items: closet.getInventory(req.params.owner) }); }
  catch (e) { console.error('[inventory]', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/crew/catalog', (_req, res) => {
  res.json({ colors: cfg.COLORS, items: cfg.ITEMS, slots: closet.SLOTS });
});

// ---- closet writes (local JSON; production gates these behind owner + payment) ----
app.post('/crew/base', (req, res) => {
  try { res.json({ ok: true, look: closet.setBase(idOf(req.body.id), req.body.base) }); }
  catch (e) { console.error('[base]', e.message); res.status(400).json({ error: e.message }); }
});
app.post('/crew/color', (req, res) => {
  try { res.json({ ok: true, look: closet.setColor(idOf(req.body.id), req.body.color) }); }
  catch (e) { console.error('[color]', e.message); res.status(400).json({ error: e.message }); }
});
app.post('/crew/equip', (req, res) => {
  try { res.json({ ok: true, look: closet.equip(idOf(req.body.id), req.body.slot, req.body.variant || null) }); }
  catch (e) { console.error('[equip]', e.message); res.status(400).json({ error: e.message }); }
});
app.post('/crew/stickers', (req, res) => {
  try { res.json({ ok: true, look: closet.setStickers(idOf(req.body.id), req.body.stickers || []) }); }
  catch (e) { console.error('[stickers]', e.message); res.status(400).json({ error: e.message }); }
});
app.post('/crew/grant', (req, res) => {
  try { res.json({ ok: true, inventory: closet.grant(req.body.owner, req.body.variant, Number(req.body.qty) || 1) }); }
  catch (e) { console.error('[grant]', e.message); res.status(400).json({ error: e.message }); }
});

// ---- NAMING (owner-set after mint; UNIQUE across all crews) ----
// read a crew's name (null => still "Crew #<id>")
app.get('/crew/name/:id', (req, res) => {
  try {
    const id = idOf(req.params.id);
    res.json({ id, name: closet.getName(id), displayName: closet.getDisplayName(id) });
  } catch (e) { console.error('[name:get]', e.message); res.status(500).json({ error: e.message }); }
});
// check whether a name is free (uniqueness pre-check for a naming UI)
app.get('/crew/name-available/:name', (req, res) => {
  try {
    const owner = closet.nameOwner(req.params.name); // crewId holding it, or null
    res.json({ name: req.params.name, available: !owner, takenBy: owner || null });
  } catch (e) { console.error('[name:avail]', e.message); res.status(500).json({ error: e.message }); }
});
// set OR rename a crew (first name free; renames allowed; must stay unique +
// pass length/charset/profanity). 400 with a precise reason on any failure.
app.post('/crew/name', (req, res) => {
  try {
    const id = idOf(req.body.id);
    const out = closet.setName(id, req.body.name);
    res.json({ ok: true, ...out, displayName: closet.getDisplayName(id) });
  } catch (e) { console.error('[name:set]', e.message); res.status(400).json({ error: e.message }); }
});
// clear a crew's name (back to "Crew #<id>"; frees the name)
app.post('/crew/name/clear', (req, res) => {
  try { res.json({ ok: true, ...closet.clearName(idOf(req.body.id)) }); }
  catch (e) { console.error('[name:clear]', e.message); res.status(400).json({ error: e.message }); }
});

// ---- SHIP FLAG (top-left corner badge) — single or BULK set, dynamic, no re-mint ----
// Body: { id, flag }  -> set one crew.   { from, to, flag } -> set an inclusive
// crew-<from>..crew-<to> range. flag = a slug like "laroyal"/"tide" (=> /crew/token/<flag>.png)
// or null/"" to remove. Re-flagging a whole ship's crew is one call.
app.post('/crew/shipflag', (req, res) => {
  try {
    const flag = req.body.flag == null || req.body.flag === '' ? null : String(req.body.flag);
    if (flag != null && !/^[a-z0-9_-]+$/i.test(flag)) throw new Error('bad flag id: ' + flag);
    let ids = [];
    if (req.body.id != null) {
      ids = [idOf(req.body.id)];
    } else if (req.body.from != null && req.body.to != null) {
      const from = parseInt(req.body.from, 10);
      const to = parseInt(req.body.to, 10);
      if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('from/to must be integers');
      if (from < 1 || to < from) throw new Error('bad range: from=' + from + ' to=' + to);
      if (to - from > 10000) throw new Error('range too large (max 10000)');
      for (let n = from; n <= to; n++) ids.push('crew-' + n);
    } else {
      throw new Error('provide {id,flag} or {from,to,flag}');
    }
    for (const id of ids) closet.setShipFlag(id, flag);
    res.json({ ok: true, count: ids.length, flag, first: ids[0], last: ids[ids.length - 1] });
  } catch (e) { console.error('[shipflag]', e.message); res.status(400).json({ error: e.message }); }
});

// ---- HYBRID WATER-YIELD API (jobs / ledger / claim / route) ----
// Off-chain LIVE (work, ledger, route); on-chain claim is GATED (CLAIM_ONCHAIN_ENABLED).
mountWaterApi(app);

// ---- PLAYER GAME SCREEN (/crew/play) + the server-side Helius DAS proxy ----
// /crew/play = the playable water/jobs/claim loop; /crew/owned/:wallet lists a
// wallet's crew via Helius (key stays server-side). Game language only; claim is GATED.
mountPlay(app, PUBLIC_BASE_URL);

// ---- GRID GALLERY — all 100 crew as live render thumbnails, lazy-loaded ----
// Served at /crew (root of the crew path) and /crew/gallery. Names are fetched
// client-side from /crew/meta/<id> so the page itself stays a single static doc.
const CREW_GALLERY = (() => {
  const COUNT = 100;
  const tiles = [];
  for (let n = 1; n <= COUNT; n++) {
    const id = 'crew-' + n;
    tiles.push(
      '<a class="tile" id="t-' + id + '" href="/crew/render/' + id + '.png">' +
        '<div class="frame"><img loading="lazy" src="/crew/render/' + id + '.png" alt="' + id + '"></div>' +
        '<div class="name" data-id="' + id + '">Crew #' + n + '</div>' +
      '</a>'
    );
  }
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Crew — Solana Shipyard</title>
<style>
  :root{--ink:#f3e6c8;--ink-dim:#bda773;--sea:#0b1622;--sea2:#122436;--plank:#1d130b;--gold:#caa45a;--edge:#3a2a16;}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 700px at 50% -10%,#15293c 0%,var(--sea) 55%,#070d15 100%);
    color:var(--ink);font-family:"Trebuchet MS",Verdana,Segoe UI,sans-serif;}
  header{padding:28px 18px 10px;text-align:center}
  h1{margin:0;font-size:clamp(26px,5vw,44px);letter-spacing:1px;
    color:var(--gold);text-shadow:0 2px 0 #5a3f17,0 0 18px rgba(202,164,90,.35)}
  .sub{margin:6px 0 0;color:var(--ink-dim);font-size:14px}
  .wrap{max-width:1300px;margin:0 auto;padding:18px clamp(10px,3vw,28px) 60px}
  .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
  .tile{display:flex;flex-direction:column;text-decoration:none;color:inherit;
    background:linear-gradient(180deg,var(--sea2),#0c1a28);border:1px solid var(--edge);
    border-radius:12px;padding:8px;transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease}
  .tile:hover{transform:translateY(-3px);border-color:var(--gold);
    box-shadow:0 8px 22px rgba(0,0,0,.55),0 0 0 1px rgba(202,164,90,.25)}
  .frame{aspect-ratio:1/1;border-radius:9px;overflow:hidden;
    background:repeating-conic-gradient(#0e1d2c 0% 25%,#0a1622 0% 50%) 50%/22px 22px}
  .frame img{width:100%;height:100%;object-fit:contain;display:block}
  .name{margin-top:7px;text-align:center;font-size:13px;font-weight:bold;color:var(--ink);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  footer{text-align:center;color:var(--ink-dim);font-size:12px;padding:0 18px 40px}
  footer a{color:var(--gold)}
</style></head><body>
<header><h1>&#9875; The Crew &#9875;</h1>
<p class="sub">100 paper-doll deckhands &middot; live dynamic renders &middot; flags fly top-left</p></header>
<div class="wrap"><div class="grid">${tiles.join('')}</div></div>
<footer>Solana Shipyard &middot; each tile links to its full-size render. Names update live as crews are christened.</footer>
<script>
  // Lazily pull each crew's name from its metadata, with a hard fallback to "Crew #N".
  // Throttled so 100 fetches don't stampede the box; failures leave the fallback visible.
  (function(){
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.name'));
    var i = 0;
    function pump(){
      if (i >= nodes.length) return;
      var el = nodes[i++]; var id = el.getAttribute('data-id');
      fetch('/crew/meta/' + id).then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ if (j && j.name && !/^Crew #/.test(j.name)) el.textContent = j.name; })
        .catch(function(){ /* keep the visible fallback */ })
        .finally(function(){ setTimeout(pump, 40); });
    }
    // a few parallel pumps for speed, still gentle on the server
    pump(); pump(); pump();
  })();
</script>
</body></html>`;
})();
function sendGallery(_req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.end(CREW_GALLERY);
}
app.get('/crew', sendGallery);
app.get('/crew/', sendGallery);
app.get('/crew/gallery', sendGallery);

app.get('/', (_req, res) => {
  res.json({
    service: 'solana-crew-paperdoll',
    publicBaseUrl: PUBLIC_BASE_URL,
    nftImage: '/crew/render/:id.png',
    nftMetadata: '/crew/meta/:id',
    closet: ['/crew/look/:id', '/crew/inventory/:owner', '/crew/catalog',
      'POST /crew/base', 'POST /crew/color', 'POST /crew/equip', 'POST /crew/stickers', 'POST /crew/grant'],
    naming: ['/crew/name/:id', '/crew/name-available/:name',
      'POST /crew/name {id,name}', 'POST /crew/name/clear {id}'],
    note: 'LOCAL build. Writes go to data/closet.json. For LIVE NFTs host this publicly + set PUBLIC_BASE_URL; swap closet.js for Supabase.',
  });
});

app.listen(PORT, () => {
  console.log(`[crew] paper-doll service on http://localhost:${PORT}`);
  console.log(`[crew] public base url: ${PUBLIC_BASE_URL}`);
  console.log(`[crew] NFT image:    GET /crew/render/:id.png`);
  console.log(`[crew] NFT metadata: GET /crew/meta/:id`);
});
