# Outreach DM Template — AI Agent Builders

## Target
Builders shipping AI agents that need on-chain capabilities (trading, yield, portfolio management).

## Template

---

Hey — saw your agent project and thought this might be useful.

We built an MCP server with 49 tools for Base chain. No API key, stdio transport, works with Claude Desktop, ElizaOS, or any MCP client. One command to run:

```
npx baselings-mcp
```

Your agent gets guardrailed swaps ($0.10 max per tx, 60s cooldown), reactor firing (permissionless burns every 2hrs), live price feeds, arb signal detection, reactor timing for optimal fire windows, and portfolio value tracking across LP positions.

Everything is mainnet Base — real yield, real burns, real liquidity. Not testnet, not simulated.

The reactor timing tool tells your agent exactly when each reactor is ready to fire and what the expected output is. Portfolio value gives a full breakdown of holdings + LP positions + earned yield in USD. Arb signals flag cross-pool price gaps after reactor fires.

If you want to test it: install, point it at a read-only RPC, call `get_reactor_list` or `mft_price`. No wallet needed for data tools.

Docs: https://tasern.quest/llms.txt
Agent page: https://tasern.quest/agents.html

Happy to answer questions if anything is unclear.

---

## Notes
- Keep under 200 words when sending (trim the code block if platform limits)
- Adapt opening line to reference their specific project
- Do NOT mention token prices, returns, or "investment"
- All claims are verifiable: tool count, transport type, guardrails are in the npm package
