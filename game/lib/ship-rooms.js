// game/lib/ship-rooms.js — THE one true SHIP ROOM CATALOG for "Seize the Seas".
//
// A ship's hold is a BUDGET (SHIP_HOLD_TONS in weight.js) split between CARGO and ROOMS.
// Rooms are bought with GOLD and CONSUME hold tonnage in exchange for function — the core
// cargo-vs-capability tradeoff (Ghosts of Saltmarsh): every gun deck you bolt in is cargo
// you can no longer haul. weight.js owns the math (shipCargoLb); THIS file owns the catalog.
//
// Each room:
//   key      — stable id (used in localStorage loadouts + as the install map key)
//   name     — display name
//   emoji    — fallback glyph (UI may swap in art/rooms/<key>.png when it exists)
//   goldCost — install price in GOLD (render with coins() from coins.js)
//   tons     — hold tonnage it eats (subtracted from SHIP_HOLD_TONS)
//   desc     — one-line plain-language pitch
//   effect   — machine-ish tag of what it does (for the game layer to read later)
//
// Game-layer ONLY — NO on-chain anything lives here. Import everywhere a ship loadout is
// shown or priced so the room convention never drifts between screens.

export const ROOMS = {
  gun_deck: {
    key: "gun_deck", name: "Gun Deck", emoji: "💥",
    goldCost: 1200, tons: 8,
    desc: "Rows of cannon — turns your hold into firepower for open-sea fights.",
    effect: { type: "combat", attack: 3 },
  },
  crew_quarters: {
    key: "crew_quarters", name: "Crew Quarters", emoji: "🛏️",
    goldCost: 600, tons: 5,
    desc: "Extra bunks — more hands aboard means more crew working for you.",
    effect: { type: "bunks", bunks: 8 },
  },
  galley: {
    key: "galley", name: "Galley", emoji: "🍲",
    goldCost: 450, tons: 4,
    desc: "A proper kitchen — rations stretch further, crew stays fed on long runs.",
    effect: { type: "rations", efficiency: 0.25 },
  },
  sick_bay: {
    key: "sick_bay", name: "Sick Bay", emoji: "⚕️",
    goldCost: 700, tons: 4,
    desc: "Surgeon's berth — wounded crew heal between battles instead of going home.",
    effect: { type: "heal", healPerDay: 2 },
  },
  brig: {
    key: "brig", name: "Brig", emoji: "⛓️",
    goldCost: 500, tons: 3,
    desc: "Lockable cells — hold captives and prisoners for ransom or the law.",
    effect: { type: "captives", capacity: 4 },
  },
  cabin: {
    key: "cabin", name: "Captain's Cabin", emoji: "🧭",
    goldCost: 900, tons: 3,
    desc: "Your quarters — charts, a strongbox, and the perks of command.",
    effect: { type: "captain", perks: true },
  },
  boat_bay: {
    key: "boat_bay", name: "Boat Bay", emoji: "🛶",
    goldCost: 1500, tons: 12,
    desc: "A launching dock — carries personal rowboats and drops them in the water. The carrier: trade cargo for a fleet of little boats.",
    effect: { type: "carrier", boats: 4 },
  },
};

// Stable display order (catalog UIs iterate this; objects don't guarantee order forever).
export const ROOM_ORDER = [
  "gun_deck", "crew_quarters", "galley", "sick_bay", "brig", "cabin", "boat_bay",
];

// Convenience array (same order) for `for (const room of ROOM_LIST)` loops.
export const ROOM_LIST = ROOM_ORDER.map(k => ROOMS[k]);

// Sum the hold tonnage a set of installed rooms consumes. Pass an array of room keys.
// Unknown keys contribute 0 (defensive — a stale loadout shouldn't throw).
export function installedRoomTons(roomKeys = []) {
  return (roomKeys || []).reduce((sum, k) => sum + (ROOMS[k] ? ROOMS[k].tons : 0), 0);
}

// Sum the GOLD cost of a set of installed rooms (mirror of installedRoomTons, for pricing).
export function installedRoomGold(roomKeys = []) {
  return (roomKeys || []).reduce((sum, k) => sum + (ROOMS[k] ? ROOMS[k].goldCost : 0), 0);
}
