// @ts-check
/**
 * boat-craft.js — BOAT OWNERSHIP crafting for "Seize the Seas" (founder 2026-06-27).
 *
 *   "we need tokens for each kind of boat we plan to let them buy — these are ownership of a boat and
 *    need lumber to make in game. a boat takes half the gold cost in lumber to make the boat token."
 *
 * A boat is CRAFTED, not bought with gold: you burn LUMBER equal to HALF the hull's gold cost and you
 * receive that hull's OWNERSHIP token (one ERC20 per hull, deployed by deploy/deploy-boats.js). This is
 * the game-layer recipe + settlement — the SAME shape as battle-grid/craft.js (a recipe + a localStorage
 * inventory), kept whole-number, debit-then-credit.
 *
 * SCOPE (founder rules):
 *   • The boat token is the HULL OWNERSHIP item only. Crew, sails, fee-share, the row-vault — all of that
 *     stays with the EXISTING ShipyardV5 launch (game/seas/citizen/tools/build-ship.js). We do NOT rebuild
 *     any of it here. See the SHIPYARD_RELATIONSHIP note at the bottom — it is an OPEN QUESTION for the
 *     founder, NOT a guess.
 *   • A ROWBOAT is the simplest case — founder: "row boats may just need to be items, no free pawns/sails
 *     or any of that." So the rowboat recipe yields a plain owned item; it is never expected to feed a
 *     crewed ShipyardV5 launch.
 *
 * RECIPE (founder 2026-06-27: "log is 1 and lumber is 5 gold standard market price"): the cost is lumber
 *   VALUE = half the hull's gold cost, converted at 5 gold per LUMBER. lumberCost = (priceGold/2)/5 =
 *   priceGold/10 → rowboat 5, sloop 50, schooner 150, brigantine 400, galleon 1000, man-o-war 2500 LUMBER.
 *   CRAFTING ≠ SELLING (founder): crafting a boat token costs this LUMBER + TIME + SKILL — the log→lumber
 *   crafting LPs are gated 1:1 and TIME-GATED (LocationPool cooldown/maxSwapIn throughput), and pawn skill
 *   gates the craft. The crafted token is then SOLD on a SEPARATE boat LP (100 of each hull, wide-but-not-
 *   full range so price floats with demand). See lumberCostByValue() for the conversion helper.
 *
 * SETTLEMENT (game-layer, like craft.js): the browser tracks a LUMBER balance in localStorage
 * ("sts_lumber", whole units) and owned boats in localStorage ("sts_boats", a Set of hull keys). craftBoat()
 * debits lumber then credits the boat. The ON-CHAIN truth (burn real LUMBER 0x7a97…, mint/transfer the boat
 * ERC20 to the player) is the founder-gated follow-on: it routes through the same relayer/attestation model
 * as the rest of seas (see craftBoatOnChainPlan() — it DESCRIBES the tx, never fakes one). Real-or-nothing.
 */

// ── the hull ladder (mirrors game/lib/ship-catalog.js priceGold; kept here so this module is usable
// standalone in the browser without importing the ESM catalog). If you change a price, change it in the
// catalog FIRST — that is the single source of truth — then mirror it here. ──
export const BOAT_HULLS = {
  rowboat:     { key: 'rowboat',    name: 'Rowboat',    priceGold: 50,    itemOnly: true  },
  sloop:       { key: 'sloop',      name: 'Sloop',      priceGold: 500,   itemOnly: false },
  schooner:    { key: 'schooner',   name: 'Schooner',   priceGold: 1500,  itemOnly: false },
  brigantine:  { key: 'brigantine', name: 'Brigantine', priceGold: 4000,  itemOnly: false },
  galleon:     { key: 'galleon',    name: 'Galleon',    priceGold: 10000, itemOnly: false },
  'man-o-war': { key: 'man-o-war',  name: 'Man-o-War',  priceGold: 25000, itemOnly: false },
};

export const BOAT_ORDER = ['rowboat', 'sloop', 'schooner', 'brigantine', 'galleon', 'man-o-war'];

// LUMBER token (refined) — the ONLY input a boat craft consumes (deploy/materials-deployed.json).
export const LUMBER_TOKEN = '0x7a97e5e76C93267e1FF2EBc38DCC7C7B6f40fF4c';
// Standard market prices (founder 2026-06-27): LOG = 1 gold, LUMBER = 5 gold. Boat recipe is VALUE-based.
export const LUMBER_GOLD_PRICE = 5;
export const LOG_GOLD_PRICE = 1;
// LOGS token (raw upstream) — logs→lumber happens at the mill BEFORE crafting; a boat never burns logs.
export const LOGS_TOKEN = '0xD8DA82E017bf28C261Aa2d6Be6f62C6283683D08';

