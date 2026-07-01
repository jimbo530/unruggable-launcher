# Economy Tokens — Review & Refinements (2026-07-01)

Founder rules driving this pass: **players have NO pawn limit** — a new pawn can be bought at
**any town**; **many port towns also sell ships**. Review the token economy and refine.

## What exists today (the inventory)

**218 commodity ERC20s** (`commodity-tokens.csv`): 156 gear, 13 food, 10 potions,
7 forageables, 6 ores, 5 ingots, 5 stones, 5 gems, 3 produce, 3 coins, 2 materials,
1 brick, 1 orb, 1 fish.

**7 town markets live** (`port-market.csv`, 94 on-chain walls + 3 UI-only):

| Town | loc | Staples | Signature gear | Extra |
|---|---|---|---|---|
| Port Royal | 8003 | 11 foods | ALL 6 iron weapons | gems (plat→diamond), UI rice/flour/pork |
| Beacon Isle | 14005 | 11 foods | longsword-iron 15g | |
| Bonewater Atoll | 2006 | 11 foods | warhammer-iron 12g | |
| Kraken Deep | 5009 | 11 foods | greataxe-iron 20g | |
| Saltmarsh | 13002 | 11 foods | spear-iron 2g | |
| Skull Reef | 12009 | 11 foods | battleaxe-iron 10g | |
| Tortuga Cove | 2002 | 11 foods | scimitar-iron 15g | |

**What's coherent and good — keep:**
- Staple food ladder identical everywhere (salt 1c → saffron 65g) = a stable **cost of
  living** anchor in every port. Trade-route profit comes from LOCAL production goods
  (fish, logs, lumber), not staples. Correct — leave as-is.
- One **signature weapon per town** = a reason to sail for gear. Port Royal as the hub with
  everything = the anchor market. Correct.
