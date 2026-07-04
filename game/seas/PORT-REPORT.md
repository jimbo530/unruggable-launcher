# Port Report — Seize the Seas town markets

_Generated from deploy/port-keyed-pools-deployed.json. Re-run `node deploy/generate-port-report.cjs` to refresh. Spreadsheet: `port-market.csv`._

## Overview
- **94 market entries** across **7 towns**.
- Goods kinds: food, weapon, gem. Coins: copper · silver · gold.
- Each entry = a location-keyed LocationPool (presence-gated swap, 0.01% fee). Price = coins per good.

## Towns

### Beacon Isle  
_12 goods · location id 14005_

| Good | Kind | Price | Coin |
|---|---|---|---|
| salt | food | 1 | copper |
| honey | food | 1 | silver |
| rations | food | 5 | silver |
| apple | food | 1 | gold |
| cinnamon | food | 1 | gold |
| cod | food | 5 | gold |
| jerky | food | 7 | gold |
| ale | food | 8 | gold |
| pepper | food | 30 | gold |
| wine | food | 40 | gold |
| saffron | food | 65 | gold |
| longsword-iron | weapon | 15 | gold |

### Bonewater Atoll  
_12 goods · location id 2006_

| Good | Kind | Price | Coin |
|---|---|---|---|
| salt | food | 1 | copper |
| honey | food | 1 | silver |
| rations | food | 5 | silver |
| apple | food | 1 | gold |
| cinnamon | food | 1 | gold |
| cod | food | 5 | gold |
| jerky | food | 7 | gold |
| ale | food | 8 | gold |
| pepper | food | 30 | gold |
| wine | food | 40 | gold |
| saffron | food | 65 | gold |
| warhammer-iron | weapon | 12 | gold |

### Kraken Deep  
_12 goods · location id 5009_

| Good | Kind | Price | Coin |
|---|---|---|---|
| salt | food | 1 | copper |
| honey | food | 1 | silver |
| rations | food | 5 | silver |
| apple | food | 1 | gold |
| cinnamon | food | 1 | gold |
| cod | food | 5 | gold |
| jerky | food | 7 | gold |
| ale | food | 8 | gold |
| pepper | food | 30 | gold |
| wine | food | 40 | gold |
| saffron | food | 65 | gold |
| greataxe-iron | weapon | 20 | gold |

### Port Royal  
_22 goods · location id 8003_

| Good | Kind | Price | Coin |
|---|---|---|---|
| salt | food | 1 | copper |
| honey | food | 1 | silver |
| rations | food | 5 | silver |
| apple | food | 1 | gold |
| cinnamon | food | 1 | gold |
| cod | food | 5 | gold |
| jerky | food | 7 | gold |
| ale | food | 8 | gold |
| pepper | food | 30 | gold |
| wine | food | 40 | gold |
| saffron | food | 65 | gold |
| platinum | gem | 10 | gold |
| amethyst | gem | 100 | gold |
| emerald | gem | 1000 | gold |
| ruby | gem | 1000 | gold |
| diamond | gem | 10000 | gold |
| spear-iron | weapon | 2 | gold |
| battleaxe-iron | weapon | 10 | gold |
| warhammer-iron | weapon | 12 | gold |
| longsword-iron | weapon | 15 | gold |
| scimitar-iron | weapon | 15 | gold |
| greataxe-iron | weapon | 20 | gold |

### Saltmarsh  
_12 goods · location id 13002_

| Good | Kind | Price | Coin |
|---|---|---|---|
| salt | food | 1 | copper |
| honey | food | 1 | silver |
| rations | food | 5 | silver |
| apple | food | 1 | gold |
| cinnamon | food | 1 | gold |
| cod | food | 5 | gold |
| jerky | food | 7 | gold |
| ale | food | 8 | gold |
| pepper | food | 30 | gold |
| wine | food | 40 | gold |
| saffron | food | 65 | gold |
| spear-iron | weapon | 2 | gold |

### Skull Reef  
_12 goods · location id 12009_

| Good | Kind | Price | Coin |
|---|---|---|---|
| salt | food | 1 | copper |
| honey | food | 1 | silver |
| rations | food | 5 | silver |
| apple | food | 1 | gold |
| cinnamon | food | 1 | gold |
| cod | food | 5 | gold |
| jerky | food | 7 | gold |
| ale | food | 8 | gold |
| pepper | food | 30 | gold |
| wine | food | 40 | gold |
| saffron | food | 65 | gold |
| battleaxe-iron | weapon | 10 | gold |

### Tortuga Cove  
_12 goods · location id 2002_

| Good | Kind | Price | Coin |
|---|---|---|---|
| salt | food | 1 | copper |
| honey | food | 1 | silver |
| rations | food | 5 | silver |
| apple | food | 1 | gold |
| cinnamon | food | 1 | gold |
| cod | food | 5 | gold |
| jerky | food | 7 | gold |
| ale | food | 8 | gold |
| pepper | food | 30 | gold |
| wine | food | 40 | gold |
| saffron | food | 65 | gold |
| scimitar-iron | weapon | 15 | gold |

## Notes & gaps
- Coins ladder: copper (cheap) → silver → gold (dear). Price × coin = the real cost.
- **Towns ARE properly location-keyed** (distinct ids: 14005, 2006, 5009, 8003, 13002, 12009, 2002) — markets gated to their own map spots, not all to Port Royal.
- Bilge Rats LootPool (copper rewards) deployed separately: `0xE07CE9Ec642d42C5c8A0068203068BAc6042bF57`.
- Ocean/fish sell-walls + gem peg pools are tracked in their own deploy records (deploy/*-deployed.json).
- TODO: re-key non-Port-Royal markets to their own map locations; confirm rations/food token list for loot seeding; add gear/cosmetics rows as those markets open.
