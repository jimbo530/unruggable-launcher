// @ts-check
/**
 * items.js — SIMPLE equippable gear for the battle prototype.
 *
 * Three slots (weapon / armor / trinket). Equipping an item layers its `mods` onto
 * the unit's BASE stats (the class-engine-derived values stored in units.js as
 * baseStats/baseMaxHp/baseAttackRange/baseMovementHexes/baseCastingMod). Combat reads
 * the live fields these mods touch (stats.attack, stats.atkBonus, stats.ac,
 * attackRange, castingAbilityMod — see tot-engine.js resolveAttack/resolveSpellCast),
 * so equipping changes fights immediately. Toggling an item re-applies from base, so
 * nothing drifts. Off-chain + simple for now; later these map to GearStore1155 items
 * and the paper-doll closet so the crew render changes too.
 *
 * Theme: pirate ship-deck + a nod to BEACON (the lighthouse INT token).
 */

export const SLOTS = ["weapon", "armor", "trinket"];

// ── CURRENCY RULE ──────────────────────────────────────────────────────────
// GOLD is the ONE in-game currency. EVERYTHING bought in-game is priced in GOLD
// (the `gold` field) — earn it from jobs, or BUY GOLD with USDC at MARKET price
// (no fixed rate; the gold/Money pool sets it). Crew PAWNS at the Tavern are a
// separate real-money NFT on-ramp (USDC), not gold.
export const CURRENCY = "gold";

// FULL ARMORY: D&D 3.5-grounded weapons/armors × material tiers, generated in
// gear-data.js (crafting model: material + masterwork; only masterwork = enchantable).
// Each entry: { id, name, slot, emoji, gold, desc, mods, sprite, material, masterwork,
// enchantable, enchant } — same shape the equip engine + UIs already use.
import { buildArmory } from "./gear-data.js";
export { MATERIALS, masterwork, enchant, formatCoins } from "./gear-data.js";
export const ITEMS = buildArmory();

// Crafted MASTERWORK/ENCHANTED gear (the "forge", from craft.js) is merged in so it
// equips + shows everywhere. Read inline (not via craft.js) to avoid a circular import.
if (typeof localStorage !== "undefined") {
  try { Object.assign(ITEMS, JSON.parse(localStorage.getItem("sts_forge") || "{}")); } catch (e) {}
}

/** Path to an item's cut-out art (works from any depth-1 page: store/crew/battle-grid). */
export const itemImg = (id) => `../art/gear/${id}.png`; // clean keyed cut-outs (art/items were over-erased to shadows)

// ── INVENTORY (counts) ───────────────────────────────────────────────────────
// localStorage "sts_gear" holds an id->count map so the player can stock SPARES
// (buy 3 iron swords → hold 3). A fallen pawn loses ONE of its equipped weapon
// (see loseWeaponOnFall); a spare auto-equips so you're not left bare. Legacy
// format was an array of ids (a yes/no Set) — migrated transparently to {id:1...}.
const GEAR_KEY = "sts_gear";

/** Raw inventory as an id->count map. Migrates the legacy array (Set) format. */
export function inventory() {
  if (typeof localStorage === "undefined") {                 // node/tests: one of each
    const all = {}; for (const id of Object.keys(ITEMS)) all[id] = 1; return all;
  }
  let raw;
  try { raw = JSON.parse(localStorage.getItem(GEAR_KEY) || "{}"); }
  catch (e) { console.warn("inventory parse failed:", e); return {}; }
  if (Array.isArray(raw)) {                                   // legacy [id,id] → {id:count}
    const m = {}; for (const id of raw) m[id] = (m[id] || 0) + 1; return m;
  }
  return raw && typeof raw === "object" ? raw : {};
}

function saveInventory(m) {
  if (typeof localStorage === "undefined") return;
  const clean = {}; for (const id in m) if (m[id] > 0) clean[id] = m[id]; // prune zeros
  localStorage.setItem(GEAR_KEY, JSON.stringify(clean));
}

/** How many of an item the player holds. */
export function gearCount(id) { return inventory()[id] || 0; }

/** Add n of an item to inventory; returns the new count. */
export function addGear(id, n = 1) {
  const m = inventory(); m[id] = (m[id] || 0) + n; saveInventory(m); return m[id];
}

/** Remove up to n of an item; returns how many were actually removed. */
export function removeGear(id, n = 1) {
  const m = inventory(); const have = m[id] || 0; const take = Math.min(have, n);
  if (take > 0) { m[id] = have - take; saveInventory(m); }
  return take;
}

