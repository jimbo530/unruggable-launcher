# Canonical Numbers Reference

Single source of truth for all marketing materials.
Last verified: 2026-05-26.

## Pools Per Launch

**8 LP positions** created per launch, locked across **2 reactors**.

Breakdown (from MycoPadV5_2.sol):
- 3 floor pools: TOKEN/AZUSD, TOKEN/cbBTC, TOKEN/WETH
- 3 MfT sell walls: TOKEN/MfT at 1.1x, 2x, 5x price bands
- 2 CHAR carbon pools: CHAR/cbBTC, CHAR/WETH

Primary reactor holds 6 pools (3 floor + 3 MfT walls).
CHAR reactor holds 2 pools.

## Seed Split

94% floor liquidity, 6% CHAR carbon reactor.

Floor split: 40% AZUSD, 30% cbBTC, 30% WETH.

## Minimum Seed Cost

Contract minimum: $1 USDC (minSeed = 1_000_000, 6 decimals).
UI default: $5 USDC.
Use "$5" in marketing (the practical launch cost).

## Static Reactor Network

19 static reactors in the keeper roll call (from reactor-roll-call.js):
- 1 feeder (ecowealth)
- 2 BB/EB v5
- 1 EB relay
- 6 band reactors (BTCband v1/v2, ETHband v1/v2, BB v3, EB v3)
- 1 Unrugable Hub
- 5 main chain (TGN, AZUSD, BURGERS, CHAR, EGP)
- 1 MfT V1 Prime

Plus 2 reactors per launched token (primary + CHAR), auto-discovered.

The number grows with each launch. Do NOT pin a specific count.
- Use "network of reactors" or "reactor network" in marketing
- Never say "28+" or "35+" — the number changes too often

## MCP Tool Count

**49 tools** (baselings-mcp v1.2.0):
- 10 read tools (get_balances through get_global_stats)
- 14 write tools (buy_egg through ensure_approvals)
- 3 strategy tools (welcome, choose_strategy, next_actions)
- 3 tokenomics tools (mft_flywheel, tokenomics_metrics, why_mft)
- 3 economy tools (build_phase, feeding_guide, economy_rules)
- 1 info tool (game_guide)
- 5 launch tools (unrugable_info through unrugable_invite_link)
- 1 reactor tool (fire_reactor)
- 3 data tools (get_reactor_list, mft_price, liquidity_depth)
- 4 swap tools (swap_token, swap_quote, swap_status, arb_signal)
- 1 timing tool (reactor_timing)
- 1 portfolio tool (portfolio_value)

Use "49 MCP tools" in marketing. Do NOT say 39, 42, 43, 44, 46, or 48.

## Immutable Reactors

5 reactors fully renounced (ownership transferred to zero address).
Remaining reactors have add-only admin keys (can only call addPool).

## Firing Cycle

Every 2 hours. Permissionless execute().
3% max slippage per pool per firing.

## Branding

Public name: **Unrugable** (ONE g — never "Unrugable" or "MycoPad")
Internal code name: MycoPad (NEVER use in public-facing content)
Factory contract labels in code: Unrugable2 / MycoPad V5.2 (internal only)
Active factory: V5.4 at 0xb1fE (V5.3 at 0x65F8 for BRUH/NZ)
In marketing, always say "Unrugable" — never "Unrugable", never "MycoPad"

## Source Files

- Contract: contracts/MycoPadV5_2.sol
- Reactor roll call: tools/reactor-roll-call.js
- MCP server: Baselings/agent-sdk/mcp-server.js
- Launcher UI: site/unrugable.html
