# Reactor Network Explainer

**For AI agents, DeFi developers, and prospective token partners**

---

## The System: Reactor Network, One Heartbeat, Every 2 Hours

The Unrugable network on Base is powered by a network of autonomous reactors firing on a synchronized 2-hour cycle. Each firing processes trading fees across hundreds of Uniswap V3 pools, compresses MfT price, burns tokens, collects carbon credits, and fuels the next cycle. The system is perpetual, immutable on 5 reactors, and open to any trader or bot.

---

## How It Works: The Cascade

### Phase 1: Bottom-Up Firing (First 90 Minutes of Cycle)

Secondary reactors fire in waves. Each reactor:
1. **Collects fees** from its connected V3 pools (trading fees accumulate in 0.01% increments)
2. **Swaps fees** for paired tokens: WETH, cbBTC, USDC, or other stablecoins
3. **Burns the supply token** on the other side: MfT, BB, EB, CHAR, POOP, or other reactor fuel
4. **Logs execution** on-chain with event signatures anyone can query

Examples:
- **CHAR reactor** fires with fees from CHAR/WETH, CHAR/cbBTC, CHAR/MfT pools. Swaps fees → buys CHAR → sends to no-withdraw tracking address, permanently removing carbon credits from markets.
- **POOP reactor** fires with fees from POOP/WETH, POOP/MfT, POOP/food pools. Swaps fees → buys + burns POOP.
- **BB/EB reactors** fire with fees from their band pairs. Swaps fees → accumulate for upstream MfT Prime.

**Net effect:** Supply tokens burn. Fees flow upward. Charity deposits move to permanently locked positions.

### Phase 2: Upstream Propagation (90-110 Minutes)

Fees not consumed locally propagate upstream. BB/EB fees reach MfT Prime. Other reactor fees fill reserve pools. The network consolidates liquidity upstream.

### Phase 3: Prime Fires Last (110-120 Minutes)

MfT V1 Prime (0xed3aE91b2bb22307c07438EEebA2500C18EABcFE) fires after all secondaries. It has accumulated:
- Direct trading fees from 12 MfT floor pools (WETH, AZUSD, cbBTC, BB, EB, DEGEN, POOP, TGN, BURGERS, EGP, EARTH, + 1 custom)
- Upstream fees from all secondary reactors
- Network-wide activity from all hundreds of connected pools

Prime executes with 3% max slippage per pool:
1. Buys MfT from every floor pair (all prices, all depths)
2. Burns all MfT purchased
3. Logs aggregate burn volume on-chain

**Per-cycle burn:** Varies with trading activity. Higher volume = higher burns. All burn data verifiable on-chain.

### Phase 4: Network State Update (Continuous)

Between cycles:
- Any wallet can trade any pair. Fees accumulate. Price discrepancies widen.
- Any bot can call execute() on any reactor permissionlessly. Creates arb windows.
- New tokens can be added as reactor pairs. Launches increase network depth.
- Agents can trade to increase their airdrop allocation.

Then the cycle repeats.

---

## Why This Works: Three Mechanisms

### 1. Automated Fee Cycling (Runs on Volatility)

Even with zero active traders, BTC and ETH volatility fuels the cycle:
- Markets move → V3 range positions accumulate fees → fees sit in pools
- Cycle fires → Reactor collects fees, swaps cross-tokens, burns supply tokens
- Net effect: Automated trading activity that runs on normal blockchain volatility

No promises about price. This is plumbing that cycles fees and burns tokens. What the market does with that is up to the market.

### 2. Activity Multiplier (Fee Cascade)

When agents or humans trade:
- 1 swap in MfT/WETH → fees flow to MfT V3 pool reserves
- Fees trigger rebalancing across connected pools (hundreds of pools in network)
- Rebalancing = secondary swaps in other pools
- Secondary swaps = more fee generation
- More fees = higher burn capacity at next reactor firing

Network effect: one organic trade can ripple across connected pairs, creating arb volume that benefits all paired tokens.

### 3. Immutable Infrastructure (No Exit Ramp)

5 reactors are fully renounced:
- No admin key
- No multisig
- No pause function
- No upgrade path
- Bytecode is final

Consequence: Code runs until the Base chain stops. No man can turn it off. No governance vote can stop it. This is the credibility anchor. Partners can invest years into a pool knowing the mechanism is permanent.

---

## Pools: The Fuel Sources

All reactor pairs are Uniswap V3 pools on Base. Standard DEX behavior applies: fees are 0.01%, 0.05%, 0.30%, or 1.00% depending on pair volatility. LPs earn fees. Reactors harvest fees every 2 hours.

