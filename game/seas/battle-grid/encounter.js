// @ts-check
/**
 * encounter.js — VOYAGE-ENCOUNTER BRIDGE ("Seize the Seas" departure → battle-grid).
 *
 * WHAT THIS IS
 *   The location core lib (game/lib/location.js) exposes
 *       setSail(shipId, toPort, sailSpeed) -> { journey, encounter }
 *   and, when the route rolls a fight, `encounter` is:
 *       { type:'pve', danger, routeId, enemy:{ id, name, endowment, loadout } }
 *   where `enemy` is shaped EXACTLY like a pvp.html opponent snapshot.
 *
 *   This bridge routes that PVE encounter into the EXISTING async-PVP battle path with
 *   ZERO new combat code: it writes `enemy` under the SAME `sts_pvp_opponent` key the
 *   PVP page uses, then opens the deck in `?mode=encounter`. units.js builds the foe the
 *   same way it builds a PVP rival; game.js sets stakes=true + arena="water" and frames
 *   it as "Raiders on the route!" instead of a duel.
 *
 * THE FLOW
 *   1) Departure UI calls setSail() → gets { journey, encounter }.
 *   2) handleSetSail(result, opts) — if a PVE encounter rolled, launches the fight.
 *   3) WIN  → the deck links the player back to opts.returnTo (resume the voyage). The
 *             journey time-lock from setSail keeps running to arrival on its OWN — this
 *             bridge does NOT re-implement the lock; it only steers the player back.
 *      LOSS → the gear-loss sink the combat already applies stands; the player limps back.
 *
 * Game-layer / localStorage ONLY. No on-chain, no network. node --check clean.
 */

const LS_OPP = "sts_pvp_opponent";   // SAME key pvp.html + units.js use → reuse the foe-build path
const LS_CTX = "sts_encounter";      // voyage-encounter context: framing + where to resume

// Defaults assume the game is served from the `game/` root (e.g. `npx serve game/`), so
// these absolute paths resolve from ANY departure/map page regardless of its folder depth.
// Override via opts.battleUrl / opts.returnTo if your server root differs.
const DEFAULT_BATTLE_URL = "/seas/battle-grid/index.html?mode=encounter";
const DEFAULT_RETURN_TO  = "/seas/";   // the seas hub / voyage map to resume toward

function hasLS() { return typeof localStorage !== "undefined"; }

/** Validate the location-lib encounter shape. THROWS (never silent) on a malformed PVE
 *  encounter, so a wiring bug is loud rather than a silent no-fight. */
function assertPveEncounter(encounter) {
  if (!encounter || typeof encounter !== "object")
    throw new Error("encounter.js: encounter is missing / not an object.");
  if (encounter.type !== "pve")
    throw new Error(`encounter.js: encounter.type must be "pve" (got ${JSON.stringify(encounter.type)}).`);
  const e = encounter.enemy;
  if (!e || typeof e !== "object" || !e.endowment || typeof e.endowment !== "object")
    throw new Error("encounter.js: encounter.enemy needs an { endowment } object — units.js builds the foe from it.");
}

/**
 * ARM (store) a voyage encounter WITHOUT navigating. Writes the enemy snapshot under the
 * SAME `sts_pvp_opponent` key the async-PVP path reads, plus a context blob (framing +
 * return). Returns the battle URL to open. THROWS on a bad encounter shape.
 *
 * @param {{type:string, danger?:any, routeId?:any, enemy:{id?:string,name?:string,endowment:object,loadout?:object}}} encounter
 * @param {{ battleUrl?:string, returnTo?:string }} [opts]
 * @returns {string} the battle URL (?mode=encounter)
 */
