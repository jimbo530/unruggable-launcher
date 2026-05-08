# Base Builder Grant Application — Unruggable Launcher

**Nomination Form:** https://docs.google.com/forms/d/e/1FAIpQLSfXuEzmiAzRhie_z9raFCF1BXweXgVt18o-DvBuRRgyTygL2A/viewform

---

## Project Name
Unruggable Launcher (MycoPad)

## Builder / Team
memefortrees.base.eth (solo builder)

## One-Liner
A permissionless token launcher on Base where 100% of supply is locked in permanent LP — no dev tokens, no admin keys, no rug possible — with built-in reactor automation that compounds liquidity forever.

## What is Unruggable Launcher?

Unruggable Launcher is a token factory on Base that makes it impossible for launchers to rug. When someone launches a token:

1. **100% of supply goes to LP** — split across 3 floor pools (AZUSD, BB, EB) + 3 MfT sell walls
2. **All LP positions are locked forever** — transferred to a reactor contract with no withdraw function
3. **A SporeReactor is deployed** — an autonomous contract that collects trading fees, burns the token, deepens liquidity, and sends fuel upstream every 2 hours
4. **6% of the seed retires carbon** — routed through a CHAR reactor that burns carbon credits permanently

The result: every token launched has permanent liquidity that only grows over time, automatic deflationary pressure, and built-in environmental impact.

## What's Live on Base Right Now

### Token Launch Factory (V4.3)
- One-click token deployment with 3 floor pools + 3 MfT walls
- Two-step launch for safety (cancel if step 2 isn't completed)
- EIP-1167 minimal proxy clones for gas-efficient reactor deployment
- 0.1% to MfT treasury, 1% to launcher, 98.9% to permanent LP

### Reactor Network (17+ active reactors)
- **Reactor Prime** (V1): Top of chain, 12 pools, fires with all accumulated network fees
- **MycoPad Hub**: Collects fuel from every launched token
- **6 static reactors**: CHAR, BURGERS, EGP, AZUSD, TGN, ecowealth
- **Band token reactors**: BB v5, EB v5, BBT, EBT — infrastructure backing
- **Unlimited launched reactors**: Every new token gets its own reactor
- All reactors are permissionless — anyone can call execute()

### Public Dashboard & Leaderboard
- **Reactor Dashboard** (tasern.quest/launcher/reactor-dashboard.html): Big red FIRE buttons for every reactor, shows cooldowns, fees, pool counts
- **Leaderboard** (tasern.quest/launcher/leaderboard.html): Rankings of who's fired the most reactors
- **Reactor Map** (tasern.quest/launcher/reactor-map.html): Visual network topology showing fuel flow
- **Fund button**: One-click LP deepening via ReactorZap contract

### ReactorZap (Permissionless LP Deepening)
- Send any ERC20 or ETH
- Contract routes: input -> xToken (hop 1) -> split half for launched token (hop 2) -> depositLiquidity()
- Fully stateless, no admin, no owner

### Invite Chain System
- Every launcher gets an invite link
- New launchers who use the link have their CHAR reactor feed into the inviter's TOKEN reactor
- Creates Token -> CHAR -> Token -> CHAR chain incentives
- Multi-launch support: scan all TokenLaunched events to recover invite links

### Agent & API Integration
- Full metadata API at tasern.quest/api/mycopad
- llms.txt, OpenAPI spec, ai-plugin.json for AI agent discovery
- 40 MCP tools for autonomous launching and monitoring

## Deployed Contracts (All on Base)

- TokenLaunchFactory V4.3: `0x655e0Ca995D10912574a92a3a67AE9D466424925`
- MycoPad Reactor (Hub): `0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045`
- Reactor Prime V1: `0xed3aE91b2bb22307c07438EEebA2500C18EABcFE`
- SporeReactorV4 Implementation: `0xb9630280dc93c503aee06d1eca8e125fc19ab3c5`
- ReactorZap: `0x61A7e716971D11D9FcABD55dFEd037a3a47be3Ef`
- 17+ reactor contracts across the network
- Band tokens (BB, EB, BBT, EBT) with dedicated reactors
- CHAR carbon retirement reactor: `0xc2eBe90fB9bC7897f06DC00666951Fa9a49A397A`

## Why This Matters for Base

1. **Solves the #1 problem in token launches**: Rug pulls. By code, not by promise — there is no withdraw function. Period.
2. **Permanent TVL on Base**: Every launch adds liquidity that can never be removed. The protocol is a one-way valve for Base TVL
3. **Self-sustaining volume**: Reactors fire every 2 hours, creating arbitrage opportunities that bots fill. Each launch adds perpetual trading volume to Base
4. **Infrastructure tokens as index funds**: MfT, BB, and EB benefit from every launch — they're Base-native index exposure
5. **Carbon-positive DeFi**: 6% of every launch seed retires carbon credits. First token launcher with built-in environmental impact
6. **Fully permissionless**: No gatekeepers, no approvals, no KYC to launch. Anyone can launch, anyone can fire reactors, anyone can deepen liquidity
7. **Composable**: ReactorZap, depositLiquidity(), and execute() are all public. Other protocols can build on top
8. **Agent-ready**: Full API + MCP tools mean AI agents can discover, launch, and manage tokens autonomously on Base

## Novel Technical Contributions

- **SporeReactor pattern**: Autonomous fee-compound-burn-fuel cycle with no human intervention needed
- **EIP-1167 reactor cloning**: Each launched token gets a gas-efficient reactor clone (~$30 deploy cost)
- **Multi-floor LP**: 3 separate price floors per token (stablecoin + BTC-band + ETH-band)
- **Upstream fuel chain**: Reactors feed other reactors, creating network effects that strengthen as more tokens launch
- **Slippage-protected execution**: 3% max impact via sqrtPriceLimitX96 from slot0 — MEV resistant
- **Two-step launch safety**: Cancel and reclaim if step 2 isn't completed

## Tech Stack
- Solidity ^0.8.24 (11 contracts, EIP-1167 clones)
- Uniswap V3 full-range positions
- Vanilla HTML/JS frontend (ethers.js v6)
- Node.js metadata API + VPS keeper bots
- Hosted at tasern.quest/launcher

## Links
- **Launch a token**: https://tasern.quest/launcher/unruggable.html
- **Fire reactors**: https://tasern.quest/launcher/reactor-dashboard.html
- **Leaderboard**: https://tasern.quest/launcher/leaderboard.html
- **Reactor map**: https://tasern.quest/launcher/reactor-map.html
- **API**: https://tasern.quest/api/mycopad
- **Builder**: memefortrees.base.eth

## What Grant Funding Would Enable
- Security audit for SporeReactorV4 and TokenLaunchFactory contracts
- Gas optimization for cheaper launches
- Subgraph deployment for real-time analytics
- Marketing to attract first 100 independent token launchers
- Cross-chain expansion (Optimism, Arbitrum — same OP stack)
