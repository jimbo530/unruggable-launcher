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

/** Gear the player owns (bought at the General Store), from localStorage. Guarded for
 *  Node. The battle equip panel only offers owned gear; the store writes this set. */
export function ownedGear() {
  if (typeof localStorage === "undefined") return new Set(Object.keys(ITEMS)); // tests: all owned
  try {
    return new Set(JSON.parse(localStorage.getItem("sts_gear") || "[]"));
  } catch (e) {
    console.warn("owned-gear parse failed:", e);
    return new Set();
  }
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
