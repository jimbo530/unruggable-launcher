// @ts-check
/**
 * terrain-effects.js — the DATA-DRIVEN terrain RULES that make a deck's authored terrain
 * (maps/<id>.js) actually MATTER in combat. PURE + node-safe: no DOM, no chain, no dice. It
 * reads a terrain INDEX (the "q,r"→cell Map that maps/index.js terrainIndex() builds) and a
 * hex, and answers four questions the battle driver (game.js) wires in ADDITIVELY:
 *
 *   • coverACAt(ix, hex)    → the +AC a unit standing on a COVER tile gains (game.js feeds this
 *                             into the strike()/forecast() CHOKEPOINT so a swing at a screened
 *                             foe is harder — never a second combat path).
 *   • blockedKeys(ix)       → the set of impassable WALL hexes, UNION'd into game.js occupiedSet()
 *                             so move reachability + the occupied set both treat walls as solid
 *                             (the design INTEGRATION.md §"blocking" already calls for).
 *   • hazardAt / waterEdgeAt / tileEntryEffect(ix, hex)
 *                           → what happens when a unit ENTERS a hex: a HAZARD stings (small
 *                             damage and/or a status); a WATER-EDGE forces a reflex save or an
 *                             overboard plunge (the d20 for that save lives in combat-helpers,
 *                             the chokepoint — this module only describes the rule).
 *
 * Per-type DEFAULT magnitudes live in TERRAIN_EFFECTS; a single terrain cell may OVERRIDE them
 * with a `mod` (e.g. cover {ac:3}, hazard {dmg:4} or {status:{…}}, water-edge {overboardDC:14}).
 * COVER/DIFFICULT/deep-WATER never trigger an on-enter effect; DIFFICULT + deep-WATER are inert
 * here on purpose (variable move-cost would mean touching the verbatim BFS — out of scope).
 *
 * Back-compat: a missing index / unknown hex / un-authored deck → 0 / null / empty set, so every
 * duel + training fight (no terrain data) behaves EXACTLY as before. node --check clean. ESM.
 */

/**
 * Default per-type effect magnitudes. A cell's optional `mod` overrides the matching field.
 * @type {Record<string, {ac?:number, dmg?:number, overboardDC?:number, overboardDmg?:number, blocks?:boolean}>}
 */
export const TERRAIN_EFFECTS = {
  cover:        { ac: 2 },                              // +AC to a unit on this hex
  hazard:       { dmg: 2 },                             // damage on ENTERING (also honors mod.status)
  "water-edge": { overboardDC: 12, overboardDmg: 4 },  // reflex save or fall overboard, on ENTERING
  wall:         { blocks: true },                       // impassable (movement + occupancy)
  water:        { blocks: false },                      // deep water — inert for now (unused by decks)
  difficult:    {},                                     // difficult ground — advisory only (BFS unchanged)
};

const K = (h) => `${h.q},${h.r}`;
const intOr = (v, dflt) => (Number.isFinite(v) ? Math.trunc(Number(v)) : dflt);

/** The terrain cell on a hex, or null. (`ix` is the maps/index.js terrainIndex Map.) */
export function terrainCellAt(ix, hex) {
  if (!ix || !hex) return null;
  return ix.get(K(hex)) || null;
}

/** Is THIS cell impassable? wall by default; a cell may force it either way with mod.blocks. */
export function blocksMovement(cell) {
  if (!cell) return false;
  if (cell.mod && typeof cell.mod.blocks === "boolean") return cell.mod.blocks;
  const rule = TERRAIN_EFFECTS[cell.type];
  return !!(rule && rule.blocks);
}

/** Is the hex impassable terrain? */
export function isBlocked(ix, hex) {
  return blocksMovement(terrainCellAt(ix, hex));
}

/**
 * The "q,r" keys of every impassable terrain cell on a deck. game.js UNIONs this into
 * occupiedSet() so the move-range BFS can't enter or path through a wall (→ unreachable) and the
 * occupied set treats it as solid. Empty for a duel/training deck (no terrain).
 * @returns {Set<string>}
 */
export function blockedKeys(ix) {
  const out = new Set();
  if (!ix) return out;
  for (const [k, cell] of ix) if (blocksMovement(cell)) out.add(k);
  return out;
}

/** The +AC a unit gains from COVER on this hex (0 if it's not cover). Honors cell.mod.ac. */
export function coverACAt(ix, hex) {
  const c = terrainCellAt(ix, hex);
  if (!c || c.type !== "cover") return 0;
  const v = c.mod && Number.isFinite(c.mod.ac) ? Math.trunc(Number(c.mod.ac)) : TERRAIN_EFFECTS.cover.ac;
  return Math.max(0, v);
}

/**
 * The HAZARD on a hex (or null): a unit ENTERING takes `dmg` and/or gains a `status` effect.
 * @returns {{type:"hazard", dmg:number, status:object|null, label:string, prop:string|null}|null}
 */
export function hazardAt(ix, hex) {
  const c = terrainCellAt(ix, hex);
  if (!c || c.type !== "hazard") return null;
  const dmg = Math.max(0, c.mod && Number.isFinite(c.mod.dmg) ? Math.trunc(Number(c.mod.dmg)) : TERRAIN_EFFECTS.hazard.dmg);
  return { type: "hazard", dmg, status: (c.mod && c.mod.status) || null, label: c.label || "Hazard", prop: c.prop || null };
}

/**
 * The WATER-EDGE on a hex (or null): a unit ENTERING must make a DEX reflex save vs `dc` or fall
 * overboard for `dmg` (the save roll itself is resolved by combat-helpers — the chokepoint).
 * @returns {{type:"water-edge", dc:number, dmg:number, label:string, prop:string|null}|null}
 */
export function waterEdgeAt(ix, hex) {
  const c = terrainCellAt(ix, hex);
  if (!c || c.type !== "water-edge") return null;
  const dc = intOr(c.mod && c.mod.overboardDC, TERRAIN_EFFECTS["water-edge"].overboardDC ?? 12);
  const dmg = Math.max(0, intOr(c.mod && c.mod.overboardDmg, TERRAIN_EFFECTS["water-edge"].overboardDmg ?? 4));
  return { type: "water-edge", dc, dmg, label: c.label || "Water edge", prop: c.prop || null };
}

/**
 * The on-ENTER effect for a hex (water-edge takes priority over a co-located hazard), or null when
 * nothing triggers (cover/wall/difficult/empty). game.js calls this right after a unit settles on
 * a hex and applies the result through its existing applyDamage / activeEffects paths.
 * @returns {ReturnType<typeof hazardAt> | ReturnType<typeof waterEdgeAt> | null}
 */
export function tileEntryEffect(ix, hex) {
  return waterEdgeAt(ix, hex) || hazardAt(ix, hex) || null;
}

export default { TERRAIN_EFFECTS, terrainCellAt, blocksMovement, isBlocked, blockedKeys, coverACAt, hazardAt, waterEdgeAt, tileEntryEffect };
