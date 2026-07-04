// @ts-check
/**
 * structure-kinds.js — the STRUCTURE KIND CATALOG for the CAMP → TOWN build system (founder 2026-06-27).
 *
 * THIS IS A DESIGN CONFIG, NOT A DEPLOY. It describes one row per buildable structure so the
 * founder-gated StructureFactory.addKind(...) calls can be generated from it directly. Nothing here
 * deploys, registers, or moves value — it is the single source of truth for "what is buildable, what
 * it costs, what it produces, and the two modular waters it composes."
 *
 * TWO LAYERS PER STRUCTURE (founder RESOLVED 2026-06-27 — this reconciles "locked" vs "player-owned"):
 *
 *   (a) FOUNDATION layer = the structure token + its LOCATION vault = LOCKED, owned-but-IMMOBILE.
 *       The player's FIXED stake/capacity at that hex. Crafted in place, can NEVER be relocated, value
 *       locked. The founder EXPLICITLY accepts this lock for settlements — it is NOT a premature-lock
 *       concern; a foundation is meant to be permanent. Risk/loss only later via the opt-in PVP
 *       "untamed wilds." -> This is exactly StructureFactory build -> seal() -> WaterV2 tree (the LIVE
 *       primitive FITS layer (a)). The goldCost re-locks here.
 *
 *   (b) BUSINESS layer = the manufacturing LPs + the STOCK flowing through them = PLAYER-OWNED,
 *       WITHDRAWABLE working capital. The owner paid to build the business, so they OWN the conversion
 *       LP + its stock and can WITHDRAW it (pull logs/lumber — one side or both). Two waters pay the
 *       people: a GOODS-water (the produced good) + a COPPER wage-water (the crew) — owners AND workers
 *       earn. Chains are multi-step on THIN conversion LPs (logs->lumber->boats; berries->wine/pies).
 *
 *   ⚠ CONTRACT FLAG (do NOT misrepresent the live primitives): layer (b)'s owner-WITHDRAWABLE
 *     manufacturing pool is a NEW contract variant that does NOT exist yet. The two live primitives
 *     BOTH LOCK and neither lets an owner pull stock back out:
 *       • StructureFactory.seal() waters the seed into a WaterV2 tree -> locked FOREVER (fits layer (a)).
 *       • LocationPool is ADD-ONLY (never admin-/owner-withdrawable) — does NOT fit layer (b).
 *     So a new "ManufacturingPool" is needed for layer (b): owner can withdraw either/both sides;
 *     location-keyed; goods-water + COPPER wage-water pay owner + workers. This config describes the
 *     DESIGN target; the layer-(b) contract is unbuilt. `foundationVault`/`resourceWater` below back
 *     layer (a) (live-wireable); `businessLP` marks the layer-(b) pool (needs the new contract).
 *
 *   CAPACITY (founder refinement): bunks + workshops LIMIT how many manufacturing LPs a player runs —
 *     each bunk/workshop is a SLOT. lpCapFor({bunks, workshops}) models the per-player LP cap. So you
 *     build foundations (a) to UNLOCK the right to run businesses (b). Bunk ≈ 1000g; workshop = +500g.
 *
 *   SKINNING (UX): costs are framed as the operational steps to GO LIVE — buy the mill -> hire the
 *     workers -> get the stock -> set up shop. Each step is a real cost that buys real in-game power.
 *
 *   Contrast BOATS — fully movable/tradeable, NOT location-keyed at all (boat-craft.js).
 *
 * GROUNDED IN THE REAL CONTRACT (mftusd-build/StructureFactory.sol):
 *   addKind(string kindId, string label, uint256 goldCost, address producedGood, address endowmentVault)
 *     • kindId        -> `key` below (keccak256(bytes(key)) is the on-chain id; build.js uses ethers.id(key))
 *     • label         -> `name`
 *     • goldCost      -> `goldCost` (GOLD, 18 dec) — the gold the build pulls + re-locks as endowment
 *     • producedGood  -> `producedGood.address` — the WaterV2 payoutToken (the good this site makes)
 *     • endowmentVault-> the per-good WaterV2 RESOURCE-water address. ONE shared vault per produced good.
 *                        This is the FOUNDATION layer (a): the WaterV2 endowment LOCKS on seal() — which
 *                        is exactly what a permanent foundation wants (founder-accepted). The BUSINESS
 *                        layer (b) — the owner-withdrawable manufacturing LP — is a SEPARATE NEW contract
 *                        (see header CONTRACT FLAG), NOT this vault. `null` = foundation vault NOT
 *                        deployed yet (cannot addKind until it exists).
 *
 * THE MODULAR 50/50 WATER PRINCIPLE (founder: "more combos of camps/cities than 3-way splits, less
 * complicated, modular, easier math"). Every PRODUCTIVE structure composes exactly TWO uniform 50/50
 * WaterV2 tokens — never a bespoke multi-way split:
 *     1. RESOURCE-water  — payout = the good the site produces (logs/lumber/wheat/...). Injected at the
 *                          site. This is the `endowmentVault` the StructureFactory seeds + plants.
 *     2. COPPER wage-water — pays the site's crew their copper wages. The SAME uniform coin-water the
 *                          prize bases + crew wages already use (COPPER water 0x0749…528B, live).
 * The StructureFactory itself seeds only ONE endowmentVault per structure (its RESOURCE-water). The
 * COPPER wage-water is a SHARED, ALREADY-LIVE vault — the site is "attached" to it by a keeper (game-
 * layer), not a second factory seed. So `wageWater` below is informational wiring, NOT a 2nd addKind arg.
 *   --> OPEN DECISION (flagged): the contract seeds 1 vault. Confirm the COPPER wage-water is funded by
 *       the SHARED coin-water (no per-structure copper principal), i.e. building a mill does NOT seed
 *       copper — it only seeds lumber-water. If the founder wants per-site copper principal, that needs
 *       a 2nd seed path the current single-vault contract does NOT have (a contract change — out of scope).
 *
 * COSTS (founder rules, 2026-06-27):
 *   • LOG = 1 gold, LUMBER = 5 gold (boat-craft.js LOG_GOLD_PRICE / LUMBER_GOLD_PRICE).
 *   • A foraging/unskilled BUNK = 1000 gold (project_seas_pawn_hire). Camps use this as the base.
 *   • A WORKSHOP is ALWAYS +500 gold ON TOP of the bunk fee (founder). So a town workshop = 1500 gold.
 *   • BUILD RECIPE = goldCost PLUS HALF-ITS-VALUE in MATERIALS (founder 2026-06-27), mirroring the
 *     boat recipe (boat-craft.js: material value = priceGold/2). Materials come TWO WAYS — the builder
 *     PICKS a path:
 *        LUMBER path:        lumberUnits  = (goldCost/2) / LUMBER_GOLD_PRICE(5)  = goldCost/10
 *        STONE+MORTAR path:  stone+mortar VALUE = goldCost/2, split between STONE + MORTAR. STONE/MORTAR
 *                            gold prices are NOT SET yet (no tokens deployed) -> materialCost.stone is a
 *                            PLACEHOLDER and stoneUnits/mortarUnits THROW until priced (see OPEN DECISIONS).
 *     Building a town is EXPENSIVE on purpose. The material burn is a GAME-LAYER / keeper gate (the
 *     StructureFactory contract takes ONLY gold) — enforced exactly like boat-craft.js burns LUMBER
 *     before the boat is credited.
 *   • STONE vs LUMBER tradeoff (founder): a STONE build gets HIGHER HP + a MORALE boost; a LUMBER build
 *     is cheaper/lighter but WEAKER. But STONE is HEAVY — hauling it to a far site is a real effort
 *     (encumbrance + caravans, see CAMP-TO-TOWN-MODEL.md). Each kind carries hp/morale PER build-material
 *     (BUILD_MATERIAL below) so the choice has teeth.
 *
 * TOWN GATING: `townGated:true` structures (workshop, smithy) can ONLY be built at a hex that is a
 * registered TOWN (>= TOWN_MIN_STRUCTURES productive structures at one loc). Enforced game-layer in
 * build.js against the town registry (see CAMP-TO-TOWN-MODEL.md — recommended: extend settlements.js,
 * no new contract). The StructureFactory does NOT know about towns — it builds any kind at any loc;
 * the gate lives in the tool, same as the GOLD exit-liquidity gate already does.
 */

// ── verified token addresses (commodity-tokens.csv / materials-deployed.json / water-tokens.csv) ──
// Coins + materials + produce that already exist on Base (8453, 18 dec). Never typed from memory —
// copied from the deploy records / CSVs read 2026-06-27.
export const TOK = {
  LOGS:   '0xD8DA82E017bf28C261Aa2d6Be6f62C6283683D08', // material, raw   (from logging-camp)
  LUMBER: '0x7a97e5e76C93267e1FF2EBc38DCC7C7B6f40fF4c', // material, refined (from lumber-mill)
  WHEAT:  '0x969b59Dc55167450B2D5d9dEcf81bc857e4f2604', // produce (farm)
  CORN:   '0x01ebBdc30A6a173f145dC95e68151fb5A904Fa4C', // produce (farm)
  GRAPE:  '0x4f99FfCf39f68D4F072A689053add5A7E5686b08', // produce (vineyard)
  FLOUR:  '0x111c5a52C3e631bf43e2e44DB001F08d20a9Ee73', // food (milled grain) — has a prize-water already
  FISH:   '0x907D043d33A243cd9818d6e2ccd5b3C9ef9905B5', // fish (has FISH water + ocean LPs)
  WINE:   '0x796Ac66a177f0e18aaCd53D3Ac91c3329A48a7d1', // food (crafted from grapes)
  COPPER: '0x0197896c617f20d61E73E06eC8b2A95eef176bee', // coin — the wage currency
};

