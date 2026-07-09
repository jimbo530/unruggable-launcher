// @ts-check
// game/lib/terrain.js — THE TERRAIN GENERATOR: infinite deterministic ground under the
// whole world (founder 2026-07-08: "start building the terrain generater and we will
// make a base map to add it on in all directions").
//
// WHAT THIS IS
//   A pure, seeded function from (col,row) -> terrain, unbounded in ALL directions
//   (negative coords fine). The world is tiled in SHEETS of 256x192 hexes (one sheet ~
//   a subcontinent; ~100 sheets ~ Earth). 1 hex = 1 DAY ON FOOT; boats cover 3 hexes/day
//   on water. Coordinates are SUBSTRATE, NOT IDENTITY — places stay named nodes that sit
//   on hexes and can move; this module only answers "what ground is here?".
//
// THE BIOME PALETTE (founder 2026-07-08): "2 types of forests deciduios and tropical.
//   2 kinds of ocean shallow and deep, beach and desert, grass lands, mountians. river,
//   lake" + "hills, savana" + "volcanic, reef" — plus the D&D staples agreed on top:
//   swamp, tundra (cold band + snow peaks), and RIVER as an overlay flag (a hex is
//   grassland AND has a river). Reefs grow in warm shallows (boatable but a hazard —
//   wreck country); volcanic hexes are rare hotspots (fertile ore, ugly ground; mid-ocean
//   hotspots poke up as volcanic islands); PILLARS = natural stone formations — sea
//   stacks on coasts, hoodoo country in deserts (founder). Other specials (oasis,
//   glowing ponds, BTC/ETH ore) are PAINT-ONLY, never procgen.
//
// CANON RULE (founder): "once generated its cannon unless i change it for some reason."
//   Determinism IS the canon: same seed + same TERRAIN_V -> same world, forever. So:
//   ⚠️ NEVER retune the constants below once a world seed ships — every dial here moves
//   every coastline. Any future algorithm change MUST bump TERRAIN_V and be treated as a
//   NEW world, never a silent reshuffle of the one players walked.
//
// LAYERS (top wins)
//   1) PAINT — the founder's brush. opts.paint maps "col,row" -> partial hex override
//      ({biome:"forest", river:true, deposit:{...}, name:"..."}). Regional maps (Manlan,
//      Isles of 1,000 Kingdoms…) import here at sheet scale (tools/import-map-paint.cjs).
//   2) MACRO — the founder's PLANET painting (opts.macro = planet-macro.json, from
//      tools/import-planet-macro.cjs): says WHERE continents/ridges/ice are across the
//      10x10-sheet planet; sampled with domain warp so his smooth strokes grow fractal
//      hex-scale coastlines. Off the painting: endless ocean.
//   3) PROCGEN — elevation + moisture + temperature fBm -> biome; ridged channel -> rivers;
//      blob channel -> lakes. Temperature = latitude gradient + noise, so sheets nearer
//      the poles run tundra and the equator runs jungle (Earth-like across ~100 sheets).
//
// RESOURCES (prospecting truth — founder: "hard to find stuff thats not just stone")
//   prospect(col,row) is the HIDDEN, deterministic deposit roll: most hexes are BARREN;
//   terrain only bends the odds (mountains ore, rivers gems). Richness poor/good/rich.
//   The roll uses resourceSalt, SEPARATE from the terrain seed: the terrain seed can be
//   public (clients render maps), the resourceSalt stays SERVER-SIDE so nobody strip-mines
//   the truth table client-side. Skill/false-positives/claims live at the game layer —
//   this is only what is actually in the rock.
//
// no silent catches — bad inputs throw; unknown biomes throw.

export const TERRAIN_V = 1;
export const SHEET_W = 256; // hexes per sheet, east-west
export const SHEET_H = 192; // hexes per sheet, north-south
export const FOOT_DAYS_PER_HEX = 1; // founder: each hex is 1 day on foot...
export const BOAT_HEXES_PER_DAY = 3; // ...or 3 spaces by boat

// Latitude: equator at row 0; poles at +/- POLE_ROWS (a ~10x10 sheet planet). Rows past
// the poles clamp to polar cold. Part of the canon — see CANON RULE.
export const POLE_ROWS = 960;

// travel days per hex ON FOOT by biome (Infinity = impassable on foot). Founder's flat
// 1-day rule holds on easy ground; jungle/swamp/mountains cost 2 (very D&D — dial freely
// BEFORE the world seed ships, never after).
export const MOVE_COST = {
  "deep-ocean": Infinity, "shallows": Infinity, "reef": Infinity, "lake": Infinity, // boat country
  "beach": 1, "grassland": 1, "savanna": 1, "forest": 1, "desert": 1, "tundra": 1, "hills": 1, "pillars": 1,
  "jungle": 2, "swamp": 2, "mountains": 2, "volcanic": 2,
  "peaks": Infinity, // the snow wall at the top of the world — passes get PAINTED
};
export const BOATABLE = { "deep-ocean": true, "shallows": true, "reef": true, "lake": true };
// biomes that are dangerous to cross even when passable — the game layer reads this for
// encounter/wreck odds (reefs eat hulls; volcanic ground burns boots)
export const HAZARD = { "reef": true, "volcanic": true };

