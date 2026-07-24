#!/usr/bin/env node
/**
 * seas-server.js — the SERVER-AUTHORITATIVE location authority + rule-gated trade-attestation
 * signer for "Seize the Seas".  *** STAGED — review before deploy (see README). ***
 *
 * WHY THIS EXISTS (the rule, not "anti-bot")
 *   The market is RULE-GOVERNED: every gated LocationPool (contracts/LocationPool.sol) only
 *   accepts a swap if it carries a fresh attestation from the factory's gameSigner (0xF426…)
 *   proving the caller is AT that pool's location. Bots are WELCOME — they just have to PLAY BY
 *   THE RULES: genuinely be at a location, having actually sailed there on the real clock. No
 *   shortcutting (fake location / skipped travel). This service is the trust anchor that decides
 *   "is this wallet really here, right now?" and ONLY THEN asks location-signer for a signature.
 *
 * THE TWO JOBS
 *   1. LOCATION AUTHORITY — per wallet: { hex, port|null, voyage|null }. Position changes ONLY
 *      via a server-validated, server-CLOCKED voyage. The server's clock is the only truth; a
 *      client cannot set its own location.
 *   2. RULE-GATED SIGNER — /seas/trade-attest reads the pool's on-chain location(), checks the
 *      server's AUTHORITATIVE record says this wallet is AT that location AND not mid-voyage, and
 *      only then signs the LocationPool presence attestation (via ./location-signer.cjs). Else 403.
 *
 * MAP MATH = SINGLE SOURCE OF TRUTH
 *   hexDistance / PORTS / grid bounds / MS_PER_HEX / EIGHT_HOURS are loaded from the shared
 *   game/lib/location.js (the one true map). We do NOT use its localStorage journey store — the
 *   server keeps its OWN authoritative store (this is the whole point of being server-side).
 *
 * ON-CHAIN LOCATION ENCODING
 *   LocationPool.location is a uint256 == q*1000 + r  (see deploy/deploy-port-keyed-pools.js,
 *   deploy/location-lp-deployed.json). The gate compares that to the wallet's authoritative hex.
 *
 * RUN
 *   node game/server/seas-server.js            # start the HTTP service (staged; you choose to run)
 *   node game/server/seas-server.js --selftest # in-process logic test (mock clock; no RPC/key)
 *   node --check game/server/seas-server.js     # syntax check
 *
 * DEPENDENCIES: ethers (already in repo) + Node built-ins (http/fs/os/path/url). No Express needed
 *   — this uses the built-in http module with Express-style handlers; trivially portable to Express.
 *
 * NO SILENT CATCHES. Signing requires the VPS-only key (~/.seas-location-signer.env); when absent,
 * the non-signing routes still work and /seas/trade-attest returns a clear 503 (never a fake ok).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { URL, pathToFileURL } = require('url');
const { ethers } = require('ethers');
const { signSwap } = require('./location-signer.cjs');
// HARVEST (fishing / crabbing / …) — the FREE, server-authoritative CATCH dispenser signer + the
// reusable skill+supply catch math. signCatch signs the EXACT HarvestGround.dispense ticket; the harvest
// lib computes the deterministic min(skillCatch, supplyCap). A catch costs the player NOTHING (no token-in,
// no gold, no approval) — the ground holds the flow-produced stock and pays ownerOf().
const { signCatch, signerKeyPresent: harvestSignerPresent } = require('./harvest-signer.cjs');
const harvestLib = require('../seas/citizen/lib/harvest.js');
// FORGE A TITLE (Rogues Guild) — the gate + on-chain step builder. Compute/read only; moves no funds.
const forge = require('./forge-title.js');
// ROLL-CHART PRIZE — pure config + server-authoritative roll engine (no ethers, no I/O). Required from
// the SERVER dir (scp roll-charts.js → /var/www/tasern/server/). NAMES the pool to fire; moves no funds.
const rollCharts = require('./roll-charts.js');
// sha256 hex of the pinned seed — the injected hashFn the roll engine derives the deterministic roll from.
function rollHash(s) { return require('crypto').createHash('sha256').update(String(s)).digest('hex'); }

// SHIP REGISTRY (dockside sign-on, founder 2026-07-06) — SINGLE SOURCE OF TRUTH shared with the citizen
// toolbelt (lib/ships.js reads the SAME json). The relative path resolves identically here and locally,
// because the server dir is a sibling of seas/: /var/www/tasern/server -> /var/www/tasern/seas/... and
// game/server -> game/seas/... . Rows carry name/dist/rowVault/shipToken/poolFee/species/homePort.
const SHIPS_REGISTRY = require('../seas/citizen/lib/ships.json');

// ── config (RPC/CHAIN mirror location-signer.cjs so the gate reads the same chain it signs for) ──
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const CHAIN_ID = 8453;
const PORT = Number(process.env.SEAS_PORT || 8799);
// CORS: lock to the game origin in prod. SEAS_CORS_ORIGIN="*" re-opens it for dev only.
const CORS_ORIGIN = process.env.SEAS_CORS_ORIGIN || 'https://tasern.quest';
// Light per-IP rate limit (DoS / RPC-budget guard — the rule gate is the real security).
const RATE_MAX = Number(process.env.SEAS_RATE_MAX || 30);     // requests
const RATE_WINDOW_MS = Number(process.env.SEAS_RATE_WINDOW_MS || 10_000); // per window

// ── teleport (two tiers, by design) ────────────────────────────────────────────────────────────
// TELEPORT is a real in-world movement, distinct from a clocked voyage. Two tiers:
//   • DEV-WIZARD (ops): a specific human pawn we own — the operator character we MOVE to seed/fix
//     markets. UNLIMITED range + instant. Gated by a shared secret AND a pawn allowlist (SEAS_DEVWIZARDS
//     = comma-list of "collection:tokenId"; BOTH the secret and the allowlist must match). It is an
//     operator override; it NEVER forges presence for anyone else, and it is fully
//     OFF unless SEAS_ADMIN_SECRET is configured. The presence wall is unchanged — teleport only sets
//     the authoritative hex; /seas/trade-attest still checks it before signing.
//   • PLAYER (future): a real ability with a RANGE CAP (a short blink, not a free map-wide jump), and
//     later a CARRY CAP (bags of holding). Shipped OFF (range 0) until the teleport item/spell exists.
const ADMIN_SECRET = process.env.SEAS_ADMIN_SECRET || '';
const DEVWIZARDS = new Set(
  String(process.env.SEAS_DEVWIZARDS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);
// Hex range cap for a NON-admin teleport (the future player ability). 0 = players cannot teleport yet.
// The dev-wizard ignores this entirely (unlimited).
const TELEPORT_RANGE_HEXES = Number(process.env.SEAS_TELEPORT_RANGE_HEXES || 0);
const SIGNER_ENV = path.join(os.homedir(), '.seas-location-signer.env');   // VPS-only key file
const DEPLOY_JSON = path.join(__dirname, '..', '..', 'deploy', 'location-lp-deployed.json');
const POOL_ABI = ['function location() view returns (uint256)'];
// CHRONO ORB (cooldown-skip consumable) deploy record — written by deploy/deploy-chrono-orb.js. The
// server tracks an ATTRIBUTED orb balance in state.orbs and reconciles it against this on-chain ERC20
// balance (wallet-holds + server-attributed, the same model as gold). null address until deployed.
const ORB_DEPLOY_JSON = path.join(__dirname, '..', '..', 'deploy', 'orb-deployed.json');
const ERC20_BAL_ABI = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];
// HARVEST grounds config (fishing/crabbing/…). Written by mftusd-build/deploy-harvestground.cjs &
// deploy-crabground.cjs. On the VPS __dirname/../../deploy = /var/www/deploy (same dir as the location
// LP + orb records). Each grounds[key] = { resource, resourceToken, skillStat, skillVault, location,
// ground, status }; a key is USABLE only when status='live' + a ground address is present.
const HARVEST_GROUNDS_JSON = path.join(__dirname, '..', '..', 'deploy', 'harvest-grounds.json');
const HARVEST_GROUNDS_JSON_ARCHIVE = path.join(__dirname, '..', '..', 'deploy', '_archive', 'harvest-grounds.json');
// HarvestGround reads used by /seas/harvest (all read-only; no key needed to compute the plan/gate).
const HARVESTGROUND_ABI = [
  'function isResource(address) view returns (bool)',
  'function stockOf(address) view returns (uint256)',
  'function readyAt(address,uint256) view returns (uint256)',
  'function usedNonce(bytes32) view returns (bool)',
  'function paused() view returns (bool)',
  'function gameSigner() view returns (address)',
];
const ERC20_DECIMALS_ABI = ['function decimals() view returns (uint8)'];

// ── persistence (in-memory store + JSON-file layer) ───────────────────────────────────────────
// NOTE FOR PROD: swap this JSON file for a real DB (Postgres/Redis). The store is the authority,
// so prod wants durability + atomic writes + concurrency control. This file layer is for staging.
let storeFile = process.env.SEAS_STORE || path.join(os.homedir(), '.seas-server-state.json');
// state shape (all persisted to storeFile):
//   players   : { [lowercaseAddr]: { hex:{q,r}, voyage:{…}|null } }              — location authority
//   cooldowns : { [pawnKey]: { [actionKey]: untilMs } }                          — SERVER-clock cooldowns
//   orbs      : { [lowercaseAddr]: wholeChronoOrbBalance }                       — server-attributed orb bal
//   rations   : { [pawnKey]: { fedUntil:ms, foodInv:{ [foodId]:qty } } }          — SERVER-authoritative eating
// pawnKey = `${collection.toLowerCase()}:${tokenId}` (a pawn = collection + tokenId, see pawnKey()).
let state = null;

/** Test/ops hook: point the store at a different file (call before any state access). */
function setStoreFile(p) { storeFile = p; state = null; }

function loadState() {
  if (!fs.existsSync(storeFile)) return { players: {}, pawns: {}, cooldowns: {}, orbs: {}, rations: {}, bestiary: { pawns: {} }, aboard: {}, ships: {}, claims: {} };
  const raw = fs.readFileSync(storeFile, 'utf8');
  // No silent catch: a corrupt authority file must STOP the operator, never silently reset.
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.players !== 'object') {
      throw new Error('store missing { players } shape');
    }
    // forward-compat: an older state file (pre-cooldown/orb) has no cooldowns/orbs maps — seed empties.
    // This is NOT a silent recovery from corruption (the { players } shape above is still enforced); it
    // is an intentional, additive schema migration so the live state file upgrades in place.
    // per-PAWN location authority (founder 2026-07-23): one player, many pawns, many towns. Additive
    // schema migration, same rule as the maps below — an older state file upgrades in place, never resets.
    if (!parsed.pawns || typeof parsed.pawns !== 'object') parsed.pawns = {};
    if (!parsed.cooldowns || typeof parsed.cooldowns !== 'object') parsed.cooldowns = {};
    if (!parsed.orbs || typeof parsed.orbs !== 'object') parsed.orbs = {};
    // universal eating (founder 2026-06-28): the server-authoritative ration store. Additive, same as above.
    if (!parsed.rations || typeof parsed.rations !== 'object') parsed.rations = {};
    // personal bestiary / kill-tracker (founder 2026-07-01): the per-pawn kill counts + earned titles.
    // Additive schema migration, same as above — an older state file upgrades in place, never resets.
    if (!parsed.bestiary || typeof parsed.bestiary !== 'object') parsed.bestiary = { pawns: {} };
    if (!parsed.bestiary.pawns || typeof parsed.bestiary.pawns !== 'object') parsed.bestiary.pawns = {};
    // dockside sign-on (founder 2026-07-06): aboard = { [pawnKey]: {ship,dist,rowVault,port,since} };
    // ships = { [shipKey=dist.toLowerCase()]: { loc, takingHands } } (house-curated ship POSITION).
    // Additive schema migration, same rule as above — an older state file upgrades in place, never resets.
    if (!parsed.aboard || typeof parsed.aboard !== 'object') parsed.aboard = {};
    if (!parsed.ships || typeof parsed.ships !== 'object') parsed.ships = {};
    // loot claims (payout feed): { [nonce]: { runId, poolAddress, collection, tokenId,
    //   serverVerified:true, prizeLabel, wonAt, paidTx:null } }. Append-only; nonce is single-use so
    //   a claim can never be recorded twice. paidTx is stamped by the keeper's ack.
    if (!parsed.claims || typeof parsed.claims !== 'object') parsed.claims = {};
    return parsed;
  } catch (e) {
    throw new Error(`[seas] CORRUPT state file ${storeFile} — refusing to start: ${e.message}`);
  }
}
function ensureState() { if (!state) state = loadState(); return state; }
function saveState() {
  // atomic-ish write: tmp + rename so a crash can't leave a half-written authority file
  const tmp = storeFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ensureState(), null, 2));
  fs.renameSync(tmp, storeFile);
}

// ── injectable clock (Date.now in prod; overridable for the self-test) ────────────────────────
let _now = () => Date.now();
function setNow(fn) { _now = (typeof fn === 'function') ? fn : () => Date.now(); }

// ── shared map module (loaded once, async; the ONE true map math) ─────────────────────────────
let MAP = null;
// ── combat-truth modules (loaded once, async; the SAME deterministic engine the client plays) ──
// resolver.js + the bilge encounter builder + the ToT spellbook. The server REPLAYS the exact
// engine the browser ran, so a claimed win can be independently re-computed (combat-settlement).
let COMBAT = null;
// ── personal bestiary / kill-tracker module (loaded once, async; ESM) ──────────────────────────
let BESTIARY = null;
async function init() {
  if (MAP && COMBAT && BESTIARY) return MAP;
  if (!MAP) {
    MAP = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'location.js')).href);
    if (typeof MAP.hexDistance !== 'function' || !MAP.PORTS) {
      throw new Error('[seas] game/lib/location.js did not export the expected map API');
    }
  }
  if (!COMBAT) {
    const bg = path.join(__dirname, '..', 'seas', 'battle-grid');
    const resolver = await import(pathToFileURL(path.join(bg, 'resolver.js')).href);
    const engine = await import(pathToFileURL(path.join(bg, 'tot-engine.js')).href);
    const bilge = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'bilge-rats.js')).href);
    const goblin = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'goblin-cave.js')).href);
    const upkeep = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'upkeep.js')).href);
    if (typeof resolver.resolveEncounter !== 'function' || !engine.SPELLS || typeof bilge.buildBilgeEnemies !== 'function') {
      throw new Error('[seas] combat modules did not export the expected verify API (resolveEncounter / SPELLS / buildBilgeEnemies)');
    }
    if (typeof goblin.buildGoblinEnemies !== 'function' || typeof goblin.caveTerrain !== 'function') {
      throw new Error('[seas] goblin-cave module did not export the expected verify API (buildGoblinEnemies / caveTerrain)');
    }
    if (typeof upkeep.eatBatch !== 'function' || typeof upkeep.starvationPenaltyFrom !== 'function') {
      throw new Error('[seas] upkeep.js did not export the expected eating API (eatBatch / starvationPenaltyFrom) — scp the current game/lib/upkeep.js');
    }
    COMBAT = { resolveEncounter: resolver.resolveEncounter, SPELLS: engine.SPELLS, bilge, goblin, upkeep };
  }
  if (!BESTIARY) {
    // PERSONAL BESTIARY / KILL-TRACKER (founder 2026-07-01) — ESM, loaded like the combat modules
    // (dynamic import from CJS). Pure, injectable, no I/O: the server owns persistence via saveState().
    const pb = await import(pathToFileURL(path.join(__dirname, '..', 'seas', 'personal-bestiary.js')).href);
    if (typeof pb.recordKill !== 'function' || typeof pb.bestiaryFor !== 'function' || typeof pb.knownLore !== 'function') {
      throw new Error('[seas] personal-bestiary.js did not export the expected API (recordKill / bestiaryFor / knownLore) — scp game/seas/personal-bestiary.js + its monster-achievements/bestiary-lore/bestiary-* deps');
    }
    BESTIARY = pb;
  }
  return MAP;
}
function requireCombat() {
  if (!COMBAT) throw new Error('[seas] combat modules not initialized — call init() first');
  return COMBAT;
}
function requireBestiary() {
  if (!BESTIARY) throw new Error('[seas] personal-bestiary not initialized — call init() first');
  return BESTIARY;
}
function requireMap() {
  if (!MAP) throw new Error('[seas] map not initialized — call init() first');
  return MAP;
}

// ── small helpers ─────────────────────────────────────────────────────────────────────────────
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/** Checksum + validate a wallet address; throws (visibly) on garbage. Returns checksummed addr. */
function normalizeAddr(a) {
  if (typeof a !== 'string') throw new HttpError(400, 'address required');
  return ethers.getAddress(a); // throws if not a valid address
}
function addrKey(checksummed) { return checksummed.toLowerCase(); }