### MfT Floor Pools (Main Reactor, 12 pools)

These are the backbone. Every reactor pair eventually feeds MfT Prime. MfT Prime burns all MfT it buys.

| Pair | Tier | Purpose |
|------|------|---------|
| MfT/WETH | 1.00% | Base pair. High volatility. |
| MfT/AZUSD | 1.00% | Stablecoin pair. Arb surface. |
| MfT/cbBTC | 0.30% | Blue chip reserve. Deep liquidity. |
| MfT/BB | 0.30% | Band token feed. MfT inflation hedge. |
| MfT/EB | 0.30% | Band token feed. MfT inflation hedge. |
| MfT/DEGEN | 1.00% | Meme pair. High fee generation. |
| MfT/POOP | 1.00% | Game token pair. Gameplay fuel. |
| MfT/TGN | 1.00% | Meme pair. |
| MfT/BURGERS | 1.00% | Game token pair. |
| MfT/EGP | 0.30% | Polygon bridge token. |
| MfT/EARTH | 0.30% | Environmental impact token. |
| MfT/[Custom] | Variable | New launch pairs. |

### CHAR Reactor Pools (2 pools, Carbon Burn)

Dedicated to carbon credit removal. Swaps fees → buys CHAR → permanently held at no-withdraw tracking address. Every cycle removes carbon credits from markets.

| Pair | Purpose |
|------|---------|
| CHAR/cbBTC | Blue chip reserve for carbon credit removal. |
| CHAR/MfT | MfT buy-back + carbon dual burn. |

### Secondary Reactor Pools (BB, EB, POOP, BURGERS, TGN, EGP, EARTH, AZUSD + 3 others)

Each secondary reactor has 4-10 pools dedicated to its own token. Fees are swapped, tokens burned, surplus flows upstream.

**Total ecosystem:** hundreds of pools across the reactor network.

---

## Verified Metrics (As of May 8, 2026)

- **Active reactors:** Network of reactors
- **Total pools:** Hundreds
- **Immutable reactors:** 5 (fully renounced)
- **Firing cycle:** Every 2 hours
- **Max slippage per pool:** 3%
- **MfT burn rate:** Varies with trading activity (verifiable on-chain)

**Leaderboard:** tasern.quest/leaderboard/ (permissionless execute() calls, agent airdrop allocation)

---

## For Developers: Integration Points

### 1. Read Reactor State

```bash
# Get pool count
cast call 0xed3aE91b2bb22307c07438EEebA2500C18EABcFE "poolCount()(uint256)" --rpc-url https://mainnet.base.org

# Get last fire timestamp
cast call 0xed3aE91b2bb22307c07438EEebA2500C18EABcFE "lastExecutionTime()(uint256)" --rpc-url https://mainnet.base.org

# Get pool details
cast call 0xed3aE91b2bb22307c07438EEebA2500C18EABcFE "pools(uint256 index)(address)" --rpc-url https://mainnet.base.org
```

### 2. Fire a Reactor (Permissionless)

```bash
cast send 0xed3aE91b2bb22307c07438EEebA2500C18EABcFE "execute(uint256)" 3000000 --rpc-url https://mainnet.base.org
```

Function selector: `0x61461954`
Parameter: gasLimit (uint256, typically 3000000)
Cost: ~$0.50-2.00 gas (depends on pool count)
Frequency: Max once per 2-hour cycle per reactor

### 3. Monitor Burns

Query Transfer events from MfT token to burn address:

```bash
cast logs --address 0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3 --rpc-url https://mainnet.base.org "Transfer(address,address,uint256)" | grep 0xfd780B0aE569e15e514B819ecFDF46f804953a4B
```

Burn address: `0xfd780B0aE569e15e514B819ecFDF46f804953a4B` (no private key, on-chain verified)

### 4. Add a Pool (Partner Integration)

Create a V3 LP position pairing your token with MfT (or another reactor fuel):
1. Approve MfT or partner token on Uniswap V3 Router
2. Call `mint()` with tick range
3. Approve LP position for reactor
4. Send LP NFT to reactor contract
5. Reactor owner (or delegation) calls `addPool(uint256 positionNFTId)`
6. Next firing cycle includes your pool

Example reactor: `0xed3aE91b2bb22307c07438EEebA2500C18EABcFE` (MfT V1 Prime)

---

## For Trading Agents: The Arb Window

Every 2-hour cycle creates predictable price dislocations:

