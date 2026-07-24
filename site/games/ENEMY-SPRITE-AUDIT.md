# Arcade Enemy-Sprite Audit — updated 2026-07-02

**Question:** are all enemies replaced with our own sprites?
**Answer:** Mostly yes now. **Player** sprites are themed everywhere (via `baseling-player.js`). **Enemies** in **46 games** now render from our own sprite library as **transparent cut-outs**, with the original procedural drawing kept as a load-race fallback. What remains geometric is blocked on art we don't own yet (mechs, ships, vehicles, critters, fighter rosters — see gaps below), not on wiring.

## Sprite assets (current state)
- `art/enemies/enemy-<name>.png` (13, transparent cut-outs) — bog-wight, goblin, myconid, root-witch, rot-walker, shroom-knight, skeleton, slime-mold, spriggan, troll, will-o-wisp, wolf, wyrm. 10 copied from the `art/toads/` cut-out set; root-witch/skeleton/wolf generated from the JPGs (flood-fill knockout).
- `art/enemies/enemy-<name>.jpg` (13, dark-background originals) — kept; `tasern-art.js` transparently redirects enemy `.jpg` requests to the `.png` with automatic `.jpg` fallback on error. Background "washes" (30%-alpha game-over/title tints) verified fine with the PNGs.
- `art/sea/`: enemy-beetle.png, enemy-snake.png, scarab-walk1/2.png (already transparent).

## Wired games (46) — enemies are OUR sprites, verified zero console errors + gameplay screenshots in qa-shots/
acorn-run, baseling-bounce, baseling-rescue, boulder-baseling, bubble-baseling, chain-reaction, dark-spore, double-baseling, downtown-baselings, frost-spore, fungal-fury, fungi-quest, golden-spore, hex-ninja, iron-maw, legend-of-tasern, little-baseling, pirates-of-tasern, poop-chomp, reactor-jump, rodeo-toad, shadow-baseling, shadow-ninja, spore-crystal, spore-grove, spore-icarus, spore-jumpers, spore-key, spore-knight, spore-mansion, spore-maze, spore-n-ice, spore-realm, spore-samson, spore-serpent, spore-sphere, spore-tales, spore-tower, spore-tropics, sporegoyle-quest, sporeouria, streets-of-tasern, swamp-hop, tasern-quest, toads-of-tasern, tunnel-bug

Pattern used everywhere (see hex-ninja/iron-maw as canon): sprite table + `complete && naturalWidth` guard, flipX via `translate + scale(-1,1)`, bottom-anchored aspect-preserved draw, telegraphs/HP bars redrawn ON TOP, geometric drawing kept as fallback. Type B games (tunnel-bug etc.) wire inside their own loop — no tasern-engine.

- **Partial / MIXED:** cross-the-docks (vehicles use sea art; wisp/cloud geometric), powder-keg (blob uses scarab; balloon/boss geometric)
- **No enemies (nothing needed):** 15 — baseling-bowl, baseling-olympics, baseling-sluggers, bilge-stacks, checkers, chess, lagoon-memory, poop-drop, reactor-pipes, spore-march, spore-racer, tasern-pinball, tide-pools, token-columns, whodunit
- **Still geometric (blocked on new art, not wiring):** the shmups/mech games, vehicle games, fighter games, and specific types inside wired games listed under gaps below.

## Canonical creature mapping (for future games)
- generic spore grunt/creeper → **myconid**; slime/ooze → **slime-mold**
- floating/ghost/maze-chaser → **will-o-wisp**; armored knight → **shroom-knight**
- brute/golem/titan → **troll**; mage/witch/gorgon → **root-witch**
- skeleton → **skeleton**; kobold/thug/humanoid brawler → **goblin**
- zombie/wraith/shadow → **rot-walker** / **bog-wight**
- serpent/worm/kraken/drake boss → **wyrm**; winter critter → **wolf**; plant/vine → **spriggan**
- crab/beetle → **art/sea/enemy-beetle** or **scarab-walk**; snake/eel → **art/sea/enemy-snake**

## NEW sprites we DON'T have (real gaps to draw/commission)

### Bosses (large) — one reusable set (~5–6) covers ~30 games
**spore-lord/queen**, **mushroom titan**, **reactor-core / mech boss**, **crystal titan**, **hive / mothership**, **horned demon / gargoyle**. (wyrm/troll/root-witch currently double as bosses at larger scale.)

### Sci-fi / shmup / mech (fantasy roster doesn't fit)
enemy-fighter ship, enemy-drone, enemy-cruiser/mothership, spore-turret, compost-tank, reactor-bug, reactor-balloon
→ needed by: baseling-horizon, baseling-sky-patrol, metal-spore, reactor-force, spore-force, spore-swarm, spore-attack, powder-keg; also unlocks types left geometric in wired games (robot/clockwork in shadow-baseling, reactor turret/core in spore-sphere & reactor-jump & baseling-bounce, mech in golden-spore, reactor_spark in spore-key, robot/drone in spore-tales, reactor_harpy in spore-icarus)

### Ships & vehicles & riders
top-down enemy pirate-ship (pirates-of-tasern's ships are still vector), sea-monster/kraken (wyrm partial), enemy motorcyclist/biker, enemy chopper/attack-vehicle
→ needed by: pirates-of-tasern, spore-trader, spore-nation, reactor-rash, spore-hunter

### Fighting-game rosters (side/front view — our art is 3/4 portrait, won't fit)
fighter roster (meme-city), boxer roster (baseling-boxing)

### Cute-animal warrior set
bunny, bear, puppy, deer, fox units + soldier grunts
→ needed by: garden-wars (tactics units), garden-guerrilla

### Small critters / vermin (no existing asset)
rat/vermin, gator, fly/insect, spore-bat/moth, spore-slug, toad
→ needed by: tiny-baselings, blaster-baseling, baseling-island, blocks-burg; also bats left geometric in sporegoyle-quest/spore-icarus/spore-tales/spore-tropics/spore-serpent, poison_toad in spore-samson, gator stand-in (wyrm) in swamp-hop

### Unique one-offs
Dr. Sporax mad-scientist antagonist (spore-mansion); maze-pursuer boss variant (poop-powers, poop-chomp, treasure-grab, spore-maze — base pursuer reuses will-o-wisp)

## Next steps
1. **Draw the boss set** (~6 sprites) — biggest remaining unlock, ~30 games.
2. **Sci-fi/mech set** — unlocks the shmups plus the machine types left geometric in wired games.
3. **Critter set, ships/vehicles, fighter rosters, animal warriors, Dr. Sporax** as art lands.