- **Gem ladder** (10 → 100 → 1,000 → 10,000 gold) = a savings/portability ladder (a diamond
  is a ship's fortune in one pocket — encumbrance-friendly wealth). Correct.
- Coin ladder COPPER → SILVER → GOLD, 100 copper = 1 gold.

## Refinements (the gaps this design pass opens)

### 1. Pawn markets — every town, no limit  ⭐ new rail to build
Pawns are unlimited and purchasable at **any town**. Each town gets a **hiring hall**:
- Priced in **GOLD** (a real gold sink — supports the ship-as-monetary-policy model).
- Town flavor: species/starting-skill mix varies by town (ties to the 6 crew species) —
  another reason to travel: recruit dwarves where dwarves live.
- A fresh pawn starts at the town it was bought in → feeds "every town is a starting town"
  (starter quest + day-1 job on the spot).

### 2. Ship markets — many port towns  ⭐ new rail to build
- Boat/hull tokens already exist as a pattern (1 ERC20 per hull, lumber-crafted, wide LP).
- Big ports get a **shipwright**: hulls for GOLD (the biggest sink in the game, ~10k-gold
  class), smaller ports sell only small hulls (rowboat/sloop tier) — hull availability by
  port size is itself geography.

### 3. Place the gear catalog — 156 gear tokens, only 6 sold anywhere
The catalog has wood/iron/steel tiers but markets sell iron only:
- **Wood tier** = cheap local starter gear (every town, copper/silver prices — the fresh
  pawn's first weapon).
- **Iron tier** = the current signature-weapon spread (keep).
- **Steel tier** = dear + scarce: sold in ONE or TWO far towns only → a real gear trade
  route (buy steel where it's forged, carry it home, price the risk).
- Armor/shields/helms: same three-band placement once combat uses them.

### 4. Give the production goods sinks
Potions (10), ores/ingots/stones (16), forageables (7), produce (3) have **no market venue**:
- **Alchemist stall** (potions — sell + buy) in 2-3 towns.
- **Smithy buys ore/ingots** (the conversion step: ore → thin-band gated LP → ingot,
  matching the log → lumber pattern).
- **Tavern buys produce/forageables** (feeds the food/water buff economy).
Until a sink exists, these are loot-only — fine, but flag them so we don't think they're wired.

### 5. Land transport tokens — when mounts/wagons/caravans land
New token family to mint WHEN built (not before — no premature lock): MULE, WAGON, CARAVAN.
Same 1-ERC20-per-kind pattern as hulls. They raise carry capacity (encumbrance) and party
size (over the 4-pawn walking limit), and price by the combat-scale bet.

### 6. Small hygiene
- 3 UI-only rows (rice/flour/pork, Port Royal) — pending whole-number on-chain walls, fine.
- New towns clone the staple set + pick a signature weapon + get a hiring hall — that's the
  "town starter kit" checklist (with the starter quest from TRAVEL-COMBAT-SCALE.md).

## The membrane economy — sinks must outpace releases (founder 2026-07-01)

Why the economy needs to be full and complex: **the slow trade is real funds slowly building
endowments — every $1 trapped in game is $1 in an endowment to charity.** So:

- **Inflation is paced by food and treasure releases** (what the world mints into play).
- **Sinks must OUTPACE those releases** — gold that circulates out is charity flow lost;
  gold that sinks (hires, water, gear, ships, buildings, rations) stays in the membrane.
- **DAILY RATIONS is the huge lever**: a recurring, universal, every-pawn cost pulls in
  funds that would otherwise circulate out. This is core game function, not flavor:
  - Basic rations = the floor (every working pawn eats).
  - **Morale bonuses for heroes that eat WELL** — better food = better work rates and
    fight performance, rewarded in game accordingly. Eating well must genuinely pay,
    so players choose the bigger sink willingly.
- The hiring hall follows the same law: half of every hire waters the pawn's endowment
  (200g → 100g water; 1000g veteran → 500g water = level 5).
- **The ONLY deliberate bleeding is seeding + food inflation** (founder 2026-07-01). Even
  the imbalances we seed through the economy's back end stay INSIDE the membrane as long
  as players aren't cashing out — seeded gold recirculates; it only leaks at the cash-out
  boundary (throttled). Real-value prize pools (cbBTC) are **limited seed + player funded**
  and refill only from endowment yield.
- **Capacity gating**: anything that promises real value (pawn watering, prize payouts)
  must check the membrane can cover it FIRST — e.g. pawn sales require the Money LP to
  hold more than $1. Never sell what the membrane can't back.

## Cold-start: the engine runs on production, not prizes (founder 2026-07-01)

Reality check: the launched tokens and pawns have **fictional flow** — token fees are 0
until there's real volume. The engine only runs once started. The start is the pawns
themselves **finding the path in game**: bring the markets back toward balance, buy what
they can, expand as the membrane allows.

**Low-level focus for the bootstrap:**
1. **Fishing** — the loop is live (buy cheap at the ocean, sail, sell dear at Port Royal).
2. **Crabbing** — the free zero-resource income; catch dispenser still needs wiring.
3. **A few simple manufacturing flows** — log → lumber works; open 2-3 more conversions.

Pawns work these → real trades → real fees → real flow → THEN the prize/wage crank has
something to spin on. Production first, prizes second.

**The ignition sequence (founder 2026-07-01)** — production loops need a seed flow,
however small:

1. **Fighting is the only free on-ramp** — coin with zero capital.
2. **Tavern food is the seed mechanism** — buying food/water at the tavern is what starts
   a pawn's vault flow (this is what historically gave us water to start flows).
3. **Flow unlocks jobs** — a watered pawn's job actually pays; then wages sustain the loop.
4. **Water prizes prime the pump directly**: prize vaults can pay WATER TOKENS straight
   into the winning pawn's vault — a self-funding prize that STARTS the winner's engine
   instead of hoping they spend coin on water. Locked-forever water = a prize that can
   never leak out of the membrane: pure endowment, pure flow. (Real $ sits behind water —
   draw from the limited seed, pace them. The 13 existing prize waters are the inventory.)

So the pawn's arc: **fight free → eat at the tavern → flow starts → take a job → work
steady → row, fish, build.**

**Prize destination mapping (founder 2026-07-01) — every prize declares its destination:**

| Destination | What pays there | Who can touch it |
|---|---|---|
| **Pawn INVENTORY** | coin + trade goods (copper, salt, gear) | the player — tradeable, spendable |
| **Pawn FOREVER VAULT** | WATER — poured straight into the pawn's endowment (`waterTree`) | **no one, ever** — locked forever, pure flow + endowment |

Water prizes are always vault-addressed: pool → pawn's forever vault, never through a
player wallet. No leak exists on that path by construction. The parked loose-water drip
bucket stays small in practice — with players or active AI claiming steadily, water moves
through it into vaults faster than it sits.

**The infinite prize (founder 2026-07-01, final design — existing tools only):**

1. A **PrizePool pays 1%** of its water balance per verified win, poured onto the pawn
   that did the fight (forever vault).
2. **One planted water position points its flow at buying water for this prize pool** —
   the feeder's 50% payout leg auto-refills the pool every harvest.
3. **One water seeded in the pool** starts the drip.

The 1% drip can never empty the pool (asymptotic), the feeder refills it continuously,
and the feeder itself compounds 50% per harvest — so the inflow **accelerates forever**.
A technically infinite, growth-accelerated prize made of three existing pieces.

**Water is XP share (founder 2026-07-01):** EVERY pawn in the fight gets a drip, paid in
order from **weakest to strongest**. Because each payout takes 1% of the *remaining* pot,
the weakest pawn automatically gets the largest drop and each stronger teammate a little
less — the contract balances team growth by ordering alone. Yes, the pool drains faster
with big crews; accepted — faster feeder flows come as funding grows. That is the plan.

Build notes: **the Money/WATER LP already exists** —
`0xfd522AE3728dcAd5C46dd679749e79D520001780` (V3, WATER/Money, fee 0.01%, ~$4 at peg —
enough to map and clear tiny trades). Remaining: **destinationRegistry approval** for the
prize pool as a flow destination; the two-step verify → claim discipline stands. Prize
water = the generic WATER vault token, so a poured prize is a direct +level on the pawn.

## Build order suggestion (founder-gated, nothing deployed from this doc)

1. **Hiring hall** (pawn sale rail per town) — unlocks "no pawn limit" + every-town starts.
2. **Wood-tier starter gear walls** in all 7 towns — cheap, whole-number, day-one buyable.
3. **Shipwright at Port Royal** first (hull tokens for gold), then big ports.
4. **Steel-tier scarcity placement** — the first deliberate gear trade route.
5. Alchemist/smithy/tavern sinks as those loops come online.
