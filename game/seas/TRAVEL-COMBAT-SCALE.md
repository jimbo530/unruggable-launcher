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
