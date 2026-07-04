# Seize the Seas — Content & Item Wishlist (v1)

A production backlog of **things to make** so combat plays better. Grounded in the real
engine (`game/seas/battle-grid/`): enemies build from an endowment/snapshot → class-engine →
`BattleUnit`; gear = `items.js`/`gear-data.js` mods layered on base stats; encounters route
through `encounter.js`. Items below note **what it is · why it helps · how it plugs in · art needed**.

> Status: **v1.1** — founder's ideas + the code, now with **D&D 3.5 (SRD) stat blocks** (see §6).
> **Split of labor:** founder makes the **art** 🎨; Claude does the **stats / data / mechanics**.
> The running 3-round design loop will merge its roster/gear/terrain into v2.

---

## 1. Enemies & Monsters

### ⭐ Featured (founder's calls)

- 🐀 **Bilge Rats** — a **swarm of 4–6 weak pawns** in the ship's bilge/hold.
  - *Why:* the perfect first "more pawns" fight — lots of cheap bodies teaches squad tactics without big risk.
  - *Stats:* ~4–6 HP, low to-hit, **fast (move 4–5)**, melee bite (1 dmg). Come in numbers; flee at half.
  - *Plug-in:* needs the **multi-enemy** build (combat loop) — spawn N rats instead of one foe. Map = Bilge.
  - *Art:* `rat` sprite (idle), optional `rat-swarm` cluster.

- 👺 **Cave Goblins** — a **goblin pack** for cave maps (sea-cave hideouts, smuggler grottos).
  - *Why:* first fight with real enemy *variety* — a mix that forces target priority.
  - *Pack:* `goblin-spear` (melee, reach 2) ×2–3 · `goblin-slinger` (ranged) ×1–2 · `goblin-shaman` (caster, ray) ×1 · **`hobgoblin-boss`** (tanky leader; killing it routs the pack).
  - *Plug-in:* multi-enemy + the existing caster role. Map = Caves (chokepoints).
  - *Art:* `goblin`, `goblin-archer`, `goblin-shaman`, `hobgoblin` sprites.

- 🦑 **Kraken — random open-sea encounter (BOSS)** — the showcase fight.
  - *Why:* one encounter = a whole big-map battle; pure spectacle and the reason to want bigger maps + more pawns.
  - *Mechanic:* **4–6 Tentacle pawns** rise from the **water-edge hexes** around your deck. Each tentacle: high HP, **reach 2 slam**, **telegraphed** (shows the hex it will smash next turn — Into-the-Breach style). **Sever a tentacle (drop it to 0) and it sinks back**; the "head" surfaces only after N tentacles are cut.
  - *Objective:* **survive + sever** (not wipe) — fits "Seize the Seas" and gives a non-kill win condition.
  - *Plug-in:* random route roll in `location.js`/`encounter.js` → a **multi-pawn enemy group**; tentacles spawn on the new water-edge terrain; needs telegraph + objective hooks from the loop.
  - *Art:* `tentacle` (raised / slamming / severed), splash/foam tile, optional kraken-eye head.

### More for variety & progression
- 🦈 **Sharks** — circle in the water; a hazard that punishes anyone knocked overboard.
- 💀 **Skeleton Crew** — undead boarders from a ghost ship; immune to "bleed", drop bone gear.
- 🏴‍☠️ **Rival Pirate Crews** — *already supported* via the PVP snapshot path; just needs **named captains + set loadouts** (e.g. "Red Mowgli's cutthroats").
- ⚓ **Navy Marines** — disciplined ranged line (muskets); teaches cover.
- 🧜 **Merfolk Raiders** — leap from the water; hit-and-submerge.
- 🐍 **Sea Serpent** — a "mini-kraken" single big-HP boss for mid fights.

> **Engine note:** monsters shouldn't need a token *endowment*. Add a small `makeMonster({name, hp, str, dex, role, attack, range, move, loadout, art})` path in `units.js` so rats/goblins/tentacles can be defined by **direct stats** (the endowment path stays for player crew NFTs).

---

## 2. Maps / Arenas (bigger maps + terrain)

Each needs a layout + terrain tiles that affect play (cover = +AC, water-edge = fall hazard, props = blocking).

- 🛢️ **Bilge / Hold** — cramped, **water pools (hazard)**, barrels & cargo (cover). Home of the rats.
- 🕳️ **Sea Caves** — tight **chokepoints**, stalagmite cover, dark edges (limited sight). Home of the goblins.
- 🌊 **Open Deck vs Kraken** — large; **rails = fall-overboard hazard**, masts = cover, **water-edge hexes** where tentacles emerge.
- 🪝 **Two-Ship Boarding** — your deck + theirs joined by a **gangplank chokepoint**; the classic pirate fight.
- 🪸 **Reef / Tidepool** — shallow-water movement penalties; sharks lurking.
- ⛈️ **Storm Deck** — periodic wave hazard sweeps a row; slippery footing.

---

## 3. Gear / Equipment (stat-adjusting — the equip ask)

**First: open up the slots.** Today shield + helm + body armor all fight over ONE `armor` slot.
Proposed slot list: **`weapon · offhand · armor · helm · boots · ring · trinket`** (engine: extend `SLOTS` + `equipped` + the equip UI; `applyEquipment` already sums mods generically).

