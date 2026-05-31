# Registry Submission Guide — baselings-mcp + Integrations

Compiled: 2026-05-24
Covers: MCP directories, ElizaOS plugin, DefiLlama adapter, Defined.fi/Codex, Claude Connectors

---

## STATUS SUMMARY

| Submission | Ready? | Effort | Impact | Priority |
|---|---|---|---|---|
| mcp.so | YES | 5 min form | HIGH (20K+ servers listed, most-searched) | 1 |
| Smithery.ai | YES | CLI 5 min | HIGH (active developer marketplace) | 2 |
| MCP.Directory | YES | 5 min form | HIGH (auto-pulls metadata, 24hr listing) | 3 |
| Glama.ai | YES | 2 min | HIGH (22K+ servers, in-browser inspector) | 4 |
| Claude Connectors Directory | NEEDS WORK | 2-3 days | VERY HIGH (Anthropic native, Claude.ai users) | 5 |
| TensorBlock/awesome-mcp-servers PR | YES | 10 min PR | MEDIUM (7260+ servers, fast merge) | 6 |
| royyannick/awesome-blockchain-mcps PR | YES | 10 min PR | MEDIUM (blockchain-specific audience) | 7 |
| mcpservers.org | YES | 5 min form | MEDIUM (routes to wong2 list) | 8 |
| PulseMCP | CHECK FIRST | 2 min | MEDIUM (14K servers, may auto-index) | 9 |
| Official MCP Registry | COMPLEX | 1-2 hours | HIGH (canonical, Anthropic-backed) | 10 |
| DefiLlama | YES (adapter code done) | 30 min PR | HIGH (DeFi credibility, TVL tracking) | 11 |
| ElizaOS Plugin | NEEDS WORK | 2-4 hours | MEDIUM (agent framework ecosystem) | 12 |
| Defined.fi / Codex | AUTOMATIC | 0 effort | N/A (already indexed) | -- |
| GeckoTerminal | AUTOMATIC | 0 effort | N/A (already indexed) | -- |

---

## PART 1: MCP DIRECTORY SUBMISSIONS

### 1.1 mcp.so (Highest Leverage)

The largest MCP directory (20,222+ servers). Most often cited when developers search "list of MCP servers." Claude Desktop users browse this.

**URL:** https://mcp.so/submit

**Required fields:**
- Server name: `Baselings MCP`
- Description (1 sentence): `49 MCP tools for AI agents on Base chain — guardrailed DeFi swaps ($0.10 max), token launches with locked liquidity, reactor burns, portfolio tracking, and yield-generating pet game. No API key required.`
- Tool count: `49`
- Transport type: `stdio`
- GitHub repo: `https://github.com/jimbo530/baselings-mcp`
- Homepage: `https://tasern.quest/agents-onboarding.html`
- Config snippet (for Claude Desktop users):
```json
{
  "mcpServers": {
    "baselings": {
      "command": "npx",
      "args": ["baselings-mcp"],
      "env": {
        "GAME_WALLET_KEY": "your-private-key-here"
      }
    }
  }
}
```

**Status:** READY. Human fills web form. 5 minutes.

---

### 1.2 Smithery.ai (CLI Publish)

Active developer marketplace, 2,880+ servers. Supports managed hosting and OAuth.

**URL:** https://smithery.ai

**Steps:**
```bash
npm install -g @smithery/cli
smithery login
smithery mcp publish https://www.npmjs.com/package/baselings-mcp -n memefortrees/baselings-mcp
```

**Requirements:**
- npm package must be published (baselings-mcp v1.3.0 is live)
- Node.js 20+
- Optional: `smithery.yaml` in repo root for advanced config

**What you get:** Searchable listing, optional managed execution, OAuth integration for clients.

**Status:** READY. Human runs 3 CLI commands. 5 minutes.

---

### 1.3 MCP.Directory (Auto-Pull)

Auto-indexes from GitHub within 24 hours. Pulls metadata (name, description, stars, language, license, README, tool detection).