// COPPER wage-water — the SHARED, LIVE uniform wage engine (water-tokens.csv, deployed 2026-06-24).
// Every productive site's crew is paid from THIS one coin-water (not a per-site copper seed).
export const COPPER_WAGE_WATER = '0x0749c5107091F153a9f3950FC63d5B96Df04528B';

// ── TREASURY ENDOWMENT VAULTS (founder RESOLVED 2026-06-27 — the producer-less BLOCKER fix) ──
// addKind() reverts on a zero producedGood/endowmentVault. Non-producers (warehouse/workshop/smithy)
// don't make a good — so they point producedGood at a COIN and endowmentVault at that coin's LIVE
// coin-water. The build's gold STILL re-locks into a sealed, location-fixed endowment (a "town
// treasury") that grows — exactly the engine win — the "produced good" is just coin the site accrues.
// These coin-waters are ALREADY LIVE (water-tokens.csv), so producer-less kinds are now WIREABLE.
export const TREASURY_VAULT = {
  copper: '0x0749c5107091F153a9f3950FC63d5B96Df04528B', // COPPER water (== COPPER_WAGE_WATER) — light/cheap sites
  gold:   '0x24eb9Cf77d920207CC07584B5CD9BFB0F5a0F7C7', // GOLD water — bigger civic treasuries
};

// ── BUILDABILITY: terrain a kind may be built on (founder 2026-06-27: "map what's allowed where") ──
// GROUNDED in game/lib/world-features.js TERRAIN + PRODUCTION_TYPES + forage.js FORAGE_TABLES — DO NOT
// invent a parallel terrain system. Mirror of world-features.TERRAIN (kept in sync; that file owns it):
//   FOREST → mills/lumber + forage berries/game · MOUNTAIN → mines (ore/metal) · PLAINS → farm/vineyard
//   + forage berries/pork · WATER → fish · SAND → crab (beach) · TOWN → built-up hex (civic/crafting).
// Each `buildableTerrain` below is the set a kind may sit on. `canBuildAt()` enforces it game-layer (in
// build.js, beside the GOLD-exit + town gates) — the StructureFactory contract does NOT know terrain.
// ⚠ HILLS / SWAMP are PROPOSED-only (not in world-features yet) — see CAMP-TO-TOWN-MODEL.md §12.
export const TERRAIN = {
  FOREST: 'forest', MOUNTAIN: 'mountain', PLAINS: 'plains', SAND: 'sand', WATER: 'water', TOWN: 'town',
  // PROPOSED (flagged, NOT in world-features.js): HILLS: 'hills', SWAMP: 'swamp'
};

// ── BUILD MATERIALS + the EXACT cost model (founder 2026-06-27) ─────────────────────────────────
// COST MODEL (founder EXACT): a build = GOLD + a fixed GOLD-WORTH of MATERIAL (stone OR wood), each
// at standard market price; the material must be HAULED to the site (the caravan challenge, §8 —
// "getting wood or stone to location is a challenge in itself").
//   • basic BUNK (no specialty)                 = 1000 gold + 500 gold-worth material.
//   • SPECIALIZED WORKSHOP (the +500/+250 bump) = +500 gold + 250 gold-worth MORE material
//        => 1500 gold + 750 gold-worth material total.
// Each kind carries goldCost + materialGoldValue (the gold-WORTH of material it needs). materialCostFor()
// converts that value into UNITS along whichever path the builder picks (wood | a stone tier).
export const BUNK_MATERIAL_GOLD    = 500; // gold-worth of material for a basic bunk (founder EXACT)
export const WORKSHOP_MATERIAL_ADD = 250; // EXTRA gold-worth a specialized workshop adds (founder EXACT)

// THREE MATERIAL PATHS (founder 2026-06-27): WOOD (light, weaker) | STONE (quarried, heavy haul, high
// HP/morale) | BRICKS (shale-fired; middle). Builder picks one.
export const LUMBER_GOLD_PRICE = 5; // wood — mirrors boat-craft.js (LUMBER = 5 gold). LIVE + priced.

// STONE PALETTE (founder 2026-06-27). Note: SHALE is NOT a direct building stone — it's ~clay, the RAW
// of the BRICK chain (shale -> bricks). The DIRECT building stones are limestone/sandstone/granite/marble.
//   LIMESTONE = the MOST COMMON building stone ("common stone"). SANDSTONE + GRANITE = "sometimes" stones
//   (between common + premium). MARBLE = premium (mansions/luxury).
// Stone tokens are now LIVE in commodity-tokens.csv (verified 2026-06-27): SHALE/LIME/MARBLE deployed.
export const STONE_GOLD_PRICE = {
  // direct building stones (the STONE path):
  limestone: 5,    // LIVE — common stone. SETTLED = LUMBER price (5g) — wood/stone parity (verified sheet gold=5).
  sandstone: null, // ⚠ FUTURE token (sometimes-stone) — price ~mid, OPEN
  granite:   null, // ⚠ FUTURE token (sometimes-stone) — price ~mid, OPEN
  marble:    12,   // LIVE — premium
};
// STONE LADDER (founder SETTLED): SHALE 1 (clay/brick raw) · LIMESTONE 5 (common = lumber) ·
// SANDSTONE/GRANITE ~mid (sometimes, future) · MARBLE 12 (premium). Common stone == wood PRICE — parity
// holds; stone is just HEAVIER (50 vs 10 lb/unit), so the HAUL is the challenge, not the gold cost.

// BRICK chain: SHALE (raw clay, NOT a building stone) -> fired in a BRICKWORKS -> BRICKS (middle path).
export const SHALE_GOLD_PRICE = 1;     // LIVE — raw clay, brick input (NOT used as a building stone directly)
export const BRICKS_GOLD_PRICE = null; // ⚠ FUTURE token — bricks not deployed; price OPEN (fired-from-shale)

// Tokens for the material paths (verified live in commodity-tokens.csv 2026-06-27 where noted).
export const MATERIAL_TOKEN = {
  lumber:    '0x7a97e5e76C93267e1FF2EBc38DCC7C7B6f40fF4c', // LIVE (wood path)
  shale:     '0x6171B2039199786750b24021c04400FDb8c07793', // LIVE (raw clay — brick INPUT, not a building stone)
  limestone: '0xfd531Dfa3aFF2cf9Eb3eE4D5b3e662eA97f65e11', // LIVE (common building stone)
  marble:    '0xdF8B0141b39a1eD27Cfd442497C36978017F42c5', // LIVE (premium building stone)
  sandstone: null, // ⚠ FUTURE — sometimes-stone token not deployed
  granite:   null, // ⚠ FUTURE — sometimes-stone token not deployed
  bricks:    null, // ⚠ FUTURE — fired from shale; not deployed
};

/**
 * BUILD_MATERIAL — the per-PATH HP + MORALE + haul-weight profile (founder THREE-path tradeoff).
 * hp     = structure hit points (matters for the FUTURE untamed-wilds PvP raid/claim; see model doc).
 * morale = the BASELINE morale modifier for the path (wood 0, bricks small). For STONE the morale SCALES
 *          BY KIND (see STONE_MORALE) — `morale` here is the path floor; use moraleFor() to resolve it.
 * weightPerUnit = lb per material unit (drives caravan/encumbrance hauling — STONE is HEAVY).
 * HAUL-WEIGHT RATIO SETTLED (founder): STONE = 5× WOOD (10 → 50 lb). Bricks ~2.5× (middle). Same GOLD
 * price + same build value as wood → stone is FREE on cost, 5× on LOGISTICS (the haul is the challenge).
 * HP MIRRORS THE WEIGHT RATIO (founder SETTLED): WOOD 100 HP, STONE 500 HP (5×). Bricks ~250 (middle).
 *
 * MORALE SCALES WITH STONE QUALITY (founder 2026-06-27): wood 0 · brick small · limestone small ·
 * sandstone/granite mid · MARBLE highest. See moraleFor() + STONE_MORALE. Magnitudes PROPOSED.
 *
 * MORALE = a HERO BUFF (founder REVISED 2026-06-27): high morale RAISES STATS for VISITING HEROES, and the
 * buff LINGERS — it does NOT drop sharply on leaving; it SLOW-DECAYS. So players CYCLE heroes through
 * high-morale (marble/luxury) towns to RE-UP the boost before a venture → high-morale towns become
 * HERO-BUFF HUBS (a real COMBAT payoff for prestige builds, not just a flex). Resident NON-fighting
 * peasants are still COSMETIC (they don't fight, so the stat boost is moot for them). See MORALE_HERO_BUFF
 * + the model doc morale section. ⚠ OPEN: decay rate + the morale→stat magnitude formula (§11 #24).
 */
export const STONE_WEIGHT_RATIO = 5; // CANONICAL: stone weighs 5× wood per unit (founder, firm)
export const BUILD_MATERIAL = {
  wood:   { hp: 100, morale: 0, weightPerUnit: 10, goldPrice: LUMBER_GOLD_PRICE, note: 'LIGHT, WEAKER (100 HP), easy haul (founder). Live + priced. Baseline 10 lb/unit. No morale.' },
  bricks: { hp: 250, morale: 1, weightPerUnit: 25, goldPrice: BRICKS_GOLD_PRICE, note: 'MIDDLE: shale-fired in a brickworks. ~2.5× wood weight + ~2.5× HP (PROPOSED). SMALL morale. BRICKS token FUTURE.' },
  stone:  { hp: 500, morale: 1, weightPerUnit: 50, goldPrice: null, note: 'QUARRIED building stone: 500 HP (5× wood, mirrors the 5× weight, SETTLED). Morale SCALES BY KIND (STONE_MORALE: limestone small → sandstone/granite mid → marble highest). 5× wood weight; same gold price as wood → free on cost, 5× on haul. Price by kind (STONE_GOLD_PRICE).' },
};

