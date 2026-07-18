// @ts-check
// pawns.js — the canonical PAWN STORE for Seize the Seas (game-layer, localStorage).
//
// A PAWN is a playable character unit. Every pawn carries a FEE FLOW so no pawn is a
// free sprite (founder 2026-06-26): the new-player path turns gold INTO WATER that sits
// "inside" the pawn — recorded here as `waterInside` (NOTIONAL game-layer accounting for
// now; the real on-chain WaterV2 wiring lands later).
//
// SHAPE (founder spec): { id, species, class, level, waterInside, owner, createdAt, origin }
//   - species : one of the 7 base sprites (see SPECIES_OPTIONS below)
//   - class   : class id (e.g. "deckhand" for a fresh new pawn, or a dev class id)
//   - level   : integer (new pawns + dev class pawns start at 1)
//   - waterInside : the pawn's fee flow, in gold-equivalent units (NOTIONAL for now)
//   - owner   : the owning identity (a wallet address in-browser, or any id string)
//   - origin  : "new" | "dev" | "resale" — how the pawn entered play (for the report/UI)
//
// Mirrors the store pattern in jobs-loop.js / upkeep.js: localStorage in the browser, an
// in-memory shim under Node. NO silent catches — corrupt JSON is surfaced via console.warn
// and bad inputs THROW so a failure is always visible.

// ── canonical base species (the 7 selectable sprites) ───────────────────────────────────
// SOURCE OF TRUTH: base-crew-meta/src/ship-species.js SPECIES_OPTIONS + asset-manifest.js
// SPECIES. That module is Node-only (require('fs')/('path')) so it cannot be imported into a
// browser ES module — this list mirrors it. Keep the two in sync if either changes.
// NOTE: acorn art is currently MISSING (the other 6 have art); acorn stays selectable as the
// ultimate fallback, exactly as in asset-manifest.js.
export const SPECIES_OPTIONS = ["human", "dwarf", "elf", "goblin", "orc", "dragonborn", "acorn"];

// Emoji stand-ins for the picker (game-layer; real sprites come from the crew render service
// later). One per species so the UI never shows a broken image.
export const SPECIES_EMOJI = {
  human: "🧑", dwarf: "🧔", elf: "🧝", goblin: "👺", orc: "👹", dragonborn: "🐲", acorn: "🌰",
};

export function isSpecies(s) { return SPECIES_OPTIONS.includes(String(s || "").toLowerCase()); }

// ── storage (localStorage in browser; in-memory shim under Node) ─────────────────────────
const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
})();
const K_PAWNS = "sts_pawns";   // { [id]: pawn }
const K_SEQ   = "sts_pawn_seq"; // monotonic id counter

function readJSON(key, fb) { const r = store.getItem(key); if (r == null) return fb; try { return JSON.parse(r); } catch (e) { console.warn(`[pawns] bad JSON ${key}:`, e); return fb; } }
function writeJSON(key, v) { store.setItem(key, JSON.stringify(v)); }

function allMap() { const m = readJSON(K_PAWNS, {}); return m && typeof m === "object" ? m : {}; }
function nextId() { const n = (Number(store.getItem(K_SEQ)) || 0) + 1; store.setItem(K_SEQ, String(n)); return "pawn" + n; }

/**
 * Mint a pawn into the store. THROWS on a bad species / level / owner so a malformed pawn
 * can never be silently created.
 * @param {{species:string, class?:string, klass?:string, level?:number, waterInside?:number, owner:string, origin?:string}} p
 * @returns {object} the stored pawn
 */
export function mintPawn(p) {
  if (!p || typeof p !== "object") throw new Error("mintPawn: a pawn spec is required");
  const species = String(p.species || "").toLowerCase();
  if (!isSpecies(species)) throw new Error(`mintPawn: unknown species "${p.species}" (use ${SPECIES_OPTIONS.join("/")})`);
  const owner = String(p.owner || "").trim();
  if (!owner) throw new Error("mintPawn: an owner id is required");
  const level = Number.isFinite(p.level) ? Math.max(1, Math.floor(Number(p.level))) : 1;
  const waterInside = Number.isFinite(p.waterInside) ? Number(p.waterInside) : 0;
  if (waterInside < 0) throw new Error("mintPawn: waterInside cannot be negative");
  const pawn = {
    id: nextId(),
    species,
    class: String(p.class || p.klass || "deckhand"),
    level,
    waterInside,
    owner,
    origin: String(p.origin || "new"),
    createdAt: Date.now(),
  };
  const m = allMap(); m[pawn.id] = pawn; writeJSON(K_PAWNS, m);
  return pawn;
}

/** Fetch one pawn by id (or null). */
export function getPawn(id) { return allMap()[id] || null; }

/** Every pawn in the store (array). */
export function allPawns() { return Object.values(allMap()); }

/** Pawns owned by `owner` (case-insensitive match on the owner id). */
export function myPawns(owner) {
  const o = String(owner || "").toLowerCase();
  return allPawns().filter((p) => String(p.owner).toLowerCase() === o);
}

/**
 * Transfer ownership of a pawn (the game-layer half of a P2P resale). THROWS if the pawn
 * is unknown so a transfer is never silently lost.
 * @returns {object} the updated pawn
 */
export function transferPawn(id, newOwner) {
  const o = String(newOwner || "").trim();
  if (!o) throw new Error("transferPawn: a new owner id is required");
  const m = allMap(); const pawn = m[id];
  if (!pawn) throw new Error(`transferPawn: unknown pawn "${id}"`);
  pawn.owner = o;
  pawn.origin = "resale";
  writeJSON(K_PAWNS, m);
  return pawn;
}

/** Set / adjust the water-inside (fee flow) of a pawn. THROWS on unknown pawn / bad amount. */
export function setWaterInside(id, amount) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("setWaterInside: amount must be a number >= 0");
  const m = allMap(); const pawn = m[id];
  if (!pawn) throw new Error(`setWaterInside: unknown pawn "${id}"`);
  pawn.waterInside = Number(amount);
  writeJSON(K_PAWNS, m);
  return pawn;
}
