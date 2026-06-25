// @ts-check
/**
 * craft.js — Seize the Seas crafting, adapted from Kardov's Gate (Tales of Tasern
 * src/lib/crafting.ts). Recipes are DERIVED from the armory (gear-data.js) so every
 * craftable gear has a material cost + DC; a craft CHECK (d20 + INT + ranks + tool +
 * location) vs that DC decides success; beating it big (or a nat 20) yields a
 * MASTERWORK item — the only kind that can be ENCHANTED (founder rule).
 *
 * Crafted MASTERWORK/ENCHANTED items are stored in the "forge" (localStorage sts_forge)
 * and injected into ITEMS so they equip everywhere. Base-quality crafts just add the
 * armory id to owned gear (sts_gear).
 */
import { ITEMS, MATERIALS, masterwork as mkMasterwork, enchant as mkEnchant } from "./items.js";

// ── ported from Kardov's crafting.ts ──────────────────────────────────────────
export const TOOL_BONUS = { none: -4, improvised: -2, basic: 0, masterwork: 2 };
export const LOCATION_BONUS = { wilderness: -4, camp: -2, workshop: 0, smithy: 2 };
// gold per unit of raw material (bought at the smithy; gathered free later)
export const MATERIAL_GOLD = { metal: 15, wood: 5, leather: 8, cloth: 4, herb: 3, bone: 6, stone: 4 };

const baseType = (it) => it.id.replace(/-(wooden|iron|bronze|steel|leather)$/, "");
const WOOD = new Set(["club","greatclub","quarterstaff","shortbow","longbow","spear","sling","blowgun","dart","javelin","lance","pike","glaive","halberd"]);
const LEATHER_ARMOR = new Set(["armor","armor-studded","armor-hide"]);

/** Which raw material a gear item is forged from. */
export function materialFor(item) {
  const bt = baseType(item);
  if (item.slot === "armor") return LEATHER_ARMOR.has(bt) ? "leather" : "metal";
  if (item.slot === "trinket") return "metal";
  return WOOD.has(bt) ? "wood" : "metal";
}

const power = (it) => Object.values(it.mods || {}).reduce((s, v) => s + Math.abs(v), 0);
const TIER_DC = { wooden: 8, iron: 12, bronze: 15, steel: 18, leather: 12, cloth: 12 };

/** Derive a craft recipe for any armory item. */
export function recipe(item) {
  const material = materialFor(item);
  const p = power(item);
  const qty = Math.max(1, Math.ceil(p / 3));
  const dc = (TIER_DC[item.material] ?? 12) + Math.floor(p / 2);
  const hours = Math.max(2, p * 2);
  return { material, qty, dc, hours };
}

/**
 * Roll a craft check. success if total >= DC; MASTERWORK if nat 20 or total >= DC+10.
 * @param {{item:object, intMod?:number, ranks?:number, tool?:string, location?:string, rng?:()=>number}} o
 */
export function craftCheck(o) {
  const { item, intMod = 0, ranks = 0, tool = "basic", location = "smithy", rng = Math.random } = o;
  const r = recipe(item);
  const roll = 1 + Math.floor(rng() * 20);
  const total = roll + intMod + ranks + (TOOL_BONUS[tool] ?? 0) + (LOCATION_BONUS[location] ?? 0);
  const success = total >= r.dc;
  const masterwork = success && (roll === 20 || total >= r.dc + 10);
  return { roll, total, dc: r.dc, success, masterwork };
}

// ── forge: crafted masterwork/enchanted instances (equippable) ────────────────
const FORGE_KEY = "sts_forge";
export function loadForge() {
  if (typeof localStorage === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(FORGE_KEY) || "{}"); } catch { return {}; }
}
function saveForge(f) { localStorage.setItem(FORGE_KEY, JSON.stringify(f)); }

/** Merge saved forge instances into an ITEMS map so they equip/show everywhere. */
export function injectForge(items) {
  const f = loadForge();
  for (const [iid, it] of Object.entries(f)) items[iid] = it;
  return items;
}

/** Persist a crafted MASTERWORK instance to the forge. Returns its instance id. */
export function forgeMasterwork(baseItem) {
  const f = loadForge();
  const n = Object.keys(f).filter((k) => k.startsWith(baseItem.id + "#")).length + 1;
  const iid = `${baseItem.id}#mw${n}`;
  const inst = { ...mkMasterwork(baseItem), id: iid, baseId: baseItem.id, crafted: true };
  f[iid] = inst; saveForge(f);
  if (typeof ITEMS !== "undefined") ITEMS[iid] = inst;
  return iid;
}

/** Enchant a forged MASTERWORK instance by +n (gold cost handled by caller). Throws if not masterwork. */
export function enchantForged(iid, n) {
  const f = loadForge();
  const cur = f[iid];
  if (!cur) throw new Error("no such forged item");
  const upgraded = { ...mkEnchant(cur, n), id: iid, baseId: cur.baseId, crafted: true };
  f[iid] = upgraded; saveForge(f);
  if (typeof ITEMS !== "undefined") ITEMS[iid] = upgraded;
  return upgraded;
}

/** Gold cost to enchant +n (masterwork only). */
export const enchantCost = (n) => 250 * n * n;
