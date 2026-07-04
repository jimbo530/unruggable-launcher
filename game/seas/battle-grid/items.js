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

// 7-slot paper doll (grown from the 3-slot prototype: weapon/armor/trinket). The new slots
// (offhand/helm/boots/ring) carry the gear-ext expansion. applyEquipment(), renderEquip()
// and checkMortality() all iterate THIS list, so adding a slot is one array + matching
// `equipped` keys (units.js/monster makers seed them). Order = render/equip order.
export const SLOTS = ["weapon", "offhand", "armor", "helm", "boots", "ring", "trinket"];

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
import { GEAR_EXT } from "./gear-ext.js";
import { deriveCombatStats, engineMod } from "./stat-derive.js";
import { GEAR_CAPS } from "./balance.js";
export { MATERIALS, masterwork, enchant, formatCoins } from "./gear-data.js";
export const ITEMS = buildArmory();

// Merge the Seize-the-Seas gear EXPANSION (7-slot paper doll, ability-score gear, firearms).
// NON-OVERWRITING: the authentic base armory wins any id collision, so existing items (and the
// equip smoke pinned to them) stay byte-for-byte. CONSUMABLES are intentionally NOT merged
// (they're used, not worn — a separate bag/use action, per gear-ext.js).
for (const id in GEAR_EXT.ITEMS) if (!(id in ITEMS)) ITEMS[id] = GEAR_EXT.ITEMS[id];

// Crafted MASTERWORK/ENCHANTED gear (the "forge", from craft.js) is merged in so it
// equips + shows everywhere. Read inline (not via craft.js) to avoid a circular import.
if (typeof localStorage !== "undefined") {
  try { Object.assign(ITEMS, JSON.parse(localStorage.getItem("sts_forge") || "{}")); } catch (e) {}
}

/** Path to an item's cut-out art (works from any depth-1 page: store/crew/battle-grid). */
export const itemImg = (id) => `../art/gear/${id}.png`; // clean keyed cut-outs (art/items were over-erased to shadows)

// ── INVENTORY (counts) ───────────────────────────────────────────────────────
// localStorage "sts_gear" holds an id->count map so the player can stock SPARES
// (buy 3 iron swords → hold 3). A fallen pawn loses ONE of its equipped weapon; a
// spare auto-equips so you're not left bare. Legacy array (yes/no Set) is migrated.
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
  // ── one pass: sum FLAT mods + ABILITY-score deltas across every equipped slot ──
  const flat = { attack: 0, atkBonus: 0, ac: 0, maxHp: 0, attackRange: 0, movementHexes: 0, castingMod: 0 };
  const abil = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
  const ABIL_KEY = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
  for (const slot of SLOTS) {
    const id = u.equipped[slot];
    if (!id) continue;
    const it = ITEMS[id];
    if (!it || !it.mods) continue;                        // tolerate an unknown id (was a hard crash)
    const m = it.mods;
    for (const k in flat) if (m[k]) flat[k] += m[k];      // attack/atkBonus/ac/maxHp/range/move/castingMod
    for (const a in ABIL_KEY) if (m[a]) abil[ABIL_KEY[a]] += m[a]; // str..cha → ability-score deltas
  }

  const wasFull = u.currentHp >= u.maxHp;

  // ── ability-AWARE path (players: buildUnit stored baseAbilities = raw D&D scores) ──
  // Re-derive the stat bridge from (base scores + gear ability deltas) the SAME way
  // buildUnit() did (stat-derive.js), then layer the flat mods on top. So a +2 STR ring
  // really raises to-hit/dmg AND pawnCapacity; removing it returns to exactly the base
  // numbers. With zero ability gear this reproduces the old flat-sum result identically.
  if (u.baseAbilities) {
    const eff = {};
    for (const K of ["STR", "DEX", "CON", "INT", "WIS", "CHA"])
      eff[K] = Math.max(0, Math.min(30, (u.baseAbilities[K] || 0) + abil[K]));
    const lvl = u.casterLevel || u.totalLevel || 1;
    const d = deriveCombatStats({ scores: eff, role: u.role, charLevel: lvl });
    const baseConMod = engineMod(u.baseAbilities.CON || 0);
    const s = { ...u.baseStats };
    s.attack = d.attack + flat.attack;
    s.atkBonus = d.atkBonus + flat.atkBonus;
    s.ac = d.ac + flat.ac;
    s.mAtk = d.mAtk; s.def = d.def; s.mDef = d.mDef; s.speed = d.speed;
    const maxHp = u.baseMaxHp + (d.conMod - baseConMod) * lvl + flat.maxHp;
    const castingMod = d.intMod + flat.castingMod;
    s.hp = maxHp;
    u.stats = s;
    u.engineStats = { ...eff };               // showStats + loadOf(pawnCapacity STR) track the buff
    u.rawAbilities = d.rawAbilities;          // saves / spell-saves track the buff
    u.maxHp = maxHp;
    u.currentHp = wasFull ? maxHp : Math.min(u.currentHp, maxHp);
    u.attackRange = u.baseAttackRange + flat.attackRange;
    u.movementHexes = Math.max(2, Math.floor(d.speed / 5)) + flat.movementHexes;
    u.castingAbilityMod = castingMod;         // real spell power (resolveSpellCast reads this)
    u.spellDC = 8 + castingMod;               // display DC tracks spell power
    clampGearContribution(u);                 // P2 CAP: ability-score gear can't exceed GEAR_CAPS (LAST step)
    return;
  }

  // ── LEGACY flat-sum path (monsters / any unit without baseAbilities) — UNCHANGED behaviour ──
  const s = { ...u.baseStats };
  s.attack = (u.baseStats.attack || 0) + flat.attack;
  s.atkBonus = (u.baseStats.atkBonus || 0) + flat.atkBonus;
  s.ac = (u.baseStats.ac || 0) + flat.ac;
  const maxHp = u.baseMaxHp + flat.maxHp;
  const castingMod = u.baseCastingMod + flat.castingMod;
  s.hp = maxHp;
  u.stats = s;
  u.maxHp = maxHp;
  u.currentHp = wasFull ? maxHp : Math.min(u.currentHp, maxHp);
  u.attackRange = u.baseAttackRange + flat.attackRange;
  u.movementHexes = u.baseMovementHexes + flat.movementHexes;
  u.castingAbilityMod = castingMod;   // real spell power (resolveSpellCast reads this)
  u.spellDC = 8 + castingMod;         // display DC tracks spell power
  clampGearContribution(u);           // P2 CAP: gear contribution can't exceed GEAR_CAPS (LAST step)
}

