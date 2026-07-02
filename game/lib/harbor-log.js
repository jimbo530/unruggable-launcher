// @ts-check
// harbor-log.js — THE HARBOR'S LOG for "Seize the Seas" (founder 2026-06-26).
//
// A game-layer REGISTRY of ALL known ships that sail these waters. Ships are first-class,
// LOCATION-KEYED entities (just like pawns have a location). This module READS location.js
// (the one true voyage clock) + upkeep.js (rations) and adds the founder's three ship rules:
//
//   • EVERYONE EATS (founder economy rule, upkeep.js) — docked or at sea, crew always needs
//     rations; nothing is free-fed. Docked hungry crew lose morale; at sea they starve.
//   • CREW JOINS ONLY AT DOCK → a pawn can join a ship's crew only while the ship is docked
//     at a port — never at sea. (Pairs with marooning: a pawn left at sea waits for a dock.)
//
// NO on-chain, NO network — localStorage only, same store shim as location.js / upkeep.js.
// NO silent catches: corrupt JSON is surfaced via console.warn; bad inputs THROW so failures
// are always visible. This module is ADDITIVE — it never mutates SHIPS or the voyage engine.

import { SHIPS, PORTS, getLocation, isAtSea, getHex, HUB_PORT } from "./location.js";
import { isFed, needsRations } from "./upkeep.js";

// ── storage (localStorage in browser; in-memory shim under Node so tests run) ─────────────
const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
})();
const K_CREWS = "sts_ship_crews"; // { [shipId]: [pawnId, …] } — per-ship crew rosters

function readJSON(key, fb) { const r = store.getItem(key); if (r == null) return fb; try { return JSON.parse(r); } catch (e) { console.warn(`[harbor-log] bad JSON ${key}:`, e); return fb; } }
function writeJSON(key, v) { store.setItem(key, JSON.stringify(v)); }
function crewMap() { const m = readJSON(K_CREWS, {}); return m && typeof m === "object" ? m : {}; }

// ── ship lookups ──────────────────────────────────────────────────────────────────────────
/** A known ship's registry record (SHIPS entry), or null. */
export function getShip(shipId) { return SHIPS[shipId] || null; }
/** Every known ship (array of SHIPS records). */
export function knownShips() { return Object.values(SHIPS); }

/** The port id this ship is docked at, or null (open water). Thin read of location.getLocation. */
export function locationOf(shipId) { return getLocation(shipId); }

/** Is the ship docked at a port right now? (at a port AND not in transit) */
export function isDocked(shipId) { return getLocation(shipId) != null && !isAtSea(shipId); }

/**
 * The ship's status for the log: "at-sea" (in transit), "in-port" (docked at a port),
 * or "at-anchor" (stationary in open water — not on a port hex, not sailing). The founder
 * spec lists in-port|at-sea; "at-anchor" is the truthful open-water-stationary case (we never
 * silently mislabel an open-water ship as "in-port").
 */
export function statusOf(shipId) {
  if (isAtSea(shipId)) return "at-sea";
  return getLocation(shipId) != null ? "in-port" : "at-anchor";
}

// ── per-ship crew roster ────────────────────────────────────────────────────────────────────
/** The crew (pawn ids) currently signed to this ship. */
export function crewOf(shipId) { const c = crewMap()[shipId]; return Array.isArray(c) ? c.slice() : []; }

/**
 * Can a pawn join this ship's crew right now? Mirrors location.canSetSail's {ok,reason} shape.
 * RULE (founder): joining is only allowed while the ship is DOCKED at a port — never at sea.
 */
export function canJoinCrew(shipId) {
  const ship = getShip(shipId);
  if (!ship) return { ok: false, reason: `unknown ship "${shipId}"` };
  if (isAtSea(shipId)) return { ok: false, reason: "ship is at sea — wait for it to make port to sign on" };
  if (getLocation(shipId) == null) return { ok: false, reason: "ship is anchored in open water — it must be docked at a port to sign on crew" };
  if (ship.crewSize != null && crewOf(shipId).length >= ship.crewSize) return { ok: false, reason: `crew is full (${ship.crewSize} berths)` };  // founder: "if there is room"
  return { ok: true, reason: null };
}

/**
 * Sign a pawn onto a ship's crew. Allowed ONLY when the ship is docked at a port (founder rule).
 * THROWS with a clear reason if the ship is unknown, at sea, or not at a port, or the pawnId is
 * empty — never a silent no-op. Idempotent: re-joining the same pawn is a harmless no-op.
 * @returns {string[]} the ship's new crew roster
 */
