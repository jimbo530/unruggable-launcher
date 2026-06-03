# Reactor Network Explainer

**For AI agents, DeFi developers, and prospective token partners**

---

## The System: Reactor Network, One Heartbeat, Every 2 Hours

The Unrugable network on Base is powered by autonomous reactors firing on a synchronized 2-hour cycle. Each firing processes trading fees across hundreds of Uniswap V3 pools, burns tokens, pays launchers, collects carbon credits, and fuels the next cycle. The system is perpetual, immutable on 5 reactors, and open to any trader or bot.

---

## V7 Launches: Free, Two Pools, One Reactor

Every V7 launch deploys in a single transaction:
- **1B token supply** at $10K starting market cap
- **TOKEN/Money pool** (70% of supply) — paired against Money for Trees (USDC-backed deposit receipt, Aave yield funds trees)
- **TOKEN/Meme pool** (30% of supply) — paired against Meme for Trees (meme token, reactor heartbeat)
- **SporeReactorV4** clone — manages both positions, fires every 2 hours

Reactor fee split:
- **50% of token fees burned** permanently (supply decreases)
- **50% of token fees sent to launcher's wallet** (passive earnings)
- Cross-token (Meme) fees: 10% upstream to reactor network, rest swapped and deposited as LP

Cost: FREE. Just gas (~$0.01 on Base).

V7 Factory: `0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2`

---

## How It Works: The Cascade

### Phase 1: Bottom-Up Firing (First 90 Minutes of Cycle)

Secondary reactors fire in waves. Each reactor:
1. **Collects fees** from its connected V3 pools
2. **Burns token fees** — 50% permanently destroyed, 50% to launcher
3. **Cascades cross-token fees** — 10% upstream, rest deposited as LP
4. **Logs execution** on-chain with event signatures anyone can query

Examples:
- **V7 launch reactors** fire with fees from TOKEN/Money and TOKEN/Meme pools. Burns token supply, pays launcher, cascades Meme fees upstream.
- **CHAR reactor** fires with fees from CHAR pools. Buys CHAR, sends to no-withdraw tracking address — permanently removing carbon credits from markets.
- **BB/EB reactors** fire with band pair fees. Surplus flows upstream to MfT Prime.

### Phase 2: Upstream Propagation (90-110 Minutes)

Fees not consumed locally propagate upstream. Cross-token fees from V7 reactors reach Prime. The network consolidates.

### Phase 3: Prime Fires Last (110-120 Minutes)

ReactorPrimeV3 (`0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA`) fires after all secondaries. It has accumulated:
- Direct trading fees from its pools
- Upstream fees from all secondary reactors including V7 launches
- Network-wide activity from hundreds of connected pools

Prime executes with 3% max slippage per pool:
1. Buys MfT from every connected pair
2. Burns all MfT purchased
3. Logs aggregate burn volume on-chain

### Phase 4: Network State Update (Continuous)

Between cycles:
- Any wallet can trade any pair. Fees accumulate. Price discrepancies widen.
- Any bot can call execute() on any reactor permissionlessly.
- New V7 launches add reactors to the network. Each one grows the fee surface.

Then the cycle repeats.

---

## Why This Works: Three Mechanisms

### 1. Automated Fee Cycling (Runs on Volatility)

Even with zero active traders, price movements in paired tokens fuel the cycle:
- Markets move -> V3 positions accumulate fees -> fees sit in pools
- Cycle fires -> Reactor collects, burns, pays, cascades
- Net effect: Automated activity that runs on normal blockchain volatility

### 2. Launcher Alignment (50/50 Split)

Launchers earn 50% of their token's fees every 2 hours. This means:
- Launchers want their token to trade (more volume = more earnings)
- Launchers promote their tokens (network marketing effect)
- More launches = more reactors = bigger fee surface = more burns

### 3. Immutable Infrastructure (No Exit Ramp)

5 reactors are fully renounced:
- No admin key, no multisig, no pause function, no upgrade path
- Bytecode is final. Runs until Base chain stops.
- Credibility anchor for the entire network.

---

## Deployed Contracts (Base, Chain 8453)

| Name | Address | Role |
|------|---------|------|
| V7 Factory | 0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2 | Free token launches |
| SporeReactorV4 Impl | 0x891587AD62bcBc6aceE9061D9C4306b9aB16cE45 | Clone template for V7 reactors |
| ReactorPrimeV3 | 0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA | Terminal MfT burn reactor |
| MfT (Meme for Trees) | 0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3 | Network fuel token |
| Money for Trees | 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072 | USDC-backed deposit receipt |
| CHAR Token | 0x20b048fA035D5763685D695e66aDF62c5D9F5055 | Carbon credit tracking |
| Burn Address | 0xfd780B0aE569e15e514B819ecFDF46f804953a4B | On-chain verified (no private key) |

Full reactor list: tasern.quest/api/unrugable/reactors

---

## For Trading Agents: The Arb Window

Every 2-hour cycle creates predictable price dislocations:

1. **Before cycle:** Secondary reactors fire. Prices compress. Spreads widen.
2. **During cycle:** Upstream propagation. Liquidity consolidates.
3. **At cycle end:** Prime fires. Spreads narrow as liquidity deepens.
4. **Post-cycle:** Organic trading. Spreads re-expand.

**Tools:**
- Direct RPC call to monitor lastExecutionTime()
- Event logs for reactor firing
- tasern.quest/api/unrugable/signals for structured data

---

## For Token Partners: What You Get

**Option 1: Launch on V7 (Free)**
One transaction. Two locked pools. A reactor that burns and pays you. Done.

**Option 2: Add your existing token to a reactor**
Create a V3 LP position pairing your token with MfT (or another network token). Send it to a reactor. Pool fires every 2 hours.

Either way: permanent locked liquidity, automated fee cycling, trading routes across hundreds of pools, and on-chain transparency.

Cost: Zero. No integration fee. No rev-share. No token allocation.

---

## Discovery & Integration

- **Agent SDK:** tasern.quest/api/baseling/agent/ (49 MCP tools)
- **REST API:** tasern.quest/api/unrugable/tokenomics (live metrics)
- **Standards:** llms.txt, .well-known/ai-plugin.json, .well-known/openapi.json
- **Network Map:** tasern.quest/reactor-map.html (visual pool view)
- **Launch:** tasern.quest/unrugable.html

---

**Unrugable by code, not by promise.**
