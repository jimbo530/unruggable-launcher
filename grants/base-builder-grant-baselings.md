# Base Builder Grant Application — Baselings

**Nomination Form:** https://docs.google.com/forms/d/e/1FAIpQLSfXuEzmiAzRhie_z9raFCF1BXweXgVt18o-DvBuRRgyTygL2A/viewform

---

## Project Name
Baselings

## Builder / Team
memefortrees.base.eth (solo builder)

## One-Liner
A virtual pet game on Base where feeding your pet deposits real LP, pooping earns yield, and every meal funds reforestation.

## What is Baselings?

Baselings is a Tamagotchi-style pet game built entirely on Base. Players hatch eggs, raise creatures through 5 evolution stages, feed them meals (which are actually LP deposits), collect POOP tokens from their pets, and put those tokens to work in gardens and power plants that generate real DeFi yield.

The trick: players think they're playing a pet game. Under the hood, every action is a DeFi transaction — feeding deposits LP, gardens compound POOP into yield-bearing positions, and the power plant burns tokens while accumulating blue chips. The game makes DeFi accessible to people who would never touch a DEX directly.

## What's Live on Base Right Now

- **Full pet lifecycle**: Egg incubation (patience bonus for rarity) -> Baby -> Teen -> Adult -> Mega/Legend evolution over 14-365 days
- **12+ food tokens**: WETH, cbBTC, USDC, TGN (plants trees), BURGERS (feeds people), CHAR (retires carbon), BRETT, BUSTER, DEGEN, and more — each with flavor text and stat multipliers
- **Vault system**: Every baseling has a personal LP vault. Feeding = depositing LP. Locked forever, no admin keys, no rug
- **POOP token economy**: Baselings produce POOP from real LP fee accrual. Players collect it, deposit it in gardens, or burn it in the power plant
- **Community gardens**: POOP/token V3 positions locked permanently, workers assigned to tend them
- **Power plant**: Burns POOP + meme tokens, accumulates WETH/USDC/cbBTC
- **House NFTs**: On-chain rooms with cupboards, freezers, storage upgrades, nanny assignments
- **Flower NFTs**: Decorative + yield-earning flowers for home rooms
- **Job system**: Nanny (CHA skill), Hauler (DEX skill), Garden Worker, Power Plant Worker — each with 5% skim mechanics and burn/player fee splits that scale with skill level
- **Racing**: Hidden stats (SPEED, STAMINA, POWER, LUCK, SWIM) derived from care patterns, daily races with POOP prize pools
- **Backpack & inventory**: Item management with upgrade tiers
- **Egg storage**: Extra egg slots with upgrade tiers
- **Reaper track**: 100-death prestige system with exponential revival costs (1.1^N compound)
- **Agent SDK**: 39 MCP tools, full REST API, AI strategies for autonomous play

## Deployed Contracts (All on Base)

- BaselingNFT (ERC721): `0xFCb825491490284189C75fD330Fd08Df5E9217b9`
- PoopToken (ERC20): `0x126555aecBAC290b25644e4b7f29c016aE95f4dc`
- BaselingRouter V5: `0x3A46935BA67B1A2a2fc3bb99a0EEe1ac1FBE3DEE`
- PowerPlant V2: `0xffC11092419a1068334be90cEcAeFE873031c31d`
- BaselingHouseNFT V2: `0x70Ff566A417ece44784196106afdbecDAaA3b511`
- BaseFlowerNFT: `0xa819b6D99135222f604047A3304ba53424D4779d`
- BaselingState (ERC1155): `0x4b123766152397BAa035a52808DDDCD794c8a32d`
- BaselingAssignments: `0xabC2e93CF79F89E0874741366E9C33D73D7E9C6c`
- CommunityGardenMulti: `0xD2b6230922A0E6E200Bbf3a67670E0e6B66DA80d`
- BaselingTraitRegistry: `0xfCb1aA4537844d6730d4068407ed4B161BAD7d04`
- 11 V3 POOP pools (WETH, USDC, cbBTC + 8 meme tokens)

## Why This Matters for Base

1. **Onboards non-DeFi users**: The game UI shows hunger bars and happiness — not yield% or APR. Players learn DeFi by playing, not studying
2. **Every action is on-chain**: Feed = LP deposit, collect poop = claim yield, assign worker = stake. Real transactions, real volume, real TVL
3. **Impact-aligned tokens**: TGN plants trees, BURGERS feeds people, CHAR retires carbon — players choose their impact through food choices
4. **Permanent liquidity**: All vault deposits are locked forever with no admin keys. The protocol's TVL only goes up
5. **Agent-native**: Full MCP tool suite means AI agents can play the game, creating autonomous on-chain activity on Base
6. **Novel mechanic**: Nobody has built "DeFi-as-pet-care" before. It's genuinely new infrastructure for onboarding

## Tech Stack
- Vanilla JS game (single HTML, no framework overhead)
- Next.js 16 app (React 19, wagmi, viem, Coinbase OnchainKit)
- Solidity ^0.8.20 (27 contracts)
- Uniswap V2 (Aerodrome) + V3 integration
- Node.js Express API + Supabase
- Hosted on VPS at tasern.quest/baseling

## Links
- **Play**: https://tasern.quest/baseling
- **API**: https://tasern.quest/api/baseling
- **Builder**: memefortrees.base.eth

## What Grant Funding Would Enable
- Professional pixel art for all evolution stages and food items
- Mobile-responsive redesign for phone players
- Multiplayer features (visit friends' houses, trade baselings)
- Marketing push to onboard first 1,000 pet owners on Base
