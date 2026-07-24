# ARCADE-STATS — Baseling stat-wiring standard

How every MfT Arcade game turns a player's baseling into gameplay. Read this before
remastering or building any arcade game. The goal: **a fed-up baseling feels stronger,
but a fresh starter can still beat every single-player game.** Stats are flavor and edge,
never a wall.

There is exactly one source of multipliers: `BaselingPlayer.getMults()`. Do not invent
your own stat math, do not read `entry.stats` and scale by it yourself, and do not apply
two multipliers to the same mechanic. If a game needs a knob this doc doesn't cover, map
it to the closest existing stat — don't add a sixth.

---

## Where the numbers come from

1. The API (`GET /api/baseling/arcade-roster`) returns each baseling with computed
   `stats` (1–200) derived from the forever-vault LP fed to it. The curve is
   `min(100, round(sqrt(usdFed * 1000)))` per stat, times a stage multiplier, times a
   0.5–2.0 care/feed condition multiplier. A baseling with nothing fed sits near the
   floor; a whale-fed legend approaches 200.

   > **Consume `stats` exactly as served — they are final.** The server has *already*
   > baked in the stage multiplier and the 0.5–2.0 care/feed condition multiplier. The
   > `tokenFeeds` field is included for display only (USD totals already computed on the
   > server). **Never recompute stats from `tokenFeeds`, never re-price tokens
   > client-side, and never re-apply the stage or condition multiplier** — the API owns
   > pricing and the formula. A game that re-derives stats will drift from the server and
   > break fairness. Read `entry.stats`, pass it through `getMults()`, done.
2. `baseling-player.js` loads that roster, picks the selected character, and exposes the
   served stats plus **bounded gameplay multipliers**. Games only ever touch the bounded
   multipliers.
3. No wallet / no baselings → the player is **Wimmple**, all stats 10, every multiplier
   ≈ 0.69 raw but **clamped up to the 0.8 floor**. So the worst case a game ever sees is
   the 0.8 floor (single-player) — design around that.

### The five stats → the five multipliers

| Stat | Label | `getMults()` key | Wire it to |
|------|-------|------------------|------------|
| speed   | SPD | `moveSpeed` | movement / scroll speed / jump distance / lap pace |
| stamina | STA | `health`    | hit points / lives / energy / countdown timer length |
| power   | PWR | `damage`    | damage dealt / throw force / block-break / knockback |
| luck    | LCK | `luck`      | drop rates / crit chance / RNG bias in player's favor |
| swim    | SWM | `swim`      | speed during water sections only (ignore if no water) |

---

## The contract: `BaselingPlayer.getMults(opts)`

```js
// Single-player (default): clamp 0.8 .. 1.6
var m = BaselingPlayer.getMults();

// Wager / PvP: clamp 0.95 .. 1.10  — REQUIRED for any tasern-wager.js game
var m = BaselingPlayer.getMults({ pvp: true });

// m === { moveSpeed, health, damage, luck, swim }   // all numbers, already clamped
```

Internally each multiplier is `1 + (stat - 50) / 125`, then clamped to the active band.
That means **stat 50 = neutral (1.0×)**. Below 50 you're under 1.0 (down to the floor),
above 50 you're over 1.0 (up to the ceiling).

Reference points (single-player band 0.8–1.6):

| Raw stat | Raw multiplier | Clamped (0.8–1.6) |
|----------|----------------|--------------------|
| 10 (Wimmple) | 0.68 | **0.80** (floor) |
| 50 (neutral) | 1.00 | 1.00 |
| 100 | 1.40 | 1.40 |
| 125 | 1.60 | 1.60 |
| 200 (maxed) | 2.20 | **1.60** (ceiling) |

So across the *entire* range of baselings, a single-player game sees multipliers between
**0.8× and 1.6×** — a 2× spread, top to bottom. That is the whole design envelope.

---

## The two fairness rules (not optional)

### Rule 1 — Clamp everything through `getMults()`. Never raw stats.
Every stat effect goes through a `getMults()` value. The clamp is what guarantees a fresh
baseling stays viable and a whale baseling can't trivialize the game. If you scale a
mechanic by `entry.stats.power / 50` yourself, you've bypassed the clamp and broken the
guarantee. Don't.

### Rule 2 — Wager/PvP games tighten the band to 0.95–1.10.
Any game registered in `tasern-wager.js` (`WAGER_GAMES`) is skill-based money. There, a
better-fed baseling may give at most a ~10% edge, and a starter is at most ~5% behind.
Pass `{ pvp: true }` to `getMults()` in those games — this is a **fairness requirement so
wagers stay a contest of skill, not of who fed their pet more USDC**, not a stylistic
choice. Show the stats in the UI either way (players want to see them); just bound their
effect.

Current wager games (must use `{ pvp: true }`): `baseling-boxing`, `micro-baselings`,
`token-columns`, `super-dodge`, `baseling-grind`, `frost-poppers`, `streets-of-tasern`,
`spore-breaker`, `rc-reactor`, `spore-tributaries`. If you add a game to `WAGER_GAMES`, you
must also switch its `getMults()` call to `{ pvp: true }` in the same change.