**Let gear touch more stats.** Today mods only hit `attack/atkBonus/ac/maxHp/attackRange/movementHexes/castingMod`.
Add **ability-score mods** (`str/dex/con/int/wis/cha`) that recompute derived stats — so a "+2 STR" ring actually raises damage & carry.

New items to make (concrete mods in the engine's fields):
- **Offhand:** Buckler `{ac:1}` · Parrying Dagger `{ac:1, atkBonus:1}` · Boarding Shield `{ac:2, movementHexes:-1}`.
- **Helm:** Captain's Tricorn `{ac:1, cha:1}` · Iron Pot Helm `{ac:1, maxHp:2}`.
- **Boots:** Sea Boots `{movementHexes:1}` · Deck-Grip Boots (ignore slippery/storm penalty).
- **Ring/Amulet:** Ring of the Bull `{str:2}` · Cat's-Eye `{dex:2}` · Iron Belly `{con:2}` · Scholar's Lens `{int:2}`.
- **Weapon dice (upgrade):** make weapons roll dice instead of flat — Cutlass `1d6`, Boarding Axe `1d8`, **Blunderbuss `2d4` cone**, Pistol `1d8` (1 shot/reload). *(engine: `resolveAttack` rolls `weapon.dmgDice` if present, else flat — additive, doesn't break the port.)*
- **Rarity + affixes:** Worn / Fine / **Masterwork** / Cursed / **Legendary**, with 1–2 rolled affixes (e.g. "+1 vs beasts", "+1 init"). Builds on the existing masterwork/enchant system.
- **Set bonus:** **Captain's Regalia** (Tricorn + Coat + Saber) → equip all 3 for "+1 to-hit to allies in 2 hexes".
- **Consumables / throwables** (a new quick-use slot): **Grog** (heal) · **Powder Bomb** (AoE) · **Caltrops** (zone) · **Throwing Net** (immobilize 1 turn) · **Grappling Hook** (pull a foe 1 hex / cross a gap).

---

## 4. Crew Roles (pawn archetypes for squads)
Give the recruited crew distinct jobs so a squad has texture: **Gunner** (ranged) · **Bruiser** (melee tank) · **Bosun** (buff/heal) · **Powdermage** (caster) · **Swashbuckler** (mobile flanker) · **Cabin Boy** (cheap body). Each maps to a stat lean + a starting loadout.

---

## 5. Art — founder's lane 🎨
Founder makes all art. So the file ids line up with your sprites, here are the **asset names** the stats below expect:
- **Enemy sprites:** `rat` · `goblin` · `goblin-archer` · `goblin-shaman` · `hobgoblin` · **`tentacle`** (raised/slam/severed) · `shark` · `skeleton` · `marine` · `merfolk` · `sea-serpent`.
- **Terrain props:** `barrel` · `crate` · `mast` · `cannon` · `stalagmite` · `gangplank` · `water-hazard` · `foam`.
- **Gear icons:** `art/gear/<id>.png` for each new item.
- **Map backgrounds:** `bilge` · `cave` · `kraken-sea` · `two-ship` · `reef` · `storm`.

---

## 6. Stat blocks (D&D 3.5 SRD → engine-ready)

House rule: keep each SRD creature's **abilities & flavor**, scale numbers to the deck band
(player pawns ~10–20 HP, AC ~10–12, dmg ~4–9). Full machine-readable versions live in
`battle-grid/bestiary-sea.js` + `bestiary-dungeon.js` (agent-generated).

**🐀 Bilge Rat** (SRD Dire Rat — HD 1d8+1, AC 15, bite +4 1d4, Dex 17, climb)
→ **HP 4 · AC 13 · bite 1 · +2 to-hit · range 1 · move 5 (fast)** · swarm of 5–6, flees at ≤2 HP.

**👺 Goblin pack** (SRD Goblin — HD 1d8+1, AC 15, Dex 13, darkvision 60)

| Unit | HP | AC | Dmg | Hit | Range | Move |
|---|---|---|---|---|---|---|
| Goblin Spear | 5 | 13 | 2 | +2 | 2 (reach) | 3 |
| Goblin Slinger | 4 | 12 | 2 | +2 | 3 (ranged) | 3 |
| Goblin Shaman | 5 | 11 | caster | — | — | 3 |
| **Hobgoblin Boss** | 9 | 14 | 4 | +3 | 1 | 3 |

Kill the boss → the pack routs.

**🦑 Kraken** (SRD — 270 hp, 2 tentacles + 6 arms = **8 limbs**, constrict/ink). Model each **limb as a severable pawn:**
→ **Tentacle ×4–6:** **HP 14 · AC 14 · slam 2d6 · +4 · reach 3 · move 2 (anchored)** · **telegraphs** its smash one turn early · **sever at 0** (sinks, no bleed). **Win = sever N / survive**, not a wipe.

**Weapon dice** (for the dice upgrade): dagger 1d4 · cutlass 1d6 · boarding axe 1d8 · pistol 1d8 · blunderbuss 2d4 cone · greatsword 2d6.

---

## Suggested build order
- **P1 (biggest visible win):** multi-enemy spawns → **Bilge Rats** swarm on a **Bilge** map (proves "more pawns + bigger map"); open up the **equip slots** + a handful of new slot items.
- **P2:** **Cave Goblins** pack + **Caves** map; ability-score gear; weapon dice.
- **P3:** **Kraken** tentacle encounter (random route) on the **Open-Deck** map with water-edge spawns + telegraph + sever objective; rarities/sets.
