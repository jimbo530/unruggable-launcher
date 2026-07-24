// Cache Tasern Hero NFT images locally — ONCE (they never change).
//
// Smart + cheap: the Tales-of-Tasern app already resolves every hero's image
// (ERC1155 uri()/ERC721 tokenURI() -> IPFS metadata -> image) and serves the
// whole map at https://tales-of-tasern.vercel.app/api/images (cached 7 days,
// server-side). So we make ZERO of our own RPC calls — we just pull that map
// once and download the images. SLOW + RESUMABLE + gateway-fallback.
//
//   node fetch-hero-art.js
//
// Output: hero-art/<contract>.<ext> + hero-art/manifest.json
// Tune: IMG_DELAY_MS (default 500 between downloads)
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'hero-art');
const MAP_FILE = path.join(OUT_DIR, '_imagemap.json');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const MAP_URL = 'https://tales-of-tasern.vercel.app/api/images';
const IMG_DELAY = Number(process.env.IMG_DELAY_MS || 500);
const GATEWAYS = ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://dweb.link/ipfs/'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function extFromType(ct, url) {
  ct = (ct || '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('svg')) return 'svg';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('webp')) return 'webp';
  const m = (url || '').match(/\.(png|jpe?g|svg|gif|webp)(\?|$)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
}

// build gateway-fallback list for an (ipfs or http) image url
function urlVariants(url) {
  if (url.startsWith('ipfs://')) { const c = url.slice(7).replace(/^ipfs\//, ''); return GATEWAYS.map(g => g + c); }
  // already an ipfs.io/.../ url -> swap across gateways too
  for (const g of GATEWAYS) if (url.startsWith(g)) { const c = url.slice(g.length); return GATEWAYS.map(x => x + c); }
  return [url];
}

async function download(url) {
  for (const u of urlVariants(url)) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(25000) });
      if (!r.ok) { await sleep(IMG_DELAY); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 0) return { buf, ext: extFromType(r.headers.get('content-type'), u) };
    } catch (_) {}
    await sleep(IMG_DELAY);
  }
  return null;
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. get the resolved image map (pull once if we don't have it)
  let map;
  if (fs.existsSync(MAP_FILE)) map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  else {
    process.stdout.write('Pulling resolved image map (1 request, no RPC) ... ');
    const r = await fetch(MAP_URL, { signal: AbortSignal.timeout(120000) });
    map = await r.json();
    fs.writeFileSync(MAP_FILE, JSON.stringify(map));
    console.log('got ' + Object.keys(map).length + ' contracts');
  }

  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
  const entries = Object.entries(map).filter(([, v]) => v && v.imageUrl);

  let done = 0, fetched = 0, skipped = 0, failed = 0;
  for (const [addrRaw, v] of entries) {
    const addr = addrRaw.toLowerCase();
    done++;
    const m = manifest[addr];
    if (m && m.status === 'ok' && m.file && fs.existsSync(path.join(OUT_DIR, m.file))) { skipped++; continue; }

    process.stdout.write(`[${done}/${entries.length}] ${addr.slice(0, 10)} (${v.chain}) ... `);
    const got = await download(v.imageUrl);
    if (got) {
      const file = `${addr}.${got.ext}`;
      fs.writeFileSync(path.join(OUT_DIR, file), got.buf);
      manifest[addr] = { status: 'ok', file, chain: v.chain, image: v.imageUrl, bytes: got.buf.length };
      console.log('OK -> ' + file + ' (' + Math.round(got.buf.length / 1024) + 'kb)');
      fetched++;
    } else {
      manifest[addr] = { status: 'img-fail', chain: v.chain, image: v.imageUrl };
      console.log('FAILED');
      failed++;
    }
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
    await sleep(IMG_DELAY);
  }

  const noImg = Object.values(map).filter(v => !v || !v.imageUrl).length;
  console.log(`\nDONE. saved:${fetched} alreadyHad:${skipped} failed:${failed} | no-image-in-map:${noImg} | total-contracts:${Object.keys(map).length}`);
})();
