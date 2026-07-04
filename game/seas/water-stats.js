/*
  water-stats.js — the GAME'S reader for water-driven levels & stats (founder 2026-06-27).
  Loads the STATIC snapshot (water-levels.json, rebuilt periodically; vaults are add-only so it's
  never too-high) and resolves each pawn via the class-engine. NO per-pawn live RPC.
    LEVEL    = $1 per $1 water    · CLASS LEVEL = floor(level/5)   · base stat 10 + water
    balanced (plain) water → Fighter. crewId = "<collection>:<tokenId>". Absent = level 0.
  Usage (ESM):
    import { loadWaterLevels, sheetOf } from "../water-stats.js";
    await loadWaterLevels("../");          // base path to where water-levels.json is served
    const s = sheetOf(crewId);             // { level, classLevel, class, stats, levelFrac, classProgress, endowment }
*/
import { resolve, makeConfig } from "./class-engine/index.js";

const CFG = makeConfig();
let _snap = null;   // { crewId: endowmentMap }

/** Load (once) the static snapshot. `base` is the URL prefix to water-levels.json. */
export async function loadWaterLevels(base = "") {
  if (_snap) return _snap;
  try {
    const res = await fetch(base + "water-levels.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    _snap = (j && j.endowments) || {};
  } catch (e) {
    console.warn("[water-stats] snapshot load failed — everyone defaults to level 0:", e.message || e);
    _snap = {};   // honest fallback: no water known → level 0 (never a faked level)
  }
  return _snap;
}

/** The raw endowment map for a pawn ({} = unwatered = level 0). */
export function endowmentOf(crewId) { return (_snap && _snap[crewId]) || {}; }

/** Full character sheet for a pawn, resolved from its real water. */
export function sheetOf(crewId) {
  const endowment = endowmentOf(crewId);
  let v;
  try { v = resolve(endowment, CFG); } catch (e) { console.warn("[water-stats] resolve failed:", e); v = { totalLevel: 0, stats: null, qualified: [] }; }
  const usd = Number(v.totalLevel || 0);            // $1 = 1 level (may be fractional)
  const level = Math.floor(usd);
  const classLevel = Math.floor(level / 5);          // every 5 levels = 1 class level
  const cls = classLevel >= 1
    ? ((v.qualified && v.qualified[0] && v.qualified[0].name) || "Fighter")  // balanced still → Fighter
    : "Deckhand";                                    // < level 5 → no class yet
  return {
    crewId, endowment, level, classLevel, class: cls,
    stats: v.stats || null,                          // {STR,DEX,CON,INT,WIS,CHA} base10+water (null if unresolved)
    levelFrac: usd - level,                          // progress (0..1) toward the NEXT level
    classProgress: (level % 5) / 5,                  // progress (0..1) toward the NEXT class level
    toNextClass: classLevel >= 1 ? (5 - (level % 5)) % 5 || 5 : 5 - (level % 5), // levels until next class
    usd,
  };
}

/** Convenience: just the level. */
export function levelOf(crewId) { return sheetOf(crewId).level; }
