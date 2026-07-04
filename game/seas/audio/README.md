# Seize the Seas — Audio System

Client-side, browser-only, additive. No on-chain, no server, no build step.
Generated SFX cost **$0** (code only). Music is just **bandwidth** — small `.ogg`
files, cached after first load. No per-play or licensing cost when you use your
own Suno tracks + public-domain shanties.

## Files

| File | Role |
|---|---|
| `audio-core.js` | ONE shared `AudioContext` + master/music/SFX gain buses. Global mute + per-bus volume, persisted to `localStorage`. Handles the autoplay block via `unlock()` / `onFirstGesture()`. Graceful no-op if Web Audio is missing. Exposes `window.SeasAudio`. |
| `music-manager.js` | Per-scene looping music with crossfade on scene change. Rotates multiple tracks per scene. Data-driven from the manifest. Exposes `window.SeasMusic`. |
| `sfx.js` | Web-Audio-**synthesized** effects (coin, hit, splash, ui-click, error, win, cannon) + optional file SFX. Exposes `window.SeasSfx`. |
| `audio-settings.js` | Settings API + drop-in HTML control (mute + sliders) **and** `SeasAudioSystem.boot()` — the one-line integration. |
| `audio-manifest.json` | scene → track filename(s). Add a line, drop a file, it plays. |
| `music/` | Drop `.ogg`/`.mp3` here (see `music/README.md`). |
| `demo.html` | Standalone proof it works. Serve over http:// and open. |
| `audio.selftest.cjs` | DOM-less logic tests. `node audio.selftest.cjs` → 14 pass. |

## One-line integration

Add these four scripts (order matters — core first) then boot:

```html
<script src="audio/audio-core.js"></script>
<script src="audio/music-manager.js"></script>
<script src="audio/sfx.js"></script>
<script src="audio/audio-settings.js"></script>
<script>
  SeasAudioSystem.boot({ manifestUrl: 'audio/audio-manifest.json' })
    .then(function (sys) { window.Seas = sys; });
</script>
```

`window.Seas` then gives you: `Seas.setScene('sea')`, `Seas.playSfx('coin')`,
`Seas.unlock()`, `Seas.mountSettings('some-container-id')`.

> Paths are relative to the page. Sub-pages (e.g. `battle-grid/`, `play/`) use
> `../audio/...` and `manifestUrl: '../audio/audio-manifest.json'`.

## Autoplay (the important bit)

Browsers won't play audio until the user interacts. `audio-core.js` auto-binds a
one-shot document listener (`attachAutoUnlock`) so the **first tap anywhere**
resumes the context. To also *start the title music* on that first gesture:

```js
Seas.core.onFirstGesture(function () { Seas.setScene('title'); });
```

Everything before unlock is queued, not lost — `setScene()` remembers the target
and starts it the instant audio unlocks.

## Settings panel

Drop the control into any settings area:

```js
Seas.mountSettings('my-settings-container');   // by element id
// or: var el = Seas.buildSettings(); myPanel.appendChild(el);
```

Minimal HTML markup it produces (style to taste; class hooks provided):

```html
<div class="sts-audio-settings">
  <div class="sts-audio-row"><label class="sts-audio-mute"><input type="checkbox"> Mute all</label></div>
  <div class="sts-audio-row"><label>Music   <input type="range" min="0" max="1" step="0.01"></label></div>
  <div class="sts-audio-row"><label>Effects <input type="range" min="0" max="1" step="0.01"></label></div>
</div>
```

It reflects and drives the global state; a mute here silences music, SFX, and the
achievement chime (once the chime is routed through the bus — see below).

---

## Client integration plan (for the Coordinator to apply on the live client)

`game/seas/index.html` and `battle-grid/game.js` are large shared files, so this
is a **DRY patch plan**, not an applied edit. `demo.html` already proves the
system standalone. Each hook is one line.

### A. Title screen — `game/seas/index.html`

1. **Add the four `<script>` tags + boot block** just before the existing
   `</script></body>`. Use `audio/...` paths (title screen is at seas root).
2. In the existing `#title` click handler (the "TAP ANYWHERE → begin" block),
   add **one line at the top** so the first tap unlocks + starts title music:
   ```js
   if (window.Seas) { Seas.unlock(); Seas.setScene('title'); }
   ```
   (Leave the existing `go(GET_CHARACTER)` navigation exactly as-is.)
