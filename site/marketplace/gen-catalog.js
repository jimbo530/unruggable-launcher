// Generates marketplace catalog.js from the real on-disk data sources.
// Addresses come straight from nft-lp-database (never hand-typed).
// Re-run after updating any source: node gen-catalog.js
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/bigji/Documents';
const OUT = path.join(__dirname, 'catalog.js');
const SITE = 'https://tasern.quest';

// ---- 1. TASERN HEROES (one 1-of-1 ERC721 contract each, Base + Polygon) ----
// Images are fetched ONCE on-chain and cached in hero-art/ (see fetch-hero-art.js).
const nftDb = JSON.parse(fs.readFileSync(`${ROOT}/nft-lp-database/nfts.json`, 'utf8'));
const nftArr = Array.isArray(nftDb) ? nftDb : (nftDb.nfts || Object.values(nftDb).find(Array.isArray) || []);
const heroManifestPath = path.join(__dirname, 'hero-art', 'manifest.json');
const heroManifest = fs.existsSync(heroManifestPath) ? JSON.parse(fs.readFileSync(heroManifestPath, 'utf8')) : {};
const explorer = (chain, addr) =>
  /pol|matic/.test((chain || '').toLowerCase())
    ? `https://polygonscan.com/token/${addr}`
    : `https://basescan.org/token/${addr}`;
let heroImgCount = 0;
const heroes = nftArr
  .filter(n => n.contractAddress && n.name)
  .map(n => {
    const addr = n.contractAddress.toLowerCase();
    const isPol = /pol|matic/.test((n.chain || '').toLowerCase());
    const m = heroManifest[addr];
    const hasArt = m && m.status === 'ok' && m.file;
    const thumb = hasArt ? `hero-art/thumb/${addr}.webp` : null;   // 500px card image
    const full = hasArt ? `hero-art/${m.file}` : null;             // full-res for modal
    if (hasArt) heroImgCount++;
    return {
      id: 'hero-' + addr,
      name: n.name,
      category: 'heroes',
      rarity: 'legendary',          // each is a unique 1-of-1 contract
      game: 'tasern',
      chain: isPol ? 'polygon' : 'base',
      image: thumb,                 // cached local thumbnail, or null -> emblem card
      imageFull: full,              // full-res original (modal)
      desc: `A 1-of-1 Tales of Tasern character NFT on ${isPol ? 'Polygon' : 'Base'}. Each hero is its own contract with paired liquidity.`,
      attrs: { Edition: '1 of 1', Chain: isPol ? 'Polygon' : 'Base', Type: 'Hero' },
      action: { label: 'VIEW →', url: explorer(n.chain, n.contractAddress) },
      external: true,
    };
  });

// ---- 2. MEMETREES (v4 named + species, real art) ----
const TREES = 'C:/Users/bigji/Documents/MfT-Launch/site/memetrees';
const tierRarity = { 'Old Growth': 'legendary', 'Historic': 'legendary', 'Grove': 'epic', 'Sapling': 'rare' };
const memetrees = [];
for (const f of fs.readdirSync(TREES)) {
  if (!f.endsWith('.json')) continue;
  let j; try { j = JSON.parse(fs.readFileSync(path.join(TREES, f), 'utf8')); } catch { continue; }
  const img = (j.image || '').split('/').pop();
  const attrs = {};
  (j.attributes || []).forEach(a => { attrs[a.trait_type] = a.value; });
  const tier = attrs.Tier || 'Sapling';
  // Acorn Boy stays on its live edition URL (open edition, art may change);
  // all other trees are static -> served from our own local /memetrees/ copy.
  const isAcorn = /acorn/i.test(f) || /acorn boy/i.test(j.name || '');
  const treeImg = !img ? null : (isAcorn ? `${SITE}/memetrees/${img}` : `/memetrees/${img}`);
  memetrees.push({
    id: 'tree-' + f.replace('.json', ''),
    name: j.name,
    category: 'memetrees',
    rarity: tierRarity[tier] || 'rare',
    game: 'trees',
    chain: 'base',
    image: treeImg,
    desc: (j.description || '').slice(0, 220),
    attrs: Object.keys(attrs).length ? attrs : { Edition: '1 of 1', Tier: tier },
    action: { label: 'MINT →', url: `${SITE}/memetrees/` },
    external: true,
  });
}