**URL:** https://mcp.directory/submit

**Steps:**
1. Visit https://mcp.directory/submit
2. Paste: `https://github.com/jimbo530/baselings-mcp`
3. After listing appears (~24hr), claim it for verified badge + edit access

**Status:** READY. 2-minute form submission.

---

### 1.4 Glama.ai (Largest Directory)

22,900+ MCP servers. Features in-browser inspector where visitors can test tools with real JSON-RPC without installing.

**URL:** https://glama.ai/mcp/servers

**Steps:**
1. Go to https://glama.ai/mcp/servers
2. Click "Add Server"
3. Paste GitHub repo URL: `https://github.com/jimbo530/baselings-mcp`
4. Glama auto-indexes every tool, schema, and annotation

**Requirements:** Public GitHub repo (repo is public).

**Optional:** Glama Gateway can run the server on their infra with managed credentials + analytics.

**Status:** READY. 2-minute web submission.

---

### 1.5 Claude Connectors Directory (Anthropic Native)

Gets baselings-mcp into Claude.ai directly. Highest impact for consumer exposure. More complex requirements.

**URL:** Submit via Google Form (MCP Directory Server Review Form)
**Docs:** https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide

**Requirements (CRITICAL):**
1. **Remote MCP server** (not stdio) — currently baselings-mcp is stdio only. NEEDS CONVERSION to Streamable HTTP transport.
2. **Tool annotations on EVERY tool** — must include:
   - `readOnlyHint: true` for read tools (get_balances, get_my_baselings, etc.)
   - `destructiveHint: true` for write tools (buy_egg, swap_token, etc.)
   - Missing annotations cause 30% of rejections.
3. **OAuth authentication** — needs both `claude.ai` and `claude.com` callback URLs
4. **Privacy policy** — published, accessible URL
5. **Documentation** with at least 3 usage examples
6. **Test account** with sample data

**What needs work:**
- [ ] Convert mcp-server.js from stdio to Streamable HTTP (or add dual transport)
- [ ] Add tool annotations to all 49 tools
- [ ] Set up OAuth flow (or determine if API-key auth suffices)
- [ ] Publish privacy policy at a public URL
- [ ] Create 3+ documented usage examples
- [ ] Create test account with pre-seeded game data

**Timeline:** 2-3 days of dev work. Review takes ~2 weeks after submission.

**Status:** NEEDS WORK. High impact but requires transport conversion + annotations.

---

### 1.6 Official MCP Registry (modelcontextprotocol)

Canonical registry maintained by Anthropic/MCP Steering Group. Backed by Anthropic, GitHub, PulseMCP, Microsoft.

**URL:** https://registry.modelcontextprotocol.io
**Repo:** https://github.com/modelcontextprotocol/registry
**Schema:** https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json

**Requirements:**
1. **Namespace authentication** — verify ownership via GitHub account. Server name follows reverse DNS: `io.github.jimbo530/baselings-mcp`
2. **server.json** file in standardized format:
```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.jimbo530/baselings-mcp",
  "description": "49 MCP tools for AI agents on Base chain — guardrailed DeFi swaps, token launches, reactor timing, pet game yield mechanics",
  "packages": [
    {
      "registryType": "npm",
      "registryUrl": "https://registry.npmjs.org",
      "name": "baselings-mcp",
      "version": "1.3.0",
      "transport": "stdio",
      "packageArguments": [],
      "environmentVariables": [
        { "name": "GAME_WALLET_KEY", "description": "Private key for game transactions (optional, read-only without)", "required": false },
        { "name": "TRADE_WALLET_KEY", "description": "Private key for swap execution (optional)", "required": false }
      ]
    }
  ],
  "capabilities": {
    "tools": true,
    "resources": false,
    "prompts": false
  }
}
```
3. **mcpName** in package.json must match server.json name — ALREADY SET: `"mcpName": "io.github.jimbo530/baselings-mcp"`
4. **README** must contain `mcp-name: io.github.jimbo530/baselings-mcp` (can be HTML comment)
5. **Publish via PR** or mcp-publisher CLI (Go binary)