/**
 * The boat-craft recipe for a hull: how much LUMBER it burns and what ownership token it yields.
 * lumberCost = priceGold / 2 (UNITS). Whole-number (Math.ceil so a 0.5 never rounds to free).
 * @param {string} hullKey  one of BOAT_ORDER
 * @returns {{ hull:string, name:string, priceGold:number, lumberCost:number, yields:string, itemOnly:boolean }}
 */
export function boatRecipe(hullKey) {
  const h = BOAT_HULLS[hullKey];
  if (!h) throw new Error(`unknown hull "${hullKey}" — one of: ${BOAT_ORDER.join(', ')}`);
  return {
    hull: h.key,
    name: h.name,
    priceGold: h.priceGold,
    lumberCost: Math.ceil((h.priceGold / 2) / LUMBER_GOLD_PRICE), // lumber VALUE = goldCost/2 at 5 g/lumber (= priceGold/10)
    yields: `boat-${h.key}`,                   // the ownership token id (matches deploy-boats.js + boats-deployed.json)
    itemOnly: !!h.itemOnly,                    // rowboat = plain item, never a crewed-ship prerequisite
  };
}

/** All six recipes (display order). Handy for a craft-shop UI. */
export function allBoatRecipes() {
  return BOAT_ORDER.map(boatRecipe);
}

/**
 * ALTERNATE reading the founder may have meant: lumberCost = goldCost/2 in GOLD VALUE, converted to
 * lumber UNITS at LUMBER's per-unit gold price. NOT used by default (boatRecipe uses UNITS). Requires
 * lumberGoldPrice (gold per 1 LUMBER) which is NOT wired anywhere yet — so this throws until the founder
 * confirms the interpretation + supplies the price. Surfaced, never silently guessed.
 * @param {string} hullKey
 * @param {number} lumberGoldPrice  gold per 1 LUMBER unit
 */
export function lumberCostByValue(hullKey, lumberGoldPrice) {
  const h = BOAT_HULLS[hullKey];
  if (!h) throw new Error(`unknown hull "${hullKey}"`);
  if (!lumberGoldPrice || lumberGoldPrice <= 0) {
    throw new Error('lumberCostByValue needs LUMBER\'s per-unit gold price (not wired yet). Default recipe uses UNITS (priceGold/2). Confirm interpretation with founder before using VALUE.');
  }
  return Math.ceil((h.priceGold / 2) / lumberGoldPrice);
}

// ── game-layer inventory (localStorage), same shape as battle-grid/craft.js (sts_gear/sts_forge) ──────
const LUMBER_KEY = 'sts_lumber'; // whole LUMBER units the player holds (game-layer mirror of the on-chain bal)
const BOATS_KEY = 'sts_boats';   // Set of owned hull keys (the ownership the boat token represents)

function hasLS() { return typeof localStorage !== 'undefined'; }

/** Read the player's whole LUMBER balance (game-layer). 0 if none / no storage. */
export function getLumber() {
  if (!hasLS()) return 0;
  const v = Number(localStorage.getItem(LUMBER_KEY) || '0');
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** Set the player's whole LUMBER balance (game-layer). Whole-number, never negative. */
export function setLumber(units) {
  if (!hasLS()) return;
  localStorage.setItem(LUMBER_KEY, String(Math.max(0, Math.floor(units))));
}

/** The set of hull keys the player owns a boat token for (game-layer). */
export function ownedBoats() {
  if (!hasLS()) return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(BOATS_KEY) || '[]')); }
  catch { return new Set(); }
}

function saveOwnedBoats(set) {
  if (!hasLS()) return;
  localStorage.setItem(BOATS_KEY, JSON.stringify([...set]));
}

/**
 * CRAFT a boat (game-layer settlement): debit LUMBER, credit the boat ownership token. Whole-number.
 * Throws (never silently fails) if the hull is unknown or the player lacks the LUMBER — the caller shows
 * the message. This is the SAME debit-then-credit shape the rest of seas uses (a recipe + a localStorage
 * inventory); the on-chain version is craftBoatOnChainPlan().
 * @param {string} hullKey
 * @returns {{ hull:string, spentLumber:number, lumberLeft:number, owns:string, alreadyOwned:boolean }}
 */
