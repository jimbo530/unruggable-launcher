# baselings-mcp Terminal Demo Script — 60 Seconds

Recording tool: asciinema or screen capture with terminal in focus.
Resolution: 1920x1080, font size 16pt, dark background.
Pace: Commands pre-typed, paste in. Responses appear live.

---

## [0:00 - 0:10] Install and Start

**Narration:** "baselings-mcp gives your AI agent 49 on-chain tools with one command. No API key. No config."

**Terminal:**
```bash
$ npx baselings-mcp
```

**Expected output:**
```
baselings-mcp v1.2.0
Connected to Base chain (chainId: 8453)
MCP server running on stdio
49 tools registered
Waiting for client connection...
```

**Screen note:** Hold on the "49 tools registered" line for 2 seconds.

---

## [0:10 - 0:20] Live Egg Prices

**Narration:** "Query live on-chain data. Here are the current gacha egg prices from the Baseling pet game."

**Tool call (shown in terminal as MCP request/response):**
```json
{"tool": "get_egg_prices"}
```

**Expected response:**
```json
{
  "common_egg": "0.001 ETH",
  "rare_egg": "0.005 ETH",
  "epic_egg": "0.025 ETH",
  "legendary_egg": "0.1 ETH",
  "source": "BaselingEggs contract (Base)"
}
```

**Screen note:** Highlight that these are live chain reads, not cached.

---

## [0:20 - 0:30] MfT Token Price

**Narration:** "Check token prices directly from liquidity pools. No API middleman."

**Tool call:**
```json
{"tool": "mft_price"}
```

**Expected response:**
```json
{
  "mft_usd": "0.000847",
  "mft_eth": "0.000000342",
  "pool": "MfT/WETH V2",
  "liquidity_usd": "12,450",
  "24h_volume": "1,240"
}
```

**Screen note:** Price reads directly from Uniswap V2 reserves. No oracle dependency.

---

## [0:30 - 0:40] Reactor Timing

**Narration:** "The reactor network runs autonomous burn contracts. Check which ones are ready to fire."

**Tool call:**
```json
{"tool": "reactor_timing"}
```

**Expected response:**
```json
{
  "reactors_ready": 3,
  "reactors_cooling": 12,
  "next_fire": {
    "name": "Prime Reactor",
    "address": "0xed3a....",
    "can_fire": true,
    "fuel_available": "2.45 USDC",
    "estimated_burn": "1,200 MfT"
  },
  "total_reactors": "dynamic"
}
```

**Screen note:** Reactors are renounced contracts. No admin can stop them. Show the "can_fire: true" prominently.

---

## [0:40 - 0:50] Arbitrage Signal

**Narration:** "Your agent can spot cross-pool price differences automatically."

**Tool call:**
```json
{"tool": "arb_signal"}
```

**Expected response:**
```json
{
  "opportunities": [
    {
      "token": "MfT",
      "buy_pool": "MfT/USDC V3 (0.3%)",
      "sell_pool": "MfT/WETH V2",
      "spread_pct": "1.2%",
      "max_size": "0.10 USDC",
      "note": "Guardrail: $0.10 max swap enforced"
    }
  ],
  "scanned_pools": 48
}
```

**Screen note:** Emphasize the guardrail line. The agent sees the opportunity but cannot over-trade.

---

## [0:50 - 1:00] Liquidity Depth

**Narration:** "And full liquidity health across the ecosystem. 49 tools. Zero config. baselings-mcp."

**Tool call:**
```json
{"tool": "liquidity_depth"}
```

**Expected response:**
```json
{
  "total_pools": 48,
  "total_tvl_usd": "34,200",
  "healthy_pools": 41,
  "thin_pools": 7,
  "deepest": {
    "pair": "MfT/WETH",
    "tvl": "8,400",
    "type": "V2"
  }
}
```

**Closing frame (text overlay, not spoken):**
```
npx baselings-mcp
github.com/jimbo530/baselings-mcp
49 tools. No API key. Your agent, on-chain.
```

---

## Recording Notes

- Total narration word count: ~95 words at moderate pace = 55-60 seconds
- Pre-run all queries once to confirm response shapes before recording
- If any response takes >2 seconds, cut/splice in post (chain RPC can be slow)
- Terminal font: JetBrains Mono or similar monospace
- Consider adding a subtle typing sound effect for tool calls
- JSON responses should be syntax-highlighted if the terminal supports it

## Post-Production

- Add "baselings-mcp" watermark in bottom-right
- Upload to: YouTube (unlisted), Loom (shareable link), and keep MP4 for grant submissions
- Link in README, npm page description, and registry listings
