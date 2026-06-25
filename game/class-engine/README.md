# Cause = Class Engine

A **pure, off-chain, data-driven** class engine for the "cause = class" battle-grid RPG.
The entire class tree is **config** — the designer grows it like FFT's job list with **no code changes**.

No blockchain calls. The engine **reads a plain endowment object** (a stub) that will later
be filled by the on-chain vault / cross-version oracle. Same input → same output (deterministic).

Design source: `../../docs/battle-grid-class-map.md`.

---

## Files

| File | What it is |
|---|---|
| `schema.js` | Type definitions (JSDoc) + `validateConfig()`. Pure shapes + LOUD validation. No logic. |
| `config/causes.js` | **EXAMPLE** cause data — the designer replaces/grows this. |
| `config/classes.js` | **EXAMPLE** class data — the designer grows this like FFT's job list. |
| `resolver.js` | Pure functions: endowment → levels → stats → qualified classes → bracket → spells → loadouts. |
| `index.js` | Public barrel + `makeConfig()`. |
| `demo.js` | `node demo.js` — prints a few worked scenarios. |
| `test/resolver.test.js` | `node --test` — focused mechanic tests (zero deps). |

Run tests: `npm test` (or `node --test`) from this folder.
Run demo: `node demo.js`.

---

## The mechanics (how config maps to play)

- **Level = dollars endowed.** `$1 = 1 level`, cumulative. Total level = sum across all causes.
- **Base block:** `10 HP` + all six D&D stats at `10`.
- **Water grows stats two ways:**
  - **Diffuse water** (bought / undirected, key `"_diffuse"`) spreads **1/6 evenly** across all six stats
    (`$6 diffuse = +1 to every stat`). Unchanged by splits/rates.
  - **Earned cause-water** **concentrates** into the cause's `stat` — the "6× vs diffuse" rule.
- **Stat split** — a cause's `stat` may be a single stat (`"INT"`, concentrated `1.0/$1`) **or** a
  weighted **split** like `{ STR: 0.5, CON: 0.5 }` (so `$1` adds `+0.5 STR` and `+0.5 CON`). Split
  weights **must sum to `1.0`**. The point stays whole — it's just shared — this is **not** the 1/6 diffuse spread.
- **Point rate** — a cause's optional `pointRate` (default `1.0`) multiplies the stat **points per `$1`**,
  applied **before** the single-vs-split distribution (and still capped).
  - **RULE — the `> 1.0` bonus is COMPENSATION for tokens the player FORGOES.** The in-game value of the
    bonus stands in for tokens the player gives up; **never double-dip** (a cause must not grant both token
    flow AND a stat bonus).
    - **CHAR** → `pointRate 1.5`: the player **never receives** the CHAR airdrop — it is **burned** — so the
      `+50%` stat rate is the in-game reward for those forgone tokens.
      (split `{WIS:.5, CON:.5}` → `$1` = `+0.75 WIS, +0.75 CON`.)
    - **PUMP** → `pointRate 1.0`: PUMP players **do receive** PUMP token flow (the airdrop reaches them) and
      the endowment funds on-the-ground solar/water, so **no** stat bonus is warranted — normal rate.
      (single `INT` → `$1` = `+1.0 INT`; it just takes more `$` to cap INT, offset by the tokens received.)