3. On the connect button and door links, optional UI click:
   `Seas.playSfx('ui-click')`.
4. Respect the page's existing `@media (prefers-reduced-motion: reduce)` — audio
   is separate from motion, so no change needed, but the mute default honors the
   user's saved pref.

### B. Scene swaps (per sub-page — one line in each page's init)

Each page already knows what it is; add a single `setScene` on load **after boot**:

| Page | Call |
|---|---|
| `map.html` (world map / sailing) | `Seas.setScene('sea')` |
| `battle-grid/` (combat) | `Seas.setScene('combat')` |
| `town/`, `store/`, `jobs/` | `Seas.setScene('town')` |
| `tavern/` | `Seas.setScene('tavern')` |
| `crew/`, `play/`, `index.html` | `Seas.setScene('menu')` |
| victory/results screen | `Seas.setScene('victory')` |

Because pages are separate documents, each loads the scripts and boots. The
`localStorage` prefs (mute/volume) carry across pages automatically. Music
restarts per page load — expected for a multi-page site (no SPA router here).

### C. Combat SFX — `battle-grid/game.js`

At the points where the game already applies damage / awards / clicks, add:

| Event | Call |
|---|---|
| melee/ranged hit lands | `window.Seas && Seas.playSfx('hit')` |
| cannon / ranged boom | `Seas.playSfx('cannon')` |
| miss into water / splash | `Seas.playSfx('splash')` |
| coin / loot / reward gained | `Seas.playSfx('coin')` |
| button / tile tap | `Seas.playSfx('ui-click')` |
| fight won | `Seas.playSfx('win')` |
| invalid action | `Seas.playSfx('error')` |

Grep targets in `game.js` for the reviewer: search for the existing HP-change,
reward, and `addEventListener('click'` sites (78 event/damage sites found) and
attach the matching one-liner. Guard every call with `window.Seas &&` so a page
that hasn't booted audio never errors.

### D. Verification

- `node game/seas/audio/audio.selftest.cjs` → **14 tests pass**.
- Serve and open the demo: `npx serve -l 8888` then
  `/game/seas/audio/demo.html` — SFX buttons make sound immediately (no files),
  scene buttons crossfade once tracks are dropped into `music/`.

---

## Achievement chime plug-in note

`game/seas/achievement-chime.js` (owned by another agent — **do not edit**) is a
self-contained ESM module. As written it creates its **own** `AudioContext` and
connects to `ctx.destination`, so it will play **regardless of the master mute**.

Two clean options for the Coordinator (no edit to this audio system required):

- **Simplest (respect gesture only):** call `primeAudio()` from the first tap
  alongside `Seas.unlock()`, then on an unlock event call
  `playAchievementChime(evt.tier)`. The chime plays, but bypasses master volume/mute.
- **Route through the master bus (recommended, honors global mute):** add a tiny
  optional hook to the chime's `audioContext()` so, if `window.SeasAudio` exists,
  it reuses `SeasAudio.getContext()` and connects to `SeasAudio.getSfxBus()`
  instead of `ctx.destination`. That is a ~3-line change **inside the chime file**
  and is the chime owner's call — this system already exposes exactly the two
  methods needed (`getContext()`, `getSfxBus()`) for that to be a drop-in.

Recommended wording for the chime owner:
> `SeasAudio.getContext()` returns the shared `AudioContext`; connect your final
> gain to `SeasAudio.getSfxBus()` instead of `ctx.destination` and your chime
> obeys the global mute + effects slider automatically.

---

## Public-domain sea shanties (source or Suno-generate)

All traditional / public domain — safe to generate or record fresh:

- **Drunken Sailor**
- **Blow the Man Down**
- **Leave Her, Johnny**
- **Haul Away Joe**
- **Spanish Ladies**
- **Santiana** (Santianna)
- **Roll the Old Chariot Along**
- **South Australia**
- **Fire Down Below**
- **The Wellerman** (traditional NZ whaling song)

**How to add a track:** make/get a short (30–90 s) seamless loop, export `.ogg`
(~96 kbps) + a matching `.mp3`, drop both into `music/`, add one line to
`audio-manifest.json` under the scene. That's it — see `music/README.md`.

> The *tune/lyrics* are public domain; a specific modern *recording/arrangement*
> may still be copyrighted. Generate your own (Suno) or record fresh to stay clean.
