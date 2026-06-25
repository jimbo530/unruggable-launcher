// @ts-check
/**
 * config/causes.js — REAL v1 CAUSE ROSTER (launch base). Designer may still edit.
 *
 * The founder's real cause triad + the bought regular WATER (diffuse) + an EARNED
 * generalist (bluechip). Each cause maps a charitable endowment target to an
 * archetype family + the stat(s) its earned ("concentrated") water grows.
 *
 * `stat` may be a single stat OR a weighted SPLIT { STR: 0.5, CON: 0.5 } (weights
 * sum to 1.0). A split divides the concentrated $ across the named stats — it is
 * NOT the 1/6 diffuse spread (which is unchanged, reserved key "_diffuse").
 *
 * @typedef {import("../schema.js").Cause} Cause
 */

/** @type {Cause[]} */
export const CAUSES = [
  // ── The founder's real triad ──────────────────────────────────────────────
  {
    id: "burgers",
    name: "Burgers",
    family: "Melee-DPS",              // melee / tank body
    stat: { STR: 0.5, CON: 0.5 },     // brawn + staying power
    tokenRef: "BURGERS",
    note: "v1 triad — frontline brute. Earned water splits STR/CON.",
  },
  {
    id: "tgn",
    name: "TGN (Treegens)",
    family: "Nature",                 // nature / support
    stat: { WIS: 0.5, CHA: 0.5 },     // grove wisdom + rallying presence
    tokenRef: "TGN",
    note: "v1 triad — Grove orator/support. Earned water splits WIS/CHA.",
  },
  {
    id: "egp",
    name: "EGP",
    family: "Gish",                   // gish / skirmisher
    stat: { DEX: 0.5, INT: 0.5 },     // finesse + arcane cunning
    tokenRef: "EGP",
    note: "v1 triad — elven spellblade. Earned water splits DEX/INT.",
  },

  // ── CHAR — forgone-airdrop burn cause (extra-impact, +50% stat rate) ──────
  {
    id: "char",
    name: "CHAR",
    family: "Nature",
    stat: { WIS: 0.5, CON: 0.5 },     // durable nature guardian → WIS/CON (maps to Warden)
    pointRate: 1.5,                   // 1.5 stat points per $1 → net 0.75 WIS + 0.75 CON per $1
    tokenRef: "CHAR",
    note:
      "DESIGN: the player NEVER receives a CHAR airdrop. The forgone airdrop CHAR is " +
      "BURNED (removed from circulation) at the endowment rate. The +50% stat rate " +
      "(1.5 pts/$1) is the in-game reward for forgoing those tokens — no token ever " +
      "goes to the player, only stats + a burn. Split WIS/CON (0.75 each per $1).",
  },

  // ── CCC — carbon-counting biochar cause (STR, +50% rate, burned impact) ───
  {
    id: "ccc",
    name: "CCC",
    family: "Melee-DPS",              // burying carbon = heavy physical labor → STR
    stat: "STR",                      // hauling tons of feedstock/biochar = raw strength
    pointRate: 1.5,                   // verified impact REMOVED from circulation (like CHAR) → +50%
    tokenRef: "CCC",
    note:
      "Carbon counting (1 CCC = 1 lb CO2e biochar). Like CHAR, the impact is a VERIFIED " +
      "removal from circulation — never an airdrop to the player — so +50% rate (1.5 pts/$1). " +
      "Maps to STR: putting carbon in the ground is heavy physical work (founder has buried " +
      "10+ tons IRL). Pure STR anchor.",
  },

  // ── PUMP — solar water-pump engineering cause (INT, +50% rate) ────────────
  {
    id: "pump",
    name: "PUMP",
    family: "Arcane",
    stat: "INT",                      // solar-powered water pumps = engineering/tech = INT
    pointRate: 1.0,                   // NORMAL rate — no bonus (see RULE below)
    tokenRef: "PUMP",
    note:
      "Funds solar(-powered water) pumps — engineering/tech, so INT. pointRate 1.0 " +
      "(NORMAL, no bonus): PUMP players DO receive PUMP token flow (the airdrop reaches " +
      "them) AND the endowment funds on-the-ground solar/water — so NO stat bonus is " +
      "warranted. RULE: the >1.0 pointRate bonus is COMPENSATION for tokens the player " +
      "FORGOES (CHAR's airdrop is burned → 1.5; PUMP's tokens reach the player → 1.0). " +
      "Never double-dip (tokens AND bonus). Pure-INT, NO CON → still a GLASS CANNON: " +
      "high spell DC, base HP — just takes more $ to cap INT now, offset by receiving " +
      "PUMP tokens. Splash a CON cause (CHAR/BURGERS) to survive.",
  },

  // ── Earned generalist (bluechip) ──────────────────────────────────────────
  {
    id: "bluechip",
    name: "Bluechip",
    family: "Generalist",
    // Balanced BUT EARNED: concentrated water spreads evenly across all six stats.
    // (Distinct from bought "_diffuse" water — this is earned, so it still counts
    //  as a cause with its own level/share and can gate the Generalist class.)
    stat: { STR: 1 / 6, DEX: 1 / 6, CON: 1 / 6, INT: 1 / 6, WIS: 1 / 6, CHA: 1 / 6 },
    tokenRef: "BLUECHIP",
    note: "Earned generalist — even six-way split. Feeds the Generalist class.",
  },

  // NOTE: bought regular WATER uses the reserved endowment key "_diffuse" (1/6
  // even spread). It is NOT a cause object — it is supplied directly in the
  // endowment map, e.g. { _diffuse: 60 }. See resolver.js DIFFUSE_KEY.
];
