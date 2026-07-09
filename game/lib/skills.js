// @ts-check
// skills.js — the SKILLS LEDGER for Seize the Seas (game-layer, no chain). Founder's ruling
// (2026-07-06): "skills = different water tokens even if the backend function is the same — the
// alchemist and the smith both pay GOLD but are very different skills; less-refined work for COPPER
// points to a skill or stat or set of stats." So a job's COIN tier (copper/silver/gold) does NOT
// tell you WHAT a pawn got good at — two gold jobs can be worlds apart. This ledger is the seam.
//
// TWO LEDGERS, ONE SHIFT (founder doctrine):
//  • COPPER-tier UNSKILLED labor (haul cargo, guard the port, raw logging) trains RAW STATS only —
//    that's the existing K_XP path in jobs-loop.js, UNCHANGED. Grunt work builds the body/mind, not a craft.
//  • SKILLED CRAFTS (smithing, alchemy, …) ALSO accrue their own SKILL water HERE, on top of the stat XP.
//    A skill is tied to a STAT PAIR (its "governing stats") and a COIN TIER (what mastering it pays).
//
// DOCTRINE — LEDGER FIRST, NO TOKEN DEPLOYS. Per-skill on-chain water tokens (a $SMITHING, a $ALCHEMY)
// come LATER, only once a system READS a skill (a recipe gate, a forge tier). Deploying immutable skill
// tokens now = a premature lock (see memory feedback_no_premature_lock). This module is where those
// tokens will hydrate FROM — same readJSON/writeJSON shim as jobs-loop.js, so it's already chain-ready.
//
// XP CURVE DIAL: skillLevel = floor( sqrt( xp / XP_PER_LEVEL_BASE ) ). Quadratic, D&D-ish — each level
// costs more than the last (level N needs N²·base xp). With XP_PER_LEVEL_BASE=10: L1=10xp, L2=40, L3=90,
// L5=250, L10=1000. Raise the base to slow mastery; a shift grants ~statRate xp (1 wild · 3 town · 5 city),
// so a city craftsman hits L5 in ~50 shifts. Tune here, one dial.

// ── storage (localStorage in browser; in-memory shim under Node) — same pattern as jobs-loop.js ──
const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
})();
const K_SKILLS = "sts_skills"; // { [pawnId]: { [skill]: xp } }  per-skill craft XP (the seam to on-chain skill water)

function readJSON(key, fb) { const r = store.getItem(key); if (r == null) return fb; try { return JSON.parse(r); } catch (e) { console.warn(`[skills] bad JSON ${key}:`, e); return fb; } }
function writeJSON(key, v) { store.setItem(key, JSON.stringify(v)); }

// ── dials ────────────────────────────────────────────────────────────────────────────────
export const XP_PER_LEVEL_BASE = 10; // level = floor(sqrt(xp / this)); raise to slow mastery

// ── SKILL REGISTRY ─────────────────────────────────────────────────────────────────────────
// A craft skill: id, name, `stats` (its governing STAT PAIR — the D&D attributes the craft leans on),
// `coin` (the tier mastering it ultimately pays: copper < silver < gold — the "refinement" of the work),
// and `desc`. NOTE: stats here are FLAVOR/GATING metadata for a later recipe/feat system — accruing skill
// XP does NOT auto-train these stats (that stays the JOB's single tagged stat in jobs-loop.js). Two skills
// can share a coin tier and still be totally different crafts (founder: alchemist ≠ smith, both gold).
export const SKILLS = {
  smithing:  { id: "smithing",  name: "Smithing",  stats: ["STR", "CON"], coin: "gold",   desc: "Forge weapons, tools & armor at the anvil" },
  alchemy:   { id: "alchemy",   name: "Alchemy",   stats: ["INT", "WIS"], coin: "gold",   desc: "Brew potions, reagents & transmutations" },
  carpentry: { id: "carpentry", name: "Carpentry", stats: ["STR", "DEX"], coin: "silver", desc: "Shape lumber into structures, hulls & fittings" },
  cooking:   { id: "cooking",   name: "Cooking",   stats: ["WIS", "CON"], coin: "silver", desc: "Turn raw catch & crop into hearty rations" },
  sailing:   { id: "sailing",   name: "Sailing",   stats: ["DEX", "WIS"], coin: "silver", desc: "Read wind & tide, work the rigging & helm" },
  tailoring: { id: "tailoring", name: "Tailoring", stats: ["DEX", "INT"], coin: "copper", desc: "Sew sails, cloth, garments & light gear" },
};

// ── JOB → SKILL MAP ─────────────────────────────────────────────────────────────────────────
// Which craft a JOB trains (keyed by jobId — kept HERE so settlements.js needs no edits; skills.js
// owns the mapping). A job absent from this map is UNSKILLED labor (copper grunt work): it trains its
// raw stat via jobs-loop's K_XP path and accrues NO skill water. As new SKILLED jobs are added to the
// JOB ROSTER, wire them here. `skillForJob(job)` is the single lookup the loop calls.
const JOB_SKILL = {
  // wild PRODUCTION that's actually a CRAFT (refines raw goods, not just gathers them)
  milling:     "carpentry", // milling logs → lumber is the shaping craft; raw `logging` stays unskilled
  vinekeeping: "alchemy",   // tending vines → the vintner's craft (fermenting is alchemy's cousin)
  // NOTE: haul_cargo / guard_port / logging / fishing / crabbing / farming = UNSKILLED (stat-only).
  // Future skilled jobs (a `smithy` job → smithing, a `galley` job → cooking, a `helm` job → sailing,
  // a `sailmaker` job → tailoring) slot in here when their JOBS rows land — no settlements.js change.
};

// ── skill XP + levels ────────────────────────────────────────────────────────────────────────
function allSkills() { const s = readJSON(K_SKILLS, {}); return s && typeof s === "object" ? s : {}; }

/** Which craft skill (id) a job trains, or null if it's unskilled labor. Deterministic, source of truth. */
export function skillForJob(job) {
  if (!job) return null;
  const id = typeof job === "string" ? job : job.id;
  return JOB_SKILL[id] || null;
}

/** Accrue `amount` XP into a pawn's `skill`. THROWS on an unknown skill or bad amount (no silent drop). */
export function addSkillXp(pawnId, skill, amount) {
  if (!SKILLS[skill]) throw new Error(`addSkillXp: unknown skill "${skill}"`);
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) throw new Error(`addSkillXp: bad amount ${amount}`);
  const s = allSkills(); s[pawnId] = s[pawnId] || {};
  s[pawnId][skill] = (s[pawnId][skill] || 0) + amount; writeJSON(K_SKILLS, s);
  return s[pawnId][skill];
}

/** A pawn's whole skill ledger → { [skill]: xp } (empty object if none). */
export function skillsOf(pawnId) { return allSkills()[pawnId] || {}; }

/** A pawn's LEVEL in one skill: floor(sqrt(xp / XP_PER_LEVEL_BASE)). 0 if untrained. */
export function skillLevel(pawnId, skill) {
  const xp = (allSkills()[pawnId] || {})[skill] || 0;
  return Math.floor(Math.sqrt(xp / XP_PER_LEVEL_BASE));
}
