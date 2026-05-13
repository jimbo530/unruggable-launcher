# Unruggable Launcher MCP Server

**Read-only agent interface to the [Unruggable Launcher](https://tasern.quest/launcher/) on Base.** Wraps the live API as MCP tools so any AI agent (Claude Desktop, Cursor, custom) can discover launched tokens, read tokenomics, inspect reactors, and reason about the network.

> Sibling of [`baselings-mcp`](https://github.com/jimbo530/baselings-mcp) — same pattern, different surface.

## Tools

| Tool | Description |
|------|-------------|
| `get_tokenomics` | Full infrastructure breakdown — infra tokens (MfT/BB/EB/AZUSD/CHAR), reactor chain, fee routing |
| `list_launched_tokens` | Every token launched via the factory, with metadata |
| `get_token_metadata` | Detailed metadata for one address |
| `get_factory_info` | Factory deploy block, recent launches |
| `check_is_reactor` | Is this address a known reactor? Returns metadata if so |
| `token_image_url` | URL of token image (for rendering / embedding) |
| `unruggable_pitch` | Agent-facing explainer — "why does this network exist and how do I reason about it" |
| `reactor_chain_summary` | Human-readable reactor chain (per-token → CHAR → Hub → Prime) |

All tools are **read-only**. No wallet required, no transactions signed.

## Quick start

Requires Node 18+ (uses native `fetch`).

```bash
# Run directly
node mcp-server.js

# Or via npm script
npm start

# Smoke-test it
npm test
```

The server speaks newline-delimited JSON-RPC over stdin/stdout — the standard MCP transport.

## Claude Desktop config

Copy `claude-desktop-config.example.json` into your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS) and update the path:

```json
{
  "mcpServers": {
    "unruggable-launcher": {
      "command": "node",
      "args": ["/absolute/path/to/unruggable-launcher/mcp-server/mcp-server.js"]
    }
  }
}
```

Restart Claude Desktop. The 8 tools above will appear under the MCP tools menu.

## Environment variables (optional)

| Var | Default | Purpose |
|-----|---------|---------|
| `UNRUGGABLE_API_BASE` | `https://tasern.quest/api/mycopad` | Override the API base — useful for staging / local backends |
| `UNRUGGABLE_TIMEOUT_MS` | `15000` | Fetch timeout in ms |

## Why this exists

The `unruggable-launcher` repo already ships `llms.txt`, `ai-plugin.json`, and an OpenAPI spec at `tasern.quest` for agent discovery. This MCP server is the next step: agents that speak MCP (Claude Desktop, Cursor, custom Claude API integrations) can call the launcher API as first-class tools instead of having to parse documentation and assemble HTTP requests.

Companion to the [DefiLlama adapter](../defillama-adapter/) (publishes TVL) and the [elizaos plugin](../elizaos-plugin/) (Eliza agents). Different agent runtimes, same underlying network.

## What's NOT in here

This server is **read-only by design**. It does not:
- Sign any transactions
- Hold any private keys
- Call `execute()` on reactors
- Launch tokens

If you want a write-capable agent — fire reactors, launch tokens, arb across pools — that's a separate concern that needs careful wallet management + spending caps (see [`baselings-mcp`](https://github.com/jimbo530/baselings-mcp) for the pattern). Happy to add it as a follow-up.

## License

MIT
