# Canonical Numbers Reference

Single source of truth for all marketing materials.
Last verified: 2026-06-03.

## V7 Launch Specs

**FREE launch** — no seed, no USDC, just gas (~$0.01 on Base).

**2 pools** per launch:
- TOKEN/Money (70% of supply) — semi-stable side, backed by Aave yield, funds trees
- TOKEN/Meme (30% of supply) — wild meme side, reactor heartbeat

**1 reactor** per launch (SporeReactorV4 clone).

**1,000,000,000 tokens** fixed supply per launch.

**$10,000 starting market cap** — every token starts at the same price.

**Single transaction** — one click deploys token + 2 pools + reactor.

## Reactor V4 Split

Every 2 hours, the reactor fires:
1. Collects V3 fees from both pools
2. Core token fees: **50% burned, 50% sent to launcher's wallet**
3. Cross-token (Meme) fees: 10% upstream to reactor network, remainder swapped and deposited as LP
4. Dust burned

Launcher earns passively from their token's trading volume. Forever.

## Pools Per Launch

**2 LP positions** created per launch, managed by **1 reactor**.

- TOKEN/Money at 1% fee tier (70% of supply, single-sided sell wall)
- TOKEN/Meme at 1% fee tier (30% of supply, single-sided sell wall)

Walls start at $10K market cap price and extend to max tick range.

## Static Reactor Network

19 static reactors in the keeper roll call (from reactor-roll-call.js):
- 1 feeder (ecowealth)
- 2 BB/EB v5
- 1 EB relay
- 6 band reactors (BTCband v1/v2, ETHband v1/v2, BB v3, EB v3)
- 1 Unrugable Hub
- 5 main chain (TGN, AZUSD, BURGERS, CHAR, EGP)
- 1 MfT V1 Prime

Plus 1 reactor per V7 launch, auto-discovered.

The number grows with each launch. Do NOT pin a specific count.
- Use "network of reactors" or "reactor network" in marketing
- Never say "28+" or "35+" — the number changes too often

## MCP Tool Count

**49 tools** (baselings-mcp v1.2.0).
Use "49 MCP tools" in marketing.

## Immutable Reactors

5 reactors fully renounced (ownership transferred to zero address).
Remaining reactors have add-only admin keys (can only call addPool).

## Firing Cycle

Every 2 hours. Permissionless execute().
3% max slippage per pool per firing.

## Key Contracts (V7)

| Contract | Address |
|----------|---------|
| V7 Factory | 0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2 |
| SporeReactorV4 Impl | 0x891587AD62bcBc6aceE9061D9C4306b9aB16cE45 |
| ReactorPrimeV3 | 0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA |
| Money for Trees | 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072 |
| Meme for Trees | 0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3 |
| CHAR Token | 0x20b048fA035D5763685D695e66aDF62c5D9F5055 |

## Branding

Public name: **Unrugable** (ONE g — never "Unruggable" or "MycoPad")
Internal code name: MycoPad (NEVER use in public-facing content)
Money for Trees = deposit receipt (NEVER call it a stablecoin)
Meme for Trees = meme token (the original MfT)

## Source Files

- V7 Contract: contracts/MycoPadV7.sol
- Reactor V4: contracts/SporeReactorV4.sol
- Reactor roll call: tools/reactor-roll-call.js
- MCP server: Baselings/agent-sdk/mcp-server.js
- Launcher UI: site/unrugable.html