### How to apply a multiplier without breaking balance
- **Speeds / forces / distances** scale *up* with the multiplier: `value = base * m.moveSpeed`.
- **Damage the player takes / costs** scale *down* with the survivability multiplier:
  `dmgTaken = base / m.health`. (Dividing by `health` means more stamina = less damage in.)
- Always derive from a **base tuned for the 1.0 case** (a neutral, stat-50 baseling),
  then let the multiplier nudge it. If the game is only fun at 1.6× or only beatable at
  0.8×, the base is wrong — fix the base, not the multiplier.
- Cap derived values where physics demands it (jump height, max fall speed, projectile
  count) so 1.6× can't clip through walls or trivialize a screen.

---

## Per-genre cheat-sheet

Concrete wiring per genre. `m = BaselingPlayer.getMults()` (or `{pvp:true}` for wager
games). Every example assumes `base*` constants are tuned for a neutral 1.0× baseling.

### Platformer (e.g. Frost Poppers, run-and-jump games)
- Move speed: `playerVx = baseVx * m.moveSpeed`
- Jump height: `jumpV = baseJumpV * m.moveSpeed`, then **cap** so 1.6× can't overshoot level geometry
- Damage taken from enemies: `hp -= baseHit / m.health` (more STA = soaks more hits)
- Throw/stomp force: `knockback = baseKnock * m.damage`
- Powerup / coin drop chance: `dropP = baseDropP * m.luck`
- SWM: ignore (no water) — or apply to underwater sections only

### Shmup / shooter (e.g. arcade space shooters)
- Ship speed: `shipV = baseShipV * m.moveSpeed`
- Shots-to-die / shield: `maxHp = round(baseHp * m.health)` (or extra life at high STA)
- Bullet damage: `dmg = baseDmg * m.damage`
- Power-up spawn bias: `powerupP = basePowerupP * m.luck`
- SWM: ignore

### Puzzle (e.g. Token Columns, Spore Breaker, Poop Out)
- Drop/fall speed of pieces or ball: `speed = baseSpeed * m.moveSpeed` (faster = harder, so
  consider this *player-friendly* only if speed helps them — for falling-block puzzles,
  prefer mapping SPD to a small soft-drop bonus, not the gravity that pressures them)
- Lives / continues: `lives = baseLives + (m.health > 1.3 ? 1 : 0)` (STA buys a cushion)
- Combo / break power: `breakRadius = baseRadius * m.damage` (e.g. bigger brick-breaker paddle
  or stronger line-clear)
- Bonus-tile / special-piece chance: `specialP = baseSpecialP * m.luck`
- SWM: ignore. **Puzzle wager games (Token Columns, Spore Breaker, Poop Out) use
  `{pvp:true}`** — keep effects tiny.

### Racing (e.g. Micro Baselings, RC Reactor, Spore Tributaries)
- Top speed: `vmax = baseVmax * m.moveSpeed`
- Boost duration / fuel: `boost = baseBoost * m.health`
- Ram / bump force: `ram = baseRam * m.damage`
- Item-box roll bias: weight good items by `m.luck`
- **Water sections** (Spore Tributaries boats, RC water tracks): `waterV = baseWaterV * m.swim`
  — this is the one genre where SWM matters. No water on the track → ignore SWM.
- All three are wager games → `{pvp:true}`.

### RPG (e.g. dungeon crawlers, ToT-flavored arcade RPGs)
- Move/scroll speed: `m.moveSpeed`
- Max HP: `maxHp = round(baseHp * m.health)`
- Attack / spell damage: `dmg = baseDmg * m.damage`
- Loot quality & gold drops: `lootRoll = baseRoll * m.luck`, `gold = baseGold * m.luck`
- SWM: apply to swim/raft segments only
- Single-player → default band. Keep encounters beatable at 0.8× (Wimmple must clear it).

### Brawler / beat-em-up (e.g. Streets of Tasern, Super Dodge)
- Walk/dash speed: `m.moveSpeed`
- Health bar: `maxHp = round(baseHp * m.health)`
- Punch/throw damage & block-break: `dmg = baseDmg * m.damage`, `guardBreak = base * m.damage`
- Health-drop / weapon-drop chance from enemies: `* m.luck`
- SWM: ignore
- Both are wager games → `{pvp:true}` (≤10% edge).

---

## Quick checklist before you ship a game

- [ ] Game pulls multipliers from `BaselingPlayer.getMults()` — not from raw `stats`.
- [ ] Base constants tuned for a neutral 1.0× baseling; fun at 0.8× and not trivial at 1.6×.
- [ ] Every stat effect maps to exactly one of `moveSpeed/health/damage/luck/swim`.
- [ ] No water section → SWM is untouched (don't fake-use it).
- [ ] If the game is in `tasern-wager.js`, `getMults({ pvp: true })` is used everywhere.
- [ ] Stats are shown to the player in the picker / HUD, but their *effect* is clamped.
- [ ] Wimmple (no wallet) can start and finish the game.

---

*Stat formula lives server-side in `api/server.js` (`computeArcadeStats`), ported from
`game/src/gameplay.js` `getRaceStats()`. Multiplier band + `getMults()` live in
`baseling-player.js`. If either changes, update this file in the same change.*
