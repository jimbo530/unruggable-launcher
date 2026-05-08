# MCP Registry Submissions — baselings-mcp

Package: `baselings-mcp` on npm (v1.0.0)
Install: `npm install -g baselings-mcp` or `npx baselings-mcp`
Repo: https://github.com/memefortrees (if public) or npm link
Docs: https://tasern.quest/api/baseling/agent/openapi.yaml
llms.txt: https://tasern.quest/llms.txt

## 1. mcpservers.org (FREE submission)

URL: https://mcpservers.org/submit

**Fields:**
- Server Name: `Baselings MCP`
- Short Description: `40 MCP tools for AI agents to play a yield-generating pet game on Base chain. Earn USDC/ETH/BTC by raising virtual pets. Impact: every action burns tokens and retires carbon credits.`
- Link: `https://www.npmjs.com/package/baselings-mcp`
- Category: `Other` (or `Development` if that fits better)
- Contact Email: `mftstudio@proton.me`

**Status:** READY TO SUBMIT (needs human to fill web form)

---

## 2. awesome-mcp-servers (punkpeye) — GitHub PR

URL: https://github.com/punkpeye/awesome-mcp-servers

**PR entry to add:**
```
| [Baselings MCP](https://www.npmjs.com/package/baselings-mcp) | 40 tools for AI agents to play Baselings — a Tamagotchi-meets-DeFi pet game on Base chain. Earn yield, burn tokens, retire carbon. | [npm](https://www.npmjs.com/package/baselings-mcp) |
```

**Category:** Finance / Gaming / Blockchain (whichever exists)

**Status:** READY TO PR (needs human or gh CLI)

---

## 3. awesome-mcp-servers (wong2)

URL: https://github.com/wong2/awesome-mcp-servers
Note: Redirects submissions to mcpservers.org — same as #1

---

## 4. Official MCP Registry (modelcontextprotocol)

URL: https://registry.modelcontextprotocol.io
Tool: `mcp-publisher` CLI (Go, build from source)
Repo: https://github.com/modelcontextprotocol/registry

**Namespace:** Would need to verify via GitHub or DNS
**server.json format:**
```json
{
  "name": "io.github.memefortrees/baselings-mcp",
  "description": "40 MCP tools for AI agents to play Baselings — a yield-generating pet game on Base chain",
  "package": {
    "type": "npm",
    "name": "baselings-mcp"
  },
  "environment": {
    "GAME_WALLET_KEY": {
      "description": "Private key for game transactions",
      "required": true
    }
  },
  "capabilities": {
    "tools": true,
    "resources": false,
    "prompts": false
  }
}
```

**Status:** COMPLEX — needs Go CLI build + GitHub auth. Lower priority.

---

## 5. Smithery.ai (CLI submission)

URL: https://smithery.ai
Registry: 2,880+ MCP servers. Active, growing daily.

**Submission:** Via Smithery CLI
```bash
npm install -g @smithery/cli
smithery login
smithery mcp publish https://www.npmjs.com/package/baselings-mcp -n memefortrees/baselings-mcp
```

**Description for listing:**
`40 MCP tools for AI agents to play Baselings (Tamagotchi-meets-DeFi on Base), launch tokens via MycoPad, fire reactors, and earn yield. Every action burns tokens + retires carbon.`

**Benefits:** Gets discovered by agent developers, Smithery generates OAuth modals if needed, built-in infrastructure.

**Status:** READY — needs `npm install -g @smithery/cli` then publish. Human can run CLI.

---

## 6. Glama.ai (GitHub repo submission)

URL: https://glama.ai/mcp/servers
Registry: 22,900+ MCP servers. Largest MCP directory.

**Submission:** Click "Add Server" on glama.ai/mcp/servers. Submit the GitHub repo URL. Glama indexes every tool, schema, and annotation automatically.

**What you get:**
- In-browser inspector (visitors test tools with real JSON-RPC, no install)
- Categorized search listing
- Optional: Glama Gateway runs your server on their infra with managed credentials + analytics

**Requirements:** Public GitHub repo for baselings-mcp

**Status:** READY once npm package has a public GitHub repo. If repo is private, needs to be made public first or use npm link.

---

---

## 7. PulseMCP (auto-index, 14,000+ servers)

URL: https://www.pulsemcp.com/servers
Registry: 14,000+ MCP servers, updated daily.

**Submission:** Auto-indexes from npm/GitHub. If baselings-mcp is on npm with proper package.json metadata, it should appear automatically. Can also submit manually via their site.

**Status:** CHECK if already indexed. If not, submit manually.

---

## 8. MCP.Directory (auto-pull + verified badge)

URL: https://mcp.directory/submit
Registry: Auto-pulls metadata from GitHub within 24 hours.

**Submission:** Submit at https://mcp.directory/submit. Can claim listing for verified badge and edit access.

**Status:** READY — submit URL, claim listing for badge.

---

## 9. mkinf

URL: https://mkinf.io
Registry: MCP server registry with hosted execution.

**Submission:** Check GitHub repo and docs for submission process.

**Status:** NEEDS RESEARCH on exact submission flow.

---

## Priority Order
1. mcpservers.org (free, simple web form, high visibility) — HUMAN: fill form
2. Smithery.ai (CLI publish, 5 min) — HUMAN: run `smithery mcp publish`
3. MCP.Directory (submit URL, get verified badge) — HUMAN: fill form
4. Glama.ai (submit GitHub repo, 2 min) — HUMAN: click "Add Server" + paste repo URL
5. PulseMCP (may auto-index from npm, check first) — HUMAN: verify or submit
6. punkpeye/awesome-mcp-servers PR (GitHub, community, backlinks) — HUMAN: `gh pr create`
7. Official MCP Registry (highest impact but most complex) — LATER
8. mkinf (needs research) — LATER

## Human Action Checklist

```
[ ] 1. Go to https://mcpservers.org/submit
     - Name: Baselings MCP
     - Description: 40 MCP tools for AI agents to play a yield-generating pet game on Base chain. Earn USDC/ETH/BTC by raising virtual pets. Impact: every action burns tokens and retires carbon credits.
     - Link: https://www.npmjs.com/package/baselings-mcp
     - Category: Other
     - Email: mftstudio@proton.me

[ ] 2. Run in terminal:
     npm install -g @smithery/cli
     smithery login
     smithery mcp publish https://www.npmjs.com/package/baselings-mcp -n memefortrees/baselings-mcp

[ ] 3. Go to https://glama.ai/mcp/servers → click "Add Server"
     - Paste GitHub repo URL for baselings-mcp
     (Requires public repo — if private, make public first)

[ ] 4. Go to https://mcp.directory/submit
     - Submit baselings-mcp URL
     - Claim listing for verified badge

[ ] 5. Check https://www.pulsemcp.com/servers — search "baselings"
     - If not indexed, submit manually
     - If indexed, verify metadata is correct

[ ] 6. Fork https://github.com/punkpeye/awesome-mcp-servers
     Add under Finance/Gaming/Blockchain:
     | [Baselings MCP](https://www.npmjs.com/package/baselings-mcp) | 40 tools for AI agents to play Baselings — a Tamagotchi-meets-DeFi pet game on Base chain. Earn yield, burn tokens, retire carbon. | [npm](https://www.npmjs.com/package/baselings-mcp) |
     Submit PR.
```
