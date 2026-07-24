// ============================================================
//  MemeTrees v4 metadata service (OpenSea-standard per-token JSON).
//  Lightweight Express. NOT deployed yet — proposed host below.
//
//  Route: GET /metadata/:tokenId  ->
//    {
//      "name": <fullName from chain>,
//      "description": "...",
//      "image": <species image (placeholder until art is ready)>,
//      "external_url": "https://tasern.quest/memetrees",
//      "attributes": [
//        { "trait_type": "Edition", "value": <edition #> },
//        { "trait_type": "Species", "value": <species name> },
//        { "trait_type": "Epithet", "value": <epithet or "—"> }
//      ]
//    }
//
//  baseURI on the v4 contract should be:  <thisHost>/metadata/
//  so tokenURI(42) -> <thisHost>/metadata/42.
//
//  PROPOSED HOST: the VPS (alias `vps`), behind the existing tasern.quest
//  nginx, mounted at /api/memetree/  (i.e. set baseURI =
//  https://tasern.quest/api/memetree/ and proxy /api/memetree/ -> this :3037).
//  Alternatively a Vercel serverless function — same JSON shape.
//
//  Reads are cached in-memory (names are immutable once minted, so a long TTL
//  is safe). Run: node memetrees-v4-metadata-service.cjs
// ============================================================
require('dotenv').config({ path: '.env', quiet: true });
const express = require('express');
const { ethers } = require('ethers');
const fs = require('fs');
const cosmetics = require('./cosmetics.cjs');

const PORT = process.env.METADATA_PORT || 3037;
const RPC = process.env.CDP_RPC_URL || 'https://mainnet.base.org';

// Resolve the v4 address from the deployment record once it exists; allow override.
function resolveAddress() {
  if (process.env.MEMETREES_V4) return process.env.MEMETREES_V4;
  try { return JSON.parse(fs.readFileSync('./memetrees-v4-deployment.json', 'utf8')).memeTreesV4; }
  catch (_) { return null; }
}
const TREES = resolveAddress();
if (!TREES) {
  console.error('No v4 address — set MEMETREES_V4 or deploy first (memetrees-v4-deployment.json).');
  process.exit(1);
}

const ABI = [
  'function fullNameOf(uint256) view returns (string)',
  'function nameParts(uint256) view returns (string name, string epithet)',
  'function speciesOf(uint256) view returns (uint256)',
  'function editionOf(uint256) view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function species(uint256) view returns (uint128 priceUsdc, uint32 maxSupply, uint32 minted, uint16 artistBps, bool active, string uri)',
];

const provider = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true });
const trees = new ethers.Contract(TREES, ABI, provider);

// ---- Species presentation (PLACEHOLDER images until the user's art lands) ----
// Map speciesId -> { name, image }. Unknown species fall back to a generic tree.
// Swap these image URLs for the real art when ready (no contract change needed).
const PLACEHOLDER = 'https://placehold.co/600x600/122310/6fdb4e/png?text=Meme+Tree';
const SPECIES_ART = {
  2: { name: 'Acorn Boy', image: 'https://tasern.quest/memetrees/acorn-boy.webp' },
};
function speciesArt(speciesId) {
  return SPECIES_ART[speciesId] || { name: `Species ${speciesId}`, image: PLACEHOLDER };
}
// 'item-beanie:blue' -> 'Blue Beanie'; 'sticker-leaf:red' -> 'Red Leaf'; ':natural' drops the color word.
function prettyItem(variantId) {
  const parts = String(variantId).split(':');
  const noun = parts[0].replace(/^item-|^sticker-/, '').replace(/-/g, ' ');
  const color = parts[1];
  const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  return (color && color !== 'natural' ? cap(color) + ' ' : '') + cap(noun);
}

// ---- tiny immutable-name cache ----
const cache = new Map(); // tokenId -> { body, at }
const TTL_MS = 6 * 60 * 60 * 1000; // 6h; names never change so this is conservative

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, contract: TREES }));

app.get('/metadata/:tokenId', async (req, res) => {
  const tokenId = req.params.tokenId;
  if (!/^\d+$/.test(tokenId)) return res.status(400).json({ error: 'bad tokenId' });

  try {
    // on-chain core (immutable once minted) is cached; cosmetics are fetched fresh below
    let core = cache.get(tokenId);
    if (!core || Date.now() - core.at >= TTL_MS) {
      const [fullName, parts, spId, edition] = await Promise.all([
        trees.fullNameOf(tokenId),
        trees.nameParts(tokenId),
        trees.speciesOf(tokenId),
        trees.editionOf(tokenId),
      ]);
      const art = speciesArt(Number(spId));
      const epithet = parts[1] && parts[1].length ? parts[1] : '—';
      core = { fullName, art, epithet, edition: Number(edition), at: Date.now() };
      cache.set(tokenId, core);
    }

    // cosmetics LOOK changes on equip/laminate -> always fresh, never cached
    let look = { items: {}, sticker_sheet_url: null };
    try { look = await cosmetics.getLook(tokenId); }
    catch (e) { console.error('cosmetics look fetch failed for', tokenId, e.message); }

    const cosmeticTraits = [];
    for (const slot of Object.keys(look.items || {})) {
      if (look.items[slot]) cosmeticTraits.push({ trait_type: 'Wearing (' + slot + ')', value: prettyItem(look.items[slot]) });
    }
    if (look.sticker_sheet_url) cosmeticTraits.push({ trait_type: 'Stickers', value: 'Laminated' });

    const body = {
      name: core.fullName,
      description:
        `${core.fullName} is a living Meme Tree. 100% of its mint is permanent water in the Water vault; ` +
        `it grows forever and drops Meme for Trees to whoever holds it. Part of the Money for Trees ecosystem.`,
      image: core.art.image,
      external_url: 'https://tasern.quest/memetrees',
      attributes: [
        { trait_type: 'Edition', value: core.edition },
        { trait_type: 'Species', value: core.art.name },
        { trait_type: 'Epithet', value: core.epithet },
        ...cosmeticTraits,
      ],
    };
    res.json(body);
  } catch (e) {
    // _requireOwned reverts for non-existent tokens -> 404, with a visible reason.
    const msg = e.reason || e.shortMessage || e.message || String(e);
    if (/nonexistent|owner|ERC721/i.test(msg)) return res.status(404).json({ error: 'no such token', detail: msg });
    console.error('metadata error for', tokenId, msg);
    res.status(502).json({ error: 'chain read failed', detail: msg });
  }
});

cosmetics.mount(app, { provider, treesAddress: TREES });

app.listen(PORT, () => {
  console.log(`MemeTrees v4 metadata on :${PORT} -> contract ${TREES}`);
  console.log(`Set contract baseURI to <host>/metadata/  e.g. https://tasern.quest/api/memetree/`);
});