// MORALE LADDER scaled by STONE QUALITY (founder 2026-06-27). Magnitudes PROPOSED; the ORDERING is the
// settled rule: wood 0 < brick = limestone (small) < sandstone/granite (mid) < marble (highest).
export const STONE_MORALE = {
  limestone: 1, // common — SMALL (same tier as brick)
  sandstone: 2, // sometimes — MID
  granite:   2, // sometimes — MID
  marble:    4, // premium — HIGHEST
};
export const WOOD_MORALE  = 0; // baseline — no morale
export const BRICK_MORALE = 1; // SMALL (same as common stone)
/**
 * Resolve the morale a build grants for a chosen material (and, for stone, the specific kind).
 * wood 0 · bricks small (1) · stone scales by kind (limestone 1 / sandstone+granite 2 / marble 4).
 * @param {'wood'|'bricks'|'stone'} material
 * @param {string} [stoneKind] required when material==='stone' (limestone|sandstone|granite|marble)
 * @returns {number} morale modifier (PROPOSED magnitudes; ordering SETTLED)
 */
export function moraleFor(material, stoneKind) {
  if (material === 'wood')   return WOOD_MORALE;
  if (material === 'bricks') return BRICK_MORALE;
  if (material === 'stone')  return STONE_MORALE[stoneKind] ?? BUILD_MATERIAL.stone.morale;
  return 0;
}

// ── MORALE → HERO BUFF (founder REVISED 2026-06-27): the "cycle heroes through town" loop ──────────────
// A town's morale (sum/level of its high-quality builds) BUFFS a VISITING HERO'S STATS while there, and the
// buff LINGERS after they leave — SLOW decay, not a sharp drop. Players park/cycle heroes through high-
// morale (marble/luxury) towns to RE-UP before ventures → marble towns = HERO-BUFF HUBS. Residents who
// don't fight see no mechanical effect (cosmetic for them). ALL NUMBERS PROPOSED — the magnitude formula +
// decay rate are OPEN (§11 #24). This is the DESIGN target; the buff/decay system is unbuilt (game-layer).
export const MORALE_HERO_BUFF = {
  appliesTo: 'visiting heroes (combatants)',     // residents/non-fighters: cosmetic only
  lingers: true,                                  // does NOT drop sharply on leaving town
  decay: 'slow',                                  // ⚠ rate OPEN (e.g. -X / hex traveled or / hour) — §11 #24
  reUp: 'revisit a high-morale town to refresh',  // the cycle-heroes-through-town loop
  statFormula: null,                              // ⚠ OPEN: which stat(s) + how much per morale point — §11 #24
  note: 'Prestige builds (marble/luxury) become a real COMBAT payoff via this buff. Cosmetic for non-fighting residents. Design-only; magnitudes + decay PROPOSED.',
};
// SETTLED (founder): wood 100 HP / no morale / 10 lb; stone 500 HP (5×) / morale-by-kind / 50 lb (5×); bricks
// ~250 HP / +morale / 25 lb (middle, FUTURE token). Same gold price across paths — HAUL is the cost.

// ── BUNK VARIANTS (founder 2026-06-27): a structure is a MATERIAL/GRADE variant token, minted on build ──
// A bunk isn't one fixed thing — the build MINTS a variant by the MATERIAL chosen, each carrying HP + morale:
//   wood-bunk    100 HP, no morale     — half-cost wood, cheap/light haul.
//   brick-bunk   ~250 HP, +morale      — middle (shale→bricks). FUTURE (BRICKS token not deployed).
//   stone-bunk   500 HP (5×), +morale  — half-cost stone, but 5× haul.
//   mansion-bunk PREMIUM: FULL gold + FULL materials, top HP/morale + luxury, GATES a noble office.
// MANSION IS NOT A SINGULAR STRUCTURE — it's the TOP BUNK VARIANT, UNCAPPED: a player may make ALL their
// bunks mansions if they can afford it. Mansions COUNT AS BUNKS. Holding a noble office just needs >=1 mansion.
// HP/morale here come from BUILD_MATERIAL (wood/brick/stone) + a premium bump for mansion. bunkVariant(material)
// resolves the variant a given build mints. (Token-per-variant is the on-chain shape; design-only here.)
export const BUNK_VARIANT = {
  'wood-bunk':    { material: 'wood',   hp: 100, morale: 0,  grade: 'basic',   note: 'cheap/light; half-cost wood. No morale.' },
  'brick-bunk':   { material: 'bricks', hp: 250, morale: 1,  grade: 'middle',  note: 'middle; shale→bricks. SMALL morale. FUTURE.' },
  'stone-bunk':   { material: 'stone',  hp: 500, morale: 1,  grade: 'sturdy',  note: '5× HP; half-cost stone but 5× haul. MORALE scales by stone kind — moraleFor("stone",kind): limestone 1 / sandstone+granite 2 / marble 4 (this floor = limestone).' },
  'mansion-bunk': { material: 'stone',  hp: 800, morale: 4,  grade: 'premium', note: 'PREMIUM: FULL gold + FULL materials + luxury; office-eligible; UNCAPPED (mansions count as bunks). Built in top stone (marble) → highest morale (4) + a premium bump. HP/morale PROPOSED.' },
};
/** The bunk variant a build MINTS for a chosen material ('wood'|'bricks'|'stone'|'mansion'). */
export function bunkVariant(material) {
  if (material === 'mansion') return { key: 'mansion-bunk', ...BUNK_VARIANT['mansion-bunk'] };
  const key = `${material}-bunk`;
  return BUNK_VARIANT[key] ? { key, ...BUNK_VARIANT[key] } : null;
}

// ── MATERIAL GOLD-VALUE per build (founder EXACT) — the gold-WORTH of material each kind needs. ──
// Basic bunks pay BUNK_MATERIAL_GOLD (500). Specialized workshops pay BUNK + WORKSHOP_MATERIAL_ADD (750).
// A MANSION pays FULL (see mansionMaterialGold — premium, NOT the bunk rate). materialCostFor() reads this.
export function materialGoldValueFor(kind) {
  const k = STRUCTURE_KINDS[kind];
  if (!k) throw new Error(`unknown kind "${kind}"`);
  if (k.materialGoldValue != null) return k.materialGoldValue; // explicit override (mansion, special)
  // workshops/smithy/stall carry the +500 gold surcharge (goldCost 1500) -> +250 material; others basic.
  return k.goldCost >= 1500 ? (BUNK_MATERIAL_GOLD + WORKSHOP_MATERIAL_ADD) : BUNK_MATERIAL_GOLD;
}

/**
 * Per-good RESOURCE-water vaults (the StructureFactory `endowmentVault`). ONE shared WaterV2 per
 * produced good (payout = that good). FOUNDER-GATED DEPLOY — null until the per-good vault exists.
 *   • There is NO lumber/log/wheat WaterV2 deployed yet. The fork test deploys a throwaway one
 *     (payout=GOLD) just to prove the flow; production needs REAL per-good vaults whose payout IS
 *     the good (lumber-water pays LUMBER, etc.) AND a GOLD->...->good buy route for the harvest.
 *   • Today only the COPPER/SILVER/GOLD coin-waters + the prize/stat waters exist as real WaterV2s.
 *   --> OPEN DECISION: a RESOURCE-water's payout token must be buyable from the harvest yield (yield ->
 *       GOLD -> the good). LUMBER/LOGS/WHEAT have NO two-sided buy market yet (only the location-gated
 *       sell walls). So a lumber-water can grow (Aave) but cannot yet BUY lumber to pay out. Confirm
 *       the buy route per good before deploying its RESOURCE-water (mirrors the prize-water "flag if
 *       buy wall missing" rule). Until then production is endowment-growth only (the gold re-locks +
 *       compounds — still the endowment-engine win — but the good doesn't flow until the buy route exists).
 */
export const RESOURCE_WATER = {
  logs:   null, // payout = LOGS   — NOT deployed
  lumber: null, // payout = LUMBER — NOT deployed (mills currently use mill-keeper.js inject, not a vault)
  wheat:  null, // payout = WHEAT  — NOT deployed
  corn:   null, // payout = CORN   — NOT deployed
  grape:  null, // payout = GRAPE  — NOT deployed
  berry:  null, // payout = berries — NOT deployed (forage yields a TABLE; representative only)
  ore:    null, // payout = ORE    — NOT deployed (no ORE token either; the mine chain is future)
  fish:   '0x37be8d2137c084f4ec0c23aE9C34f9b87e79F01F', // FISH water EXISTS (payout=GOLD today; see note)
  flour:  '0x0a2B3b8128214c53Af7C0c9A191aFfA3c4d7F245', // FLOUR water EXISTS (payout=GOLD, prize-water)
};

// Settlement tiers (mirror game/lib/settlements.js TIER — kept in sync; that file is the runtime registry).
export const SETTLEMENT_TIER = {
  CAMP:    'camp',     // 1 productive structure on a wild hex
  HAMLET:  'hamlet',   // 2 structures at one hex (a.k.a. outpost)
  VILLAGE: 'village',  // 3 structures at one hex
  TOWN:    'town',     // >= TOWN_MIN_STRUCTURES structures at one hex -> unlocks town-gated workshops
};