function hubHex() { const p = requireMap().PORTS[requireMap().HUB_PORT]; return { q: p.q, r: p.r }; }

function validHex(h) {
  const m = requireMap();
  return !!h && Number.isInteger(h.q) && Number.isInteger(h.r) &&
    h.q >= 0 && h.q < m.GRID_COLS && h.r >= 0 && h.r < m.GRID_ROWS;
}
function sameHex(a, b) { return !!a && !!b && a.q === b.q && a.r === b.r; }

/** PORT id whose hex this is, or null (open water). */
function portAtHex(h) {
  const PORTS = requireMap().PORTS;
  for (const id in PORTS) if (PORTS[id].q === h.q && PORTS[id].r === h.r) return id;
  return null;
}
/** Human-readable location name for messages. */
function locationName(h) {
  const id = portAtHex(h);
  return id ? requireMap().PORTS[id].name : `open water (${h.q},${h.r})`;
}
/** On-chain encoding: q*1000 + r (see deploy/deploy-port-keyed-pools.js). */
function encodeLoc(h) { return h.q * 1000 + h.r; }
function decodeLoc(id) { const n = Number(id); return { q: Math.floor(n / 1000), r: n % 1000 }; }

// ── location authority (per PAWN) ─────────────────────────────────────────────────────────────
// A PAWN (collection:tokenId), not a wallet, occupies the world: one player can have many pawns in
// many towns at once, each with its own hex + voyage. The on-chain swap gate binds to the WALLET
// (msg.sender), so trade-attest verifies the wallet OWNS a pawn that is genuinely at the pool's
// location, then signs for the wallet — presence is per-pawn, the signature is per-wallet.
/** Fetch (or default-seed at the hub) a PAWN's authority record. `key` = pawnKey(collection,tokenId). */
function getLoc(key) {
  const s = ensureState();
  if (!s.pawns[key]) s.pawns[key] = { hex: hubHex(), voyage: null };
  return s.pawns[key];
}

/** Is this pawn mid-voyage right now (server clock)? */
function atSea(p) { return !!(p.voyage && _now() < p.voyage.arriveAt); }

/**
 * Resolve a completed voyage: if the server clock has passed arriveAt, LAND the pawn at the
 * destination hex and clear the voyage. This is the server's authoritative tryArrive(). Returns
 * the (possibly mutated) pawn location record. `key` = pawnKey.
 */
function resolveArrival(key) {
  const p = getLoc(key);
  if (p.voyage && _now() >= p.voyage.arriveAt) {
    p.hex = { q: p.voyage.toHex.q, r: p.voyage.toHex.r };
    p.voyage = null;
    saveState();
  }
  return p;
}

/** Voyage → client view (adds secsLeft + fiction hours + port names). */
function voyageView(v) {
  if (!v) return null;
  const m = requireMap();
  return {
    fromHex: v.fromHex,
    toHex: v.toHex,
    fromPort: portAtHex(v.fromHex),
    toPort: portAtHex(v.toHex),
    departAt: v.departAt,
    arriveAt: v.arriveAt,
    distance: v.distance,
    hours: v.distance * m.EIGHT_HOURS, // fiction: 8h per hex
    secsLeft: Math.max(0, Math.ceil((v.arriveAt - _now()) / 1000)),
  };
}

/** Authoritative location view for a PAWN (resolves arrival first). `key` = pawnKey. */
function locationView(key) {
  const p = resolveArrival(key);
  const sea = atSea(p);
  return {
    pawn: key,
    hex: p.hex,
    port: portAtHex(p.hex),     // null = open water
    location: encodeLoc(p.hex), // on-chain location id of the pawn's current hex
    atSea: sea,
    voyage: sea ? voyageView(p.voyage) : null,
    secsLeft: sea ? voyageView(p.voyage).secsLeft : 0,
  };
}

/**
 * Begin a server-clocked voyage. Validates the wallet isn't already at sea, that the destination
 * is a real in-bounds hex and not the current cell, then stamps departAt=now, arriveAt=now +
 * hexDistance*MS_PER_HEX (server clock = the ONLY clock). Returns the voyage view.
 */
function doSail(checksummed, toHex) {
  const m = requireMap();
  const p = resolveArrival(checksummed);
  if (atSea(p)) throw new HttpError(409, 'already at sea — arrive before sailing again');
  if (!toHex || !Number.isInteger(toHex.q) || !Number.isInteger(toHex.r)) {
    throw new HttpError(400, 'toHex must be { q:int, r:int }');
  }
  if (!validHex(toHex)) throw new HttpError(400, `destination off the chart (0..${m.GRID_COLS - 1}, 0..${m.GRID_ROWS - 1})`);
  const fromHex = { q: p.hex.q, r: p.hex.r };
  if (sameHex(fromHex, toHex)) throw new HttpError(400, 'already at that hex');

  const distance = m.hexDistance(fromHex, toHex);
  const departAt = _now();
  const arriveAt = departAt + distance * m.MS_PER_HEX; // server-authoritative arrival time
  p.voyage = { fromHex, toHex: { q: toHex.q, r: toHex.r }, departAt, arriveAt, distance };
  saveState();
  return voyageView(p.voyage);
}

/**
 * TELEPORT a pawn to a hex INSTANTLY (no voyage clock). Two tiers (see the ADMIN_SECRET/DEVWIZARDS
 * config block): dev-wizard = unlimited range + instant; player = range-capped (off until an ability
 * ships). The presence wall is unchanged — this only sets the authoritative hex; trade-attest still
 * checks it before signing. `key` = pawnKey. isAdmin is decided by the route (secret + allowlist).
 */
function doTeleport(key, toHex, isAdmin) {
  const m = requireMap();
  const p = resolveArrival(key);
  if (!toHex || !Number.isInteger(toHex.q) || !Number.isInteger(toHex.r)) throw new HttpError(400, 'toHex must be { q:int, r:int }');
  if (!validHex(toHex)) throw new HttpError(400, `destination off the chart (0..${m.GRID_COLS - 1}, 0..${m.GRID_ROWS - 1})`);
  const fromHex = { q: p.hex.q, r: p.hex.r };
  const distance = m.hexDistance(fromHex, toHex);
  if (!isAdmin) {
    // PLAYER teleport — a short blink, range-capped; OFF until an ability ships (cap 0). A future
    // bags-of-holding CARRY cap will gate what a teleport may move once inventory weight exists.
    if (TELEPORT_RANGE_HEXES <= 0) throw new HttpError(403, 'teleport is not yet available to players (no teleport ability shipped)');
    if (distance > TELEPORT_RANGE_HEXES) throw new HttpError(403, `teleport out of range: ${distance} hexes > your range ${TELEPORT_RANGE_HEXES}`);
  }
  p.hex = { q: toHex.q, r: toHex.r };
  p.voyage = null;
  saveState();
  return { ...locationView(key), teleported: true, fromHex, distance, unlimited: !!isAdmin };
}

// ── pawn-arg helpers (routes accept { collection, tokenId } OR { pawn: "0x..:id" }) ───────────────
/** Parse a "collection:tokenId" string → the normalized pawnKey. Throws (visibly) on garbage. */
function pawnKeyFromStr(s) {
  const str = String(s || '').trim();
  const i = str.lastIndexOf(':');
  if (i < 0) throw new HttpError(400, 'pawn must be "<collection>:<tokenId>"');
  return pawnKey(str.slice(0, i), str.slice(i + 1));
}
/** Extract { collection, tokenId, key } from a request body (either shape). Throws HttpError(400). */
function pawnFromBody(b) {
  let collection = b.collection, tokenId = b.tokenId;
  if ((!collection || tokenId === undefined || tokenId === null) && typeof b.pawn === 'string') {
    const i = b.pawn.lastIndexOf(':');
    if (i < 0) throw new HttpError(400, 'pawn must be "<collection>:<tokenId>"');
    collection = b.pawn.slice(0, i); tokenId = b.pawn.slice(i + 1);
  }
  if (!collection || tokenId === undefined || tokenId === null || `${tokenId}` === '') {
    throw new HttpError(400, 'pawn required: pass { collection, tokenId } or { pawn: "0x..:id" }');
  }
  return { collection, tokenId, key: pawnKey(collection, tokenId) };
}
/** Verify (on-chain) the wallet OWNS the pawn it is moving/trading through. Throws HttpError(403). */
async function assertOwns(player, collection, tokenId) {
  let owner;
  try { owner = await readPawnOwner(collection, tokenId); }
  catch (e) { throw new HttpError(403, 'that pawn is not a recognized on-chain NFT (needs a wallet-owned pawn you hold)'); }
  if (String(owner).toLowerCase() !== String(player).toLowerCase()) {
    throw new HttpError(403, 'this pawn is not owned by the connected wallet — act only with pawns you own');
  }
}

// ── THE RULE GATE (pure decision — no RPC, no signing; testable in isolation) ─────────────────
/**
 * Decide whether a wallet may receive a presence attestation for a pool.
 * @param p          resolved player record { hex, voyage }
 * @param poolLocId  the pool's on-chain location() (q*1000+r)
 * @returns { ok:true } | { ok:false, status, reason }
 *
 * The rule: the wallet's AUTHORITATIVE hex must equal the pool's location AND the wallet must not
 * be mid-voyage. This is the whole trust boundary — a wallet (human OR bot) can only get a swap
 * attestation for a pool whose location it genuinely occupies on the server clock.
 */
function evaluateTradeGate(p, poolLocId) {
  if (atSea(p)) {
    const v = voyageView(p.voyage);
    return { ok: false, status: 403, reason: `at sea — you arrive in ~${v.secsLeft}s; cannot trade until you land` };
  }
  const here = encodeLoc(p.hex);
  const want = Number(poolLocId);
  if (here !== want) {
    const there = decodeLoc(want);
    return {
      ok: false, status: 403,
      reason: `you are not at this pool's location — you are at ${locationName(p.hex)} [${here}], the pool is keyed to ${locationName(there)} [${want}]`,
    };
  }
  return { ok: true };
}

/** Read a pool's on-chain location() (q*1000+r). Network errors propagate (no silent catch). */
async function readPoolLocation(poolAddr) {
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
  return Number(await pool.location());
}

/**
 * The gated attestation flow: resolve arrival → read pool location → RULE GATE → (only if at the
 * location) sign via location-signer.cjs. Returns { status, body }.
 */
