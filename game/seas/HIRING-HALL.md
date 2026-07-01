# The Hiring Hall — pawn markets in every town (design, 2026-07-01)

Founder rules: **players have NO pawn limit**. A new pawn can be bought at **any town**.
The hiring hall is the venue that makes that real — and it plugs into "every town is a
starting town": a pawn bought in a town starts IN that town, with the starter quest and
day-1 jobs right there.

## What a player sees

A town venue page (like the tavern or forge). Inside:

- **Who's for hire** — the pawns available in THIS town: species mix is local flavor
  (recruit dwarves where dwarves live). Portraits from the existing crew sprite set.
- **The price in GOLD** — clear, whole numbers, displayed g/s/c.
- **Hire** — pay gold, the pawn joins your crew, standing in this town.

No limits, no lotteries, no randomness in what you pay — skill and gold, never chance.

## On-chain design — reuse the proven rails

Nothing new is invented; this is the ShipyardV5 pattern pointed at pawns:

1. **Pawns are crew NFTs** (ERC721 distributor collections — same as Harbor Guard
   0x8C1f…0545). Each town gets a **town crew collection** (e.g. "Saltmarsh Muster",
   "Tortuga Irregulars"), or species-flavored collections where the town has a species
   identity.
2. **Purchase = GOLD payment → agent-batched processor** (the ShipyardV5 store → queue →
   processor flow; no keys in the web layer, the relayer mints/transfers and registers the
   pawn's location = the town).
3. **A slice of the price seeds the pawn's endowment.** Part of the gold converts and goes
   into the pawn's WaterV2 vault at purchase, so a bought pawn arrives **level 1 with real
   backing** — same $1 = 1 level engine as everywhere else. A hired pawn is never a hollow
   token.
4. **The rest of the gold splits like the Empire tax**: a share to the town's prize pools
   (refills the ladders), a share to water-flow (job wages). Buying pawns literally feeds
   the town's economy — more hiring = richer town.

## Pricing (FOUNDER-SET, 2026-07-01)

The rule that makes it work: **half the price waters the pawn** (100g = 1 level = $1 of
real endowment flow). Every hire arrives able to WORK — its water gives it job-wage flow
from day one, however small. That's core: the slow trade is real funds slowly building
endowments — every $1 trapped in game is $1 in a charity endowment.

| Hire | Price | Water inside | What you get |
|---|---|---|---|
| **Deckhand** | **200g** (the minimum) | 100g (level 1) | a working pawn with starting flow |
| **Veteran** | **1000g** | 500g (level 5) | level 5, ONE core stat at 5 (buyer picks) |

**The hall's ceiling is the veteran.** Pawns above level 5 / stat 5 are hard to find and
come ONLY from special locations and in-game events — gold cannot buy past level 5.
**P2P pawn trading comes later** (the found-pawn market).

## Species by town

**For now: ALL towns carry ALL 6 species** (human, elf, dwarf, orc, dragonborn, goblin).
Specialized towns come later, outside the world's central shipping. The data lives in
`hiring-halls.csv`: `town, location_id, collection, species, tier, level, core_stat_at_5,
price_gold, water_gold` — 84 rows live (7 towns × 6 species × 2 tiers).

## What the pawn gets at hire

- **Location** = the town (registry entry) → co-location rules work immediately.
- **Starter path on screen**: the town's bilge-tier starter quest + day-1 job + market —
  the full rung-0 loop without traveling (see TRAVEL-COMBAT-SCALE.md).
- **Encumbrance stats** from day one (all pawns, no exceptions).

## Build steps (founder-gated, in order)

1. `hiring-halls.csv` — towns, species mix, tiers, prices (founder review of numbers).
2. Town crew collections — deploy per-town ERC721 distributors (agent wallet, node script).
3. Processor keeper — clone the ShipyardV5 GOLD-payment queue processor for hires
   (store → queue → mint+register+seed-water), DRY-first, ethics review, small proof hire.
4. Hall venue page per town (`town/hiring-hall.html`) reading the csv.
5. Citizen brain: add a `hire-pawn` tool (read prices / hire with explicit gold cap) so the
   bots can grow their rosters by the same rules — "more earners" is rung 4 of the climb.

## Ties

- **TRAVEL-COMBAT-SCALE.md** — every town is a starting town; time bands.
- **ECONOMY-REVIEW.md** — hiring hall is refinement #1; gold sink supports the
  ship-as-monetary-policy model.
- **TOWN-SHIP-NATION-TOKENS.md** — the token model this all sits inside.
