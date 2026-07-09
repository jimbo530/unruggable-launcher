// game/lib/weight.js — THE one true encumbrance model for the whole game.
//
// Carry weight is RPG pressure: you can't haul everything, so what you carry is a choice.
// It also gives the coin denominations teeth (copper is heavy per value → convert up to gold)
// and makes gated/route LPs bite (a finite hold means every trade run is a real decision).
//
// Single source of truth — import everywhere (pawn inventory, ship hold, store, jobs).

// ── PAWNS ──────────────────────────────────────────────────────────────────────
// Every pawn starts at 50 lb, then scales with STR. perPoint is the dial (10 lb/pt now).
// capacity(STR 1) = 50 (the floor); +10 lb per STR point above 1.
export const PAWN_BASE_LB     = 50;
export const STR_LB_PER_POINT = 10;
export function pawnCapacity(str = 1) {
  return PAWN_BASE_LB + Math.max(0, (Number(str) || 1) - 1) * STR_LB_PER_POINT;
}

// ── MOUNTS (founder 2026-07-08: 'buying mounts and mules, also loose those if you die') ──
// A mount adds carry capacity to the PARTY while alive-and-held. Lost on death like all
// carried things — the goblins eat your mule. Tokens live on Base (mounts-deployed.json):
//   MULE  0x449bf1572Cfd6A8e7Ac22de301e4eaED001E8A2B — the hauler (D&D price 8g)
//   HORSE 0x3d98a43986C0E3b82aD48c30B05723DD22F36004 — the runner (D&D price 75g; speed later)
export const MOUNTS = {
  mule:  { carryLb: 200, goldPrice: 8,  token: '0x449bf1572Cfd6A8e7Ac22de301e4eaED001E8A2B' },
  horse: { carryLb: 150, goldPrice: 75, token: '0x3d98a43986C0E3b82aD48c30B05723DD22F36004' },
};
// party capacity = every pawn's own back + every led mount's saddlebags
export function partyCapacity(pawnStrs = [], mounts = []) {
  const pawns = (pawnStrs || []).reduce((s2, str) => s2 + pawnCapacity(str), 0);
  const packs = (mounts || []).reduce((s2, m) => s2 + ((MOUNTS[m] && MOUNTS[m].carryLb) || 0), 0);
  return pawns + packs;
}

// ── COIN WEIGHT (gives gold/silver/copper its pressure) ─────────────────────────
// 100 coins = 1 lb, any metal (user 2026-06-25). So value held as COPPER weighs 100× the same
// value in GOLD (100 copper = 1 gold of value = 1 lb vs 1 gold coin = 0.01 lb). That's the
// whole reason to convert up at a changer (= swapping the coin LPs). COINS_PER_LB is a dial.
export const COINS_PER_LB = 100;
export function coinWeight({ gold = 0, silver = 0, copper = 0 }) {
  return (Number(gold) + Number(silver) + Number(copper)) / COINS_PER_LB;
}

// ── CARRIED WEIGHT (gear + coin + cargo) ─────────────────────────────────────────
// Gear weights come from gear-data.js WEIGHTS (authentic D&D 3.5 lb, per item type).
// Sum a list of gear items (each {weight}).
export function gearWeight(items) {
  return (items || []).reduce((s, it) => s + (Number(it && it.weight) || 0), 0);
}
// A pawn's total carried load = equipped gear + coins + anything else carried (lb).
export function carriedWeight({ items = [], coins = {}, cargoLb = 0 } = {}) {
  return gearWeight(items) + coinWeight(coins) + (Number(cargoLb) || 0);
}

// ── SHIPS ──────────────────────────────────────────────────────────────────────
// TOTAL hold tonnage by tier, D&D-derived (Ghosts of Saltmarsh). In TONS (1 ton = 2,000 lb).
// This is a BUDGET split between CARGO and ROOMS: like the book, owners can install rooms
// (bought with gold) that consume hold tonnage in exchange for function — gun decks, crew
// quarters, galley, sick bay, brig… — trading hauling for capability. So warship & sailship
// share a 100t base; the warship's edge is its bigger crew + filling rooms with combat.
// (Room catalog — costs, tonnage, effects — lives in the rooms config, parallel to the
// existing house/room system; weight.js only does the cargo-vs-rooms math.)
export const TON_LB = 2000;
export const SHIP_HOLD_TONS = {
  rowboat:  0.1,   // ~200 lb — just you + a sack
  keelboat: 1,     // first real cargo
  sailship: 100,   // proper merchant hold
  warship:  100,   // same base; trade cargo → combat rooms
  galley:   150,   // flagship warehouse
};
// Cargo space left after installed rooms consume roomTons of the hold.
export function shipCargoLb(key, roomTons = 0) {
  return Math.max(0, (SHIP_HOLD_TONS[key] ?? 0) - (Number(roomTons) || 0)) * TON_LB;
}

// ── LOAD STATE (simple, readable — a bar, not a spreadsheet) ─────────────────────
// Light (no penalty) → Laden (slowed) → Overloaded (can't add / can't move).
// Thresholds are dials. ratio = weight / capacity.
export const LOAD = { LIGHT: "Light", LADEN: "Laden", OVERLOADED: "Overloaded" };
export const LADEN_AT = 0.667;   // ≥ this fraction of capacity = Laden
export function loadState(weight, capacity) {
  const ratio = capacity > 0 ? weight / capacity : Infinity;
  const tier = ratio <= LADEN_AT ? LOAD.LIGHT : ratio <= 1 ? LOAD.LADEN : LOAD.OVERLOADED;
  return { ratio, tier, pct: Math.min(100, Math.round(ratio * 100)), canAdd: ratio < 1 };
}