async function tradeAttest(playerRaw, collectionRaw, tokenId, poolRaw) {
  const player = normalizeAddr(playerRaw);
  const pool = ethers.getAddress(typeof poolRaw === 'string' ? poolRaw : ''); // throws on bad pool

  // Presence key: PER-PAWN when a pawn is given (verify the wallet OWNS it — the swap binds to the
  // wallet, the presence is the pawn's), else LEGACY wallet-keyed (backward compat during rollout).
  let key;
  if (collectionRaw) {
    let owner;
    try { owner = await readPawnOwner(collectionRaw, tokenId); }
    catch (e) { return { status: 403, body: { ok: false, pool, player, reason: 'that pawn is not a recognized on-chain NFT (trade-attest needs a wallet-owned pawn)' } }; }
    if (String(owner).toLowerCase() !== player.toLowerCase()) {
      return { status: 403, body: { ok: false, pool, player, reason: 'this pawn is not owned by the connected wallet — attest only with a pawn you own' } };
    }
    key = pawnKey(collectionRaw, tokenId);
  } else {
    key = addrKey(player); // legacy: wallet-keyed presence
  }
  const p = resolveArrival(key);

  const poolLocId = await readPoolLocation(pool);
  const gate = evaluateTradeGate(p, poolLocId);
  if (!gate.ok) {
    return { status: gate.status, body: { ok: false, pool, player, pawn: collectionRaw ? key : undefined, poolLocation: poolLocId, reason: gate.reason } };
  }

  // Gate passed → request the signature. signSwap RE-READS location() on-chain and signs the exact
  // message LocationPool expects, so the signed location can never drift from the contract check.
  if (!fs.existsSync(SIGNER_ENV)) {
    return {
      status: 503,
      body: {
        ok: false, pool, player, poolLocation: poolLocId,
        reason: 'attestation signer key not present on this host — the gameSigner key lives on the VPS. The rule gate PASSED; only signing is unavailable here.',
      },
    };
  }
  const att = await signSwap(pool, player); // throws (visibly) on any signing/RPC failure
  return {
    status: 200,
    body: { ok: true, pool, player, location: att.location, expiry: att.expiry, sig: att.sig, signer: att.signer },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// DOCKSIDE SIGN-ON + MIXED-CREW ROWING (founder 2026-07-06). "A menu dock-side of available jobs —
// rowing on ships in docks taking on hands." A pawn can row a ship that is NOT its own (mixed crew);
// either way the pawn earns the ROW TOKEN of the ship it rows. "Location keyed but location moves":
// you must be AT the ship's current port to SIGN ON, but once aboard the row job travels WITH the ship.
//
// v1 ship POSITION is house-curated server state (state.ships[shipKey] = { loc, takingHands }), lazily
// seeded to each ship's homePort (all rowable ships start docked at Port Royal 8003). There is no
// ship-entity movement model yet — the house moves a ship by editing state.ships (honest + editable).
// ABOARD (state.aboard[pawnKey]) survives restarts (persisted like players). The client-side row tool
// reads GET /seas/aboard to allow a mixed-crew pawn to clock into that ship's rowVault.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** shipKey = the ship's crew distributor, lowercased (stable id for the position map). */
function shipKeyOf(ship) { return ship.dist.toLowerCase(); }
/** Ships that have oars (a rowVault) — the rowable/"taking hands" set. */
function rowableShips() { return SHIPS_REGISTRY.ships.filter((s) => s.rowVault); }
/** Find a rowable/registered ship by exact NAME (case-insensitive), or null. */
function shipByName(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return SHIPS_REGISTRY.ships.find((s) => s.name.toLowerCase() === n) || null;
}
/** A ship's POSITION record, lazily seeded at its homePort (taking hands). Persists on first seed. */
function shipPos(ship) {
  const s = ensureState();
  const k = shipKeyOf(ship);
  if (!s.ships[k]) { s.ships[k] = { loc: Number(ship.homePort), takingHands: true }; saveState(); }
  return s.ships[k];
}
/** Rows for the dock board: rowable ships docked (position == locId) AND taking hands. */
function shipsDockedAt(locId) {
  const want = Number(locId);
  const rows = [];
  for (const ship of rowableShips()) {
    const pos = shipPos(ship);
    if (pos.loc === want && pos.takingHands) {
      rows.push({ ship: ship.name, species: ship.species, crewDistributor: ship.dist,
        rowVault: ship.rowVault, shipToken: ship.shipToken, jobs: ['row'], takingHands: true });
    }
  }
  return rows;
}
/** A pawn's ABOARD record (which ship it signed onto), or null. */
function aboardRec(pawn) { const s = ensureState(); return s.aboard[pawn] || null; }

/** GET /seas/dock — ships taking hands at a port. Pass a locId (port) OR a player addr (uses their hex). */
function dockView({ port, player }) {
  let locId;
  if (port !== null && port !== undefined && String(port) !== '') {
    locId = Number(port);
    if (!Number.isInteger(locId)) throw new HttpError(400, 'port must be a location id (q*1000+r, e.g. 8003)');
  } else if (player) {
    // legacy wallet-keyed dock lookup (prefer ?port= or ?pawn= under per-pawn). Keyed by addrKey so it
    // stays consistent with any wallet-level record; pawns are the real location authority now.
    const p = resolveArrival(addrKey(normalizeAddr(player)));
    if (atSea(p)) {
      const v = voyageView(p.voyage);
      return { ok: true, atSea: true, secsLeft: v.secsLeft, port: null, ships: [],
        note: 'you are at sea — no dock in reach until you land. Sign on at a ship\'s port.' };
    }
    locId = encodeLoc(p.hex);
  } else {
    locId = encodeLoc(hubHex()); // default: the hub
  }
  const here = decodeLoc(locId);
  return { ok: true, port: locId, portName: locationName(here), atSea: false, ships: shipsDockedAt(locId),
    note: 'Ships "taking on hands" here. Sign a pawn on to man the oars: POST /seas/sign-on { player, collection, tokenId, ship }. You must be AT the ship\'s port and own the pawn. Once aboard, the row job travels with the ship.' };
}

/** GET /seas/aboard — a pawn's aboard record (row.js reads this to allow a mixed-crew clock-in). */
function aboardView(pawnRaw) {
  const pawn = String(pawnRaw || '').trim();
  if (!pawn) throw new HttpError(400, 'pawn required (?pawn=<collection>:<tokenId>)');
  const i = pawn.lastIndexOf(':');
  if (i < 0) throw new HttpError(400, 'pawn must be <collection>:<tokenId>');
  const key = pawnKey(pawn.slice(0, i), pawn.slice(i + 1)); // validates + normalizes (throws on garbage)
  return { ok: true, pawn: key, aboard: aboardRec(key) };
}

/**
 * POST /seas/sign-on — put an OWNED pawn ABOARD a ship taking hands at the player's CURRENT port.
 * Gates: ship exists + rowable + taking hands; wallet is AT the ship's port (location authority, not
 * at sea); the pawn is owned by the wallet (on-chain ownerOf, injectable for the selftest). Records
 * aboard (persisted). Returns { status, body }. 404 unknown ship / 409 not taking hands / 403 not-there
 * or not-owner — honest reasons, never a fake ok.
 */
async function signOn({ player: playerRaw, collection, tokenId, ship: shipName }) {
  const player = normalizeAddr(playerRaw);
  const pawn = pawnKey(collection, tokenId); // validates + normalizes (throws on garbage)
  const ship = shipByName(shipName);
  if (!ship) return { status: 404, body: { ok: false, reason: `unknown ship "${shipName}" — ships taking hands: ${rowableShips().map((s) => s.name).join(', ')}` } };
  if (!ship.rowVault) return { status: 409, body: { ok: false, ship: ship.name, reason: `${ship.name} takes no rowing hands — no oars wired (${ship.note || 'no rowVault'})` } };
  const pos = shipPos(ship);
  if (!pos.takingHands) return { status: 409, body: { ok: false, ship: ship.name, reason: `${ship.name} is not taking on hands right now` } };

  // PRESENCE — wallet-keyed during the per-pawn rollout (migrate to per-pawn with the client update).
  const p = resolveArrival(addrKey(player));
  if (atSea(p)) {
    const v = voyageView(p.voyage);
    return { status: 403, body: { ok: false, ship: ship.name, reason: `you are at sea — you arrive in ~${v.secsLeft}s; sign on at ${ship.name}'s port` } };
  }
  const here = encodeLoc(p.hex);
  if (here !== pos.loc) {
    const there = decodeLoc(pos.loc);
    return { status: 403, body: { ok: false, ship: ship.name, player, shipPort: pos.loc,
      reason: `you are not at ${ship.name}'s port — you are at ${locationName(p.hex)} [${here}], ${ship.name} is docked at ${locationName(there)} [${pos.loc}]` } };
  }

  // OWNERSHIP — you sign on only pawns you own (the row token pays the pawn's owner).
  let owner;
  try { owner = await readPawnOwner(collection, tokenId); }
  catch (e) { return { status: 403, body: { ok: false, ship: ship.name, reason: 'that pawn is not a recognized on-chain NFT (sign-on needs a wallet-owned pawn)' } }; }
  if (String(owner).toLowerCase() !== player.toLowerCase()) {
    return { status: 403, body: { ok: false, ship: ship.name, reason: 'this pawn is not owned by the connected wallet — sign on only pawns you own' } };
  }

  const s = ensureState();
  const rec = { ship: ship.name, dist: ship.dist, rowVault: ship.rowVault, port: pos.loc, since: _now() };
  s.aboard[pawn] = rec;
  saveState();
  const ownCrew = ship.dist.toLowerCase() === ethers.getAddress(collection).toLowerCase();
  return { status: 200, body: { ok: true, pawn, aboard: rec, ownCrew,
    note: `${pawn} signed on to ${ship.name}. Man the oars: node citizen/tools/row.js --pawn ${ethers.getAddress(collection)}:${tokenId} --ship "${ship.name}". The oars pay ${ship.name}'s own row token. Once aboard, the job travels with the ship.` } };
}

/** POST /seas/sign-off — take an OWNED pawn off its ship (leave the crew job). 409 if not aboard. */
async function signOff({ player: playerRaw, collection, tokenId }) {
  const player = normalizeAddr(playerRaw);
  const pawn = pawnKey(collection, tokenId);
  const s = ensureState();
  const rec = s.aboard[pawn];
  if (!rec) return { status: 409, body: { ok: false, pawn, reason: 'this pawn is not signed on to any ship — nothing to sign off' } };
  let owner;
  try { owner = await readPawnOwner(collection, tokenId); }
  catch (e) { return { status: 403, body: { ok: false, pawn, reason: 'that pawn is not a recognized on-chain NFT' } }; }
  if (String(owner).toLowerCase() !== player.toLowerCase()) {
    return { status: 403, body: { ok: false, pawn, reason: 'this pawn is not owned by the connected wallet — you can only sign off your own pawn' } };
  }
  delete s.aboard[pawn];
  saveState();
  return { status: 200, body: { ok: true, pawn, signedOff: true, wasAboard: rec.ship,
    note: `${pawn} signed off ${rec.ship}. If it is still at the oars, clock it out separately (row stop).` } };
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE COOLDOWN SYSTEM — the reusable spine. The SERVER (its clock) is the gate for
// EVERY recharge-gated action (bilge / goblin / build / travel). A cooldown is keyed by
// (pawn = collection+tokenId, actionKey) and stored in persistent state.cooldowns. The client's
// localStorage may MIRROR these for display, but it is NEVER the gate — the server re-checks on every
// request and answers 429 { secsLeft } while cooling. This closes the localStorage-edit free-skip hole.
//
// A "pawn" is a collection + tokenId (the NFT that took the field), NOT a wallet — so a cooldown
// follows the pawn even if it changes hands, exactly like the on-chain LootPool per-pawn cooldown.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** The canonical pawn key (collection + tokenId). Checksums the collection, BigInt-normalises tokenId. */
function pawnKey(collectionRaw, tokenId) {
  const collection = ethers.getAddress(typeof collectionRaw === 'string' ? collectionRaw : '');
  if (tokenId === undefined || tokenId === null || `${tokenId}` === '') throw new HttpError(400, 'tokenId required');
  const tid = BigInt(tokenId); // throws (visibly) on garbage
  return `${collection.toLowerCase()}:${tid.toString()}`;
}

/** Seconds left on a (pawn, action) cooldown by the SERVER clock (0 = ready). Read-only; sweeps expiry. */
function cooldownLeft(pawn, action) {
  if (!pawn || !action) throw new HttpError(400, 'cooldownLeft requires (pawn, action)');
  const s = ensureState();
  const forPawn = s.cooldowns[pawn];
  const until = forPawn ? Number(forPawn[action]) || 0 : 0;
  return Math.max(0, Math.ceil((until - _now()) / 1000));
}

/** Start (or extend) a (pawn, action) cooldown for `seconds` from now (server clock). Persists. */
function startCooldown(pawn, action, seconds) {
  if (!pawn || !action) throw new HttpError(400, 'startCooldown requires (pawn, action)');
  const secs = Number(seconds);
  if (!(secs > 0)) throw new HttpError(400, `startCooldown seconds must be > 0 (got ${seconds})`);
  const s = ensureState();
  if (!s.cooldowns[pawn]) s.cooldowns[pawn] = {};
  s.cooldowns[pawn][action] = _now() + secs * 1000;
  saveState();
  return s.cooldowns[pawn][action];
}

/** Clear a (pawn, action) cooldown (the orb-skip + admin path). Persists. Returns true if one existed. */
function clearCooldown(pawn, action) {
  if (!pawn || !action) throw new HttpError(400, 'clearCooldown requires (pawn, action)');
  const s = ensureState();
  const forPawn = s.cooldowns[pawn];
  if (!forPawn || forPawn[action] === undefined) return false;
  delete forPawn[action];
  if (Object.keys(forPawn).length === 0) delete s.cooldowns[pawn]; // keep the map tidy
  saveState();
  return true;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// UNIFIED CHRONO-ORB SKIP — one mechanism reused for ALL cooldowns. The server tracks an ATTRIBUTED
// orb balance per player (state.orbs, backed by the on-chain CHRONO ORB ERC20, reconciled periodically
// — tamper-proof + NO per-skip gas, the same "wallet-holds + server-attributed" model as gold). The
// skip endpoint: verify the pawn is the caller's, verify the player holds >=1 orb, DEBIT 1 orb, then
// clearCooldown(pawn, action). REAL-OR-NOTHING (debit-then-clear): no orb → no skip → a clear reason.
// GUARDRAIL: the orb buys the WAIT ONLY — the player still has to RUN + WIN the quest. No win/prize is
// ever bought (clearCooldown lets the pawn ENTER again; it records no claim + pays nothing).
// ════════════════════════════════════════════════════════════════════════════════════════════

/** Live CHRONO ORB token address (deploy record), or null until deploy-chrono-orb.js --execute runs. */
function orbTokenAddr() {
  if (process.env.SEAS_ORB_TOKEN) return ethers.getAddress(process.env.SEAS_ORB_TOKEN);
  if (!fs.existsSync(ORB_DEPLOY_JSON)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(ORB_DEPLOY_JSON, 'utf8'));
    const e = j && j.orbs && j.orbs['chrono-orb'];
    return e && e.address ? ethers.getAddress(e.address) : null;
  } catch (e) { throw new HttpError(500, `corrupt orb deploy record: ${e.message}`); }
}

/** Server-attributed CHRONO ORB balance for a wallet (whole units). 0 if none. */
function getOrbBalance(checksummed) {
  const s = ensureState();
  const v = Number(s.orbs[addrKey(checksummed)] || 0);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}
/** Set the server-attributed orb balance (whole, never negative). Persists. */
function setOrbBalance(checksummed, units) {
  const s = ensureState();
  s.orbs[addrKey(checksummed)] = Math.max(0, Math.floor(Number(units) || 0));
  saveState();
  return s.orbs[addrKey(checksummed)];
}

// TEST/OPS SEAM: the selftest injects an offline on-chain orb-balance reader + the pawn-owner check so
// the full skip path is provable with NO RPC. Prod leaves these null → real on-chain reads.
let _orbDeps = null;
function setOrbDeps(d) { _orbDeps = d; }

/** Read the wallet's REAL on-chain CHRONO ORB balance (whole units). For periodic reconciliation. */
async function readOnchainOrbs(checksummed) {
  if (_orbDeps && _orbDeps.readOnchainOrbs) return _orbDeps.readOnchainOrbs(checksummed);
  const token = orbTokenAddr();
  if (!token) return null; // not deployed yet — nothing to reconcile against
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  const c = new ethers.Contract(token, ERC20_BAL_ABI, provider);
  const [bal, dec] = await Promise.all([c.balanceOf(checksummed), c.decimals()]);
  return Math.floor(Number(ethers.formatUnits(bal, dec)));
}

/** Verify a pawn is owned by the caller (on-chain ownerOf). Throwing/visible; injectable for tests. */
async function readPawnOwner(collectionRaw, tokenId) {
  const collection = ethers.getAddress(typeof collectionRaw === 'string' ? collectionRaw : '');
  const tid = BigInt(tokenId);
  if (_orbDeps && _orbDeps.ownerOf) return _orbDeps.ownerOf(collection, tid);
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  const c = new ethers.Contract(collection, ['function ownerOf(uint256) view returns (address)'], provider);
  return c.ownerOf(tid);
}

/** Human label for an orb-skippable action (display only). Any registered server cooldown is skippable. */
const ACTION_LABELS = {
  'goblin-cave': 'Goblin Cave',
  'bilge-rats-quest': 'Bilge Rats (Quest)',
};
/** Is this action orb-skippable? An action is skippable iff it is a SERVER-cooldown fight kind (the
 *  single source of truth is FIGHT_KINDS[kind].cooldownSecs) OR a future non-fight cooldown action
 *  explicitly registered in ACTION_LABELS. One skip endpoint serves them all — generic by design.
 *  NOTE: FIGHT_KINDS is defined further down (combat section); this is a function so it reads it lazily. */
function skippableAction(action) {
  const k = FIGHT_KINDS[action];
  if (k && k.cooldownSecs) return { ok: true, label: ACTION_LABELS[action] || action };
  if (ACTION_LABELS[action]) return { ok: true, label: ACTION_LABELS[action] };
  return { ok: false };
}

/**
 * The orb-skip referee. RECONCILE the attributed balance up to the live on-chain balance first (so a
 * fresh on-chain top-up is honoured without per-skip gas), then: ownership gate → balance gate → DEBIT
 * 1 orb → clearCooldown(pawn, action). Real-or-nothing: the debit happens BEFORE the clear, and only if
 * the balance is sufficient. Returns { status, body }.
 *   Input: { player, collection, tokenId, action }.
 */
async function useChronoOrb({ player: playerRaw, collection: collRaw, tokenId, action: actionRaw }) {
  const player = normalizeAddr(playerRaw);
  const action = String(actionRaw || '').trim();
  const skip = skippableAction(action);
  if (!skip.ok) {
    const known = [...new Set([...Object.keys(FIGHT_KINDS).filter((k) => FIGHT_KINDS[k].cooldownSecs), ...Object.keys(ACTION_LABELS)])];
    return { status: 400, body: { ok: false, reason: `unknown skippable action "${actionRaw}" (known: ${known.join(', ')})` } };
  }
  const pawn = pawnKey(collRaw, tokenId); // validates collection + tokenId (throws on garbage)
  const collection = ethers.getAddress(collRaw);
  const tid = BigInt(tokenId);

  // 1) OWNERSHIP — you can only skip a cooldown on a pawn you OWN (the orb is debited from YOUR balance).
  // OWNERSHIP read is on-chain; a SYNTHETIC / non-deployed collection makes ownerOf return "0x" (BAD_DATA)
  // or revert. Catch it and answer a CLEAN 403 — never a raw 500 leaking ethers internals. This runs
  // BEFORE any orb debit / cooldown clear, so the failure path is real-or-nothing (moves nothing).
  let owner;
  try {
    owner = await readPawnOwner(collection, tid);
  } catch (e) {
    return { status: 403, body: { ok: false, action, collection, tokenId: tid.toString(),
      reason: 'that pawn is not a recognized on-chain NFT (orb-skip needs a wallet-owned pawn)' } };
  }
  if (String(owner).toLowerCase() !== player.toLowerCase()) {
    return { status: 403, body: { ok: false, action, collection, tokenId: tid.toString(),
      reason: 'this pawn is not owned by the connected wallet — you can only skip a cooldown for your OWN pawn' } };
  }

  // 2) is it even on cooldown? don't waste an orb on a ready pawn.
  const left = cooldownLeft(pawn, action);
  if (left <= 0) {
    return { status: 409, body: { ok: false, action, collection, tokenId: tid.toString(), secsLeft: 0,
      reason: `${skip.label} is not on cooldown for this pawn — nothing to skip (an orb would be wasted)` } };
  }

  // 3) RECONCILE the attributed balance up to the live on-chain balance (tamper-proof; no per-skip gas).
  //    We only ever RAISE the attributed balance to match chain (never silently lower a spent balance —
  //    a debit the server already applied stays applied until the next settlement run reconciles down).
  let onchain = null;
  try { onchain = await readOnchainOrbs(player); }
  catch (e) { return { status: 502, body: { ok: false, action, reason: `could not read on-chain CHRONO ORB balance: ${e.message}` } }; }
  let attributed = getOrbBalance(player);
  if (onchain !== null && onchain > attributed) { attributed = setOrbBalance(player, onchain); }

  // 4) BALANCE gate — real-or-nothing: no orb → no skip, with a clear reason (never a free skip).
  if (attributed < 1) {
    const tokenInfo = orbTokenAddr();
    return { status: 402, body: { ok: false, action, collection, tokenId: tid.toString(), secsLeft: left, orbs: attributed,
      orbToken: tokenInfo,
      reason: tokenInfo
        ? 'you hold no Chrono Orb — acquire one (buy/win) to skip a cooldown. No orb, no skip.'
        : 'the Chrono Orb token is not deployed yet — skipping is unavailable until the coordinator deploys it. No fake skip.' } };
  }

  // 5) DEBIT 1 orb FIRST (real-or-nothing), then CLEAR the cooldown. If the clear somehow no-ops (race),
  //    the debit still stands — the orb was genuinely spent on a skip request for a cooling pawn.
  const orbsLeft = setOrbBalance(player, attributed - 1);
  const cleared = clearCooldown(pawn, action);

  return {
    status: 200,
    body: {
      ok: true, action, collection, tokenId: tid.toString(),
      skipped: true, cleared, orbsLeft, orbToken: orbTokenAddr(),
      // GUARDRAIL, stated to the client: the orb bought the WAIT only.
      note: `Chrono Orb spent — ${skip.label} cooldown cleared. You may ENTER again now, but you still have to RUN and WIN the quest. No win or prize was bought.`,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE UNIVERSAL EATING (founder 2026-06-28: "all pawns need to eat"). The SERVER
// (its clock + its ration store) is the gate: a pawn eats 1 food/day, town or wild; an UNFED pawn
// fights WEAKER (−1 to ALL stats per missed day, cumulative). localStorage may MIRROR this for the
// UI, but it is NEVER the gate — verify-fight re-derives the penalty here and CLAMPS the client's
// player team, so a fat-stat submission can't dodge hunger. The −1/day math + the once-per-day,
// batched, CHEAPEST-FIRST consumption are REUSED from game/lib/upkeep.js (eatBatch /
// starvationPenaltyFrom) — ONE source of truth shared with the client (no logic can drift).
//
// State shape: state.rations[pawnKey] = { fedUntil:ms, foodInv:{ [foodId]:qty } }. A pawn with NO
// record has penalty 0 (never-ate == not-yet-tracked), so this is a pure ADD: it can only weaken a
// pawn the server already knows is hungry — existing clients see zero change until food is tracked.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** The server ration authority map (state.rations). Seeded lazily; persisted via saveState(). */
function serverRations() {
  const s = ensureState();
  if (!s.rations || typeof s.rations !== 'object') s.rations = {};
  return s.rations;
}

/** A pawn's ration record { fedUntil, foodInv }, created (empty) on first touch. */
function rationRec(pawn) {
  const r = serverRations();
  if (!r[pawn]) r[pawn] = { fedUntil: 0, foodInv: {} };
  if (!r[pawn].foodInv || typeof r[pawn].foodInv !== 'object') r[pawn].foodInv = {};
  return r[pawn];
}

/** ADD food units to a pawn's server stores (the grant/restock path; relayer/keeper wires later). */
function grantFood(pawn, foodId, qty) {
  const rec = rationRec(pawn);
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  if (n <= 0) return rec.foodInv;
  rec.foodInv[String(foodId)] = (rec.foodInv[String(foodId)] || 0) + n;
  saveState();
  return rec.foodInv;
}

/**
 * ONCE-PER-DAY, BATCHED, CHEAPEST-FIRST catch-up for a pawn from ITS OWN server stores, using the
 * SHARED upkeep pure core (eatBatch). Advances fedUntil per food eaten; leftover days stay hungry.
 * Persists. Returns the upkeep eatBatch result ({ fedUntil, ate, foods, hungryDays }).
 */
function serverAutoEat(pawn, now) {
  const { upkeep } = requireCombat();
  const rec = rationRec(pawn);
  const res = upkeep.eatBatch(rec, rec.foodInv, now != null ? now : _now()); // MUTATES rec.foodInv
  rec.fedUntil = res.fedUntil;
  saveState();
  return res;
}

/** The all-stats starvation penalty (≤ 0) for a pawn, from the SERVER's authoritative fedUntil. */
function serverStarvePenalty(pawn, now) {
  const { upkeep } = requireCombat();
  const rec = serverRations()[pawn];
  return upkeep.starvationPenaltyFrom(rec ? rec.fedUntil : 0, now != null ? now : _now());
}

/** Eat ONE day's ration from a pawn's stores on a CONCLUSIVE fight (the "fighting burns the day" sink).
 *  Cheapest-first (eatBatch picks it). No-op (no throw) if the pawn has no food — it just stays hungry. */
function debitFightRation(pawn, now) {
  const { upkeep } = requireCombat();
  const rec = rationRec(pawn);
  const food = upkeep.cheapestFood(rec.foodInv);
  if (!food) return null;                          // no stores → nothing to debit (pawn keeps starving)
  rec.foodInv[food] -= 1; if (rec.foodInv[food] <= 0) delete rec.foodInv[food];
  saveState();
  return food;
}

/** Clamp a submitted player TEAM by an all-stats starvation penalty (≤ 0): lower every combat stat +
 *  HP by |pen|, floored at 1 — the server's authoritative override of any client-sent player stats.
 *  Mirrors upkeep.applyStarvation's clamp, applied to the DERIVED combat fields the engine reads.
 *  Pure: returns a NEW team (deep-ish clone of stats); pen 0 → the team passes through unchanged. */
function starveTeam(team, pen) {
  if (!Array.isArray(team) || !(pen < 0)) return team;          // pen 0/≥0 → no-op (byte-identical)
  const lo = (v) => Math.max(1, (Number(v) || 0) + pen);        // STARVE_STAT_FLOOR = 1
  return team.map((u) => {
    if (!u || typeof u !== 'object') return u;
    const stats = u.stats && typeof u.stats === 'object' ? { ...u.stats } : u.stats;
    if (stats) for (const k of ['attack', 'atkBonus', 'ac', 'def', 'mDef', 'mAtk']) {
      if (typeof stats[k] === 'number') stats[k] = lo(stats[k]);
    }
    const out = { ...u, stats };
    if (typeof u.maxHp === 'number') out.maxHp = lo(u.maxHp);
    if (typeof u.currentHp === 'number') out.currentHp = Math.min(out.maxHp != null ? out.maxHp : u.currentHp, lo(u.currentHp));
    return out;
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// COMBAT SETTLEMENT — issue-seed (anti-grind anchor) + verify-fight (server-replay referee).
// COMPUTE/READ ONLY — no funds, no signing. The server pins each fight's RNG seed so the client
// can't pre-roll/re-roll it, then REPLAYS the deterministic engine to independently judge a win.
// ════════════════════════════════════════════════════════════════════════════════════════════

// In-memory issued-fight store (staging — swap for the durable DB in prod, like the location store).
// nonce → { player, fight, seed, used, issuedAt }. A restart drops UNVERIFIED fights (acceptable for
// staging: the player just re-enters). TTL + soft cap keep it from growing without bound.
const _fights = new Map();
const FIGHT_TTL_MS = Number(process.env.SEAS_FIGHT_TTL_MS || 3_600_000); // 1h to play+submit
const FIGHT_MAX = Number(process.env.SEAS_FIGHT_MAX || 50_000);
function gcFights(now) {
  if (_fights.size <= FIGHT_MAX) {
    // cheap targeted sweep only when large
    if (_fights.size > FIGHT_MAX / 2) for (const [k, v] of _fights) if (now - v.issuedAt > FIGHT_TTL_MS) _fights.delete(k);
    return;
  }
  for (const [k, v] of _fights) if (now - v.issuedAt > FIGHT_TTL_MS) _fights.delete(k);
}

/** Known fight kinds → how the server RECONSTRUCTS the enemy team from the seed (never trusting a
 *  client-supplied enemy list). Bilge rats: rebuild the rat squad deterministically from the seed. */
const FIGHT_KINDS = {
  'bilge-rats':  { mod: 'bilge',  buildEnemies: 'buildBilgeEnemies',  terrain: 'bilgeTerrain', grid: 'SQUAD_GRID' },
  // goblin cave — MIGRATED to the server cooldown (168h = 7 days), orb-skippable. localStorage display-only.
  'goblin-cave':      { mod: 'goblin', buildEnemies: 'buildGoblinEnemies', terrain: 'caveTerrain',  grid: 'SQUAD_GRID',
                        cooldownSecs: Number(process.env.SEAS_GOBLIN_CD_SECS || 168 * 3600) },
  // NEW server-gated bilge quest — reuses the HARDENED bilge engine, but its recharge lives on the SERVER
  // (1h, orb-skippable), NOT in an immutable on-chain LootPool. This is the quest born server-gated.
  'bilge-rats-quest': { mod: 'bilge',  buildEnemies: 'buildBilgeEnemies',  terrain: 'bilgeTerrain', grid: 'SQUAD_GRID',
                        cooldownSecs: Number(process.env.SEAS_BILGE_QUEST_CD_SECS || 3600) },
};

/**
 * ISSUE a fight seed + nonce (the sign-to-enter anchor). The seed is SERVER-RANDOM (crypto), so the
 * client cannot grind/pre-roll the RNG or the enemy composition. Returns { seed, nonce } the client
 * sets as window.SEAS_FIGHT_SEED to play, then echoes the nonce back to verify.
 * @returns {{ seed:string, nonce:string, fight:string }}
 */
function issueSeed(playerRaw, fightRaw, opts = {}) {
  const player = normalizeAddr(playerRaw);
  const fight = String(fightRaw || 'bilge-rats');
  const kind = FIGHT_KINDS[fight];
  if (!kind) throw new HttpError(400, `unknown fight "${fight}" (known: ${Object.keys(FIGHT_KINDS).join(', ')})`);

  // cooldown-gated kinds: require the pawn + check the SERVER cooldown (the real gate).
  let pawn = null;
  if (kind.cooldownSecs) {
    if (!opts || opts.collection === undefined || opts.tokenId === undefined) {
      throw new HttpError(400, `the "${fight}" fight is cooldown-gated — pass { collection, tokenId } (the pawn entering) so the server can gate it`);
    }
    pawn = pawnKey(opts.collection, opts.tokenId);
    const left = cooldownLeft(pawn, fight);
    if (left > 0) {
      return { status: 429, body: { ok: false, fight, secsLeft: left,
        reason: `this pawn is spent — ${fight} recharges in ${left}s. Skip the wait with a Chrono Orb (POST /seas/use-chrono-orb), or wait it out.` } };
    }
  }

  const now = _now();
  gcFights(now);
  // DEPTH (founder 2026-07-08: goblins scale by depth) — pinned at issue so client and
  // server rebuild the IDENTICAL deepened squad; clamped like the lib clamps it.
  const depth = Math.max(1, Math.min(9, Math.floor(Number(opts && opts.depth) || 1)));
  const seed = 'seas-' + fight + '-' + crypto.randomBytes(16).toString('hex'); // unguessable RNG anchor
  const nonce = crypto.randomBytes(12).toString('hex');
  // UNIVERSAL EATING: catch the pawn up from its server stores (once-per-day, batched, cheapest-first)
  // and PIN the resulting starvation penalty to THIS fight, so the hunger state can't change between
  // issue and submit. A pawn with no ration record / no food → penalty 0 (pure add). Only pawn-bearing
  // fights (cooldown kinds carry a pawn) are tracked; a pawn-less fight pins starve 0.
  let starve = 0;
  if (pawn) { serverAutoEat(pawn, now); starve = serverStarvePenalty(pawn, now); }
  _fights.set(nonce, { player: addrKey(player), fight, seed, used: false, issuedAt: now, pawn, starve, depth });
  return { status: 200, body: { ok: true, seed, nonce, fight, pawn, depth } };
}

/**
 * VERIFY a submitted fight: look up the SERVER-PINNED seed by nonce, RECONSTRUCT the enemy team from
 * that seed (so a client can't submit weakened foes), then REPLAY resolveEncounter with the client's
 * playerTeam + playerActions and return the AUTHORITATIVE winner. One verify per nonce (anti
 * double-claim). Throws (visibly) on a tampered/illegal action log — the server rejects, never fakes.
 *
 * NOTE (honest hardening boundary): the PLAYER team is taken from the client here. Verifying that the
 * pawn's stats/ownership are genuine (on-chain pawn read) is a SEPARATE gate — flagged, not yet wired.
 * What this DOES close: faked dice, faked/whiffed enemy AI, faked win, weakened enemies, replay/double-claim.
 *
 * @returns {{ status:number, body:object }}
 */
function verifyFight({ player: playerRaw, nonce, playerTeam, playerActions }) {
  const player = normalizeAddr(playerRaw);
  if (typeof nonce !== 'string' || !nonce) throw new HttpError(400, 'nonce required (from issue-seed)');
  const rec = _fights.get(nonce);
  if (!rec) return { status: 404, body: { ok: false, reason: 'unknown or expired fight nonce — re-enter to get a fresh seed' } };
  if (rec.used) return { status: 409, body: { ok: false, reason: 'this fight was already verified (one settlement per nonce)' } };
  if (rec.player !== addrKey(player)) return { status: 403, body: { ok: false, reason: 'this fight nonce belongs to a different wallet' } };
  if (_now() - rec.issuedAt > FIGHT_TTL_MS) { _fights.delete(nonce); return { status: 410, body: { ok: false, reason: 'fight expired — re-enter to get a fresh seed' } }; }
  if (!Array.isArray(playerTeam) || !playerTeam.length) throw new HttpError(400, 'playerTeam (array) required');
  if (!Array.isArray(playerActions)) throw new HttpError(400, 'playerActions (array) required');

  const COMBAT_ = requireCombat();
  const { resolveEncounter, SPELLS } = COMBAT_;
  const seed = rec.seed; // SERVER-PINNED — ignore any client-sent seed (anti-grind)

  // Resolve which combat module + builders this fight kind uses (bilge rats vs goblin cave).
  const kind = FIGHT_KINDS[rec.fight];
  if (!kind) throw new HttpError(400, `cannot verify unknown fight "${rec.fight}"`);
  const mod = COMBAT_[kind.mod];

  // Reconstruct the foes from the seed alone (the SAME builder the client used → matching ids/hexes).
  const playerHexes = playerTeam.map((u) => u && u.position).filter(Boolean);
  const enemyTeam = mod[kind.buildEnemies](seed, playerHexes, rec.depth || 1);
  // UNIVERSAL EATING: the server is the referee — CLAMP the client-submitted player team by the
  // pinned starvation penalty (rec.starve, set at issue from the SERVER's ration store) so a starving
  // pawn genuinely fights weaker here and a fat-stat client submission is overridden. pen 0 = no-op.
  const starvedTeam = starveTeam(playerTeam, Number(rec.starve) || 0);
  const result = resolveEncounter({
    seed, playerTeam: starvedTeam, enemyTeam, playerActions,
    spellbook: SPELLS, terrain: mod[kind.terrain](), grid: mod[kind.grid],
  });

  // mark the nonce spent ONLY on a conclusive, non-error verdict (an exhausted/inconclusive log can
  // be resubmitted with the rest of the fight — it never produced a win, so nothing was minted).
  if (!result.finalState.exhausted) rec.used = true;

  // SERVER COOLDOWN: a cooldown-gated kind STARTS the pawn's cooldown on a conclusive verdict (win OR
  // loss — entering + concluding the fight consumes the slot, the bilge/goblin "run consumes it" rule).
  // We do this on the SERVER clock (the authority), keyed by the pawn the issue-seed recorded. An
  // inconclusive/exhausted log is NOT a conclusion → no cooldown started (you may resubmit / retry).
  const playerWon = result.winner === 'player' && !result.finalState.exhausted;
  let cooldownStarted = 0;
  if (kind.cooldownSecs && rec.pawn && !result.finalState.exhausted) {
    cooldownStarted = startCooldown(rec.pawn, rec.fight, kind.cooldownSecs);
  }
  // UNIVERSAL EATING SINK: a conclusive fight burns ONE day's ration from the pawn's server stores
  // (cheapest-first). Entering + concluding a fight consumes the day's food, the same "run consumes
  // it" rule as the cooldown. No food → no-op (the pawn just stays hungry → debuff next time).
  if (rec.pawn && !result.finalState.exhausted) debitFightRation(rec.pawn);

  // ── ROLL-CHART PRIZE: ONLY on a server-verified SKILL WIN. DETERMINISTIC off the SAME server-pinned
  //    seed (un-re-rollable: the nonce is now spent), so the win always lands the identical pool. The
  //    roll only NAMES the numbered LootPool to fire (basis: live balance × per-token bps); the founder-
  //    gated keeper performs the payout. A loss / inconclusive run rolls NOTHING. We pin it on the rec so
  //    a keeper read sees the exact same authoritative result.
  let roll = null, prize = null;
  if (playerWon) {
    roll = rollCharts.resolveRoll(rec.fight, seed, rollHash);
    rec.roll = roll; // pinned to this (consumed) nonce — the keeper fires what THIS says, nothing else
    const fire = roll && Array.isArray(roll.fires) && roll.fires[0] ? roll.fires[0] : null;
    if (fire) prize = { poolId: fire.poolId, poolAddress: fire.pool.address, label: fire.pool.label, deployed: fire.deployed };

    // ── PERSIST the win as a PAYABLE CLAIM (payout feed — root-cause fix 2026-07-11: verify-fight
    //    used to return the prize then FORGET it; the keeper starved). Keyed by the single-use nonce
    //    → the same fight can never yield two claims. Only recorded on a genuine, conclusive,
    //    pawn-bearing win that named a deployed pool. Keeper reads GET /seas/claims, fires payout().
    if (prize && prize.deployed && rec.pawn && prize.poolAddress) {
      const st = ensureState();
      if (!st.claims || typeof st.claims !== 'object') st.claims = {};
      if (!st.claims[nonce]) {                         // idempotent on nonce
        st.claims[nonce] = {
          runId: `win-${rec.fight}-${nonce}`,
          poolAddress: prize.poolAddress,
          collection: rec.pawn.split(':')[0],
          tokenId: rec.pawn.split(':')[1],
          serverVerified: true,
          prizeLabel: prize.label,
          wonAt: new Date(_now()).toISOString(),
          paidTx: null,
        };
        saveState();
      }
    }
  }

  // ── KILL-TRACKER / PERSONAL BESTIARY (founder 2026-07-01): count slain foes from the SERVER'S OWN
  //    REPLAY (un-trickable — the client never reports a kill) and credit them to the pawn that fought.
  //    ONLY on a genuine, conclusive player WIN, and only for a pawn-bearing (cooldown-kind) fight.
  //    recordKill() crosses any newly-earned kill/meta tiers and returns UNLOCK EVENTS — we surface them
  //    as `unlocks` (for the chime/toast/UI + tracking). NOTE: the on-chain COIN/GEM PRIZE payout for a
  //    crossed tier is NOT wired here — that is the founder-gated on-chain step. This only fires the event.
  let unlocks = [];
  if (playerWon && rec.pawn) {
    const bestiaryMod = requireBestiary();
    const st = ensureState();
    if (!st.bestiary || typeof st.bestiary !== 'object') st.bestiary = { pawns: {} };
    // tally kills per monsterId from the finalState (a foe at <=0 HP is slain). Skip a unit with no
    // monsterId (real-or-nothing: an untagged foe is not credited rather than crash the settlement).
    const slain = result.finalState.units.filter((u) => !u.isPlayer && u.currentHp <= 0);
    const tally = {};
    for (const u of slain) { if (u && u.monsterId) tally[u.monsterId] = (tally[u.monsterId] || 0) + 1; }
    for (const [monsterId, count] of Object.entries(tally)) {
      const rec2 = bestiaryMod.recordKill(st.bestiary, rec.pawn, monsterId, count);
      if (rec2 && Array.isArray(rec2.newlyEarned) && rec2.newlyEarned.length) unlocks.push(...rec2.newlyEarned);
    }
    if (Object.keys(tally).length) saveState(); // persist the counts + any earned tiers
  }

  return {
    status: 200,
    body: {
      ok: true, nonce, fight: rec.fight, seed, pawn: rec.pawn || null,
      // UNIVERSAL EATING: the all-stats penalty (≤ 0) the server APPLIED to the player team this fight
      // (0 = fully fed / untracked). Additive + display-only; the verdict already reflects the clamp.
      starve: Number(rec.starve) || 0,
      winner: result.winner,                 // AUTHORITATIVE outcome (server-recomputed)
      exhausted: result.finalState.exhausted, // true → log too short to decide (resubmit, not a win)
      round: result.finalState.round,
      enemies: enemyTeam.length,
      // a server-verified player win is the keeper's gate to fire the reward payout (DRY until founder opens it)
      payoutEligible: playerWon,
      // the roll-chart prize for this win (null on a loss): which numbered LootPool the keeper fires.
      // "win by skill → win a random prize" — server-authoritative + deterministic-per-seed.
      roll,
      prize,
      // NEWLY-EARNED bestiary achievement unlocks from THIS win (empty on a loss / no crossed tier).
      // The client fires the chime + a toast per event; the on-chain coin/gem prize is a separate,
      // founder-gated step (NOT paid here). Each event: { kind, title, tier, monsterId, achId, prize, killCount }.
      unlocks,
      // when this pawn can fight this kind again (server-cooldown kinds only; 0 = no server cooldown)
      cooldownUntil: cooldownStarted || 0,
      cooldownSecs: kind.cooldownSecs || 0,
    },
  };
}


// ════════════════════════════════════════════════════════════════════════════════════════════
// HARVEST — the FREE, skill-gated, server-authoritative CATCH (fishing / CRABBING / logging / …).
//
// Founder (2026-07-01): "they need NOTHING to go crabbing and make coin." This is the bottom-rung,
// zero-resource income rail: a poor peasant sails to the grounds and CATCHES the resource — no gold,
// no gear, no token-in. It is NOT a market buy (that path spends gold); it is a metered RELEASE of
// flow-produced stock, exactly like the ocean fish grounds already do on-chain.
//
// SERVER-AUTHORITATIVE (not client-trickable), mirroring the fight + trade gates:
//   1) CO-LOCATION — the player must genuinely be AT the ground's location (same evaluateTradeGate the
//      LocationPool swap uses; 403 if not there / at sea). No forged presence.
//   2) SKILL — read the pawn's WIS water level from the ground's skillVault (harvest.readSkill).
//   3) SUPPLY — read the ground's LIVE on-chain stock of the resource (never overdraw it).
//   4) CATCH  — harvest.computeHarvest(level, supply) = min(skillCatch, supplyCap). Deterministic,
//      never random (feedback_skill_based_prizes). Skill scales the catch; supply caps it.
//   5) COOLDOWN — the ground's ON-CHAIN per-pawn readyAt() is the real anti-grind gate (429 if cooling).
//   6) SIGN — harvest-signer signs the EXACT HarvestGround.dispense ticket ({ amount, expiry, nonce });
//      the contract releases EXACTLY that to ownerOf(tokenId). If the VPS signer key is absent we return
//      503 (the gate PASSED; only signing is unavailable) — never a fake ticket.
//
// The catch pays a trade-good token (FISH / CRAB): free progress that the peasant later sells for coin
// (per founder "any copper or items = trade-good progress"). Config-driven: fish works today (ground is
// live on-chain); crab activates the instant the coordinator deploys + records a crab ground (503 until).
// ════════════════════════════════════════════════════════════════════════════════════════════

/** Load the harvest-grounds config (primary path, then the archive fallback). null if neither exists. */
function loadHarvestGrounds() {
  const p = fs.existsSync(HARVEST_GROUNDS_JSON) ? HARVEST_GROUNDS_JSON
    : (fs.existsSync(HARVEST_GROUNDS_JSON_ARCHIVE) ? HARVEST_GROUNDS_JSON_ARCHIVE : null);
  if (!p) return null;
  try { return { path: p, cfg: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
  catch (e) { throw new HttpError(500, `harvest-grounds config unreadable (${p}): ${e.message}`); } // visible, never silent
}

/**
 * Resolve a harvest profile by resource key (e.g. 'fish' | 'crab'). Returns { key, ...profile } or a
 * clear reason it is unavailable. A profile is USABLE only when its ground is deployed (status live +
 * a ground address) — otherwise it's an honest "not deployed yet" (the crab case until the coordinator
 * deploys it). Never invents an address.
 */
function resolveHarvestProfile(resourceKey) {
  const loaded = loadHarvestGrounds();
  if (!loaded) return { ok: false, status: 503, reason: 'no harvest-grounds config on this host — grounds are not configured yet' };
  const key = String(resourceKey || '').toLowerCase();
  const g = loaded.cfg.grounds && loaded.cfg.grounds[key];
  if (!g) {
    const known = loaded.cfg.grounds ? Object.keys(loaded.cfg.grounds).join(', ') : '(none)';
    return { ok: false, status: 400, reason: `unknown harvest resource "${key}" — known: ${known}` };
  }
  if (!g.ground || g.status !== 'live') {
    return { ok: false, status: 503, gated: false,
      reason: `the ${key} grounds are not deployed yet — crabbing/fishing here activates once the coordinator deploys + records the ${key} HarvestGround (deploy-harvestground.cjs). The rail is built; only the on-chain ground is pending.` };
  }
  return { ok: true, key, profile: g };
}

/**
 * The catch referee: co-location gate → skill → live supply → deterministic catch → on-chain cooldown →
 * signed dispense ticket. Input: { player, collection, tokenId, resource ('fish'|'crab'|…) }.
 * Returns { status, body }. FREE for the player (the ticket carries no cost); the ground pays ownerOf().
 */
async function harvestCatch({ player: playerRaw, collection: collRaw, tokenId, resource: resourceRaw }) {
  const player = normalizeAddr(playerRaw);
  const collection = ethers.getAddress(typeof collRaw === 'string' ? collRaw : ''); // throws on garbage
  if (tokenId === undefined || tokenId === null || `${tokenId}` === '') throw new HttpError(400, 'tokenId required');
  const tid = BigInt(tokenId); // throws (visibly) on garbage

  // 1) resolve the profile (fish live today; crab 503 until its ground is deployed).
  const r = resolveHarvestProfile(resourceRaw);
  if (!r.ok) return { status: r.status, body: { ok: false, player, resource: String(resourceRaw || '').toLowerCase(), reason: r.reason } };
  const g = r.profile;
  const ground = ethers.getAddress(g.ground);
  const resourceToken = ethers.getAddress(g.resourceToken);

  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);

  // 2) OWNERSHIP — you catch with a pawn you OWN (the catch is paid to ownerOf; require the caller to be it).
  const owner = await readPawnOwner(collection, tid);
  if (owner.toLowerCase() !== player.toLowerCase()) {
    return { status: 403, body: { ok: false, ground, resource: r.key, collection, tokenId: tid.toString(),
      reason: 'this pawn is not owned by the connected wallet — you can only catch with your OWN pawn (the catch is paid to its owner)' } };
  }

  // 3) CO-LOCATION — the SAME rule gate the LocationPool swap uses (403 if not at the grounds / at sea).
  //    Legacy wallet-keyed during the per-pawn rollout (migrate to per-pawn with the client update).
  const p = resolveArrival(addrKey(player));
  const gate = evaluateTradeGate(p, Number(g.location));
  if (!gate.ok) {
    return { status: gate.status, body: { ok: false, ground, resource: r.key, groundLocation: Number(g.location),
      player, reason: gate.reason } };
  }

  // 4) on-chain HarvestGround state (paused? resource registered? live stock? per-pawn cooldown?).
  const gc = new ethers.Contract(ground, HARVESTGROUND_ABI, provider);
  const [paused, isRes, stockWei] = await Promise.all([gc.paused(), gc.isResource(resourceToken), gc.stockOf(resourceToken)]);
  if (paused) return { status: 503, body: { ok: false, ground, resource: r.key, reason: 'the grounds are closed (paused on-chain)' } };
  if (!isRes) return { status: 503, body: { ok: false, ground, resource: r.key, reason: `${r.key} is not a registered resource on this ground (addResource pending)` } };

  const readyAt = Number(await gc.readyAt(collection, tid));
  const nowS = Math.floor(_now() / 1000);
  const secsLeft = readyAt - nowS;
  if (secsLeft > 0) {
    return { status: 429, body: { ok: false, ground, resource: r.key, collection, tokenId: tid.toString(),
      cooldownSecs: secsLeft, readyAt,
      reason: `this pawn is spent at the ${r.key} grounds — recharges in ${secsLeft}s (on-chain per-pawn cooldown). Skip the wait with a Chrono Orb, or wait it out.` } };
  }

  // 5) SKILL + SUPPLY → deterministic catch (never random). supply is in the resource's own decimals.
  const dec = Number(await new ethers.Contract(resourceToken, ERC20_DECIMALS_ABI, provider).decimals());
  const supplyUnits = Number(ethers.formatUnits(stockWei, dec));
  const skill = await harvestLib.readSkill(g.skillVault, collection, tid);
  const harvest = harvestLib.computeHarvest(skill.level, supplyUnits);
  if (!(harvest.amount > 0)) {
    return { status: 503, body: { ok: false, ground, resource: r.key, skill, supplyUnits, harvest,
      reason: 'the grounds are barren right now — no catch is available (flow-supply is empty). The win/skill stands; nothing to release until the ground is refilled.' } };
  }
  const amountWei = ethers.parseUnits(harvest.amount.toFixed(dec > 8 ? 8 : dec), dec); // clamp decimals, never over-precise

  // 6) SIGN the dispense ticket — the VPS-only harvest signer. Absent → 503 (gate passed; can't sign).
  if (!harvestSignerPresent()) {
    return { status: 503, body: { ok: false, ground, resource: r.key, collection, tokenId: tid.toString(),
      skill, supplyUnits, harvest,
      reason: 'catch authorization signer key not present on this host — the harvest signer key lives on the VPS. The gate + skill + supply all PASSED; only signing is unavailable here.' } };
  }
  const expiry = nowS + Number(process.env.HARVEST_TTL || 300); // short TTL like the trade attestation
  const nonce = ethers.hexlify(crypto.randomBytes(32));         // single-use anti-replay nonce
  const auth = await signCatch({ ground, collection, tokenId: tid, resource: resourceToken, amount: amountWei, expiry, nonce });

  return {
    status: 200,
    body: {
      ok: true, ground, resource: r.key, resourceToken, collection, tokenId: tid.toString(), player: owner,
      skill: { stat: g.skillStat || 'WIS', level: skill.level, backingUsd: skill.backingUsd, planted: skill.planted },
      supplyUnits, catch: harvest, // { amount, skillCatch, supplyCap, limitedBy, formula }
      // the signed authorization the caller passes to HarvestGround.dispense (FREE — no token-in, no gold):
      authorization: { ground, collection, tokenId: tid.toString(), resource: resourceToken,
        amount: auth.amount, expiry, nonce, sig: auth.sig, signer: auth.signer },
      note: 'FREE catch — no gold, no gear, no approval. The ground releases the signed amount to your pawn owner. This is the zero-resource income rail (founder: "need NOTHING to go crabbing"). Sell the catch later for coin.',
    },
  };
}


// ════════════════════════════════════════════════════════════════════════════════════════════
// FORGE A TITLE — the Rogues Guild prestige forge (compute/read only; moves no funds, signs nothing).
// Gate: the pawn must have EARNED the Rogues Guild 1-week rung (cbBTC achievement id 1002). Returns
// the EXACT forge steps (relayer plantTree + buyer EXACT-USDC-approve + depositAndWater). 503 if the
// Titles vault isn't deployed (never a fake forge). NOT a financial product — in-game gold + prestige.
// ════════════════════════════════════════════════════════════════════════════════════════════
function titlesVaultAddr() { return process.env.SEAS_TITLES_VAULT || forge.TITLES_VAULT || null; }
let _forgeDeps = null;
function setForgeDeps(d) { _forgeDeps = d; }
async function forgeTitle({ player: playerRaw, collection: collRaw, tokenId }) {
  const player = normalizeAddr(playerRaw);
  const collection = ethers.getAddress(typeof collRaw === 'string' ? collRaw : '');
  if (tokenId === undefined || tokenId === null || `${tokenId}` === '') throw new HttpError(400, 'tokenId required');
  const tid = BigInt(tokenId);
  const provider = _forgeDeps ? null : new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  const owner = _forgeDeps ? await _forgeDeps.ownerOf(collection, tid)
    : await new ethers.Contract(collection, ['function ownerOf(uint256) view returns (address)'], provider).ownerOf(tid);
  if (owner.toLowerCase() !== player.toLowerCase()) {
    return { status: 403, body: { ok: false, collection, tokenId: tid.toString(), reason: 'this pawn is not owned by the connected wallet — you can only forge a title for your OWN pawn' } };
  }
  const gate = _forgeDeps ? await _forgeDeps.earned(collection, tid) : await forge.hasEarnedRogue1Week(provider, collection, tid);
  if (!gate.earned) {
    return { status: 403, body: { ok: false, collection, tokenId: tid.toString(), gated: true, achievementId: gate.achievementId, prizePool: gate.prizePool,
      reason: 'the forge is sealed — only a pawn that has earned its week in the Rogues Guild may forge a title. Stand the dockside week (the 1-week Rogues Guild rung) first.' } };
  }
  const vaultAddr = titlesVaultAddr();
  if (!vaultAddr) {
    return { status: 503, body: { ok: false, collection, tokenId: tid.toString(), gated: false, earned: true,
      reason: 'the forge is being lit — the Titles vault is not deployed yet. The gate PASSED; ask the coordinator to deploy it (deploy-ocean-water.cjs WATER_NAME=TITLEw) and set SEAS_TITLES_VAULT.' } };
  }
  const treeId = _forgeDeps ? await _forgeDeps.treeId(vaultAddr, collection, tid) : await forge.treeIdForPawn(provider, vaultAddr, collection, tid);
  const price = forge.FORGE_PRICE_USDC;
  const planted = treeId !== null;
  const steps = planted ? forge.forgeSteps({ vaultAddr, treeId, priceUsdc: price })
    : [ { step: 1, by: 'relayer', target: vaultAddr, method: 'plantTree(address,uint256)', args: { collection, tokenId: tid.toString() }, note: 'the forge-title-keeper relayer registers your pawn first (idempotent; no funds), THEN you approve + deposit.' },
        { step: 2, by: 'buyer', target: forge.USDC, method: 'approve(address,uint256)', args: { spender: vaultAddr, amount: String(price) }, note: 'EXACT approval only — approve precisely the forge price, never MaxUint256.' },
        { step: 3, by: 'buyer', target: vaultAddr, method: 'depositAndWater(uint256,uint256)', args: { treeId: '<assigned by plantTree>', usdcAmount: String(price) }, note: 'LOCKS the principal forever — a permanent endowment; your forged title trickles gold for good.' } ];
  const stipend = _forgeDeps ? await _forgeDeps.stipend(vaultAddr, collection, tid) : await forge.forgedStipendView(provider, vaultAddr, collection, tid);
  return { status: 200, body: { ok: true, collection, tokenId: tid.toString(), owner, earned: true, gated: false, planted,
    titlesVault: vaultAddr, goldToken: forge.GOLD, price: { usdc: String(price), display: (Number(price) / 1e6).toFixed(2) + ' USDC' }, steps, stipend,
    note: 'Forge a magic-ink Rogues Guild title: pay the price, seed a permanent gold-water endowment into your pawn, and hold a forged title that trickles in-game gold to its owner. A prestige artifact — not a financial product.' } };
}

// ── deployment info (best-effort; warns, never silent) ───────────────────────────────────────
function deployInfo() {
  if (!fs.existsSync(DEPLOY_JSON)) {
    console.warn(`[seas] deploy record not found at ${DEPLOY_JSON} (info only)`);
    return null;
  }
  try { return JSON.parse(fs.readFileSync(DEPLOY_JSON, 'utf8')); }
  catch (e) { console.warn(`[seas] could not read deploy record: ${e.message}`); return null; }
}

const ROUTES = [
  'GET  /                  — service info + route list',
  'GET  /seas/health       — liveness + signer/map status',
  'GET  /seas/location?pawn=<coll>:<tid>  — authoritative PAWN location + in-progress voyage (legacy ?player=0x.. still answers)',
  'GET  /seas/dock?port=8003 | ?player=0x..   — DOCKSIDE board: ships "taking on hands" (rowing crews) at a port',
  'GET  /seas/aboard?pawn=<collection>:<tokenId>   — READ-ONLY: which ship a pawn has signed onto (null if none)',
  'POST /seas/sign-on  { player, collection, tokenId, ship } — put an OWNED pawn ABOARD a ship taking hands at YOUR port (403 not there / not owner, 404 unknown ship, 409 not taking hands). Mixed crew ok; job travels with the ship',
  'POST /seas/sign-off { player, collection, tokenId }       — leave the ship (409 if not aboard, 403 if not owner)',
  'POST /seas/forge-title  { player, collection, tokenId } — Rogues Guild gate (1-week rung) -> EXACT forge steps + stipend view',
  'POST /seas/harvest      { player, collection, tokenId, resource } — FREE skill+co-location CATCH (fish/crab/…): co-location gate → skill+live-supply → deterministic catch → on-chain cooldown → signed dispense ticket. 403 not there/not owner, 429 cooling, 503 signer/ground absent. No gold, no gear.',
  'POST /seas/sail         { player, pawn|collection+tokenId, toHex:{q,r} }   — move a PAWN you own on a server-clocked voyage',
  'POST /seas/teleport     { player, pawn|collection+tokenId, toHex, secret? } — INSTANT move: dev-wizard (secret+allowlist) unlimited range; players range-capped (off until shipped)',
  'POST /seas/trade-attest { player, pawn|collection+tokenId, pool } — RULE-GATED attestation: verifies you OWN the pawn AND it is AT the pool (403 if not there / at sea / not owner)',
  'POST /seas/issue-seed   { player, fight, collection?, tokenId? }       — pin a fight RNG seed + nonce (anti-grind); 429 if pawn cooling (cooldown kinds need collection+tokenId)',
  'POST /seas/verify-fight { player, nonce, playerTeam, playerActions }   — REPLAY the engine → authoritative { winner }; starts the server cooldown on a conclusive cooldown-kind run',
  'POST /seas/use-chrono-orb { player, collection, tokenId, action }      — DEBIT 1 server-attributed Chrono Orb → clear a server cooldown (skip the WAIT only; must still RUN+WIN). 402 no orb, 403 not owner, 409 not cooling',
  'GET  /seas/cooldown?collection=0x..&tokenId=..&action=goblin-cave      — server-clock secsLeft for a pawn+action (display truth)',
  'GET  /seas/claims[?all=1]                                              — payout feed: unpaid server-verified wins (keeper reads this)',
  'POST /seas/claims/ack { runId, txHash, secret }                        — mark a claim paid (keeper ack; SEAS_CLAIM_ACK_SECRET-gated)',
  'GET  /seas/bestiary?pawn=<collection>:<tokenId>                        — READ-ONLY personal bestiary (kill counts, earned titles, progress)',
  'GET  /seas/lore?pawn=<collection>:<tokenId>&monster=<monsterId>        — READ-ONLY monster strengths/weaknesses (gated behind the earned achievement)',
];

// ── HTTP layer (built-in http; Express-style handlers) ────────────────────────────────────────
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,    // prod: game origin only (override via SEAS_CORS_ORIGIN)
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

// ── per-IP rate limit (fixed window, in-memory; visible 429, never silent drop) ────────────────
const _rate = new Map(); // ip -> { count, resetAt }
function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = _now();
  let r = _rate.get(ip);
  if (!r || now >= r.resetAt) { r = { count: 0, resetAt: now + RATE_WINDOW_MS }; _rate.set(ip, r); }
  r.count++;
  if (_rate.size > 5000) for (const [k, v] of _rate) if (now >= v.resetAt) _rate.delete(k); // cheap GC
  return r.count > RATE_MAX ? Math.ceil((r.resetAt - now) / 1000) : 0;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new HttpError(413, 'body too large')); req.destroy(); } });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new HttpError(400, `invalid JSON body: ${e.message}`)); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const route = `${req.method} ${u.pathname}`;

  if (req.method === 'OPTIONS') return sendJSON(res, 204, {});

  const retryAfter = rateLimited(req);
  if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); return sendJSON(res, 429, { ok: false, reason: `rate limit — retry in ${retryAfter}s` }); }

  if (route === 'GET /' || route === 'GET /seas') {
    const di = deployInfo();
    return sendJSON(res, 200, {
      service: 'seas-server', chainId: CHAIN_ID, routes: ROUTES,
      mapLoaded: !!MAP, signerAvailable: fs.existsSync(SIGNER_ENV),
      gameSigner: di ? di.gameSigner : null, factory: di ? di.factory : null,
      note: 'STAGED — location authority + rule-gated trade-attestation signer.',
    });
  }

  if (route === 'GET /seas/health') {
    return sendJSON(res, 200, {
      ok: true, mapLoaded: !!MAP, signerAvailable: fs.existsSync(SIGNER_ENV),
      storeFile, now: _now(),
    });
  }

  if (route === 'GET /seas/location') {
    // per-pawn: ?pawn=<collection>:<tokenId>. Legacy ?player=<addr> still answers (wallet-keyed record).
    const pawnParam = u.searchParams.get('pawn');
    const key = pawnParam ? pawnKeyFromStr(pawnParam) : addrKey(normalizeAddr(u.searchParams.get('player')));
    return sendJSON(res, 200, locationView(key));
  }

  if (route === 'POST /seas/sail') {
    const body = await readBody(req);
    const player = normalizeAddr(body.player);
    if (body.pawn || body.collection) {
      const { collection, tokenId, key } = pawnFromBody(body);
      await assertOwns(player, collection, tokenId);     // sail only a pawn you own
      const voyage = doSail(key, body.toHex);
      return sendJSON(res, 200, { ok: true, player, pawn: key, voyage });
    }
    // legacy (pre per-pawn): sail the WALLET's own record. Kept so existing clients don't break.
    const voyage = doSail(addrKey(player), body.toHex);
    return sendJSON(res, 200, { ok: true, player, voyage });
  }

  if (route === 'POST /seas/teleport') {
    const body = await readBody(req);
    const player = normalizeAddr(body.player);
    const { collection, tokenId, key } = pawnFromBody(body);
    await assertOwns(player, collection, tokenId);       // teleport only a pawn you own
    const isAdmin = !!ADMIN_SECRET && body.secret === ADMIN_SECRET && DEVWIZARDS.has(key);
    if (body.secret && !isAdmin) return sendJSON(res, 403, { ok: false, reason: 'dev-wizard teleport: bad secret or pawn not on the dev-wizard allowlist' });
    const view = doTeleport(key, body.toHex, isAdmin);
    return sendJSON(res, 200, { ok: true, player, ...view });
  }

  if (route === 'GET /seas/dock') {
    return sendJSON(res, 200, dockView({ port: u.searchParams.get('port'), player: u.searchParams.get('player') }));
  }

  if (route === 'GET /seas/aboard') {
    return sendJSON(res, 200, aboardView(u.searchParams.get('pawn')));
  }

  if (route === 'POST /seas/sign-on') {
    const body = await readBody(req);
    const r = await signOn(body);
    return sendJSON(res, r.status, r.body);
  }

  if (route === 'POST /seas/sign-off') {
    const body = await readBody(req);
    const r = await signOff(body);
    return sendJSON(res, r.status, r.body);
  }

  if (route === 'POST /seas/trade-attest') {
    const body = await readBody(req);
    if (body.pawn || body.collection) {                   // per-pawn: which pawn's presence authorizes this wallet
      const { collection, tokenId } = pawnFromBody(body);
      const result = await tradeAttest(body.player, collection, tokenId, body.pool);
      return sendJSON(res, result.status, result.body);
    }
    // legacy: attest by WALLET location (no pawn). Kept for backward compat during the per-pawn rollout.
    const result = await tradeAttest(body.player, null, null, body.pool);
    return sendJSON(res, result.status, result.body);
  }

  if (route === 'POST /seas/issue-seed') {
    const body = await readBody(req);
    const out = issueSeed(body.player, body.fight, { collection: body.collection, tokenId: body.tokenId, depth: body.depth });
    return sendJSON(res, out.status, out.body);
  }

  if (route === 'POST /seas/use-chrono-orb') {
    const body = await readBody(req);
    const result = await useChronoOrb(body);
    return sendJSON(res, result.status, result.body);
  }

  if (route === 'GET /seas/claims') {
    // Payout feed: unpaid server-verified wins for the keeper. ?all=1 to include paid ones.
    const st = ensureState();
    const all = u.searchParams.get('all') === '1';
    const list = Object.values(st.claims || {})
      .filter((c) => all || !c.paidTx)
      .map(({ runId, poolAddress, collection, tokenId, serverVerified, prizeLabel, wonAt, paidTx }) =>
        ({ runId, poolAddress, collection, tokenId, serverVerified, prizeLabel, wonAt, paidTx }));
    return sendJSON(res, 200, { ok: true, count: list.length, claims: list });
  }

  if (route === 'POST /seas/claims/ack') {
    // The keeper POSTs { runId, txHash, secret } after an on-chain-confirmed payout so the claim
    // stops showing as unpaid. Gated by a shared secret (env SEAS_CLAIM_ACK_SECRET) — ack only
    // stamps a record, it moves NO funds, but we still don't want open writes.
    const body = await readBody(req);
    if (!process.env.SEAS_CLAIM_ACK_SECRET || body.secret !== process.env.SEAS_CLAIM_ACK_SECRET) {
      return sendJSON(res, 403, { ok: false, reason: 'bad or missing ack secret' });
    }
    const st = ensureState();
    const hit = Object.values(st.claims || {}).find((c) => c.runId === body.runId);
    if (!hit) return sendJSON(res, 404, { ok: false, reason: `no claim ${body.runId}` });
    hit.paidTx = body.txHash || 'acked';
    saveState();
    return sendJSON(res, 200, { ok: true, runId: body.runId, paidTx: hit.paidTx });
  }

  if (route === 'GET /seas/cooldown') {
    // UI helper: how long until this pawn can do `action` again (server clock). Client may MIRROR for
    // display, but THIS is the truth. ?collection=0x..&tokenId=..&action=goblin-cave
    const collection = u.searchParams.get('collection');
    const tokenId = u.searchParams.get('tokenId');
    const action = String(u.searchParams.get('action') || '').trim();
    if (!action) throw new HttpError(400, 'action required (e.g. goblin-cave | bilge-rats-quest)');
    const pawn = pawnKey(collection, tokenId);
    const secsLeft = cooldownLeft(pawn, action);
    return sendJSON(res, 200, { ok: true, pawn, action, secsLeft, ready: secsLeft <= 0 });
  }

  if (route === 'GET /seas/bestiary') {
    // READ-ONLY: the pawn's personal bestiary (kill counts, earned titles, per-monster progress).
    // ?pawn=<collection>:<tokenId>  (the same pawn key issue-seed records). Unknown pawn → empty view.
    const pawn = String(u.searchParams.get('pawn') || '').trim();
    if (!pawn) throw new HttpError(400, 'pawn required (?pawn=<collection>:<tokenId>)');
    const bestiaryMod = requireBestiary();
    const st = ensureState();
    return sendJSON(res, 200, { ok: true, ...bestiaryMod.bestiaryFor(st.bestiary || { pawns: {} }, pawn) });
  }

  if (route === 'GET /seas/lore') {
    // READ-ONLY: the strengths/weaknesses a pawn may READ for one monster (GATED behind the earned
    // achievement — a locked stub with kill progress otherwise). ?pawn=<coll>:<tid>&monster=<monsterId>
    const pawn = String(u.searchParams.get('pawn') || '').trim();
    const monster = String(u.searchParams.get('monster') || '').trim();
    if (!pawn) throw new HttpError(400, 'pawn required (?pawn=<collection>:<tokenId>)');
    if (!monster) throw new HttpError(400, 'monster required (?monster=<monsterId>)');
    const bestiaryMod = requireBestiary();
    const st = ensureState();
    return sendJSON(res, 200, { ok: true, ...bestiaryMod.knownLore(st.bestiary || { pawns: {} }, pawn, monster) });
  }

  if (route === 'POST /seas/forge-title') {
    const body = await readBody(req);
    const result = await forgeTitle(body);
    return sendJSON(res, result.status, result.body);
  }

  if (route === 'POST /seas/verify-fight') {
    const body = await readBody(req);
    const result = verifyFight(body);
    return sendJSON(res, result.status, result.body);
  }

  if (route === 'POST /seas/harvest') {
    const body = await readBody(req);
    const result = await harvestCatch(body);
    return sendJSON(res, result.status, result.body);
  }

  return sendJSON(res, 404, { ok: false, reason: `no route: ${route}`, routes: ROUTES });
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      // No silent catch: every failure is surfaced to the caller AND logged.
      console.error(`[seas] ${req.method} ${req.url} -> ${status}:`, err.message);
      sendJSON(res, status, { ok: false, reason: err.message });
    });
  });
}