export function armVoyageEncounter(encounter, opts = {}) {
  assertPveEncounter(encounter);
  if (!hasLS()) throw new Error("encounter.js: localStorage unavailable (this is a game-layer bridge).");
  const battleUrl = opts.battleUrl || DEFAULT_BATTLE_URL;
  const returnTo  = opts.returnTo  || DEFAULT_RETURN_TO;
  // enemy snapshot → the EXACT shape pvp.html writes; units.js buildOpponentUnit reads it.
  localStorage.setItem(LS_OPP, JSON.stringify(encounter.enemy));
  const ctx = {
    active: true,
    status: "pending",                         // "pending" → "win" | "loss" | "draw"
    routeId: encounter.routeId ?? null,
    danger: encounter.danger ?? null,
    enemyName: (encounter.enemy && encounter.enemy.name) || "Raiders",
    returnTo,
    battleUrl,
    startedAt: Date.now(),
  };
  localStorage.setItem(LS_CTX, JSON.stringify(ctx));
  return battleUrl;
}

/**
 * ARM + NAVIGATE: store the encounter, then send the player into the battle deck framed as
 * "Raiders on the route!". On WIN the deck links back to `returnTo` (resume the voyage);
 * the journey time-lock from setSail keeps running to arrival on its own.
 *
 * @param {object} encounter  the location-lib PVE encounter
 * @param {{ battleUrl?:string, returnTo?:string }} [opts]
 * @returns {string} the battle URL it navigated to
 */
export function launchVoyageEncounter(encounter, opts = {}) {
  const url = armVoyageEncounter(encounter, opts);
  if (typeof window !== "undefined" && window.location) window.location.href = url;
  return url;
}

/**
 * DEPARTURE HOOK — feed the WHOLE setSail() result in. If the route rolled a PVE encounter,
 * launches the fight and returns true. Otherwise returns false → the caller proceeds
 * straight to the journey. Keeps the departure call-site a one-liner:
 *
 *     const sail = setSail(shipId, toPort, sailSpeed);              // location.js
 *     if (!handleSetSail(sail, { returnTo: mapUrl })) {
 *        proceedToJourney(sail.journey);   // no encounter → sail on
 *     }                                    // else: fight first, then resume on WIN
 *
 * @param {{ journey?:any, encounter?:any }} result  the setSail() return
 * @param {{ battleUrl?:string, returnTo?:string }} [opts]
 * @returns {boolean} true if a battle was launched (caller should stop here)
 */
export function handleSetSail(result, opts = {}) {
  const enc = result && result.encounter;
  if (enc && enc.type === "pve") { launchVoyageEncounter(enc, opts); return true; }
  return false;
}

/** Read the active voyage-encounter context (framing + return), or null if none. */
export function readEncounter() {
  if (!hasLS()) return null;
  try {
    const raw = localStorage.getItem(LS_CTX);
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    return ctx && ctx.active ? ctx : null;
  } catch (e) {
    console.warn("encounter context parse failed:", e);   // visible, not silent
    return null;
  }
}

/** True if a voyage encounter is currently armed. */
export function isEncounterActive() { return !!readEncounter(); }

/**
 * Mark the encounter resolved (win/loss/draw) and return the (updated) context so the
 * caller can route the player back toward the voyage. Does NOT clear the opponent snapshot,
 * so an in-battle Reset can re-fight the same raiders; clearEncounter() wipes it on exit.
 *
 * @param {"win"|"loss"|"draw"} outcome
 * @returns {object|null} the updated context (with returnTo), or null if none was active
 */
export function resolveEncounter(outcome) {
  const ctx = readEncounter();
  if (!ctx) return null;
  ctx.status = outcome;
  ctx.resolvedAt = Date.now();
  if (hasLS()) {
    try { localStorage.setItem(LS_CTX, JSON.stringify(ctx)); }
    catch (e) { console.warn("encounter resolve persist failed:", e); }   // visible, not silent
  }
  return ctx;
}

/** Clear ALL voyage-encounter state (context + the borrowed opponent snapshot). Call when
 *  the player leaves the encounter for good (e.g. after resuming the voyage). */
export function clearEncounter() {
  if (!hasLS()) return;
  try { localStorage.removeItem(LS_CTX); localStorage.removeItem(LS_OPP); }
  catch (e) { console.warn("encounter clear failed:", e); }   // visible, not silent
}
