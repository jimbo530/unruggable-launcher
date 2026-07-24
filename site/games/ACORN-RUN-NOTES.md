# 🌰 Acorn Run — built overnight 2026-06-15

## What it is
A **16-bit-style run-and-jump RACING platformer** (lush layered-jungle look). Race a friend on the
same map (split-screen), or run solo against the clock. Plus a **level builder** so the
community can make their own courses.

## How to play (test it)
1. In a terminal, from `C:\Users\bigji\Documents\MfT-Launch\site`:
   `npx serve -l 8123`  (or any static server)
2. Open **http://localhost:8123/games/acorn-run.html**
3. Pick **Solo** or **2-Player Race**, click a course.
   - **P1:** Arrow keys + **Up = jump**
   - **P2:** WASD (**W = jump**)
   - **Gamepads** work too (pad 1 = P1, pad 2 = P2)

## What's done ✅
- Playable game: run, jump, race. 5 worlds. Solo time-trial + 2-player split-screen race.
- **5 race courses**: Jungle, Temple Ruins, Crystal Cave, Snow Peak, Mushroom Forest.
- **5 new 16-bit-style backgrounds** made with Grok (original art) — jungle, ruins, cave, snow, mushroom.
- **Platforms fixed**: no more blocky isometric cubes — now rounded, grass/stone/ice/etc. ledges that match each world.
- **Level builder** (`acorn-run-editor.html`): pick a World, paint a course, save/share.
- Added to the Arcade (now 104 games) under **Racing** + **Creative**.

## On copying real classic-console art
You asked if we could screenshot objects from the classic 16-bit jungle platformer. **We
can't** — that art is the original studio's copyright, and using it on the live site is a
real legal risk. So I made **original art in the same style** instead (a *style* is free to
use). You get the look, zero risk.

## Not done yet (your call)
- **Live deploy**: it's READY but I did NOT push to tasern.quest — wanted your eyes on the art first. Say "ship it" and it goes live.
- **Richer platforms**: I can make Grok platform *sprites* per world for even fancier ledges (right now they're nice rounded procedural ledges).
- **Online racing** (vs friends over the internet): bigger job; right now racing is same-screen local.
- **Props**: vines, statues, crystals as scenery.

Art staging folder: `D:\grok-sprites\acorn\<world>\`

---

## 🎨 Art drop — round 2 (overnight, ~39 Grok sprites)
All original Grok pixel-art (NOT ripped). Raw files on `D:\grok-sprites\acorn\` (+ `INVENTORY.md`).
- **Acorn Boy** + **Acorn Girl**: idle / run / jump frames each (real game sprites — replaces the painterly webp for in-game use).
- **World ledges** (jungle/ruins/cave/snow/mushroom): real Grok platform art (you wanted Grok platforms, not my procedural ones).
- **Smashables**: clay pot (intact→cracked→shattered), tiki statue (intact→cracked→crumbling→rubble), barrels, crates, treasure chest.
- **Interactive/world**: boost pad (spring), collectible golden acorn, beetle + wasp enemies, spikes, mine cart, checkpoint flag, vine, crystal, big mushroom, log, rock.
- An agent is **cutting them transparent + wiring the characters + props into the game**. I'll verify it in-browser and report. Backgrounds are already live in-game.

---

## 🏞️ Visual upgrade — smooth rolling terrain + layered parallax (2026-07-02)
Terrain/background/polish pass in `acorn-run.html` (level JSON format UNCHANGED — the
editor and all saved courses still work as-is):
- **Smooth ground**: connected ground masses now render as one organic shape — curved
  top steps (quadratic corners), a grass/moss lip that hugs the curve, rounded free ends,
  earthy gradient body that darkens with depth, baked soft drop shadow. Thin floating
  platforms keep the themed ledge art. Collision is still the exact tile grid.
- **Parallax depth**: painted far backdrop + 2 new silhouette ridge layers (hazy far
  canopy at 0.42x scroll, darker near ridge at 0.68x) with aerial-perspective fade,
  plus the existing near-foreground vines — 4 depth layers total. Fallback sky is a
  3-stop gradient with a sun glow.
- **Soft shadows**: elliptical shadows under enemies, coins, props, and springs; the
  player's contact shadow now projects down to the actual ground and shrinks/fades
  with jump height.
- **Performance**: ground masses pre-render once into offscreen 512px chunk canvases;
  silhouette layers pre-render once per theme into tileable strips. Per frame the new
  work is only a handful of drawImage calls, so 60fps holds.

