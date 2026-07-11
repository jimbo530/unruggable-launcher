# DESIGN TRUTH — the income rails (read before filing an income "flaw")

_Founder + coordinator design model, 2026-07-11. This is not a bug list — it is HOW THE ECONOMY IS
MEANT TO WORK. Evaluate every rail against this before filing a flaw. Several standing flaws are
misfilings against this model (crab-dispenser especially)._

**RUNG 0 — from ZERO, the income path is FIGHTING.** A brand-new pawn with no coin, no flow, and no
gear earns its first copper by winning fights it can clearly win (bilge-rats and up). Fighting is the
one rail that needs no prior capital and no fund-flow. It is the faster, riskier road to treasure —
adventuring pays lumps, not drips. When the loot-payout keeper is on, a verified win banks copper +
goods; when it is off, that is a real harness flaw worth filing (the keeper, not the rail).

**HARVEST JOBS (crabbing / fishing) ARE NOT FREE INCOME — and they REQUIRE fund-flow.** On the
operator side, harvesting is SELLING GOODS AT A STEEP DISCOUNT at the dock versus what those goods
fetch at other venues. In-game it is skinned as "your pawn goes to work"; underneath, the player is
either working the job or directing their pawn's FUNDING FLOW (its water / fee-flow) into buying
crabs/fish at the dock. No in-game GOLD is spent — the flow is the fuel. Therefore:
  - A ZERO-FLOW pawn CANNOT harvest. This is BY DESIGN, not a broken dispenser. The crab/fish
    "dispenser not wired" flaw is a MISFILING — there is no free zero-capital harvest rail and there
    is not meant to be one (founder: "no pawn should have zero capital" — pawns FIGHT, get WATERED,
    or ROW; the free crab ground was deliberately retired, seed recovered).
  - The WAGE is the SPREAD: dock buy-price vs the dear sell-price elsewhere (e.g. ocean fish ~0.1g →
    Port Royal ~1g). Transport across that gap is the fisher's income, not a giveaway.
  - So a harvest rail failing "because I have no flow / no gold" is the rail WORKING. Fund the pawn
    first (fight for coin, or water it so flow exists), then harvest.

**WAGES ELSEWHERE ARE SLOW-DRIP BY DESIGN.** Clocking a pawn into a WorkClock job (haul/mend/stock/
beacon/rites/barter/guard) accrues time that pays a thin, steady wage — DAYS of work for a meaningful
buildup. That is intentional: the honest-labor climb is a grind, the treasure road (fight/adventure)
is faster and riskier. A wage that is small is not a flaw; a wage of exactly ZERO because a job token
has no volume/yield IS worth noting (the flow, not the job).

**FIRST GOLD — attested achievement rungs** pay 1% of a live prize pool: the richest single moves.
They need the house attest first (an off-game step), then the owner claims. Claim windows DRIFT as
pools drain — always source claim ids from a FRESH read at claim time, never a cached window.

## How the bots should evaluate a rail (decision order)
1. Do I have ZERO capital and ZERO flow? → FIGHT (the only from-zero rail). Don't grind harvest/wages.
2. Do I have flow but little coin? → harvest (fish/crab) IS available; the wage is the sell-spread.
3. Do I have coin/gold? → water a pawn (levels/flow), or build; compound.
4. Do I have earned+attested rungs? → claim them (fresh read first) — the fattest single payouts.
5. A rail that refuses for lack of flow/coin/presence is usually WORKING (a gate), not broken. File a
   flaw only when a rail that SHOULD pay banks nothing anyway (e.g. loot keeper off, wage flow zero).

## Standing flaws that are MISFILINGS against this model (stop re-filing)
- "crab/fish dispenser not wired / zero-capital rail missing" — there is NO free zero-capital harvest
  by design. From zero you FIGHT. Harvest needs flow. Working as intended.
- "harvest requires gold funding + presence" — yes; that is the rail's design (flow-funded, gated).
