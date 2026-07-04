# Music drop-in folder — Seize the Seas

Drop your background-music files **here** and they "just play." No code changes.

## How to add a track (30-second workflow)

1. **Make or get the file.** Suno-generated loop, or a public-domain sea shanty.
2. **Export it small + looped.** Prefer `.ogg` (Vorbis, ~96–128 kbps, mono is fine
   for shanties) with an `.mp3` of the same name as fallback. Trim so the end
   meets the start cleanly — the player sets `loop = true`, so a seamless loop
   just repeats forever with no gap.
3. **Copy both files into this folder** (`game/seas/audio/music/`).
4. **Add one line** to `../audio-manifest.json` under the right scene, e.g.:
   ```json
   "sea": [
     { "ogg": "spanish-ladies.ogg", "mp3": "spanish-ladies.mp3" },
     { "ogg": "my-new-shanty.ogg",  "mp3": "my-new-shanty.mp3" }
   ]
   ```
   A scene with more than one track **rotates** — each time the player enters
   that scene it plays the next track in the list.
5. Reload. Done.

## Scenes the game uses

`title`, `menu`, `sea` (sailing), `combat`, `town`, `tavern`, `victory`, and a
`default` used when a scene has no track of its own.

## File-size guidance

- Keep loops **short** (30–90 s) — they repeat, so length costs bandwidth, not fun.
- `.ogg` at 96 kbps ≈ **~0.7 MB/min**. A dozen loops is a couple of MB total,
  **cached after first load**. No per-play or licensing cost for your own Suno
  tracks + public-domain shanties.

## Public-domain shanties to source or Suno-generate

All traditional / public domain — safe to record, remix, or generate:

- **Drunken Sailor** (What Shall We Do with the Drunken Sailor)
- **Blow the Man Down**
- **Leave Her, Johnny** (Leave Her Johnny, Leave Her)
- **Haul Away Joe**
- **Spanish Ladies**
- **Santiana** (Santianna)
- **Roll the Old Chariot Along**
- **The Wellerman** (traditional NZ whaling song — public domain)
- **South Australia**
- **Fire Down Below**

> Note: use PD *melodies/lyrics*. A specific modern *recording* or *arrangement*
> can still be copyrighted — generate your own with Suno or record fresh to stay clean.
