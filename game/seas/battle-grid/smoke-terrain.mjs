// smoke-terrain.mjs — TERRAIN EFFECTS smoke test. Proves the Wave-4 map data now AFFECTS combat
// (not just paints): a COVER tile raises a target's EFFECTIVE AC through the strike()/forecast()
// chokepoint, and a BLOCKING (wall) tile is UNREACHABLE in the move-range BFS. Also spot-checks
// the hazard / water-edge / on-enter descriptors. Deterministic (injected d20), no DOM, no chain.
//   Run: node game/seas/battle-grid/smoke-terrain.mjs
import { coverACAt, blockedKeys, isBlocked, hazardAt, waterEdgeAt, tileEntryEffect } from "./terrain-effects.js";
import { strike, forecast } from "./combat-helpers.js";
import { getMap, terrainIndex } from "./maps/index.js";
import { setGrid, hexesInRange } from "./grid-config.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };
const keyset = (hexes) => new Set(hexes.map((h) => `${h.q},${h.r}`));

// Synthetic combatants (mirror crit-ranges.mjs): attacker atkBonus 0 vs AC 10 so a nat 11 is a
// borderline HIT — until cover lifts the effective AC to 12 and the same swing MISSES. No weapon
// dice (weapon:null), no active effects → the only variable is terrain cover.
const mkAtk = () => ({ name: "Atk", stats: { attack: 10, atkBonus: 0, ac: 10 }, equipped: { weapon: null }, activeEffects: [], currentHp: 50, maxHp: 50 });
const mkTgt = () => ({ name: "Tgt", stats: { attack: 0, atkBonus: 0, ac: 10 }, equipped: {}, activeEffects: [], rawAbilities: {}, currentHp: 100, maxHp: 100 });

const bilge = getMap("bilge");
const bilgeIx = terrainIndex(bilge);
setGrid(bilge.grid.cols, bilge.grid.rows);   // 16×9 — the board the bilge terrain is authored for

// authored bilge hexes: COVER at (4,2) {mod.ac:2}, HAZARD pool at (7,4), WALL ribs at (3,0)/(12,0)/(3,8)/(12,8)
const COVER = { q: 4, r: 2 }, HAZARD = { q: 7, r: 4 }, WALL = { q: 3, r: 0 }, OPEN = { q: 4, r: 0 };

console.log("── A) COVER raises EFFECTIVE AC (through the chokepoint) ──");
ok(coverACAt(bilgeIx, COVER) === 2, `coverACAt(cover tile) = +2 AC (authored mod.ac) (got ${coverACAt(bilgeIx, COVER)})`);
ok(coverACAt(bilgeIx, HAZARD) === 0, "coverACAt(a non-cover tile) = 0 (no bonus)");

// forecast(): the HUD hit% must drop by exactly one cover-step (2 AC = 2/20 = 0.10 of the faces)
const fOpen = forecast(mkAtk(), mkTgt(), { coverAC: 0 });
const fCover = forecast(mkAtk(), mkTgt(), { coverAC: coverACAt(bilgeIx, COVER) });
ok(Math.abs(fOpen.hitPct - 0.55) < 1e-9, `forecast hit% open = 0.55 (got ${fOpen.hitPct})`);
ok(Math.abs(fCover.hitPct - 0.45) < 1e-9, `forecast hit% behind +2 cover = 0.45 (got ${fCover.hitPct})`);
ok(fCover.hitPct < fOpen.hitPct && Math.abs((fOpen.hitPct - fCover.hitPct) - 0.10) < 1e-9, "cover LOWERS the forecast hit chance by exactly +2 AC worth");

// strike(): the SAME borderline swing (nat 11) HITS in the open but MISSES behind cover — proof
// the effective AC actually rose inside the verbatim engine via the chokepoint.
const sOpen = strike(mkAtk(), mkTgt(), { nat: 11, distance: 1, coverAC: 0 });
const sCover = strike(mkAtk(), mkTgt(), { nat: 11, distance: 1, coverAC: coverACAt(bilgeIx, COVER) });
ok(sOpen.hit === true, "nat-11 swing HITS a target in the open (AC 10)");
ok(sCover.hit === false, "the SAME nat-11 swing MISSES a target on a +2 cover tile (effective AC 12) — terrain MATTERS");

console.log("── B) BLOCKING (wall) tile is UNREACHABLE ──");
ok(isBlocked(bilgeIx, WALL) === true, "isBlocked(wall hex) = true");
ok(isBlocked(bilgeIx, COVER) === false, "isBlocked(cover hex) = false (cover is passable)");
const bk = blockedKeys(bilgeIx);
ok(bk.size === 4 && bk.has("3,0"), `blockedKeys = the 4 hull-rib walls incl (3,0) (got ${bk.size}: ${[...bk].join(" ")})`);
ok(!bk.has("4,2"), "blockedKeys excludes the cover tile (only walls block)");

// CONTROL: with NO occupancy the wall hex (3,0) is geometrically reachable from (4,1) in range 2.
const reachOpen = keyset(hexesInRange({ q: 4, r: 1 }, 2, new Set()));
ok(reachOpen.has("3,0"), "control: wall hex (3,0) IS reachable when nothing blocks it");
// WITH the terrain block union'd in (what game.js occupiedSet does), the wall is UNREACHABLE,
// while an adjacent OPEN tile (4,0) stays reachable — movement excludes walls, nothing else.
const reachBlocked = keyset(hexesInRange({ q: 4, r: 1 }, 2, blockedKeys(bilgeIx)));
ok(!reachBlocked.has("3,0"), "wall hex (3,0) is UNREACHABLE once terrain blocks are applied");
ok(reachBlocked.has(`${OPEN.q},${OPEN.r}`), "an adjacent OPEN tile (4,0) is still reachable (only the wall is removed)");

console.log("── C) HAZARD / WATER-EDGE on-enter descriptors ──");
const hz = hazardAt(bilgeIx, HAZARD);
ok(hz && hz.dmg === 2, `hazardAt(bilge pool) → 2 dmg on enter (got ${hz && hz.dmg})`);
ok(tileEntryEffect(bilgeIx, COVER) === null, "tileEntryEffect(cover) = null (cover triggers nothing on enter)");
ok(tileEntryEffect(bilgeIx, WALL) === null, "tileEntryEffect(wall) = null (you can't enter a wall anyway)");

const kraken = getMap("open-sea-kraken");
const krakenIx = terrainIndex(kraken);
const we = waterEdgeAt(krakenIx, { q: 15, r: 0 });
ok(we && we.dc === 12 && we.dmg === 4, `waterEdgeAt(seaward rail) → reflex DC 12 / 4 overboard dmg (got ${we && we.dc}/${we && we.dmg})`);
const wfx = tileEntryEffect(krakenIx, { q: 15, r: 0 });
ok(wfx && wfx.type === "water-edge", "tileEntryEffect(water-edge) → a water-edge fall check");

// un-authored / absent terrain → every helper is a graceful no-op (duels & training behave as before)
ok(coverACAt(null, COVER) === 0 && blockedKeys(null).size === 0 && tileEntryEffect(null, COVER) === null, "no terrain data → coverAC 0 · no blocks · no on-enter effect (back-compat)");

console.log(fails === 0 ? "\nTERRAIN EFFECTS: ALL PASS ✅" : `\n${fails} TERRAIN CHECK(S) FAILED ❌`);
process.exit(fails ? 1 : 0);
