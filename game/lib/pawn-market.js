// @ts-check
// pawn-market.js — the TAVERN PAWN MARKET for Seize the Seas (game-layer, localStorage).
//
// The tavern is the pawn market. It sells THREE things (founder 2026-06-26):
//   1) NEW PAWN — 100 gold, and that 100 gold is "turned to water inside the pawn" on
//      purchase (waterInside = 100 = the pawn's FEE FLOW). Buyer PICKS a base species.
//      This is the new-player onboarding path.
//   2) PLAYER RESALES — a P2P market: a player lists a pawn for a gold price; another
//      player buys it; ownership transfers and the gold goes to the SELLER (game-layer).
//   3) DEV LEVEL-1 CLASS PAWNS — devs sell level-1 pawns of different CLASSES at cost
//      ("for the $ it costs to make them"). Price is CONFIGURABLE per class (a `cost`
//      field). See the PRICING-CURRENCY flag on CLASS_CATALOG below.
//
// GOLD: this module owns the GAME RULES (the 100-gold price, the dev catalog costs, who the
// gold goes to) but DELEGATES the actual transfer to an injectable gold spender so it stays
// Node-testable and never imports browser-only window code. The browser injects gold.js's
// spendGold(goldHuman, toAddr); tests inject a mock. GOLD_SINK (the treasury that recycles
// sunk gold into building the world) is imported from gold.js as the canonical address — we
// never retype a treasury address.
//
// NO silent catches: an un-injected spender, an unknown listing/class, or a non-gold dev
// price all THROW so failures are visible.

import { mintPawn, getPawn, allPawns, myPawns, transferPawn, isSpecies, SPECIES_OPTIONS } from "./pawns.js";
import { GOLD_SINK } from "../shared/gold.js";
import { record as journalRecord } from "./journal.js";

// ── the new-player path price ────────────────────────────────────────────────────────────
export const NEW_PAWN_GOLD = 100;       // founder: 100 gold → becomes the pawn's waterInside

// ── injectable gold spender ───────────────────────────────────────────────────────────────
// Signature MATCHES gold.js: spendGold(goldHuman, toAddr) → Promise. Browser does
// `setGoldSpender(spendGold)`; tests inject a mock that records what was spent + to whom.
let _spendGold = async () => { throw new Error("pawn-market: no gold spender set — call setGoldSpender(spendGold) before buying."); };
export function setGoldSpender(fn) {
  if (typeof fn !== "function") throw new Error("setGoldSpender needs a function");
  _spendGold = fn;
}

// ── DEV LEVEL-1 CLASS-PAWN CATALOG ─────────────────────────────────────────────────────────
// Level-1 pawns of different CLASSES (class ids mirror game/class-engine/config/classes.js).
//
// ⚠️ PRICING CURRENCY UNCONFIRMED — the founder said priced "for the $ it costs to make them"
// (cost-recovery), but did NOT confirm whether that $ is GOLD or USDC. Per spec we DEFAULT to
// a GOLD price (`costCurrency: "gold"`) and do NOT invent a real-money/USDC flow. The `cost`
// is a placeholder cost-recovery figure and is CONFIGURABLE per class (edit here or call
// setClassCost). NEEDS FOUNDER CONFIRMATION before launch.
export const CLASS_CATALOG = [
  { classId: "barbarian",  name: "Barbarian",  species: "orc",        cost: 250, costCurrency: "gold", blurb: "STR/CON frontline brute." },
  { classId: "shepherd",   name: "Shepherd",   species: "elf",        cost: 250, costCurrency: "gold", blurb: "WIS/CHA grove orator / support." },
  { classId: "spellblade", name: "Spellblade", species: "human",      cost: 300, costCurrency: "gold", blurb: "DEX/INT gish — melee + magic." },
  { classId: "warden",     name: "Warden",     species: "dwarf",      cost: 275, costCurrency: "gold", blurb: "WIS/CON tanky nature defender." },
  { classId: "wizard",     name: "Wizard",     species: "dragonborn", cost: 300, costCurrency: "gold", blurb: "Pure-INT blaster — squishy nuker." },
];

/** Find a catalog entry (or null). */
export function getClassEntry(classId) {
  const id = String(classId || "").toLowerCase();
  return CLASS_CATALOG.find((c) => c.classId === id) || null;
}

/** The dev catalog (array) — for the UI. */
export function getCatalog() { return CLASS_CATALOG.slice(); }

