// @ts-check
'use strict';
/**
 * roll-charts.js — the ROLL-CHART PRIZE CONFIG + the SERVER-AUTHORITATIVE roll engine for
 * "Seize the Seas". Founder-approved 2026-06-27. Compliance-reconciled framing:
 *
 *   "win by SKILL  →  win a RANDOM PRIZE"  /  "what treasure you find"
 *
 *   The WIN is skill-gated (you must actually beat the encounter — verified server-side by
 *   verify-fight's REPLAY of the deterministic engine). The reward was NEVER guaranteed and is
 *   never PAID FOR. There is NO paid roll → this is a LOOT TABLE, not gambling. Framing here and
 *   anywhere downstream NEVER says spin / jackpot / odds / wager / gamble / bet / chance.
 *
 * WHY THIS IS A PURE MODULE (no ethers, no I/O, no RNG of its own)
 *   The roll MUST be server-authoritative + anti-grind + tamper-proof + un-re-rollable. The seas
 *   combat settlement ALREADY pins an unguessable, server-random seed per fight (issue-seed →
 *   rec.seed) and CONSUMES the nonce on a conclusive verdict (one settlement per nonce). So the
 *   roll is simply a DETERMINISTIC FUNCTION of that already-pinned seed: rollFromSeed(seed, chart).
 *   - Server-authoritative: derived from the SERVER's seed, never a client number.
 *   - Anti-grind / un-re-rollable: same seed → same roll, ALWAYS; and the seed's nonce is spent on
 *     the win, so the same fight can't be re-rolled for a better prize.
 *   - No new RNG surface: reuses the proven crypto-random seed; this file only HASHES it.
 *   This module is therefore SAFE to live under game/seas/ (no ethers) and is required by the
 *   server (game/server/seas-server.js). It NEVER moves funds — it only NAMES the pool + amount-
 *   basis to fire; the founder-gated keeper performs the actual on-chain payout.
 *
 * THE NUMBERED SHARED PRIZE POOLS (loot tables, canonical LootPool.sol; payout = live balance×bps)
 *   1  BILGE   — existing, LIVE+stocked  (0xE07CE9Ec642d42C5c8A0068203068BAc6042bF57)
 *   2  GOBLIN  — existing, LIVE+stocked  (0xf917d1660c72F2D48141a965c82CCBE8a2A175A6)
 *   3  COVE    — low-level adventure, COPPER/TIN-tier rations + trade goods   (deploy pending)
 *   4  WRECK   — low-level adventure, COPPER/TIN-tier salvage + ore           (deploy pending)
 *   5  CAVE    — low-level adventure, COPPER/TIN-tier forage + stone          (deploy pending)
 *   6  ROAD    — low-level adventure, COPPER/TIN-tier rations + produce       (deploy pending)
 *   Pools 3-6 addresses are filled in by the coordinator's deploy (deploy-adventure-lootpools.js
 *   writes deploy/adventure-lootpools-deployed.json); until then POOLS[n].address === null and the
 *   server returns a HONEST "pool not deployed" note instead of faking a fire.
 *
 * THE PER-LOCATION CHART (LOCATION_CHARTS) — one entry per fight/dungeon location:
 *   { dice, pools:[poolIds...], fires, crit?:{ on, topPool?, bonusRoll? } }
 *     dice   : 'd6' now. Designed for 'd20' + crit later (parseDice handles dN generically).
 *     pools  : the SUBSET of numbered pools this chart can fire (the loot-table the win draws from).
 *     fires  : how many pools fire on a normal win (1 now; multi-fire later — array length resolved).
 *     crit   : OPTIONAL future rule — on a top-of-die roll, fire the chart's TOP-PRIZE pool and/or
 *              grant a BONUS roll. Wired + tested but OFF for the d6 single-fire launch (crit:null).
 *   bilge/goblin/bilge-rats-quest map to the EXISTING pools 1+2 to start; the four low-level
 *   adventure dungeons draw from the copper/tin pools 3-6.
 */