export function craftBoat(hullKey) {
  const r = boatRecipe(hullKey);
  const have = getLumber();
  if (have < r.lumberCost) {
    throw new Error(`not enough LUMBER to craft a ${r.name}: need ${r.lumberCost}, have ${have}. Mill more logs into lumber first.`);
  }
  const owned = ownedBoats();
  const alreadyOwned = owned.has(hullKey);
  // debit lumber (always — each craft consumes lumber, even a second hull of the same kind)
  const left = have - r.lumberCost;
  setLumber(left);
  // credit the ownership token (game-layer: owning the hull key). The on-chain token can be >1 balance;
  // the localStorage set just marks "owns this hull" — the chain holds the real fungible count.
  owned.add(hullKey);
  saveOwnedBoats(owned);
  return { hull: hullKey, spentLumber: r.lumberCost, lumberLeft: left, owns: r.yields, alreadyOwned };
}

/** Can the player craft this hull right now? (UI gate — does not mutate.) */
export function canCraftBoat(hullKey) {
  const r = boatRecipe(hullKey);
  const have = getLumber();
  return { ok: have >= r.lumberCost, need: r.lumberCost, have, hull: hullKey, name: r.name };
}

/**
 * DESCRIBE the real on-chain craft (does NOT broadcast). The on-chain version: (1) burn `lumberCost`
 * LUMBER from the player (transfer to a dead/sink address or a BoatCrafter contract), (2) the relayer
 * transfers `1` boat ownership token (boat-<hull>) to the player. Both legs are founder-gated: there is
 * no BoatCrafter contract yet, and the boat tokens are not deployed until deploy-boats.js --live runs.
 * This returns the PLAN so a tool/UI can show it honestly — real-or-nothing, never a fake tx.
 * @param {string} hullKey
 * @param {object} [boatsDeployed]  parsed boats-deployed.json (optional) — supplies the live token address
 */
export function craftBoatOnChainPlan(hullKey, boatsDeployed) {
  const r = boatRecipe(hullKey);
  const tokenAddr = boatsDeployed && boatsDeployed.boats && boatsDeployed.boats[r.yields]
    ? boatsDeployed.boats[r.yields].address : null;
  return {
    hull: hullKey,
    burn: { token: 'LUMBER', address: LUMBER_TOKEN, units: r.lumberCost, decimals: 18 },
    credit: { token: r.yields, address: tokenAddr, units: 1, decimals: 18 },
    deployed: !!tokenAddr,
    founderGated: [
      tokenAddr ? null : 'Boat ownership tokens not deployed yet — run deploy/deploy-boats.js --live (Coordinator).',
      'No BoatCrafter contract yet — burning LUMBER + releasing the boat token on-chain needs the same relayer/attestation pattern as fishing/harvest (founder-gated). Until then this is game-layer (localStorage) only.',
    ].filter(Boolean),
    note: 'PLAN only. Never broadcasts. Game-layer craftBoat() is the live path today.',
  };
}

/**
 * SHIPYARD_RELATIONSHIP — OPEN QUESTION for the founder (do NOT guess):
 *
 *   How does owning a boat token relate to launching a CREWED ship via ShipyardV5
 *   (build-ship.js → beginLaunchFor → launchWalls → finishLaunch)?
 *
 *   Two plausible designs — the founder must pick one (neither is built here):
 *     (A) GATE: a ShipyardV5 launch of hull X REQUIRES (and consumes/locks) one boat-X ownership token.
 *         Crafting the boat = the prerequisite; the Shipyard launch turns it into a crewed, sailing ship.
 *         This makes LUMBER → boat token → crewed ship a real supply chain.
 *     (B) PARALLEL: the boat token is a standalone ownership/trade asset; ShipyardV5 launches stay
 *         independent (pay the USDC fee, get a crew). The boat token is just a craftable collectible/hull
 *         deed that the Shipyard does NOT check.
 *
 *   Rowboat is settled either way: itemOnly:true — a plain owned item, never a crewed-ship prerequisite
 *   ("row boats may just need to be items, no free pawns/sails").
 *
 *   build-ship.js currently does NOT read any boat token (design B by default, because nothing else
 *   exists yet). If the founder wants design A, ShipyardV5/beginLaunchFor would need a boat-token check —
 *   that is a contract change to a LIVE deployment and is explicitly out of scope here.
 */
export const SHIPYARD_RELATIONSHIP_OPEN_QUESTION = true;