export function joinCrew(shipId, pawnId) {
  const pid = String(pawnId || "").trim();
  if (!pid) throw new Error("joinCrew: a pawnId is required");
  const can = canJoinCrew(shipId);
  if (!can.ok) throw new Error(`joinCrew: ${can.reason}`);
  const m = crewMap();
  const crew = Array.isArray(m[shipId]) ? m[shipId] : [];
  if (!crew.includes(pid)) crew.push(pid);
  m[shipId] = crew; writeJSON(K_CREWS, m);
  return crew.slice();
}

/**
 * Remove a pawn from a ship's crew (game-layer). Allowed any time (you can muster a sailor off
 * a docked ship; a marooning at sea is a future feature). THROWS on unknown ship / empty pawn.
 * @returns {string[]} the ship's new crew roster
 */
export function leaveCrew(shipId, pawnId) {
  if (!getShip(shipId)) throw new Error(`leaveCrew: unknown ship "${shipId}"`);
  const pid = String(pawnId || "").trim();
  if (!pid) throw new Error("leaveCrew: a pawnId is required");
  const m = crewMap();
  const crew = (Array.isArray(m[shipId]) ? m[shipId] : []).filter((x) => x !== pid);
  m[shipId] = crew; writeJSON(K_CREWS, m);
  return crew.slice();
}

// ── RATIONS (the founder's rule, tied to upkeep.js) ──────────────────────────────────────────
/**
 * The voyage-rations status for a ship's crew. EVERYONE EATS (founder economy rule): upkeep
 * exempts no one, so unfed crew are listed whether docked or at sea. This lists who has no
 * PACKED RATIONS so the map can surface a WARNING without blocking the voyage — at sea they
 * starve; in port they go hungry and morale drops.
 *
 * Pass { embarking:true } for the PRE-SAIL check (the crew is still docked but about to go to
 * sea): it flags the result atSea so the warning reads as a crossing risk before casting off.
 * @param {string} shipId
 * @param {{ now?:number, embarking?:boolean }} [opts]
 * @returns {{ shipId:string, atSea:boolean, crew:string[], unfed:string[], allFed:boolean, warning:(string|null) }}
 */
export function voyageRations(shipId, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const crew = crewOf(shipId);
  // atSea only shapes the MESSAGE now — universal eating means the unfed list is the same
  // either way (needsRations always true; ctx kept for the deprecated-shim call signature).
  const atSea = !!opts.embarking || !isDocked(shipId);
  const ctx = atSea ? { atSea: true } : { atPort: true };
  const unfed = needsRations(ctx) ? crew.filter((pid) => !isFed(pid, now)) : [];
  const warning = unfed.length
    ? (atSea
        ? `${unfed.length} of ${crew.length} crew have no rations — they'll starve at sea (morale will drop).`
        : `${unfed.length} of ${crew.length} crew have no rations — hungry even in port (everyone eats).`)
    : null;
  return { shipId, atSea, crew, unfed, allFed: unfed.length === 0, warning };
}

// ── THE LOG (the registry view feed) ─────────────────────────────────────────────────────────
/** One ship's full log entry: identity + where it is + status + its crew. */
export function logEntry(shipId) {
  const s = getShip(shipId);
  if (!s) return null;
  const portId = getLocation(shipId);
  const hex = getHex(shipId);
  return {
    id: s.id,
    name: s.name,
    ticker: s.ticker || null,
    crewDist: s.crewDist || null,
    species: s.species || null,
    hull: s.hull || null,
    crewSize: Number.isFinite(s.crewSize) ? s.crewSize : null,
    location: portId,                                  // port id when docked, else null (open water)
    locationName: portId ? (PORTS[portId] && PORTS[portId].name) || portId : `open water (${hex.q},${hex.r})`,
    hex,
    status: statusOf(shipId),                          // "at-sea" | "in-port" | "at-anchor"
    crew: crewOf(shipId),                              // pawn ids signed aboard
  };
}

/** The whole Harbor's Log — every known ship with where it is + who's aboard. */
export function harborLog() { return knownShips().map((s) => logEntry(s.id)); }

// re-export the hub port id so a UI can label "home port" without re-importing location.js.
export { HUB_PORT };
