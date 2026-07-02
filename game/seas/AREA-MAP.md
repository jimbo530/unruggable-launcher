# Seize the Seas — Area Map & Encounter Tables

**What this is:** the world is split into **10 areas** (biomes). Each area has a **danger tier (1–5)** and its own
**roll table** — the list of things you can run into there. When a ship sails, the game picks one row at random.

**Where it lives:** `game/seas/battle-grid/area-encounters.js` (the data + the `rollEncounter()` roll).
This is the **expanding-world** layer on top of the first-pass encounters already in `game/lib/location.js`.

> **Split of work:** you make the **art** 🎨 (sprites + backgrounds). Claude does the **stats, tables, and wiring**.

---

## How a roll works (plain version)

- Every area has a **danger tier**. Higher tier = tougher stuff.
- The roll picks **one row** from that area's table by weight (bigger weight = more common).
- **Rougher water** (higher danger) makes the **fight** rows count for more, and **unlocks the boss rows**
  (the **Kraken** only shows up in danger 4+ water).
- A roll is either a **fight** (a group of foes) or an **event** (trade, storm, salvage…).
- Same area can give a **swarm of weak foes**, a **single big boss**, or a **mixed pack** — see the groups below.

---

## The 10 Areas

| Area | Danger | Background art (id) | What you fight | Events |
|---|:---:|---|---|---|
| **Harbor & Home Waters** | 1 | `harbor` 🆕 | tide cutpurses (rare) | calm seas, peddler, flotsam, bottle |
| **Coastal Shallows** | 1 | `shoals` 🆕 | reef scavengers, lone shark, merfolk | calm seas, flotsam, peddler |
| **Coral Reef & Tidepools** | 2 | `reef` | shark pack, merfolk, scavengers, skeletons | flotsam, calm seas |
| **The Open Sea** | 3 | `open-deck` 🆕 | marauders, shark pack, corsairs, marines, **Kraken** (4+) | convoy, flotsam, derelict |
| **The Deep / The Maw** | 4 | `kraken-sea` | **Kraken**, **Sea Serpent**, reavers, skeletons, corsairs | derelict, storm wall |
| **Sea Caves & Grottos** | 3 | `cave` | **goblin pack**, skeletons, scavengers | flotsam, bottle |
| **Ship's Bilge & Hold** | 1 | `bilge` | **bilge rat swarm**, lone skeleton | calm seas |
| **Storm Front** | 4 | `storm` | reavers, Sea Serpent (4+), Kraken (5) | **storm wall, squall** |
| **Smuggler's Cove** | 2 | `cove` 🆕 | marauders, goblins, cutpurses, **Red Mowgli** (3+) | **black market**, peddler |
| **Island Jungle** | 3 | `jungle` 🆕 | **jungle ambush**, goblins, scavengers, Red Mowgli (4+) | **buried cache**, calm seas |

🆕 = **new background** to draw. The others (`reef`, `cave`, `kraken-sea`, `bilge`, `storm`, plus `two-ship` for boarding)
were already on the wishlist.

**Terrain notes** (what each map should "do" in a fight — for later, when terrain is wired):
- **harbor / shoals:** calm; sandbars **slow movement**. Safe-ish.
- **reef:** coral **slows movement**; falling in = **shark bait**.
- **open-deck / kraken-sea:** big deck, **rails = fall overboard**, masts = cover, **water-edge hexes** where tentacles rise.
- **cave / cove:** tight **chokepoints**, stalagmite/crate cover, dark edges.
- **bilge:** cramped, **water pools** hazard, barrels = cover.
- **storm:** a **wave sweeps a row** each round; slippery footing.
- **jungle:** foliage cover + **sight blocks**, vines **slow movement**.
- **two-ship:** your deck + theirs joined by a **gangplank chokepoint** (used for boarding/raider fights).

---

## Monsters you fight (sprites needed 🎨)

Full SRD stat blocks are in `CONTENT-WISHLIST.md §6`. Here's the short version so the **sprite names line up**.
Numbers are already scaled to the deck band (your pawns are ~10–20 HP).

