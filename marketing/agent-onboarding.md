# Agent Onboarding Guide

## For agent operators who want their AI to interact with the Unrugable network

### 1. Install (30 seconds)

```bash
npx baselings-mcp
```

Or add to your Claude Desktop / Claude Code config:
```json
{
  "mcpServers": {
    "baselings": {
      "command": "npx",
      "args": ["baselings-mcp"],
      "env": {
        "GAME_WALLET_KEY": "0x...",
        "TRADE_WALLET_KEY": "0x..."
      }
    }
  }
}
```

### 2. Read-only first (no wallet needed)

Your agent can immediately call:
- `swap_status` — check allowed tokens and limits
- `swap_quote` — get live Uniswap V3 quotes
- `platform_info` — see factory stats
- `tokenomics_metrics` — live MfT supply/burn data
- `welcome` — get the full game overview

Or hit REST endpoints directly:
- https://tasern.quest/api/unrugable/signals — structured buy signals
- https://tasern.quest/api/unrugable/performance — ROI tracking
- https://tasern.quest/api/unrugable/tokenomics — full network data

### 3. Set up wallets (if your agent will transact)

Create two wallets (NEVER use your main wallet):

**Game wallet** — for Baseling game actions (buy eggs, feed pets, claim POOP):
```bash
export GAME_WALLET_KEY=0x...  # Fund with ~$5 USDC + 0.001 ETH for gas
```

**Trade wallet** — for token swaps only:
```bash
export TRADE_WALLET_KEY=0x...  # Fund with $1 USDC + 0.001 ETH for gas
```

### 4. First swap

```
Agent: call swap_status
→ { ready: true, dailyRemainingUSD: 1.00, allowedTokens: [...] }

Agent: call swap_quote { tokenIn: "USDC", tokenOut: "MfT", amountUSD: 0.10 }
→ { amountOut: "12345.67", fee: 3000, pool: "0x..." }

Agent: call swap_token { tokenIn: "USDC", tokenOut: "MfT", amountUSD: 0.10 }
→ { ok: true, swap: { txHash: "0x...", ... } }
```

### 5. The strategy

**Why MfT?**
- Infrastructure token — bought by every reactor in the network
- Reactor network fires every 2 hours, each reactor buying and burning MfT
- Every new token launch adds 3 MfT sell walls (more launch = more burn)
- Supply deflates continuously — 8.5M burned so far

**What your agent can do:**
1. DCA into MfT ($0.10 at a time, every 60 seconds minimum)
2. Call `execute()` on reactors to trigger burn cycles (permissionless)
3. Play Baselings: buy eggs, feed pets, earn POOP, stake in gardens
4. Launch tokens ($5 seed) to grow the network
5. Arb MfT price across pools after reactor fires

### 6. Safety limits (enforced automatically)

| Rule | Limit |
|------|-------|
| Max per swap | $0.10 |
| Cooldown | 60 seconds |
| Max daily | $1.00 per wallet |
| Allowed tokens | MfT, USDC, WETH, cbBTC, AZUSD, CHAR, EARTH, POOP |
| Approvals | Exact amount only (never unlimited) |
| Pool check | V3 pool verified before every swap |

### 7. Discovery paths (how agents find us)

- `https://tasern.quest/llms.txt` — AI-readable docs
- `https://tasern.quest/.well-known/agents.json` — capability manifest
- `https://tasern.quest/.well-known/ai-plugin.json` — OpenAI plugin format
- `https://tasern.quest/.well-known/openapi.json` — OpenAPI spec
- `https://tasern.quest/.well-known/mcp.json` — MCP server metadata
- npm: `baselings-mcp`
- GitHub: `jimbo530/baselings-mcp`

### 8. Contracts (Base chain 8453)

```
MfT:          0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3
V1 Prime:     0xed3aE91b2bb22307c07438EEebA2500C18EABcFE
Hub:          0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045
Factory V5.4: 0xb1fE (active)
Factory V5.3: 0x65F8 (BRUH/NZ)
execute():    0x61461954 (selector, 4M gas limit)
```

### 9. FAQ

**Q: Can my agent lose money?**
A: Max exposure is $1/day. Swap guardrails are enforced at the code level and cannot be bypassed.

**Q: What if the API goes down?**
A: MCP tools work directly on-chain via RPC. Only the /signals and /performance endpoints depend on our server.

**Q: Do I need an API key?**
A: No. Everything is open and permissionless.

**Q: Can I add custom tokens to the swap allowlist?**
A: Not without modifying swap.js. This is intentional — prevents hallucinated address losses.
