# Flaunch Token Adoption Outreach Package

Created: 2026-05-09
Status: DRAFT -- needs team-leader approval before any public posting
Contract: 0x013a1091108D50eF5F9cC3FDa38f9b2BA4D3F81d (UnrugableAdoption on Base)
Page: tasern.quest/launcher/adopt.html
Tagline: "Born anywhere. Made unrugable."

---

## 1. Reply Templates for Flaunch Token Creators on X

Use these when replying to Flaunch token creators posting about their launch, milestones, or community updates. Never reply-spam -- pick moments where the value add is genuine.

### Template A: The Simple Offer

> Your token can now get its own Unrugable reactor. free (just gas), one tx. No withdraw function -- LP locked permanently. Automated buy-back fires every 2 hours from pool fees.
>
> tasern.quest/launcher/adopt.html

(237 chars)


### Template B: The Complement Angle

> Flaunch handles the birth. We handle the armor. One tx gets your token a reactor that collects V3 fees and buys your token every 2 hours. Permanent -- no admin can withdraw the LP. Ever.
>
> tasern.quest/launcher/adopt.html

(226 chars)


### Template C: The Proof Point

> BURGERS was launched on Flaunch. Now it has 9 reactor pools firing buy-backs every 2 hours. No withdraw function. Permanent by code. Free to adopt any token.
>
> Reactor: basescan.org/address/0xc858026Ec5D30280137032BC6EA86F46ea23C2CA
>
> tasern.quest/launcher/adopt.html

(277 chars -- over 280 with full links, shorten basescan link or use one link only. Alt version below.)

**Alt C (under 280):**

> BURGERS went from Flaunch launch to 9 permanent reactor pools. Buy-backs every 2hr. No withdraw function. Free to adopt any token into the network.
>
> tasern.quest/launcher/adopt.html

(195 chars)


### Template D: The Charity Angle

> Your Flaunch token can fund carbon collection credits on every reactor cycle. Free adoption (just gas). No keys, no withdraw. Just permanent buy-backs every 2 hours and CHAR burns on each firing.
>
> tasern.quest/launcher/adopt.html

(213 chars)


### Template E: The Network Effect

> Every token adopted into the reactor network makes every other token stronger. Fees cascade across the reactor network. Free to join (just gas). No withdraw function. Permanent.
>
> tasern.quest/launcher/adopt.html

(210 chars)


---

## 2. Comparison Points: Flaunch Alone vs. Flaunch + Unrugable

Position: Flaunch and Unrugable are complementary layers. Flaunch does the launch. Unrugable adds permanence. Never frame Flaunch as lacking -- frame Unrugable as additive.

### Point 1: Price Floor Support (PBW) + Supply Burn (Reactor)

**Flaunch alone:** Progressive Bid Wall (PBW) uses Uniswap V4 hooks to place ETH one tick below spot price. This creates a price floor that follows the token upward. Funded by swap fees accumulated as ETH. This is excellent floor support.

**Flaunch + Unrugable:** The reactor adds a supply-side engine on top of the price floor. Every 2 hours, the reactor collects V3 pool fees, buys the token, and the network effect burns MfT. PBW holds the floor. The reactor reduces circulating supply above it. Two different mechanisms, both permanent, both automated. Complementary, not competing.

**Marketing language:** "PBW protects the floor. The reactor burns above it. Together: floor goes up, supply goes down."


### Point 2: Creator Revenue + Permanent Locked Liquidity

**Flaunch alone:** Creator earns a configurable share of swap fees (up to 100%) paid in ETH. Fees stream through Flaunch's V4 hooks. Creator controls revenue allocation. This is a strong, flexible creator income model.

**Flaunch + Unrugable:** Adoption adds permanently locked V3 liquidity positions. No withdraw function exists in the reactor contract. No admin key can pull liquidity. The creator keeps their Flaunch revenue stream unchanged. The reactor simply adds a second liquidity layer that can never be rugged. Creator revenue from Flaunch + permanently locked depth from Unrugable.

**Marketing language:** "Keep your Flaunch revenue. Add liquidity that cannot be removed. Not by you, not by us, not by anyone."


### Point 3: Single-Pool Token + Multi-Pool Network

