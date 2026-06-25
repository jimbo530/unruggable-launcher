// ============================================================
//  gear-hook.js — GearStore1155 -> crew "look" bridge.
//
//  GOAL: when a wallet buys/equips a GearStore1155 item, the crew NFT it equips on
//  should render that gear (the dynamic image changes). GearStore1155 emits:
//        event GearBought(address buyer, uint256 id, uint256 amount, uint256 cost)
//  and stat bonuses for each gear id are OFF-CHAIN (per the contract's own comment).
//
//  This module is the OFF-CHAIN glue. It does NOT itself talk to the chain (no
//  writes, no provider required to import it) — it exposes pure functions a keeper
//  or the API can call:
//
//    onGearBought(buyer, gearId)      -> grants the matching cosmetics variant to
//                                         the buyer's inventory (so they OWN the look)
//    equipGearOnCrew(crewKey, gearId) -> equips that gear into the crew's 'gear' slot
//                                         (so the dynamic render shows it)
//    gearIdToVariant(gearId)          -> resolves a GearStore1155 id to a cosmetics
//                                         variant id ("gear-crown-king:natural")
//
//  WIRING (two supported models; the v1 default is EXPLICIT EQUIP):
//   A. EXPLICIT EQUIP (v1, recommended): the buy just grants ownership; the player
//      chooses WHICH crew member wears it via POST /crew/equip {key, slot:'gear',
//      variant}. This mirrors the closet's equip semantics and the Acorn store.
//   B. AUTO-EQUIP (optional): a keeper watching GearBought can immediately equip the
//      gear onto a target crew (e.g. the buyer's flagship crew id). Call
//      equipGearOnCrew() from that keeper. Off by default — equipping the wrong crew
//      is worse than making the player click once.
//
//  The gearId<->item mapping lives in cosmetics-config.js (ITEMS[].gearId). Fill in
//  the real GearStore1155 ids there once gear is registered on-chain.
// ============================================================
const { itemByGearId, variantId } = require('./cosmetics-config');
const closet = require('./closet');

// Resolve a GearStore1155 token id to a cosmetics variant id (or null if the id has
// no cosmetics mapping — e.g. pure stat gear with no paper-doll art yet).
function gearIdToVariant(gearId, color = 'natural') {
  const def = itemByGearId(gearId);
  if (!def) return null;
  return variantId(def.id, color);
}

// MODEL A step 1: a verified GearBought -> grant the look to the buyer's inventory.
// `amount` defaults to 1 (one wearable look regardless of token qty bought).
function onGearBought(buyer, gearId, color = 'natural') {
  const variant = gearIdToVariant(gearId, color);
  if (!variant) {
    // Visible, not silent: a bought gear id with no cosmetics mapping is a config gap.
    console.warn('[gear-hook] GearBought for gearId', gearId, '— no cosmetics mapping; nothing granted');
    return null;
  }
  return closet.grant(buyer, variant, 1);
}

// MODEL A step 2 (player-driven) / MODEL B (keeper-driven): equip a gear look onto a
// specific crew member. Validates the buyer owns the variant first when `owner` is
// supplied (prevents equipping gear you don't own).
function equipGearOnCrew(crewRef, gearId, opts = {}) {
  const color = opts.color || 'natural';
  const variant = gearIdToVariant(gearId, color);
  if (!variant) throw new Error('gearId ' + gearId + ' has no cosmetics mapping');
  if (opts.owner) {
    const inv = closet.getInventory(opts.owner);
    if (!inv[variant] || inv[variant].qty < 1) {
      throw new Error('owner ' + opts.owner + ' does not own ' + variant);
    }
  }
  // GearStore gear always lands in the 'gear' slot (the premium worn layer).
  return closet.equip(closet.crewKey(crewRef), 'gear', variant);
}

// Keeper helper (MODEL B): given a parsed GearBought log, grant + (optionally)
// auto-equip onto a target crew. `targetCrew` null => grant only (MODEL A).
function handleGearBoughtLog({ buyer, gearId, targetCrew = null, color = 'natural' }) {
  const inv = onGearBought(buyer, gearId, color);
  let look = null;
  if (targetCrew) look = equipGearOnCrew(targetCrew, gearId, { owner: buyer, color });
  return { inventory: inv, look };
}

module.exports = { gearIdToVariant, onGearBought, equipGearOnCrew, handleGearBoughtLog };