// A hex becomes a TOWN at this many productive structures on it. PROPOSED = 4 (camp/mill + farm +
// market + one more). Tunable; flagged as an OPEN DECISION. Mirrors NOBLE_RANKS thinking in
// settlements.js (Mayor unlocks at a population threshold) — here it's a STRUCTURE-count threshold.
// "structures on it" counts BUILT structures (sealed-or-owned); whether it must require sealed is OPEN.
export const TOWN_MIN_STRUCTURES = 4;

// ── THE TWO LAYERS (founder RESOLVED 2026-06-27) ────────────────────────────────────────────
// Every structure has BOTH layers — not an either/or. `foundation` is always LOCKED + immobile;
// `business` is always owner-withdrawable working capital (needs the new ManufacturingPool contract).
export const LAYER = {
  FOUNDATION: 'foundation', // (a) LOCKED, immobile stake/capacity — StructureFactory seal()+WaterV2 (LIVE)
  BUSINESS:   'business',   // (b) owner-WITHDRAWABLE manufacturing LP + stock — NEW contract (UNBUILT)
};

// ── CAPACITY: bunks + workshops are SLOTS that cap how many manufacturing LPs a player runs ──
// (founder refinement 2026-06-27). Each bunk = LP_PER_BUNK slots; each workshop adds LP_PER_WORKSHOP
// (town-gated, heavier work). lpCapFor() computes the cap. ALL NUMBERS PROPOSED — OPEN.
export const LP_PER_BUNK = 1;     // OPEN: 1 manufacturing LP per bunk built
export const LP_PER_WORKSHOP = 2; // OPEN: a workshop runs 2 (heavier crafts: boats/gear chains)
export const FREE_STARTER_LPS = 0; // OPEN: 0 = must build a bunk before running ANY business LP
/**
 * Per-player manufacturing-LP cap = the slots their built foundations unlock.
 * @param {{bunks?:number, workshops?:number}} built
 * @returns {number}
 */
export function lpCapFor({ bunks = 0, workshops = 0 } = {}) {
  return FREE_STARTER_LPS
    + Math.max(0, Math.floor(bunks)) * LP_PER_BUNK
    + Math.max(0, Math.floor(workshops)) * LP_PER_WORKSHOP;
}

// PUBLIC STORE (founder refinement): a "true store" others can come use = a BUNK + 500 gold for a
// stall to sell from -> opens a PUBLIC sell point. Same +500 surcharge shape as a workshop.
export const STALL_SURCHARGE_GOLD = 500;

/**
 * THE KIND CATALOG. One row per buildable structure. Wire to addKind(key, name, goldCost*1e18,
 * producedGood.address, RESOURCE_WATER[producedGood.water]).
 *
 * Fields:
 *   key            stable kindId (keccak256 on-chain). lowercase, no spaces.
 *   name           display label (addKind `label`).
 *   tier           the settlement tier this structure belongs to / creates (SETTLEMENT_TIER).
 *   goldCost       GOLD build price (18 dec on-chain). The FOUNDATION (a) stake — locks on seal().
 *   isBunk         true = this structure provides a manufacturing-LP SLOT (a bunk). Feeds lpCapFor().
 *   business       layer (b) descriptor: the owner-withdrawable manufacturing flow this structure runs
 *                  (the conversion + the goods-water it pays). null for non-manufacturing civic kinds.
 *                  NEEDS the new ManufacturingPool contract (the CONTRACT FLAG) — not wireable today.
 *   materialKind   'producer' | 'treasury' — does it make a good, or hold a coin treasury endowment?
 *   producedGood   { token, address, water } — the WaterV2 payout. For treasury kinds this is the COIN.
 *   resourceWater  the endowmentVault address — RESOURCE_WATER[...] for producers, TREASURY_VAULT[...]
 *                  for treasury kinds. null only if a producer's per-good vault isn't deployed yet.
 *   wageWater      COPPER_WAGE_WATER (shared) for crewed sites; null for unmanned/non-producers.
 *   townGated      true = may ONLY be built at a registered TOWN hex (workshops/smithy).
 *   note           design intent / current on-chain status.
 *
 *   materialCost   the MATERIAL half of the recipe (goldCost/2 in value), BOTH ways. Computed by
 *                  materialCostFor(key) — do NOT hardcode; derives from goldCost + the prices above:
 *                    { goldValueHalf, lumber:{units}, stoneMortar:{ stoneUnits, mortarUnits, priced } }
 *                  stoneMortar.priced=false (+ null units) until STONE/MORTAR are priced. PROPOSED.
 *   (HP/morale per build-material come from BUILD_MATERIAL, chosen at build time — not stored per kind.)
 */