// ── the numbered shared prize pools. address:null until the coordinator deploys (no fake fire). ──
// EXISTING pool addresses are verified against game/seas/battles-loot-pools.csv +
// game/seas/citizen/tools/fight.js (LOOT_POOL) — NOT hand-typed.
const POOLS = {
  1: { id: 1, key: 'bilge',  label: 'Bilge Rats',     address: '0xE07CE9Ec642d42C5c8A0068203068BAc6042bF57' },
  2: { id: 2, key: 'goblin', label: 'Goblin Cave',    address: '0xf917d1660c72F2D48141a965c82CCBE8a2A175A6' },
  // pools 3-6: LOW-LEVEL adventure loot tables (copper/tin-tier). address filled by deploy record.
  3: { id: 3, key: 'cove',   label: 'Smuggler’s Cove', address: '0xD91aC2c7A73318793541Efe8c39FFe866133945e' },
  4: { id: 4, key: 'wreck',  label: 'Tidewater Wreck',      address: '0x1C7Cc48C7638F62870A4D00eC0C80e60cf5095bD' },
  5: { id: 5, key: 'cave',   label: 'Coastal Cave',         address: '0xa0914dF5Faa9cc844F74e35Eda7e1F91A2bd445e' },
  6: { id: 6, key: 'road',   label: 'Old Coast Road',       address: '0xDfabac2334A7360c416a27Dce1614657990096b0' },
};

// ══════════════════════════════════════════════════════════════════════════════════════════
// THE SECONDARY-DRAW TIER POOLS (founder 2026-07-01, the settled loot model + AREA add-on)
// ──────────────────────────────────────────────────────────────────────────────────────────
// Every fight win = TWO layers, all BACK-END (players never see dice/odds — only the treasure):
//   (1) CORE      — the creature's GUARANTEED signature (loot-signatures.js resolveSignature()).
//   (2) SECONDARY — a HIDDEN chance (LOW at CR0-1, rising by CR) to ALSO draw from a general tier
//                   pool matched to BOTH the fight's CR BAND (tier = VALUE) AND its AREA/biome
//                   (theme). resolveRoll() below owns that draw.
//
// TIER_POOLS is the general-tier catalog (game/seas/prize-pools-by-level.csv). The EXISTING 6
// (ids 1-6) ARE the tier-0-1 coast/sea band. The tier-2-3 + tier-4-5 pools are NEW (deploy pending:
// address:null until mftusd-build/deploy-tier-lootpools.cjs writes tier-lootpools-deployed.json;
// the server returns an honest "pool not deployed" note instead of faking a fire — same as pools 3-6).
//
// KEEPING POOL COUNT SANE (founder add-on #2): NOT a full areas×tiers matrix. Each new pool SPANS
// its whole band and is AREA-THEMED; tier-0-1 reuses the existing 6. 6 + 5 + 4 = 15 pools total.
const TIER_POOLS = {
  // tier 0-1 (CR0-1): the existing coast/sea/road/cave starter pools (ids 1-6). address = the live ones.
  '0-1': [
    { key: 'bilge',  label: 'Bilge Rats',      areas: ['at-sea', 'interior'],      address: POOLS[1].address },
    { key: 'goblin', label: 'Goblin Cave',     areas: ['cave', 'coast'],           address: POOLS[2].address },
    { key: 'cove',   label: 'Smuggler’s Cove', areas: ['cove', 'coast'],           address: POOLS[3].address },
    { key: 'wreck',  label: 'Tidewater Wreck', areas: ['at-sea', 'coast'],         address: POOLS[4].address },
    { key: 'cave01', label: 'Coastal Cave',    areas: ['cave', 'coast'],           address: POOLS[5].address },
    { key: 'road',   label: 'Old Coast Road',  areas: ['plains', 'road'],          address: POOLS[6].address },
  ],
  // tier 2-3 (CR2-3): iron/bronze/silver, AREA-themed. NEW — address filled by deploy record.
  '2-3': [
    { key: 'deepwood',  label: 'Deepwood Cache', areas: ['forest', 'jungle'],      address: null },
    { key: 'highland',  label: 'Highland Lode',  areas: ['mountains', 'highlands'],address: null },
    { key: 'corsair',   label: "Corsair's Hold", areas: ['at-sea', 'ocean'],       address: null },
    { key: 'mire',      label: 'Mire Harvest',   areas: ['swamp', 'marsh'],        address: null },
    { key: 'warren',    label: 'Warren Depths',  areas: ['cave', 'underground'],   address: null },
  ],
  // tier 4-5 (CR4-5): fine goods, spices, quality materials, rare gold. NEW — address filled by deploy.
  '4-5': [
    { key: 'wilds',    label: 'Wilds Bounty',   areas: ['forest', 'mountains', 'jungle'], address: null },
    { key: 'abyssal',  label: 'Abyssal Trove',  areas: ['at-sea', 'ocean', 'abyss'],      address: null },
    { key: 'barrow',   label: 'Barrow Vault',   areas: ['ruins', 'crypt', 'underground', 'cave'], address: null },
    { key: 'hoard',    label: "Dragon's Hoard", areas: ['apex', 'dragon'],                address: null },
  ],
};