// ---- 3. BASELINGS (live, real sprites verified live) ----
const baselingSpecies = [
  ['redpanda', 'Red Panda', 'legendary'], ['leaf', 'Leaf', 'legendary'],
  ['oak', 'Oak Tree', 'rare'], ['bear-brown', 'Brown Bear', 'rare'],
  ['bull', 'Bull', 'rare'], ['monkey', 'Monkey', 'rare'],
  ['groundhog', 'Groundhog', 'rare'], ['mouse', 'Mouse', 'rare'],
  ['beaver', 'Beaver', 'rare'], ['frog-green', 'Frog', 'uncommon'],
  ['cat-white', 'Cat', 'common'], ['bunny-white', 'Bunny', 'common'],
  ['apple-tree', 'Apple Tree', 'rare'], ['orange-tree', 'Orange Tree', 'rare'],
  ['pear-tree', 'Pear Tree', 'rare'], ['plum-tree', 'Plum Tree', 'rare'],
];
const baselings = baselingSpecies.map(([id, name, rarity]) => ({
  id: 'baseling-' + id,
  name,
  category: 'baselings',
  rarity,
  game: 'baseling',
  chain: 'base',
  image: `${SITE}/baseling/sprites/baby-${id}.png`,
  desc: `A live Baseling pet. Feed it LP-as-food to grow stats and yield. Mints in-game; tradable ERC-721.`,
  attrs: { Species: name, Stage: 'Baby', Standard: 'ERC-721' },
  action: { label: 'PLAY →', url: `${SITE}/baseling` },
  external: true,
}));

// ---- 4. EGGS (real sprites, verified live; gold skipped - 404) ----
const eggVariants = [
  ['white-0star', 'Plain Egg', 'common'], ['green-1star', 'Spotted Egg (Green)', 'uncommon'],
  ['blue-2star', 'Twin-Star Egg (Blue)', 'rare'], ['brown-1star', 'Spotted Egg (Brown)', 'uncommon'],
  ['red-2star', 'Twin-Star Egg (Red)', 'rare'], ['white-3star', 'Tri-Star Egg', 'legendary'],
];
const eggs = eggVariants.map(([file, name, rarity]) => ({
  id: 'egg-' + file,
  name,
  category: 'eggs',
  rarity,
  game: 'baseling',
  chain: 'base',
  image: `assets/eggs/${file}.png`,   // cached local (eggs are static)
  desc: `A Baseling egg. Hatches into a creature - rarer shells and matching colors boost the odds of a legendary.`,
  attrs: { Type: 'Egg', Shell: name, Standard: 'ERC-721' },
  action: { label: 'MINT →', url: `${SITE}/baseling` },
  external: true,
}));

// NOTE: Gardens are a FEATURE being built FOR MemeTree NFTs — not a collection.
// Intentionally not a marketplace section.

const CATALOG = [...heroes, ...memetrees, ...baselings, ...eggs];

const banner = `// AUTO-GENERATED by gen-catalog.js - do not edit by hand.\n` +
  `// Real Tasern NFT catalog: ${heroes.length} heroes (${heroImgCount} with cached art), ` +
  `${memetrees.length} memetrees, ${baselings.length} baselings, ${eggs.length} eggs.\n`;
fs.writeFileSync(OUT, banner + 'window.REAL_CATALOG = ' + JSON.stringify(CATALOG, null, 1) + ';\n');
console.log(`Wrote ${CATALOG.length} items to catalog.js`);
console.log(`  heroes:${heroes.length} (art:${heroImgCount}) memetrees:${memetrees.length} baselings:${baselings.length} eggs:${eggs.length}`);