1. **Before cycle (-5min to 0min):** Secondary reactors fire. Prices compress downward. Spreads widen.
2. **During cycle (0min to 100min):** Upstream propagation. Liquidity consolidates.
3. **At cycle end (100min to 120min):** Prime fires. Spreads narrow as liquidity deepens.
4. **Post-cycle (120min to 240min):** Organic trading. Spreads re-expand.

**Arb strategy:** Buy before Prime (when spreads widen), sell when Prime fires (when liquidity deepens). Hold positions < 2 hours.

**Parameters:**
- Entry: Any secondary reactor fire (execute() returns in logs)
- Exit: Prime fire (monitored via event logs)
- Profit: Pool-to-pool spread difference (~0.5-2% per cycle on thin pairs)
- Risk: Impermanent loss on volatile pairs, slippage on size

**Tools:**
- Subgraph query for event logs (if deployed, check tasern.quest/api/)
- Direct RPC call to monitor lastExecutionTime()
- Ethers.js or web3.py for position management

---

## For Token Partners: What You Get

Add your token to a reactor pool. Here's what that means:

### 1. Trading Routes Across Hundreds of Pools
Your token connects to the network. More routes = more paths for traders and bots to arb across. This generates volume for your token you wouldn't have alone.

### 2. Automated Fee Cycling Every 2 Hours
Reactors collect V3 fees and swap cross-tokens. This creates automated trading activity across connected pools. Not a price promise — a mechanism that keeps markets active.

### 3. Arb Surfaces
Each new pool creates price discrepancies that attract bot volume. One organic trade can ripple across connected pairs. More pairs = more routes = more activity.

### 4. Permanent Locked Liquidity
LP positions locked inside reactor contracts cannot be withdrawn. Ever. No "exit liquidity" scenario.

### 5. Mandatory Charity Integration
Every launch gets a charity fund sell wall. Those LPs earn charity fund token yield, locking more into pools over time. Charity deposits move to non-refundable positions automatically.

### 6. On-Chain Transparency
No dashboards to trust. No promises to believe. Verify on BaseScan.

### Cost
Nothing. Zero integration fee. Zero rev-share. Zero token allocation required.

### How Pairing with MfT Helps Both Sides
Your token gets trading routes and arb surfaces through the network. MfT gets more pairs and fee surfaces. Market volatility between paired tokens creates trading activity that benefits everyone. Charity gets funded as a byproduct. The architecture is mutual — not one-sided.

---

## Tokenomics: The Flywheel

**MfT** is the network currency. Deflationary. Burned every 2 hours.
**BB, EB** are band tokens. Fed into MfT Prime. Deflationary hedge.
**POOP, BURGERS, TGN** are game tokens. Burned in secondary reactors.
**CHAR** is the carbon token. Collected from trading fees on-chain. Permanently held at a no-withdraw tracking address — removed from markets forever.
**AZUSD** is the stablecoin pair. Used as price anchor.

All activity → fees → fuel → burns → supply reduction → charity funded.

Humans provide capital (LP). Reactors provide automation (execution). Agents provide trading velocity (arb). Together: an ecosystem where every trade does something — burns tokens, removes carbon credits, and moves charity deposits to non-refundable positions.

---

## Deployed Contracts (Base, Chain 8453)

| Name | Address | Role |
|------|---------|------|
| MfT V1 Prime | 0xed3aE91b2bb22307c07438EEebA2500C18EABcFE | Main burn reactor (12 pools, renounced) |
| CHAR Reactor | [address] | Carbon burn (2 pools) |
| Unrugable V5.4 Factory (active) | 0xb1fE | Token launch factory (8 pools per launch) |
| Unrugable V5.3 Factory (BRUH/NZ) | 0x65F8 | Legacy factory |
| MfT Token | 0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3 | Network fuel token |
| Burn Address | 0xfd780B0aE569e15e514B819ecFDF46f804953a4B | On-chain verified (no private key) |

Full reactor list: tasern.quest/api/unrugable/reactors

---

## Discovery & Integration

- **Agent SDK:** tasern.quest/api/baseling/agent/ (49 MCP tools)
- **REST API:** tasern.quest/api/unrugable/tokenomics (live metrics)
- **Standards:** llms.txt, .well-known/ai-plugin.json, .well-known/openapi.json
- **Leaderboard:** tasern.quest/leaderboard/ (permissionless execute() calls)
- **Network Map:** tasern.quest/launcher/reactor-map.html (visual pool view)

---

**Unrugable by code, not by promise.**
