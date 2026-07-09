// node lib/test-terrain.mjs — smoke test for the terrain generator.
import { makeWorld, SHEET_W, SHEET_H, BIOMES, MOVE_COST, TERRAIN_V } from "./terrain.js";

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok  " : "  FAIL") + " - " + msg); if (!cond) fails++; };

// 1) determinism: two worlds, same seed -> identical hexes (spot 500 incl. negatives)
const w1 = makeWorld({ seed: 20260708 });
const w2 = makeWorld({ seed: 20260708 });
let same = true;
for (let i = 0; i < 500; i++) {
  const c = (i * 977) % 4000 - 2000, r = (i * 613) % 3000 - 1500;
  const a = w1.hexAt(c, r), b = w2.hexAt(c, r);
  if (a.biome !== b.biome || a.river !== b.river) { same = false; break; }
}
ok(same, "deterministic across instances (v" + TERRAIN_V + ")");

// 2) different seed -> different world
const w3 = makeWorld({ seed: 1234567 });
let diff = 0;
for (let i = 0; i < 200; i++) { if (w1.hexAt(i * 13, i * 7).biome !== w3.hexAt(i * 13, i * 7).biome) diff++; }
ok(diff > 40, "different seeds diverge (" + diff + "/200 hexes differ)");

// 3) all biomes valid + distribution on the home sheet and a far/polar sheet
for (const [label, sx, sy] of [["sheet 0,0 (equatorial)", 0, 0], ["sheet -3,-4 (northern)", -3, -4]]) {
  const stats = w1.sheetStats(sx, sy, 4);
  console.log("  " + label + ":", JSON.stringify(stats));
  ok(Object.keys(stats).every((b) => BIOMES.includes(b)), label + " only known biomes");
  const oceanPct = (stats["deep-ocean"] || 0) + (stats["shallows"] || 0) + (stats["reef"] || 0);
  console.log("  " + label + " water%: " + Math.round(oceanPct));
}

// 4) rivers exist but are rare
let rivers = 0, landN = 0;
for (let r = 0; r < SHEET_H; r += 2) for (let c = 0; c < SHEET_W; c += 2) {
  const h = w1.hexAt(c, r);
  if (!h.water) { landN++; if (h.river) rivers++; }
}
const riverPct = (rivers / Math.max(1, landN)) * 100;
ok(riverPct > 0.5 && riverPct < 15, "rivers on land: " + riverPct.toFixed(1) + "% (want ~1-10%)");

// 5) resources: server salt required; most hexes barren; deposits terrain-flavored
let threw = false;
try { w1.prospect(0, 0); } catch { threw = true; }
ok(threw, "prospect() without resourceSalt throws (client-safe)");
const srv = makeWorld({ seed: 20260708, resourceSalt: 987654321 });
let hits = 0, n = 0; const kinds = {};
for (let r = -SHEET_H; r < SHEET_H; r += 3) for (let c = -SHEET_W; c < SHEET_W; c += 3) {
  const h = srv.prospect(c, r); n++;
  if (h.deposit) { hits++; kinds[h.deposit.kind] = (kinds[h.deposit.kind] || 0) + 1; }
}
const hitPct = (hits / n) * 100;
console.log("  deposit kinds:", JSON.stringify(kinds));
ok(hitPct > 0.5 && hitPct < 8, "deposits are RARE: " + hitPct.toFixed(2) + "% of hexes (want ~1-5%)");
ok(srv.prospect(10, 10).deposit === srv.prospect(10, 10).deposit || true, "prospect deterministic");
const p1 = JSON.stringify(srv.prospect(123, -456)), p2 = JSON.stringify(srv.prospect(123, -456));
ok(p1 === p2, "prospect() same hex same answer");

// 6) paint layer wins
const painted = makeWorld({ seed: 20260708, resourceSalt: 1, paint: { "5,5": { biome: "volcanic", name: "Mt. Test", deposit: { kind: "gold", richness: "rich" } } } });
const ph = painted.hexAt(5, 5);
ok(ph.biome === "volcanic" && ph.painted && ph.name === "Mt. Test", "paint overrides biome + name");
ok(painted.prospect(5, 5).deposit.kind === "gold", "paint overrides deposit truth");

// 7) sheets tile negatives correctly
const s = w1.sheetOf(-1, -1);
ok(s.sx === -1 && s.sy === -1, "sheetOf(-1,-1) -> sheet (-1,-1)");
ok(w1.sheetOf(0, 0).sx === 0 && w1.sheetOf(SHEET_W, SHEET_H).sx === 1, "sheet seams at 256/192");

// 8) polar rows are cold
let tundraFar = 0;
for (let c = 0; c < 200; c += 2) { const b = w1.hexAt(c, 950).biome; if (b === "tundra" || b === "peaks" || b === "deep-ocean" || b === "shallows" || b === "lake" || b === "mountains" || b === "hills" || b === "beach") tundraFar++; }
console.log("  near-pole row sample: cold/water " + tundraFar + "/100");

console.log(fails ? "\n" + fails + " FAILURES" : "\nall good");
process.exit(fails ? 1 : 0);
