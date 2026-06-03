# MCP Registry Submissions Tracker

## Submitted (done)

| Registry | Method | Status | Link |
|----------|--------|--------|------|
| awesome-mcp-servers | GitHub PR | ACCEPTED - merged | PR #6127 |
| Glama.ai | Auto-indexed | ACCEPTED - live (unclaimed) | MIT license added |
| modelcontextprotocol/servers | GitHub Issue | Pending review | Issue #4127 |
| mcp.so | GitHub Issue comment | Pending review | chatmcp/mcpso#1 |
| TensorBlock/awesome-mcp-servers | GitHub PR | Pending review | PR #521 |
| royyannick/awesome-blockchain-mcps | GitHub PR | Pending review | PR #61 |
| PulseMCP | Web form | CLOSED (no longer accepting) | - |
| mcp.directory | Web form | Pending review | - |

### Summary
- **Accepted (2):** awesome-mcp-servers (main list), Glama.ai
- **Pending (5):** modelcontextprotocol/servers, mcp.so, TensorBlock, royyannick/awesome-blockchain-mcps, mcp.directory
- **Closed (1):** PulseMCP

Note: Tool count in all pending submissions says 43. Update descriptions after v1.2.0 publishes (49 tools).

## Needs web form (user action, ~2 min each)

### MCP Server Hub
- URL: https://mcpserverhub.net/submit
- What to submit: Name, description, category (DeFi/Gaming), supported models

### MCPMarket
- URL: https://mcpmarket.com/submit
- What to submit: GitHub repo URL

## Needs CLI auth (user action)

### Smithery.ai
```bash
npx smithery auth login
smithery mcp publish "npx baselings-mcp" -n jimbo530/baselings-mcp
```
Config: smithery.yaml already in repo

### Official MCP Registry
```bash
# Install publisher (if available)
npx mcp-publisher login github
npx mcp-publisher publish
```
Config: server.json already in repo

## Copy-paste description for web forms

**Short (1 line):**
49 MCP tools for AI agents on Base chain — DeFi swaps, token launches, reactor burns, yield farming

**Medium (3 lines):**
49 MCP tools for AI agents on Base chain. Token swaps with safety guardrails ($0.10 max, $1/day cap), fire_reactor to trigger the reactor network of autonomous burn reactors, launch tokens with permanently locked liquidity (free, just gas), play yield-generating pet game. No API key. npx baselings-mcp.

**Categories:** DeFi, Gaming, Finance, Blockchain
**GitHub:** https://github.com/jimbo530/baselings-mcp
**npm:** https://www.npmjs.com/package/baselings-mcp
**Install:** npx baselings-mcp