**Flaunch alone:** Token trades in a single V4 pool (TOKEN/flETH). All volume, all fees, one pool. Clean and simple.

**Flaunch + Unrugable:** Adoption connects the token to a the reactor network. The token can have V3 pools against WETH, cbBTC, USDC, MfT, and any other adopted token. Price dislocations between the V4 Flaunch pool and the V3 reactor pools create natural arbitrage surfaces. Arb bots generate additional volume, which generates fees, which fuel more reactor buy-backs.

**Marketing language:** "One pool is a token. A network of pools is an ecosystem. Adoption connects your Flaunch token to both."


---

## 3. DM Template for Direct Outreach to Flaunch Token Creators

Send via X DM. Respectful, not salesy. Lead with proof.

---

**Subject line (if platform supports it):** Your token + permanent reactor buy-backs

**Message:**

Hey -- saw your token launched on Flaunch. Nice work.

We built something that might interest you. Unrugable Adoption lets any token get its own reactor on Base. It's free (just gas) and takes one transaction.

What a reactor does:
- Collects fees from V3 liquidity pools every 2 hours
- Uses those fees to buy your token automatically
- LP is permanently locked (no withdraw function in the contract -- verifiable on BaseScan)
- Connects your token to a the reactor network

This already works. BURGERS was launched on Flaunch and now has its own Unrugable reactor (0xc858) with 9 pools firing buy-backs every 2 hours. You can verify every claim on-chain.

What happens when you adopt:
1. You connect your wallet at tasern.quest/launcher/adopt.html (free, just gas)
2. A SporeReactorV4 clone is deployed for your token
3. You (or we) create V3 LP positions and lock them in the reactor
4. The keeper auto-discovers your reactor and adds it to the 2-hour cycle
5. You get a shareable invite link -- downstream adoptions earn you 5% of their reactor fees

One more thing: when we set up the initial LP, we BUY your token to create the pair. That is a real buy on your chart.

Your Flaunch revenue stays exactly the same. PBW keeps working. We just add a second, permanent layer underneath.

Happy to answer questions or walk you through the on-chain proof. No pressure.

-- Unrugable (tasern.quest/launcher/adopt.html)

---


## 4. Top 5 Flaunch Tokens to Target

Prioritized by: community activity, volume, creator engagement, charitable/impact alignment.

### Target 1: BURGERS (Burger Money)
- **Status:** ALREADY ADOPTED -- reactor 0xc858, 9 pools, firing
- **Why lead with this:** It is the proof case. Every outreach references BURGERS as the working example. Charity token (50% of Flaunch revenue feeds the hungry). Perfect brand alignment.
- **X handle:** @BurgersOnBase
- **Action:** Use as social proof in all outreach. Engage @BurgersOnBase publicly, thank them, post reactor stats. Co-marketing opportunity.

### Target 2: ODEI AI ($ODAI)
- **Market cap:** ~$2.6M (largest Flaunch token by cap)
- **24h volume:** ~$103K
- **Why:** Largest Flaunch token. AI agent project (Claude Opus 4.6 based). Fair launch -- 0% pre-mine, 0% team allocation. Active builder community. AI agents are our primary target audience.
- **X handle:** @odeiai
- **Angle:** "Your AI agent already runs autonomously. Now its token can too. Reactor buy-backs every 2 hours, no admin keys."
- **Risk:** High-profile project may not want association with smaller platform. Lead with verifiable on-chain proof, not hype.

### Target 3: Gacha Fund ($GACHA)
- **Market cap:** ~$155K
- **24h volume:** ~$170K (highest volume-to-cap ratio on Flaunch)
- **Why:** Active gamified economy (256-chair Harberger grid, weekly card pack openings). 100% of card-sale USDC buys and burns GACHA. They already understand buy-back mechanics. Natural fit.
- **X community:** The Gacha Hub (2.5K members on X Communities)
- **Website:** gacha.fund
- **Angle:** "You already burn 100% of card sales. A reactor adds a second burn engine on top -- every 2 hours from V3 pool fees. Both permanent. Both automated."
- **Risk:** Complex project with its own economic loops. Pitch must show additive value, not complexity.