export const BIOMES = Object.keys(MOVE_COST);

// ── deterministic hashing / noise ────────────────────────────────────────────────────
function hash2(seed, x, y) {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
function rand01(seed, x, y) { return hash2(seed, x, y) / 4294967296; }

function valueNoise(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = rand01(seed, xi, yi), b = rand01(seed, xi + 1, yi);
  const c = rand01(seed, xi, yi + 1), d = rand01(seed, xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// fBm: 5 octaves. Base wavelength ~170 hexes -> continents span sheets; detail to ~10 hexes.
function fbm(seed, x, y, baseWavelength = 170) {
  let amp = 1, freq = 1 / baseWavelength, sum = 0, norm = 0;
  for (let o = 0; o < 5; o++) {
    sum += amp * valueNoise(seed + o * 1013, x * freq + o * 37.7, y * freq + o * 61.3);
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

// salts — part of the canon; see the CANON RULE above.
const ELEV_SALT = 0x0e1e7a71, MOIST_SALT = 0x00151172, RIVER_SALT = 0x0417e57a;
const TEMP_SALT = 0x7e307e30, LAKE_SALT = 0x1a3e1a3e;
const VOLC_SALT = 0x501ca10c, REEF_SALT = 0x0eef0eef, PILLAR_SALT = 0x9111a125;
const WARP_A = 0x3a3a7a11, WARP_B = 0x7b1b5b31;

// ── the MACRO layer: the founder's PLANET PAINTING as ground truth ───────────────────
// planet-macro.json (tools/import-planet-macro.cjs) = 512x512 classes ocean/land/ridge/ice
// over the 10x10-sheet planet. hexAt samples it with DOMAIN WARP (fractal coastlines from
// smooth strokes) and blends: macro says WHERE land is, noise says what it feels like.
// Outside the painting: endless deep ocean (rare procgen seamounts).
export function decodeMacroRLE(json) {
  if (!json || !json.rle || !json.W) throw new Error("[terrain] bad macro json");
  const data = new Uint8Array(json.W * json.H);
  for (let y = 0; y < json.H; y++) {
    let x = 0;
    for (const run of json.rle[y].split(",")) {
      const [cls, n] = run.split(":").map(Number);
      data.fill(cls, y * json.W + x, y * json.W + x + n);
      x += n;
    }
    if (x !== json.W) throw new Error("[terrain] macro row " + y + " length " + x);
  }
  return data;
}

// hex centers: flat-top odd-q offset (matches location.js) — odd columns sit half a hex south.
function hexCenter(col, row) { return { x: col, y: row + (col & 1) * 0.5 }; }

// ── biome derivation ─────────────────────────────────────────────────────────────────
const SEA_LEVEL = 0.5;      // ~55-60% ocean — it is a SEAS game
const BEACH_BAND = 0.012;   // thin sand ring just above the tide

function deriveBiome(e, m, t) {
  if (e < SEA_LEVEL - 0.03) return "deep-ocean";
  if (e < SEA_LEVEL) return "shallows";
  if (e < SEA_LEVEL + BEACH_BAND) return "beach";
  if (e > 0.78) return "peaks";
  if (e > 0.70) return "mountains";
  if (e > 0.64) return "hills";
  if (t < 0.22) return "tundra";
  if (m > 0.72 && e < 0.56) return "swamp";
  if (t > 0.66) { // the hot band
    if (m < 0.42) return "desert";
    if (m > 0.54) return "jungle";
    return "savanna";
  }
  if (m < 0.38) return "desert";
  if (m > 0.54) return "forest";
  return "grassland";
}

// ── resources: the hidden truth table ────────────────────────────────────────────────
// chance = odds this hex holds ANY deposit; table = weighted kinds. Most rock is stone.
const DEPOSITS = {
  "mountains": { chance: 1 / 12, table: [["iron", 30], ["copper", 22], ["tin", 14], ["coal", 14], ["silver", 9], ["gold", 6], ["gems", 5]] },
  "peaks":     { chance: 1 / 14, table: [["silver", 30], ["gold", 25], ["gems", 30], ["iron", 15]] },
  "hills":     { chance: 1 / 18, table: [["copper", 30], ["tin", 20], ["iron", 20], ["coal", 15], ["clay", 10], ["silver", 5]] },
  "desert":    { chance: 1 / 25, table: [["copper", 30], ["gems", 20], ["gold", 10], ["stone", 40]] },
  "swamp":     { chance: 1 / 30, table: [["bog-iron", 50], ["peat", 50]] },
  "grassland": { chance: 1 / 40, table: [["clay", 50], ["stone", 50]] },
  "savanna":   { chance: 1 / 40, table: [["clay", 40], ["stone", 45], ["copper", 15]] },
  "forest":    { chance: 1 / 40, table: [["clay", 40], ["stone", 60]] },
  "jungle":    { chance: 1 / 35, table: [["gems", 25], ["gold", 15], ["clay", 30], ["stone", 30]] },
  "tundra":    { chance: 1 / 35, table: [["iron", 35], ["coal", 35], ["stone", 30]] },
  "volcanic":  { chance: 1 / 8,  table: [["obsidian", 30], ["sulfur", 25], ["gems", 20], ["gold", 15], ["iron", 10]] },
  "reef":      { chance: 1 / 18, table: [["pearls", 60], ["coral", 40]] },
  "pillars":   { chance: 1 / 20, table: [["stone", 60], ["gems", 20], ["copper", 20]] },
  "beach": null, "deep-ocean": null, "shallows": null, "lake": null,
};
const RIVER_BONUS = { chance: 1 / 20, table: [["gems", 40], ["gold-dust", 60]] };
const RICHNESS = [["rich", 10], ["good", 30], ["poor", 60]];

function pickWeighted(table, r01) {
  let total = 0;
  for (const [, w] of table) total += w;
  let t = r01 * total;
  for (const [kind, w] of table) { t -= w; if (t <= 0) return kind; }
  return table[table.length - 1][0];
}

// ── the world ────────────────────────────────────────────────────────────────────────
/**
 * Build a world view. { seed, resourceSalt?, paint?, macro? }
 *  seed         — the public terrain seed (int). Same seed = same world, forever.
 *  resourceSalt — SERVER-ONLY salt for prospect(); omit on clients (prospect throws).
 *  paint        — founder overrides: { "col,row": { biome?, river?, deposit?, name? } }
 *  macro        — planet-macro.json content: the founder's planet painting as landmass
 *                 truth (omit = pure procgen world).
 */
export function makeWorld(opts = {}) {
  const seed = Number(opts.seed);
  if (!Number.isFinite(seed)) throw new Error("[terrain] makeWorld needs a numeric seed");
  const resourceSalt = opts.resourceSalt == null ? null : Number(opts.resourceSalt);
  const paint = opts.paint || {};
  const macro = opts.macro ? {
    W: opts.macro.W, H: opts.macro.H, cols: opts.macro.cols, rows: opts.macro.rows,
    colOff: opts.macro.colOff, rowOff: opts.macro.rowOff, data: decodeMacroRLE(opts.macro),
  } : null;

  // bilinear landness/ridgeness/iceness from the macro classes at a (possibly warped) hex pos
  function macroSample(x, y) {
    const mx = (x - macro.colOff) / macro.cols * macro.W - 0.5;
    const my = (y - macro.rowOff) / macro.rows * macro.H - 0.5;
    let L = 0, R = 0, I = 0;
    const x0 = Math.floor(mx), y0 = Math.floor(my);
    for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const xx = x0 + dx, yy = y0 + dy;
      const w = (1 - Math.abs(mx - xx)) * (1 - Math.abs(my - yy));
      if (w <= 0 || xx < 0 || yy < 0 || xx >= macro.W || yy >= macro.H) continue; // off-map = ocean
      const cls = macro.data[yy * macro.W + xx];
      if (cls === 1 || cls === 2 || cls === 3) L += w;
      if (cls === 2) R += w;
      if (cls === 3) I += w;
    }
    return { L, R, I };
  }

  function hexAt(col, row) {
    col = Math.floor(Number(col)); row = Math.floor(Number(row));
    if (!Number.isFinite(col) || !Number.isFinite(row)) throw new Error("[terrain] bad coords");
    const { x, y } = hexCenter(col, row);
    let e, iceBoost = 0;
    if (macro) {
      // domain warp: fractal coastlines out of smooth painted strokes
      const wx = x + (fbm(seed ^ WARP_A, x, y, 60) - 0.5) * 22;
      const wy = y + (fbm(seed ^ WARP_B, x, y, 60) - 0.5) * 22;
      const s = macroSample(wx, wy);
      e = 0.335 + s.L * 0.23 + s.R * 0.13 + (fbm(seed ^ ELEV_SALT, x, y) - 0.5) * 0.24;
      iceBoost = s.I;
    } else {
      e = fbm(seed ^ ELEV_SALT, x, y);
    }
    const m = fbm(seed ^ MOIST_SALT, x, y);
    // temperature: latitude gradient (equator row 0 hot -> poles cold) + noise weather;
    // painted ice (the Icey Waste) forces deep cold whatever the latitude says
    const lat = Math.min(1, Math.abs(row) / POLE_ROWS);
    let t = Math.max(0, Math.min(1, (1 - lat) * 0.8 + (fbm(seed ^ TEMP_SALT, x, y, 240) - 0.5) * 0.5));
    t = Math.max(0, t - iceBoost * 0.8);
    let biome = deriveBiome(e, m, t);
    // stone pillars (founder): natural rock formations — sea stacks on the coast,
    // hoodoo/butte country in the deserts. Rare small blobs; dramatic landmark ground.
    if ((biome === "beach" || biome === "desert") && fbm(seed ^ PILLAR_SALT, x, y, 16) > 0.7) biome = "pillars";
    // reefs: blobs in WARM shallows — wreck country with pearls in it
    if (biome === "shallows" && t > 0.5 && fbm(seed ^ REEF_SALT, x, y, 20) > 0.64) biome = "reef";
    // volcanic hotspots: rare; claims high ground outright, and mid-ocean hotspots
    // poke above the waves as volcanic islands
    const volc = fbm(seed ^ VOLC_SALT, x, y, 90);
    if (volc > 0.72) {
      if (biome === "mountains" || biome === "peaks" || biome === "hills") biome = "volcanic";
      else if ((biome === "deep-ocean" || biome === "shallows") && volc > 0.78) biome = "volcanic";
    }
    // lakes: small high-frequency blobs on low walkable land
    if (MOVE_COST[biome] !== Infinity && biome !== "volcanic" && e < 0.62) {
      if (fbm(seed ^ LAKE_SALT, x, y, 26) > 0.76) biome = "lake";
    }
    // rivers: ridged contour lines on walkable land below the snow line (overlay flag)
    let river = false;
    if (MOVE_COST[biome] !== Infinity || biome === "lake") {
      const rv = 1 - Math.abs(2 * fbm(seed ^ RIVER_SALT, x, y) - 1);
      river = rv > 0.991;
    }
    const p = paint[col + "," + row];
    if (p) {
      if (p.biome != null) {
        if (!(p.biome in MOVE_COST)) throw new Error("[terrain] painted unknown biome: " + p.biome);
        biome = p.biome;
      }
      if (p.river != null) river = !!p.river;
    }
    return {
      col, row, biome, river,
      water: !!BOATABLE[biome],
      elevation: e, moisture: m, temp: t,
      footDays: MOVE_COST[biome],
      boatable: !!BOATABLE[biome],
      painted: !!p, name: p && p.name || null,
      v: TERRAIN_V,
    };
  }

  /** The HIDDEN deposit truth for a hex. Server-side only (needs resourceSalt). */
  function prospect(col, row) {
    if (resourceSalt == null) throw new Error("[terrain] prospect() needs resourceSalt (server-side only)");
    const hex = hexAt(col, row);
    const p = paint[hex.col + "," + hex.row];
    if (p && p.deposit !== undefined) return { ...hex, deposit: p.deposit }; // painted truth (incl. explicit null)
    const spec = DEPOSITS[hex.biome];
    let deposit = null;
    if (spec && rand01(resourceSalt, hex.col, hex.row) < spec.chance) {
      const kind = pickWeighted(spec.table, rand01(resourceSalt + 7, hex.col, hex.row));
      const richness = pickWeighted(RICHNESS, rand01(resourceSalt + 13, hex.col, hex.row));
      deposit = { kind, richness };
    }
    // rivers pan separately — placer gravel in the bends
    if (!deposit && hex.river && rand01(resourceSalt + 29, hex.col, hex.row) < RIVER_BONUS.chance) {
      const kind = pickWeighted(RIVER_BONUS.table, rand01(resourceSalt + 31, hex.col, hex.row));
      const richness = pickWeighted(RICHNESS, rand01(resourceSalt + 37, hex.col, hex.row));
      deposit = { kind, richness, placer: true };
    }
    return { ...hex, deposit };
  }

  /** Which sheet a hex sits on (sheets tile all directions; negatives fine). */
  function sheetOf(col, row) {
    return { sx: Math.floor(col / SHEET_W), sy: Math.floor(row / SHEET_H) };
  }

  /** Biome distribution over one sheet (sampling stride `step` for speed). */
  function sheetStats(sx, sy, step = 4) {
    const counts = {}; let n = 0;
    for (let r = 0; r < SHEET_H; r += step) {
      for (let c = 0; c < SHEET_W; c += step) {
        const b = hexAt(sx * SHEET_W + c, sy * SHEET_H + r).biome;
        counts[b] = (counts[b] || 0) + 1; n++;
      }
    }
    for (const k of Object.keys(counts)) counts[k] = Math.round((counts[k] / n) * 1000) / 10;
    return counts; // percentages
  }

  return { seed, version: TERRAIN_V, hexAt, prospect, sheetOf, sheetStats };
}