export const STRUCTURE_KINDS = {
  // ── TIER: CAMP — the first thing you build on a wild hex. Harvests a RAW good. ──
  'logging-camp': {
    key: 'logging-camp', name: 'Logging Camp', tier: SETTLEMENT_TIER.CAMP,
    goldCost: 1000, materialKind: 'producer', isBunk: true, rawProduction: true,
    business: { flow: 'harvest', output: 'LOGS', goodsWater: 'logs', withdrawable: true },
    producedGood: { token: 'LOGS', address: TOK.LOGS, water: 'logs' },
    resourceWater: RESOURCE_WATER.logs, wageWater: COPPER_WAGE_WATER,
    townGated: false, buildableTerrain: [TERRAIN.FOREST], // logging needs trees (world-features doctrine)
    note: 'Bootstrap bunk. FOREST-only (world-features.js: forest→mills/lumber+forage). RAW-production (capped, see RAW_BUNK_CAP). FOUNDATION (a): the camp token + its LOCATION vault lock on build (founder-accepted, immobile). BUSINESS (b): owner-withdrawable LOGS harvest LP — owner can pull logs out. Material half computed from goldCost (=100 lumber OR the stone+mortar equivalent); no "free" camp (a camp is real construction). Base bunk cost 1000 gold. isBunk -> +1 manufacturing-LP slot.',
  },
  'forage-bunk': {
    key: 'forage-bunk', name: 'Forage Camp', tier: SETTLEMENT_TIER.CAMP,
    goldCost: 1000, materialKind: 'producer', isBunk: true, rawProduction: true,
    business: { flow: 'harvest', output: 'berries/game', goodsWater: null, withdrawable: true },
    producedGood: { token: 'BLKBRY', address: '0x16C3ac67a9B739376D5fDCAF44D5Ba825579CD8b', water: 'berry' }, // representative; forage.js yields a table
    resourceWater: RESOURCE_WATER.berry, wageWater: COPPER_WAGE_WATER,
    townGated: false, buildableTerrain: [TERRAIN.FOREST, TERRAIN.PLAINS], // forage.js FORAGE_TABLES: forest/plains
    note: 'WILD forage/hunt bunk (forage.js FORAGE_TABLES): FOREST → berries+elk+bear, PLAINS → berries+pork. RAW-production (capped, see RAW_BUNK_CAP) — this is the "berries/game" the founder caps at 20. A forage bunk yields a TABLE of goods (not one token); producedGood here is representative (BLKBRY). No berry-water deployed. The literal thing the logs/berries→grains evolution (§6) reroutes AWAY from once a camp maxes.',
  },
  'fishing-dock': {
    key: 'fishing-dock', name: 'Fishing Dock', tier: SETTLEMENT_TIER.CAMP,
    goldCost: 1000, materialKind: 'producer', isBunk: true, // NOT raw-capped: fish is not "logs/berries/game"
    business: { flow: 'harvest', output: 'FISH', goodsWater: 'fish', withdrawable: true },
    producedGood: { token: 'FISH', address: TOK.FISH, water: 'fish' },
    resourceWater: RESOURCE_WATER.fish, wageWater: COPPER_WAGE_WATER,
    townGated: false, buildableTerrain: [TERRAIN.WATER, TERRAIN.SAND], // coastal: ocean fishery / beach dock
    note: 'Coast-only (terrain=water/coast). FOUNDATION vault (a) FISH water EXISTS (0x37be…F01F) — closest to wireable today (payout=GOLD not FISH; see RESOURCE_WATER note). BUSINESS (b): owner-withdrawable FISH harvest, pairs with the live ocean LPs. A dock is naturally a LUMBER build (planks/piers). isBunk -> +1 LP slot.',
  },

  // ── TIER: HAMLET/VILLAGE — refine raw goods. A MILL turns logs into lumber. ──
  'lumber-mill': {
    key: 'lumber-mill', name: 'Lumber Mill', tier: SETTLEMENT_TIER.HAMLET,
    goldCost: 1000, materialKind: 'producer', isBunk: true,
    business: { flow: 'convert', input: 'LOGS', output: 'LUMBER', goodsWater: 'lumber', withdrawable: true, ownerSuppliesStock: true },
    producedGood: { token: 'LUMBER', address: TOK.LUMBER, water: 'lumber' },
    resourceWater: RESOURCE_WATER.lumber, wageWater: COPPER_WAGE_WATER,
    townGated: false, buildableTerrain: [TERRAIN.FOREST, TERRAIN.TOWN], // at the trees, or in a built-up town
    note: 'DOWNSTREAM converter: owner SUPPLIES the LOGS stock (own camp / buy / haul) — the lumber-water does NOT buy logs (only a raw-harvest CAMP\'s resource-water injects raw goods). Converts LOGS->LUMBER on a thin TIME-GATED LP (1:1, cooldown+maxSwapIn). BUSINESS (b): owner-withdrawable. Mills have LIVE sell LPs (mill-lp-deployed.json loc 13001/14003) + mill-keeper.js but NO foundation vault yet. isBunk -> +1 LP slot.',
  },
  'farm': {
    key: 'farm', name: 'Farm', tier: SETTLEMENT_TIER.HAMLET,
    goldCost: 1000, materialKind: 'producer', isBunk: true, agriculture: true,
    business: { flow: 'harvest', output: 'WHEAT', goodsWater: 'wheat', withdrawable: true },
    producedGood: { token: 'WHEAT', address: TOK.WHEAT, water: 'wheat' },
    resourceWater: RESOURCE_WATER.wheat, wageWater: COPPER_WAGE_WATER,
    townGated: false, buildableTerrain: [TERRAIN.PLAINS], // farms need open plains (world-features doctrine)
    note: 'Raw-harvest origin (like a camp): the WHEAT resource-water buys+injects grain at the farm. Produces WHEAT (also CORN — a 2nd farm kind/variant). Food-chain root. No WHEAT sell LP + no wheat-water deployed yet (produce-deployed.json = tokens only). isBunk -> +1 LP slot.',
  },
  'vineyard': {
    key: 'vineyard', name: 'Vineyard', tier: SETTLEMENT_TIER.HAMLET,
    goldCost: 1000, materialKind: 'producer', isBunk: true, agriculture: true,
    business: { flow: 'harvest', output: 'GRAPE', goodsWater: 'grape', withdrawable: true },
    producedGood: { token: 'GRAPE', address: TOK.GRAPE, water: 'grape' },
    resourceWater: RESOURCE_WATER.grape, wageWater: COPPER_WAGE_WATER,
    townGated: false, buildableTerrain: [TERRAIN.PLAINS], // plains today; HILLS if added (§12 proposal)
    note: 'Raw-harvest origin. Produces GRAPES -> craftsInto WINE/pies downstream (commodity-tokens.csv). Same shape as farm. No grape sell LP / grape-water deployed yet. isBunk -> +1 LP slot.',
  },
  'mine': {
    key: 'mine', name: 'Mine', tier: SETTLEMENT_TIER.HAMLET,
    goldCost: 1000, materialKind: 'producer', isBunk: true, rawProduction: true,
    business: { flow: 'harvest', output: 'ORE', goodsWater: 'ore', withdrawable: true },
    producedGood: { token: 'ORE', address: null, water: 'ore' }, // ⚠ no ORE token deployed yet (commodity-tokens.csv has none)
    resourceWater: RESOURCE_WATER.ore, wageWater: COPPER_WAGE_WATER,
    townGated: false, buildableTerrain: [TERRAIN.MOUNTAIN], // mines need mountains (world-features PRODUCTION_TYPES)
    note: 'MOUNTAIN-only raw extraction (world-features.js: mountain→mines ore/metal). RAW-production (capped, see RAW_BUNK_CAP). Produces ORE -> smithy metal chain. ⚠ NO ORE token + no ore-water deployed yet (OPEN — see model §6/§11). Also the natural source of STONE (the stone+mortar build path, §2) — flag whether STONE is a mine output.',
  },

  // ── TIER: VILLAGE/TOWN — civic + crafting. WAREHOUSE helps a hex qualify as a town; WORKSHOP +
  //    SMITHY are TOWN-GATED crafting workshops; STALL is the public store. The civic kinds are TREASURY
  //    kinds (founder RESOLVED 2026-06-27): they make no good, so their FOUNDATION vault is a LIVE
  //    coin-water (town treasury) + producedGood is that coin -> the sealed gold re-locks + grows
  //    (engine win) AND they are WIREABLE today. Their layer-(b) business (where present) is owner-stocked. ──
  'stall': {
    key: 'stall', name: 'Market Stall', tier: SETTLEMENT_TIER.VILLAGE,
    goldCost: 1500, materialKind: 'treasury', isBunk: false, // bunk (1000) + 500 stall surcharge
    business: { flow: 'sell-point', output: null, goodsWater: null, withdrawable: true, public: true, ownerSuppliesStock: true },
    producedGood: { token: 'COPPER', address: TOK.COPPER, water: 'copper' },
    resourceWater: TREASURY_VAULT.copper, wageWater: COPPER_WAGE_WATER,
    townGated: false, buildableTerrain: [TERRAIN.TOWN], // a stall sits in a built-up hex
    note: 'PUBLIC STORE (founder refinement): a bunk + 500 gold for a stall = a public SELL point OTHERS can come use. FOUNDATION (a): COPPER treasury vault (WIREABLE). BUSINESS (b): owner-stocked, owner-withdrawable sell LP — owner SOURCES the goods to sell (own production / buy / haul). Needs the new ManufacturingPool/sell-point contract.',
  },
  'warehouse': {
    key: 'warehouse', name: 'Warehouse & Market', tier: SETTLEMENT_TIER.VILLAGE,
    goldCost: 1000, materialKind: 'treasury', isBunk: false,
    business: null, // pure civic storage — no manufacturing LP of its own
    producedGood: { token: 'GOLD', address: '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004', water: 'gold' },
    resourceWater: TREASURY_VAULT.gold, wageWater: null,
    townGated: false, buildableTerrain: [TERRAIN.TOWN], // civic storage in a built-up hex
    note: 'TREASURY civic kind. Counts toward the TOWN structure threshold + (game-layer) hosts storage. FOUNDATION (a) = a GOLD-water town treasury (founder-resolved fix for the producer-less addKind revert): the sealed gold re-locks + grows. WIREABLE (GOLD water 0x24eb…F7C7 live). No own business LP. A solid warehouse leans STONE (storage wants HP).',
  },
  'workshop': {
    key: 'workshop', name: 'Workshop', tier: SETTLEMENT_TIER.TOWN,
    goldCost: 1500, materialKind: 'treasury', isBunk: false, // 1000 bunk + 500 workshop surcharge
    business: { flow: 'craft', input: 'LUMBER', output: 'boat/gear tokens', goodsWater: null, withdrawable: true, ownerSuppliesStock: true },
    producedGood: { token: 'COPPER', address: TOK.COPPER, water: 'copper' },
    resourceWater: TREASURY_VAULT.copper, wageWater: COPPER_WAGE_WATER,
    townGated: true, buildableTerrain: [TERRAIN.TOWN], // town-gated crafting
    note: 'TOWN-GATED crafting workshop. Cost = 1000 (skilled bunk) + 500 (workshop surcharge) = 1500 gold (founder). Unlocks BOAT crafting (boat-craft.js: burn LUMBER = priceGold/10 -> boat token). FOUNDATION (a) = COPPER treasury vault -> WIREABLE. BUSINESS (b): owner SUPPLIES the LUMBER stock to craft from. Each workshop = +LP_PER_WORKSHOP manufacturing slots (heavier crafts).',
  },
  'brickworks': {
    key: 'brickworks', name: 'Brickworks', tier: SETTLEMENT_TIER.TOWN,
    goldCost: 1500, materialKind: 'treasury', isBunk: false, // workshop-class (1000 + 500 surcharge)
    automatedLine: true, // IDLE-LAYER automated production line (founder) — shale in -> bricks out
    business: { flow: 'convert', input: 'SHALE (clay)', output: 'BRICKS', goodsWater: null, withdrawable: true, ownerSuppliesStock: true },
    producedGood: { token: 'COPPER', address: TOK.COPPER, water: 'copper' },
    resourceWater: TREASURY_VAULT.copper, wageWater: COPPER_WAGE_WATER,
    townGated: true, buildableTerrain: [TERRAIN.TOWN, TERRAIN.MOUNTAIN], // kiln in town, or near the shale source
    note: 'AUTOMATED BRICK LINE (founder 2026-06-27): a kiln that FIRES SHALE (raw clay) -> BRICKS. The brick chain (shale -> bricks -> structures/ovens) and the MIDDLE build-material path. Owner SUPPLIES shale. FOUNDATION (a) = COPPER treasury -> WIREABLE. ⚠ BRICKS token FUTURE (not deployed); SHALE is LIVE (0x6171…). Bricks are a PREREQUISITE for the cooking economy (the kitchen needs a brick OVEN). +LP_PER_WORKSHOP slots.',
  },
  'kitchen': {
    key: 'kitchen', name: 'Kitchen', tier: SETTLEMENT_TIER.TOWN,
    goldCost: 1500, materialKind: 'treasury', isBunk: false, // workshop-class (1000 + 500 surcharge)
    automatedLine: true, // IDLE-LAYER automated production line (founder §A) — runs passively while fed
    requiresMaterial: 'bricks', // ⭐ founder: a kitchen's cooking core is a BRICK OVEN — must be built with BRICKS
    business: { flow: 'cook', input: 'INGREDIENTS (multi: e.g. berries+flour)', output: 'COOKED FOOD (pies/stews/meals/wine)', goodsWater: null, withdrawable: true, ownerSuppliesStock: true },
    producedGood: { token: 'COPPER', address: TOK.COPPER, water: 'copper' },
    resourceWater: TREASURY_VAULT.copper, wageWater: COPPER_WAGE_WATER,
    townGated: true, buildableTerrain: [TERRAIN.TOWN], // a kitchen sits in a built-up hex
    note: 'AUTOMATED COOKING LINE (founder §A): a kitchen automates cooking EXACTLY like a smelter automates smelting — ingredients in -> cooked food out, runs passively while FED (idle layer). ⭐ REQUIRES A BRICK OVEN: the kitchen\'s cooking core is a brick-built OVEN, so this kind MUST be built with BRICKS (requiresMaterial:bricks) — bricks (shale→brickworks→bricks) are a PREREQUISITE for the cooking economy. (Reconcile: the OVEN is the kitchen\'s brick core / cooking station — modeled as the kitchen\'s brick build requirement, not a separate buildable kind, unless the founder wants a standalone oven.) Multi-INGREDIENT recipes run on the LIVE craft.js engine INSIDE the kitchen. Owner SUPPLIES ingredient stock. FOUNDATION (a) = COPPER treasury -> WIREABLE. ⚠ cooked-food tokens beyond WINE + the BRICKS token NOT deployed (§15/§11). +LP_PER_WORKSHOP slots.',
  },
  'smelter': {
    key: 'smelter', name: 'Smelter', tier: SETTLEMENT_TIER.TOWN,
    goldCost: 1500, materialKind: 'treasury', isBunk: false, // workshop-class (1000 + 500 surcharge)
    automatedLine: true, // IDLE-LAYER automated production line (founder §A)
    business: { flow: 'convert', input: 'ORE (single-input; STEEL also +COAL)', output: 'INGOT (bronze/iron/steel)', goodsWater: null, withdrawable: true, ownerSuppliesStock: true },
    producedGood: { token: 'COPPER', address: TOK.COPPER, water: 'copper' },
    resourceWater: TREASURY_VAULT.copper, wageWater: COPPER_WAGE_WATER,
    townGated: true, buildableTerrain: [TERRAIN.MOUNTAIN, TERRAIN.TOWN], // near the ore, or in town
    note: 'METALLURGY step 2 (the new INGOT layer, §15): smelts ORE -> INGOT. SINGLE-INPUT by design (founder: small/frequent crafts stay smooth — no haul-friction). bronze = copper ore + tin ore (tin = cheap alloy filler, 0.05g); iron = iron ore (ore only). EXCEPTION steel = iron ore + COAL (one flavorful exception; coal + iron both MOUNTAIN terrain = usually co-located, low haul-pain). Owner SUPPLIES the ore (+coal for steel). FOUNDATION (a) = COPPER treasury -> WIREABLE. ORE + COAL tokens LIVE (sheet); ⚠ INGOT tokens are the step-2 deploy (§15/§11). +LP_PER_WORKSHOP slots.',
  },
  'smithy': {
    key: 'smithy', name: 'Smithy', tier: SETTLEMENT_TIER.TOWN,
    goldCost: 1500, materialKind: 'treasury', isBunk: false, // 1000 bunk + 500 workshop surcharge
    business: { flow: 'craft', input: 'INGOT (or LUMBER for wooden tier)', output: 'weapons/armor (bronze/iron/steel) + crude wooden gear', goodsWater: null, withdrawable: true, ownerSuppliesStock: true },
    producedGood: { token: 'COPPER', address: TOK.COPPER, water: 'copper' },
    resourceWater: TREASURY_VAULT.copper, wageWater: COPPER_WAGE_WATER,
    townGated: true, buildableTerrain: [TERRAIN.TOWN], // town-gated crafting
    note: 'METALLURGY step 3 (§15): forges INGOT -> the EXISTING Bronze/Iron/Steel gear tiers (commodity-tokens.csv DAGGERIRON/SWORDSTEEL/etc). Wooden tier still from LUMBER ("lumber makes ships, shops, and crude weapons"). FOUNDATION (a) = COPPER treasury -> WIREABLE. BUSINESS (b): owner supplies INGOT/LUMBER stock. A forge leans STONE (fire + HP). +LP_PER_WORKSHOP slots.',
  },
  // ── NOBLE MANSION (coordinator-relayed design input 2026-06-27 — treated as DESIGN ONLY, NOT user-
  //    approved, REVISED 2026-06-27). A MANSION is the TOP BUNK VARIANT (premium grade), NOT a singular
  //    structure — UNCAPPED, counts as a bunk; you can build many. FULL-cost (full gold + full material);
  //    top HP/morale + luxury. Holding a NOBLE_RANKS office just needs >=1 mansion. Higher ranks demand
  //    MARBLE + luxury goods that SCALE BY RANK. See BUNK_VARIANT (mansion-bunk) + model §16. ──
  'mansion': {
    key: 'mansion', name: 'Noble Mansion', tier: SETTLEMENT_TIER.TOWN,
    goldCost: 2000, materialKind: 'treasury', isBunk: true, // counts as a bunk; PREMIUM grade (full-cost)
    bunkVariant: 'mansion-bunk', // ⭐ it's the TOP BUNK VARIANT (BUNK_VARIANT) — uncapped, build as many as affordable
    materialGoldValue: 2000, // FULL material gold-worth (NOT the 500/750 bunk rate) — premium. PROPOSED number.
    fullCost: true,          // premium build: full gold + full material (no half-value bunk discount)
    officeEligible: true,    // holding a NOBLE_RANKS office requires >=1 mansion (+ the pop threshold). NOT singular.
    uncapped: true,          // a player may make ALL their bunks mansions if they can afford it
    business: null,          // a residence/status grade, not a manufacturing LP
    producedGood: { token: 'GOLD', address: '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004', water: 'gold' },
    resourceWater: TREASURY_VAULT.gold, wageWater: null,
    townGated: true, buildableTerrain: [TERRAIN.TOWN],
    rankRequirements: {     // SCALES BY RANK (NOBLE_RANKS). Higher rank = higher stone tier + more luxury goods. PROPOSED.
      mayor:     { stoneTier: 'limestone', luxuryGoods: [] },
      lord:      { stoneTier: 'marble',    luxuryGoods: ['statue'] },
      pettyking: { stoneTier: 'marble',    luxuryGoods: ['statue', 'fountain'] },
      highking:  { stoneTier: 'marble',    luxuryGoods: ['statue', 'fountain', 'statue'] }, // multiple luxury goods
    },
    note: 'NOBLE MANSION = the TOP BUNK VARIANT (coordinator design input, DESIGN-ONLY, REVISED). NOT a singular office structure — it is the PREMIUM grade of bunk: UNCAPPED (build as many as you can afford), counts as a bunk. FULL-cost (full gold + full material, NOT the half-value bunk rate); top HP/morale (BUNK_VARIANT mansion-bunk) + luxury. Holding a NOBLE_RANKS office needs the pop threshold AND >=1 mansion. Higher ranks demand MARBLE + luxury goods (statues/fountains) scaling by rank. The mansion endowment (GOLD treasury) re-locks gold -> more mansions = bigger locked stake (endowment engine). goldCost 2000 + materialGoldValue 2000 PROPOSED.',
  },
};