### Target 4: DungeonClaw ($DCLAW)
- **Market cap:** ~$92K
- **24h volume:** ~$19K
- **Why:** On-chain game on Base (competitive dungeon crawler, USDC tournaments). Gaming token with real utility. Aligns with our gaming ecosystem (Baselings, Tales of Tasern). Cross-game partnership potential.
- **Website:** dungeonclaw.com
- **X handle:** Search for @dungeonclaw or check their website
- **Angle:** "Game tokens need permanent infrastructure. Reactor fee cycling every 2 hours. No admin keys. Your tournament token gets trading routes across the reactor network."
- **Risk:** Game-first project may not prioritize DeFi mechanics. Keep pitch game-focused.

### Target 5: Osobot ($OSO)
- **Market cap:** ~$497K
- **24h volume:** ~$36K
- **Why:** AI agent built on Claude Opus 4.6, endorsed by MetaMask (delegation ambassador). Active builder. ClawCade game burns 1,000 OSO per ticket. Understands burn mechanics. AI agent + gaming crossover.
- **X handle:** @Osobotai
- **Angle:** "Your agent earns 80% of Flaunch swap fees. A reactor adds permanent V3 buy-backs on top. Two revenue layers, both automated."
- **Risk:** Agent may have its own integration preferences. Ryan McPeck (MetaMask) involvement means institutional eyes -- keep claims precise.

### Honorable Mention: Takeover.fun ($TAKEOVER)
- **Market cap:** ~$305K
- **Why notable:** Built by the Flaunch team/ecosystem (Harberger tax grid for trading fee revenue). Deeply integrated with Flaunch. Adopting TAKEOVER would signal ecosystem-level partnership.
- **X handle:** @takeoverfun
- **Action:** Only approach after proving value with 2-3 other adoptions. Flaunch ecosystem insiders need to see results first.

---

## 5. Outreach Execution Plan

### Phase 1: Proof (Now -- Week 1)
- Post BURGERS adoption results publicly (reactor stats, pool count, firing history)
- Tag @BurgersOnBase, @flaunchgg in non-salesy, data-driven content
- Use Alt C template as first public reply when Flaunch tokens post milestones

### Phase 2: First Outreach (Week 1-2)
- DM ODEI AI (@odeiai) -- highest visibility target, AI angle
- DM Gacha Fund via their X community -- volume leader, understands burns
- DM DungeonClaw -- gaming angle, cross-ecosystem potential

### Phase 3: Network Effect (Week 2-3)
- Each successful adoption becomes social proof for the next pitch
- Update reply templates with new proof points
- Approach Takeover.fun only after 2+ successful external adoptions

### Phase 4: Scale
- Monitor Flaunch launches for new tokens with active creators
- Auto-reply framework (not spam -- curated, 1-2 per day max)
- Build relationships, not transactions

---

## Compliance Checklist

- [x] "Reactor pools" not "Base pools" throughout
- [x] No price predictions or return promises
- [x] All claims on-chain verifiable (reactor addresses, no withdraw function, firing cycle)
- [x] Flaunch mentioned respectfully as complementary platform
- [x] Cost stated accurately: "free to adopt (just gas)"
- [x] No "pump" language anywhere
- [x] No use of "MycoPad" (internal code name only)
- [x] BURGERS reactor address verified: 0xc858026Ec5D30280137032BC6EA86F46ea23C2CA
- [x] Adoption contract verified: 0x013a1091108D50eF5F9cC3FDa38f9b2BA4D3F81d
- [x] Pool/reactor counts from CANONICAL-NUMBERS.md (the reactor network)
- [x] "Up to 20 pools per reactor" not claimed (contract supports addPool indefinitely)

---

## Data Sources

- BURGERS reactor: on-chain at 0xc858026Ec5D30280137032BC6EA86F46ea23C2CA
- Adoption contract: on-chain at 0x013a1091108D50eF5F9cC3FDa38f9b2BA4D3F81d
- Token data: GeckoTerminal Flaunch launchpad category (verified 2026-05-09)
- Flaunch PBW mechanics: docs.flaunch.gg/community/whitepaper
- Network stats: CANONICAL-NUMBERS.md (last verified 2026-05-08)
- Flaunch fee structure: configurable per creator, up to 100% to creator or community
