// @ts-check
'use strict';
/**
 * seas-api.js — thin client for the SERVER-AUTHORITATIVE seas-server (the rules engine).
 *
 * The First Citizen is RULES-SUBJECT: it does not set its own location or fake presence. It asks
 * the server where it is, sails on the server clock, and requests a presence attestation before a
 * location-gated trade. We GO THROUGH the gate — never around it. If an endpoint is missing or the
 * signer key isn't on the host (it lives on the VPS), we surface the real status; we never fake ok.
 *
 *   Base URL: prod = https://tasern.quest/seas-api (nginx) ; local = http://localhost:8799
 *   override with SEAS_API_BASE. Server routes are under /seas/*.
 */
const BASE = (process.env.SEAS_API_BASE || 'http://localhost:8799').replace(/\/$/, '');

async function call(method, route, body) {
  const url = `${BASE}/seas/${route}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // Connection failure is REAL information (server down / wrong base) — surface it, don't fake.
    return { ok: false, transport: 'unreachable', url, error: e.message };
  }
  let json;
  try { json = await res.json(); } catch { json = { ok: false, error: 'non-JSON response' }; }
  return { httpStatus: res.status, url, ...json };
}

/** Authoritative location + any in-progress voyage for a wallet. */
const location = (player) => call('GET', `location?player=${encodeURIComponent(player)}`);

/** Begin a server-clocked voyage to hex {q,r}. Travel takes REAL time (no shortcutting). */
const sail = (player, q, r) => call('POST', 'sail', { player, toHex: { q: Number(q), r: Number(r) } });

/** RULE-GATED presence attestation for a LocationPool. 403 if not there / at sea; 503 if signer absent. */
const tradeAttest = (player, pool) => call('POST', 'trade-attest', { player, pool });

/**
 * Pin a fight's RNG seed + nonce (anti-grind). For SERVER-COOLDOWN-GATED kinds (goblin-cave,
 * bilge-rats-quest) pass the pawn (collection + tokenId) — the server 429s a cooling pawn (the gate
 * that replaced the trickable client localStorage). The original `bilge-rats` arena takes no pawn.
 * @param {string} player
 * @param {string} fight
 * @param {{ collection?:string, tokenId?:string|number }} [pawn]
 */
const issueSeed = (player, fight, pawn = {}) =>
  call('POST', 'issue-seed', { player, fight, collection: pawn.collection, tokenId: pawn.tokenId });

/** Server-replay referee verdict for a played fight. Starts the server cooldown on a conclusive run. */
const verifyFight = (payload) => call('POST', 'verify-fight', payload);

/**
 * SKIP a server cooldown by debiting 1 CHRONO ORB (server-attributed, tamper-proof). The server verifies
 * you OWN the pawn + hold >=1 orb, DEBITs 1, then clears the (pawn, action) cooldown. Real-or-nothing:
 * 402 no orb, 403 not owner, 409 not on cooldown. The orb buys the WAIT only — you must still RUN + WIN.
 * @param {string} player  @param {string} collection  @param {string|number} tokenId  @param {string} action
 */
const useChronoOrb = (player, collection, tokenId, action) =>
  call('POST', 'use-chrono-orb', { player, collection, tokenId, action });

/** Server-clock seconds left until a pawn can do `action` again (display truth; 0 = ready). */
const cooldown = (collection, tokenId, action) =>
  call('GET', `cooldown?collection=${encodeURIComponent(collection)}&tokenId=${encodeURIComponent(tokenId)}&action=${encodeURIComponent(action)}`);

/**
 * RULE-GATED skill+flow CATCH authorization for a HarvestGround. The server verifies co-location, reads
 * the pawn's skill + the standing flow-supply, computes the deterministic catch, and returns a signed
 * { authorization } to pass to HarvestGround.dispense. 403 if not at the grounds; 429 cooldown; 503 if
 * the ground/signer isn't deployed. Never fakes ok. Input: { player, collection, tokenId, resource, location? }.
 */
const harvest = (player, collection, tokenId, resource, location) =>
  call('POST', 'harvest', { player, collection, tokenId, resource, location });

// ── dockside sign-on (rowing / taking-on-hands board) ───────────────────────────────────────────
/** Ships "taking on hands" at a port. Pass a locId (?port=) OR a player addr (uses their hex). */
const dock = ({ port, player } = {}) => {
  const qs = port !== undefined && port !== null && `${port}` !== ''
    ? `port=${encodeURIComponent(port)}`
    : (player ? `player=${encodeURIComponent(player)}` : '');
  return call('GET', `dock${qs ? `?${qs}` : ''}`);
};

/** Read a pawn's ABOARD record (which ship it signed onto, or null). ?pawn=<collection>:<tokenId>. */
const aboard = (collection, tokenId) =>
  call('GET', `aboard?pawn=${encodeURIComponent(`${collection}:${tokenId}`)}`);

/** Put an owned pawn ABOARD a ship taking hands at the player's current port. 403 not there / not owner. */
const signOn = (player, collection, tokenId, ship) =>
  call('POST', 'sign-on', { player, collection, tokenId, ship });

/** Take an owned pawn off its ship (leave the crew job). 409 if not aboard; 403 if not owner. */
const signOff = (player, collection, tokenId) =>
  call('POST', 'sign-off', { player, collection, tokenId });

// ── terrain (for location-gated jobs like crabbing) ─────────────────────────────────────────────
// The seas-server is the location AUTHORITY (it gives the wallet's hex), but terrain is derived from
// the shared map module game/lib/location.js (getTerrain(q,r) — REGION_TERRAIN says Bonewater Atolls
// is 'beach'). location.js is ESM, so we dynamic-import it once. Read-only, no chain, no network.
let _mapMod = null;
async function mapModule() {
  if (_mapMod) return _mapMod;
  const path = require('path');
  const { pathToFileURL } = require('url');
  const p = path.join(__dirname, '..', '..', '..', 'lib', 'location.js'); // game/lib/location.js
  _mapMod = await import(pathToFileURL(p).href);
  if (typeof _mapMod.getTerrain !== 'function') throw new Error('game/lib/location.js did not export getTerrain');
  return _mapMod;
}

/**
 * A friendly LABEL for a server location view — "Port Royal (8,3) [8003]" / "open water (1,0) [1000]".
 * Fixes the compass bug where an open-water hex (port:null) rendered as null. If the server was
 * unreachable (no hex), say so honestly rather than inventing a place. Uses the shared map's canonical
 * locationLabel (same rule the seas-server uses). Read-only.
 * @param {object} loc  a /seas/location response ({ hex, location, port } or an unreachable envelope)
 * @returns {Promise<string>}
 */
async function describeLocation(loc) {
  if (!loc || (loc.transport === 'unreachable')) return 'unknown (seas-server unreachable)';
  if (!loc.hex || typeof loc.hex.q !== 'number') return 'unknown (no location from server)';
  const m = await mapModule();
  return m.locationLabel(loc);
}

/**
 * Terrain of a hex {q,r} via the shared map (e.g. 'beach','forest','sea','plains'). Read-only.
 * @returns {Promise<string>}
 */
async function terrainAt(q, r) {
  const m = await mapModule();
  return m.getTerrain(Number(q), Number(r));
}

/**
 * Server-authoritative location of a wallet PLUS the derived terrain of its current hex. Used by
 * location-gated jobs (crabbing needs 'beach'). Returns the raw location view + { terrain }.
 * @returns {Promise<object>}
 */
async function locationWithTerrain(player) {
  const loc = await location(player);
  if (!loc || !loc.hex || typeof loc.hex.q !== 'number') return { ...loc, terrain: null };
  let terrain = null;
  try { terrain = await terrainAt(loc.hex.q, loc.hex.r); }
  catch (e) { terrain = null; loc.terrainError = e.message; } // surfaced, never silent
  return { ...loc, terrain };
}

module.exports = { BASE, location, sail, tradeAttest, issueSeed, verifyFight, useChronoOrb, cooldown, harvest, dock, aboard, signOn, signOff, terrainAt, locationWithTerrain, describeLocation };
