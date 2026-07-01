# Seize the Seas

A pirate-age **impact game on Base**: squad tactics + hex-world sailing + a real on-chain
player economy. Players start as **poor peasants** and grind up — copper → gear → gold →
pawns → structures → **kingdoms**. It's a long slow climb by design; every prize is
**skill-based, never chance**.

## The three layers

1. **World (map layer)** — hex voyage map, 10 biomes with danger tiers, location graph.
   Presence-gated markets: your pawn must BE somewhere to trade there. Travel takes real time.
2. **Battle (squad tactics)** — 12×9 hex board, up to 4 crew/side, 7 gear slots per pawn,
   D&D 3.5-scaled stat blocks. Fights are **server-verified**; wins pay coin + item loot.
3. **Economy (idle + active)** — jobs/wages (WorkClock), water-vault endowments ($1 = 1 level),
   location-gated LPs (goods as ERC20s), structures (camps → towns), achievement prize ladders
   (Mayor gold / Rogue cbBTC), boats and trade routes. Idle production equips the heroes;
   heroes bring back loot that funds the building.

## Directory map

| Dir | What it is |
|---|---|
| `battle-grid/` | Combat engine: game.js, resolver.js, bestiaries, gear, maps, smoke tests |
| `citizen/` | The bot players: `tools/` (hands, one CLI per action), `lib/` (chain + seas-api), `brain/` (the Claude-driven player brain, charters, journals) |
| `class-engine/` | Pawn class/level resolver (reads water-vault levels) |
| `town/`, `tavern/`, `jobs/`, `store/`, `shipyard/`, `forge/`, `crew/`, `achievements/`, `play/` | Game UI pages (one folder per venue) |
| `audio/` | Music + SFX core |
| `art/` | Title art (sprites live in the main game asset pipeline) |
| `_archive/` | Old `.bak` snapshots — nothing live |

## Key docs

- `AREA-MAP.md` — biomes, danger tiers, encounter tables
- `WORLD-MAP-VISION.md` + `world-terrain.js` — world layout
- `COMBAT-PLAN.md` — battle-grid build plan
- `CAMP-TO-TOWN-MODEL.md` — the settlement/build economy
- `CONTENT-WISHLIST.md` — art + content backlog

## Key data (back-end, hidden from players)

- `loot-master.csv` + `loot-signatures.js` + `roll-charts.js` — what every creature drops
  (core signature good + CR-band secondary tier)
- `commodity-tokens.csv` — all 188 goods-as-ERC20 tokens
- `port-market.csv` — 7 towns, 22 goods, price walls
- `achievements-catalog.json` — the full achievement catalog
- `prize-pools-by-level.csv`, `battles-loot-pools.csv`, `water-tokens.csv` — pool addresses

## The bot players (First Citizen + deckhands)

`citizen/brain/` runs 5 autonomous players daily (Windows Scheduled Task `Seas-Citizen-Daily`
→ `run-citizen-daily.cmd` → `daily.mjs`): the **Citizen** (100 Harbor Guard pawns, Port base)
plus 4 single-pawn deckhands (brawler/worker/fisher/trader). They play by the same rules as
humans — dedicated wallets, capped spends, server-verified fights. They are also QA: the
flaws they hit become the build backlog (`citizen/brain/FLAWS.md`).

On-chain fire keepers (loot payouts, achievement claims, harvests) live in the sibling repo
`mftusd-build/` — founder-gated env flags, never fired from the web layer.

## Safety rails (never break)

- Wallet key envs (`.citizen-wallet.env`, `.deckhands.env`) are git-ignored — never commit keys.
- Exact approvals only, small paced trades, real-or-nothing reporting.
- Coins/prizes: COPPER is the base (100 COPPER = 1 GOLD). Skill-based rewards only.
