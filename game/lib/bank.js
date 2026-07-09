// @ts-check
// game/lib/bank.js — THE TOWN BANK (founder 2026-07-08: "should also have a bank in
// town you can store coin in case you die and need to gear up again").
//
// THE ONE RULE: banked coin SURVIVES death; carried coin does not. A stripped pawn
// walks home, withdraws, re-gears at the town shops, and marches back. Death costs a
// kit and a mule — never the will to return.
//
// Game-layer + localStorage, the house pattern (weight.js / goblin-cave.js twin).
// The bank stores a PURSE {gold, silver, copper} per (pawnId, townId). Deposits and
// withdrawals move numbers between the pawn's CARRIED purse (caller-owned — coins.js
// shapes) and the BANKED purse (ours). Location gating (must be AT the town) is the
// caller's job via location.js co-location — same trust shape as every town service.
// On-chain coin custody (real GOLD/SILVER/COPPER ERC20 vaulting) is the later upgrade;
// this ledger is the playable seam, and the settle keeper reconciles when that lands.
//
// no silent catches — bad JSON warns loudly and resets; bad amounts throw.

const KEY_PREFIX = "seas:bank:";

const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  };
})();

function key(pawnId, townId) { return KEY_PREFIX + String(townId) + ":" + String(pawnId); }

function readPurse(k) {
  const raw = store.getItem(k);
  if (!raw) return { gold: 0, silver: 0, copper: 0 };
  try {
    const p = JSON.parse(raw);
    return { gold: Number(p.gold) || 0, silver: Number(p.silver) || 0, copper: Number(p.copper) || 0 };
  } catch (e) {
    console.warn("[bank] corrupt purse at " + k + " — resetting (" + e.message + ")");
    store.removeItem(k);
    return { gold: 0, silver: 0, copper: 0 };
  }
}
function writePurse(k, p) { store.setItem(k, JSON.stringify(p)); }

function assertAmounts(a) {
  for (const m of ["gold", "silver", "copper"]) {
    const v = Number(a[m] ?? 0);
    if (!Number.isFinite(v) || v < 0 || Math.floor(v) !== v) throw new Error("[bank] bad " + m + " amount: " + a[m]);
  }
}

/** The pawn's banked purse at a town (read-only copy). */
export function banked(pawnId, townId = "port-royal") {
  return readPurse(key(pawnId, townId));
}

/**
 * DEPOSIT coins from the pawn's carried purse into the town bank.
 * `carried` is the pawn's live carried purse object — it is DEBITED in place (the
 * caller persists it wherever carried coin lives). Throws if carrying less than the
 * deposit — the bank takes no IOUs.
 */
export function deposit(pawnId, carried, amounts, townId = "port-royal") {
  assertAmounts(amounts);
  for (const m of ["gold", "silver", "copper"]) {
    const amt = Number(amounts[m] ?? 0);
    if ((Number(carried[m]) || 0) < amt) throw new Error("[bank] not carrying enough " + m + " to deposit");
  }
  const k = key(pawnId, townId);
  const b = readPurse(k);
  for (const m of ["gold", "silver", "copper"]) {
    const amt = Number(amounts[m] ?? 0);
    carried[m] = (Number(carried[m]) || 0) - amt;
    b[m] += amt;
  }
  writePurse(k, b);
  return { banked: { ...b }, carried: { ...carried } };
}

/**
 * WITHDRAW coins from the town bank into the pawn's carried purse (CREDITED in
 * place). Throws on insufficient banked funds. Withdrawing makes it CARRIED —
 * mortal again, and heavy again (coinWeight applies the moment it leaves the vault).
 */
export function withdraw(pawnId, carried, amounts, townId = "port-royal") {
  assertAmounts(amounts);
  const k = key(pawnId, townId);
  const b = readPurse(k);
  for (const m of ["gold", "silver", "copper"]) {
    const amt = Number(amounts[m] ?? 0);
    if (b[m] < amt) throw new Error("[bank] not enough banked " + m + " to withdraw");
  }
  for (const m of ["gold", "silver", "copper"]) {
    const amt = Number(amounts[m] ?? 0);
    b[m] -= amt;
    carried[m] = (Number(carried[m]) || 0) + amt;
  }
  writePurse(k, b);
  return { banked: { ...b }, carried: { ...carried } };
}

/**
 * DEATH SETTLE — the one rule, enforced: the CARRIED purse is wiped (returned so the
 * settle can route it — loot pools / the cave hoard, founder to rule); the BANKED
 * purse is untouched by design. Call this from the battle-loss settle alongside the
 * gear strip. Mounts are carried things too — the caller strips those with the gear.
 */
export function settleDeath(carried) {
  const lost = { gold: Number(carried.gold) || 0, silver: Number(carried.silver) || 0, copper: Number(carried.copper) || 0 };
  carried.gold = 0; carried.silver = 0; carried.copper = 0;
  return lost; // where the goblins' new fortune goes is the settle's call
}
