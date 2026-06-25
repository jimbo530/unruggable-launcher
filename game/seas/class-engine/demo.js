// @ts-check
/**
 * demo.js — eyeball the engine resolving the REAL v1 triad + CHAR. Run: node demo.js
 * Endowment objects here are STUBS standing in for the future on-chain oracle read.
 */
import { resolve, makeConfig, computeStats } from "./index.js";

const config = makeConfig();

/** Display helper: round float dust (e.g. 16.6666…) to 1 dp for clean output. */
function fmtStats(stats) {
  return Object.fromEntries(Object.entries(stats).map(([k, val]) => [k, Math.round(val * 10) / 10]));
}

const scenarios = {
  "Focused BURGERS endower ($40 burgers)": { burgers: 40 },
  "Focused TGN endower ($40 tgn)": { tgn: 40 },
  "Focused EGP endower ($40 egp)": { egp: 40 },
  "Bought-water player ($60 regular water, diffuse)": { _diffuse: 60 },
  "Mixed endower ($24 burgers + $16 tgn)": { burgers: 24, tgn: 16 },
  "Full-triad endower ($20 each of burgers/tgn/egp)": { burgers: 20, tgn: 20, egp: 20 },
  "Earned generalist ($40 bluechip)": { bluechip: 40 },
  "CHAR endower ($20 char, 1.5x rate, WIS/CON split)": { char: 20 },
  "GLASS CANNON: pure PUMP ($20 pump, 1.0x rate → big INT, base HP)": { pump: 20 },
  "SURVIVABLE NUKER: PUMP (1.0x) + CHAR (1.5x) ($20 pump + $16 char)": { pump: 20, char: 16 },
};

for (const [label, endowment] of Object.entries(scenarios)) {
  const v = resolve(endowment, config);
  console.log("\n=== " + label + " ===");
  console.log(`total level ${v.totalLevel}  bracket ${v.bracket.id} (${v.bracket.label})  HP ${v.hp}`);
  console.log("stats:", fmtStats(v.stats));
  const causeLine = v.perCause.map((p) => `${p.name} L${p.level} ${(p.share * 100).toFixed(0)}% (${p.statLabel})`).join(", ");
  console.log("causes:", causeLine || "(none — bought water only)");
  console.log(
    "qualified:",
    v.qualified.map((q) => `${q.name}[T${q.tier} L${q.classLevel} ${q.primaryStat} DC${q.saveDC}]`).join(", ") || "(none)",
  );
  console.log(`loadout cap ${v.loadoutOptions.cap}, suggested: [${v.loadoutOptions.suggested.join(", ")}]`);
}

// ── pointRate efficiency (CHAR 1.5x split) ─────────────────────────────────
console.log("\n=== pointRate efficiency: CHAR (1.5x, WIS/CON split) ===");
const char = computeStats({ char: 20 }, config.causes);
console.log(`$20 CHAR → 20 * 1.5 = 30 stat points, split WIS/CON → +15 WIS, +15 CON (before caps)`);
console.log(`  raw:    WIS ${char.raw.WIS}  CON ${char.raw.CON}`);
console.log(`  capped: WIS ${char.stats.WIS}  CON ${char.stats.CON}  → HP ${char.hp} (CON ${char.stats.CON} drives +${char.stats.CON - 10} HP)`);
const tgn = computeStats({ tgn: 20 }, config.causes);
console.log(`Contrast $20 TGN (1.0x): raw WIS ${tgn.raw.WIS} (1.0 pts/$1, WIS half of split). CHAR is 1.5x more point-efficient per $1.`);

// ── CON → HP demonstration ─────────────────────────────────────────────────
console.log("\n=== CON → HP (CON is always good: it's HP) ===");
for (const usd of [0, 10, 20, 40]) {
  const s = computeStats(usd === 0 ? {} : { burgers: usd }, config.causes); // burgers splits STR/CON
  console.log(`$${usd} burgers → CON ${s.stats.CON}  HP ${s.hp}  (HP = 10 + (CON - 10))`);
}

// ── GLASS CANNON vs SURVIVABLE NUKER ───────────────────────────────────────
console.log("\n=== GLASS CANNON (pure PUMP) vs SURVIVABLE NUKER (PUMP + CHAR) ===");
const cannon = resolve({ pump: 20 }, config);
const wzC = cannon.qualified.find((q) => q.id === "wizard");
console.log(`Pure PUMP $20:   INT ${cannon.stats.INT} (spell DC ${wzC.saveDC})  CON ${cannon.stats.CON}  HP ${cannon.hp}  ← squishy, base HP`);
const nuker = resolve({ pump: 20, char: 16 }, config);
const wzN = nuker.qualified.find((q) => q.id === "wizard");
console.log(`PUMP+CHAR:       INT ${nuker.stats.INT} (spell DC ${wzN.saveDC})  CON ${nuker.stats.CON}  HP ${nuker.hp}  ← still nukes, now survives`);
console.log(`Synergy: CHAR's WIS/CON split lifts CON ${cannon.stats.CON}→${nuker.stats.CON} → HP ${cannon.hp}→${nuker.hp}. Squishy casters splash the CON/HP cause.`);
console.log(`Note: PUMP is 1.0x (NORMAL) — players RECEIVE PUMP tokens, so no stat bonus. Bonus rates (CHAR 1.5x) only COMPENSATE for FORGONE tokens; never double-dip.`);
