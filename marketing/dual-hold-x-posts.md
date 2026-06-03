# X Posts -- MfT Deposit & MfT Meme (Separate Posts)

All posts use "Unrugable" branding (one g). No "pump" language. All claims verifiable on-chain. Target: agent builders, AI DeFi developers, autonomous wallet operators.
NEVER call MfT USD a "stablecoin" (GENIUS Act — yield-bearing proof of deposit, not payment stablecoin). Use "deposit", "dollar-backed", or "Money for Trees".

ONE TOKEN PER POST. Never mix deposit token and meme in the same post.

---

## Money for Trees Deposit Posts

**X-STABLE-1**
Your agent's idle USDC can fund real impact.

Money for Trees: deposit USDC, get proof of deposit 1:1. Reserves sit in Aave V3. Lending rewards split three ways -- 1/3 to depositors, 1/3 to reactor, 1/3 to operations. Withdraw anytime.

Immutable contract. No admin. No lock. 122 lines of Solidity.

0xe3dd3881477c20C17Df080cEec0C1bD0C065A072
Base (8453)

---

**X-STABLE-2**
Built for agent wallets:

deposit(USDC) -- get proof of deposit 1:1
harvest() -- permissionless, anyone calls it
withdraw(USDC) -- anytime, no lock

Aave lending rewards split 1/3 depositors, 1/3 reactor, 1/3 operations. Immutable. No admin keys. Three functions.

0xe3dd3881477c20C17Df080cEec0C1bD0C065A072

---

**X-STABLE-3**
Most USDC sits in Aave earning lending rewards for protocol treasuries.

Money for Trees sits in Aave and splits lending rewards three ways: depositors, reactor, and operations -- funding impact automatically. Your idle USDC doing good while you sleep.

No admin. No lock. No trust required. Immutable contract on Base.

0xe3dd3881477c20C17Df080cEec0C1bD0C065A072

---

**X-STABLE-4**
If your agent has a cron loop, add this:

1. Check pendingYield() on Money for Trees contract
2. If rewards > gas cost, call harvest()
3. You just triggered the yield split -- depositors, reactor, and operations each get 1/3

No special permissions needed. Permissionless. Base chain (8453).

0xe3dd3881477c20C17Df080cEec0C1bD0C065A072

---

## MfT Meme Token Posts

**X-MEME-1**
Every token launched on Unrugable trades through MfT.

More launches = more volume. The reactor network fires every 2 hours: collect fees, buy MfT, burn it.

Supply shrinks with every cycle. All verifiable on-chain.

0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3

---

**X-MEME-2**
The MfT reactor network:

- A network of reactors across Base
- Fire every 2 hours
- Collect trading fees
- Buy and burn MfT permanently

Every meme launched on Unrugable adds more volume flowing through MfT. More launches, more burns.

tasern.quest/api/unrugable/tokenomics

---

**X-MEME-3**
MfT sits on top of every Unrugable launch.

When someone buys a new token, that swap generates MfT volume. When reactors fire, they buy and burn MfT from fees.

Deflationary by design. Every trade on a launched token generates reactor fuel for MfT.

0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3

---

**X-MEME-4**
Agent builders: MfT is the infrastructure token for the Unrugable network.

Every meme launched creates locked pools paired against MfT. More launches = more volume = more burns.

MCP: npm install -g baselings-mcp (49 tools)
REST: tasern.quest/api/unrugable/tokenomics

0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3

---

## Deposit Thread (5 posts)

**1/5**
Money for Trees: a dollar-backed deposit that funds impact.

Thread on how it works and why it is immutable:

**2/5**
Deposit USDC. Get proof of deposit 1:1.

Your USDC goes to Aave V3 (variable lending rewards). The rewards are split three ways: 1/3 to depositors as additional mftUSD, 1/3 to the Meme for Trees reactor, 1/3 to operations.

Withdraw your USDC anytime. No lock, no fees.

**3/5**
The contract is 122 lines. Immutable. No proxy, no owner, no admin, no upgrade path.

All addresses are hardcoded at deploy -- reactor, operations wallet, Aave pool, swap router. Nobody can redirect the yield. Verify everything on Basescan.

0xe3dd3881477c20C17Df080cEec0C1bD0C065A072

**4/5**
harvest() is permissionless. Any wallet can call it. Any agent can call it.

It splits accrued Aave lending rewards three ways: mftUSD to depositors, mftUSD to reactor, USDC to operations. No special permissions. No approval flow beyond USDC approve.

**5/5**
Integration:

MCP: npm install -g baselings-mcp (49 tools)
REST: tasern.quest/api/unrugable/tokenomics
Direct: deposit(), withdraw(), harvest()
Docs: tasern.quest/agents.html

Contract source verified on Basescan. Read the code.

---

## Meme Thread (5 posts)

**1/5**
MfT is the base layer of the Unrugable reactor network.

Thread on the deflationary mechanics:

**2/5**
Every token launched on Unrugable gets locked pools paired against MfT.

When someone buys or sells a launched token, that swap generates MfT volume. MfT is the routing token for the entire network.

**3/5**
The reactor network fires every 2 hours. Reactors collect trading fees, buy MfT, and burn it permanently.

More launches = more trading fees = more burns. Supply decreases with every cycle that has accumulated fees.

**4/5**
Verify the burns:

Transfer events to 0xfd780B...953a4B (dead address)
Reactor state: tasern.quest/api/unrugable/tokenomics
All on-chain. All permissionless.

**5/5**
For agent wallets:

0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3
Base (8453)

MCP: npm install -g baselings-mcp
REST API: tasern.quest/api/unrugable/tokenomics
llms.txt: tasern.quest/llms.txt

---

## Posting Notes

- Do NOT use hashtags. Weave keywords naturally into sentences.
- Tag accounts when relevant: @base, @CoinbaseWallet, @ai16z, @virtikitten
- Best posting times for agent builder audience: weekdays 14:00-18:00 UTC
- Every post must include at least one contract address for machine discoverability
- Never say "pump", "buy pressure", "green candles", or "appreciation" as selling points -- describe mechanisms factually
- Never say "guaranteed" or "investment"
- Never say "stablecoin" or "savings account" for the deposit token (GENIUS Act)
- The word "Unrugable" has ONE g in all public content
- Never pin a specific reactor count -- use "reactor network" (count changes with launches)
- ONE TOKEN PER POST -- never mention both MfT deposit and MfT meme in the same post
- Yield split is 1/3 / 1/3 / 1/3 -- hardcoded in the V2 contract at 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072
- Use "proof of deposit" not "receipt token" or "deposit receipt" (whitepaper V3.1 terminology)
- The lending reward % is variable (Aave rate) -- never promise a specific APY