/** CR → tier band. CR0-1 → '0-1'  ·  CR2-3 → '2-3'  ·  CR4-5(+) → '4-5'. Non-numeric/absent → '0-1'. */
function tierForCR(cr) {
  const n = Number(cr);
  if (!Number.isFinite(n) || n <= 1) return '0-1';
  if (n <= 3) return '2-3';
  return '4-5';
}

// AREA/biome → a normalized theme tag used to pick a thematically-coherent pool from the tier band.
// Keyed by area-encounters.js AREAS[].biome AND by the fight-kind area id, so either drives it.
// Unknown/absent → 'coast' (the safe default tier-0-1 theme).
const BIOME_THEME = {
  // biomes (area-encounters.js AREAS[].biome)
  harbor: 'coast', coast: 'coast', reef: 'at-sea', ocean: 'at-sea', abyss: 'at-sea',
  cave: 'cave', interior: 'at-sea', weather: 'at-sea', cove: 'coast', jungle: 'forest',
  // extra themes the tier pools carry
  forest: 'forest', woods: 'forest', mountains: 'mountains', highlands: 'mountains',
  swamp: 'swamp', marsh: 'swamp', underground: 'cave', ruins: 'ruins', crypt: 'ruins',
  plains: 'plains', road: 'plains', apex: 'apex', dragon: 'apex', 'at-sea': 'at-sea', 'deep-sea': 'at-sea',
};

/** Normalize an area/biome hint → a theme tag. Accepts a biome, an AREAS id, or a raw string. */
function themeForArea(area) {
  const a = String(area || '').toLowerCase().trim();
  if (BIOME_THEME[a]) return BIOME_THEME[a];
  // area-encounters.js AREAS ids may be hyphenated (e.g. 'coastal-shallows','open-sea','sea-caves').
  // Check CAVE before SEA so 'sea-caves' (contains both) themes as a cave, not sea.
  if (/cave|grotto|warren|underground/.test(a)) return 'cave';
  if (/sea|ocean|reef|tide|water|abyss|deep/.test(a)) return 'at-sea';
  if (/forest|wood|jungle/.test(a)) return 'forest';
  if (/mountain|highland|ridge|peak/.test(a)) return 'mountains';
  if (/swamp|marsh|mire|fen|bog/.test(a)) return 'swamp';
  if (/ruin|crypt|barrow|tomb/.test(a)) return 'ruins';
  if (/road|plain|field/.test(a)) return 'plains';
  return 'coast';
}

// secondChance(cr): the HIDDEN probability the SECONDARY tier pool ALSO fires. LOW at CR0-1, rising
// by CR. Founder: ~8-12% at CR0-1. Curve: base 0.10 at CR0-1, +~0.08 per CR step, capped 0.55.
// Returned ONLY inside resolveSecondary()'s decision — NEVER exposed in any client-facing shape.
function secondChance(cr) {
  const n = Number.isFinite(Number(cr)) ? Math.max(0, Number(cr)) : 0;
  const p = 0.10 + 0.08 * n;         // CR0→.10 · CR1→.18 · CR2→.26 · CR3→.34 · CR4→.42 · CR5→.50
  return Math.max(0.05, Math.min(0.55, p));
}

/**
 * Per-location roll charts. Keyed by the SAME fight-kind keys the server's FIGHT_KINDS uses, so a
 * verified win for kind K rolls LOCATION_CHARTS[K]. A kind with no chart entry fires nothing (the
 * win still stands; it simply has no roll-chart prize wired — honest, not faked).
 *
 * LAUNCH = d6, single-fire, no crit. The shape carries dice/fires/crit so d20/crit/multi-fire drop
 * in later WITHOUT touching the engine (rollFromSeed already reads them).
 */
