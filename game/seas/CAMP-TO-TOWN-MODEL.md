# CAMP → TOWN — the settlement progression model for Seize the Seas

**Status: DESIGN deliverable (founder iterates on this). Nothing deployed, nothing on-chain, no new Solidity written.**
Built on the **existing** `StructureFactory.sol` (mftusd-build, fork-tested) and the **existing** game-layer
(`game/lib/settlements.js`, `game/lib/location.js`, `game/lib/weight.js`, `game/seas/citizen/tools/build.js`).

Companion config: **`game/seas/structure-kinds.js`** — the machine-readable KIND catalog the
StructureFactory's `addKind(...)` calls are generated from.

---

## ⭐ TWO-LAYER GAME STRUCTURE (Idle Economy / Active Adventure) — the unifying shape (founder 2026-06-27)

The whole game is **two interlocking layers.** Everything in this doc (camps → factory cities) is the **idle**
layer; combat/quests are the **active** layer.

### IDLE layer = RESOURCE MANAGEMENT (this whole document)
- **ALL production is AUTOMATED LINES** — camps, mills, farms, mines, **kitchens** (cooking), smelters, workshops,
  smithies — **plus supply routes.** Anno-style: **build → keep it FED → it runs itself.** Bot-friendly; **runs
  passively while you're away.**
- **Kitchens automate cooking exactly like smelters automate smelting**: ingredients in → cooked food out. The
  multi-ingredient recipes run on the live `craft.js` engine **inside the automated kitchen** — **not** manual
  busywork. (Config: `automatedLine:true` on every production kind; `isAutomatedLine(kind)`.)
- This is the **peasants = passive baseline** half (§1): the lines tick on their own.

### ACTIVE layer = ADVENTURES + HEROES
- **Combat, quests, exploration, bold ventures** — hands-on. This is the **heroes** half: where the player
  actually plays. (Lives in `battle-grid/` + the quest systems — NOT in this catalog.)
- ⚠ This **SUPERSEDES** the earlier "recipe-depth = the active game" line. **The active game is ADVENTURE.**
  Production + cooking are the **idle** layer (recipe-depth is just *good idle design*, not the active game).

### The layers INTERLOCK (why they cohere)
- The **idle economy EQUIPS + FUNDS heroes**: gear from the smithy, food from the kitchen, gold from trade.
- **Heroes' adventures bring back LOOT / PRIZES** that feed the economy + the **endowment** (§0/§14).
- It is the **peasants(passive) + heroes(active)** split, and the Citizen charter's **"risk the heroes, never the
  base"** — now expressed as the **whole game's shape.**

### Battle payoff — QUALITY output WINS the active game (coordinator-relayed design input; DESIGN-ONLY)
> ⚠ Coordinator-relayed, recorded as design only — **not** user-approved. Folded in because it closes the loop.

Better **GEAR** and better **FOOD** both help in battle, on **two SEPARATE axes**:
- **GEAR** = offense/defense + **damage-type COUNTERS** (illustrative flavor, e.g. "Sun Silver" vs brute/orc,
  "Black Iron" vs magic/elf — ⚠ those specific materials + a counter system are PROPOSED, not in `battle-grid` yet).
