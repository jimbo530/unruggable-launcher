// ============================================================
//  flag-store.js — ship FLAG image store + ship-token metadata resolver.
//
//  WHAT A SHIP'S METADATA IS ON BASE:
//    ShipToken.contractURI() returns  METADATA_BASE + <tokenAddressHex>
//    where METADATA_BASE = "https://tasern.quest/api/unruggable/metadata/"
//    (see Shipyard.sol). So a ship's metadata URL is keyed by its TOKEN ADDRESS,
//    exactly like the existing metadata-api (GET /metadata/:address). The ship is an
//    ERC-20 with cosmetic name/symbol/logoURI; its "art" for aggregators is the
//    contract-level EIP-7572 image.
//
//  THE FLAG FLOW:
//    The launcher UI currently treats the uploaded flag as preview-only. Here it
//    becomes the ship's metadata image:
//      1. Launcher (or a captain after a mutiny) POSTs the flag PNG to
//         POST /ship/flag/:address   { image: "data:image/png;base64,..." }
//         -> we save flags/ship-<address>.png  and record it in data/flags.json.
//      2. GET /ship/meta/:address returns EIP-7572 JSON whose `image` points at
//         GET /ship/flag/:address.png (the stored flag).
//      3. ShipToken.contractURI() (or the existing metadata-api) is pointed at
//         /ship/meta/:address so wallets/aggregators resolve to the flag.
//
//  UPDATABLE BY DESIGN: unlike the metadata-api's no-overwrite token records, a
//  ship's flag CAN change (the ship is mutiny-capable — name/flag are cosmetic and
//  crew-governable). So this store ALLOWS overwrite, but every write is logged with
//  a timestamp + setter for auditability.
// ============================================================
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FLAGS_DIR = path.join(__dirname, '..', 'flags');
const INDEX_FILE = path.join(DATA_DIR, 'flags.json');

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_IMG_BYTES = 2 * 1024 * 1024; // 2MB, matches metadata-api

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FLAGS_DIR)) fs.mkdirSync(FLAGS_DIR, { recursive: true });
}
function loadIndex() {
  try { return fs.existsSync(INDEX_FILE) ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) : {}; }
  catch (e) { throw new Error('flags.json is unreadable: ' + e.message); }
}
function saveIndex(idx) { ensureDirs(); fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2)); }

const flagFileFor = (addr) => path.join(FLAGS_DIR, 'ship-' + addr.toLowerCase() + '.png');

// Decode a data: URL OR a raw base64 string into a PNG buffer (normalized to PNG so
// the served image type is always image/png). Rejects oversize + non-image input.
async function decodeImage(input) {
  if (typeof input !== 'string') throw new Error('image must be a base64 string or data URL');
  let b64 = input;
  const m = input.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
  if (m) b64 = m[2];
  const raw = Buffer.from(b64, 'base64');
  if (!raw.length) throw new Error('image decoded to 0 bytes');
  if (raw.length > MAX_IMG_BYTES) throw new Error('image too large (2MB max)');
  // Re-encode through sharp -> always a valid PNG (also rejects non-image bytes).
  return sharp(raw).png().toBuffer();
}

// Store (or replace) a ship's flag. `setter` is for the audit log (launcher wallet
// or "captain:<addr>" after a mutiny). Returns the public image path.
async function setShipFlag(address, imageInput, setter = 'launcher') {
  if (!ADDR_RE.test(address)) throw new Error('invalid token address');
  const addr = address.toLowerCase();
  const png = await decodeImage(imageInput);
  ensureDirs();
  fs.writeFileSync(flagFileFor(addr), png);
  const idx = loadIndex();
  const prev = idx[addr];
  idx[addr] = {
    address: addr,
    image: '/ship/flag/' + addr + '.png',
    setter,
    updated: new Date().toISOString(),
    history: [...((prev && prev.history) || []), { setter, at: new Date().toISOString() }].slice(-20),
  };
  saveIndex(idx);
  return idx[addr];
}

function hasFlag(address) {
  return ADDR_RE.test(address) && fs.existsSync(flagFileFor(address));
}
function flagFilePath(address) {
  return ADDR_RE.test(address) ? flagFileFor(address) : null;
}
function getFlagRecord(address) {
  if (!ADDR_RE.test(address)) return null;
  return loadIndex()[address.toLowerCase()] || null;
}

// Build the EIP-7572 ship-token metadata (image = the stored flag). `extra` lets the
// caller merge name/symbol/description pulled from chain or the metadata-api.
function buildShipMetadata(address, baseUrl, extra = {}) {
  const addr = address.toLowerCase();
  const root = baseUrl.replace(/\/$/, '');
  const rec = getFlagRecord(addr);
  const image = rec ? `${root}${rec.image}` : (extra.image || null);
  return {
    name: extra.name || 'Ship',
    symbol: extra.symbol || 'SHIP',
    description: extra.description ||
      'A mutiny-capable ship launched on the MfT Unrugable Shipyard. Liquidity locked forever; ' +
      'the crew (100 fee-share NFTs) can re-flag the ship by 51% mutiny. Flag flies as the ship\'s art.',
    image,                       // <-- the uploaded flag
    external_link: extra.external_link || `${root}/ship/${addr}`,
    decimals: 18,
    address: addr,
    flagSetBy: rec ? rec.setter : null,
    flagUpdated: rec ? rec.updated : null,
  };
}

module.exports = {
  FLAGS_DIR, setShipFlag, hasFlag, flagFilePath, getFlagRecord, buildShipMetadata, decodeImage,
};