async function startServer() {
  await init();
  ensureState(); // fail fast on a corrupt store
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`[seas] listening on http://localhost:${PORT}`);
    console.log(`[seas] store: ${storeFile}`);
    console.log(`[seas] signer key present: ${fs.existsSync(SIGNER_ENV)} (${SIGNER_ENV})`);
    console.log('[seas] routes:\n  ' + ROUTES.join('\n  '));
  });
  return server;
}

// ── selftest helper: play a full bilge fight (both sides AI-piloted off the pinned seed) and record
// the PLAYER's action log + outcome. This is the "client" the verify path consumes. It mirrors
// game.js's turn loop + resolveEncounter's enemy AI (proven replay-identical in resolver-encounter.test.js).
function playBilge(seed, leader, bilge, ci, eng, gc, res) {
  const { strike, planIntent, chooseTarget, resolveOverboard } = ci;
  const { hexDistance, isConscious, isAlive, isUnconscious } = eng;
  const { hexesInRange } = gc;
  const { makeRng } = res;
  // terrain helpers + los come bundled through the resolver's deps; reload the leaf modules:
  const key = (h) => `${h.q},${h.r}`;
  const enemyTeam = bilge.buildBilgeEnemies(seed, [leader.position]);
  const terrain = bilge.bilgeTerrain();
  const ix = new Map(terrain.map((c) => [key(c), c]));
  const cover = (h) => { const c = ix.get(key(h)); return c && c.type === 'cover' ? (c.mod && c.mod.ac) || 2 : 0; };
  const blocked = new Set(); for (const [k, c] of ix) if (c.type === 'wall') blocked.add(k);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const rng = makeRng(seed);
  const units = [{ ...clone(leader), isPlayer: true }, ...clone(enemyTeam).map((u) => ({ ...u, isPlayer: false }))];
  const decided = () => new Set(units.filter(isConscious).map((u) => !!u.isPlayer)).size <= 1;
  const ctx = (u) => {
    const foes = units.filter((e) => isConscious(e) && e.isPlayer !== u.isPlayer);
    const allies = units.filter((e) => isConscious(e) && e.isPlayer === u.isPlayer);
    const occ = (ex) => { const s = new Set(units.filter((x) => isAlive(x) && x !== ex).map((x) => key(x.position))); for (const k of blocked) s.add(k); return s; };
    return { foes, allies, reach: (unit) => hexesInRange(unit.position, unit.movementHexes, occ(unit)), dist: hexDistance,
      actRange: (unit) => unit.attackRange || 1, meleeRange: (unit) => unit.attackRange || 1, ownCaster: null, aoeArea: () => 0, hasLos: () => true };
  };
  const samePos = (a, b) => a && b && a.q === b.q && a.r === b.r;
  const actions = [];
  let turnIdx = 0, round = 1, guard = 0;
  while (!decided() && guard++ < units.length * 64) {
    const u = units[turnIdx];
    if (isConscious(u)) {
      u.hasMoved = false; u.hasActed = false;
      const intent = planIntent(u, ctx(u));
      if (intent && intent.moveTo && !samePos(intent.moveTo, u.position)) { u.position = { ...intent.moveTo }; u.hasMoved = true; if (u.isPlayer) actions.push({ unit: u.id, type: 'move', to: { ...u.position } }); }
      if (isConscious(u)) {
        const foes = units.filter((e) => isConscious(e) && e.isPlayer !== u.isPlayer);
        const target = intent && intent.target && isConscious(intent.target) ? intent.target : chooseTarget(u, foes);
        if (target) { const dist = hexDistance(u.position, target.position);
          if (dist <= (u.attackRange || 1)) { const r = strike(u, target, { distance: dist, coverAC: cover(target.position), rng }); if (r.hit) target.currentHp -= r.damage; if (u.isPlayer) actions.push({ unit: u.id, type: 'attack', target: target.id }); } }
      }
      if (u.isPlayer) actions.push({ unit: u.id, type: 'end' });
      if (decided()) break;
    } else if (isUnconscious(u)) { u.currentHp -= 1; if (decided()) break; }
    turnIdx = (turnIdx + 1) % units.length;
    if (turnIdx === 0) { round++; if (round > 60) break; }
  }
  const sides = new Set(units.filter(isConscious).map((u) => !!u.isPlayer));
  const winner = sides.size === 0 ? 'draw' : sides.size === 1 ? (sides.has(true) ? 'player' : 'enemy') : null;
  return { actions, winner };
}