// Stable display/build order (object key order isn't guaranteed forever).
export const KIND_ORDER = [
  'logging-camp', 'forage-bunk', 'fishing-dock', 'lumber-mill', 'farm', 'vineyard', 'mine',
  'stall', 'warehouse', 'workshop', 'brickworks', 'kitchen', 'smelter', 'smithy', 'mansion',
];

/**
 * Does this kind REQUIRE a specific build material (overriding the free wood|stone|brick choice)?
 * Founder: the KITCHEN must be built with BRICKS (its cooking core is a brick OVEN). Returns the forced
 * material key (e.g. 'bricks') or null if the builder may pick any path. Game-layer gate (build.js).
 */
export function requiredBuildMaterial(kind) {
  const k = STRUCTURE_KINDS[kind];
  return k && k.requiresMaterial ? k.requiresMaterial : null;
}

// ── TWO-LAYER GAME STRUCTURE (founder 2026-06-27 — the unifying frame) ───────────────────────────────
// IDLE layer = RESOURCE MANAGEMENT: ALL production is AUTOMATED LINES (camps/mills/farms/mine/kitchen/
//   smelter/workshop/smithy) + supply routes. Build -> keep FED -> it runs itself (Anno-style, bot-
//   friendly, runs passively while away). Kitchens automate cooking like smelters automate smelting.
// ACTIVE layer = ADVENTURES + HEROES: combat / quests / exploration / bold ventures (hands-on).
// The layers INTERLOCK: the idle economy EQUIPS + FUNDS heroes (gear from smithy, food from kitchen,
// gold from trade); heroes bring back LOOT/PRIZES that feed the economy + the endowment. This IS the
// peasants(passive)+heroes(active) split and "risk the heroes, never the base" — as the whole game's shape.
export const GAME_LAYER = {
  IDLE:   'idle',   // resource management — automated production lines + supply routes (this catalog)
  ACTIVE: 'active', // adventures + heroes — combat/quests/exploration (battle-grid, quests; NOT this catalog)
};
// Business flows that ARE automated production lines (founder §A: "ALL production is automated lines").
const AUTOMATED_FLOWS = new Set(['harvest', 'convert', 'craft', 'cook']);
/**
 * Is this kind an AUTOMATED production line (the IDLE layer: build -> keep fed -> runs itself)?
 * True for ANY kind whose business is a production flow (harvest/convert/craft/cook) — i.e. all of
 * camps/mills/farms/mine/workshop/kitchen/smelter/smithy. The explicit `automatedLine:true` flag (on
 * kitchen/smelter) is an override that also forces true. Civic kinds (warehouse, mansion, stall
 * sell-point) are NOT production lines.
 */
export function isAutomatedLine(kind) {
  const k = STRUCTURE_KINDS[kind];
  if (!k) return false;
  if (k.automatedLine) return true;
  return !!(k.business && AUTOMATED_FLOWS.has(k.business.flow));
}

