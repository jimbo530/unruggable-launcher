# Seize the Seas — Battle-Grid Integration Spec (wiring the v2 content)

How to wire the **agent-generated content files** (`bestiary-sea.js`, `bestiary-dungeon.js`,
`spells-catalog.js`, `area-encounters.js`) and the **multi-enemy / terrain / gear** upgrades
into the existing battle deck **with the smallest possible blast radius**.

This is a **wiring DOC**. It does not change code by itself. Implement the steps **in order** —
each step ships and smoke-tests on its own before the next.

> Line numbers below are **as of 2026-06-25** (the read that produced this doc). They will
> drift as files change — always match on the **function name**, not the raw line.

---

## 0. THE ONE HARD RULE — what you may and may not touch

| Layer | Files | Edit? |
|---|---|---|
| **Verbatim engine (sacrosanct)** | `tot-engine.js` | **NO.** Ported 1:1 from Tales-of-Tasern. Reuse its exports; never edit its formulas. |
| **Pure engine (don't touch)** | `class-engine/*`, `../../lib/weight.js`, `../../lib/location.js` | Avoid. Touch `location.js` only in §2 (encounter roll), and only additively. |
| **Wiring / bridge (the integration surface)** | `units.js`, `game.js`, `items.js` | **YES — additive only.** New functions + a few call-site repoints. This DOC is the spec for those edits. |
| **New content (create these)** | `bestiary-sea.js`, `bestiary-dungeon.js`, `spells-catalog.js`, `area-encounters.js`, plus 2 tiny helpers (`monster-bridge.js`, `combat-ext.js`) | **CREATE.** New ESM, `export const …`, `node --check` clean, comment each entry with its `// SRD source`. |

**Why `tot-engine.js` is off-limits:** `resolveAttack` / `resolveSpellCast` / hex math are a
verbatim port (header of the file). Weapon dice and cover are therefore wired as **additive
wrappers in new files** (see §4C, §5), not edits to the port.

**Golden rule for every step:** the **default training flow must keep working unchanged**
(`makeStarterUnits()` with no recruit → demo Barbarian vs sparring caster). Every new path is a
**branch off the existing one**, never a replacement.

---

## STEP 1 — `makeMonster()` + multi-enemy N-vs-N spawns  *(lowest risk; no new content needed)*

### 1.1 Confirm the loop is already N-agnostic (read-only — verify, don't change)

The turn loop and win check in **`game.js`** already handle **any number of units per side**.
Verify before building on them:

- **`checkWin()`** (`game.js` ~L497): `new Set(state.units.filter(isConscious).map(u => u.isPlayer))`,
  ends when `sides.size <= 1`. **Side-count, not unit-count** → N-vs-N safe. ✅
- **`endTurn()`** (`game.js` ~L531): `state.turnIdx = (state.turnIdx + 1) % state.units.length`,
  round bumps when `turnIdx === 0`, downed units bleed + are skipped with a `guard <= units.length`.
  **Already loops N units.** ✅
- **`aiTurn()` / `nearestFoe()`** (`game.js` ~L632 / ~L581): each enemy acts on its own turn vs the
  nearest **conscious** foe. **Per-unit, N-safe.** ✅
- **`init()`** (`game.js` ~L654): spreads `built.units` into `state.units` (~L681). A group is just a
  longer `units` array — **no init change required**. ✅

**Caveats to encode (these are the only real N-vs-N gotchas):**

1. **No initiative sort.** Turn order == **array order** of `state.units`. Build the array as you want
   it to play (recommended: `[player, enemy, enemy, …]`, or interleave for multiple allies). Document,
   don't "fix" — adding an initiative sort would be an engine change.
2. **Unique starting hexes.** `occupiedSet()` (`game.js` ~L59) and `drawUnit()` key off `position`.
   **Every spawned unit needs a distinct hex** inside the grid (`GRID_COLS=9 × GRID_ROWS=7` from
   `tot-engine.js` ~L29). Two units on one hex = overlap + broken move math. Use the placement helper in 1.3.

### 1.2 Create `monster-bridge.js` (NEW) — the direct-stat `BattleUnit` factory

Players go endowment → `class-engine` → `buildUnit()`. **Monsters skip the class-engine** and supply
stats directly. To stay zero-risk, `makeMonster()` must emit the **exact same `BattleUnit` shape**
`buildUnit()` returns (`units.js` ~L170–223) **including the display/compat fields** the sidebar reads,
or clicking a monster / its turn render will throw.

**Critical — fields `game.js` reads on EVERY unit (not just combat):**
`showStats()` (`game.js` ~L282) and `loadOf()` (~L269) read `u.qualified[0]`, `u.engineStats.{STR..CHA}`,
`u.endowment`, `u.totalLevel`, `u.bracket`, `u.spellDC`. **A monster MUST carry safe values for all of
them** (`qualified: []`, `engineStats` with all six scores, `endowment: {}`, a `bracket` label string,
a numeric `totalLevel`). Miss one and the stat panel crashes the moment it's that monster's turn.

```js
// monster-bridge.js  (NEW — additive; mirrors units.js buildUnit() output shape)
import { equipItem } from "./items.js";

const clampScore = (n) => Math.max(0, Math.round(Number(n) || 0));
const totMod = (dndScore) => Math.floor(Math.max(0, dndScore - 10) / 2); // matches tot-engine abilityMod meaning

/**
 * Direct-stat monster → BattleUnit. NO class-engine. Same shape buildUnit() emits so
 * tot-engine combat AND game.js sidebar/loot/AI consume it unchanged.
 *
 * @param {object} m
 * @param {string} m.id  @param {string} m.name
 * @param {"melee"|"caster"} m.role
 * @param {number} m.hp
 * @param {{str,dex,con,int,wis,cha}} m.abilities  RAW D&D scores (e.g. Dex 17). Drives saves + carry.
 * @param {number} m.attack    FLAT physical damage (per the deck-band house rule)
 * @param {number} m.atkBonus  to-hit
 * @param {number} m.ac
 * @param {number} [m.attackRange=1]  hexes (1=melee, 2=reach, 3+=ranged)
 * @param {number} [m.movementHexes=3]
 * @param {string[]} [m.spells=[]]    SPELLS ids (caster)
 * @param {number} [m.casterLevel=1]
 * @param {{q,r}} m.position          MUST be unique on the board
 * @param {string} [m.emoji]  @param {object} [m.art]  @param {object} [m.loadout]
 * @param {object} [m.flags] free-form (e.g. { telegraph:true, severable:true, fleesAtHp:2 }) — see §5
 */
export function makeMonster(m) {
  const A = {
    str: clampScore(m.abilities?.str ?? 10), dex: clampScore(m.abilities?.dex ?? 10),
    con: clampScore(m.abilities?.con ?? 10), int: clampScore(m.abilities?.int ?? 10),
    wis: clampScore(m.abilities?.wis ?? 10), cha: clampScore(m.abilities?.cha ?? 10),
  };
  const isCaster = m.role === "caster";
  const intMod = totMod(A.int);
  const stats = {
    attack: Math.max(0, m.attack ?? 1), atkBonus: m.atkBonus ?? 0, ac: m.ac ?? 10,
    mAtk: A.int, def: A.dex, mDef: A.wis, hp: m.hp,
    speed: (m.movementHexes ?? 3) * 5,
    lightningDmg: 0, fireDmg: 0, lightningDice: null, fireDice: null, retaliationDice: null,
    resistances: m.resistances || [], immunities: m.immunities || [], retaliationDmg: 0,
  };
  const range = m.attackRange ?? 1;
  const move = m.movementHexes ?? 3;
  const unit = {
    id: m.id, name: m.name, className: m.className || (isCaster ? "Caster" : "Monster"),
    imageEmoji: m.emoji || (isCaster ? "\u{1F9DF}" : "\u{1F479}"),
    crewId: null,
    imageUrl: m.art && m.art.ready ? m.art.src : undefined,
    cosmetics: [],
    isPlayer: false, role: m.role,

    // ── DISPLAY/COMPAT FIELDS — REQUIRED so game.js showStats()/loadOf() don't throw ──
    endowment: {},                  // showStats Object.entries(...) needs an object
    engineStats: { STR: A.str, DEX: A.dex, CON: A.con, INT: A.int, WIS: A.wis, CHA: A.cha },
    bracket: m.bracket || "monster",
    totalLevel: m.cr ?? m.casterLevel ?? 1,
    qualified: [],                  // showStats does u.qualified[0] → must be an array
    spellDC: 8 + intMod,

    // ── ToT BattleUnit fields (tot-engine reads these) ──
    position: { ...m.position },
    stats, rawAbilities: { str: A.str - 10 < 0 ? 0 : A.str - 10, dex: Math.max(0, A.dex - 10),
      con: Math.max(0, A.con - 10), int: Math.max(0, A.int - 10), wis: Math.max(0, A.wis - 10),
      cha: Math.max(0, A.cha - 10) },
    subtypes: [], currentHp: m.hp, maxHp: m.hp, hasMoved: false, hasActed: false, activeEffects: [],
    attackRange: range, isRanged: range > 1,
    casterLevel: m.casterLevel ?? 1, castingAbilityMod: intMod, availableSpells: m.spells || [],
    movementHexes: move,

    // ── EQUIP base (so items.js applyEquipment + game.js death-drop work on monsters too) ──
    baseStats: { ...stats }, baseMaxHp: m.hp, baseAttackRange: range, baseMovementHexes: move,
    baseCastingMod: intMod, equipped: { weapon: null, armor: null, trinket: null },

    // ── monster behaviour flags (read by the §5 AI/objective hooks; ignored otherwise) ──
    flags: m.flags || {},
  };
  // optional starting loadout (real armory ids). Iterate SLOTS in production (see §3) not a hardcoded list.
  const lo = m.loadout || null;
  if (lo) for (const slot of ["weapon", "armor", "trinket"]) if (lo[slot]) equipItem(unit, lo[slot]);
  return unit;
}
```

> **rawAbilities note:** `tot-engine.resolveSpellCast` (~L210) reads `target.rawAbilities.con/dex/wis`
> for saves and runs them through `abilityMod = floor(score/2)`. The bridge stores D&D−10 so a monster's
> Dex 17 → `rawAbilities.dex 7` → save mod +3, **identical to the player path** (`units.js toTScore` ~L108).

### 1.3 Create the spawn-placement helper (in `monster-bridge.js`)

Guarantees unique, on-board, side-segregated hexes (enemies high-q, players low-q):

```js
import { GRID_COLS, GRID_ROWS } from "./tot-engine.js";
/** Distinct enemy hexes packed on the right side of the deck. */
export function enemySpawnHexes(count, taken = new Set()) {
  const out = [], cols = [GRID_COLS - 1, GRID_COLS - 2, GRID_COLS - 3];
  let i = 0;
  for (const q of cols) for (let r = 0; r < GRID_ROWS && out.length < count; r++) {
    const k = `${q},${r}`; if (taken.has(k)) continue; taken.add(k); out.push({ q, r });
  }
  while (out.length < count) { out.push({ q: cols[0], r: (i++) % GRID_ROWS }); } // overflow fallback
  return out;
}
```

### 1.4 Wire a multi-enemy spawn into `units.js`

`makeStarterUnits()` (`units.js` ~L392) returns either a plain `[player, sparring]` array **or** a
control object (`{locked}`, `{pvp, units}`, `{pvpNoOpponent}`). **A group is just `units` with >1 enemy.**
Add a builder that returns the **same `{pvp:true, mode, units}` shape `init()` already understands**
(`game.js` ~L679–685) so `init()`, `checkWin`, `endTurn` need **zero changes**:

```js
// units.js — NEW, additive. Reuses the existing player-build path verbatim.
import { makeMonster, enemySpawnHexes } from "./monster-bridge.js";

export function makeSquadBattle(enemyTemplates, opts = {}) {
  const player = buildPlayerUnit();           // factor the recruit/demo build out of makeStarterUnits
  const taken = new Set([`${player.position.q},${player.position.r}`]);
  const hexes = enemySpawnHexes(enemyTemplates.length, taken);
  const enemies = enemyTemplates.map((t, i) =>
    makeMonster({ ...t, id: `mob_${i}_${t.slug || t.id}`, position: hexes[i] }));
  return { pvp: true, mode: opts.mode || "encounter", units: [player, ...enemies] };
}
```

**Minimal refactor:** lift the player-build block in `makeStarterUnits()` (recruit→`buildUnit`,
else demo Barbarian, plus the loadout loop ~L394–422) into a small `buildPlayerUnit()` and call it from
both `makeStarterUnits()` and `makeSquadBattle()`. Keep `makeStarterUnits()` otherwise untouched so the
1-v-1 training/PVP/encounter paths are byte-for-byte the same.

**Smoke (Node, no DOM):** add `smoke-monster.mjs` mirroring `smoke-equip.mjs` — build a 5-rat squad,
assert `units.length === 6`, all positions unique, `checkWin`-style side set has both `true` and `false`,
and `node --check monster-bridge.js`.

---

## STEP 2 — Import the bestiary + area-encounters; spawn an enemy GROUP per encounter

### 2.1 What the new content files export (shapes the wiring expects)

```js
// bestiary-sea.js / bestiary-dungeon.js  (NEW)
// Each entry = makeMonster() args WITHOUT id/position (filled at spawn). Comment the SRD source.
export const BESTIARY_SEA = {
  bilge_rat:   { slug:"rat", name:"Bilge Rat", role:"melee", hp:4, ac:13, attack:1, atkBonus:2,
                 attackRange:1, movementHexes:5, abilities:{str:9,dex:17,con:11,int:2,wis:12,cha:4},
                 emoji:"\u{1F400}", flags:{ fleesAtHp:2 } }, // SRD Dire Rat, scaled to deck band
  tentacle:    { slug:"tentacle", name:"Kraken Tentacle", role:"melee", hp:14, ac:14, attack:8,
                 atkBonus:4, attackRange:3, movementHexes:2, abilities:{str:23,dex:15,con:20,int:10,wis:14,cha:10},
                 emoji:"\u{1F9A0}", flags:{ telegraph:true, severable:true, anchored:true } }, // SRD Kraken arm
  // …goblin_spear, goblin_slinger, goblin_shaman (role:"caster"), hobgoblin_boss (flags.routesPackOnDeath)…
};
```

```js
// area-encounters.js  (NEW) — encounter GROUP defs keyed by area/danger; resolves template ids → counts.
import { BESTIARY_SEA } from "./bestiary-sea.js";
import { BESTIARY_DUNGEON } from "./bestiary-dungeon.js";
const DEX = { ...BESTIARY_SEA, ...BESTIARY_DUNGEON };
export const AREA_ENCOUNTERS = {
  bilge:  { map:"bilge",  objective:"wipe",          group:[["bilge_rat",5]] },
  caves:  { map:"cave",   objective:"boss:hobgoblin_boss", group:[["goblin_spear",2],["goblin_slinger",1],["goblin_shaman",1],["hobgoblin_boss",1]] },
  kraken: { map:"kraken-sea", objective:"sever:4",   group:[["tentacle",6]], spawn:"water-edge" },
};
/** Expand a group spec → flat array of makeMonster templates (id/position added at spawn). */
export function expandGroup(spec) {
  const out = [];
  for (const [tid, n] of spec.group) for (let i = 0; i < n; i++) {
    const t = DEX[tid]; if (!t) throw new Error(`area-encounters: unknown monster "${tid}"`); // loud, never silent
    out.push({ ...t });
  }
  return out;
}
```

### 2.2 Two ways an encounter reaches the deck — keep BOTH; add the group path additively

**The existing single-enemy path must keep working** (`location.js rollEncounter` ~L380 emits one
`ENEMY_POOL` foe → `encounter.js` writes it to `sts_pvp_opponent` → `units.js buildOpponentUnit`
~L311 builds one rival). **Do not remove it.** Add a parallel GROUP path:

1. **`encounter.js` (additive):** add `armVoyageEncounterGroup(areaId, opts)` next to
   `armVoyageEncounter()` (~L61). It writes the **group spec + map + objective** to a NEW key
   `sts_encounter_group` and the same context blob (`LS_CTX` ~L30) used today, then returns the
   `?mode=encounter` battle URL. Leave `armVoyageEncounter()` / `handleSetSail()` untouched.
2. **`units.js makeStarterUnits()` encounter branch (~L428–437):** before the existing
   `readPvpOpponent()` single-enemy read, check for a `sts_encounter_group` blob. If present:
   `expandGroup(spec)` → `makeSquadBattle(templates, {mode:"encounter"})` and attach
   `spec.map` + `spec.objective` to the return (see §5). If absent, **fall through to the current
   single-`buildOpponentUnit` path unchanged.** This preserves `location.js`'s live PVE roll.
3. **`game.js init()` (~L704):** the `pvp && mode==="encounter"` framing block already logs
   "Raiders on the route!". Extend it to read `state.objective`/`state.mapId` for the group framing
   (e.g. "Sever 4 tentacles to break free"). `stakes`/`arena`/`finishEncounter()` need no change.

> **Optional, later:** upgrade `location.js rollEncounter()` (~L380) to emit `{type:'pve', area:'kraken'}`
> for high-danger water and route it through `armVoyageEncounterGroup`. This is the only `location.js`
> edit; keep it additive (new branch, old `ENEMY_POOL` branch intact). The Kraken is the natural
> "random open-sea boss" the wishlist wants here.

---

## STEP 3 — Open up the gear SLOTS  *(genuinely additive; flat mods need no engine change)*

`applyEquipment()` (`items.js` ~L92) **already sums mods generically over `SLOTS`** and
`renderEquip()` (`game.js` ~L222) + `checkMortality()` (`game.js` ~L439) **already loop `SLOTS`**.
So adding slots is mostly **one array** plus matching `equipped` keys.

1. **`items.js` ~L17:** extend
   `export const SLOTS = ["weapon", "offhand", "armor", "helm", "boots", "ring", "trinket"];`
2. **`units.js buildUnit()` ~L222 and `monster-bridge.js`:** initialise every new key in the
   `equipped: {…}` object (`weapon:null, offhand:null, armor:null, helm:null, boots:null, ring:null,
   trinket:null`). (`applyEquipment` tolerates missing keys via `if (!id) continue`, but initialise
   them so the equip UI renders every row.)
3. **Loadout loops:** in `units.js` (`buildOpponentUnit` ~L321, the recruit loadout ~L413) and
   `monster-bridge.js`, replace the hardcoded `["weapon","armor","trinket"]` with the imported `SLOTS`
   so saved loadouts can fill the new slots.
4. **New items** go in `gear-data.js` (existing armory generator) or a new `gear-extra.js` merged into
   `ITEMS` the same way `craft.js` forge items are merged (`items.js` ~L36). Set `slot` to the new value
   and a `weight` (encumbrance via `weight.js` flows automatically through `equippedList()` ~L135).

**Flat-mod new gear works with ZERO `applyEquipment` change** — Buckler `{ac:1}`, Sea Boots
`{movementHexes:1}`, Iron Pot Helm `{ac:1, maxHp:2}` all use the already-summed keys
(`attack/atkBonus/ac/maxHp/attackRange/movementHexes/castingMod`, `items.js` ~L103–109).

**Store/crew UIs:** the in-battle `renderEquip()` updates for free. The standalone General Store and
Crew View pages also iterate slots — point them at the same `SLOTS` export so the new rows appear there
too (verify after, not load-bearing for combat).

### 3B — Ability-score mods (`str/dex/con/…`) — the one stat-bridge-touching change (do AFTER 3A)

Today mods only hit derived fields; a `+2 STR` ring does **nothing** because `applyEquipment` never
re-derives. Doing it right means **recomputing the bridge from base scores**, and the derivation lives
inline in `buildUnit()` (`units.js` ~L154–168). To keep **one** derivation source (and dodge the
`items.js ↔ units.js` circular import — `units.js` already imports `items.js` at ~L41):

1. **Create `stat-derive.js` (NEW):** export `deriveCombatStats({ scores, role, charLevel })` returning
   `{ attack, atkBonus, ac, mAtk, def, mDef, speed, rawAbilities }` — **lift the exact formulas** from
   `buildUnit()` ~L154–168 (don't re-invent them; copy so behaviour is identical).
2. **`units.js buildUnit()`:** call `deriveCombatStats()` instead of the inline block, and **store
   `u.baseAbilities = { ...S }`** (the raw D&D scores) alongside `baseStats`.
3. **`monster-bridge.js`:** set `u.baseAbilities` from the monster's `abilities` too.
4. **`items.js applyEquipment()`:** at the top, build `effScores = baseAbilities + Σ(ability-mods)`
   (clamp 0..30), call `deriveCombatStats({scores:effScores, role:u.role, charLevel:u.casterLevel})`
   to get the ability-derived stats, **then** layer the existing flat-mod loop (~L99–110) on top, and
   write back `u.engineStats` + `u.rawAbilities` from `effScores` (so `showStats`, saves, and
   `loadOf`→`pawnCapacity(u.engineStats.STR)` all track the buff).

**Risk:** this is the only change that can shift existing numbers. Gate it behind the existing
`smoke-equip.mjs` plus a new assert: equipping `{str:2}` raises `attack` AND `pawnCapacity`. If a quick
ship is needed, **3A alone (slots + flat-mod gear) delivers most of the value at near-zero risk**;
defer 3B.

---

## STEP 4 — Merge `spells-catalog.js` into `SPELLS`  *(no `tot-engine.js` edit)*

`SPELLS` originates in `tot-engine.js` (~L254) but **`game.js` imports it from `units.js`**
(`game.js` ~L18), and `units.js` re-exports it (`units.js` ~L40 import, ~L451 export). So the merge
point is **`units.js`** — `tot-engine.js` stays verbatim:

1. **`spells-catalog.js` (NEW):** `export const SPELLS_CATALOG = { … }`, each entry the documented
   SPELLS shape (`id, name, level, battle:{ type, hexRange, hexArea?, damage, damageType?, healing?,
   save?, buff*?, durationRounds? }`). Comment each with its SRD/ToT source.
2. **`units.js`:** import both and merge, then re-export the union:
   ```js
   import { SPELLS as SPELLS_BASE } from "./tot-engine.js";
   import { SPELLS_CATALOG } from "./spells-catalog.js";
   export const SPELLS = { ...SPELLS_BASE, ...SPELLS_CATALOG };
   ```
   Replace the bare `SPELLS` in the existing `export { CONFIG, SPELLS }` (~L451). `game.js` now sees the
   full catalog with **no `game.js` change**. `resolveSpellCast` takes the `battle` object as a param, so
   it never needed the registry.

**Wiring by spell type:**

- **Damage spells → ZERO wiring.** `beginSpell()` (`game.js` ~L342), `onHexClick` spell branch (~L385),
  and `aiAct()` (~L614) already handle any `type:"damage"` entry (single-target).
- **Heal / buff spells → small `game.js` additions** (`resolveSpellCast` already returns
  `healing`/`effect`, but `game.js` ignores them):
  - **Targeting:** `beginSpell()` filters to **enemies** (`e.isPlayer !== u.isPlayer`, ~L350). For
    `type:"healing"|"buff"`, target **allies** (`e.isPlayer === u.isPlayer`) instead.
  - **Apply:** in the `onHexClick` spell branch (~L389–391) it only does `if (res.damage) applyDamage`.
    Add `if (res.healing) healUnit(target, res.healing)` (the `healUnit` hook already exists,
    `game.js` ~L421) and `if (res.effect) target.activeEffects.push(res.effect)` (buffs are already read
    by `resolveAttack` via `sumEffects`, `tot-engine.js` ~L160).
- **AoE / cone (`hexArea`, e.g. Blunderbuss, Fireball) → additive loop.** Single-target apply is the
  current behaviour. To splash, after picking the target hex, gather `hexesInRange(targetHex,
  battle.hexArea)` (already imported in `game.js`) and apply to each occupant. Build as an opt-in branch
  when `battle.hexArea` is set; leave single-target spells alone.

---

## STEP 5 — Terrain / cover / objective hooks  *(where in `game.js`)*

All hooks layer on **`state`** (`game.js` ~L691) and reuse the **buff/effect + occupied channels the
engine already honors** — so `tot-engine.js` stays untouched.

### 5.1 Carry terrain + objective on `state`

- **`init()` (`game.js` ~L691–703):** add `mapId`, `terrain`, `objective` to the `state` object. Source
  them from the encounter (the `spec.map`/`spec.objective` attached in §2.2). Define terrain as a
  `Map<"q,r", { cover?, hazard?, blocking?, waterEdge? }>` from a NEW `maps/<id>.js` (or inline in
  `area-encounters.js`). Default (training/PVP): empty terrain + `objective:{type:"wipe"}` → **current
  behaviour exactly.**

### 5.2 Render (visual only — safe)

- **`hexFill()` (`game.js` ~L91):** before the checker default, tint by terrain tag
  (cover = green-ish, hazard/water-edge = blue, blocking = dark). Also tint a **telegraphed** hex
  (`unit.flags.telegraph` target, §5.5) red-orange.
- **`drawDeck()` / `drawHexes()` (~L72 / ~L99):** draw prop/terrain art per tile (barrels, masts,
  foam, stalagmites). The `ART` block (`units.js` ~L64) already reserves prop sprite hooks.

### 5.3 Cover = +AC (no engine edit — use the buff channel)

`resolveAttack` already adds `sumEffects(target, "buffAC")` (`tot-engine.js` ~L161). At the two attack
call sites — `onHexClick` (`game.js` ~L377) and `aiAct()` (~L624) — add the **defender's cover** as a
transient `buffAC` effect on the target for that resolution (push, resolve, pop), or precompute
`coverBonusAt(target.position)` from `state.terrain` and apply it the same way. **Zero `resolveAttack`
change.**

### 5.4 Blocking + hazards (movement)

- **Blocking:** `hexesInRange()` already accepts an `occupied` set. At the move call sites —
  `enterMove()` (`game.js` ~L323) and `aiMoveToward()` (~L597) — pass `occupiedSet(u) ∪ blockingHexes`
  (union the terrain's `blocking` keys). One-line wrap; pathing now routes around walls/cargo.
- **Hazards (fall-overboard / water pools):** after a move commits — player branch in `onHexClick`
  (~L365–370) and `aiMoveToward` (~L601) — check `state.terrain.get(key(dest))?.hazard`. If set, apply
  the consequence (e.g. `applyDamage(u, n)`, or shove via the existing position write). Reuse
  `applyDamage()`/`bleed()` so death-sink + `checkWin` fire normally.

### 5.5 Objectives (non-wipe wins) — the single decision point

`checkWin()` (`game.js` ~L497) is the **only** place a battle ends. Make it consult `state.objective`
**before** the default side-elimination:

```js
function checkWin() {
  if (state.objective && state.objective.type !== "wipe") {
    const done = evalObjective(state);     // NEW helper, reads state.objective + state.units
    if (done) { /* set phase "over", banner, finishEncounter(done.playerWon) */ return; }
  }
  // …existing side-count logic unchanged (the "wipe" default)…
}
```

`evalObjective(state)` (NEW, in `game.js` or a tiny `objectives.js`) handles the wishlist win types:
- `sever:N` (Kraken) — count enemies with `flags.severable` dropped to ≤0 (they "sink", don't bleed);
  win at N, or lose if all player units are down.
- `boss:<id>` (Goblins) — win when the unit whose id/template matches the boss is down (then **rout**
  the rest: mark remaining pack `currentHp = -10` or flee).
- `survive:<rounds>` — win when `state.round > N`.

**Telegraph (Kraken "Into-the-Breach" slam):** in `aiTurn()` (`game.js` ~L632), a `flags.telegraph`
unit on turn T **marks** its intended target hex (`unit.telegraphHex`) and only **resolves** the smash
on turn T+1. `hexFill()` (§5.2) renders the warned hex. Pure additive AI state; no engine change.

**Severable on death:** in `checkMortality()` (`game.js` ~L435) or `applyDamage()` (~L403), if
`u.flags.severable` and `u.currentHp <= 0`, mark it sunk (out of the fight, no bleed/gear-drop) and let
`evalObjective` count it. Branch only when the flag is set so normal pawns are unaffected.

---

## Build / verify order (matches the wishlist P1→P3)

| # | Ship | New files | Wiring edits | Smoke |
|---|---|---|---|---|
| **P1a** | `makeMonster` + multi-enemy | `monster-bridge.js` | `units.js` (`buildPlayerUnit`, `makeSquadBattle`) | `smoke-monster.mjs` (6 units, unique hexes) |
| **P1b** | Bilge Rats on a Bilge map | `bestiary-sea.js`, `area-encounters.js`, `maps/bilge.js` | `encounter.js` (group arm), `units.js` (group branch), `game.js` (framing + terrain render) | manual: sail → 5-rat fight |
| **P1c** | Gear slots (flat) | `gear-extra.js` | `items.js SLOTS`, `equipped` inits, loadout loops | extend `smoke-equip.mjs` |
| **P2a** | Cave Goblins + Caves | `bestiary-dungeon.js`, `maps/cave.js` | area-encounters entry | boss-rout check |
| **P2b** | Ability-score gear + weapon dice | `stat-derive.js`, `combat-ext.js` | `items.js applyEquipment`, `game.js` 2 resolveAttack call-sites | `{str:2}` raises dmg+carry; dice weapon varies dmg |
| **P2c** | Spell catalog | `spells-catalog.js` | `units.js` SPELLS merge (+heal/buff targeting in `game.js`) | cast a new damage spell; cast a heal on an ally |
| **P3** | Kraken | tentacle in bestiary, `maps/kraken-sea.js` | `game.js` objective/telegraph/sever hooks; optional `location.js` group roll | `sever:4` win without wipe |

**Every new file:** `node --check <file>.js` clean, `export const …`, each data entry commented with its
`// SRD source`. **Never edit `tot-engine.js`.** Re-run `smoke-equip.mjs` after any `items.js` touch.

### §4C — weapon dice without editing `resolveAttack` (referenced by P2b)

`resolveAttack` (`tot-engine.js` ~L159) reads `attacker.stats.attack` as **flat** damage. To roll
`weapon.dmgDice` instead **without editing the port**, add a wrapper in **`combat-ext.js` (NEW)**:

```js
// combat-ext.js — additive. Keeps tot-engine.js verbatim.
import { resolveAttack, rollDice } from "./tot-engine.js";
import { ITEMS } from "./items.js";
/** If the equipped weapon has dmgDice, roll it on top of base (STR/material) attack for THIS swing. */
export function resolveAttackExt(attacker, target, natural, distance = 1) {
  const wid = attacker.equipped && attacker.equipped.weapon;
  const dice = wid && ITEMS[wid] && ITEMS[wid].dmgDice;     // dice weapons carry { dmgDice:"1d6" } instead of flat mods.attack
  if (!dice) return resolveAttack(attacker, target, natural, distance); // unchanged path
  const roll = rollDice(dice, 1).total;
  const swing = { ...attacker, stats: { ...attacker.stats, attack: attacker.stats.attack + roll } };
  return resolveAttack(swing, target, natural, distance);   // delegate to the verbatim engine
}
```

Then repoint the **two** `resolveAttack(` calls in `game.js` (`onHexClick` ~L377, `aiAct` ~L624) to
`resolveAttackExt(`. Dice weapons in `gear-data.js`/`gear-extra.js` carry `dmgDice` and **omit** the flat
`mods.attack` (so STR-base + die, no double count). `applyEquipment` ignores `dmgDice` (not in its sum),
so encumbrance/other mods are unaffected.

---

## Quick reference — exact anchors (function · file · ~line as of 2026-06-25)

- **Player BattleUnit shape (copy for `makeMonster`)** — `buildUnit()` · `units.js` ~L125, return ~L170–223
- **Display fields a monster MUST have** — `showStats()` `units`/`game.js` ~L282; `loadOf()` ~L269 (`engineStats.STR`)
- **1-v-1 entry / control shapes** — `makeStarterUnits()` · `units.js` ~L392; enemy build ~L424–448
- **init() normalize + `state`** — `game.js` ~L654, units spread ~L681, state ~L691
- **N-side win / N-unit turn loop** — `checkWin()` ~L497 · `endTurn()` ~L531 · `aiTurn()` ~L632
- **Equip engine (slot-generic)** — `SLOTS` `items.js` ~L17 · `applyEquipment()` ~L92 · `equipItem()` ~L124 · `equippedList()` ~L135
- **Equip UI loop / death-drop loop (auto-pick up new slots)** — `renderEquip()` `game.js` ~L222 · `checkMortality()` ~L439
- **SPELLS source / re-export (merge point)** — `tot-engine.js` ~L254 · imported `units.js` ~L40 · re-exported ~L451 · consumed `game.js` ~L18
- **Spell cast targeting/apply** — `beginSpell()` `game.js` ~L342 · spell branch ~L385–394 · `healUnit()` ~L421
- **Verbatim combat (DO NOT EDIT)** — `resolveAttack()` `tot-engine.js` ~L159 · `resolveSpellCast()` ~L203 · `rollDice()` ~L120
- **Terrain render / move / win hooks** — `hexFill()` `game.js` ~L91 · `enterMove()` ~L323 · `aiMoveToward()` ~L597 · `onHexClick` move ~L365 · `checkWin()` ~L497
- **Encounter bridge (single-enemy path to mirror)** — `armVoyageEncounter()` `encounter.js` ~L61 · `LS_OPP`/`LS_CTX` ~L29 · `buildOpponentUnit()` `units.js` ~L311
- **Live PVE roll (optional group upgrade)** — `rollEncounter()` `location.js` ~L380 · `ENEMY_POOL` ~L234 · `setSail()` ~L408
