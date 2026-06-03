# Community Posts — Agent Channels

## Reddit r/MCP (or r/ClaudeAI, r/LocalLLaMA)

### Title: baselings-mcp — 49 MCP tools for DeFi on Base chain (token swaps, reactor burns, yield farming)

Built an MCP server for AI agents that actually do things on-chain:

- **Token swaps** with safety guardrails ($0.10 max, 60s cooldown, allowlisted tokens only)
- **Fire autonomous burn reactors** — permissionless `execute()` every 2 hours across the reactor network
- **Launch tokens** with permanently locked liquidity (free to launch, just gas)
- **Yield-generating pet game** — buy eggs, feed pets, earn POOP, stake in gardens

49 tools total. No API key. Works with Claude Desktop, Claude Code, or any MCP-compatible framework.

```bash
npx baselings-mcp
```

The reactor network creates predictable price dislocations every 2 hours across the network. Your agent can check readiness at `/signals`, call `execute()`, and arb the spread.

Discovery endpoints (no auth):
- tasern.quest/llms.txt
- tasern.quest/.well-known/agents.json
- tasern.quest/api/unrugable/signals

GitHub: github.com/jimbo530/baselings-mcp
npm: npmjs.com/package/baselings-mcp

---

## Discord / Telegram (shorter format)

### Agent builders channel

New MCP server: **baselings-mcp** — 49 tools for DeFi on Base

What it does:
- Swap tokens on Uniswap V3 (guardrailed: $0.10 max)
- Fire autonomous burn reactors (permissionless)
- Launch tokens with locked liquidity (free, just gas)
- Play yield-generating pet game

No API key. `npx baselings-mcp` and go.

The reactor network fires every 2hrs creating arb across the network. Your agent can time it, fire it, profit from it.

Signals: tasern.quest/api/unrugable/signals
npm: npmjs.com/package/baselings-mcp

---

## Twitter/X thread (agent-focused)

**1/4**
Built 49 MCP tools for AI agents on Base chain.

Your agent can now:
- Swap tokens (Uniswap V3, guardrailed)
- Fire autonomous burn reactors
- Launch tokens with locked liquidity
- Play a yield-generating pet game

`npx baselings-mcp`

No API key. No auth.

**2/4**
The reactor network creates predictable volume events every 2 hours.

Reactors fire → sell through MfT pools → price dislocation across the network → V1 Prime fires last with accumulated fees → big buy-back.

Your agent can check `/signals`, call execute(), and arb the spread.

**3/4**
Safety guardrails baked into the swap tool:
- $0.10 max per swap
- 60s cooldown
- $1/day limit
- 8-token allowlist (checksum validated)
- Exact approvals only

This isn't a "send your agent $10K and let it rip" situation. It's designed for autonomous micro-accumulation.

**4/4**
Discovery layer for other agents:
- llms.txt (AI-readable docs)
- agents.json (capability manifest)
- /signals (structured buy opportunities)
- /performance (ROI tracking)

Everything at: tasern.quest/llms.txt
npm: baselings-mcp

Built for agents that allocate capital, not agents that summarize whitepapers.

---

## Hacker News (Show HN format)

### Show HN: 49 MCP tools for on-chain DeFi agents (Base chain)

We built an MCP server that gives AI agents real DeFi capabilities on Base chain:

1. Token swaps with safety guardrails ($0.10 max per swap, 60s cooldown, token allowlist, V3 pool verification)
2. Permissionless reactor execution — call execute() on autonomous burn contracts every 2 hours
3. Token launches with permanently locked liquidity (free to launch — 2 locked pools + 1 reactor)
4. Yield-generating pet game — the game mechanics generate real DeFi yield

The interesting bit is the reactor network: contracts fire on a 2-hour clock, creating predictable price dislocations across the network. We built signal endpoints that let agents time these events.

The swap tool is intentionally limited ($0.10/swap, $1/day) because we lost $95 to a hallucinated address and $50 to a wrong pool type assumption. Every guardrail maps to a real loss event.

Stack: Node.js, ethers.js, Uniswap V3 on Base (chain 8453). MCP transport over stdin/stdout.

npm: baselings-mcp
GitHub: github.com/jimbo530/baselings-mcp
Signals API: tasern.quest/api/unrugable/signals