- **FOOD** = a **SEPARATE combat axis** — **HP / stamina / buffs / regen.** A cooked meal before a fight is a
  **BUFF**, not just anti-starvation rations. ⚠ So **food items need a combat-buff stat dimension** (beyond the
  current `food=N` value) — a FUTURE token/stat addition (§11 #22).

This gives a concrete **reason to FACTORY-CITY the good stuff** (mass-produce high-end gear + gourmet food) **IF a
player can afford the build investment** (§14): **quality production → stronger heroes → better adventure outcomes
→ more loot/prizes → more endowment.** The idle economy's **QUALITY output is what wins the active game** — that
pull is what makes the two layers cohere.

---

## THE BIG IDEA — two layers per structure (founder RESOLVED 2026-06-27)

> Naming note: "two layers" here (the **structure** layers — locked FOUNDATION vs. withdrawable BUSINESS) is a
> different axis from the **game** layers above (idle economy vs. active adventure). Both hold.

Earlier drafts argued "locked vs. player-owned." The founder reconciled it: a structure has **BOTH**.

- **(a) FOUNDATION layer** = the structure token + its **LOCATION vault** = **LOCKED, owned-but-IMMOBILE.**
  Your fixed stake/capacity planted at that hex. Crafted in place, **can never be relocated**, value locked
  forever. The founder **explicitly accepts** this lock for settlements — it is *not* a premature-lock concern;
  a foundation is *meant* to be permanent. Risk/loss only later via the opt-in PVP "untamed wilds" (§9).
  → This is exactly `StructureFactory build → seal() → WaterV2 tree`. **The live primitive fits layer (a).**

- **(b) BUSINESS layer** = the **manufacturing LPs + the STOCK in them** = **PLAYER-OWNED, WITHDRAWABLE
  working capital.** You paid to build the business, so you own the conversion LP and its stock and can
  **withdraw** it (pull logs/lumber, one side or both). Two waters pay the people: a **GOODS-water** (the
  produced good) + a **COPPER wage-water** (the crew). Owners *and* workers earn.
  → ⚠ **The live primitives do NOT fit layer (b)** — see the CONTRACT FLAG below. This is a **new contract.**

Boats are the contrast: fully movable/tradeable, not location-keyed at all (`boat-craft.js`).

### ⚠ CONTRACT FLAG — do not misrepresent the live primitives
Layer (b) needs an **owner-WITHDRAWABLE manufacturing pool that does not exist yet.** The two live primitives
**both lock** and neither lets an owner pull stock back out:
- `StructureFactory.seal()` waters the seed into a WaterV2 tree → **locked forever** (correct for layer (a)).
- `LocationPool` is **add-only** (never admin-/owner-withdrawable) → **does not** fit layer (b).

So a **new `ManufacturingPool` contract** is required for the business layer: owner can withdraw either/both
sides; **location-keyed** (can't move, but can withdraw); goods-water + COPPER wage-water pay owner + workers.
This doc + `structure-kinds.js` describe the **design target**; the layer-(b) contract is **unbuilt** and
**founder-gated**. Nothing here claims `seal()` or `LocationPool` does owner-withdrawal.

### The three cost buckets per site (founder clarification 2026-06-27)
The two waters cover **construction + staffing** — they do **NOT** supply the trading stock. Every site has:

| Bucket | What it is | Paid by |
|---|---|---|
| **1. CONSTRUCTION** | gold + materials to **build** the structure (the build recipe, §2) | the builder, once, up front (re-locks as the foundation endowment) |
| **2. STAFFING** | ongoing **wages** to the crew | the **COPPER wage-water** (layer (b)) |
| **3. STOCK overhead** | the **goods inventory** traded/converted through the LP (working capital) | **owner-sourced** — own upstream production, buying, or **hauling in** (caravans, §8) |

**EXCEPTION — a raw-harvest CAMP self-sources its stock through labor.** At an origin camp the **resource-water
buys + injects** the raw good, and **working the camp is what builds up both waters.** See §3 (camp loop).
Everything **downstream** (mill, store) sources its input stock by hauling the camp's output or buying it.

### The narrative layer — PEASANTS (passive baseline) vs HEROES/NOBLES (active acceleration) (founder)
- **Players are HEROES / NOBLES.** **Peasants are the always-on baseline labor** that fills the bunks — passive
  yield ticking regardless of whether a player is active. A settlement keeps producing on its own (the foundation
  waters drip, the peasants work). This is the floor.
- **Heroes/nobles MAKE STUFF HAPPEN FASTER.** Their **active work** + the **towns/cities they build** accelerate
  production — this is exactly the existing `settlements.js` **STAT_RATE** lever (WILD 1× → TOWN 3× → CITY 5×): a
  bigger, better-built settlement trains/produces faster. And they hold the **noble offices** (`NOBLE_RANKS`) that
  run + skim the economy (the holder takes 20% gold up the chain).
- So: **peasants keep the lights on; players build the engine that makes it roar.** Building camps→towns→cities is
  how a player turns the 1× baseline into 3×/5× and opens the offices that govern it.

---

## 0. What already exists (so we build on it, not over it)

| Piece | Where | What it gives us |
|---|---|---|
| **StructureFactory.sol** | `mftusd-build/StructureFactory.sol` | `build(kindId, loc, name, minMoneyOut)` pulls GOLD → sells GOLD→Money→USDC → seeds the structure's **own WaterV2 endowment** → mints a STRUCTURE NFT. `reclaimSeed()` withdrawable until `seal()`; `seal()` plants the tree on the **factory** (a non-pawn holder) and **locks forever — exactly the FOUNDATION layer (a)**. `addKind(kindId, label, goldCost, producedGood, endowmentVault)` = add-only catalog. **Reverts on zero `producedGood`/`endowmentVault`** (drives the treasury-vault fix, §2). **Does NOT do the business layer (b)** — see CONTRACT FLAG. |
| **weight.js** | `game/lib/weight.js` | The one encumbrance model. Pawn capacity = `50 + 10·(STR−1)` lb; coins `100/lb`; ship holds in tons; load states Light/Laden(≥0.667)/Overloaded. **The basis for hauling heavy STONE (§8).** |
| **build.js** | `game/seas/citizen/tools/build.js` | Already prices a build, **gates on GOLD exit-liquidity**, reads the on-chain kind, and calls `chain.buildStructure(...)`. Already DRY-safe (real-or-nothing). Has a `STRUCTURES = { mill, farm }` design table this model **replaces/extends** with `structure-kinds.js`. |
| **chain.js** | `game/seas/citizen/lib/chain.js` | `structureFactory()`, `buildStructure({kindId, loc, structName, goldCostWei, minMoneyOutWei})` — the full wiring is **already written**. Reads the factory address from `deploy/structure-factory-deployment.json` (does not exist yet = factory not deployed = DRY). |
| **settlements.js** | `game/lib/settlements.js` | **Already the settlement registry.** `TIER` (CAMP/MILL/MINE/TOWN/CITY/CAPITAL), `STAT_RATE` (wild=1, town=3, city=5), `BUNK_CAP`, `JOBS` (logging/milling/fishing/farming…), `SERVICE_META`, `SETTLEMENTS` keyed by **`loc`**, `NOBLE_RANKS` by population. Comment already references a "CampMillFactory build system" and "settlements ADDED here at runtime (or read from chain)." |
| **location.js** | `game/lib/location.js` | The hex world. **`loc = q*1000 + r`** (Port Royal hex (8,3) = `8003`). Mills live at `13001`/`14003`. Co-location, voyages, terrain. |
| **boat-craft.js** | `game/seas/boat-craft.js` | Boat ladder + the **lumber recipe**: `lumberCost = (priceGold/2)/5 = priceGold/10`. Burns LUMBER + TIME + SKILL → boat ownership token, sold on a separate floating LP. |
| **Tokens** | `commodity-tokens.csv`, `materials-deployed.json` | LOGS, LUMBER, WHEAT, CORN, GRAPE, FLOUR, all gear, gems, foods — **already deployed** ERC20s on Base. |
| **Waters** | `water-tokens.csv`, `water-held.csv` | **COPPER/SILVER/GOLD coin-waters LIVE** (the uniform wage engine). FISH/CRAB/prize waters live. **No lumber/log/wheat RESOURCE-water yet.** |

**There is NO TownRegistry on-chain** (confirmed — only old spec/VPS-pull files mention one). This model **does not add one** (see §4).

---

## 1. Settlement tiers — the ladder

A **settlement is a hex (`loc`) with one or more structures on it.** The tier of a hex = how many structures
(foundations) stand there.

Each structure's **foundation (a) is a locked, immobile stake**; on top of it the owner runs a **withdrawable
business (b)**. **Bunks + workshops are also SLOTS** — they cap how many manufacturing LPs a player can run
(§5 capacity). So you build foundations to *unlock the right to run businesses*.

### USE THE EXISTING SCALE — `game/lib/settlements.js` is the source of truth (do NOT invent a new scale)
`settlements.js` already defines the canonical tier/cap/office numbers. This model **reuses them as-is**:

| settlements.js TIER | `BUNK_CAP` (peasant labor slots) | `STAT_RATE` (the "faster" lever) | `NOBLE_RANKS` office @ population |
|---|---:|---:|---|
| `CAMP` / `MILL` / `MINE` (WILD) | **20** | **1×** | — (wild, no office) |
| `TOWN` | **40** | **3×** | **mayor @ pop 40** (20% gold cut, up the chain) |
| `CITY` | **80** | **5×** | **lord @ 80**, **pettyking @ 100** |
| `CAPITAL` (Port Royal) | ~100/job | 5× | **highking @ 200** = top PLAYER seat; **EMPEROR = global pool, never a player seat** |

- The **STAT_RATE lever IS the hero/noble acceleration** (narrative layer above): WILD 1× → TOWN 3× → CITY 5×.
- **Players "make the job"** by growing a settlement to a `NOBLE_RANKS` population threshold (the office then
  exists and the holder skims). Map is **player-built**; only Port Royal is dev-seeded.
- `JOBS` already exist: `logging`→logs, `milling`→lumber, `fishing`/`crabbing`/`farming`/`vinekeeping`, the six
  dock stat-trainers, `mayor` (office), `guard_port` (unlimited commons). The structure kinds (§2) are the
  **foundations those jobs run on**.

### TWO AXES — structure-count (build ladder) vs. population (settlements.js tier)
The camp→town **build ladder** below is a **structure-COUNT** convenience for "how built-out is this hex." It
sits **alongside** the settlements.js **POPULATION** tier (which drives BUNK_CAP, STAT_RATE, and the offices).
They are reconciled at the TOWN step: a hex becomes a real TOWN when it hits **settlements.js TOWN = 40 pop**
(not merely a structure count) — that is where STAT_RATE jumps to 3×, the Mayor office opens, and the
logs/berries→grains reroute (§6) fires.

| Build-ladder step | What it is | Structures on the hex | settlements.js tier it maps to |
|---|---|---|---|
| **Camp** | A wild work site (the first build). | 1 structure (logging-camp / fishing-dock / farm / vineyard) | `CAMP` (BUNK_CAP 20, 1×) |
| **Hamlet / Outpost** | A camp that grew a 2nd building. | 2 structures (e.g. camp + lumber-mill) | still WILD (≤20 pop) |
| **Village** | A working cluster. | 3 structures (+ farm / vineyard / **stall** / warehouse) | WILD → approaching TOWN |
| **Town** | A grown settlement. | ≥ `TOWN_MIN_STRUCTURES` (**proposed 4**) **AND `settlements.js` TOWN pop = 40** | `TOWN` (BUNK_CAP 40, **3×**, **mayor opens**) |

> ⚠ The "**~20 bunks = a real town**" founder example (§6) is a **MAXED WILD CAMP** in settlements.js terms
> (`BUNK_CAP` camp = 20), **not** the TOWN tier — TOWN is **40 pop**. So the evolution reroute could fire either
> at "camp maxed (20)" or at "becomes a TOWN (40)". **20-vs-40 is an OPEN number for the founder** (§11 #13).

> Note: CITY (5×, lord/pettyking) and CAPITAL (Port Royal, highking) are the upper rungs of the same ladder;
> CAMP→TOWN is the **player-built bottom**. Port Royal (`loc 8003`) is the immutable anchor + only dev-seeded
> settlement. EMPEROR is the global pool, never a player seat.

### TRAINING RATE = `settlements.js` STAT_RATE (the "heroes make it faster" lever)
**Working a bunk trains the job's STAT** — and the stat-XP gain is **multiplied by the settlement tier**:
- `logging`→STR, `milling`→CON, `fishing`→WIS, `barter`→CHA, `mend_nets`→DEX, `tend_beacon`→INT, etc.
  (the `settlements.js` JOBS roster + the six dock stat-trainers).
- **STAT_RATE multiplier: WILD (camp/mill/mine) 1× · TOWN 3× · CITY/CAPITAL 5×.** A pawn trains 3× faster in a
  town, 5× in a city — so **growing a settlement is how your pawns/heroes level faster.**
- This is the mechanical face of the narrative layer: **peasants tick the baseline; heroes/nobles build the
  towns/cities that make everyone — including their own pawns — train + produce faster.** The reason to climb
  camp→town→city is **speed** (training + production), on top of the offices + the bigger LP capacity.

### RAW-PRODUCTION DECLINING CURVE — growing a town PAVES OVER the wild (founder CORRECTED)
Raw WILD harvest — **logs (logging), berries (foraging), game (hunting)**, the `rawProduction` kinds
(`logging-camp`, `forage-bunk`, `mine`) — is **not a flat cap; it's a declining curve** that peaks at the camp
cap (20) and phases to **0 exactly at the TOWN-tier population (40)**:

```
rawHarvestCap(totalBunks) = max(0, min(totalBunks, 40 − totalBunks))
   n ≤ 20  → all bunks may be raw      (a full WILD camp = 20 raw)
   n = 21  → 19 raw  ·  22 → 18  ·  23 → 17  …   (each bunk past 20 converts one raw slot to refined/town)
   n = 40  → 0 raw   = full TOWN: "no natural land left" — the wild is entirely developed.
```
- So **raw extraction peaks at 20 (a maxed camp) and phases out linearly to 0 at the 40-pop TOWN threshold.**
  **You cannot grow a settlement on raw extraction alone** — every bunk past 20 *must* be a NON-raw job
  (refining / crafting / services / **grains** / town jobs). Growing up to a town **= paving over the wild.**
- This is the **progressive** mechanical driver of the camp→town climb and the **logs/berries→grains evolution
  reroute** (§6): as raw slots phase out, the matured raw structures retarget onto town-appropriate goods.
- Helper: `structure-kinds.js` `rawHarvestCap(totalBunks)` + `isRawProduction(kind)`. The curve's **0-point is
  tied to the 40-pop TOWN tier** (`TOWN_POP`) and its **peak to camp `BUNK_CAP=20`** (`RAW_BUNK_PEAK`) — self-
  consistent with `settlements.js`.
- ⚠ RECOMMENDATION: apply the curve to **per-settlement-TOTAL raw bunks** (simplest; matches "no natural land
  left"). **OPEN nuance** (§11 #14): if the founder wants each raw job (logging vs forage vs mine) budgeted
  separately, split into per-job caps — flagged, not assumed.

> The earlier "20-vs-40" ambiguity is now resolved by the curve itself: raw is **full at 20**, **gone at 40**.
> Evolution (§6) isn't a single switch — it's this gradual phase-out as the settlement grows toward TOWN.

### AGRICULTURE PHASE-OUT — the SECOND curve, stacks on raw (founder 2026-06-27)
Land-hungry production sheds in **STAGES** as a settlement densifies — raw harvest is just the first stage. A
second curve phases out **AGRICULTURE** (farming / vineyards / produce) across the **TOWN→CITY** band:

```
agricultureCap(totalBunks) = max(0, min(40, 80 − totalBunks))     [PROPOSED shape]
   n ≤ 40  → up to 40 agriculture bunks      (agriculture is unconstrained through the TOWN tier)
   n = 41  → 39  ·  60 → 20  ·  …            (each bunk past 40 converts an ag slot to manufacturing)
   n = 80  → 0 agriculture = pure MANUFACTURING city (no land production at all)
```

**The three stages stack** (each `BUNK_CAP` boundary in `settlements.js` is a phase line):

| Density (pop) | `settlements.js` tier | RAW harvest | AGRICULTURE | What's left |
|---|---|---:|---:|---|
| 0–20 | CAMP (wild) | full → declining | allowed | harvest + some ag |
| 20–40 | → TOWN | declining → **0 at 40** | full (≤40) | ag + refining/crafting |
| 40–80 | TOWN → CITY | 0 | declining → **0 at 80** | ag (shrinking) + manufacturing |
| 80+ | CITY+ (lord) | 0 | 0 | **pure MANUFACTURING** |

- **Progression: harvest → agriculture → manufacturing = camp → town → city → factory-city.** A dense settlement
  literally **cannot grow its own raw or food** — it must **import** them (supply lines, §8 + the capstone §14).
- Helpers: `structure-kinds.js` `agricultureCap(totalBunks)`, `isAgriculture(kind)` (farm/vineyard today), and
  `productionMode(totalBunks)` → `'harvest'` (<40) | `'agriculture'` (40–80) | `'manufacturing'` (≥80).
- Endpoints tie to `settlements.js`: **TOWN = 40** (`TOWN_POP`, raw→0), **CITY = 80** (`CITY_POP` = `BUNK_CAP[CITY]`
  / lord tier, agriculture→0). ⚠ **The 80 endpoint + the curve SHAPE are PROPOSED — confirm** (§11 #16).
- ⚠ Same per-settlement-TOTAL recommendation + per-job OPEN nuance as the raw curve (§11 #14).

---

## 2. Structure KIND catalog

Concrete, one row per buildable structure. The `addKind(kindId, label, goldCost, producedGood, endowmentVault)`
args back the **FOUNDATION layer (a)**. Full machine-readable version + `addKindArgs()` + `materialCostFor()` +
`lpCapFor()` are in **`structure-kinds.js`**.

| key (kindId) | name | tier | goldCost | foundation vault (a) | business (b) | isBunk | townGated | foundation wireable today? |
|---|---|---|---:|---|---|:--:|:--:|:--:|
| `logging-camp` | Logging Camp | camp | 1000 | LOGS resource-water — **null** (deploy) | harvest LOGS (withdrawable) **[RAW]** | yes | no | no — no logs-water |
| `forage-bunk` | Forage Camp | camp | 1000 | berry resource-water — **null** | forage berries/game **[RAW]** | yes | no | no — no berry-water |
| `fishing-dock` | Fishing Dock | camp | 1000 | FISH water `0x37be…F01F` ✅ | harvest FISH (withdrawable) | yes | no | **closest** (payout=GOLD caveat) |
| `lumber-mill` | Lumber Mill | hamlet | 1000 | LUMBER resource-water — **null** | convert LOGS→LUMBER (owner-stocked) | yes | no | no — no lumber-water |
| `farm` | Farm | hamlet | 1000 | WHEAT resource-water — **null** | harvest WHEAT (withdrawable) | yes | no | no — no wheat-water/LP |
| `vineyard` | Vineyard | hamlet | 1000 | GRAPE resource-water — **null** | harvest GRAPE (withdrawable) | yes | no | no — no grape-water/LP |
| `mine` | Mine | hamlet | 1000 | ORE resource-water — **null** | harvest ORE **[RAW]** | yes | no | no — no ORE token/water |
| `stall` | Market Stall | village | **1500** | COPPER treasury `0x0749…528B` ✅ | **public** sell-point (owner-stocked) | no | no | **yes** (treasury) |
| `warehouse` | Warehouse & Market | village | 1000 | GOLD treasury `0x24eb…F7C7` ✅ | none (civic storage) | no | no | **yes** (treasury) |
| `workshop` | Workshop | town | **1500** | COPPER treasury `0x0749…528B` ✅ | craft boats/gear (owner-stocked LUMBER) | no | **yes** | **yes** (treasury) |
| `kitchen` | Kitchen | town | **1500** | COPPER treasury `0x0749…528B` ✅ | **cook** ingredients→food (automated line) | no | **yes** | **yes** (treasury) |
| `smelter` | Smelter | town | **1500** | COPPER treasury `0x0749…528B` ✅ | convert ORE→INGOT (steel +coal; owner-stocked) | no | **yes** | **yes** (treasury) |
| `smithy` | Smithy | town | **1500** | COPPER treasury `0x0749…528B` ✅ | forge INGOT→weapons/armor (owner-stocked) | no | **yes** | **yes** (treasury) |
| `mansion` | Noble Mansion | town | **2000** | GOLD treasury `0x24eb…F7C7` ✅ | none (office seat, §16) | yes | **yes** | **yes** (treasury) |

> "foundation wireable today" = can `addKind` be called now (foundation vault exists). The **business layer
> (b) is NOT wireable for any kind** — it needs the new `ManufacturingPool` (CONTRACT FLAG). Producer
> foundation vaults (LOGS/LUMBER/WHEAT/GRAPE/ORE/berry) still need their per-good WaterV2 deployed (§6).
> **[RAW]** = `rawProduction` (logs/berries/game/ore) — subject to the declining curve (§1, `rawHarvestCap`).
> **Terrain each kind may be built on is in the BUILDABILITY MATRIX (§12)** — e.g. logging→FOREST, mine→MOUNTAIN,
> farm→PLAINS, fishing-dock→WATER/SAND, civic+crafting→TOWN. Metallurgy lane (mine→smelter→smithy) + the food
> lanes are mapped in §15; the **mansion** + luxury goods in §16.

**Cost rules applied (founder EXACT 2026-06-27) — bucket 1 (CONSTRUCTION):** a build = **GOLD + a fixed
GOLD-WORTH of material** (stone **or** wood) at standard market price, **hauled to the site** (the caravan
challenge, §8 — "getting wood or stone to location is a challenge in itself").
- **basic BUNK (no specialty)** = **1000 gold + 500 gold-worth material.**
- **SPECIALIZED WORKSHOP** = **+500 gold + 250 gold-worth MORE material** ⇒ **1500 gold + 750 gold-worth** total.
- **MANSION** (§16) = **full-cost premium**: full gold (PROPOSED 2000) + **full** material-worth (PROPOSED 2000),
  **not** the half-value bunk rate.
- Config carries `goldCost` + `materialGoldValue` per kind; `materialCostFor(kind)` converts the gold-worth into
  UNITS on the chosen path. The material spend is a **game-layer / keeper gate** (contract takes only GOLD),
  exactly like `craftBoat`.

**THREE material paths (founder 2026-06-27) — WOOD · STONE · BRICKS, builder picks one:**

| path | unit price | HP | morale ⚠ | haul wt/unit | units for 500 gold-worth | haul lb @500 | feel / status |
|---|---:|---:|---:|---:|---:|---:|---|
| **WOOD** (lumber) | 5 g | **100** | **0** (none) | 10 lb | **100** | 1,000 | LIGHT, **weaker**, easy haul. LIVE. |
| **BRICKS** (shale-fired) | ⚠ TBD | ~250 | **small** (1) | 25 lb (~2.5×) | ⚠ TBD | ⚠ TBD | **MIDDLE** — brick chain (shale→brickworks→bricks). ⚠ BRICKS token FUTURE. |
| **STONE · LIMESTONE** (common) | **5 g** | **500** | **small** (1) | 50 lb (**5×**) | **100** | **5,000** | **common stone = WOOD price**. LIVE (`0xfd53…`). |
| **STONE · SANDSTONE** (sometimes) | ⚠ mid | 500 | **mid** (2) | 50 lb (5×) | ⚠ TBD | ⚠ TBD | between common + premium. ⚠ FUTURE token. |
| **STONE · GRANITE** (sometimes) | ⚠ mid | 500 | **mid** (2) | 50 lb (5×) | ⚠ TBD | ⚠ TBD | between common + premium. ⚠ FUTURE token. |
| **STONE · MARBLE** (premium) | 12 g | 500 | **highest** (4) | 50 lb (5×) | **42** | 2,100 | premium → fewest units + top morale; mansions/luxury (§16). LIVE (`0xdF8B…`). |

- **SHALE is NOT a building stone** — it's ~clay, the **raw of the brick chain** (shale → bricks). Don't build with
  raw shale; fire it into bricks first (§15). SHALE is LIVE (`0x6171…`, 1 g).
- **WOOD↔STONE PARITY (SETTLED, founder):** common stone (**limestone**) is the **SAME gold price as wood (5 g)** —
  same build value, **but STONE weighs 5× (SETTLED canonical ratio)**. So a stone build is **FREE on gold cost, 5×
  on LOGISTICS** — the HAUL (§8) is the challenge, not the price. Stone's payoff = higher HP + a morale boost.
  **BRICKS = the middle** (~2.5× weight). Higher-grade stone (marble) = fewer units for the same gold-worth.
- **MORALE SCALES WITH STONE QUALITY (founder 2026-06-27):** wood **0** · brick **small** · limestone **small** ·
  sandstone/granite **mid** · marble **highest** (`structure-kinds.js` `STONE_MORALE` / `moraleFor()`; magnitudes
  0/1/1/2/2/4 PROPOSED, the **ordering** SETTLED). **Morale = a lingering HERO BUFF** (cosmetic for residents) —
  see the morale note below.
- **Token/price status (verified live 2026-06-27):** WOOD (lumber 5 g), SHALE (1 g), **LIMESTONE (5 g)**,
  **MARBLE (12 g)** are LIVE ERC20s. **BRICKS, SANDSTONE, GRANITE are FUTURE tokens** (not deployed); BRICKS +
  sometimes-stone prices TBD (§11 #18). **The 5× stone haul ratio is SETTLED.**

> **MORALE — a lingering HERO BUFF; cosmetic only for non-fighting residents (founder REVISED 2026-06-27).**
> High morale (marble/luxury builds) **RAISES STATS for VISITING HEROES** — and the buff **LINGERS**: it does
> **not** drop sharply when the hero leaves, it **slow-decays**. So players **CYCLE heroes through high-morale
> towns to RE-UP** the boost before a venture → **high-morale (marble/luxury) towns become HERO-BUFF HUBS**, a
> **real combat payoff** for prestige builds (not just a flex). **Resident, non-fighting peasants are still
> COSMETIC** — they don't fight, so the stat boost is moot for them; for them a marble capital is pure prestige.
> So a fancy town is **both**: a prestige showpiece for its residents **and** a stat-recharge station for the
> heroes who pass through on their way to the wilds (§9). ⚠ Decay rate + the morale→stat magnitude formula are
> OPEN (§11 #24); the buff/decay system is design-only (unbuilt).

**STRUCTURES ARE MATERIAL/GRADE VARIANTS — the build MINTS the variant by material (founder 2026-06-27):**
A bunk isn't one fixed token — building it **mints a variant** carrying **HP + morale** by the material chosen
(`structure-kinds.js` `BUNK_VARIANT`, `bunkVariant(material)`). **HP mirrors the 5× weight ratio:**

| variant | material | HP | morale | status |
|---|---|---:|---:|---|
| **wood-bunk** | wood | 100 | 0 | cheap/light; half-cost wood. LIVE path. |
| **brick-bunk** | bricks | ~250 | small (1) | MIDDLE; shale→bricks. ⚠ FUTURE (BRICKS token). |
| **stone-bunk** | stone | **500** (5×) | by kind (1–2) | half-cost stone, **5× haul**. Morale = the stone kind (limestone 1 / sandstone+granite 2). LIVE path. |
| **mansion-bunk** | marble+luxury | ~800 | highest (4) | **PREMIUM**: full gold + full materials + marble + luxury; office-eligible; **UNCAPPED** (§16). |

- **HP mirrors weight**: wood 100 / stone **500** (exactly the 5× ratio). Bricks middle (~250). mansion premium bump.
- **Morale scales with the stone's QUALITY** (wood 0 → marble highest). It's a **lingering HERO BUFF** — visiting
  heroes gain a stat boost that slow-decays, so high-morale towns are **hero-buff hubs** players cycle through;
  **cosmetic only for non-fighting residents** (see the morale note above + §9).
- **Mansion is NOT a singular structure** — it's the **top BUNK VARIANT**: you can build **as many as you can
  afford** (uncapped); mansions **count as bunks**; holding a noble office just needs **≥1** mansion (§16).
- HP/morale numbers PROPOSED except the stone-5×-of-wood anchor (SETTLED). (HP matters for PVP raid/claim, §9.)

**The modular 50/50 water principle (core, buckets 2+3):** every productive site composes **two uniform 50/50
WaterV2 tokens** — never a bespoke split:
1. a **GOODS-water** (the produced good; for civic kinds a COPPER/GOLD **treasury**) — the `endowmentVault` the
   factory seeds + plants = the **foundation (a)**, and
2. the **shared COPPER wage-water** (`0x0749…528B`, live) that pays the crew (**bucket 2, staffing**).

These two waters cover **construction + staffing only** — they do **NOT** stock the LP. **Bucket 3 (trading
stock) is owner-sourced** (own production / buy / haul), **except a raw-harvest camp** whose resource-water
buys+injects the good and whose **labor builds the waters** (§3). The StructureFactory seeds **one** vault per
structure (the foundation); COPPER wage-water is a **shared** live vault attached by a keeper, not a 2nd seed.

---

## 3. Production chains + the camp labor loop

Everything is whole-good, debit-then-credit, the same shape as `boat-craft.js` and `battle-grid/craft.js`.

### The CAMP loop — labor-driven origin (founder 2026-06-27)
A raw-harvest camp **self-sources its own stock through labor** — this is the *only* place the waters supply the
trading stock:
```
WORK the camp ──► feeds the 2 waters ──► ┌─ LOG-water buys + injects LOGS  (= the camp's stock)
  (player labor)                          └─ COPPER wage-water pays the camp crew (wages)
```
- Working the camp is what **builds up** both the LOG-water and the COPPER-water (player labor feeds/funds them).
- Because the LOG-water **buys logs and injects them at the camp**, working the camp **is** effectively buying
  the wood into the camp's stock. The camp needs **nothing hauled in** — labor is the supply.
- This answers "where does the origin's stock come from": **the labor of working it.**

### Lumber chain — the spine, FORCED onto players downstream
```
[HOUSE-SEEDED]            [PLAYER-BUILT ───────────────────────────────────────────────────────]
logging-camp ──(LOGS)──► lumber-mill ──(LUMBER)──► ┌─ workshop ─(boats: burn LUMBER = priceGold/10, boat-craft.js)
  work→waters→buy+inject   owner SUPPLIES logs       ├─ smithy   ─(crude/wooden gear from LUMBER; metal needs ore)
  (origin stock)           (haul/buy), thin TIME-     └─ STRUCTURE BUILDS (the material half of the next build,
                           GATED LP 1:1                   §2 — consumed when you raise the next structure)
                           (cooldown + maxSwapIn)
```
- LOG = 1 gold, LUMBER = 5 gold. The **log→lumber conversion** is a thin time-gated LP (1:1, cooldown +
  `maxSwapIn` = throughput) — **the mill's job**, already half-live (mill LPs `13001`/`14003` + `mill-keeper.js`).
- **Downstream the owner supplies the input stock** (bucket 3): the mill needs LOGS the owner hauled from a camp
  or bought; the lumber-water does **not** buy logs (only the camp's LOG-water injects raw).
- **Building consumes the chain**: each structure's material half (§2) is burned when you raise it — so growing a
  settlement *pulls* on the lumber supply line, exactly like crafting a boat does.

### Food chain (sketch)
```
farm/vineyard ──(WHEAT/CORN/GRAPE)──► mill/granary ──(FLOUR)──► workshop/bakery ──(bread/pies/RATIONS, WINE)
  raw-harvest origin                   owner supplies grain        owner supplies flour
```
- WHEAT/CORN/GRAPE/FLOUR/WINE tokens **already exist**. FLOUR even has a (prize) water already.
- Food feeds crews (`settlements.js` jobs already auto-route food rations). Same shape as the lumber chain: a
  raw-harvest origin → an owner-stocked refiner → an owner-stocked workshop craft. (berries→wine, berries→pies.)
- ⚠ No WHEAT/grain **sell LP** or grain **resource-water** exists yet (`produce-deployed.json` = tokens only).

### How a build consumes the chain (the loop closer + the endowment engine)
A structure's `goldCost` **re-locks as the foundation endowment** (the engine win — value spent building stays
in-game and compounds); its **material half** is **spent stock** that had to be produced upstream. So **every new
building is demand for the tier below it** — camps feed mills feed workshops feed the next dock's planks. **The
supply chain IS the game**, and **players' build investments + the locked foundations ARE the growing endowment**
(`project_seas_endowment_engine`).

---

## 4. HOUSE FOOTPRINT vs PLAYER-BUILT (founder strategy: "fund the source; the chain is the game")

Because working the wood camp **self-sources** its wood, the HOUSE only seeds/runs the **ORIGIN**. Everything
downstream is **forced onto players** — player-owned, player-paid, player-built via the StructureFactory on the
player's own gold + materials. This **minimizes what we deploy** and **maximizes the player-driven economy**.

| Piece | Who | Notes |
|---|---|---|
| **LOG-water** (origin resource-water, buys+injects logs) | **HOUSE-SEEDED** | the source we fund. Founder: focus mostly here. ⚠ not deployed yet (§6). |
| **COPPER wage-water** `0x0749…528B` | **HOUSE-SEEDED** | already LIVE + shared by every site's crew. |
| **StructureFactory** | **HOUSE-SEEDED** | one deploy; players call `build()` on their own gold. |
| **Boat ownership tokens** | **HOUSE-SEEDED** | `deploy-boats.js` (one-time). Crafted by players from their LUMBER. |
| logging-**camp** foundation | player-built | player pays gold+materials; the camp's LOG-water/wage-water are the house-seeded shared waters. |
| **mills, lumber, manufacturing LPs, hauling, crafting, stalls, workshops, smithies, warehouses** | **PLAYER-BUILT** | all of it. Players pay + own + run it. The supply chain IS the game. |

**Per-kind label** (also in `structure-kinds.js` notes):
- HOUSE-SEEDED infra: LOG-water, COPPER wage-water, StructureFactory, boat tokens.
- PLAYER-BUILT structures: **every** kind in the §2 catalog (the player funds each build); they merely *attach*
  to the house-seeded shared waters. Downstream resource-waters (LUMBER/WHEAT/GRAPE) are **not** house priorities
  — the founder wants players forced to run those conversions themselves (the mill is a player business, not a
  house faucet).

The endowment grows from **players'** locked foundations + build spend — not from house seeding. We fund the
spark (the origin), players build the fire.

---

## 5. CAPACITY — bunks + workshops are manufacturing-LP slots (founder refinement)

Each **bunk** (camp/mill/farm/vineyard/dock) and **workshop** is a **SLOT** that caps how many manufacturing LPs
a player can run. `structure-kinds.js` `lpCapFor({bunks, workshops})`:

```
lpCap = FREE_STARTER_LPS + bunks·LP_PER_BUNK + workshops·LP_PER_WORKSHOP
PROPOSED: FREE_STARTER_LPS=0, LP_PER_BUNK=1, LP_PER_WORKSHOP=2   (all OPEN, §6)
```
- So a player with 2 bunks + 1 workshop runs up to **4** manufacturing LPs.
- This makes "go-live" a real ladder: you must **build a bunk before running any business LP**
  (`FREE_STARTER_LPS=0`), and workshops (town-gated, heavier) grant more slots for the boat/gear chains.
- **Enforcement is game-layer** (in `build.js` / the manufacturing-pool open helper), the same place the town
  gate + GOLD exit-liquidity gate live — not on-chain (the layer-(b) contract can also enforce it once built).

### UX skinning — costs framed as operational steps (founder)
The player never sees "endowment / vault / LP." They see the steps to **go live**:
**buy the mill → hire the workers → get the stock → set up shop.** Each step is a real cost that buys real
in-game power (capacity, output, a public storefront). This is the §0 three-bucket model, skinned:
- *buy the mill* = bucket 1 construction (gold + materials),
- *hire the workers* = bucket 2 staffing (the COPPER wage-water turns on),
- *get the stock* = bucket 3 working capital (haul/buy logs in — or, at a camp, just **work it**),
- *set up shop* = open the business LP (or a public **stall**).

---

## 6. STRUCTURE EVOLUTION as a town grows — reroute the flow, don't rebuild (founder DECISION)

As a settlement matures, its **early raw structures become town-inappropriate**: a wood camp or a berry-foraging
bunk belongs in the wilds, not in the middle of a grown town. The founder's chosen mechanism is **NOT** a
hex-swap / demolish-and-rebuild — it is **REROUTING the locked foundation water's payout FLOW to a new
town-appropriate job.** A raw camp **matures into a town service in place.**

**GRADUAL (the raw-production curve) + PLAYER-CHOSEN (founder detail).** Evolution is **not a single switch** —
it's driven by the **raw-production declining curve** (§1): raw harvest is full at **20 bunks** (a maxed wild
camp) and phases to **0 at the 40-pop TOWN tier**. As the settlement grows past 20, each new bunk **converts a
raw slot**, so the early raw structures (logs / berries) must **retarget** onto an **AREA-APPROPRIATE good the
player CHOOSES** for the town's need (e.g. **grains**). It's the player's call, per area/town — not automatic,
not dev-dictated. So **"logs / berries → grains"** happens with **no rebuild and no hex-swap** — just a retarget,
applied progressively as the wild is paved over (camp 20 → town 40). (Whether the UX *prompts* the reroute at
each conversion or lets the player batch it is an OPEN UX choice, §11 #13.)

This maps **directly onto WaterV2's EXISTING payout-reroute hook** — verified in `mftusd-build/WaterV2.sol`:

```
setPayoutTo(uint256 treeId, address dest)   // owner-only; dest must be DestinationRegistry-approved (or 0 = reset)
```
- **Owner-gated:** the contract requires `ownerOf(t.tokenId) == msg.sender` — and the structure NFT's owner is the
  **player**, so the player reroutes their own foundation's flow. ✅
- **Allowlist-gated:** `dest` must be `destinationRegistry.isApproved(dest)` — a vetted in-game destination
  (a contract, never an EOA). `DestinationRegistry.approve()` is **add-only**, owner-gated, holds no funds.
- **Transfer-safe:** `_recipientFor()` honors the reroute **only while `payoutToSetter[treeId]` is still the
  current owner** — a stale destination can never hijack a sold/transferred structure's payout.
- **Reset:** pass `address(0)` to send the flow back to the owner's wallet ("you always get your gift" default).

**So evolution = the OWNER calls `setPayoutTo(foundationTreeId, <new town-job destination>)`.** Register the new
town-job destinations in the DestinationRegistry; owners reroute. **No new contract for this.**

### ⚠ CAVEAT — the OUTPUT GOOD changes at the consumption point, NOT the payout TOKEN (verified)
`payoutToken` is **immutable** in WaterV2 (set at construction; `harvest()` always swaps Money→that token). So the
matured camp **keeps generating its same value** (its foundation water still pays out GOLD / COPPER). What changes
is **where that value goes and what it buys**. Two equivalent routes to "logs → grains", both no-rebuild:
- **(A) retarget the keeper's buy:** the same foundation value is spent by the keeper to **buy GRAINS instead of
  logs** at the consumption point — the OUTPUT GOOD changes at the buy step; the water's token is untouched.
- **(B) `setPayoutTo` to a new town-job destination:** redirect the **recipient** to a DestinationRegistry-approved
  grain/town-service job; that destination consumes the rerouted GOLD/COPPER to make its good (town watch / granary
  stipend / civic fund). The water itself never changes its token.
- Either way the **OUTPUT GOOD changes at the consumption point** (keeper buy or destination), **not** the
  immutable payout token. The player **chooses the new good** per the area/town's need.
- The **FOUNDATION stays LOCKED + location-keyed** (immobile, permanent) — **only the flow/buy redirects.** Nothing
  about the lock, the hex, or the layer-(a)/(b) split changes. A raw structure becomes a town service **in place.**

### This is one of the FEW pieces that needs NO new contract
Unlike the layer-(b) `ManufacturingPool` (§11 #1, must be built), structure evolution **reuses the live WaterV2
reroute hook + the live DestinationRegistry as-is**. The only work is **registering the new town-job
destinations** (add-only `approve()`) + the game-layer UX that calls `setPayoutTo` for the owner. **Design only —
no deploy here.**

> ⚠ OPEN: (1) the **evolution threshold** — founder EXAMPLE ~20 bunks = "a real town"; confirm the number + the
> metric (bunks vs. structure count vs. population) (§11 #13). (2) The catalog of **town-appropriate goods /
> town-job destinations** a matured structure can retarget into (grains / town watch / granary / civic fund / …)
> is not yet designed; the new good is **player-chosen per area/town need**, so this is a menu of approved options,
> not one path. (3) Confirm evolution is **player-elective at the milestone** (founder: player chooses) vs. ever
> *required*. Note: a destination that must **make a good** from the rerouted value edges toward the layer-(b)
> problem — keep destinations/keeper-buys simple (buy/emit an existing good) unless the founder wants minting
> (which would lean on the ManufacturingPool). Route (A) keeper-retarget is the lighter path; (B) needs the
> destination contracts registered.

---

## 7. TownRegistry plan — **recommendation: game-layer, no new contract**

**The question:** how is "hex → structures" tracked, and how are "workshop must be in a town" + "town unlocks
boat crafting" enforced?

**Two options:**

**Option A — a TownRegistry contract.** A new Solidity contract mapping `loc → structure tokenIds`, with a
`isTown(loc)` view the workshop build checks on-chain.
- ✗ New immutable infra (`feedback_no_premature_lock`: don't deploy locked infra during build/prototype).
- ✗ Redundant: the StructureFactory **already emits `StructureBuilt(tokenId, kindId, owner, loc, …)` and stores
  `structures[tokenId].loc`**. The set of structures at a hex is **fully derivable** from factory events/state.
- ✗ More gas, more surface, another founder-gated deploy.

**Option B — game-layer registry extending `settlements.js`/`location.js` (RECOMMENDED).**
- The hex→structures map is **read from the StructureFactory** (iterate `structureCount()` / `StructureBuilt`
  events, group sealed structures by `loc`) and cached in the existing settlement layer.
- `settlements.js` is **already** the settlement registry keyed by `loc`, already says settlements are "ADDED at
  runtime (or read from chain)," already has TIER + NOBLE_RANKS. We add a derived `structuresAt(loc)` count and
  a `tierForHex(loc)` that promotes camp→hamlet→village→town at `TOWN_MIN_STRUCTURES`.
- **Enforcement** lives in `build.js`, beside the GOLD exit-liquidity gate that's **already there**:
  - *workshop/smithy gate*: before building a `townGated` kind, `build.js` checks `tierForHex(loc) === 'town'`;
    if not, it refuses with a clear message (skinned in-fiction: "no charter for a workshop here yet — grow the
    settlement first"). Same pattern as the "no hands for hire" market gate.
  - *boat crafting unlock*: `boat-craft.js` `craftBoat()` / `canCraftBoat()` gains a `townHex` precondition — a
    boat may only be crafted at a hex with a sealed `workshop`. Co-location is already enforced by `location.js`
    `areCoLocated()`.
- The **truth is still on-chain** (the structures + their `loc`), so this is not "faking state" — it's a
  derived view, the same way `existingStructures()` in `build.js` already reads `mill-lp-deployed.json`.

**Why B is correct here:** the chain already records everything a town needs (structure + loc + sealed
foundation). The "town" is an **emergent read** over that data, not a separate source of truth. A contract would
duplicate state and lock infra prematurely. If, later, an **on-chain consumer** needs `isTown(loc)` (e.g. a
contract-enforced workshop), promote the derived rule into a thin view contract then — not now.

> ⚠ OPEN DECISION: **`TOWN_MIN_STRUCTURES = 4` is a proposal.** Also confirm whether town status requires
> *specific* structures (e.g. must include a stall/warehouse) or just a count, and whether the count requires
> **sealed foundations** (recommended — an unsealed structure is still a build-time draft, not "real" yet).

---

## 8. Caravans & Wagons — hauling heavy build materials (design only)

Encumbrance makes **delivering build materials (lumber / stone / mortar) to a remote build site a real
challenge** — especially STONE (5× lumber's haul weight, §2). This is the supply-line piece of bucket 3.

**Grounded in what exists** (`game/lib/location.js` + `weight.js`):
- `location.js` already has **`CARAVANS`** (`caravan_mule` 2t, `caravan_wagon` 6t, `caravan_train` 14t) and
  `travelOverland(entity, target, {mounted})` — land travel is the **time-locked journey** system (foot 24h/hex,
  mount 8h/hex, terrain multipliers: mountain ×2.5, forest ×1.6, swamp ×2.2). A caravan is just an entity in the
  shared hex map; its `cargoTons` gates how much it hauls, exactly like a ship's hold.
- `weight.js`: pawn capacity `50 + 10·(STR−1)` lb; 1 ton = 2000 lb; Light/Laden(≥0.667)/Overloaded.

**The hauling model (sketch):**
1. A build at a far hex needs its material — `materialCostFor(kind)` gives the UNITS on the chosen path (WOOD /
   BRICKS / a building STONE) — **delivered to the build hex** before `build()` can finalize the material burn.
2. Carry it by **pawn on foot** (cheap, tiny, 24h/hex), a **mount** (8h/hex), or a **caravan** (`mule`/`wagon`/
   `train`, 8h/hex, big holds). A wagon of stone is the realistic way to supply a stone town.
3. **Weight = units × per-path haul weight** (§2 SETTLED: wood 10, **stone 50 = 5× wood**, bricks ~25 lb/unit).
   Worked example — a workshop (750 gold-worth material):
   - **WOOD**: 150 units × 10 lb = **1,500 lb** (a mule).
   - **LIMESTONE** (common, **same 5 g price as wood**): 150 units × 50 lb = **7,500 lb ≈ 3.75 t** (a `wagon`).
   - **MARBLE** (12 g premium): 63 units × 50 lb ≈ **3,150 lb ≈ 1.6 t** (still a wagon, fewer units).
   **The parity insight (§2):** limestone costs the **same gold** as wood — it's **5× the HAUL** that's the price.
   So "build in stone" = same gold, +HP/morale, but a real **logistics** commitment. Higher-grade stone (marble) =
   fewer units = lighter haul for more gold. BRICKS sit in the middle (~2.5×).
4. **Co-location gate** (already enforced): the materials + the builder must be **at the build hex** (`location.js`
   `areCoLocated()`), the same presence rule fishing/harvest use. You can't build with stock that's elsewhere.

> ⚠ OPEN NUMBERS: caravan capacities use the existing `CARAVANS` tons (mule 2 / wagon 6 / train 14) — confirm for a
> stone economy. **SETTLED:** stone = 5× wood haul-weight (wood 10 / stone 50 lb); limestone = wood price (5 g).
> Bricks weight (~25 lb) + BRICKS/sometimes-stone prices are PROPOSED (§2, §11 #18). Whether caravans are free or
> must be **built/bought** (a cost) is OPEN (§11 #8).

---

## 9. Loss & risk — the opt-in "untamed wilds" PVP zone (clearly FUTURE, not now)

Today **structures cannot be lost** — a foundation is permanent and safe. **LATER**, the **"untamed wilds"** is
an **OPT-IN PVP zone** where whole towns can be **wiped or claimed by raiders**:
- Building in the untamed wilds is a **choice** (higher reward, real risk) — safe hexes stay safe.
- A raid resolves against the settlement's **HP** (§2: stone builds tank far better than lumber — this is *why*
  the stone HP/morale tradeoff matters), gated through the existing battle-grid + the journey/co-location system.
- **Claiming** a town would transfer its structures/foundations to the raider; **wiping** destroys them.
- ⚠ **Explicitly out of scope here** — design only, not built. It interacts with the FOUNDATION lock (a locked
  immobile foundation is exactly what a raider claims/wipes; nothing about layer (b)'s withdrawability changes).
  The PVP-raiding hook is already PINNED in `location.js` (the `type:'pvp'` stub) — this is the eventual home for it.

---

## 10. The camp → town play loop (player / bot)

Tied to the citizen-bot's existing hands: `build.js` (structures), `build-ship.js` (ships via ShipyardV5),
`fish.js`/`work.js` (income), `sail.js`/`travelOverland` (movement/hauling). Every "build" step is
`build.js plan <kind> --site <loc> --execute` (DRY until the factory is deployed + the kind registered + gates
pass + `CITIZEN_ALLOW_LIVE=1`). Framed as **go-live steps**: buy → hire → stock → set up shop.

```
1.  EARN GOLD            work/fish/fight → convert-winnings → GOLD            (existing tools, live-capable)
2.  BUILD CAMP           build.js plan logging-camp --site <wildHex>          → CAMP (1 structure, +1 LP slot)
      (buy)              pay 1000 gold + materials; foundation LOCKS in place (immobile)
3.  WORK THE CAMP        work logging at the camp                             → feeds LOG-water + COPPER wage-water
      (stock+hire)       LOG-water buys+injects LOGS (self-sourced stock); crew paid by COPPER wage-water
4.  BUILD MILL           build.js plan lumber-mill --site <sameHex>           → HAMLET (2 structures, +1 LP slot)
      (buy)              owner must SUPPLY logs to it (haul from camp / buy) — bucket 3, not the water
5.  REFINE               log→lumber via the mill's thin TIME-GATED LP         → LUMBER stock (owner-withdrawable)
6.  BUILD FARM           build.js plan farm --site <sameHex>                  → VILLAGE (3 structures, +1 LP slot)
7.  BUILD STALL/WAREHOUSE build.js plan stall|warehouse --site <sameHex>      → TOWN (4 structures)  ← town threshold
      (set up shop)      stall = public sell point (bunk+500); warehouse = storage/treasury
        ─── hex is now a TOWN (tierForHex(loc)==='town'); LP cap grew with each bunk ───
8.  BUILD WORKSHOP       build.js plan workshop --site <townHex>              → town-gated, 1500 gold (+LP slots)
                         (gate passes only because the hex is a town)
9.  HAUL + CRAFT BOATS   travelOverland materials in → boat-craft craftBoat('sloop') → burn owner's LUMBER → boat token
        and/or
9b. BUILD SHIP           build-ship.js launch …                              → crewed ShipyardV5 trade ship
10. TRADE ROUTES         sail.js between location-gated LPs → recirculate → grows the foundation endowments
        ↺ repeat at a new hex; each LOCKED foundation + build spend GROWS the endowment engine
```

This is the **endowment engine** (`project_seas_endowment_engine`): every locked FOUNDATION + every gold the
player spends building **stays in-game and compounds**. The HOUSE only seeds the origin (LOG-water + wage-water +
factory + boat tokens); **players build the rest** (§4) — the supply chain IS the game.

---

## 11. OPEN DECISIONS + OPEN NUMBERS for the founder (do not guess — flagged)

**Resolved this round (baked in):** two-layer model (foundation locked / business withdrawable); producer-less
kinds now use treasury vaults → wireable; the camp self-sources via labor; HOUSE-seeds origin only.

1. **⚠ NEW CONTRACT NEEDED — the layer-(b) `ManufacturingPool`.** Owner-withdrawable, location-keyed conversion/
   sell pool with a goods-water + COPPER wage-water. **Neither live primitive fits** (LocationPool is add-only;
   WaterV2 trees lock forever). This is the single biggest unbuilt piece. Confirm we design + deploy it (founder-
   gated, new Solidity). Until then layer (b) is paper; only the FOUNDATION layer (a) is wireable.

2. **STONE TIERS not priced + not deployed (OPEN NUMBERS) — see #18.** No SHALE/LIMESTONE/MARBLE ERC20 exists.
   `STONE_TIER_GOLD_PRICE` (shale 1 / limestone 3 / marble 12) is PROPOSED; `materialCostFor()` returns per-tier
   units for design but `priced:false` until the tokens ship. WOOD path is fully priced + live; stone is design-only.

3. **HP / morale / haul-weight per build-material (OPEN NUMBERS, all PROPOSED).** lumber 100hp/0/10lb,
   stone 200hp/+1/50lb. Sign-off needed — these drive the §9 PVP raid math and the §8 hauling cost.

4. **Capacity formula (OPEN NUMBERS).** `LP_PER_BUNK=1`, `LP_PER_WORKSHOP=2`, `FREE_STARTER_LPS=0`. Confirm a
   player must build a bunk before any business LP, and that workshops grant 2 slots. Also whether the cap is
   per-player-global or per-hex.

5. **Material recipe = goldCost/2 in materials (confirm the split + whether it's a burn or a sink).** The LUMBER
   numbers (camp/mill/farm/vineyard 100; stall/workshop/smithy 150; warehouse 100) follow the boat-recipe value
   logic but are **not founder-set**. Recommend game-layer burn (like `craftBoat`) to start.

6. **Per-good FOUNDATION resource-waters (producers) don't exist + need a buy route.** No LOGS/LUMBER/WHEAT/GRAPE
   WaterV2 is deployed. A producer foundation-water's payout must be **buyable from its yield** (yield→GOLD→good),
   and those goods have **no two-sided buy market** yet (only location-gated sell walls). The gold re-lock still
   works (engine win); the *good flow* waits on the per-good vault + buy route. **Founder priority: LOG-water
   first** (§4 — fund the origin). `fishing-dock` is closest to wireable (FISH water exists, payout=GOLD caveat).

7. **Lock scope — settlements vs. mills/stores.** RESOLVED as two layers: ALL foundations lock (a), ALL businesses
   are owner-withdrawable (b). Confirm there's no kind the founder wants *fully* withdrawable (foundation included)
   — boats are that case and they're a separate, non-location-keyed system.

8. **Caravan capacities + whether caravans cost to build (OPEN).** Uses existing `CARAVANS` tons (mule 2 / wagon 6
   / train 14). Confirm for a stone economy; decide if caravans are free or a purchasable asset.

9. **`TOWN_MIN_STRUCTURES = 4` (proposed).** Confirm the threshold, whether specific structures are required
   (e.g. a stall/warehouse), and that the count requires **sealed foundations**.

10. **COPPER wage-water shared, not per-site.** Building a site does **not** seed copper — the crew is paid from
    the shared live COPPER coin-water via a keeper. Confirm (vs. per-site copper principal, which needs the new
    ManufacturingPool anyway).

11. **Mill duplication.** Mills already have LIVE sell LPs + `mill-keeper.js` (loc 13001/14003) under the OLD
    bespoke-wage flow. The `water-tokens.csv` SIMPLIFY note already says: migrate mills to standard 50/50
    (lumber-water + COPPER wage-water). This model **assumes that migration** — confirm the existing two mills
    fold into the new `lumber-mill` kind vs. coexist. (Note: under the two-layer model the mill's *business* LP
    is the owner-withdrawable ManufacturingPool, not the old keeper-driven LocationPool.)

12. **Workshop ↔ ShipyardV5 relationship (inherited open question, `boat-craft.js`).** Does crafting a boat
    token gate a ShipyardV5 crewed launch (design A), or are they parallel (design B)? `build-ship.js` is design
    B today. Town/workshop crafting doesn't force a choice, but the founder should pick one for the boat→ship path.

13. **Structure-evolution = the raw-production curve + town-good menu (§1, §6).** RESOLVED as a GRADUAL curve
    (raw full at 20 → 0 at the 40-pop TOWN), not a single 20-or-40 switch. Still OPEN: (a) the **UX** — does the
    game *prompt* a reroute at each raw→refined conversion, or let the player batch it; (b) the **menu of approved
    town-goods / town-job destinations** a raw structure can retarget into (grains / town watch / granary / civic
    fund / …); (c) the new good is **player-chosen per town**. Mechanism reuses the LIVE WaterV2 `setPayoutTo` +
    DestinationRegistry — **no new contract** (lightest route = (A) keeper-retarget the buy).

14. **Raw-curve scope — per-settlement-total vs. per-raw-job (§1).** RECOMMENDED: apply `rawHarvestCap(totalBunks)`
    to the settlement's **total** raw bunks (logs+berries+game together). OPEN: if the founder wants each raw job
    capped separately (e.g. logging vs forage vs mine each get their own budget), split into per-job caps.

15. **Buildability matrix + terrain map (§12, §13) — OPEN terrain extensions.** The matrix is grounded in
    `world-features.js`. OPEN: (a) the proposed **terrain-map additions** (more FOREST/MOUNTAIN/PLAINS/SAND
    islands so every build kind has a home, §13) — founder confirms hex coords vs. the art; (b) **new terrain
    kinds** HILLS (stone/vineyards) + SWAMP — PROPOSED, not baked (§13); (c) the **ORE/mine + STONE** chain has no
    tokens yet (mine kind is design-only until ORE/STONE deploy, ties to the stone build path §2).

16. **Agriculture phase-out curve — endpoint + shape (§1).** The SECOND curve (`agricultureCap`) phases farming/
    vineyards/produce from full (≤40, TOWN) to 0 at **CITY = 80** (`BUNK_CAP[CITY]` / lord tier). ⚠ Confirm: (a)
    the **80 endpoint** (does agriculture really end exactly at CITY, or a different pop?); (b) the **curve SHAPE**
    — PROPOSED `max(0, min(40, 80 − n))` (flat through TOWN, then linear to 0); the founder may want it to *start*
    declining earlier or use a non-linear ramp; (c) per-total vs. per-job, same as the raw curve (#14).

17. **Factory-city endgame — upper tiers + mono-industry (§14).** OPEN: (a) do factory tiers keep climbing above
    CITY (pettyking 100 / highking 200 / Port Royal capital) with more phase lines, or is CITY (80, pure
    manufacturing) the top player-built rung? (b) any **mono-industry** bonus/penalty vs. diversified —
    RECOMMEND none (let specialization emerge from geography + trade); (c) Port-Royal-as-sink **pricing** is its
    own design (`project_seas_gold_economy`).

18. **Build cost + material paths (§2) — MOSTLY SETTLED.** RESOLVED: basic bunk 1000 + 500 gold-worth; specialized
    workshop 1500 + 750 gold-worth; mansion full-cost. **SETTLED prices (LIVE in sheet):** wood/lumber 5, SHALE 1,
    LIMESTONE 5 (= wood, common stone), MARBLE 12. **SETTLED ratio:** stone = **5× wood haul-weight** (wood 10 /
    stone 50 lb) — same gold, 5× logistics. **HP mirrors the 5× ratio (SETTLED): wood 100 / stone 500**; bricks
    ~250 (middle); mansion-bunk ~800 premium. STILL OPEN: (a) **BRICKS** price + weight (~25 lb proposed) — token
    FUTURE; (b) **SANDSTONE/GRANITE** ("sometimes" stones) prices ~mid — tokens FUTURE; (c) morale magnitudes +
    the mansion HP/morale bump (PROPOSED).

19. **COOKING recipes + per-lb FOOD pricing (§15).** Food lanes are **cooking** in the `kitchen` (automated line) —
    multi-ingredient recipes on the LIVE `craft.js` engine. OPEN: (a) ingredient lists per dish (pies =
    berries+flour, stews/meals = meat+…); (b) **gold-per-lb** prices per food (`weight.js`); (c) which
    cooking-output tokens to deploy (PIE/STEW/MEAL/BREAD/mead future; WINE live). Gated on BRICKS (the kitchen needs
    a brick OVEN, §15). Recipe-DEPTH embraced (held ingredients, no haul) — distinct from the single-input smelter (#20).

20. **METALLURGY lane — INGOT tokens + TIN reprice (§15). ORE + COAL now LIVE.** Ore tokens are DEPLOYED:
    COPPER/SILVER/GOLD-ORE = 50× their coin (0.5 / 5 / 50 g), IRON-ORE/COAL = 0.5 g. ⭐ **TIN REPRICED (founder
    2026-06-27): TIN = 1/10 COPPER ("10 tin = 1 copper") → tin ore = 0.05 g** (was 0.5) — the **BOTTOM of the value
    ladder** (cheapest material). Tin's minor uses: **bronze alloy** (with copper), **CANS** (food storage), basic
    home goods, bunk demand. ⚠ **Sheet still shows TINORE 0.5 — needs updating to 0.05** (coordinator runs the
    sheet). OPTIONAL FUTURE: a sub-copper **TIN COIN** (~$0.00001) + peg LP. STILL design-only: **INGOT tokens**
    (bronze/iron/steel — recipe SETTLED: ore-only, steel + coal) = step-2 deploy + the smelter/smithy
    `ManufacturingPool` (#1). Config: `ORE_GOLD_PRICE` ladder + `TIN_USES`.

21. **NOBLE MANSIONS + LUXURY GOODS (§16) — coordinator design input, NOT user-approved.** Mansion = the TOP BUNK
    VARIANT (`mansion-bunk`): **UNCAPPED** (build as many as affordable; counts as a bunk), full-cost premium
    (PROPOSED 2000 gold + 2000 gold-worth material), top HP/morale + luxury; **≥1 mansion + pop threshold** makes
    you office-eligible (NOT a singular office building). Rank-scaled stone tier + luxury goods (statue/fountain =
    marble-based crafts, PROPOSED recipes, future tokens, crafting-tree top + luxury sink). ⚠ **Founder must
    confirm this whole section** — coordinator-relayed, not the user; all numbers PROPOSED; depends on MARBLE (§2,
    LIVE) + INGOT (§15, future) chains.

22. **GEAR + FOOD combat payoff (headline §, "Two-Layer Game Structure") — coordinator design input, NOT
    user-approved.** GEAR = offense/defense + damage-type COUNTERS (e.g. "Sun Silver" vs brute, "Black Iron" vs
    magic — ⚠ those materials + a counter system are PROPOSED, **not** in `battle-grid` yet). FOOD = a SEPARATE
    combat axis (HP/stamina/buffs/regen) — so **food items need a combat-buff STAT dimension** beyond the current
    `food=N` value (a future token/stat addition). This is the pull that makes the idle→active loop cohere
    (quality output → stronger heroes → more loot → more endowment). ⚠ Founder confirms; design-only; the
    damage-type system + food-buff stats are new work in `battle-grid`, not built here.

23. **BRICK chain + kitchen OVEN (§15).** SETTLED: SHALE (clay, NOT a building stone) → `brickworks` (automated kiln)
    → BRICKS (middle build-material path); the **kitchen requires BRICKS** (its cooking core is a brick OVEN), so
    bricks gate the cooking economy. OPEN: (a) **BRICKS** token + price + weight (FUTURE); (b) whether the **oven**
    is just the kitchen's brick build-requirement (modeled now) **or** a **standalone `oven` kind** (e.g. a cheap
    home oven vs. a full kitchen line) — flagged, not assumed.

24. **MORALE model (§2) — a lingering HERO BUFF (founder REVISED 2026-06-27).** SETTLED ordering: morale scales
    with stone QUALITY — wood 0 · brick small · limestone small · sandstone/granite mid · marble highest
    (magnitudes 0/1/1/2/2/4 PROPOSED). SETTLED mechanic: high morale **RAISES STATS for VISITING HEROES** and the
    buff **LINGERS (slow decay)** — players **cycle heroes through high-morale towns to re-up** before ventures →
    marble/luxury towns = **hero-buff hubs** (a real combat payoff for prestige builds). Non-fighting **residents =
    cosmetic** (they don't fight). Config: `MORALE_HERO_BUFF`. OPEN: (a) magnitudes; (b) the **morale→stat formula**
    (which stat(s), how much per morale point); (c) the **DECAY RATE** (per hex / per hour / per fight?); (d)
    whether the buff caps or stacks across towns.

**Grounded in `game/lib/world-features.js`** (TERRAIN + PRODUCTION_TYPES) + `forage.js` FORAGE_TABLES — **not a
parallel terrain system.** `world-features.js` already encodes the doctrine: *forest→mills/lumber+forage berries/
game · mountain→mines ore/metal · plains→farm/vineyard+forage berries/pork · water→fish · sand→crab (beach) ·
town→built-up*. Each structure kind carries `buildableTerrain` in `structure-kinds.js`; `canBuildAt(kind,
terrain)` enforces it game-layer (in `build.js`, beside the GOLD-exit + town gates — the contract is terrain-blind).

| Structure kind | Buildable terrain | Why (world-features / forage doctrine) |
|---|---|---|
| `logging-camp` | **FOREST** | forest → logs/lumber + forage |
| `forage-bunk` | **FOREST, PLAINS** | FORAGE_TABLES: forest = berries+elk+bear, plains = berries+pork |
| `fishing-dock` | **WATER, SAND** | water → fish (ocean loc 8004); coastal sand dock |
| `lumber-mill` | **FOREST, TOWN** | at the trees, or inside a built-up town (refining) |
| `farm` | **PLAINS** | plains → farm (wheat/corn) |
| `vineyard` | **PLAINS** | plains → grapes (→ wine); HILLS if added (§13) |
| `mine` | **MOUNTAIN** | mountain → ore/metal (PRODUCTION_TYPES `mine`) |
| `stall` | **TOWN** | a public sell point in a built-up hex |
| `warehouse` | **TOWN** | civic storage in a built-up hex |
| `workshop` | **TOWN** | town-gated crafting (boats/gear) |
| `smithy` | **TOWN** | town-gated crafting (crude weapons/gear) |

> Crab harvest sits on **SAND/beach** (beach loc 9003); it's part of the `fishing-dock`/coastal family (founder
> may want a dedicated `crab-dock` kind later — flagged, not added).

### Geography → scarcity → trade routes (why the matrix matters)
- Because logs only come from **forest** hexes, ore only from **mountains**, grain only from **plains**, **no one
  hex can make everything.** A forested isle (Saltmarsh, NE) is a lumber exporter; the mountainous centre (Port
  Royal) is the ore/stone source; plains feed grain. **Geography forces trade** — the supply chain (§3) is
  spread across the map, so hauling (caravans, §8) + sailing (`sail.js`) between specialized hexes **is** the
  economy. This is the location-keyed-pool arb the world was built around (`world-features.js` header).
- It also gates **where a STONE build is cheap**: stone comes from the mountains, so building a stone town far
  from a mountain is a heavy haul (§8) — terrain + encumbrance + the stone tradeoff (§2) all interlock.

---

## 13. TERRAIN MAP — sketch more of the world (PROPOSALS, founder confirms vs. the art)

`world-features.js` `TERRAIN_DEFS` is **sparse today** — only Saltmarsh (NE forest isle), Port Royal (centre
mountain + one sand hex). With a player-built map (only Port Royal dev-seeded), most hexes are open water. To
give every build kind a **home**, propose extending `TERRAIN_DEFS` with a few more islands/hexes. **These are
PROPOSALS — founder nudges the hex coords to match `game/art/world-map.jpg`; do NOT hard-add without confirming.**
Hex coords use `location.js` flat-top odd-q; `loc = q*1000+r`; ports anchor each island.

Proposed additions (keyed to the existing `PORTS` in `location.js`):

| Island / region (port hex) | Propose terrain | Gives a home to |
|---|---|---|
| **Tortuga Cove** (2,2) — "Buccaneer Shallows", jungle | FOREST around (2,2)/(3,2) | logging-camp, forage-bunk |
| **Beacon Isle** (11,5) — "Beacon Light", hills | PLAINS + (proposed) HILLS near (11,5) | farm, vineyard |
| **Bonewater Atoll** (2,6) — beach | SAND around (2,6)/(3,6) | fishing-dock, crab |
| **Kraken Deep** (5,8) — "The Maw", mountain | MOUNTAIN near (5,8)/(6,9) | mine (ore/stone) |
| **Skull Reef** (10,8) — mountain ruins | MOUNTAIN + SAND near (10,8) | mine + coastal |
| extend **Saltmarsh** (NE) | more FOREST hexes | more logging headroom |
| extend **Port Royal** isle | a PLAINS hex or two | farms near the capital |

(`world-features.js` already has Port Royal centre = MOUNTAIN and a SAND hex at (9,3) — keep those.)

### New terrain kinds — PROPOSALS (flagged, NOT baked)
`world-features.TERRAIN` today = FOREST / MOUNTAIN / PLAINS / SAND / WATER / TOWN. Two worth considering:
- **HILLS** — a home for **stone quarrying** (the STONE+MORTAR build path, §2) and **terraced vineyards**.
  `location.js` `TERRAIN_COST` already has a `hills: 1.8` walk multiplier, so the travel side exists; adding HILLS
  to `world-features.TERRAIN` + the buildability matrix (vineyard, a quarry kind) would be a clean extension.
- **SWAMP** — flavor/danger terrain (Saltmarsh's "Saltmarsh Reach" region is swamp in `location.js`); could host
  a unique forageable. Lower priority.
- ⚠ Both are **flagged in `structure-kinds.js` `TERRAIN`** as proposed-only (commented, not active). Adding either
  means: extend `world-features.TERRAIN` + `TERRAIN_DEFS`, then widen the relevant kinds' `buildableTerrain`
  (e.g. `vineyard: [PLAINS, HILLS]`, a new `quarry: [HILLS, MOUNTAIN]` producing STONE). **Founder call.**
- **STONE source:** if the founder wants the stone build path (§2) live, the cleanest source is a **mine on
  MOUNTAIN** (already in the matrix) or a **quarry on HILLS** (needs the HILLS proposal) producing a STONE token
  — neither STONE nor ORE tokens exist yet (§11 #15).

---

## 14. ⭐ FACTORY-CITY ENDGAME + player-chosen composition — the CAPSTONE / north star (founder)

Everything above converges here. The phase-out curves (§1) cap **land** production by density; the buildability
matrix (§12) ties **what** to **where**. **Neither dictates the manufacturing MIX.** That is the player's, and it
is the point.

### The curves bound land production; players FREELY choose the (non-land) composition
- Within a settlement's allowed **non-land** slots (everything left once raw + agriculture phase out), players
  **choose the mix freely**: **stack many of ONE** industry (a mono-industry **lumber town**, a
  **boat-factory / shipyard city**, a weapons-smithy city) **OR diversify** — whatever suits them.
- The curves only say *how much land production* is allowed at a given density (raw→0 at 40, ag→0 at 80). They
  **never** say which factories to build. `productionMode(n)` gives the STAGE; the **composition is open.**

### This FORCES specialization across locations (the geography lock, §12)
- A **dense city cannot grow its own food or raw** (curves → 0) **and** can only host what its **terrain** allows
  (§12). So a manufacturing city **must IMPORT** its inputs: logs from a forest isle, ore/stone from a mountain,
  grain from a plains town. **No single hex is self-sufficient at scale** — density + terrain + the curves
  together **force specialization** and make **trade mandatory, not optional.**
- The matured raw/ag structures don't vanish — they **reroute** (§6) onto town/city-appropriate jobs as their
  land slots phase out; the *settlement* specializes while its *foundations* stay locked in place.

### Endgame = a player-run chain of goods across specialized locations
```
FOREST isle (logs→lumber) ─┐
MOUNTAIN (ore/stone)       ├─► caravans (§8) + ships (sail.js) ─► dense FACTORY CITY (manufacturing-only,
PLAINS town (grain→flour) ─┘        the supply lines ARE the economy        possibly MONO-industry, e.g. a shipyard)
                                                                                   │  finished goods (boats/gear/food)
                                                                                   ▼
                                                                      PORT ROYAL (loc 8003) — the capital SINK
```
- Players build a **CHAIN of goods across SPECIALIZED locations** → feed **dense FACTORY CITIES** (manufacturing
  -only, possibly mono-industry) → **SHIP finished goods back to Port Royal**, the capital **sink** (its keyed
  market is the heavy gold-priced anchor — the buyer of last resort).
- **The supply lines between specialized locations ARE the player-run world economy** — the literal realization of
  `project_seas_production_economy` (harvest raw → carry → convert at a location-gated LP → carry refined → build/
  ship) and `project_seas_location_lp_factory` (single-venue, presence-gated, arb-proof pools per location).

### Why this is the north star (ties to the endowment engine)
- Every structure along every chain **locks gold as a foundation endowment** (layer (a), §0) and the locked value
  **compounds** (`project_seas_endowment_engine`). A sprawling, specialized, trade-woven map = **many locked
  foundations** = a **large, growing endowment** — the whole reason the build system exists.
- The deliberately **woven, inefficient routing** (you *can't* shortcut geography) is the value, not a cost: it is
  what makes it a **game economy** (a real supply chain players run) rather than a single faucet — and what keeps
  value **re-locking in-game** instead of leaking out.

> ⚠ OPEN (capstone): (a) the **factory-city tiers above CITY** — does the ladder keep climbing (pettyking 100 /
> highking 200 / Port Royal capital) with further phase lines, or is CITY (80, pure manufacturing) the top
> player-built rung? (b) whether **mono-industry** gets any bonus/penalty vs. diversified (founder said free
> choice — recommend NO mechanical thumb on the scale; let specialization emerge from geography + trade). (c)
> Port-Royal-as-sink **pricing** (the capital's keyed buy walls) is its own design (`project_seas_gold_economy`).
> All design-only — none built here.

---

## 15. MANUFACTURING LANES — the buildable supply lines (founder)

Each lane is a **player-built chain of structures** (§2 kinds), step by step — every step an **automated line**
(idle layer, the top §). Whole-good, debit-then-credit, the same shape as `boat-craft.js`. Three families:
**BRICK** (shale→bricks, the build-material + oven chain), **FOOD** (the kitchen; per-lb), and **METALLURGY**
(ore→ingot→gear). Grounded in the live commodity tiers (`commodity-tokens.csv`) + the structure kinds.

### BRICK chain — SHALE → BRICKS → (structures + the OVEN that the kitchen needs)
SHALE is **~clay, not a building stone** (§2) — it's the **raw** of the brick chain:
```
quarry/mine SHALE (raw clay) ──► BRICKWORKS (kiln: fires SHALE → BRICKS, automated) ──► BRICKS
   SHALE live (0x6171…, 1 g)        new `brickworks` kind (shale in → bricks out)        ⚠ BRICKS token FUTURE
        │
        ▼ BRICKS' first + gating use:
   the OVEN — a BRICK-BUILT cooking structure. The kitchen's cooking core IS a brick oven, so a
   KITCHEN MUST be built with BRICKS (`kitchen.requiresMaterial = 'bricks'`). ⇒ BRICKS are a
   PREREQUISITE for the COOKING ECONOMY: no bricks → no oven → no kitchen → no cooked food.
```
- **`brickworks`** = a new automated line (`flow:'convert'`, shale→bricks), TOWN or near the shale source.
- **Oven ↔ kitchen (reconciled):** the **oven is the kitchen's brick core / cooking station** — modeled as the
  kitchen's **brick build requirement** (`requiresMaterial:'bricks'`), **not** a separate buildable kind. ⚠ OPEN:
  if the founder wants a **standalone `oven` kind** (e.g. a cheap home oven distinct from a full kitchen line),
  split it out — flagged, not assumed (§11 #23).
- **BRICKS also = the MIDDLE build-material path** (§2): bricks build structures generally, between wood + stone.
- ⚠ **BRICKS token is FUTURE** (not deployed); SHALE is LIVE. Until BRICKS ships, the brick chain + the
  brick-oven cooking gate are **design-only** (§11 #18).

### FOOD lanes = the KITCHEN (an automated cooking line) — multi-ingredient, priced mostly PER POUND (lb)
Food lanes run in the **`kitchen`** kind — an **AUTOMATED cooking line** (idle layer, top): a kitchen automates
cooking exactly like a smelter automates smelting (ingredients in → cooked food out, runs while FED). The recipes
are **multi-INGREDIENT** (combine held goods — the embraced RECIPE-DEPTH, not haul-friction), executed on the live
`craft.js` engine **inside** the kitchen. Food value ties to **weight** (`weight.js`) — priced **per lb**.

| Cooking lane | Structures | Tokens (live?) | Note |
|---|---|---|---|
| **berries + flour → PIES** | `forage-bunk` (berries) + `farm`→`lumber-mill`/granary (flour) → **`kitchen`** (cook) | BLKBRY/BLUBRY ✅ FLOUR ✅ · **PIE ⚠ not deployed** | multi-ingredient cook; per-lb priced |
| **grapes → WINE** | `vineyard` (grapes) → **`kitchen`**/press (cook) | GRAPE ✅ · WINE ✅ | refined food; can extend (grapes + honey → mead, …) |
| **meat + … → STEWS / MEALS** | forage/hunt (elk/bear/pork/fish) + produce → **`kitchen`** (cook) | meats ✅ · stew/meal ⚠ not deployed | the depth lever — rich combinable recipes; combat BUFFS (§ headline) |
| (grain → flour → bread) | `farm` (wheat) → granary (flour) → **`kitchen`**/bakery (bread) | WHEAT ✅ FLOUR ✅ · BREAD ⚠ | §3; same shape |

- **Per-lb pricing convention** (founder): food markets/recipes quote **gold-per-lb**, reading each food's weight
  (the `food=N` tags in `commodity-tokens.csv` are the sustenance value; the **per-lb price** is the new
  convention — ⚠ exact gold/lb numbers OPEN, §11 #19).
- **Cooked food is a COMBAT BUFF** (a meal before a fight = HP/stamina/buff/regen), not just rations — the headline
  battle-payoff axis. ⚠ food needs a combat-buff stat dimension (future, §11 #22).

### Cooking & Crafting — recipe-depth, automated, via the existing `craft.js` engine
**The engine already exists**: `game/seas/battle-grid/craft.js` (recipe + a localStorage inventory, debit-then-
credit) + the Smithy UI already do **recipe-based crafting**. **Cooking is the same system pointed at food, running
INSIDE the automated `kitchen`** (idle layer — not manual busywork). CRAFTING (multi-part gear/items) uses the same
recipe machinery at the workshop/smithy (also automated lines).
- This is the **RECIPE-DEPTH** the design rule embraces — combine **held ingredients** at a station, no cross-region
  haul (depth, not friction) — and because it runs in an automated line, it's **idle**, not the active game.
  (Contrast the **single-input** smelter, below, which avoids
  haul-friction for a frequent industrial bulk craft.)
- ⚠ Cooking outputs beyond WINE (PIE / STEW / MEAL / BREAD / mead …) are **future tokens** (not deployed); the
  recipes ride the live `craft.js` shape. Exact ingredient lists + per-lb prices are OPEN (§11 #19).

### Design rule — HAUL-FRICTION vs RECIPE-DEPTH (founder 2026-06-27, refined)
A standing rule for every recipe (config: `structure-kinds.js` `COMPLEXITY_AXIS`). The axis is **not item-size**
— it's the **source** of complexity:
- **HAUL-FRICTION** = moving multiple **HEAVY raws ACROSS REGIONS** (logistics, §8). Keep it **LOW** for **frequent
  industrial bulk crafts** (ingots → single heavy input, ore). **Embrace** it for **BIG occasional builds** (boats,
  structures, mansions): gold + wood/stone hauled in — the cross-region logistics IS the fun there.
- **RECIPE-DEPTH** = combining **INGREDIENTS A PLAYER ALREADY HOLDS** at a station (cook/craft). This is **NOT** a
  pain — it's the depth that makes cooking/crafting **good**. **EMBRACE multi-ingredient recipes** here.
- So: industrial bulk (ingots) = single heavy input (avoid haul-friction); **COOKING + CRAFTING = rich
  multi-ingredient recipes** (held goods, no cross-region haul). **WOOD keeps heavy demand** via building + boats —
  it does **NOT** gate ingots. (The dual ore+wood *ingot* idea was a haul-pain; multi-ingredient *cooking* is the fun.)

### METALLURGY lane — ORE → INGOT → WEAPONS & ARMOR (a NEW ingot layer)
A full buildable supply line, adding an **INGOT intermediate** between raw ore and the **existing** Bronze/Iron/
Steel gear tiers (`commodity-tokens.csv` already has DAGGERIRON, SWORDSTEEL, …):

```
MINE (ore, MOUNTAIN) ──► SMELTER (ore → INGOT; steel also + coal) ──► SMITHY (ingot → weapon/armor, TOWN)
   raw extraction          step 2: the NEW ingot layer (SINGLE-INPUT)     step 3: forge into existing gear tiers
```
**Ingot recipes — SETTLED (founder 2026-06-27: JUST ORE, single-input; one steel exception):**
| Ingot | Recipe | Forges (existing gear tier) |
|---|---|---|
| **Bronze ingot** | copper ore + tin ore (ore only — no wood) | Bronze weapons/armor (CLUBBRONZE, SWB, …) |
| **Iron ingot** | iron ore (ore only) | Iron tier (DAGGERIRON, SWI, …) |
| **Steel ingot** | iron ore **+ COAL** ⭐ the one exception | Steel tier (SWORDSTEEL, RAPIERSTEEL, …) |

- **No wood gates an ingot** (founder). The smelter is **single material-class (ore)** in — smooth for a frequent
  craft. The **STEEL exception** (+COAL) is flavorful and **low haul-pain**: coal + iron **both come from MOUNTAIN
  terrain** (§12), so they're usually **co-located** — no cross-map haul.
- **Buildable structures per step:** `mine` (ORE, MOUNTAIN, raw — §1 curve) → `smelter` (ORE→INGOT, MOUNTAIN/TOWN;
  steel also consumes COAL) → `smithy` (INGOT→weapon/armor, TOWN-gated). Each step is a player-built lane;
  wooden-tier gear still comes straight from LUMBER at the smithy.
- **Owner supplies the stock at each step** (bucket 3): the smelter needs ore (+coal for steel) the owner mined/
  hauled/bought; the smithy needs ingots. Geography forces it (ore = mountains, §12) — feeds the factory-city
  endgame (§14).
- ⚠ **INGOT tokens are a STEP-2 deploy** (after the raw ores ship): no ORE, no COAL, no INGOT tokens exist yet
  (`commodity-tokens.csv` has the gear tiers but no ores/coal/ingots). The lane is **design-only** until those
  tokens deploy (§11 #19). The **STONE build path** (§2) is the natural sibling output of the mine/quarry.

---

## 16. NOBLE MANSIONS & LUXURY GOODS — claiming rank (coordinator design input; DESIGN-ONLY)

> ⚠ This section is **coordinator-relayed design input**, recorded as design only. It is **not** user-approved and
> nothing here is built. Folded in for completeness; flagged for the founder's own confirmation.

### Mansion = the TOP BUNK VARIANT (uncapped) — NOT a singular structure (founder REVISED 2026-06-27)
A mansion is the **premium grade of bunk** (the `mansion-bunk` variant, §2) — **not** a one-off building:
- **UNCAPPED**: a player may make **ALL their bunks mansions** if they can afford it. Mansions **count as bunks**
  (toward population/capacity, §1/§5). It's a **grade you build many of**, not a singular seat.
- **FULL-COST premium**: full gold + **full** material (NOT the half-value bunk rate). PROPOSED: **2000 gold +
  2000 gold-worth material**. Top HP/morale (`mansion-bunk` ~800 HP / +4 morale = marble-tier, §2) + luxury —
  the highest hero-buff hub.
- **Office eligibility:** holding a `NOBLE_RANKS` office (mayor → lord → pettyking → highking) needs the
  settlement **population threshold** (§1) **AND ≥ 1 mansion** — the mansion makes you *eligible*, it is not a
  unique office building. **Requirements SCALE BY RANK** (`structure-kinds.js` `mansion.rankRequirements`):

| Rank (NOBLE_RANKS pop) | Stone tier | Luxury goods demanded |
|---|---|---|
| **mayor** (40) | limestone | — |
| **lord** (80) | **marble** | statue |
| **pettyking** (100) | **marble** | statue + fountain |
| **highking** (200) | **marble** | statue + fountain + more (multiple) |

- Each mansion's foundation endowment is a **GOLD treasury** (re-locks gold, §0) → **more mansions = more locked
  stake** = more endowment (the engine, §14). Wireable today (GOLD treasury vault is live).

### Luxury goods — STATUES + FOUNTAINS (the crafting-tree top + a luxury SINK)
- **Statues + fountains** (extensible: obelisks, statue-gardens, …) are **luxury goods FOR mansions** — decoration/
  status, demanded especially by **top-tier** mansions. They are the **TOP of the crafting tree**: crafted from
  **PREMIUM materials (MARBLE + metals/ingots)** at a workshop/smithy.
- They are a **LUXURY SINK**: nobles pour **gold + premium stone + luxury goods** into mansions to **claim/hold
  rank** — value that **re-locks** (endowment) and **drives demand** for the marble + metallurgy lanes (§15) and
  the factory cities that make them (§14). PROPOSED recipes (`structure-kinds.js` `LUXURY_GOODS`):
  - **Marble Statue** = 50 marble + 5 ingot · **Marble Fountain** = 100 marble + 10 ingot.
- ⚠ **Statue/fountain are future tokens** (none deployed); recipes + the mansion cost/rank numbers are all
  **PROPOSED** (§11 #21). Crafted via the same `craft.js` recipe engine as cooking (§15). Depends on the MARBLE
  (§2) + INGOT (§15) chains existing first.

---

## Files

- Model doc: `game/seas/CAMP-TO-TOWN-MODEL.md` (this file)
- KIND catalog config (StructureFactory-consumable): `game/seas/structure-kinds.js`
- Terrain doctrine to extend: `game/lib/world-features.js` (TERRAIN, PRODUCTION_TYPES, TERRAIN_DEFS) + `game/lib/forage.js`
- Real contract: `mftusd-build/StructureFactory.sol` (+ `fork-test-structure-factory.cjs`, `deploy-structure-factory.cjs`)
- Existing settlement registry to extend: `game/lib/settlements.js`
- Encumbrance + caravans (hauling, §8): `game/lib/weight.js` + `game/lib/location.js` (`CARAVANS`, `travelOverland`)
- Existing build hand to wire to: `game/seas/citizen/tools/build.js` (+ `game/seas/citizen/lib/chain.js`)
- Boat recipe: `game/seas/boat-craft.js`; ship build: `game/seas/citizen/tools/build-ship.js`
- Cooking/crafting recipe engine (§15): `game/seas/battle-grid/craft.js` (live — recipes + localStorage inventory)
- ⚠ NEW (unbuilt, founder-gated): the layer-(b) owner-withdrawable `ManufacturingPool` contract (§11 #1)