/**
 * Reconfigure a class pawn's price (cost-recovery). currency defaults to "gold". THROWS on an
 * unknown class / bad cost so a misconfig is visible.
 */
export function setClassCost(classId, cost, currency = "gold") {
  const e = getClassEntry(classId);
  if (!e) throw new Error(`setClassCost: unknown class "${classId}"`);
  if (!Number.isFinite(cost) || cost < 0) throw new Error("setClassCost: cost must be a number >= 0");
  e.cost = Number(cost);
  e.costCurrency = String(currency || "gold").toLowerCase();
  return { classId: e.classId, cost: e.cost, costCurrency: e.costCurrency };
}

// ── P2P RESALE LISTINGS (game-layer) ───────────────────────────────────────────────────────
const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
})();
const K_LISTINGS = "sts_pawn_listings"; // { [listingId]: { id, pawnId, seller, goldPrice, status, listedAt } }
const K_LSEQ     = "sts_pawn_listing_seq";

function readJSON(key, fb) { const r = store.getItem(key); if (r == null) return fb; try { return JSON.parse(r); } catch (e) { console.warn(`[pawn-market] bad JSON ${key}:`, e); return fb; } }
function writeJSON(key, v) { store.setItem(key, JSON.stringify(v)); }
function listingMap() { const m = readJSON(K_LISTINGS, {}); return m && typeof m === "object" ? m : {}; }
function nextListingId() { const n = (Number(store.getItem(K_LSEQ)) || 0) + 1; store.setItem(K_LSEQ, String(n)); return "list" + n; }

// ── 1) BUY A NEW PAWN — 100 gold → water inside ──────────────────────────────────────────
/**
 * Buy a brand-new level-1 pawn of a chosen base `species`. Spends 100 gold to the treasury
 * (GOLD_SINK) and records that 100 as the pawn's waterInside (its fee flow). The buyer is
 * `opts.owner`. THROWS on a bad species / missing owner; the gold spend errors surface from
 * the injected spender (no silent failure).
 * @param {string} species one of SPECIES_OPTIONS
 * @param {{owner:string}} opts
 * @returns {Promise<object>} the minted pawn
 */
export async function buyNewPawn(species, opts = {}) {
  const s = String(species || "").toLowerCase();
  if (!isSpecies(s)) throw new Error(`buyNewPawn: pick a base species (${SPECIES_OPTIONS.join("/")})`);
  const owner = String(opts.owner || "").trim();
  if (!owner) throw new Error("buyNewPawn: an owner is required (connect a wallet)");
  // 100 gold → treasury. The treasury recycles it into building the world (no burn).
  await _spendGold(NEW_PAWN_GOLD, GOLD_SINK);
  // …and that 100 is "turned to water inside the pawn" — its fee flow (notional game-layer).
  const pawn = mintPawn({ species: s, class: "deckhand", level: 1, waterInside: NEW_PAWN_GOLD, owner, origin: "new" });
  journalRecord(pawn.id, "birth", { port: opts.port || "Port Royal" }); // the memoir opens
  return pawn;
}

// ── 2) PLAYER RESALES (P2P) ──────────────────────────────────────────────────────────────
/**
 * List one of your pawns for sale at a gold price. `opts.owner` must be the current owner.
 * THROWS on an unknown pawn / wrong owner / bad price. A pawn can only have ONE open listing.
 * @returns {object} the listing
 */
export function listForSale(pawnId, goldPrice, opts = {}) {
  const pawn = getPawn(pawnId);
  if (!pawn) throw new Error(`listForSale: unknown pawn "${pawnId}"`);
  const owner = String(opts.owner || "").trim();
  if (!owner) throw new Error("listForSale: an owner is required");
  if (String(pawn.owner).toLowerCase() !== owner.toLowerCase()) throw new Error("listForSale: you don't own that pawn");
  if (!Number.isFinite(goldPrice) || goldPrice <= 0) throw new Error("listForSale: set a gold price > 0");
  const m = listingMap();
  for (const k in m) if (m[k].pawnId === pawnId && m[k].status === "open") throw new Error("listForSale: that pawn is already listed");
  const listing = { id: nextListingId(), pawnId, seller: owner, goldPrice: Number(goldPrice), status: "open", listedAt: Date.now() };
  m[listing.id] = listing; writeJSON(K_LISTINGS, m);
  return listing;
}

