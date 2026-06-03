# MfT Ecosystem — UN Sustainable Development Goals Alignment

Reference: https://sdgs.un.org/goals

MfT is not core to any single SDG but contributes measurably to several through its partner ecosystem, token mechanics, and infrastructure. This document tracks which goals we touch, how, and what we can measure.

## Active SDG Contributions

### SDG 2 — Zero Hunger
**Partner:** BURGERS (burgermoney.xyz)
**How:** BURGERS community makes regular charitable food donations funded by LP fees. Every BURGERS pool in the reactor network generates fees that support this.
**Measurable:**
- BURGERS burned in reactor (on-chain at burn address)
- BURGERS pool fee volume (on-chain)
- Donation records (from BURGERS community)

### SDG 13 — Climate Action
**Partners:** CHAR (Toucan/Puro.earth biochar), NCT (Nature Carbon Tonne), BCT (Base Carbon Tonne), CCC (Carbon Counting Club — @CCountingClub)
**How:** Every Unrugable launch allocates 6% of seed to CHAR reactor. CHAR = 1 tonne CO2 removed. Burns are permanent retirement. CCC = 1 lb CO2e of biochar applied to gardens, work documented on X before tokens are minted (Base: 0xd0581088eaaa4bf9a948b15a057b809c2b0cd61c). NCT/BCT extend carbon coverage on Polygon with game-integrated LP pairs.
**Measurable:**
- CHAR burned = exact tonnes CO2 retired (on-chain at 0xfd78..., Base)
- NCT/BCT/CCC burned in Polygon reactors (on-chain)
- CHAR reactor fire count (on-chain tx history)
- Number of launches contributing to CHAR (Supabase launched_tokens)
- Composite: total weighted CO2 across all carbon tokens

### SDG 14 — Life Below Water
**Partners:** TreeGens / Jimi (linktr.ee/treegensdao), LTK (Litter cleanup / ocean care)
**How:** TreeGens plants mangroves — coastal ecosystems that protect marine life, filter water, and sequester carbon. Guinness World Record holder. LTK supports ocean and waterway cleanup efforts.
**Measurable:**
- TGN burned in reactor (on-chain)
- TGN pool fee volume (on-chain)
- LTK in Polygon LP pairs (on-chain)
- Mangroves planted (from TreeGens reporting)

### SDG 15 — Life on Land
**Partners:** TreeGens / Jimi, REGEN (Regenerative Finance), AU24T (Tokenized trees)
**How:** Mangrove planting restores coastal ecosystems. REGEN supports regenerative finance initiatives. AU24T represents tokenized reforestation offsets. All in active LP pairs on Polygon.
**Measurable:**
- TGN/REGEN/AU24T in LP pairs and reactor burns (on-chain)
- Mangroves planted (TreeGens reporting)

### SDG 7 — Affordable and Clean Energy
**Partners:** AZUSD / Azos Finance (azos.finance), JLT-F24/JLT-B23 (Renewable Energy Credits), LANTERN (Solar)
**How:** AZUSD deposit receipt is backed partly by Helios (solar/clean energy investment tokens). JLT tokens represent renewable energy credits (MWh equivalent). LANTERN supports solar energy initiatives. All in active LP pairs.
**Measurable:**
- AZUSD locked in LP across ecosystem (on-chain, Base)
- AZUSD in locked launch liquidity (on-chain)
- JLT/LANTERN in Polygon LP pairs (on-chain)

### SDG 9 — Industry, Innovation, and Infrastructure
**How:** Open-source DeFi infrastructure. Agent SDK with 39 MCP tools. Reactor network as public goods infrastructure. Permissionless — anyone can call execute().
**Measurable:**
- Reactor count and fire frequency (on-chain)
- Agent SDK usage / API calls (server logs)
- Open-source contributions (git)

### SDG 17 — Partnerships for the Goals
**How:** Multi-project collaboration across independent communities (TreeGens, BURGERS, Azos, Toucan/Puro.earth). Each partner maintains independence while the reactor network connects them.
**Measurable:**
- Number of partner tokens in ecosystem
- Cross-community pool count
- Joint LP value locked

## Indirect / Future Contributions

### SDG 8 — Decent Work and Economic Growth
**Future:** Play-for-impact gaming (Baselings, Tales of Tasern) could provide income to players in developing economies. Ad-funded F2P model planned.

### SDG 12 — Responsible Consumption and Production
**How:** Burn mechanics reduce speculative token waste. Reactor network turns all activity (even adversarial) into productive burns. No-withdraw LP prevents extract-and-dump patterns.

### SDG 16 — Peace, Justice and Strong Institutions
**How:** Transparent, auditable on-chain operations. Renounced (immutable) contracts. Legal docs published. Working toward charity registration.

## Full Impact Token Portfolio

| Token | Impact | SDG | Chain | Weight |
|-------|--------|-----|-------|--------|
| CHAR | Biochar carbon removal | 13 | Base | 1 tonne/token |
| NCT | Nature carbon credits | 13, 15 | Polygon | 0.1 tonne/token |
| BCT | Base carbon credits | 13 | Polygon | 0.05 tonne/token |
| CCC | Biochar in gardens (1 lb CO2e/token) | 13, 15 | Base + Polygon | 1 lb/token |
| TGN | Mangrove planting | 14, 15 | Base | Community reported |
| REGEN | Regenerative finance | 12, 15 | Polygon | Community reported |
| AU24T | Tokenized trees | 15 | Polygon | Community reported |
| LTK | Ocean/litter cleanup | 14 | Polygon | Community reported |
| BURGERS | Food charity | 2 | Base | Donation records |
| AZUSD | Climate-positive stablecoin | 7 | Base | Indirect (backing) |
| JLT-F24 | Renewable energy | 7 | Polygon | MWh equivalent |
| LANTERN | Solar energy | 7 | Polygon | Community reported |

## Tracking Plan

| SDG | Metric | Data Source | Frequency |
|-----|--------|-------------|-----------|
| 2 | BURGERS donations ($) | BURGERS community reports | Quarterly |
| 13 | Tonnes CO2 retired (all carbon tokens) | Burn address balances | Real-time (on-chain) |
| 14/15 | Mangroves planted + cleanup | TreeGens + LTK reporting | Quarterly |
| 7 | AZUSD locked + JLT MWh | On-chain LP positions | Real-time |
| 9 | Reactor fires / API calls | On-chain + server logs | Monthly |
| 17 | Partner token count | Reactor pool registry | Ongoing |

## How to Use This

- Reference SDG numbers in grant applications and charity filings
- Add SDG badges to impact pages when metrics reach meaningful thresholds
- Annual impact report maps progress against these goals
- Guides ethical decision-making: when choosing between options, prefer the one that advances more SDGs