**What's ready:**
- [x] mcpName field in package.json
- [x] npm package published
- [x] Public GitHub repo

**What needs work:**
- [ ] Add `mcp-name: io.github.jimbo530/baselings-mcp` to README
- [ ] Create server.json in repo root
- [ ] Submit PR to modelcontextprotocol/registry OR use mcp-publisher CLI

**Status:** MOSTLY READY. 1-2 hours to finalize server.json and submit PR.

---

### 1.7 Awesome-List GitHub PRs

Already drafted in `mcp-list-submissions.md`. Priority targets:

| Repo | Status | Stars | Merge Speed |
|---|---|---|---|
| TensorBlock/awesome-mcp-servers | VERY ACTIVE | 7260+ | Daily merges |
| royyannick/awesome-blockchain-mcps | ACTIVE | 34 | Weekly |
| appcypher/awesome-mcp-servers | ACTIVE | High | Weekly |
| punkpeye/awesome-mcp-servers | ACTIVE | High | Weekly |
| demcp/awesome-web3-mcp-servers | DORMANT | 608 | Unlikely |

**All PR entries are pre-drafted** in `C:\Users\bigji\Documents\MfT-Launch\marketing\mcp-list-submissions.md`.

**Action:** Fork each repo, add entry, submit PR. Can batch all in one session.

---

### 1.8 PulseMCP (Auto-Index Check)

14,000+ servers. May have already auto-indexed baselings-mcp from npm.

**URL:** https://www.pulsemcp.com/servers

**Action:** Search "baselings" on their site. If not found, submit manually via their form.

---

### 1.9 mcpservers.org (wong2 Routing)

Routes to wong2/awesome-mcp-servers which does not accept direct PRs.

**URL:** https://mcpservers.org/submit

**Fields:**
- Name: `Baselings MCP`
- URL: `https://github.com/jimbo530/baselings-mcp`
- Description: `49 MCP tools for AI agents on Base chain — guardrailed DeFi swaps, token launches with locked liquidity, reactor burns, yield-generating pet game. No API key.`
- Category: Finance/Crypto

**Status:** READY. 5-minute form.

---

## PART 2: ELIZAOS PLUGIN

**Location:** `C:\Users\bigji\Documents\MfT-Launch\integrations\elizaos-plugin\`

### Current State

- `package.json` — exists, name `@elizaos/plugin-unrugable`, version 1.0.0
- `src/index.ts` — 3 actions (GET_UNRUGABLE_TOKENOMICS, GET_UNRUGABLE_TOKENS, GET_UNRUGABLE_TOKEN_INFO)
- Hits API at `https://tasern.quest/api/unrugable`

### What Needs Work for Publishing

**Registry:** https://github.com/elizaos-plugins/registry (PR-based)

**Requirements:**
1. [ ] **Publish to npm** — `npm publish` (needs npm account auth)
2. [ ] **GitHub repo** — push code to a public GitHub repo (e.g., `github.com/jimbo530/elizaos-plugin-unrugable`)
3. [ ] **Images for registry:**
   - `logo.jpg` — 400x400px, max 500KB
   - `banner.jpg` — 1280x640px, max 1MB
4. [ ] **README.md** — clear description, install instructions, usage examples
5. [ ] **Version bump** — update version in package.json if changes made
6. [ ] **Quality check** — ElizaOS core team reviews for:
   - Free of malicious code
   - Functions as intended
   - Proper images and quality description

**Publishing Workflow:**
```bash
# 1. Publish to npm
cd C:\Users\bigji\Documents\MfT-Launch\integrations\elizaos-plugin
npm publish

# 2. Push to GitHub (auto-creates registry PR)
git init && git remote add origin https://github.com/jimbo530/elizaos-plugin-unrugable.git
git add . && git commit -m "Initial publish" && git push -u origin main

# 3. Registry PR is auto-created at elizaos-plugins/registry
# 4. ElizaOS team reviews (1-3 business days)
```