// ⭐ Founder 2026-07-01: "the 6 prize pools are to be randomly drawn from — ONE each time you win a
// fight." So EVERY fight win rolls a d6 across the shared set of ALL 6 pools and the roll DRAWS which
// one pays (roll 1→pool 1 … roll 6→pool 6). Same 6 shared pools for every encounter = maximum payout
// variety with only 6 funded pools. resolveRoll() below selects the firing pool BY the roll value.
const SIX_POOL_DRAW = { dice: 'd6', pools: [1, 2, 3, 4, 5, 6], fires: 1, crit: null };
const LOCATION_CHARTS = {
  'bilge-rats':       { ...SIX_POOL_DRAW },
  'bilge-rats-quest': { ...SIX_POOL_DRAW },
  'goblin-cave':      { ...SIX_POOL_DRAW },
  'smugglers-cove':   { ...SIX_POOL_DRAW },
  'tidewater-wreck':  { ...SIX_POOL_DRAW },
  'coastal-cave':     { ...SIX_POOL_DRAW },
  'old-coast-road':   { ...SIX_POOL_DRAW },
  // the daily-chance work encounters (founder 2026-07-01) draw the SAME shared 6:
  'forest-wolves':    { ...SIX_POOL_DRAW },
  'beach-crabs':      { ...SIX_POOL_DRAW },
  'fishing-pirates':  { ...SIX_POOL_DRAW },
};
// Any fight kind not explicitly listed still draws 1 of the 6 (every win gets a treasure roll).
const DEFAULT_CHART = { ...SIX_POOL_DRAW };

/** Parse 'dN' → N (the number of faces). Throws (visibly) on garbage — never a silent default. */
function parseDice(dice) {
  const m = /^d(\d+)$/.exec(String(dice || '').trim());
  if (!m) throw new Error(`bad dice spec "${dice}" — expected dN (e.g. d6, d20)`);
  const faces = Number(m[1]);
  if (!(faces >= 2)) throw new Error(`dice must have >= 2 faces (got ${faces})`);
  return faces;
}

/**
 * Deterministically derive an INTEGER roll in [1..faces] from a server-pinned seed.
 *   - `hashFn(string) -> hex` is INJECTED (the server passes a crypto sha256 hex digest). Keeping
 *     the hash injectable lets this stay a pure, dependency-free module AND keeps the selftest
 *     hermetic. The server ALWAYS supplies a real crypto hash — there is no insecure fallback.
 *   - `salt` namespaces multiple rolls off ONE seed (a bonus/multi roll uses salt '1','2',… so the
 *     extra rolls are independent yet still 100% determined by the same pinned seed → un-re-rollable).
 * The result is uniform-enough for a loot die: we take the first 13 hex chars (52 bits) of
 * hash(seed|'roll'|salt) as an integer and mod by faces. (Tiny modulo bias at 52 bits over a small
 * die is negligible for prizes; documented, not hidden.)
 */
function rollFromSeed(seed, dice, hashFn, salt = '') {
  if (typeof seed !== 'string' || seed.length < 8) throw new Error('rollFromSeed: a server-pinned seed (string) is required — never a client value');
  if (typeof hashFn !== 'function') throw new Error('rollFromSeed: a hashFn(string)->hex is required (server injects crypto sha256)');
  const faces = parseDice(dice);
  const hex = String(hashFn(`${seed}|roll|${salt}`));
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 13) throw new Error('rollFromSeed: hashFn must return >= 13 hex chars');
  const n = parseInt(hex.slice(0, 13), 16);   // 52 bits
  return (n % faces) + 1;                      // 1..faces
}

/**
 * Resolve the full roll for a verified win at `fightKind`, off the server-pinned `seed`.
 * PURE + DETERMINISTIC: identical (fightKind, seed) ALWAYS yields the identical result. Returns a
 * description of WHICH numbered pool(s) to fire — it does NOT fire anything (the keeper does, and
 * only on a founder-gated, server-verified win).
 *
 * @returns {{
 *   fight:string, dice:string, roll:number, faces:number, crit:boolean,
 *   fires: Array<{ poolId:number, pool:{id,key,label,address}, basis:'balance*bps', deployed:boolean }>,
 *   bonusRoll: number|null,
 *   framing: string
 * }}
 */
