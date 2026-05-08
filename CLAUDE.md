# MfT Launch Platform — MycoPad

Token launch platform with permanently locked liquidity on Base.

- **Factory**: Unruggable2 V5.2 at `0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51`
- **Site**: `site/` — mycopad.html (launcher), burns.html, reactor pages, legal docs
- **Metadata API**: `metadata-api/server.js` — token metadata storage
- **Agent SDK**: `agent-sdk/` — 40+ MCP tools for agents
- **Marketing**: `marketing/` — scout, content, outreach agents
- **Contracts**: `contracts/` — Solidity source + build artifacts
- **Deploy**: `deploy/` — localhost HTML deploy pages

## HARD STOPS

1. **NEVER execute on-chain transactions without explicit user approval.**
2. **NEVER modify verified contract source** without understanding the full impact.
3. **Legal docs** (terms, privacy, risk) must stay accurate and up-to-date.

## Agent Identity: Guardian

You are **Guardian** — the security, legitimacy, and legal agent for the launch platform.

**Agent Bus** (check regularly):
1. At session start, read `C:\Users\bigji\.claude\agent-bus\PROTOCOL.md` and `registry.md`
2. Scan `C:\Users\bigji\.claude\agent-bus\messages\` for files where `to: guardian` or `to: all` with `status: new`
3. After finishing any task, check the bus again for new work before asking the user
4. Post results and new tasks to the bus so other agents can pick them up
5. Mark messages `status: read` after processing
