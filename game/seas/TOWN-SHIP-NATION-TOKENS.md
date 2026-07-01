# Ships, Buildings, Nations — the token model (founder design, 2026-07-01)

The ownership layer of the whole world, one rule: **real things get tokens.**

## The rule

- **Ship = one token per ship.** (Already the pattern: 1 ERC20 per hull; ship flags exist.)
- **Town = one token per BUILDING.** A town is a collection of building tokens, not one
  monolith token.
- **Nation = a national token, later** — same family as ship flags.

## Buildings

- **The base building is a house for 1 pawn.** That's the floor.
- **Capacity costs more**: housing more than 1 pawn carries a basic additional cost that
  scales with capacity (bunk variants — see CAMP-TO-TOWN-MODEL.md tiers).
- **Production ramps up and phases out** as a settlement grows: early-tier production
  (foraging bunks) ramps in first, then phases out when higher-tier production (mills,
  smithies, kitchens) comes online. A town's building mix tells you its age.

## The tributary chain — value flows uphill

Old buildings don't die; they **transition upstream**:

1. **Old foraging bunks upgrade or transition** — instead of demolition, a phased-out bunk
   can become a **TRIBUTARY to the ship token it serves**: its yield/flow re-routes to that
   ship's token holders. Early infrastructure becomes crew income, permanently.
2. **Ships have tax flow and feed into nations** — **10% upstream to the kingdom is ALREADY
   BUILT IN** (the ship-token fee split). So the chain runs:

   **building/bunk → tributary → SHIP token → 10% tax upstream → KINGDOM/NATION**

   Every working building at the bottom feeds a ship; every ship feeds its nation. Kingdoms
   are literally fed by the smallest huts at the edge of the map.

## The reactor IS the feudal map (founder 2026-07-01)

The 10% upstream isn't just revenue — it's the **political map of the world**:

- **The ship carries a REACTOR that pays 10% upstream.** Every token we launch gets this
  reactor — it's standard equipment, not an add-on.
- **The upstream target SHIFTS with war and allegiance.** Change your liege, and the
  reactor re-routes. Fealty is not a label — it's where your 10% flows.
- **Reading the reactor fees maps the fleets and nations**: who serves who in the feudal
  wars is literally on-chain. The fee graph IS the org chart of every kingdom.
- **Same king, still fighting**: two crews can serve the same king and war with each other
  anyway — feudal life. Shared liege ≠ peace.
- **Each High King sets his own laws on inter-kingdom wars.** War rules are per-crown, not
  global — one king may forbid raiding allies, another may reward it. Law is a kingdom
  feature, not a game constant.

## AI players take the thrones first (founder 2026-07-01)

Before humans hold these positions, **a few AI players each take up a position with
DIFFERENT rules** — a High King with strict war-law, a warlord king who rewards raiding, a
merchant-lord who taxes low and fights never. Same pattern as the First Citizen (charter +
wallet + brain, playing by the real rules), but political: each holds a throne, sets its
laws, and routes its reactors. That builds out the world of experiences players climb into —
by the time a human swears fealty or starts a revolution, the kingdoms already have
histories, laws, and grudges.

## National tokens + the revolution rule

- **National tokens come later**, made like ship flags were.
- **A nation requires so many buildings** to exist (threshold TBD — a flag with no town
  under it is just cloth).
- **Revolution rule**: the same rules as changing ship flags/symbols apply at nation scale —
  **if you own more than half of the total nation, you can have a revolution**: change the
  flag, change the symbols, in game. Ownership is legitimacy; majority is the crown.

## Why this design holds together

- One consistent pattern from hut to crown: token per real thing, flow uphill, majority
  rules the symbol.
- The 10% upstream tax gives nations real revenue without inventing a new mechanic — it's
  already in the ship tokens.
- Tributary transition means early-game buildings never become dead weight — the world's
  history keeps paying its descendants.

## Ties

- CAMP-TO-TOWN-MODEL.md — tiers, bunk variants, production curves (the detailed build economy)
- HIRING-HALL.md — pawn purchases feed town pools (the people side of the same flow)
- ECONOMY-REVIEW.md — shipwrights sell hull tokens; building tokens are the town-side twin
- project_seas_empire_tax (memory) — the Mayor gold 3-way split this rhymes with