// ── in-process self-test (mock clock; NO real RPC / NO key needed) ────────────────────────────
async function selftest() {
  await init();
  const tmp = path.join(os.tmpdir(), `seas-selftest-${Date.now()}.json`);
  setStoreFile(tmp);
  let T = 1_000_000_000;
  setNow(() => T);

  const assert = (cond, msg) => { if (!cond) throw new Error('SELFTEST FAIL: ' + msg); console.log('  ok -', msg); };
  const player = '0x0000000000000000000000000000000000000001';
  const m = requireMap();

  try {
    console.log('\n[selftest] map: hub =', m.HUB_PORT, JSON.stringify(hubHex()), '| MS_PER_HEX =', m.MS_PER_HEX);

    // 1) fresh wallet starts docked at the hub
    let loc = locationView(player);
    assert(sameHex(loc.hex, hubHex()), 'fresh wallet starts at hub hex');
    assert(loc.atSea === false && loc.voyage === null, 'fresh wallet not at sea');

    // 2) sail hub -> tortuga_cove (q2,r2)
    const dest = { q: m.PORTS.tortuga_cove.q, r: m.PORTS.tortuga_cove.r };
    const distance = m.hexDistance(hubHex(), dest);
    const voyage = doSail(player, dest);
    console.log(`  sailed hub -> tortuga_cove: distance=${distance} hexes, arriveAt=${voyage.arriveAt}`);
    assert(voyage.distance === distance, 'voyage distance == hexDistance');
    assert(voyage.arriveAt === T + distance * m.MS_PER_HEX, 'arriveAt = now + distance*MS_PER_HEX (server-clocked)');

    // 3) mid-voyage: at sea, secsLeft counts down, hex still hub (position only changes on arrival)
    loc = locationView(player);
    assert(loc.atSea === true, 'mid-voyage: atSea true');
    assert(loc.secsLeft === distance * (m.MS_PER_HEX / 1000), `mid-voyage: secsLeft == ${distance * (m.MS_PER_HEX / 1000)}s`);
    assert(sameHex(loc.hex, hubHex()), 'mid-voyage: authoritative hex still hub (not teleported)');

    // 4) RULE GATE refuses while at sea (pool keyed to the destination, 2002)
    let g = evaluateTradeGate(resolveArrival(player), encodeLoc(dest));
    assert(g.ok === false && /at sea/.test(g.reason), 'gate REFUSES at sea: ' + g.reason);

    // 5) cannot start a second voyage while at sea
    let threw = false;
    try { doSail(player, { q: m.PORTS.saltmarsh.q, r: m.PORTS.saltmarsh.r }); } catch (e) { threw = /already at sea/.test(e.message); }
    assert(threw, 'sail rejected while already at sea');

    // 6) advance the server clock past arrival -> lands at tortuga_cove
    T += distance * m.MS_PER_HEX;
    loc = locationView(player);
    assert(sameHex(loc.hex, dest), 'after arrival: authoritative hex == destination (tortuga_cove)');
    assert(loc.port === 'tortuga_cove', 'after arrival: docked at tortuga_cove');
    assert(loc.atSea === false && loc.voyage === null, 'after arrival: voyage cleared');

    // 7) RULE GATE now ALLOWS the tortuga pool (2002), and REFUSES a different pool (port_royal)
    g = evaluateTradeGate(resolveArrival(player), 2002);
    assert(g.ok === true, 'gate ALLOWS pool at current location (2002)');
    const elsewhere = encodeLoc(hubHex()); // port_royal
    g = evaluateTradeGate(resolveArrival(player), elsewhere);
    assert(g.ok === false && /not at this pool/.test(g.reason), 'gate REFUSES pool at a different location: ' + g.reason);

    // 8) encode/decode round-trip sanity
    assert(encodeLoc({ q: 2, r: 2 }) === 2002, 'encodeLoc(2,2) == 2002');
    const d = decodeLoc(2002); assert(d.q === 2 && d.r === 2, 'decodeLoc(2002) == {2,2}');

    // 8b) TELEPORT — dev-wizard (admin) jumps instantly at unlimited range; a player-tier teleport is
    //     refused (range cap 0 by default = not shipped). Presence still gates trade afterward.
    const prHex = { q: m.PORTS.port_royal.q, r: m.PORTS.port_royal.r };
    const tp = doTeleport(player, prHex, true); // admin tier
    assert(sameHex(tp.hex, prHex) && tp.atSea === false && tp.teleported === true, 'admin teleport lands instantly at target (unlimited range)');
    assert(evaluateTradeGate(resolveArrival(player), encodeLoc(prHex)).ok === true, 'trade gate ALLOWS at the teleported-to location (8003)');
    let tpThrew = false;
    try { doTeleport(player, { q: m.PORTS.saltmarsh.q, r: m.PORTS.saltmarsh.r }, false); }
    catch (e) { tpThrew = /not yet available|out of range/.test(e.message); }
    assert(tpThrew, 'player-tier teleport refused (range cap 0 = not shipped)');

    // 9) COMBAT SETTLEMENT — issue-seed pins a server-random seed; verify-fight replays the engine
    console.log('\n[selftest] combat settlement (issue-seed + verify-fight):');
    const iss = issueSeed(player, 'bilge-rats').body; // issueSeed now returns { status, body }; arena is NOT cooldown-gated
    assert(typeof iss.seed === 'string' && iss.seed.startsWith('seas-bilge-rats-') && iss.seed.length > 30, 'issue-seed returns a long server-random seed');
    assert(typeof iss.nonce === 'string' && iss.nonce.length >= 16, 'issue-seed returns a nonce');
    const iss2 = issueSeed(player, 'bilge-rats').body;
    assert(iss2.seed !== iss.seed && iss2.nonce !== iss.nonce, 'each issue-seed is unique (anti-grind: client cannot pre-roll)');
    let threwIss = false; try { issueSeed(player, 'no-such-fight'); } catch (e) { threwIss = /unknown fight/.test(e.message); }
    assert(threwIss, 'issue-seed rejects an unknown fight kind');

    // reconstruct the rats the server pinned, build a strong leader, and PLAY the fight to a real win
    const { bilge, resolveEncounter: rE, SPELLS } = requireCombat();
    const bgUnits = await import(pathToFileURL(path.join(__dirname, '..', 'seas', 'battle-grid', 'units.js')).href);
    const ci = await import(pathToFileURL(path.join(__dirname, '..', 'seas', 'battle-grid', 'combat-helpers.js')).href);
    const eng = await import(pathToFileURL(path.join(__dirname, '..', 'seas', 'battle-grid', 'tot-engine.js')).href);
    const gc = await import(pathToFileURL(path.join(__dirname, '..', 'seas', 'battle-grid', 'grid-config.js')).href);
    const res = await import(pathToFileURL(path.join(__dirname, '..', 'seas', 'battle-grid', 'resolver.js')).href);
    gc.setGrid(bilge.SQUAD_GRID.cols, bilge.SQUAD_GRID.rows);
    const leader = bgUnits.buildUnit({ id: 'LEADER', isPlayer: true, name: 'Captain', emoji: '🦜', endowment: { burgers: 40 }, role: 'melee', position: { q: 1, r: 4 } });
    // CLIENT-side play (AI-pilot both sides off the pinned seed; record the player's actions) — the
    // exact flow resolver-encounter.test.js proves replay-identical; here it produces a real win log.
    const playLog = playBilge(iss.seed, leader, bilge, ci, eng, gc, res);
    const v = verifyFight({ player, nonce: iss.nonce, playerTeam: [leader], playerActions: playLog.actions });
    assert(v.status === 200 && v.body.ok, 'verify-fight returns 200 ok');
    assert(v.body.winner === playLog.winner, `verify-fight winner (${v.body.winner}) == the client's outcome (${playLog.winner})`);
    assert(v.body.winner === 'player' && v.body.payoutEligible === true, 'a server-verified player win is payout-eligible (the keeper gate)');

    // ROLL-CHART: a verified WIN carries a server-authoritative roll + prize naming the numbered pool.
    assert(v.body.roll && typeof v.body.roll.roll === 'number', 'a verified WIN carries a roll-chart result');
    assert(v.body.roll.dice === 'd6' && v.body.roll.roll >= 1 && v.body.roll.roll <= 6, 'bilge-rats rolls a d6 in [1..6]');
    assert(Array.isArray(v.body.roll.fires) && v.body.roll.fires.length === 1, 'bilge-rats single-fires exactly ONE pool (launch: fires=1)');
    // Founder 2026-07-01: every win now draws 1-of-6 across ALL 6 shared pools (was always pool 1).
    // So a bilge win names SOME numbered pool 1..6 whose address is one of the 6 VERIFIED live pools.
    {
      const LIVE_POOL_ADDRS = Object.values(rollCharts.POOLS).map((p) => p.address);
      assert(v.body.prize && v.body.prize.poolId >= 1 && v.body.prize.poolId <= 6 && LIVE_POOL_ADDRS.includes(v.body.prize.poolAddress),
        'bilge-rats prize = one of the 6 numbered LootPools (verified address, 1-of-6 draw)');
    }
    assert(!/spin|jackpot|odds|wager|gamble|\bbet\b/i.test(JSON.stringify(v.body.roll)), 'roll framing uses NO gambling language (compliance hard line)');
    // DETERMINISTIC-PER-SEED: rolling the SAME seed yields the IDENTICAL pool (un-re-rollable).
    const _reroll = rollCharts.resolveRoll('bilge-rats', iss.seed, rollHash);
    assert(_reroll.fires[0].poolId === v.body.prize.poolId, 'the roll is DETERMINISTIC per server-pinned seed (same seed → same prize)');
    // anti double-claim: the SAME nonce can't be verified twice
    const v2 = verifyFight({ player, nonce: iss.nonce, playerTeam: [leader], playerActions: playLog.actions });
    assert(v2.status === 409, 'a verified fight nonce cannot be re-verified (no double-claim)');
    // unknown nonce → 404; wrong wallet → 403
    assert(verifyFight({ player, nonce: 'deadbeef', playerTeam: [leader], playerActions: [] }).status === 404, 'unknown nonce → 404');
    const other = '0x0000000000000000000000000000000000000002';
    assert(verifyFight({ player: other, nonce: iss2.nonce, playerTeam: [leader], playerActions: [] }).status === 403, 'a nonce issued to another wallet → 403');
    // an inconclusive (too-short) log is NOT a win and does NOT consume the nonce
    const vShort = verifyFight({ player, nonce: iss2.nonce, playerTeam: [leader], playerActions: [{ unit: 'LEADER', type: 'end' }] });
    assert(vShort.body.winner !== 'player' && vShort.body.exhausted === true, 'a too-short log is inconclusive (not a win)');
    assert(verifyFight({ player, nonce: iss2.nonce, playerTeam: [leader], playerActions: [{ unit: 'LEADER', type: 'end' }] }).status === 200, 'an inconclusive nonce is still resubmittable (not consumed)');

    // GOBLIN CAVE — now MIGRATED to the server cooldown (was localStorage). It is cooldown-gated, so
    // issue-seed REQUIRES the pawn (collection+tokenId) + gates on the server clock. Prove the dispatch
    // still reconstructs GOBLINS (not rats). DEP-FREE: reuses the already-imported battle-grid modules.
    const GCOLL = '0x9500880DEC9B310b4a728C75A271a25615A2443E';
    let gThrew = false;
    try { issueSeed(player, 'goblin-cave'); } catch (e) { gThrew = /cooldown-gated — pass/.test(e.message); }
    assert(gThrew, 'goblin-cave issue-seed REFUSES without a pawn (it is server-cooldown-gated now)');
    const gIssR = issueSeed(player, 'goblin-cave', { collection: GCOLL, tokenId: '5' });
    assert(gIssR.status === 200, 'goblin-cave issue-seed with a fresh pawn → 200 (not on cooldown)');
    const gIss = gIssR.body;
    assert(typeof gIss.seed === 'string' && gIss.seed.startsWith('seas-goblin-cave-') && gIss.fight === 'goblin-cave', 'issue-seed accepts goblin-cave + tags the seed');
    const { goblin } = requireCombat();
    const gEnemies = goblin.buildGoblinEnemies(gIss.seed, [leader.position]);
    assert(Array.isArray(gEnemies) && gEnemies.length >= 1, 'goblin-cave reconstructs a goblin squad from the pinned seed');
    const gVerify = verifyFight({ player, nonce: gIss.nonce, playerTeam: [{ ...leader }], playerActions: [{ unit: 'LEADER', type: 'end' }] });
    assert(gVerify.status === 200 && gVerify.body.fight === 'goblin-cave' && gVerify.body.enemies === gEnemies.length,
      `verify-fight resolves the goblin-cave kind (rebuilt ${gVerify.body.enemies} goblins)`);

    // ── SERVER-AUTHORITATIVE UNIVERSAL EATING ─────────────────────────────────────────────────
    // Prove (a) the shared upkeep core is wired, (b) an UNFED pawn's authoritative verdict is WEAKER
    // than a FED pawn's on the SAME seed (the referee clamps the client team), (c) eating restores it.
    console.log('\n[selftest] server-authoritative universal eating:');
    const { upkeep } = requireCombat();
    assert(typeof upkeep.eatBatch === 'function' && typeof upkeep.starvationPenaltyFrom === 'function',
      'upkeep.js pure core is wired into the COMBAT bundle (eatBatch / starvationPenaltyFrom)');

    // a STR-build leader so the −1/day debuff visibly moves the fight. Cooldown-gated kind carries a pawn.
    const ECOLL = '0x9500880DEC9B310b4a728C75A271a25615A2443E';
    const eatPawn = { collection: ECOLL, tokenId: '42' };
    const eatKey = pawnKey(eatPawn.collection, eatPawn.tokenId);
    const eatLeader = () => bgUnits.buildUnit({ id: 'LEADER', isPlayer: true, name: 'Captain', emoji: '🦜', endowment: { burgers: 40, egp: 20 }, role: 'melee', position: { q: 1, r: 4 } });

    // (i) penalty math from the SERVER store: stock food, advance time, confirm batched cheapest-first eat.
    grantFood(eatKey, 'rations', 1); grantFood(eatKey, 'wine', 3);  // 1 staple + 3 gourmet in ship stores
    let baseNow = _now();
    serverAutoEat(eatKey, baseNow);                                  // first touch: fedUntil 0 → eats to catch up
    assert(serverStarvePenalty(eatKey, baseNow) === 0, 'after eating, a stocked pawn is fed → penalty 0');

    // (ii) starve it 3 days with the staple gone (only gourmet left, eaten last): drain to force hunger.
    //      Burn the stores so the next catch-up can't fully cover → a real penalty accrues.
    serverRations()[eatKey].foodInv = {};                           // empty the stores (consumed/none left)
    serverRations()[eatKey].fedUntil = baseNow - 3 * upkeep.DAY_MS;  // 3 days behind, nothing to eat
    saveState();
    const starveNow = baseNow;
    serverAutoEat(eatKey, starveNow);                               // nothing to eat → stays 3 days hungry
    const pen = serverStarvePenalty(eatKey, starveNow);
    assert(pen === -3, `an unfed-3-days pawn carries a −3 all-stats penalty (got ${pen})`);

    // (iii) AUTHORITATIVE verdict comparison on the SAME pinned seed: fed leader vs starved leader.
    //       Build a fed reference team + the starved clamp; the clamped team must have LOWER stats.
    const fedTeam = [eatLeader()];
    const clamped = starveTeam([eatLeader()], pen);
    assert(clamped[0].stats.attack === Math.max(1, fedTeam[0].stats.attack - 3), 'starveTeam lowers attack by |pen| (server clamp)');
    assert(clamped[0].stats.atkBonus < fedTeam[0].stats.atkBonus && clamped[0].stats.ac < fedTeam[0].stats.ac, 'starved team: to-hit + AC drop');
    assert(clamped[0].maxHp === Math.max(1, fedTeam[0].maxHp - 3), 'starved team: HP drops by |pen|');
    assert(starveTeam(fedTeam, 0) === fedTeam, 'pen 0 → starveTeam is a byte-identical no-op (backward-compat)');

    // (iv) end-to-end through verify-fight: issue pins the penalty, verify CLAMPS the client team. A
    //      pawn with stocked food → starve 0 in the response (fed); a hungry pawn → starve < 0.
    grantFood(eatKey, 'rations', 5); serverRations()[eatKey].fedUntil = _now() + upkeep.DAY_MS; saveState(); // fed
    clearCooldown(eatKey, 'goblin-cave');
    const fedIss = issueSeed(player, 'goblin-cave', eatPawn);
    assert(fedIss.status === 200, 'fed pawn can enter');
    const fedV = verifyFight({ player, nonce: fedIss.body.nonce, playerTeam: [eatLeader()], playerActions: [{ unit: 'LEADER', type: 'end' }] });
    assert(fedV.status === 200 && (Number(fedV.body.starve) || 0) === 0, 'a FED pawn verify carries starve 0 (additive field, no debuff)');

    clearCooldown(eatKey, 'goblin-cave');
    serverRations()[eatKey].foodInv = {}; serverRations()[eatKey].fedUntil = _now() - 2 * upkeep.DAY_MS; saveState(); // 2 days hungry, no food
    const hungryIss = issueSeed(player, 'goblin-cave', eatPawn);
    assert(hungryIss.status === 200, 'hungry pawn can still enter (universal eating weakens, never blocks)');
    const hungryV = verifyFight({ player, nonce: hungryIss.body.nonce, playerTeam: [eatLeader()], playerActions: [{ unit: 'LEADER', type: 'end' }] });
    assert(hungryV.status === 200 && hungryV.body.starve === -2, 'a 2-days-hungry pawn verify carries starve −2 (server-authoritative)');
    clearCooldown(eatKey, 'goblin-cave');

    // SERVER-AUTHORITATIVE COOLDOWN SYSTEM (the reusable spine) — direct helper tests.
    console.log('\n[selftest] server-authoritative cooldown system:');
    const cdPawn = pawnKey(GCOLL, '5');
    assert(cdPawn === GCOLL.toLowerCase() + ':5', 'pawnKey == collection.toLowerCase():tokenId');
    assert(cooldownLeft(cdPawn, 'goblin-cave') === 0, 'fresh pawn: cooldownLeft == 0 (ready)');
    startCooldown(cdPawn, 'goblin-cave', 3600);
    assert(cooldownLeft(cdPawn, 'goblin-cave') === 3600, 'startCooldown(3600) → cooldownLeft == 3600s (server clock)');
    assert(cooldownLeft(cdPawn, 'bilge-rats-quest') === 0, 'cooldowns are keyed per (pawn, action) — a different action is unaffected');
    assert(cooldownLeft(pawnKey(GCOLL, '6'), 'goblin-cave') === 0, 'cooldowns are per-pawn — a different tokenId is unaffected');
    const cooling = issueSeed(player, 'goblin-cave', { collection: GCOLL, tokenId: '5' });
    assert(cooling.status === 429 && cooling.body.secsLeft === 3600, 'a cooling pawn → issue-seed 429 { secsLeft } (SERVER is the gate)');
    T += 1800 * 1000;
    assert(cooldownLeft(cdPawn, 'goblin-cave') === 1800, 'after 1800s the cooldown has drained to 1800s (server clock is the truth)');
    assert(clearCooldown(cdPawn, 'goblin-cave') === true && cooldownLeft(cdPawn, 'goblin-cave') === 0, 'clearCooldown frees the pawn (cooldownLeft → 0)');
    assert(clearCooldown(cdPawn, 'goblin-cave') === false, 'clearCooldown on an already-clear (pawn,action) → false (no-op)');
    startCooldown(cdPawn, 'goblin-cave', 7200);
    state = null; // force a reload from disk
    assert(cooldownLeft(cdPawn, 'goblin-cave') === 7200, 'cooldown PERSISTS across a state reload (durable authority, not memory)');
    clearCooldown(cdPawn, 'goblin-cave');

    // NEW BILGE RATS QUEST — born SERVER-GATED (1h server cooldown), reuses the hardened bilge engine.
    console.log('\n[selftest] NEW bilge-rats-quest (server-gated, orb-skippable):');
    const qPawn = { collection: GCOLL, tokenId: '7' };
    const qKey = pawnKey(qPawn.collection, qPawn.tokenId);
    let qThrew = false;
    try { issueSeed(player, 'bilge-rats-quest'); } catch (e) { qThrew = /cooldown-gated — pass/.test(e.message); }
    assert(qThrew, 'bilge-rats-quest issue-seed REFUSES without a pawn (server-cooldown-gated, NOT an on-chain LootPool gate)');
    const qIssR = issueSeed(player, 'bilge-rats-quest', qPawn);
    assert(qIssR.status === 200 && qIssR.body.seed.startsWith('seas-bilge-rats-quest-'), 'bilge-rats-quest issue-seed → 200, seed tagged with the kind');
    const qIss = qIssR.body;
    const qPlay = playBilge(qIss.seed, { ...leader }, bilge, ci, eng, gc, res);
    const qV = verifyFight({ player, nonce: qIss.nonce, playerTeam: [{ ...leader }], playerActions: qPlay.actions });
    assert(qV.status === 200 && qV.body.fight === 'bilge-rats-quest', 'verify-fight resolves the new bilge-rats-quest kind (reuses the bilge engine)');
    assert(qV.body.winner === 'player' && qV.body.payoutEligible === true, 'a server-verified quest WIN is payout-eligible (skill-based, must win)');
    assert(qV.body.cooldownSecs === 3600 && qV.body.cooldownUntil > 0, 'a conclusive quest run STARTS the 1h server cooldown for the pawn');
    assert(cooldownLeft(qKey, 'bilge-rats-quest') === 3600, 'after the win the pawn is cooling (cooldownLeft == 3600s)');
    const qReenter = issueSeed(player, 'bilge-rats-quest', qPawn);
    assert(qReenter.status === 429 && qReenter.body.secsLeft === 3600, 're-entry while cooling → 429 (the quest cannot be ground)');

    // UNIFIED CHRONO-ORB SKIP — debit 1 orb → clear a server cooldown; real-or-nothing; skips WAIT only.
    console.log('\n[selftest] unified chrono-orb skip (/seas/use-chrono-orb):');
    const orbState = { owner: player, onchain: 0 };
    setOrbDeps({ ownerOf: async () => orbState.owner, readOnchainOrbs: async () => orbState.onchain });
    const stranger = '0x0000000000000000000000000000000000000099';
    let o = await useChronoOrb({ player: stranger, collection: GCOLL, tokenId: '7', action: 'bilge-rats-quest' });
    assert(o.status === 403 && /not owned by the connected wallet/.test(o.body.reason), 'orb-skip REFUSES a pawn the caller does not own → 403');
    o = await useChronoOrb({ player, collection: GCOLL, tokenId: '7', action: 'no-such-action' });
    assert(o.status === 400 && /unknown skippable action/.test(o.body.reason), 'orb-skip rejects an unknown action → 400');
    setOrbBalance(player, 0); orbState.onchain = 0;
    o = await useChronoOrb({ player, collection: GCOLL, tokenId: '7', action: 'bilge-rats-quest' });
    assert(o.status === 402 && o.body.orbs === 0, 'no orb → 402 with a clear reason (real-or-nothing: no free skip)');
    assert(cooldownLeft(qKey, 'bilge-rats-quest') === 3600, 'a failed (no-orb) skip leaves the cooldown UNTOUCHED');
    orbState.onchain = 2;
    o = await useChronoOrb({ player, collection: GCOLL, tokenId: '7', action: 'bilge-rats-quest' });
    assert(o.status === 200 && o.body.skipped === true && o.body.cleared === true, 'orb-skip with a balance → 200, cooldown cleared');
    assert(o.body.orbsLeft === 1, 'exactly ONE orb debited (2 reconciled in → 1 left)');
    assert(cooldownLeft(qKey, 'bilge-rats-quest') === 0, 'after the orb skip the pawn is READY again (the WAIT is skipped)');
    assert(/still have to RUN and WIN|No win or prize was bought/.test(o.body.note), 'orb-skip note states the guardrail: WAIT only, no win/prize bought');
    const qAfter = issueSeed(player, 'bilge-rats-quest', qPawn);
    assert(qAfter.status === 200, 'after the skip the pawn may ENTER again (but must still play + win for any reward)');
    clearCooldown(qKey, 'bilge-rats-quest');
    o = await useChronoOrb({ player, collection: GCOLL, tokenId: '7', action: 'bilge-rats-quest' });
    assert(o.status === 409 && /not on cooldown/.test(o.body.reason), 'skipping a ready pawn → 409 (no orb wasted)');
    assert(getOrbBalance(player) === 1, 'a refused skip does NOT debit an orb (still 1)');
    setOrbDeps(null);

    // ── DOCKSIDE SIGN-ON + MIXED-CREW ROWING (founder 2026-07-06) ──────────────────────────────
    console.log('\n[selftest] dockside sign-on + mixed-crew rowing:');
    const dockP = '0x0000000000000000000000000000000000000042';   // fresh wallet → starts at the hub (8003)
    const dv = dockView({ player: dockP });
    assert(dv.ok && dv.port === 8003 && !dv.atSea, 'dock board reads the fresh wallet at Port Royal (8003)');
    assert(dv.ships.length === rowableShips().length && dv.ships.length === 4, 'all 4 rowable ships are docked + taking hands at Port Royal');
    assert(dv.ships.every((r) => r.jobs.includes('row') && /^0x[0-9a-fA-F]{40}$/.test(r.rowVault)), 'each dock row offers the row job + names a real rowVault');
    const targetShip = rowableShips()[0];                          // The Black Tide
    const mixedColl = '0x8C1f935F6DbB17d593BF3EC8114A2f045e350545'; // a Harbor Guard pawn (NON-crew of Black Tide → mixed crew)
    // unknown ship → 404
    setOrbDeps({ ownerOf: async () => dockP });                    // readPawnOwner returns the caller (owned)
    let soUnk = await signOn({ player: dockP, collection: mixedColl, tokenId: '8', ship: 'Ghost Galleon' });
    assert(soUnk.status === 404 && /unknown ship/.test(soUnk.body.reason), 'sign-on REFUSES an unknown ship → 404');
    // owned + at the ship's port → 200 aboard (mixed crew)
    let so = await signOn({ player: dockP, collection: mixedColl, tokenId: '3', ship: targetShip.name });
    assert(so.status === 200 && so.body.ok && so.body.aboard.ship === targetShip.name, `mixed-crew sign-on at the port → aboard ${targetShip.name}`);
    assert(so.body.ownCrew === false, 'a Harbor Guard pawn signing onto the Black Tide is flagged mixed-crew (ownCrew=false)');
    const av = aboardView(`${mixedColl}:3`);
    assert(av.aboard && av.aboard.ship === targetShip.name && av.aboard.rowVault === targetShip.rowVault, 'aboard view reflects the sign-on (row.js reads this to allow a mixed-crew clock-in)');
    // a pawn the caller does NOT own → 403 (no aboard record written)
    setOrbDeps({ ownerOf: async () => '0x0000000000000000000000000000000000000099' });
    let soBad = await signOn({ player: dockP, collection: mixedColl, tokenId: '4', ship: targetShip.name });
    assert(soBad.status === 403 && /not owned/.test(soBad.body.reason), 'sign-on REFUSES a pawn the caller does not own → 403');
    assert(aboardView(`${mixedColl}:4`).aboard === null, 'a refused (not-owner) sign-on writes NO aboard record');
    // sail the wallet away from Port Royal → sign-on REFUSES (not at the ship's port)
    setOrbDeps({ ownerOf: async () => dockP });
    const away = { q: m.PORTS.tortuga_cove.q, r: m.PORTS.tortuga_cove.r };
    doSail(dockP, away); T += m.hexDistance(hubHex(), away) * m.MS_PER_HEX; // land at tortuga_cove (2002)
    let soAway = await signOn({ player: dockP, collection: mixedColl, tokenId: '8', ship: targetShip.name });
    assert(soAway.status === 403 && /not at/.test(soAway.body.reason), "sign-on REFUSES when the wallet is not at the ship's port → 403 (location authority)");
    // the ALREADY-aboard pawn (#3) stays aboard even though the wallet moved ("location moves" — the job travels)
    assert(aboardView(`${mixedColl}:3`).aboard.ship === targetShip.name, 'an already-aboard pawn stays aboard after the wallet sails away (the row job travels with the ship)');
    // sign-off (ownership only; can leave from anywhere)
    let sf = await signOff({ player: dockP, collection: mixedColl, tokenId: '3' });
    assert(sf.status === 200 && sf.body.signedOff && sf.body.wasAboard === targetShip.name, 'sign-off removes the aboard record');
    assert(aboardView(`${mixedColl}:3`).aboard === null, 'after sign-off the pawn is no longer aboard');
    let sf2 = await signOff({ player: dockP, collection: mixedColl, tokenId: '3' });
    assert(sf2.status === 409 && /not signed on/.test(sf2.body.reason), 'sign-off a pawn that is not aboard → 409');
    setOrbDeps(null);

    console.log('\n[selftest] ALL PASSED');
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    if (fs.existsSync(tmp + '.tmp')) fs.unlinkSync(tmp + '.tmp');
  }
}

