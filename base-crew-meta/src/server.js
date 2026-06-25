// ============================================================
//  server.js — the BASE crew paper-doll + ship-flag HTTP service.
//
//  ADDITIVE: this is a LOCAL Base variant of the live Solana crew-render service.
//  It does NOT touch the VPS, the chain, or the existing metadata-api. Run it,
//  point a (future) FeeShareDistributor baseURI / a ship's contractURI at it.
//
//  ── CREW (dynamic ERC-721 NFT) ─────────────────────────────────────────────
//    GET  /crew/render/:key.png     -> composited paper-doll PNG (the NFT image)
//    GET  /crew/meta/:key           -> ERC-721 metadata JSON (image = render URL)
//    GET  /crew/look/:key           -> stored look
//    GET  /crew/inventory/:owner    -> a wallet's cosmetics inventory
//    GET  /crew/catalog             -> items + colours (store UI)
//    POST /crew/base|color|equip|stickers|grant|shipflag|name|stats
//    where :key = "<distributorAddr>:<tokenId>"  (e.g. 0xabc...def:7)
//
//  ── GEAR -> LOOK (GearStore1155 bridge) ────────────────────────────────────
//    POST /crew/gear/grant   {buyer, gearId}                 (MODEL A: grant look)
//    POST /crew/gear/equip   {key, gearId, owner?}           (equip onto a crew)
//
//  ── SHIP FLAG (ship-token metadata) ────────────────────────────────────────
//    POST /ship/flag/:address  {image, setter?}   -> store the flag
//    GET  /ship/flag/:address.png                 -> the stored flag PNG
//    GET  /ship/meta/:address                     -> EIP-7572 ship metadata (image=flag)
//
//  LOCAL:  node src/server.js   ->  http://localhost:8791
//  LIVE:   host publicly + set PUBLIC_BASE_URL so token URIs resolve to this origin.
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const { renderCrew } = require('./render');
const closet = require('./closet');
const { buildMetadata } = require('./metadata');
const { setStats } = require('./stats');
const cfg = require('./cosmetics-config');
const gearHook = require('./gear-hook');
const flagStore = require('./flag-store');
const shipSpecies = require('./ship-species');
const { SPECIES } = require('./asset-manifest');

const PORT = process.env.PORT || 8791;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const app = express();
app.use(express.json({ limit: '4mb' })); // 4mb so a base64 flag (<=2MB) fits with overhead

// Permissive CORS: this service is CONSUMED CROSS-ORIGIN by the game/marketplace
// front-ends (the battle-grid loads /crew/render/<id>.png as the unit token; a hosted
// game on another origin fetches/previews crew images). Image <img>/SVG <image> display
// does not strictly need CORS, but fetch()/canvas preloading does — so allow it here.
// (Reads only; production keeps the closet WRITE endpoints gated by owner-sig + payment.)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve the public/ front-end assets (e.g. species-picker.js the launch UI loads).
app.use(express.static(path.join(__dirname, '..', 'public')));

// crew keys can contain ':' and '0x...'; strip a trailing .png from the render route.
const keyOf = (raw) => decodeURIComponent(String(raw)).replace(/\.png$/i, '');

// ─────────────────────────── CREW: dynamic image ───────────────────────────
app.get('/crew/render/:key.png', async (req, res) => renderCrewRoute(req, res));
app.get('/crew/render/:key', async (req, res) => renderCrewRoute(req, res));
async function renderCrewRoute(req, res) {
  try {
    const key = keyOf(req.params.key);
    const look = closet.getLook(key);
    look.crewKey = key; // lets renderCrew map the ship (distributor) -> crew species
    const { png } = await renderCrew(look);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=30'); // refresh after look changes
    res.end(png);
  } catch (e) {
    console.error('[render] failed for', req.params.key, '-', e.message);
    res.status(500).json({ error: e.message });
  }
}

// ─────────────────────────── CREW: dynamic metadata ────────────────────────
app.get('/crew/meta/:key', (req, res) => {
  try { res.json(buildMetadata(keyOf(req.params.key), PUBLIC_BASE_URL)); }
  catch (e) { console.error('[meta]', e.message); res.status(500).json({ error: e.message }); }
});

