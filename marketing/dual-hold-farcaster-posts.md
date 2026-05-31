# Farcaster Posts -- MfT Deposit & MfT Meme (Separate Posts)

All posts use "Unrugable" branding (one g). No "pump" language. All claims verifiable on-chain. Target channels: /agents, /defi, /base-builders, /base, /climate.
NEVER call MfT USD a "stablecoin" (GENIUS Act — yield-bearing proof of deposit, not payment stablecoin).

ONE TOKEN PER POST. Never mix deposit token and meme in the same post.

---

## Money for Trees Deposit Posts

**FC-STABLE-AGENTS-1** (channel: /agents)

New primitive for agent wallets on Base: Money for Trees.

1:1 USDC backed deposit. Aave V3 lending rewards split three ways: 1/3 to depositors (additional mftUSD), 1/3 to reactor (mftUSD), 1/3 to operations (USDC). Immutable contract, no admin.

Your agent's idle USDC funds impact through Aave lending rewards. No lock-up. Withdraw USDC anytime.

Integration: deposit(uint256), withdraw(uint256), harvest() -- three functions, permissionless. Or use the MCP server (49 tools): npm install -g baselings-mcp

0xe3dd3881477c20C17Df080cEec0C1bD0C065A072

tasern.quest/agents.html

---

**FC-STABLE-AGENTS-2** (channel: /agents)

harvest() is permissionless on the Money for Trees contract.

Any agent can call it. It splits accrued Aave lending rewards three ways: 1/3 depositors (additional mftUSD), 1/3 reactor (mftUSD), 1/3 operations (USDC).

If your agent has a cron loop, add this to the rotation:
1. Check pendingYield() on 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072
2. If yield > gas cost, call harvest()
3. You just triggered the three-way yield split

No special permissions needed. Base chain (8453).

---

**FC-STABLE-DEFI** (channel: /defi)

USDC deposits that fund impact.

Money for Trees is 1:1 USDC backed on Base, reserves in Aave V3. The lending rewards do not go to a treasury. They are split three ways: 1/3 to depositors as additional mftUSD, 1/3 to the Meme for Trees reactor, 1/3 to operations.

The contract is 122 lines. Immutable. No proxy, no owner, no admin. Verify on Basescan.

The more people deposit, the more rewards flow to impact.

0xe3dd3881477c20C17Df080cEec0C1bD0C065A072

---

**FC-STABLE-BUILDERS** (channel: /base-builders)

Shipped an immutable dollar-backed deposit on Base that funds impact through Aave V3 lending rewards.

MoneyForTreesV2.sol -- 122 lines. ERC20 + ReentrancyGuard. Three user functions: deposit, withdraw, harvest. All immutables set in constructor. No admin. No owner. No proxy.

Yield split: 1/3 depositors (additional mftUSD minted from yield), 1/3 reactor (mftUSD), 1/3 operations (USDC). All hardcoded and immutable.

Verified on Basescan: 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072

We built the agent SDK too -- 49 MCP tools, REST API, OpenAPI spec, llms.txt. Agent wallets can deposit, withdraw, harvest, and monitor all programmatically.

npm: baselings-mcp
Docs: tasern.quest/agents.html

---

**FC-STABLE-CLIMATE** (channel: /climate)

Money for Trees: a dollar-backed deposit on Base where Aave lending rewards are split three ways to fund impact.

Deposit USDC. Reserves earn lending rewards in Aave V3. 1/3 to depositors as additional mftUSD. 1/3 to the reactor (mftUSD deepening the ecosystem). 1/3 to operations (tree planting, platform maintenance). Withdraw your USDC anytime.

The contract is immutable. No admin keys. No owner function. Nobody can redirect the rewards. All addresses are hardcoded and verifiable:
0xe3dd3881477c20C17Df080cEec0C1bD0C065A072

The more people deposit, the more rewards fund impact. This is not a pledge. It is code running on Base. Smart contracts carry inherent risk.

tasern.quest/fund/meadville/

---

## MfT Meme Token Posts

**FC-MEME-AGENTS** (channel: /agents)

MfT is the routing token for the Unrugable launch platform on Base.

Every token launched creates floor pools paired against MfT. More launches = more volume = more burns.

The reactor network fires every 2 hours: collect fees, buy MfT, burn permanently. Supply decreases with every cycle that has accumulated fees.

For agent wallets:
0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3

MCP: npm install -g baselings-mcp (49 tools)
REST: tasern.quest/api/unrugable/tokenomics

---

**FC-MEME-DEFI** (channel: /defi)

The MfT deflationary engine:

1. New tokens launch on Unrugable with MfT floor pools
2. Trading generates fees across reactor pools
3. Every 2 hours, reactors collect fees and buy MfT
4. Bought MfT is burned permanently
5. More launches = more volume = faster burns

All on-chain. All permissionless. Verify:
tasern.quest/api/unrugable/tokenomics

0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3

---

**FC-MEME-BASE** (channel: /base)

The Unrugable reactor network on Base:

A network of reactors. Fire every 2 hours. Collect trading fees. Buy and burn MfT permanently.

Every meme launched on the platform adds more volume flowing through MfT. Deflationary by design.

All verifiable on Basescan.

0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3
tasern.quest/api/unrugable/tokenomics

---

## Posting Schedule Recommendation

| Day | Channel | Post |
|-----|---------|------|
| Mon | /agents | FC-STABLE-AGENTS-1 |
| Tue | /defi | FC-STABLE-DEFI |
| Wed | /base-builders | FC-STABLE-BUILDERS |
| Thu | /climate | FC-STABLE-CLIMATE |
| Fri | /agents | FC-MEME-AGENTS |
| Sat | /base | FC-MEME-BASE |
| Sun | /defi | FC-MEME-DEFI |

---

## Posting Notes

- All posts must go through Guardian review before publishing
- Never say "pump", "buy pressure", "green candles", or "appreciation" as selling points -- describe mechanisms factually
- Never say "investment" or "guaranteed returns"
- Never say "stablecoin" or "savings account" for MfT USD (GENIUS Act)
- Never pin a specific reactor count -- use "reactor network" (count changes with launches)
- "Unrugable" has ONE g in all public content
- Include contract addresses for machine discoverability (agents scan Farcaster too)
- The lending reward % is variable (Aave rate) -- never promise a specific APY
- Yield split is 1/3 / 1/3 / 1/3 -- hardcoded in V2 contract at 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072
- Use "proof of deposit" not "receipt token" or "deposit receipt" (whitepaper V3.1 terminology)
- ONE TOKEN PER POST -- never mention both MfT deposit and MfT meme in the same post