module.exports = {
  // lifecycle
  init, startServer, createServer, setStoreFile, setNow,
  // authority (per-pawn)
  getLoc, resolveArrival, locationView, doSail, doTeleport, atSea,
  // gate + chain
  evaluateTradeGate, readPoolLocation, tradeAttest,
  // dockside sign-on + mixed-crew rowing
  shipByName, rowableShips, shipPos, shipsDockedAt, aboardRec, dockView, aboardView, signOn, signOff,
  // server-authoritative cooldown system (the reusable spine)
  pawnKey, cooldownLeft, startCooldown, clearCooldown,
  // unified chrono-orb skip
  useChronoOrb, getOrbBalance, setOrbBalance, orbTokenAddr, readOnchainOrbs, setOrbDeps,
  // server-authoritative universal eating (shared upkeep core)
  serverRations, rationRec, grantFood, serverAutoEat, serverStarvePenalty, debitFightRation, starveTeam,
  // combat settlement
  issueSeed, verifyFight,
  // helpers
  encodeLoc, decodeLoc, portAtHex, locationName, hubHex,
};

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--selftest') {
    selftest().catch((e) => { console.error(e.message || e); process.exit(1); });
  } else {
    startServer().catch((e) => { console.error('[seas] failed to start:', e.message || e); process.exit(1); });
  }
}