**Improvements recommended before publish:**
- Add more actions (fire_reactor, get_balances, swap tools)
- Add proper error handling (not just callback with raw JSON)
- Add README.md with install/usage instructions
- Create logo and banner images

**Status:** NEEDS WORK. 2-4 hours to polish + publish.

---

## PART 3: DEFILLAMA ADAPTER

**Location:** `C:\Users\bigji\Documents\MfT-Launch\integrations\defillama-adapter\index.js`

### Current State

The adapter is ALREADY WRITTEN and functional:
- Uses `sumTokens2` helper with `resolveUniV3: true`
- Reads factory events to find all reactor addresses
- Sums V3 positions held by reactors (permanently locked)
- Methodology: "TVL is the total value of Uniswap V3 LP positions permanently locked in reactor contracts"
- Chain: Base
- Factory: V4.3 at `0x51eF41E0730c0e607950421e1EE113b089867d3e`

### Submission Process

**Repo:** https://github.com/DefiLlama/DefiLlama-Adapters
**Docs:** https://docs.llama.fi/list-your-project/submit-a-project

**Steps:**
1. Fork `https://github.com/DefiLlama/DefiLlama-Adapters`
2. Create folder: `projects/unrugable-launcher/`
3. Copy `index.js` into that folder
4. Test locally: `node test.js projects/unrugable-launcher`
5. Submit PR with "Allow edits by maintainers" enabled

**PR Template answers (required):**
```
Protocol: Unrugable Launcher
Chain(s): Base
Category: Yield / DEX
Website: https://tasern.quest/launcher/unrugable.html
Twitter: @memefortrees
Methodology: TVL = total value of Uniswap V3 LP positions permanently locked in reactor contracts deployed by the factory. No withdraw function exists — liquidity is locked by the absence of code.
```

**Important notes:**
- Do NOT edit/push package-lock.json
- Enable "Allow edits by maintainers"
- TVL must be computed from blockchain data (it is)
- No fetch adapters for new projects (ours is on-chain only)
- Pools with <$10K TVL won't display on DefiLlama dashboard
- After merge, takes up to 24hr to appear

**What's ready:**
- [x] Adapter code written and tested
- [x] Uses approved helper functions (sumTokens2)
- [x] On-chain only (no fetch)
- [x] Methodology documented

**What needs work:**
- [ ] Fork the repo
- [ ] Test with their test harness (`node test.js`)
- [ ] Submit PR with template answers
- [ ] Verify TVL exceeds $10K threshold for display (check current reactor TVL)

**Status:** READY TO SUBMIT. 30 minutes to fork, test, PR.

---

## PART 4: DEFINED.FI / CODEX / GECKOTERMINAL

### Defined.fi (powered by Codex)

**How it works:** Defined.fi automatically indexes ALL tokens on supported chains (Base is supported). Any token with a Uniswap pool on Base is ALREADY indexed.

**Verification:** Visit `https://www.defined.fi/base/[TOKEN_ADDRESS]` for any of:
- MfT: `0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3`
- POOP: `0x126555aecBAC290b25644e4b7f29c016aE95f4dc`
- CHAR: `0x20b048fA035D5763685D695e66aDF62c5D9F5055`

**No action required** — tokens appear automatically once they have a pool with activity.

**For enhanced listing (logo, description):** Contact Codex directly at codex.io for verification/claiming.

### Codex API

**URL:** https://www.codex.io
**Free tier:** Available (sign up at codex.io)
**Networks:** 80+ including Base (ID: 8453)
**Data:** 70M+ tokens indexed, 700M+ wallets, 16 launchpads

**How to query our tokens:**
```graphql
query {
  token(input: { address: "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3", networkId: 8453 }) {
    name
    symbol
    price
    volume24h
  }
}
```

**Status:** AUTOMATIC. No submission needed. Verify tokens appear correctly.

### GeckoTerminal (CoinGecko)

