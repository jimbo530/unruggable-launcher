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

## Build order suggestion (founder-gated, nothing deployed from this doc)

1. **Hiring hall** (pawn sale rail per town) — unlocks "no pawn limit" + every-town starts.
2. **Wood-tier starter gear walls** in all 7 towns — cheap, whole-number, day-one buyable.
3. **Shipwright at Port Royal** first (hull tokens for gold), then big ports.
4. **Steel-tier scarcity placement** — the first deliberate gear trade route.
5. Alchemist/smithy/tavern sinks as those loops come online.