// ── DESIGN PRINCIPLE: HAUL-FRICTION vs RECIPE-DEPTH (founder 2026-06-27, refined) ───────────────────
// The axis is NOT item-size — it's the SOURCE of complexity:
//   • HAUL-FRICTION = moving multiple HEAVY raws ACROSS REGIONS (logistics). This is the friction we keep
//     LOW for frequent industrial bulk crafts (ingots) — don't make players haul ore+coal+wood every smelt.
//     It IS embraced for BIG occasional builds (boats, structures, mansions): gold + wood/stone hauled in,
//     the cross-region logistics (§8) is the fun there.
//   • RECIPE-DEPTH = combining INGREDIENTS A PLAYER ALREADY HOLDS at a station (cook/craft). This is NOT a
//     pain — it's the depth that makes cooking/crafting GOOD. EMBRACE multi-ingredient recipes here.
// So: industrial bulk (ingots) = single heavy input (avoid haul-friction); COOKING + CRAFTING = rich
// multi-INGREDIENT recipes (held goods, no cross-region haul). Wood keeps heavy demand via building + boats.
export const COMPLEXITY_AXIS = {
  haulFriction: { keepLowFor: ['ingot (industrial bulk)'], embraceFor: ['boat', 'structure', 'mansion'],
                  note: 'heavy raws across regions = logistics; low for frequent crafts, the point for big builds.' },
  recipeDepth:  { embraceFor: ['cooking (pies/wine/stews)', 'crafting (multi-part gear/items)'],
                  note: 'combine held ingredients at a station — depth = fun, not friction. Via craft.js.' },
};
// back-compat alias (older refs): the size framing collapses into the axis above.
export const INPUT_COMPLEXITY = COMPLEXITY_AXIS;

// ── ORE PRICES (LIVE in commodity-tokens.csv, verified 2026-06-27) — the metallurgy raws ──────────────
// Coin-ores priced at 50× their coin; commons sub-gold. TIN repriced (founder 2026-06-27): TIN = 1/10
// COPPER ("10 tin = 1 copper") → tin ore 0.05g — the BOTTOM of the value ladder (cheapest material).
// ⚠ Sheet currently shows TINORE gold=0.5 (the OLD price) — the 0.05 reprice needs the sheet updated
// (coordinator runs the sheet; flagged §11 #20). Other ore prices match the live sheet.
export const ORE_GOLD_PRICE = {
  'tin-ore':    0.05, // ⭐ REPRICED: 1/10 copper. BOTTOM of the value ladder. ⚠ sheet still 0.5 — needs update.
  'iron-ore':   0.5,  // LIVE — common
  'coal':       0.5,  // LIVE — common (steel fuel)
  'copper-ore': 0.5,  // LIVE — coin-ore (= 50× COPPER coin)
  'silver-ore': 5,    // LIVE — coin-ore (= 50× SILVER coin)
  'gold-ore':   50,   // LIVE — coin-ore (= 50× GOLD coin)
};
// VALUE LADDER (cheapest → dearest): TIN (0.05) < iron/coal/copper-ore (0.5) < SHALE/wood-equiv … < silver-ore
// (5) < marble (12) < gold-ore (50). TIN is the floor — minor use (bronze alloy, cans, basic home goods, bunk
// demand); a sub-copper TIN COIN (~$0.00001) + peg LP is an OPTIONAL future (§11 #20).
export const TIN_USES = ['bronze alloy (with copper)', 'CANS (food storage)', 'basic home goods', 'bunk demand'];

// ── INGOT RECIPES (founder SETTLED 2026-06-27: JUST ORE, single-input — with ONE steel exception) ────
// SMELTER consumes ore -> ingot. Single-input by design (small/frequent craft, keep it smooth). NO wood.
// EXCEPTION: STEEL = iron + COAL (flavorful; coal + iron both MOUNTAIN terrain → usually co-located, low
// haul-pain). ORE + COAL tokens are LIVE (sheet); INGOT tokens are the step-2 deploy (design target).
export const INGOT_RECIPE = {
  bronze: { inputs: ['copper-ore', 'tin-ore'], note: 'two ORES (still single material-class: ore). No wood. TIN = cheap alloy filler.' },
  iron:   { inputs: ['iron-ore'],              note: 'ore only.' },
  steel:  { inputs: ['iron-ore', 'coal'],      note: 'EXCEPTION: +COAL. Both MOUNTAIN terrain → usually co-located.' },
};

// ── LUXURY GOODS (coordinator design input 2026-06-27 — DESIGN ONLY, not user-approved) ──────────────
// STATUES + FOUNTAINS (extensible) are the TOP of the crafting tree + a LUXURY SINK for noble mansions
// (§16/§17). Crafted from PREMIUM materials (MARBLE + metals/ingots) at a workshop/smithy. Future tokens
// (none deployed). Demanded by top-tier mansions (lord/pettyking/highking) — scales by rank.
export const LUXURY_GOODS = {
  statue:   { name: 'Marble Statue',   recipe: { marble: 50, ingot: 5 },  token: null, note: 'PROPOSED recipe; no token yet.' },
  fountain: { name: 'Marble Fountain', recipe: { marble: 100, ingot: 10 }, token: null, note: 'PROPOSED recipe; no token yet.' },
  // extensible: obelisk, statue-garden, … (founder adds)
};
/**
 * What a mansion needs to claim a given NOBLE_RANKS rank: the premium stone tier + the luxury-good list,
 * scaling by rank (mayor basic -> highking marble + multiple luxuries). Reads the mansion kind's
 * rankRequirements. Returns null for an unknown rank. DESIGN ONLY (no contract gates this yet).
 * @param {'mayor'|'lord'|'pettyking'|'highking'} rank
 */
export function mansionRequirements(rank) {
  const req = STRUCTURE_KINDS.mansion.rankRequirements[rank];
  if (!req) return null;
  return {
    rank,
    stoneTier: req.stoneTier,
    luxuryGoods: req.luxuryGoods.map((g) => ({ key: g, ...(LUXURY_GOODS[g] || {}) })),
    note: 'PROPOSED (coordinator design input). Mansion gates the office: pop threshold (NOBLE_RANKS) + this build.',
  };
}

export const KIND_LIST = KIND_ORDER.map((k) => STRUCTURE_KINDS[k]);

/** Look up a kind by key (null if unknown). */
export function kindByKey(key) { return STRUCTURE_KINDS[key] || null; }

// ── BUILDABILITY (founder 2026-06-27: "map what's allowed to be built where") ──────────────────────
/**
 * May `kind` be built on `terrainKind`? Grounded in world-features.js terrain doctrine via each kind's
 * `buildableTerrain`. Game-layer gate (build.js), beside the GOLD-exit + town gates. TOWN-buildable kinds
 * require a TOWN hex; raw producers require their wild terrain (forest/mountain/plains/water/sand).
 * @param {string} kind        a STRUCTURE_KINDS key
 * @param {string} terrainKind a world-features.TERRAIN value ('forest'|'mountain'|'plains'|'sand'|'water'|'town')
 * @returns {{ ok:boolean, reason:string|null }}
 */
export function canBuildAt(kind, terrainKind) {
  const k = STRUCTURE_KINDS[kind];
  if (!k) return { ok: false, reason: `unknown kind "${kind}"` };
  const allowed = k.buildableTerrain || [];
  if (allowed.includes(terrainKind)) return { ok: true, reason: null };
  return { ok: false, reason: `${k.name} cannot be built on ${terrainKind} — needs one of: ${allowed.join(', ')}.` };
}

// ── RAW-PRODUCTION DECLINING CURVE (founder CORRECTED 2026-06-27) ───────────────────────────────────
// Raw WILD harvest (logs/berries/game — the `rawProduction:true` kinds) is NOT a flat cap; it's a
// declining curve that peaks at the camp BUNK_CAP (20) and phases to 0 exactly at the TOWN-tier
// population (40). Growing a settlement toward a town = PAVING OVER the wild: every bunk past 20
// converts one raw slot into a refined/town slot. At 40 pop (TOWN) there's "no natural land left" — all
// production is refined/town. This is the PROGRESSIVE mechanical driver of the camp→town climb + the
// logs/berries→grains evolution reroute (§6). Tied to settlements.js BUNK_CAP camp=20 + TOWN pop=40.
export const RAW_BUNK_PEAK = 20; // = settlements.js BUNK_CAP[CAMP] — raw maxes here (full wild camp)
export const TOWN_POP      = 40; // = settlements.js NOBLE_RANKS mayor minPop / TOWN tier — raw hits 0 here
/**
 * How many of a settlement's `totalBunks` may be RAW (logs/berries/game) at a given size.
 *   rawHarvestCap(n) = max(0, min(n, TOWN_POP − n))
 *   n≤20 → all raw allowed; 21→19; 22→18; …; 40→0 (full town, wild fully developed).
 * RECOMMENDATION: apply PER-SETTLEMENT-TOTAL raw bunks (the simplest, matches "no natural land left").
 *   ⚠ per-RAW-JOB nuance (OPEN): if the founder wants each raw job (logging vs forage vs mine) capped
 *   separately, split this into a per-job budget — flagged, not assumed. Total-raw is the recommended default.
 * @param {number} totalBunks the settlement's total bunk count (population)
 * @returns {number} max raw bunks allowed at that size
 */
export function rawHarvestCap(totalBunks) {
  const n = Math.max(0, Math.floor(Number(totalBunks) || 0));
  return Math.max(0, Math.min(n, TOWN_POP - n));
}
/** Is `kind` a RAW-production kind (subject to the declining curve)? */
export function isRawProduction(kind) { return !!(STRUCTURE_KINDS[kind] && STRUCTURE_KINDS[kind].rawProduction); }