### Sea creatures & boarders → `bestiary-sea.js`
| Sprite id | Who | Quick feel |
|---|---|---|
| `rat` | **Bilge Rat** | tiny, **fast**, comes in a swarm of 4–6; flees when hurt |
| `shark` | **Reef Shark** | circles in water; punishes anyone knocked overboard |
| `merfolk` | **Merfolk Raider** | leaps from the water, hit-and-submerge |
| `skeleton` | **Drowned Skeleton** | undead boarder; shrugs off bleed |
| `marine` | **Navy Marine** | disciplined **ranged line** (muskets) |
| `sea-serpent` | **Sea Serpent** | a **mini-boss**, one big-HP snake |
| `tentacle` | **Kraken Tentacle** | **BOSS limbs** — raised / slamming / severed frames; **telegraphs** its smash |

### Cave / jungle creatures → `bestiary-dungeon.js`
| Sprite id | Who | Quick feel |
|---|---|---|
| `goblin` | **Goblin Spear** | melee, short reach |
| `goblin-archer` | **Goblin Slinger** | ranged |
| `goblin-shaman` | **Goblin Shaman** | caster (a magic ray) |
| `hobgoblin` | **Hobgoblin Boss** | tanky leader — **kill it and the pack runs** |
| `spider` | **Giant Spider** | jungle ambusher (a raw sprite already exists in `D:/grok-sprites`) |
| `snake` 🆕 | **Constrictor Snake** | jungle grabber |

### Pirate crews (people) — **these already work** ⚓
Rival crews use the **same build as another player's pawn** (stats from their token + their gear), so they need
**no new monster art** — they show as **crew paper-dolls**. They do want **named-captain flavor**:
- **Tide Cutpurse**, **Reef Scavenger**, **Brineblade Marauder**, **Gravewater Conjurer** (caster),
  **Black Reach Reaver**, **Kraken Corsair**.
- **Named boss:** **Red Mowgli** (leads a cutthroat crew — kill him and they rout).

---

## Boss & objective fights (not just "kill them all")

- 🦑 **The Kraken** (open-sea 4+, deep-sea, storm 5): **4–6 tentacles** rise on the water edge. **Win = sever enough
  limbs + survive**, not wipe. Each tentacle **shows the hex it will smash next turn**.
- 🐍 **Sea Serpent** (deep-sea, storm 4+): one **big-HP** boss — a "mini-kraken" without the limbs.
- 👺 **Goblin Pack** (caves, cove, jungle): mixed pack with a **Hobgoblin Boss** — **kill the boss and the pack routs**.
- 🏴‍☠️ **Red Mowgli's Cutthroats** (cove 3+, jungle 4+): named captain + crew; **drop the captain to rout them**.

---

## Events (the non-fight rolls)

`calm seas` (nothing) · `flotsam` (salvage coins) · `peddler's dhow` / `merchant convoy` (**trade**) ·
`black-market buyer` (**sell contraband**, cove only) · `squall` / `storm wall` (**weather hazard**) ·
`derelict hulk` (board a dead ship) · `message in a bottle` (lore) · `pod of whales` (morale) ·
`buried cache` (**dig for treasure**, jungle only).

---

## What's done vs what an engineer still wires

**Done (this file):** all 10 areas, danger tiers, weighted tables, monster groups, named raiders, events,
and a tested `rollEncounter(area, danger)` that returns the **same shape `encounter.js` already uses** (plus a
multi-foe `group` list). Rival-crew fights are **drop-in today**.

**Still needs an engineer (see `area-encounters.js` header + `CONTENT-WISHLIST.md`):**
1. **Bestiary files** `bestiary-sea.js` + `bestiary-dungeon.js` with the monster ids above (direct stats).
2. **`makeMonster()`** path in `units.js` (monsters build from direct stats, not a token endowment).
3. **Multi-enemy battle loop** (spawn the whole `group`, not one foe) + boss objectives (**sever / rout / survive**).
4. Hook `location.js` to call `rollEncounter()` using `AREA_HINTS` (which area for which waters).
5. Event handlers (trade / hazard / salvage / board) and the **terrain** effects per map.

---

*Art is your lane 🎨 — make the **🆕 backgrounds** and the monster **sprites** above using these exact ids and they'll
drop straight in. Everything else (stats, tables, wiring) is on the agents.*