/**
 * clampGearContribution — P2 CAP. The LAST step of applyEquipment in BOTH paths. Holds the
 * gear-derived RISE of each live combat field to GEAR_CAPS over the unit's un-geared base, so
 * no stack of flat mods OR ability-score gear (a pile of +STR items) can push to-hit / attack /
 * AC / HP / move / range / spell power past the ceiling. Penalties (negative gear) pass through
 * untouched — this is an UPPER bound only. Reads GEAR_CAPS from balance.js (the single source of
 * truth), is idempotent, and is safe on monsters (legacy flat path: baseStats + base* mirrors
 * exist; no baseAbilities required). Exported so the sim/tests can assert the ceiling directly.
 *
 * @param {any} u  a BattleUnit with .stats + .baseStats + base* mirrors already populated
 */
export function clampGearContribution(u) {
  if (!u || !u.stats) return u;
  const b = u.baseStats || {};
  // base + min(cap, gain): caps the POSITIVE gear gain; a negative gain (penalty) min()s to
  // itself and passes through, so debuff gear still works.
  const capGain = (cur, base, cap) => {
    const base0 = Number(base) || 0;
    const room = typeof cap === "number" && isFinite(cap) ? cap : Infinity;
    return base0 + Math.min(room, (Number(cur) || 0) - base0);
  };

  u.stats.atkBonus = capGain(u.stats.atkBonus, b.atkBonus, GEAR_CAPS.toHit);
  u.stats.attack = capGain(u.stats.attack, b.attack, GEAR_CAPS.attack);
  u.stats.ac = capGain(u.stats.ac, b.ac, GEAR_CAPS.ac);

  // maxHp: gear may add at most +baseMaxHp ("base") — never more than double HP.
  const hpCap = GEAR_CAPS.maxHp === "base" ? Number(u.baseMaxHp) || 0 : GEAR_CAPS.maxHp;
  const wasFull = u.currentHp >= u.maxHp;
  u.maxHp = capGain(u.maxHp, u.baseMaxHp, hpCap);
  u.stats.hp = u.maxHp;
  u.currentHp = wasFull ? u.maxHp : Math.min(u.currentHp, u.maxHp);

  u.attackRange = capGain(u.attackRange, u.baseAttackRange, GEAR_CAPS.range);
  u.movementHexes = Math.max(2, capGain(u.movementHexes, u.baseMovementHexes, GEAR_CAPS.move));

  if (typeof u.castingAbilityMod === "number") {
    u.castingAbilityMod = capGain(u.castingAbilityMod, u.baseCastingMod, GEAR_CAPS.castingMod);
    u.spellDC = 8 + u.castingAbilityMod;
  }
  return u;
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
// A fallen pawn loses ONLY the one weapon it was carrying; a spare auto-equips so
// it isn't left bare. Fallen weapon: 50/50 the VICTOR loots it vs the HOUSE sink.

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
 * @returns {{lostId:?string, lootedId:?string, toHouse:boolean, reEquipId:?string}}
 */
export function resolveFallenWeapon({ weaponId, fallenIsPlayer, winnerGetsIt }) {
  const res = { lostId: null, lootedId: null, toHouse: false, reEquipId: null };
  if (!weaponId) return res;
  if (fallenIsPlayer) {
    removeGear(weaponId, 1);                 // the carried weapon is gone either way
    res.lostId = weaponId;
    res.toHouse = !winnerGetsIt;
    res.reEquipId = bestSpareWeapon();       // auto-equip a spare so the pawn isn't bare
  } else {
    if (winnerGetsIt) { addGear(weaponId, 1); res.lootedId = weaponId; } // player loots it
    else { res.toHouse = true; }             // house sink (keeps PVE gear from inflating)
  }
  return res;
}
