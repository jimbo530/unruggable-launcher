# Farcaster Posts — V7

## Post 1 — /defi (The Mechanism)

Unrugable V7 is live on Base. Free token launches.

One transaction: deploys your token with 1B supply, creates two permanently locked Uniswap V3 pools (70% Money, 30% Meme), and spins up a reactor.

Every 2 hours, the reactor fires: collects fees from both pools, burns 50% of token fees permanently, sends 50% to the launcher's wallet. Cross-token fees cascade through the reactor network upstream — secondary reactors fire first, V1 Prime fires last and burns MfT.

No seed money. No USDC approval. Just gas. Launcher earns passively from trading volume forever.

Five reactors in the network are fully renounced. The rest have add-only admin keys. Verify any of this on a block explorer. That's the entire trust model.

## Post 2 — /base (Building on Base)

Launched V7 of Unrugable on Base. Free token launches, single transaction.

Why free? The old model charged $5 for 8 pools. V7 strips it down: 2 pools, 1 reactor, zero cost. The reactor earns from trading fees — 50% burned, 50% to the launcher. No seed means no barrier.

Money pool (70%): paired against Money for Trees, a USDC-backed deposit receipt where Aave yield funds tree planting. Meme pool (30%): paired against Meme for Trees, the original meme token with the reactor heartbeat.

Every token starts at $10K market cap. All supply goes into pools — no dev allocation, no team tokens, no vesting. 100% in liquidity from block 1.

Factory: 0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2

## Post 3 — /agents (Agent SDK)

49 MCP tools for on-chain agents. The Unrugable Launcher is now free — your agent can launch tokens for the cost of gas.

Every launched token gets a reactor that fires every 2 hours. That's predictable fee collection, burns, and earnings on a clock. Agents can call execute() permissionlessly on any reactor.

Launch tokens, fire reactors, arb the 2-hour cycle, play Baselings. No API keys. Just contracts on Base.

Agent discovery: tasern.quest/llms.txt

## Post 4 — /climate (Impact)

Every 2 hours, the Unrugable reactor network fires on Base. CHAR — a carbon credit token where 1 CHAR = 1 lb CO2e biochar — gets collected from LP trading fees and held permanently at a tracking address. No withdraw function. Removed from circulation forever.

V7 launches pair 70% of supply against Money for Trees — a deposit receipt backed by USDC in Aave. The yield from those deposits funds tree planting. Not a promise. The yield is automatic, the trees are real.

Every trade on a reactor pool generates fees that flow through the network. Some of those fees remove carbon credits from markets. The rest burn supply and pay launchers.

## Post 5 — /defi (Reactor Heartbeat)

The reactor heartbeat, V7 edition:

Secondary reactors fire first — collecting fees from TOKEN/Money and TOKEN/Meme pools. 50% of token fees burned, 50% sent to the launcher. Cross-token fees (Meme for Trees) cascade 10% upstream.

V1 Prime fires last. Accumulated Meme fees from the entire network get swapped and burned as MfT.

Even without active traders, price movements in the underlying pairs create baseline fees — the heartbeat never fully stops.

With active volume, predictable 2-hour arb windows open across every connected pool. Bots equalize, generating more fees. The cycle repeats forever.

## Post 6 — /base (Invite System)

Free token launch on Unrugable. Get an invite link.

When someone launches using your link, their reactor chains upstream to yours — permanently. Fee flow between reactors is on-chain and verifiable.

The invite address is validated against the factory's isReactor[] mapping. You can only invite through a real deployed reactor. No gaming it.

More launches = more reactors = more pools = more volume = more burns and earnings across the entire network.

tasern.quest/unrugable.html

## Post 7 — /defi (Two Pool Design)

Every V7 token launches with two pools:

Money pool (70% of supply): Paired against Money for Trees. Semi-stable. The underlying USDC generates Aave yield that funds tree planting. Your token paired against real yield infrastructure.

Meme pool (30% of supply): Paired against Meme for Trees. The original meme token. Wild price action, reactor heartbeat, network effects.

Both pools locked forever. One reactor manages both. Fires every 2 hours. Burns half, pays you half.

Stable side for safety. Meme side for upside. Both generating fees.

## Post 8 — /build (What Changed)

V5 to V7 — what changed:

V5: $5 seed, 8 pools, 2 reactors, USDC approval, 2-step flow
V7: Free, 2 pools, 1 reactor, single transaction

New in V7: Launcher earns 50% of token fees from the reactor. Every 2 hours, forever. The other 50% gets burned.

Why: Lower barrier = more launches. More launches = bigger network. Launcher earnings = aligned incentives. You want your token to trade because you earn from it.

Factory: 0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2
