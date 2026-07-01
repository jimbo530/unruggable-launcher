# Travel, Caravans & Combat Scale — founder design (2026-07-01)

The core feel: a **slow, almost idle trading game in the background**, with **Final Fantasy
Tactics-style battles on top** to add action and adventure. Neither layer replaces the other.

## The pacing gradient — GAME ARCHITECTURE, not just bot guidance

**Fast flow close to home; long time out across the seas.** This is the organizing principle
for the whole game, and every system should sit somewhere on it:

- **LOCAL (harbor, town, your own ship)** = fast play. Quick fights (bilge rats), quick jobs,
  market visits, tavern, forge — snappy loops a player can run in minutes, every day. The
  copper economy lives here: small, frequent, immediate.
- **OUT ACROSS THE SEAS** = the long game. Real-time voyages, LPs and Row tokens building
  while you travel, big loot tiers, boss fights (Kraken, Sea Serpent), caravans and cargo.
  The gold/cbBTC economy lives here: large, slow, planned.
- **Distance = time = value.** The further out you go, the slower the pace and the bigger the
  stakes. The area map's danger tiers (harbor 1 → open sea 3 → the Maw/storm 4-5) already
  encode this — pacing and reward should follow the same curve.

A player should always have BOTH on the table: something fast to do right now at home, and
something slow paying off out at sea.

## The time bands (founder 2026-07-01)

Every distance has a clock. These are the design targets when building content:

| Band | Travel time | What lives there |
|---|---|---|
| **In town** | instant | venues: jobs, market, tavern, forge, quick fights |
| **Local action on foot** | **1–2 days from town, TOPS** | every town gets its own nearby adventures — caves, wilds, camps. The walking-crew radius. |
| **Across the sea** | **several days, most of the time** | port-to-port voyages, trade runs, big loot tiers |
| **Expanded map (later)** | **weeks or longer** | the BIG scores — far waters worth planning for |

Rules that fall out of this:
- **Each town needs its own local action** — no town should be a dead menu; when we build a
  town, we build its 1–2-day adventure radius with it.
- **On-foot content caps at ~2 days out.** Anything further belongs to ships (and later,
  mounts/wagons/caravans stretch the land radius).
- **Sea = several days by default** — that's the normal cost of moving goods between ports,
  and it's what makes geographic scarcity (and trade routes) real.
- **Map expansion adds time, not just space** — new far waters come with week+ voyages and
  prizes big enough to justify them.

## Every town is a starting town (founder 2026-07-01)

Any new town can be where a **pawn starts**. So the low-level quest set REPEATS in every
port town — **rats in the bilge is the template**: a level-1, in-town, resolves-in-minutes
fight that any fresh pawn can run on day one, anywhere.

- **Standard starter kit per port town**: a bilge-rats-tier quest + day-1 jobs + the market.
  A pawn born in ANY town has the full rung-0 loop without traveling.
- Same quest, local flavor — the rats can live in a warehouse, a granary, a shipwreck —
  same stats and loot tier, town-themed skin.
- Starter quests are the LOCAL band (instant, repeatable, small copper + goods loot);
  the town's unique 1–2-day adventures sit above them; the sea sits above that.

## Time is the resource

- **Long sea voyages put REAL TIME into travel.** The voyage itself is when value builds —
  LPs and Row tokens grow while the ship is at sea. Travel is never dead time; it is the
  idle engine running.
- **Combat spaces are the opposite: shorter, more connected.** Get in, fight, get out.

## Location cooldowns — waiting is a move

Locations carry **cooldown timers** after combat. When a spot is on cooldown the player has a
real three-way choice:

1. **Travel home** (bank what you carry),
2. **Work the wilds** (push on to another spot), or
3. **Wait it out** (stay, rest, let the timer run).

Waiting is deliberately "another choice on the table" — not a punishment.

## Encumbrance — all pawns, no exceptions

**Encumbrance must work for ALL pawns.** Carry weight limits what a walking crew can haul
home, which is what makes transport upgrades worth buying. (Build requirement, not optional.)

## Land travel scale ladder

- **Walking crew: 4-pawn limit.**
- **Mounts and wagons** upgrade land travel (planned).
- **Larger caravans** are purchasable to go OVER the 4-pawn limit.

## Combat scales with group size

Bigger parties change the risk shape, not just the numbers:

- **More people → LESS likely to be attacked** (scale deters).
- **But when a big caravan IS attacked, it's MUCH worse** (bigger prize, bigger ambush).

So the trade-off is real: travel light and fight often but small, or travel heavy and fight
rarely but big. Caravan size becomes a strategic bet, not a straight upgrade.