- **CON drives HP** (D&D-style; "CON is always good because it's HP):** `HP = 10 + (CON − 10)` using the
  **capped** CON — every point of CON over 10 adds `+1 HP` (CON 20 → +10 HP; CON 30 → +20 HP). So any
  CON-granting cause (CHAR, BURGERS) raises survivability for **any** build. A pure-INT PUMP wizard gets
  no CON → base `10 HP` = **glass cannon**; splash a CON cause to survive.
- **Caps:** `20` normal, `30` for a **god** cause (mark `{ usd, god: true }` in the endowment). A god cause
  lifts the cap on **every** stat it feeds (both halves of a split).
- **Spell power** = the cause's **primary stat**. `d20 mod = floor((stat-10)/2)`; **save DC = 8 + mod**.
- **Qualification = three gates** (FFT/d20):
  1. **Ratio gate** — the class's `requiredCauses` must hold a combined **share ≥ `ratioThreshold`**,
     held within the **`strictness` band** (concentration + drift).
  2. **Prereq gate** — FFT-style: be **qualified** for each `prereqs[].classId` at **≥ `level`** (= $ in that class).
  3. **Balance class** (Fighter) — opens **only while diffuse** (no cause dominates past its `ratioThreshold`),
     **closes** when concentrated.
- **Drift** is implicit: change the endowment, re-run `resolve()`, qualifications shift.
- **Weight brackets** bin total level: `1–2 / 3–5 / 6–10 / 11–20 / 21–30`. Bracket sets the **loadout cap**.
- **Multiclass / loadout:** a wallet may qualify for many classes; `loadoutOptions` reports the menu,
  the action-economy **cap**, and a deterministic **suggested** active set.

---

## How the designer adds a NEW class (pure config)

Open `config/classes.js` and append an object. No engine edits.

```js
{
  id: "watershed_warden",          // unique stable key
  name: "Watershed Warden",
  family: "Nature",                // one of schema.js FAMILIES
  primaryStat: "WIS",              // drives spell power + save DC
  secondaryStat: "CON",            // optional
  requiredCauses: ["clean_water", "reforestation"], // hold these
  ratioThreshold: 0.45,            // combined share must be >= 45%
  strictness: "medium",            // loose | medium | strict (drift band width)
  prereqs: [                       // FFT-style: be qualified for X at level Y
    { classId: "druid", level: 6 },
  ],
  tier: 2,                         // 0 Base, 1 Specialized, 2 Combo, 3 Exotic
  abilities: [                     // unlock by class-level (= $ in requiredCauses)
    { id: "purify",  name: "Purify",  minClassLevel: 1,  kind: "spell" },
    { id: "flood",   name: "Flood",   minClassLevel: 8,  kind: "spell" },
  ],
}
```

### To add a new **cause**

Open `config/causes.js` and append:

```js
{
  id: "clean_water",
  name: "Clean Water",
  family: "Divine",            // archetype family this cause feeds
  stat: "WIS",                 // single stat OR a split: { STR: 0.5, CON: 0.5 } (weights sum to 1.0)
  pointRate: 1.0,              // optional, default 1.0; >1.0 = extra-impact bonus (e.g. forgone-airdrop burn)
  tokenRef: "0x...",           // opaque ref to the on-chain cause token/vault (engine never calls it)
}
```

`validateConfig()` runs automatically in `makeConfig()` / `resolve()` and throws a **precise,
loud error** if a class points at an unknown cause, uses an unknown stat/family/strictness,
a split whose weights don't sum to `1.0`, a `pointRate <= 0`,
duplicates an id, or sets an out-of-range threshold/tier. Nothing fails silently.

### Strictness bands (the drift lever)

| Strictness | Band width | Use for |
|---|---|---|
| `loose`  | wide  | Tier-0 on-ramp base classes (tolerate dilution) |
| `medium` | 0.20  | Tier-1/2 specialized + combo classes |
| `strict` | 0.08  | Tier-3 exotics (drift out the instant ratios slip) |

The band is reported per qualified class as `strictnessBand` plus a live `driftMargin`
(how far above threshold you sit) so a UI can color "close to drifting out".

---

## Using it from code

```js
import { resolve, makeConfig } from "./index.js";

const config = makeConfig();                      // bundled EXAMPLE config
// or: makeConfig({ causes: myCauses, classes: myClasses });

// `endowment` is the STUB that later comes from the on-chain oracle:
const view = resolve({ reforestation: 12, education: 3 }, config);

view.totalLevel;       // 15
view.bracket;          // { id:'heavy', label:'11–20', ... }
view.stats;            // { STR:10, DEX:10, CON:10, INT:13, WIS:22→20(cap), CHA:10 }
view.qualified;        // [{ id, name, tier, classLevel, spellPower, saveDC, availableAbilities, ... }]
view.loadoutOptions;   // { cap, candidates, suggested }
```

Everything in `resolve()` is a **pure function of its inputs**. To swap in real on-chain
endowment data later, just build the same `{ causeId: usd }` object from the oracle read and
pass it in — no other changes.
