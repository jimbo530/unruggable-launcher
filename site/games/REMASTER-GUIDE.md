# REMASTER-GUIDE — wiring baselings into an arcade game

A mechanical recipe to remaster one MfT Arcade game to the Base + Baseling standard in
~30–60 minutes. Follow it top to bottom. Read **ARCADE-STATS.md** first — it owns the
stat math; this guide is the plumbing.

The three reference remasters are `poop-powers.html`, `reactor-jump.html`, and
`tunnel-bug.html`. When in doubt, open the closest one and copy its pattern.

What "remastered" means (the checklist you're satisfying):
1. Loads `baseling-sprites.js` **and** `baseling-player.js`.
2. Title/start screen has a **character select** showing the player's baselings with their
   5 stat bars, openable with **C** (and a touch button on mobile if the game has one).
3. The **player avatar is the selected baseling sprite**, animated (idle/walk/jump/etc).
4. Stats are wired **only** through `getMults()` (see ARCADE-STATS.md) — never raw stats.
5. **Base-blue (#0052FF) accents** added, game's own readability preserved.
6. `NftLoader.gate()`, wager hooks, touch controls, and audio are **untouched**.
7. Plays fine with **no wallet** (Wimmple, all stats 10).

---

## Step 0 — Identify which engine the game uses (2 archetypes)

Grep the file for `tasern-engine.js`:

- **Archetype A — TAS-engine game** (≈81 of the games; e.g. poop-powers, reactor-jump). It
  has `<script src="tasern-engine.js">` and a `TAS` global. **Use the `TAS.player.*`
  bridge** — least code.
- **Archetype B — bespoke-engine game** (≈22; e.g. tunnel-bug, baseling-boxing, spore-breaker). No
  `tasern-engine.js`, its own input/audio/loop. **Call `BaselingPlayer` / `BaselingSprites`
  directly** via a tiny local helper. Do **not** add `tasern-engine.js` to a Type B game —
  it would spin up a second canvas/loop and conflict.

> Type B trap (this bit tunnel-bug): some Type B games contain a stray
> `TAS.drawBaseling(...)` call and/or a `frame` reference copied from a template, but never
> load the engine or define `frame`. That throws on the first draw. If you see `TAS.` in a
> Type B game, replace it per Step 3B and make sure a `frame` counter exists (Step 2B).

Also check **`tasern-wager.js`**: if the game's id is in `WAGER_GAMES`, it's a **wager
game** → you must call `getMults({ pvp: true })` everywhere (Step 4). Current wager games:
`baseling-boxing, micro-baselings, token-columns, super-dodge, baseling-grind, frost-poppers,
streets-of-tasern, spore-breaker, rc-reactor, spore-tributaries`.

Some "games" are non-action (chess, checkers, dice-roller, ttrpg-notepad, whodunit). They
have no player avatar — for those, do Steps 1 and (optionally) a cosmetic palette pass;
skip the avatar/stat steps.

---

## Step 1 — Add the script tag (BOTH archetypes)

Find the existing `<script src="baseling-sprites.js"></script>` and add `baseling-player.js`
immediately after it, **before** the `NftLoader.gate()` line and before the game script:

```html
<script src="nft-loader.js"></script>
<script src="baseling-sprites.js"></script>
<script src="baseling-player.js"></script>      <!-- ADD THIS -->
<script src="tasern-theme.js"></script>
<script>if(window.NftLoader)NftLoader.gate();</script>
```

Order matters: `baseling-player.js` depends on `baseling-sprites.js`. The gate stays as-is.

---

## Step 2 — Boot the player module + a stat recompute hook

Near the top of the game script, after the game's other constants:

### 2A — TAS-engine game
```js
var picking = false; // character-select overlay open
if (window.TAS && TAS.player) {
  TAS.player.init().then(function () { recomputeStats(); })
    .catch(function (e) { console.warn('[<game>] player init failed:', e && e.message); });
}
```

### 2B — Bespoke-engine game
```js
var picking = false;
var frame = 0; // animation clock — MUST exist; increment it once per loop tick (Step 6B)
if (window.BaselingPlayer && BaselingPlayer.init) {
  BaselingPlayer.init().then(function () { recomputeStats(); })
    .catch(function (e) { console.warn('[<game>] player init failed:', e && e.message); });
}
```

`init()` is silent — it detects an already-connected wallet via `eth_accounts` and never
pops a wallet dialog, so it can't block the title screen. `recomputeStats()` you write in
Step 4. (If the game already increments a `frame`/`tick` global each loop, reuse it instead
of adding one.)

---

## Step 3 — Draw the player avatar as the selected baseling

The pattern everywhere: try to draw the baseling; if it returns false (sprite not loaded,
or the Wimmple default has no art), fall through to the game's **existing** procedural
drawing. Never delete the fallback — it's what keeps the game playable with no wallet.

Pick an **animation** from player state. Available anims: `idle`, `walk`, `jump`,
`attack`, `hurt`, `ko`. Typical mapping:
```js
var anim = 'idle';
if (playerIsHurt)        anim = 'hurt';   // i-frames / damage flash
else if (playerIsDead)   anim = 'ko';
else if (playerAirborne) anim = 'jump';
else if (playerAttacking)anim = 'attack'; // shooting / digging / punching
else if (playerMoving)   anim = 'walk';
```

### 3A — TAS-engine game
`TAS.drawBaseling` already routes to the picked baseling. Just pass `anim`:
```js
if (!TAS.drawBaseling(ctx, cx, cy, size, { flipX: facingLeft, frame: frame, anim: anim })) {
  /* existing procedural player drawing stays here */
}
```
If the game already does `ctx.scale(-1,1)` for facing, keep `flipX:false` (don't double-flip).

### 3B — Bespoke-engine game
Add this helper once (near Step 2B), then call it where the player is drawn:
```js
function drawSelectedBaseling(c, x, y, size, opts) {
  if (!window.BaselingPlayer || !window.BaselingSprites) return false;
  var sel = BaselingPlayer.getSelected();
  if (!sel || !sel.charId) return false;
  if (!BaselingSprites.isLoaded(sel.charId)) {
    if (!BaselingSprites.hasFailed(sel.charId)) BaselingSprites.load(sel.charId, sel.colorVariant);
    return false;
  }
  return BaselingSprites.draw(c, sel.charId, sel.colorVariant, sel.sparkle, x, y, size, opts || {});
}
// ...in the player draw:
if (!drawSelectedBaseling(ctx, cx, cy, size, { flipX: facingLeft, frame: frame, anim: anim })) {
  /* existing procedural player drawing stays here */
}
```
Replace any stray `TAS.drawBaseling(...)` in a Type B game with `drawSelectedBaseling(...)`.

---

## Step 4 — Wire stats through getMults() (the only stat math)

ARCADE-STATS.md is law here. One source: `getMults()` →
`{ moveSpeed, health, damage, luck, swim }`, already clamped. Wire each to exactly one
mechanic: `moveSpeed`→movement/scroll/jump-distance, `health`→HP/lives/timer,
`damage`→damage/knockback, `luck`→drop/crit, `swim`→water sections only.

Write a `recomputeStats()` that reads the mults and (re)assigns the game's tuned constants.
Make the constants reassignable (declare with `var`, assign inside the function) so a
title-screen character change takes effect. Call `recomputeStats()` once at boot and again
after every pick.

```js
function recomputeStats() {
  // Type A: var m = TAS.player.mults();
  // Type B: var m = (window.BaselingPlayer && BaselingPlayer.getMults) ? BaselingPlayer.getMults() : {moveSpeed:1,health:1,damage:1,luck:1,swim:1};
  var m = TAS.player.mults();                 // add { pvp:true } for WAGER games (see below)
  PLAYER_SPEED = BASE_PLAYER_SPEED * m.moveSpeed;
  MAX_HP       = Math.round(BASE_MAX_HP * m.health);
  SHOT_DAMAGE  = BASE_SHOT_DAMAGE * m.damage;
  DROP_CHANCE  = BASE_DROP_CHANCE * m.luck;
  // Water sections only: SWIM_SPEED = BASE_SWIM_SPEED * m.swim;  else don't touch swim.
}
```

Rules that bite if ignored:
- **Tune the base for the neutral 1.0× case.** A game must be fun at 0.8× (Wimmple) and not
  trivial at 1.6×. If it's only fun at one end, fix the base, not the multiplier.
- **Cap physics-derived values.** Jump height, projectile count, max fall speed — clamp so
  1.6× can't clip through level geometry. reactor-jump caps jump at 1.25×; copy that.
- **Damage taken scales DOWN with survivability:** `hp -= base / m.health`.
- **Don't invent a sixth stat.** Map "score multiplier", "cooldown", etc. to the nearest of
  the five, or leave them at 1.0. Score is not a stat in this system.

### WAGER games — `{ pvp: true }`
If the game is in `WAGER_GAMES`, every `getMults()`/`TAS.player.mults()` call gets
`{ pvp: true }` (clamp tightens to 0.95–1.10). This is a fairness requirement, not a style
choice — wagers must be skill, not who fed their pet more. Show stats in the UI either way.

### Games using an older D&D-mod stat model
Some games (reactor-jump did) read `statB.str/dex/...` or `STR_MOD/DEX_MOD/...`. Don't keep
that model. Either (a) rewrite the constants to read `m.*` directly (preferred — see
reactor-jump), or (b) if there are many `getX()` helpers reading `statB.str`, synthesize the
D&D fields from mults inside `recomputeStats()` so the helpers keep working (see tunnel-bug):
```js
function dnd(x){ return Math.round(10 + (x - 1) * 20); } // mult 1.0->10, 0.8->6, 1.6->22
statB.str = dnd(m.damage); statB.dex = dnd(m.moveSpeed); statB.con = dnd(m.health);
statB.int = dnd(m.luck);   statB.wis = dnd(m.luck);      statB.cha = dnd(m.luck);
statB.speed = m.moveSpeed; statB.damage = m.damage; statB.luck = m.luck; statB.hpMult = m.health;
```
Either way, the gameplay-affecting number traces back to a clamped `getMults()` value.

---

## Step 5 — Character select on the title screen

### Open the picker
In the title's input handler, add a **C** key (and the touch `c` button if the game's
controls have one) that opens the picker, guarded by `picking`. After a pick, recompute:

```js
// in the title-state key/touch handling, BEFORE the "any key starts the game" check:
if (picking) return;                 // overlay open — swallow game input
if (keys['KeyC'] || touch.c) {
  keys['KeyC'] = false;              // consume so it doesn't also start the game
  picking = true;
  // Type A: TAS.player.select(...)   Type B: BaselingPlayer.select(...)
  TAS.player.select(function () { recomputeStats(); picking = false; });
  return;
}
```
For a TAS game that wants a mobile button, init touch with a `c` button:
`TAS.input.initTouch({ buttons:['a','b','c'], labels:{ a:'JUMP', b:'FIRE', c:'PICK' } });`

### Draw the picker affordance + preview on the title
Replace the title's hardcoded character art with the selected baseling, and draw its name +
5 stat bars + a Base-blue prompt:

```js
// Selected baseling preview (idle bob) — falls back to the title's old art if no sprite.
if (!TAS.drawBaseling(ctx, GW/2, previewY, 40, { anim:'idle', frame:frame })) { /* old art */ }

var sel = window.BaselingPlayer && BaselingPlayer.getSelected();
ctx.fillStyle = '#0052FF'; ctx.textAlign = 'center'; ctx.font = 'bold 10px monospace';
ctx.fillText((sel ? sel.charName : 'WIMMPLE') + (sel && sel.tokenId!=null ? ' #'+sel.tokenId : ''), GW/2, nameY);

// 5 stat bars in their canonical colors
if (sel && sel.stats && window.BaselingPlayer) {
  var meta = BaselingPlayer.STAT_META, keys = BaselingPlayer.STAT_KEYS, x0 = GW/2 - 110;
  ctx.font = '8px monospace';
  for (var i=0;i<keys.length;i++){
    var mm = meta[keys[i]], v = sel.stats[keys[i]], bx = x0 + i*46;
    ctx.fillStyle = mm.color; ctx.textAlign='left'; ctx.fillText(mm.label, bx, barY);
    ctx.fillStyle = '#222'; ctx.fillRect(bx, barY+3, 38, 5);
    ctx.fillStyle = mm.color; ctx.fillRect(bx, barY+3, 38*Math.max(0.04,Math.min(1, v/200)), 5);
  }
  ctx.textAlign='center';
}

ctx.fillStyle = '#0052FF'; ctx.font = 'bold 9px monospace';
ctx.fillText('[C] SELECT BASELING', GW/2, promptY);
```

Stat colors are fixed (also on `BaselingPlayer.STAT_META`): **SPD `#fbbf24`, STA `#4ade80`,
PWR `#ef4444`, LCK `#c084fc`, SWM `#60a5fa`**. Bar fill = `stat / 200`.

The picker overlay itself (cards, sprites, click handling, localStorage) is fully built in
`baseling-player.js` — you only open it and read `getSelected()`.

---

## Step 6 — Animation clock

The sprite animation needs a frame counter passed as `opts.frame`.
- **6A (TAS game):** `frame` already exists (the loop increments it). Use it.
- **6B (bespoke game):** ensure a `var frame = 0;` exists (Step 2B) and increment it once at
  the top of the game loop: `frame++;`. Reuse an existing per-loop counter if there is one.

---

## Step 7 — Base-blue palette pass

Light touch — accents only, don't repaint the game. Use `#0052FF` (Base blue) for the
character name, the `[C] SELECT BASELING` prompt, and 1–2 UI accents (a HUD underline, a
title glow). Keep Tasern palette (#38d973 green, #a855f7 purple, #f4b41b gold, #7a444a poop)
where the game already uses it. Readability first: don't put blue text on a blue background;
keep contrast.

---

## Step 8 — Test (required before marking done)

Serve the folder over http (canvas + modules need http, not `file://`):
```
npx serve -l 8123 C:\Users\bigji\Documents\MfT-Launch\site\games
```
Open the game, and:
1. Open DevTools console. **Zero errors.** (A `[baseling-sprites] failed to load image for
   wimmple … will not retry` warning is expected and harmless — Wimmple has no art yet. It
   must appear at most once, not every frame.)
2. Title shows the selected baseling (or the procedural fallback for Wimmple) + 5 stat bars
   + the `[C] SELECT BASELING` prompt.
3. Press **C** → picker opens with cards; pick one → overlay closes, title updates.
4. Start the game. The avatar is the selected baseling, animating as it moves/jumps/etc.
5. Play ~10 seconds, exercising movement/attack/damage. Still zero console errors.
6. With no wallet it still starts and is playable as Wimmple.

Headless option (what the flagships were verified with): load the page in puppeteer, remove
`#nft-gate`, drive keys, and assert no `window.onerror` fired and `BaselingPlayer.getMults()`
returns an object. See `qa-arcade.js` if present.

---

## Do-not-break list

- `NftLoader.gate()` — leave the call and the overlay exactly as-is. It's the NFT wall and
  is separate from character select.
- Wager hooks (`tasern-wager.js` integration) — don't remove; and switch those games to
  `getMults({ pvp:true })`.
- Touch controls, the game's audio engine, save/highscore, level data — untouched.
- The procedural player-drawing fallback — keep it; it's the no-wallet path.
- Don't read or scale by raw `entry.stats`; don't recompute stats from `tokenFeeds`; don't
  add a sixth stat. (ARCADE-STATS.md, the two fairness rules.)
- Type B games: don't add `tasern-engine.js`.

---

## Quick reference — the API you call

```js
// Boot (silent, no popup). Resolves to BaselingPlayer or null.
BaselingPlayer.init(opts)                 // TAS: TAS.player.init(opts)
// Open the picker overlay. cb(entry) on pick.
BaselingPlayer.select(cb)                 // TAS: TAS.player.select(cb)
// Bounded multipliers {moveSpeed,health,damage,luck,swim}. {pvp:true} for wager games.
BaselingPlayer.getMults(opts)             // TAS: TAS.player.mults(opts)
// Currently selected entry (or Wimmple default).
BaselingPlayer.getSelected()              // -> { charId, charName, tokenId, colorVariant, sparkle, stats, rarity, stage, ... }
// Raw served stats (1-200) for display.  Picker UI metadata.
BaselingPlayer.getStats()                 //    BaselingPlayer.STAT_META / .STAT_KEYS
// Draw the selected baseling (returns false if not ready -> use fallback).
TAS.drawBaseling(ctx, x, y, size, opts)   // Type B: the drawSelectedBaseling() helper above
// Sprite renderer (used under the hood; for Type B fallback helper).
BaselingSprites.isLoaded(id) / .hasFailed(id) / .load(id, variant) / .draw(ctx, id, variant, sparkle, x, y, size, opts)
//   draw/ frame opts: { anim:'idle|walk|jump|attack|hurt|ko', frame, flipX, alpha }
```
