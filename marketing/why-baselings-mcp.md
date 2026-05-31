# Why baselings-mcp?

Your AI agent needs on-chain tools. Here's why baselings-mcp is the right choice.

---

## Feature Comparison

| Capability | Generic DeFi APIs (0x, 1inch) | Basic MCP Servers | Direct Contract Integration | baselings-mcp |
|---|---|---|---|---|
| **MCP-native** | No (REST/SDK) | Yes | No (ABI encoding) | Yes |
| **Read tools** | Price quotes only | Yes (5-15 tools) | Manual | 49 tools |
| **Write/execute tools** | Swap endpoints | Rarely | Full access | Yes, with guardrails |
| **Safety guardrails** | None | None | None | $0.10/swap max, $1/day cap, slippage limits |
| **Token launch** | No | No | Build it yourself | One tool call — locked LP, 8 pools |
| **Reactor/burn mechanics** | No | No | No | fire_reactor across the network of autonomous reactors |
| **Game integration** | No | No | No | Pet stats, eggs, food, yield tracking |
| **Arbitrage signals** | No | No | Build it yourself | arb_signal compares cross-pool prices |
| **No API key needed** | API key required | Usually API key | RPC only | No key. npx baselings-mcp. |
| **Cost** | Free tier + overage fees | Free | Gas only | Free. Zero fees beyond gas. |
| **Install** | npm + config + auth | npm + config | Custom setup | `npx baselings-mcp` — runs immediately |

---

## 3 Key Differentiators

### 1. Guardrails built in — your agent cannot rug itself

Generic DeFi tools hand your agent an unlimited swap endpoint and wish it luck. baselings-mcp enforces hard limits at the tool level:

- Maximum $0.10 per swap
- Maximum $5.00 per day cumulative spend
- Slippage protection on every trade
- No approval for unlimited token spend

Your agent gets on-chain agency without the ability to drain its own wallet on a bad decision.

### 2. Strategy tools, not just read/write primitives

Most MCP servers give you `getBalance` and `sendTransaction`. That is a screwdriver, not a workshop. baselings-mcp includes:

- **reactor_timing** — which burn reactors can fire, when, estimated output
- **arb_signal** — cross-pool price discrepancies with projected profit
- **liquidity_depth** — pool health, depth, concentration across all pairs
- **mft_price / token_prices** — live pricing from on-chain state
- **launch_token** — deploy a token with 8 permanently locked LP pools in one call

49 tools covering DeFi operations, game mechanics, market intelligence, and autonomous reactor management.

### 3. Real ecosystem, not a wrapper

baselings-mcp is not a thin layer over a public API. It connects to:

- A network of autonomous burn reactors (renounced contracts, no admin keys)
- A pet game with on-chain stat progression and yield mechanics
- A token launch platform with locked-forever liquidity
- Carbon offset reactors (CHAR) burning tokens for environmental impact

Every tool call interacts with live, immutable smart contracts on Base. The ecosystem generates real volume, real burns, and real impact.

---

## Quick Start

```bash
npx baselings-mcp
```

That is it. No API key. No config file. No wallet setup (bring your own private key via env var). Your MCP client connects, discovers 49 tools, and your agent is on-chain.

---

## Who is this for?

- **Agent builders** who want their AI to trade, launch tokens, or manage DeFi positions on Base
- **Autonomous agent frameworks** (AutoGPT, CrewAI, custom loops) that need structured on-chain tools
- **MCP client developers** looking for a real-world DeFi integration to showcase
- **Impact-focused projects** wanting agents that generate charitable yield while operating

---

## Links

- GitHub: https://github.com/jimbo530/baselings-mcp
- npm: https://www.npmjs.com/package/baselings-mcp
- Install: `npx baselings-mcp`
