// game/lib/ship-catalog.js — THE one true SHIP CATALOG for "Seize the Seas".
//
// A hull is the BUSINESS you run: bigger hull = more GOLD = more crew bunks = more workers.
// This module is the SINGLE SOURCE OF TRUTH for hull -> crew -> price -> cargo. Import it
// everywhere a ship is priced, built, or launched (the store UI, the launch-request queue,
// the agent's on-chain launcher) so the ladder never drifts between screens.
//
// Each ship:
//   key       — stable id (used in the store, the launch queue, and the on-chain launch map)
//   name      — display name
//   icon      — fallback glyph (UI may swap in art/ships/<key>.png when it exists)
//   crewCount — crew bunks. MUST be 1..100 — the on-chain ship contract CLAMPS to that range.
//   priceGold — build price in GOLD (render with coins() from coins.js — never hardcode coin text)
//   cargoTons — hold tonnage the empty hull carries (cargo-vs-rooms budget; see weight.js)
//   desc      — one-line plain-language pitch
//   tokenAddr — the BOAT OWNERSHIP token (one ERC20 per hull, crafted from LUMBER = priceGold/2).
//               DEPLOYED 2026-07-04 (deploy/boats-deployed.json, Base mainnet, LaunchToken fixed-supply
//               ERC20s, 1B each, 100% to the treasury). Recipe: game/seas/boat-craft.js.
//
// Game-layer ONLY — NO on-chain anything lives here. The browser does the player-signed GOLD
// payment; the agent does the launch. This file just describes the ladder.

export const SHIP_CATALOG = {
  rowboat: {
    key: "rowboat", name: "Rowboat", icon: "🛶",
    crewCount: 1, priceGold: 50, cargoTons: 0.1, tokenAddr: "0xBC1E8515A23D86da7d9fE6Fb1091198a7a9F4EEA",
    desc: "A starter hull to get you on the water. One pair of hands — your first command.",
  },
  sloop: {
    key: "sloop", name: "Sloop", icon: "⛵",
    crewCount: 6, priceGold: 500, cargoTons: 5, tokenAddr: "0x60D038e5Fff01Ca3232EAe48fa1a4CBDf5050846",
    desc: "A nimble first ship. A working crew of six and a hold worth filling.",
  },
  schooner: {
    key: "schooner", name: "Schooner", icon: "🚤",
    crewCount: 12, priceGold: 1500, cargoTons: 20, tokenAddr: "0x4fcDC3c37d36ddB362404B6e3fC6197D9DBD2855",
    desc: "Fast and roomy. A dozen crew and real cargo for the trade routes.",
  },
  brigantine: {
    key: "brigantine", name: "Brigantine", icon: "🚢",
    crewCount: 24, priceGold: 4000, cargoTons: 50, tokenAddr: "0x7b2903d047486625f01F8A800E3ed269733C7DB7",
    desc: "The “you've made it” boat. A proper crew, a proper sail, a proper business.",
  },
  galleon: {
    key: "galleon", name: "Galleon", icon: "🛳️",
    crewCount: 50, priceGold: 10000, cargoTons: 100, tokenAddr: "0x3E8BF712F7b9E007fA6245d9839183Ab0fb39D8d",
    desc: "A heavy merchant hull. Fifty hands at work — a fleet's worth of throughput.",
  },
  "man-o-war": {
    key: "man-o-war", name: "Man-o-War", icon: "🏴‍☠️",
    crewCount: 100, priceGold: 25000, cargoTons: 150, tokenAddr: "0x9Cb68c469E6ae9E6575A510A6E00baDe4910A834",
    desc: "The flagship. The full 100-bunk crew — the apex of a captain's career.",
  },
};

// Stable display order (catalog UIs iterate this; object key order isn't guaranteed forever).
export const SHIP_ORDER = ["rowboat", "sloop", "schooner", "brigantine", "galleon", "man-o-war"];

// Convenience array (same order) for `for (const ship of SHIP_LIST)` loops.
export const SHIP_LIST = SHIP_ORDER.map(k => SHIP_CATALOG[k]);

// The on-chain ship contract clamps crew to 1..100. Mirror that clamp here so anything that
// reads a catalog crewCount (or a player-supplied one) can never request an out-of-range crew.
export const CREW_MIN = 1;
export const CREW_MAX = 100;
export function clampCrew(n) {
  const v = Math.floor(Number(n) || 0);
  return Math.max(CREW_MIN, Math.min(CREW_MAX, v));
}

// Look up a ship by key (null if unknown — callers decide how to handle a stale key).
export function shipByKey(key) {
  return SHIP_CATALOG[key] || null;
}
