// @ts-check
/**
 * upkeep.starvation.test.js — UNIVERSAL EATING + starvation debuff (founder 2026-06-28).
 * Proves: every pawn needs to eat (no free-eat exclude); hungryDays/starvationPenalty are
 * cumulative (−1 all stats per unfed day); applyStarvation floors at 1; autoEat consumes from
 * inventory oldest-first; and the debuff FOLDS INTO COMBAT via buildUnit (a 3-day-hungry pawn
 * fights weaker, and eating restores it to base). Run: node --test  (from game/lib/).
 *
 * Uses an injected `now` everywhere so the dev-scaled DAY_MS is irrelevant — fully deterministic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  feed, isFed, hungryDays, starvationPenalty, applyStarvation, autoEat,
  isSheltered, needsRations, isUseful, DAY_MS, STARVE_STAT_FLOOR,
  autoEatCrew, cheapestFood, foodValue,
  hungryDaysFrom, starvationPenaltyFrom, eatBatch,
} from "./upkeep.js";
import { buildUnit } from "../seas/battle-grid/units.js";

const t0 = 1_000_000_000_000; // fixed epoch base so DAY_MS scaling is irrelevant
const day = (n) => t0 + n * DAY_MS;

test("UNIVERSAL EATING: no free-eat exclude — every pawn needs rations, town or wild", () => {
  // the old EXCLUDE model is gone: sheltered is always false, needsRations always true.
  assert.equal(isSheltered({ atPort: true, working: true }), false, "nothing is free-fed anymore");
  assert.equal(needsRations({ atPort: true }), true, "every pawn needs rations");
  assert.equal(needsRations({ atSea: true }), true, "at sea too");
});

test("hungryDays / starvationPenalty: cumulative −1 all stats per unfed day", () => {
  const id = "pawn_hunger_A";
  feed(id, "rations", t0);                 // fed through t0 + 1 day
  assert.equal(isFed(id, day(0)), true);
  assert.equal(hungryDays(id, day(0)), 0, "just fed → 0 hungry days");
  // by the END of day 1 still covered (fedUntil = t0 + 1 day); go past it:
  assert.equal(hungryDays(id, day(1)), 0, "exactly at fedUntil → not yet hungry");
  assert.equal(hungryDays(id, day(4)), 3, "fedUntil=+1d, now=+4d → 3 whole days unfed");
  assert.equal(starvationPenalty(id, day(4)), -3, "−1 × 3 = −3 to ALL stats");
});

test("applyStarvation: lowers every score by |penalty|, floors at STARVE_STAT_FLOOR (1)", () => {
  const id = "pawn_hunger_B";
  feed(id, "rations", t0);                 // fedUntil = t0 + 1 day
  const scores = { STR: 18, DEX: 12, CON: 14, INT: 10, WIS: 2, CHA: 1 };
  const out = applyStarvation(scores, id, day(4));   // 3 days hungry → −3
  assert.deepEqual(out, { STR: 15, DEX: 9, CON: 11, INT: 7, WIS: 1, CHA: 1 },
    "each −3, but WIS 2→1 and CHA 1→1 floor at 1 (never 0/negative)");
  assert.equal(STARVE_STAT_FLOOR, 1);
  // pure: original untouched
  assert.equal(scores.STR, 18, "input not mutated");
});

test("autoEat: consumes 1 food/day cheapest-first; runs dry → remaining days go hungry", () => {
  const id = "pawn_eat_C";
  feed(id, "rations", t0);                 // fedUntil = t0 + 1 day
  const inv = { apple: 2, cod: 1 };        // 3 food units; apple value 1, cod value 3
  // jump to +4 days: 3 uncovered days (days 2,3,4) → eats 3 units, fully caught up.
  const r = autoEat(id, inv, day(4));
  assert.equal(r.ate, 3, "ate 3 days of food");
  assert.deepEqual(r.foods, ["apple", "apple", "cod"], "cheapest-first: apples (v1) before cod (v3)");
  assert.deepEqual(inv, {}, "inventory drained");
  assert.equal(hungryDays(id, day(4)), 0, "caught up → not hungry");

  // now starve: jump another 3 days with NO food → 3 hungry days accrue, autoEat ate 0.
  const r2 = autoEat(id, {}, day(7));
  assert.equal(r2.ate, 0, "no food → ate nothing");
  assert.equal(r2.hungryDays, 3, "3 days uncovered and unfed");
});

test("autoEat partial: feeds what it can, leaves the rest hungry", () => {
  const id = "pawn_eat_D";
  feed(id, "rations", t0);                 // fedUntil = t0 + 1 day
  const inv = { jerky: 1 };                // only 1 unit for 3 uncovered days
  const r = autoEat(id, inv, day(4));
  assert.equal(r.ate, 1, "ate the 1 unit it had");
  assert.deepEqual(inv, {}, "drained");
  assert.equal(hungryDays(id, day(4)), 2, "fed 1 of 3 days → still 2 days hungry");
  assert.equal(starvationPenalty(id, day(4)), -2);
});

test("foodValue / cheapestFood: rank by FOOD_MORALE; unknown food = Infinity (preserved); ties = first-seen", () => {
  assert.equal(foodValue("rations"), 0);
  assert.equal(foodValue("apple"), 1);
  assert.equal(foodValue("wine"), 8);
  assert.equal(foodValue("dragon_steak"), Infinity, "unknown food → preserved, never auto-eaten first");
  // cheapest among a mixed bag: rations(0) < apple(1) < wine(8) < unknown(∞)
  assert.equal(cheapestFood({ wine: 1, apple: 1, rations: 1, dragon_steak: 1 }), "rations");
  // zero-qty entries are skipped
  assert.equal(cheapestFood({ rations: 0, apple: 2 }), "apple");
  // tie on value → first-seen key wins (deterministic)
  assert.equal(cheapestFood({ cod: 1, fish: 1 }), "cod", "cod & fish both v3 → first-seen (cod)");
  assert.equal(cheapestFood({}), null);
});

test("autoEat LOWEST-VALUE FIRST: spends staples before gourmet, preserving morale food", () => {
  const id = "pawn_eat_value";
  feed(id, "rations", t0);                 // fedUntil = t0 + 1 day
  // 2 uncovered days (now = +3d). Inventory has gourmet + a staple; eat the STAPLE first.
  const inv = { saffron: 5, wine: 5, apple: 1, rations: 1 };  // values 12, 8, 1, 0
  const r = autoEat(id, inv, day(3));
  assert.equal(r.ate, 2, "ate 2 days");
  assert.deepEqual(r.foods, ["rations", "apple"], "cheapest-first: rations(0) then apple(1)");
  assert.deepEqual(inv, { saffron: 5, wine: 5 }, "gourmet (saffron/wine) preserved untouched");
});

test("autoEat ONCE PER DAY, BATCHED: N elapsed days → ONE batched catch-up of N foods (cheapest-first)", () => {
  const id = "pawn_eat_batch";
  feed(id, "rations", t0);                 // fedUntil = t0 + 1 day
  // jump 5 days late at ONCE → 4 uncovered days → ONE batched eat of 4 foods, spanning cheap items.
  const inv = { rations: 2, apple: 5, pork: 3 };  // values 0,0 then 1×N then 4×N
  const r = autoEat(id, inv, day(5));      // fedUntil +1d, now +5d → 4 uncovered days
  assert.equal(r.ate, 4, "ONE batched op fed all 4 elapsed days");
  assert.deepEqual(r.foods, ["rations", "rations", "apple", "apple"],
    "batch spans cheapest-first: 2 rations(0) then 2 apples(1) — pork(4) preserved");
  assert.deepEqual(inv, { apple: 3, pork: 3 }, "exactly 4 cheapest units consumed in the batch");
  assert.equal(hungryDays(id, day(5)), 0, "fully caught up in one daily op");
});

test("autoEatCrew SHARED store: a ship's crew eats once/day from ONE mess; staples spent before gourmet", () => {
  const ids = ["crew_1", "crew_2", "crew_3"];
  for (const id of ids) feed(id, "rations", t0);     // all fed through +1 day
  // 1 uncovered day each (now = +2d) → 3 crew × 1 day = 3 units needed; mess has 2 staples + gourmet.
  const ship = { rations: 2, wine: 9 };              // cheapest-first: spend 2 rations, then 1 wine
  const r = autoEatCrew(ids, ship, day(2), { shared: true });
  assert.equal(r.totalAte, 3, "the SHARED mess fed all 3 crew (staples first, then 1 gourmet as last resort)");
  assert.equal(r.fed, 3, "all 3 crew ate");
  assert.deepEqual(ship, { wine: 8 }, "2 rations gone; gourmet only dipped into AFTER staples (8 wine left)");
  assert.deepEqual(r.perPawn["crew_1"].foods, ["rations"], "crew 1 ate a staple");
  assert.deepEqual(r.perPawn["crew_2"].foods, ["rations"], "crew 2 ate the last staple");
  assert.deepEqual(r.perPawn["crew_3"].foods, ["wine"], "crew 3 fell back to gourmet (nothing cheaper left)");
  // a SHORT mess starves the surplus crew → debuff (prove the sink bites when stores run dry)
  const ids2 = ["dry_1", "dry_2"];
  for (const id of ids2) feed(id, "rations", t0);
  const empty = { rations: 1 };
  const r2 = autoEatCrew(ids2, empty, day(2), { shared: true });
  assert.equal(r2.totalAte, 1, "1 ration for 2 crew → only 1 eats");
  assert.equal(starvationPenalty("dry_2", day(2)), -1, "the unfed crew member takes the all-stats debuff");
});

test("autoEatCrew PER-PAWN: each pawn eats from its OWN inventory, cheapest-first, batched", () => {
  const ids = ["sailor_A", "sailor_B"];
  for (const id of ids) feed(id, "rations", t0);     // fed through +1 day
  // PER-PAWN map (a key matches a pawnId → per-pawn mode auto-detected). 2 uncovered days each (+3d).
  const invs = {
    sailor_A: { apple: 5, wine: 1 },                 // eats 2 apples, keeps the rest + wine
    sailor_B: { cod: 1 },                            // only 1 → eats 1, stays 1 day hungry
  };
  const r = autoEatCrew(ids, invs, day(3));          // auto-detect per-pawn
  assert.deepEqual(r.perPawn["sailor_A"].foods, ["apple", "apple"], "A batched cheapest-first");
  assert.deepEqual(invs["sailor_A"], { apple: 3, wine: 1 }, "A ate 2 apples; surplus apples + wine preserved");
  assert.equal(r.perPawn["sailor_B"].ate, 1, "B ate its 1 cod");
  assert.equal(r.perPawn["sailor_B"].hungryDays, 1, "B still 1 day hungry");
});

test("PURE CORE (server-shared): hungryDaysFrom / starvationPenaltyFrom / eatBatch — no store", () => {
  // these are the EXACT functions seas-server.js reuses against its own state.rations map.
  assert.equal(hungryDaysFrom(0, day(5)), 0, "no fedUntil → never tracked → 0 (server: pawn never ate)");
  assert.equal(hungryDaysFrom(day(1), day(4)), 3, "fedUntil +1d, now +4d → 3 unfed days");
  assert.equal(starvationPenaltyFrom(day(1), day(4)), -3, "−1 × 3 = −3 (server-side penalty)");
  assert.equal(starvationPenaltyFrom(day(9), day(4)) || 0, 0, "still-fed → 0 penalty");

  // eatBatch: once-per-day, BATCHED, cheapest-first, pure over { fedUntil } + foodInv.
  const rec = { fedUntil: day(1) };                  // covered through +1 day
  const foodInv = { saffron: 3, rations: 2, apple: 1 }; // values 12, 0, 1
  const r = eatBatch(rec, foodInv, day(4));          // 3 uncovered days
  assert.equal(r.ate, 3, "batched: fed all 3 elapsed days in one step");
  assert.deepEqual(r.foods, ["rations", "rations", "apple"], "cheapest-first: 2 rations then 1 apple");
  assert.deepEqual(foodInv, { saffron: 3 }, "gourmet saffron preserved; staples spent");
  assert.equal(r.fedUntil, day(4), "fedUntil advanced 3 days → caught up to now");
  assert.equal(r.hungryDays, 0, "no longer hungry");

  // dry inventory → remaining days stay hungry (the server debuff then bites)
  const rec2 = { fedUntil: day(1) };
  const r2 = eatBatch(rec2, {}, day(4));
  assert.equal(r2.ate, 0, "no food → ate nothing");
  assert.equal(r2.hungryDays, 3, "3 days unfed");
  assert.equal(r2.fedUntil, day(1), "fedUntil unmoved when nothing eaten");
});

test("COMBAT WIRE: a 3-day-hungry pawn fights weaker; eating restores it to base (DRY via buildUnit)", () => {
  const id = "pawn_combat_E";
  // STR-heavy build so the debuff visibly moves to-hit/damage. egp pumps STR+DEX, burgers CON.
  const endowment = { egp: 20, burgers: 10 };
  const mk = (now) => buildUnit({ id, now, isPlayer: true, name: "Hand", emoji: "x",
    endowment, role: "melee", position: { q: 1, r: 1 } });

  // BASELINE: never fed → no upkeep record → penalty 0 → base stats.
  const base = mk(t0);
  const baseSnap = { STR: base.engineStats.STR, attack: base.stats.attack,
    atkBonus: base.stats.atkBonus, ac: base.stats.ac, hp: base.maxHp };

  // STARVE 3 days: feed once (fedUntil=t0+1d), then build the unit at +4 days.
  feed(id, "rations", t0);
  const hungry = mk(day(4));
  assert.equal(starvationPenalty(id, day(4)), -3, "3 days unfed → −3");
  assert.equal(hungry.engineStats.STR, baseSnap.STR - 3, "STR −3");
  assert.ok(hungry.stats.attack < baseSnap.attack, `attack dropped (${hungry.stats.attack} < ${baseSnap.attack})`);
  assert.ok(hungry.stats.atkBonus < baseSnap.atkBonus, `to-hit dropped (${hungry.stats.atkBonus} < ${baseSnap.atkBonus})`);
  assert.ok(hungry.stats.ac < baseSnap.ac, `AC dropped (${hungry.stats.ac} < ${baseSnap.ac})`);
  assert.ok(hungry.maxHp < baseSnap.hp, `HP dropped (${hungry.maxHp} < ${baseSnap.hp})`);

  // EAT → caught up → rebuild at the same instant → restored to base (byte-for-byte).
  const fed = autoEat(id, { rations: 3 }, day(4));
  assert.equal(fed.ate, 3, "ate 3 days");
  assert.equal(hungryDays(id, day(4)), 0, "no longer hungry");
  const restored = mk(day(4));
  assert.equal(restored.engineStats.STR, baseSnap.STR, "STR restored");
  assert.equal(restored.stats.attack, baseSnap.attack, "attack restored");
  assert.equal(restored.stats.atkBonus, baseSnap.atkBonus, "to-hit restored");
  assert.equal(restored.stats.ac, baseSnap.ac, "AC restored");
  assert.equal(restored.maxHp, baseSnap.hp, "HP restored to base");

  // A pawn with NO upkeep record (monster/dummy) is never debuffed.
  const monster = buildUnit({ id: "MONSTER_no_record", now: day(999), isPlayer: false,
    name: "Goblin", emoji: "g", endowment, role: "melee", position: { q: 5, r: 5 } });
  assert.equal(monster.stats.attack, baseSnap.attack, "no upkeep record → no debuff (monsters unaffected)");
});