/** Set of ids the player owns at least one of (back-compat for the equip panels). */
export function ownedGear() {
  if (typeof localStorage === "undefined") return new Set(Object.keys(ITEMS)); // tests: all owned
  const m = inventory();
  return new Set(Object.keys(m).filter((id) => m[id] > 0));
}

/** Recompute a unit's live combat fields = base values + equipped item mods. */
export function applyEquipment(u) {
  const s = { ...u.baseStats };
  let maxHp = u.baseMaxHp;
  let attackRange = u.baseAttackRange;
  let movementHexes = u.baseMovementHexes;
  let castingMod = u.baseCastingMod;

  for (const slot of SLOTS) {
    const id = u.equipped[slot];
    if (!id) continue;
    const m = ITEMS[id].mods;
    if (m.attack)        s.attack      += m.attack;
    if (m.atkBonus)      s.atkBonus    += m.atkBonus;
    if (m.ac)            s.ac          += m.ac;
    if (m.maxHp)         maxHp         += m.maxHp;
    if (m.attackRange)   attackRange   += m.attackRange;
    if (m.movementHexes) movementHexes += m.movementHexes;
    if (m.castingMod)    castingMod    += m.castingMod;
  }

  const wasFull = u.currentHp >= u.maxHp;
  u.stats = s;
  u.maxHp = maxHp;
  s.hp = maxHp;
  u.currentHp = wasFull ? maxHp : Math.min(u.currentHp, maxHp);
  u.attackRange = attackRange;
  u.movementHexes = movementHexes;
  u.castingAbilityMod = castingMod;   // real spell power (resolveSpellCast reads this)
  u.spellDC = 8 + castingMod;         // display DC tracks spell power
}

/** Toggle an item in its slot on a unit, then re-apply all equipment from base. */
export function equipItem(u, itemId) {
  const it = ITEMS[itemId];
  if (!it) return null;
  const slot = it.slot;
  const wasEquipped = u.equipped[slot] === itemId;
  u.equipped[slot] = wasEquipped ? null : itemId;
  applyEquipment(u);
  return { item: it, equipped: !wasEquipped };
}

/** The items a unit currently has equipped, in slot order. */
export function equippedList(u) {
  return SLOTS.map((slot) => u.equipped[slot]).filter(Boolean).map((id) => ITEMS[id]);
}

// ── DEATH = LOSE THE CARRIED WEAPON (founder rule) ────────────────────────────
// When a pawn falls it loses ONLY the one weapon it was carrying. A spare of any
// weapon auto-equips so the pawn isn't left bare (stock a few → skip the store run).
// The fallen weapon: 50/50 the VICTOR loots it vs the HOUSE takes it (a sink so
// PVE-generated enemy gear doesn't inflate the economy).

/** Best spare WEAPON the player owns (highest attack power), or null if none. */
export function bestSpareWeapon() {
  const inv = inventory();
  let best = null, bestScore = -Infinity;
  for (const id in inv) {
    if (inv[id] <= 0) continue;
    const it = ITEMS[id];
    if (!it || it.slot !== "weapon") continue;
    const score = (it.mods?.attack || 0) + (it.mods?.atkBonus || 0);
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

/**
 * Resolve a fallen pawn's carried weapon against the PERSISTENT player inventory.
 * @param {{weaponId: string|null, fallenIsPlayer: boolean, winnerGetsIt: boolean}} o
 *   winnerGetsIt = the 50/50 coin flip (true: victor keeps it, false: house sink).
 * @returns {{lostId:?string, lootedId:?string, toHouse:boolean, reEquipId:?string}}
 *   - player's pawn fell → its weapon leaves the player's inventory (gone); a spare is
 *     chosen to auto-equip (reEquipId, may be the same type if a duplicate remains).
 *   - enemy pawn fell → player is victor: winnerGetsIt adds the weapon, else house sink.
 */
export function resolveFallenWeapon({ weaponId, fallenIsPlayer, winnerGetsIt }) {
  const res = { lostId: null, lootedId: null, toHouse: false, reEquipId: null };
  if (!weaponId) return res;
  if (fallenIsPlayer) {
    removeGear(weaponId, 1);                 // the carried weapon is destroyed/taken — gone either way
    res.lostId = weaponId;
    res.toHouse = !winnerGetsIt;             // bookkeeping: enemy kept it vs house sink
    res.reEquipId = bestSpareWeapon();       // auto-equip a spare so the pawn isn't bare
  } else {
    if (winnerGetsIt) { addGear(weaponId, 1); res.lootedId = weaponId; } // player loots it
    else { res.toHouse = true; }              // house sink (keeps PVE gear from inflating)
  }
  return res;
}
