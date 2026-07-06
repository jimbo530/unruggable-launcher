// @ts-check
'use strict';
/**
 * ships.js — the ship registry: crew distributor -> that ship's OARS (rowVault) + ship token.
 *
 * A pawn "belongs to" a ship iff it is a token in that ship's CREW DISTRIBUTOR collection (the same
 * per-ship distributor pawns.js / crew/index.html use). In v1 this crew membership IS the "aboard"
 * relation — the seas-server tracks a WALLET's hex, not a ship-entity's position, so there is no
 * per-pawn/per-ship location on-chain OR on the server yet. A crew pawn may man ITS OWN ship's oars
 * wherever that ship is (the oars move with the ship — no port requirement). See the row tool.
 *
 * Each ship's "row token" machinery is a WaterV2 rowVault whose payoutToken IS the ship's own token:
 * the vault's Aave yield is harvested 50/50 — half grows the crew's row-water (levels), half BUYS the
 * ship token on the Money/ship pool (poolFee). That buy is the ship-token VOLUME the founder wants
 * rowers to create (volume -> LP fees -> activates every crew pawn's dormant loyalist fee-flow).
 *
 * PROVENANCE (addresses verified 2026-07-06):
 *   • rowVault.payoutToken() read live on Base and matched the ship token for VERDANT / REDRUM / GUARD
 *     (block 48274899). BLACKTIDE's vault 503'd on the public RPC that pass; its payoutToken is the
 *     documented BLACKTIDE token (row-harvest-keeper.cjs ROW_VAULTS) and row.js re-reads payoutToken()
 *     live at runtime, so the tool self-verifies before it ever names a token.
 *   • Verdant/Redrum vaults + tokens: ship-verdant.json / ship-redrum.json.
 *   • Black Tide / Guard vaults + tokens: mftusd-build/row-harvest-keeper.cjs ROW_VAULTS (live set the
 *     row-harvest keeper + class-engine read).
 *   • Sol del Mar has NO rowVault — intentionally absent (keeper note). A Sol del Mar pawn cannot row
 *     until its oars are wired; the tool says so honestly (never fakes a target).
 */

const TT_JOB = 0; // WorkClock V2 TargetType.JOB (a rowVault is clocked into as a JOB target)

// The ship data now lives in ships.json (CANONICAL, single source of truth) so the seas-server can
// require the SAME registry — no address can drift between the toolbelt and the server. This module
// keeps the helper API + the provenance above; the JSON just holds the rows (name/dist/rowVault/
// shipToken/poolFee/species/homePort/note). homePort is a NEW field the server uses to seed a ship's
// starting dock (all rowable ships default to Port Royal 8003).
/** @type {Array<{name:string, dist:string, rowVault:string|null, shipToken:string|null, poolFee:number|null, species:string, homePort:number, note?:string}>} */
const SHIPS = require('./ships.json').ships;

/** Find the ship a crew distributor belongs to (case-insensitive), or null if unknown. */
function shipByDist(collection) {
  if (!collection) return null;
  const c = String(collection).toLowerCase();
  return SHIPS.find((s) => s.dist.toLowerCase() === c) || null;
}

/** Find a ship by NAME (case-insensitive, trimmed), or null. Used by the dockside sign-on flow. */
function shipByName(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return SHIPS.find((s) => s.name.toLowerCase() === n) || null;
}

/** Ships that actually have oars (a rowVault) — the rowable set. */
const rowableShips = () => SHIPS.filter((s) => !!s.rowVault);

module.exports = { SHIPS, shipByDist, shipByName, rowableShips, TT_JOB };
