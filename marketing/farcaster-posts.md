# Farcaster Posts

## Post 1 — /defi

The MfT reactor network runs on Base, firing every 2 hours across hundreds of pools. Each cycle: collect V3 fees, burn tokens, cycle cross-tokens through the network, cascade fees upstream. Five reactors are fully renounced. The rest have add-only admin keys — no withdrawal capability. One organic trade creates arb across every connected pair. Fragmented liquidity is the feature, not a bug. Verify any of this on a block explorer. That's the entire trust model.

## Post 2 — /base

Launched a token on Base with Unrugable. Cost: $5 seed. Result: locked V3 liquidity across 8 pools, reactor integration, automated buy+burn every 2 hours. No VC raise. No dev allocation drama. The reactor at 0xed3a (V1 Prime) has 12 pools and fires on a 2-hour cycle permanently. Five reactors are fully renounced and immutable. Six more added this week from adopted orphan tokens. Building on Base because the gas costs let small-scale DeFi actually work. MfT: 0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3

## Post 3 — /agents

baselings-mcp: 49 MCP tools for on-chain agents. npm package, plug into any Claude/agent framework. Read reactor state, fire cycles, check pool positions, execute game actions, query LP data. The reactor network is permissionless — anyone (or anything) can call execute(). Built for agents that do things, not agents that tweet about doing things. If your agent stack needs real DeFi interaction on Base, this is the toolkit.

## Post 4 — /climate

Every 2 hours, the Unrugable reactor network fires on Base. One of the tokens in the system is CHAR — a carbon credit token where 1 CHAR = 1 lb CO2e biochar. The CHAR reactor is live, actively collecting CHAR from LP trading fees — removing high-quality carbon credits from markets permanently. Collections go to a dedicated address. Every trade on a reactor pool generates fees that remove carbon credits from circulation. Collected CHAR is held permanently at a tracking address with no withdraw function -- a public on-chain ledger of every carbon credit the ecosystem has removed from markets.

## Post 5 — /defi

The reactor heartbeat: secondary reactors push MfT into sell walls below price (compression). V1 Prime fires last, buying through all that accumulated MfT with fees from the entire reactor network (release). Bought MfT gets burned permanently. The cycle resets every 2 hours. Even without active traders, BTC and ETH price movements create baseline fees in cbBTC/WETH pools — the heartbeat never fully stops. With active volume, the 3% slippage cap gets hit across all 12 Prime pools simultaneously. That's automated fee cycling from code, not a whale. No price promises — just a mechanism that runs.

## Post 6 — /base

New tool on Base: reactor card shop. After you launch a token on Unrugable, open the card shop and add any token as a trading pair for $5. BRETT, DEGEN, WETH — one click, permanent V3 pool, fires every 2 hours. Deepen your liquidity with unlimited cards. tasern.quest/launcher/

## Post 7 — /defi

Feed Fuel = deposit USDC into any reactor pool. Every 2 hours the reactor cycles ~3% of that fuel through the network — burns tokens, funds charity, generates trading activity. No bots, no coordination needed. Just code running on a timer. tasern.quest/launcher/

## Post 8 — /build

Built a card shop for reactor management. Buy cards to add custom token pairs by contract address, deposit fuel for automated buys, manage all pools from one interface. Everything is on-chain and permanent — no admin keys, no withdrawal, just pools that fire forever. tasern.quest/launcher/

## Post 9 — /base

Multiple launches on Unrugable — each one adds locked pools to the reactor network. Every pool fires every 2 hours. Platform is live and growing. tasern.quest/launcher/

## Post 10 — /agents

New endpoint for autonomous agents: tasern.quest/api/unrugable/signals

Returns structured buy signals: Reactor Prime cooldown timer, MfT supply (total/burned/circulating), network stats (reactor count, pool count), and a formatted buy opportunity object. 4 RPC calls, no API key. Your agent reads JSON, decides whether to accumulate $MfT based on reactor timing and deflationary math. Discovery: tasern.quest/llms.txt

## Post 11 — /agents

If your agent can call npm packages: `npx baselings-mcp` — 49 MCP tools for Base chain DeFi. Launch tokens ($5 seed, 8 locked LP positions), fire reactors (permissionless execute() every 2hrs), play yield-generating pet game, read pool/reactor/token state. Works with Claude, any MCP-compatible framework. No API key. REST + on-chain. Listed on awesome-mcp-servers. npmjs.com/package/baselings-mcp

## Post 12 — /agents

The reactor network creates predictable arb every 2 hours. Each reactor fire sells through MfT-paired pools (compression). Then V1 Prime fires last with accumulated fees from the entire reactor network (buy-back). Price dislocation across hundreds of pools. Arb bots equalize, generating more fees. The cycle repeats forever. Your agent can call execute() on any reactor — it's permissionless. Check readiness: tasern.quest/api/unrugable/signals

## Post 13 — /agents

Agent infrastructure stack on Base:
- Discovery: llms.txt + ai-plugin.json + openapi.json
- Data: /tokenomics (15 fields, zero RPC) + /signals (live reactor state)
- Tools: 49 MCP tools via npx baselings-mcp
- Execute: permissionless execute() on every reactor
- Stake: MfT Community Garden for directed liquidity

Built for agents that allocate capital, not agents that summarize whitepapers. tasern.quest/agents.html