// ─────────────────────────── CREW: closet reads ────────────────────────────
app.get('/crew/look/:key', (req, res) => {
  try { const k = keyOf(req.params.key); res.json({ key: k, look: closet.getLook(k) }); }
  catch (e) { console.error('[look]', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/crew/inventory/:owner', (req, res) => {
  try { res.json({ owner: req.params.owner, items: closet.getInventory(req.params.owner) }); }
  catch (e) { console.error('[inventory]', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/crew/catalog', (_req, res) => {
  res.json({ colors: cfg.COLORS, items: cfg.ITEMS, slots: closet.SLOTS });
});

// ─────────────────────────── CREW: closet writes ───────────────────────────
// (LOCAL JSON; production gates these behind owner-signature + payment verification)
app.post('/crew/base', (req, res) => {
  try { res.json({ ok: true, look: closet.setBase(keyOf(req.body.key), req.body.base) }); }
  catch (e) { console.error('[base]', e.message); res.status(400).json({ error: e.message }); }
});
app.post('/crew/color', (req, res) => {
  try { res.json({ ok: true, look: closet.setColor(keyOf(req.body.key), req.body.color) }); }
  catch (e) { console.error('[color]', e.message); res.status(400).json({ error: e.message }); }
});
app.post('/crew/equip', (req, res) => {
  try { res.json({ ok: true, look: closet.equip(keyOf(req.body.key), req.body.slot, req.body.variant || null) }); }
  catch (e) { console.error('[equip]', e.message); res.status(400).json({ error: e.message }); }
});
app.post('/crew/stickers', (req, res) => {
  try { res.json({ ok: true, look: closet.setStickers(keyOf(req.body.key), req.body.stickers || []) }); }
  catch (e) { console.error('[stickers]', e.message); res.status(400).json({ error: e.message }); }
});
app.post('/crew/grant', (req, res) => {
  try { res.json({ ok: true, inventory: closet.grant(req.body.owner, req.body.variant, Number(req.body.qty) || 1) }); }
  catch (e) { console.error('[grant]', e.message); res.status(400).json({ error: e.message }); }
});
app.post('/crew/stats', (req, res) => {
  try { res.json({ ok: true, stats: setStats(keyOf(req.body.key), req.body) }); }
  catch (e) { console.error('[stats]', e.message); res.status(400).json({ error: e.message }); }
});

// ──────────────────── SHIP: crew species (captain's choice) ─────────────────
// The captain picks the sprite set that crews their ship at launch. species is a
// STORED per-ship value; render/metadata read it via the crewKey. shipKey may be a
// crewKey, a bare ship slug, or a distributor address (all -> the ship id).
//
//   GET  /ship/species/catalog          -> selectable species (for the picker UI)
//   GET  /ship/species/:shipKey         -> { ship, species } (resolved, fallback-safe)
//   POST /ship/species  {shipKey, species}  -> set the captain's choice
app.get('/ship/species/catalog', (_req, res) => {
  const species = shipSpecies.SPECIES_OPTIONS.map((id) => ({
    id, name: SPECIES[id].name, ready: !!SPECIES[id].ready,
  }));
  res.json({ species, default: shipSpecies.DEFAULT_SHIP_SPECIES });
});
// Picker thumbnail: a bare crew render of a given species (no ship lookup), for
// the species-card art. Falls back to acorn body inside renderCrew if art absent.
app.get('/ship/species/preview/:id.png', async (req, res) => {
  try {
    const id = String(req.params.id).replace(/\.png$/i, '');
    const { png } = await renderCrew({ base: 'boy', species: id });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(png);
  } catch (e) { console.error('[species:preview]', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/ship/species/:shipKey', (req, res) => {
  try {
    const k = keyOf(req.params.shipKey);
    res.json({ ship: shipSpecies.shipOf(k), species: shipSpecies.getShipSpecies(k) });
  } catch (e) { console.error('[species:get]', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/ship/species', (req, res) => {
  try { res.json({ ok: true, ...shipSpecies.setShipSpecies(keyOf(req.body.shipKey), req.body.species) }); }
  catch (e) { console.error('[species:set]', e.message); res.status(400).json({ error: e.message }); }
});

// ─────────────────────────── CREW: naming ──────────────────────────────────
app.get('/crew/name/:key', (req, res) => {
  try { const k = keyOf(req.params.key); res.json({ key: k, name: closet.getName(k), displayName: closet.getDisplayName(k) }); }
  catch (e) { console.error('[name:get]', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/crew/name', (req, res) => {
  try { const k = keyOf(req.body.key); const out = closet.setName(k, req.body.name); res.json({ ok: true, ...out, displayName: closet.getDisplayName(k) }); }
  catch (e) { console.error('[name:set]', e.message); res.status(400).json({ error: e.message }); }
});

// ─────────────────────── CREW: ship flag (corner badge) ─────────────────────
// Sets the TOP-LEFT flag BADGE on a crew render. Single {key,flag} or a
// {distributor,from,to,flag} range (re-flag a whole ship's crew in one call).
app.post('/crew/shipflag', (req, res) => {
  try {
    const flag = req.body.flag == null || req.body.flag === '' ? null : String(req.body.flag);
    if (flag != null && !/^[a-z0-9_-]+$/i.test(flag)) throw new Error('bad flag id: ' + flag);
    let keys = [];
    if (req.body.key != null) {
      keys = [keyOf(req.body.key)];
    } else if (req.body.distributor != null && req.body.from != null && req.body.to != null) {
      const from = parseInt(req.body.from, 10);
      const to = parseInt(req.body.to, 10);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) throw new Error('bad range');
      if (to - from > 1000) throw new Error('range too large (max 1000)');
      for (let n = from; n <= to; n++) keys.push(closet.crewKey(req.body.distributor, n));
    } else {
      throw new Error('provide {key,flag} or {distributor,from,to,flag}');
    }
    for (const k of keys) closet.setShipFlag(k, flag);
    res.json({ ok: true, count: keys.length, flag, first: keys[0], last: keys[keys.length - 1] });
  } catch (e) { console.error('[shipflag]', e.message); res.status(400).json({ error: e.message }); }
});

// ─────────────────────── GEAR -> LOOK (GearStore1155) ───────────────────────
// MODEL A: a verified GearBought grants the matching look to the buyer's inventory.
// (Production: call this from a keeper that watches GearStore1155.GearBought, OR
//  verify the buy on-chain before granting. Here it is an open dev endpoint.)
app.post('/crew/gear/grant', (req, res) => {
  try {
    const inv = gearHook.onGearBought(req.body.buyer, req.body.gearId, req.body.color || 'natural');
    res.json({ ok: true, inventory: inv });
  } catch (e) { console.error('[gear:grant]', e.message); res.status(400).json({ error: e.message }); }
});
// Equip an owned gear look onto a specific crew member (player-driven, MODEL A step 2).
app.post('/crew/gear/equip', (req, res) => {
  try {
    const look = gearHook.equipGearOnCrew(keyOf(req.body.key), req.body.gearId, {
      owner: req.body.owner || null, color: req.body.color || 'natural',
    });
    res.json({ ok: true, look });
  } catch (e) { console.error('[gear:equip]', e.message); res.status(400).json({ error: e.message }); }
});

// ─────────────────────── SHIP FLAG (ship-token metadata) ────────────────────
// Store/replace a ship's flag image. The ship is mutiny-capable so overwrite is
// ALLOWED (every write is audit-logged in data/flags.json).
app.post('/ship/flag/:address', async (req, res) => {
  try {
    const rec = await flagStore.setShipFlag(req.params.address, req.body.image, req.body.setter || 'launcher');
    res.json({ ok: true, ...rec });
  } catch (e) { console.error('[ship:flag:set]', e.message); res.status(400).json({ error: e.message }); }
});
// Serve the stored flag PNG.
app.get('/ship/flag/:address.png', (req, res) => serveFlag(req, res));
app.get('/ship/flag/:address', (req, res) => serveFlag(req, res));
function serveFlag(req, res) {
  try {
    const addr = String(req.params.address).replace(/\.png$/i, '');
    const fp = flagStore.flagFilePath(addr);
    if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'no flag for ' + addr });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=60');
    fs.createReadStream(fp).pipe(res);
  } catch (e) { console.error('[ship:flag:get]', e.message); res.status(500).json({ error: e.message }); }
}
// Ship-token metadata (EIP-7572; image = the uploaded flag). `extra` name/symbol can
// be supplied as query params or merged from the existing metadata-api in production.
app.get('/ship/meta/:address', (req, res) => {
  try {
    const extra = { name: req.query.name, symbol: req.query.symbol, description: req.query.description };
    res.json(flagStore.buildShipMetadata(req.params.address, PUBLIC_BASE_URL, extra));
  } catch (e) { console.error('[ship:meta]', e.message); res.status(500).json({ error: e.message }); }
});

// ─────────────────────────── index ─────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    service: 'base-crew-paperdoll',
    publicBaseUrl: PUBLIC_BASE_URL,
    crew: {
      image: '/crew/render/<distributor>:<tokenId>.png',
      metadata: '/crew/meta/<distributor>:<tokenId>',
      writes: ['POST /crew/base|color|equip|stickers|grant|stats|name|shipflag'],
      gear: ['POST /crew/gear/grant {buyer,gearId}', 'POST /crew/gear/equip {key,gearId,owner?}'],
    },
    ship: {
      setFlag: 'POST /ship/flag/:address {image}',
      flagImage: 'GET /ship/flag/:address.png',
      metadata: 'GET /ship/meta/:address',
    },
    note: 'LOCAL additive build. No chain writes, no VPS edits. See REPORT for go-live wiring.',
  });
});

app.listen(PORT, () => {
  console.log(`[base-crew] paper-doll + flag service on http://localhost:${PORT}`);
  console.log(`[base-crew] crew image:    GET /crew/render/<dist>:<id>.png`);
  console.log(`[base-crew] crew metadata: GET /crew/meta/<dist>:<id>`);
  console.log(`[base-crew] ship metadata: GET /ship/meta/:address`);
});

module.exports = app;