function resolveRoll(fightKind, seed, hashFn) {
  // every fight kind draws (unlisted kinds fall back to the shared 6-pool draw — no unrewarded wins).
  const chart = LOCATION_CHARTS[fightKind] || DEFAULT_CHART;
  const faces = parseDice(chart.dice);
  const roll = rollFromSeed(seed, chart.dice, hashFn);

  // ⭐ THE ROLL DRAWS WHICH POOL PAYS: map the die face onto the chart's pool set (roll 1 → 1st pool,
  // … roll 6 → 6th pool). With the shared d6 over all 6 pools this is an even 1-of-6 draw per win.
  const drawIndex = (roll - 1) % chart.pools.length;
  const drawCount = Math.max(1, Math.min(Number(chart.fires) || 1, chart.pools.length));
  let chosenPoolIds = [];
  for (let i = 0; i < drawCount; i++) chosenPoolIds.push(chart.pools[(drawIndex + i) % chart.pools.length]);

  // CRIT (future): a top-of-die roll may steer to a TOP-PRIZE pool and/or grant a BONUS roll. OFF
  // for the d6 launch (crit:null). When set: crit.on = the face that crits (e.g. faces for "nat 20").
  let crit = false, bonusRoll = null;
  if (chart.crit && roll >= Number(chart.crit.on)) {
    crit = true;
    if (chart.crit.topPool && POOLS[chart.crit.topPool]) {
      // steer the fire to the top-prize pool (kept within the chart's declared pools for safety)
      if (chart.pools.includes(chart.crit.topPool)) chosenPoolIds.length = 0, chosenPoolIds.push(chart.crit.topPool);
    }
    if (chart.crit.bonusRoll) bonusRoll = rollFromSeed(seed, chart.dice, hashFn, '1'); // independent, same seed
  }

  // how many pools fire (1 now). Never more than the chart's available pools (no fabricated fires).
  const fireCount = Math.max(1, Math.min(Number(chart.fires) || 1, chosenPoolIds.length));
  const fires = chosenPoolIds.slice(0, fireCount).map((poolId) => {
    const pool = POOLS[poolId];
    if (!pool) throw new Error(`chart "${fightKind}" references unknown pool id ${poolId}`);
    return {
      poolId,
      pool: { id: pool.id, key: pool.key, label: pool.label, address: pool.address },
      basis: 'balance*bps',          // LootPool pays floor(live balance × per-token bps) of each stocked good
      deployed: pool.address !== null, // honest: a not-yet-deployed pool cannot be fired (server says so)
    };
  });

  return {
    fight: fightKind, dice: chart.dice, roll, faces, crit, fires, bonusRoll,
    framing: 'You won by skill — see what treasure you find.', // compliance: never spin/jackpot/odds
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// THE WIN-LOOT RESOLVER (founder 2026-07-01 settled model) — CORE + SECONDARY, all BACK-END.
// ──────────────────────────────────────────────────────────────────────────────────────────
// resolveWinLoot(win, seed, hashFn) → { core, secondary }
//   core      = the creature's GUARANTEED signature pool ref (loot-signatures.resolveSignature()).
//               PASS the resolved signature in `win.signature` (server calls resolveSignature first,
//               so this module stays free of the ESM bestiary import). If absent, core=null + a note.
//   secondary = null, OR a general TIER pool ref matched to BOTH the CR BAND and the AREA/biome.
//
// DETERMINISM + ANTI-RE-ROLL: both the "does the secondary fire?" decision AND "which pool" are pure
// functions of the SAME server-pinned seed, salted ('sec-fire' / 'sec-pick') so they're independent
// yet 100% reproducible and un-re-rollable (the seed's nonce is spent on the win upstream).
//
// COMPLIANCE: the returned shape NAMES pools + an amount-BASIS only. It NEVER returns the odds, the
// secondChance value, the roll integers, or any spin/jackpot/odds text. Framing stays "you won by
// skill — see what treasure you find." A client-facing serializer should surface ONLY the goods/pool
// labels that actually PAID, never the mechanism.

/** Uniform float in [0,1) from a salted hash of the pinned seed (independent per salt). */
function floatFromSeed(seed, hashFn, salt) {
  if (typeof seed !== 'string' || seed.length < 8) throw new Error('floatFromSeed: server-pinned seed required');
  if (typeof hashFn !== 'function') throw new Error('floatFromSeed: hashFn(string)->hex required');
  const hex = String(hashFn(`${seed}|sec|${salt}`));
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 13) throw new Error('floatFromSeed: hashFn must return >= 13 hex chars');
  return parseInt(hex.slice(0, 13), 16) / 0x10000000000000; // 52 bits → [0,1)
}

/**
 * Resolve the SECONDARY tier-pool draw for a win. PURE + DETERMINISTIC off the pinned seed.
 * @param {number} cr             the fight's effective CR (drives BOTH the tier band and the odds)
 * @param {string} area           the fight's area/biome (AREAS id or biome) — drives the theme
 * @param {string} seed           the server-pinned per-fight seed
 * @param {(s:string)=>string} hashFn  crypto sha256 hex (server injects)
 * @returns {null | { tier:string, theme:string, poolKey:string, poolLabel:string,
 *                    basis:'balance*bps', deployed:boolean }}
 */
function resolveSecondary(cr, area, seed, hashFn) {
  const tier = tierForCR(cr);
  const theme = themeForArea(area);
  // 1) does it fire? (hidden — never surfaced)
  const fires = floatFromSeed(seed, hashFn, 'sec-fire') < secondChance(cr);
  if (!fires) return null;

  // 2) which pool: prefer a pool in this tier whose areas include the theme; else any pool in the tier.
  const band = TIER_POOLS[tier] || TIER_POOLS['0-1'];
  const themed = band.filter((p) => p.areas.includes(theme));
  const candidates = themed.length ? themed : band;
  if (!candidates.length) return null; // defensive — a tier should never be empty
  const pick = Math.floor(floatFromSeed(seed, hashFn, 'sec-pick') * candidates.length) % candidates.length;
  const pool = candidates[pick];
  return {
    tier, theme,
    poolKey: pool.key, poolLabel: pool.label,
    basis: 'balance*bps',
    deployed: pool.address != null, // honest: a not-yet-deployed tier pool cannot fire
  };
}

/**
 * The full win-loot resolution: CORE (guaranteed signature) + SECONDARY (hidden CR+area tier draw).
 * @param {{ cr?:number, area?:string, signature?:object }} win  the verified win context.
 *        `signature` = the object from loot-signatures.resolveSignature(creatureDef) (server passes it).
 * @param {string} seed  server-pinned per-fight seed
 * @param {(s:string)=>string} hashFn crypto sha256 hex
 * @returns {{ core: object|null, coreNote?:string, secondary: object|null,
 *             framing:string }}
 */
function resolveWinLoot(win, seed, hashFn) {
  if (!win || typeof win !== 'object') throw new Error('resolveWinLoot: win context required ({cr,area,signature})');
  const cr = Number.isFinite(Number(win.cr)) ? Number(win.cr) : 0;
  const area = win.area || '';

  // CORE: the creature's guaranteed signature (resolved upstream by loot-signatures.js). We do NOT
  // import the bestiary here (keeps this a pure CommonJS module); the server passes win.signature.
  let core = null, coreNote;
  if (win.signature && Array.isArray(win.signature.goods)) {
    core = {
      source: win.signature.source || 'signature',
      goods: win.signature.goods.map((g) => ({ sym: g.sym, kind: g.kind, note: g.note })),
      hasCoin: !!win.signature.hasCoin,
      coinSym: win.signature.hasCoin ? (win.signature.coinSym || 'COPPER') : null,
      basis: 'signature-core',
    };
  } else {
    coreNote = 'no signature supplied — server must call loot-signatures.resolveSignature(creatureDef) first';
  }

  const secondary = resolveSecondary(cr, area, seed, hashFn);
  return {
    core, ...(coreNote ? { coreNote } : {}),
    secondary,
    framing: 'You won by skill — see what treasure you find.',
  };
}

/** All fight kinds that have a roll chart (for docs / selftest enumeration). */
function chartedFights() { return Object.keys(LOCATION_CHARTS); }

module.exports = {
  POOLS, LOCATION_CHARTS, TIER_POOLS,
  parseDice, rollFromSeed, resolveRoll, chartedFights,
  tierForCR, themeForArea, secondChance, resolveSecondary, resolveWinLoot,
};