/** Cancel your own open listing. THROWS on unknown listing / wrong owner. */
export function cancelListing(listingId, opts = {}) {
  const m = listingMap(); const l = m[listingId];
  if (!l) throw new Error(`cancelListing: unknown listing "${listingId}"`);
  const owner = String(opts.owner || "").trim();
  if (String(l.seller).toLowerCase() !== owner.toLowerCase()) throw new Error("cancelListing: not your listing");
  if (l.status !== "open") throw new Error("cancelListing: listing is not open");
  l.status = "cancelled"; writeJSON(K_LISTINGS, m);
  return l;
}

/**
 * Buy a listed pawn. The buyer (`opts.buyer`) pays the gold price TO THE SELLER (game-layer),
 * then ownership transfers to the buyer and the listing is marked sold. The pawn keeps its
 * waterInside (the fee flow travels with the pawn). THROWS on unknown/closed listing, or if
 * the buyer is the seller. Gold-spend errors surface from the injected spender.
 * @returns {Promise<{listing:object, pawn:object}>}
 */
export async function buyListed(listingId, opts = {}) {
  const m = listingMap(); const l = m[listingId];
  if (!l) throw new Error(`buyListed: unknown listing "${listingId}"`);
  if (l.status !== "open") throw new Error("buyListed: that listing is no longer open");
  const buyer = String(opts.buyer || "").trim();
  if (!buyer) throw new Error("buyListed: a buyer is required (connect a wallet)");
  if (buyer.toLowerCase() === String(l.seller).toLowerCase()) throw new Error("buyListed: you already own that pawn");
  if (!getPawn(l.pawnId)) throw new Error("buyListed: the listed pawn no longer exists");
  // gold → the SELLER (P2P, game-layer)
  await _spendGold(l.goldPrice, l.seller);
  const pawn = transferPawn(l.pawnId, buyer);   // ownership moves; waterInside untouched
  l.status = "sold"; l.soldAt = Date.now(); l.buyer = buyer; writeJSON(K_LISTINGS, m);
  journalRecord(l.pawnId, "note", { text: "Changed hands at the pawn market — a new master, same two fists." });
  return { listing: l, pawn };
}

// ── 3) BUY A DEV LEVEL-1 CLASS PAWN ──────────────────────────────────────────────────────
/**
 * Buy a dev level-1 class pawn at its (configurable, cost-recovery) price. The cost goes to
 * the treasury (GOLD_SINK). DEFAULTS to a gold price; if a class's costCurrency is not "gold"
 * we THROW rather than invent a real-money/USDC flow (see CLASS_CATALOG pricing flag).
 * @param {string} classId
 * @param {{owner:string}} opts
 * @returns {Promise<object>} the minted pawn
 */
export async function buyClassPawn(classId, opts = {}) {
  const e = getClassEntry(classId);
  if (!e) throw new Error(`buyClassPawn: unknown class "${classId}"`);
  const owner = String(opts.owner || "").trim();
  if (!owner) throw new Error("buyClassPawn: an owner is required (connect a wallet)");
  if (e.costCurrency !== "gold") throw new Error(`buyClassPawn: ${e.classId} is priced in ${e.costCurrency}; only gold is wired game-layer (founder must confirm currency)`);
  await _spendGold(e.cost, GOLD_SINK);
  // Dev class pawns are cost-recovery sales; their fee flow is the dev sale itself, so they
  // carry no pre-loaded water (waterInside 0). Configurable later if the founder wants water in.
  const pawn = mintPawn({ species: e.species, class: e.classId, level: 1, waterInside: 0, owner, origin: "dev" });
  journalRecord(pawn.id, "birth", { port: opts.port || "Port Royal" }); // the memoir opens
  return pawn;
}

// ── QUERIES (for the UI) ─────────────────────────────────────────────────────────────────
/** All OPEN player listings (array). */
export function openListings() { return Object.values(listingMap()).filter((l) => l.status === "open"); }
/** Open listings with the pawn object joined in, for rendering. */
export function openListingsDetailed() {
  return openListings().map((l) => ({ ...l, pawn: getPawn(l.pawnId) })).filter((x) => x.pawn);
}
/** A seller's listings (any status). */
export function listingsBySeller(owner) {
  const o = String(owner || "").toLowerCase();
  return Object.values(listingMap()).filter((l) => String(l.seller).toLowerCase() === o);
}

// re-export the pawn-store reads the UI needs, so the tavern imports ONE module.
export { getPawn, allPawns, myPawns, SPECIES_OPTIONS };
export { SPECIES_EMOJI } from "./pawns.js";