// ── AGRICULTURE DECLINING CURVE (founder 2026-06-27 — the SECOND curve, stacks on raw) ──────────────
// Land-hungry production sheds in STAGES as a settlement densifies:
//   (a) RAW HARVEST (logs/berries/game/ore) — peaks 20, phases 20→40, 0 at TOWN (rawHarvestCap above).
//   (b) AGRICULTURE (farming/vineyards/produce) — peaks at the TOWN tier, phases 40→80, 0 at CITY.
//   (c) past 80 = pure MANUFACTURING (no land production at all).
// 80 = settlements.js BUNK_CAP[CITY] / NOBLE_RANKS lord tier. ⚠ The 80 endpoint is CONFIRM-NEEDED.
// SHAPE (proposed, symmetric to the raw curve on the 40→80 band): agriculture is unconstrained up to
// TOWN (40) and ramps DOWN linearly to 0 at CITY (80): agricultureCap(n) = clamp(80 − n, 0..40).
//   n≤40 → up to 40 ag bunks allowed; 41→39; 60→20; 80→0 (pure manufacturing city). PROPOSED.
export const CITY_POP = 80; // = settlements.js BUNK_CAP[CITY] / NOBLE_RANKS lord minPop — agriculture hits 0 here  ⚠ CONFIRM
/**
 * How many of a settlement's `totalBunks` may be AGRICULTURE (farm/vineyard/produce) at a given size.
 *   agricultureCap(n) = max(0, min(TOWN_POP, CITY_POP − n))
 *   n≤40 → up to 40 ag allowed; 41→39; …; 80→0 (CITY = pure manufacturing). PROPOSED shape — see §1.
 * Same per-settlement-TOTAL recommendation + per-job OPEN nuance as rawHarvestCap.
 * @param {number} totalBunks settlement population
 * @returns {number} max agriculture bunks allowed at that size
 */
export function agricultureCap(totalBunks) {
  const n = Math.max(0, Math.floor(Number(totalBunks) || 0));
  return Math.max(0, Math.min(TOWN_POP, CITY_POP - n));
}
/** Is `kind` AGRICULTURE (land-hungry farmed produce — subject to the 40→80 curve)? */
export function isAgriculture(kind) { return !!(STRUCTURE_KINDS[kind] && STRUCTURE_KINDS[kind].agriculture); }

/**
 * The dominant PRODUCTION MODE a settlement is in, by density (the camp→town→city→factory-city arc):
 *   n < TOWN_POP (40)  → 'harvest'       (wild raw still allowed; rawHarvestCap > 0)
 *   TOWN_POP ≤ n < CITY_POP (80) → 'agriculture' (raw gone; farmed produce still allowed)
 *   n ≥ CITY_POP (80)  → 'manufacturing' (no land production — pure factory/refining/crafting)
 * This is the STAGE label; within 'manufacturing' the MIX is player-chosen (§ capstone) — the curves
 * cap land production by density but do NOT dictate which non-land industries a player stacks.
 * @param {number} totalBunks settlement population
 * @returns {'harvest'|'agriculture'|'manufacturing'}
 */
export function productionMode(totalBunks) {
  const n = Math.max(0, Math.floor(Number(totalBunks) || 0));
  if (n < TOWN_POP) return 'harvest';
  if (n < CITY_POP) return 'agriculture';
  return 'manufacturing';
}

// ── MATERIAL COST (founder EXACT: goldCost + a fixed GOLD-WORTH of material; THREE paths) ──────────
/** WOOD (lumber) units to cover `goldWorth` of material at 5 gold/lumber. */
export function woodUnitsForValue(goldWorth) {
  return Math.ceil(goldWorth / LUMBER_GOLD_PRICE);
}
/** STONE units of a given KIND (limestone/sandstone/granite/marble) to cover `goldWorth`. null if unpriced. */
export function stoneUnitsForValue(goldWorth, kind = 'limestone') {
  const price = STONE_GOLD_PRICE[kind];
  if (!price || price <= 0) return null; // kind not priced / no token yet — caller reports it
  return Math.ceil(goldWorth / price);
}
/** BRICKS units to cover `goldWorth`. null until BRICKS is priced (future fired-from-shale token). */
export function brickUnitsForValue(goldWorth) {
  if (!BRICKS_GOLD_PRICE || BRICKS_GOLD_PRICE <= 0) return null;
  return Math.ceil(goldWorth / BRICKS_GOLD_PRICE);
}

/**
 * The MATERIAL requirement for a kind's build, all THREE paths (founder: goldCost + a fixed GOLD-WORTH
 * of material; WOOD | STONE | BRICKS). materialGoldValue = materialGoldValueFor(kind). Never throws —
 * a path/kind reports null units + priced:false where its token/price isn't set. SHALE is NOT a building
 * stone (it's the brick RAW) so it is excluded from the stone path. Surfaces per-path HP/morale/haul.
 * @param {string} key
 * @returns {{ key, goldCost, materialGoldValue,
 *             wood:{units,hp,morale,haulLb,token},
 *             bricks:{units,hp,morale,haulLb,token,priced,note},
 *             stone:{hp,morale,kinds:Record<string,{units,haulLb,goldPrice,token,priced,role}>, note} }}
 */
export function materialCostFor(key) {
  const k = STRUCTURE_KINDS[key];
  if (!k) throw new Error(`unknown kind "${key}"`);
  const materialGoldValue = materialGoldValueFor(key);
  const wm = BUILD_MATERIAL.wood, bm = BUILD_MATERIAL.bricks, sm = BUILD_MATERIAL.stone;
  const wUnits = woodUnitsForValue(materialGoldValue);
  const bUnits = brickUnitsForValue(materialGoldValue);

  // STONE path enumerates the DIRECT building stones only (shale is brick-raw, not a building stone).
  // MORALE scales by kind (STONE_MORALE: limestone small → sandstone/granite mid → marble highest).
  const role = { limestone: 'common', sandstone: 'sometimes', granite: 'sometimes', marble: 'premium' };
  const kinds = {};
  for (const sk of Object.keys(STONE_GOLD_PRICE)) {
    const u = stoneUnitsForValue(materialGoldValue, sk);
    kinds[sk] = {
      units: u, haulLb: u == null ? null : u * sm.weightPerUnit, morale: moraleFor('stone', sk),
      goldPrice: STONE_GOLD_PRICE[sk], token: MATERIAL_TOKEN[sk] || null,
      priced: !!(MATERIAL_TOKEN[sk] && STONE_GOLD_PRICE[sk]), role: role[sk] || 'stone',
    };
  }
  return {
    key, goldCost: k.goldCost, materialGoldValue,
    wood: { units: wUnits, hp: wm.hp, morale: WOOD_MORALE, haulLb: wUnits * wm.weightPerUnit, token: MATERIAL_TOKEN.lumber },
    bricks: { units: bUnits, hp: bm.hp, morale: BRICK_MORALE, haulLb: bUnits == null ? null : bUnits * bm.weightPerUnit,
      token: MATERIAL_TOKEN.bricks, priced: !!(MATERIAL_TOKEN.bricks && BRICKS_GOLD_PRICE),
      note: 'MIDDLE path: fired from SHALE in a brickworks (shale→bricks). BRICKS token FUTURE → units null until priced.' },
    stone: { hp: sm.hp, kinds,
      note: 'STONE path = DIRECT building stones (limestone common / sandstone+granite sometimes / marble premium). MORALE per kind (limestone small → marble highest). MORALE is COSMETIC in protected/safe zones; only a STAT boost for COMBATANT heroes in the untamed wilds. SHALE excluded (brick-raw). limestone+marble LIVE; sandstone+granite FUTURE.' },
  };
}

/**
 * Is this kind WIREABLE on-chain right now? Producers need their per-good RESOURCE-water deployed;
 * TREASURY kinds point at a LIVE coin-water and are wireable as long as that vault is set (it is).
 * addKind reverts on a zero producedGood/endowmentVault — both must be present.
 * @param {string} key
 * @returns {{ wireable:boolean, reason:string|null }}
 */
export function kindWireable(key) {
  const k = STRUCTURE_KINDS[key];
  if (!k) return { wireable: false, reason: `unknown kind "${key}"` };
  if (!k.producedGood) return { wireable: false, reason: 'no producedGood/treasury coin set — addKind reverts on zero.' };
  if (!k.resourceWater) {
    return k.materialKind === 'treasury'
      ? { wireable: false, reason: `treasury vault unset for "${k.producedGood.water}" — point it at a live coin-water (TREASURY_VAULT).` }
      : { wireable: false, reason: `no RESOURCE-water deployed for "${k.producedGood.water}" — deploy the per-good WaterV2 (payout=${k.producedGood.token}) + confirm its buy route first.` };
  }
  return { wireable: true, reason: null };
}

/**
 * Build the addKind argument tuples for every WIREABLE kind (for a founder-gated registration script
 * to consume — it does NOT call anything). goldCost is returned as a STRING of base units (1e18) so a
 * deploy script passes it straight to ethers without precision loss.
 * @returns {Array<{ key:string, label:string, goldCostWei:string, goldCost:number, producedGood:string, endowmentVault:string }>}
 */
export function addKindArgs() {
  const args = [];
  for (const key of KIND_ORDER) {
    const w = kindWireable(key);
    if (!w.wireable) continue; // skip non-wireable kinds (reported separately)
    const k = STRUCTURE_KINDS[key];
    args.push({
      key: k.key,
      label: k.name,
      goldCost: k.goldCost,
      goldCostWei: (BigInt(k.goldCost) * (10n ** 18n)).toString(),
      producedGood: k.producedGood.address,
      endowmentVault: k.resourceWater,
    });
  }
  return args;
}