**URL:** https://www.geckoterminal.com/base/pools

**How it works:** GeckoTerminal ingests ALL trades on supported networks. Any token with DEX activity on Base automatically appears with charts, prices, pool data.

**Verification:** Visit `https://www.geckoterminal.com/base/pools/[POOL_ADDRESS]` for any of our V3 pools.

**No action required** — pools appear automatically.

**API (free):** `https://api.geckoterminal.com/api/v2/networks/base/tokens/[TOKEN_ADDRESS]`

**Status:** AUTOMATIC. Already indexed.

---

## PART 5: PRIORITY EXECUTION ORDER

### Immediate (Today, <1 hour total)

1. **mcp.so** — fill web form (5 min)
2. **Smithery.ai** — `npm i -g @smithery/cli && smithery login && smithery mcp publish` (5 min)
3. **MCP.Directory** — submit GitHub URL (2 min)
4. **Glama.ai** — click Add Server, paste repo URL (2 min)
5. **mcpservers.org** — fill web form (5 min)
6. **PulseMCP** — search first, submit if not found (5 min)

### This Week (2-4 hours)

7. **DefiLlama** — fork, test adapter, submit PR (30 min)
8. **Awesome-list PRs** — batch submit TensorBlock + royyannick + appcypher (30 min)
9. **Official MCP Registry** — add server.json + mcp-name to README, submit (1-2 hr)
10. **Verify Defined.fi/GeckoTerminal** — confirm all tokens show correctly (10 min)

### Next Sprint (2-3 days dev work)

11. **Claude Connectors Directory** — convert to remote transport, add annotations, OAuth
12. **ElizaOS Plugin** — polish, add actions, create images, publish to npm + registry

---

## APPENDIX A: Key URLs

| Resource | URL |
|---|---|
| baselings-mcp npm | https://www.npmjs.com/package/baselings-mcp |
| baselings-mcp GitHub | https://github.com/jimbo530/baselings-mcp |
| Agent onboarding | https://tasern.quest/agents-onboarding.html |
| llms.txt | https://tasern.quest/llms.txt |
| agents.json | https://tasern.quest/.well-known/agents.json |
| OpenAPI spec | https://tasern.quest/.well-known/openapi.json |
| mcp.so submit | https://mcp.so/submit |
| Smithery | https://smithery.ai |
| MCP.Directory | https://mcp.directory/submit |
| Glama | https://glama.ai/mcp/servers |
| mcpservers.org | https://mcpservers.org/submit |
| PulseMCP | https://www.pulsemcp.com/servers |
| Official Registry | https://registry.modelcontextprotocol.io |
| DefiLlama Adapters | https://github.com/DefiLlama/DefiLlama-Adapters |
| ElizaOS Registry | https://github.com/elizaos-plugins/registry |
| Claude Connectors | https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide |

## APPENDIX B: Copy-Paste Descriptions

**One-liner (for forms):**
```
49 MCP tools for AI agents on Base chain — guardrailed DeFi swaps ($0.10 max), token launches with locked liquidity, reactor burns, portfolio tracking, and yield-generating pet game. No API key required.
```

**Short paragraph (for PRs):**
```
Baselings MCP provides 49 tools for AI agents operating on Base (chain 8453). Includes guardrailed DeFi swaps with configurable spend limits, a token launch platform with permanently locked liquidity, autonomous reactor burn mechanics, cross-pool arbitrage signals, and an on-chain pet game with yield mechanics. Every action burns MfT supply. No API key required — install with `npx baselings-mcp`.
```

**Technical (for registries):**
```
stdio MCP server (protocol 2024-11-05) with 49 tools across 12 categories: read state (10), write actions (14), strategy (3), tokenomics (3), economy (3), info (1), token launch (5), reactor (3), swap (4), price (1), portfolio (1), liquidity depth (1). Requires Node.js 18+. Optional env: GAME_WALLET_KEY for write actions, TRADE_WALLET_KEY for swaps.
```
