# What Unruggable Offers Partners

## Automated, Perpetual Buy Pressure for Your Token — Free

The Unruggable reactor network is a system of 27 on-chain reactors firing every 2 hours on Base. When your token is added as a reactor pair, it receives automated buy pressure from collected trading fees — permanently, with no ongoing cost or maintenance.

Five of these reactors are already renounced (immutable). No admin key. No multisig. No off switch. Code runs until the chain stops.

---

## What Partners Get

- **Automated buy pressure every 2 hours.** Reactors collect V3 LP fees, swap them into your token, and burn the native side. This creates real, verifiable green candles on a predictable schedule.
- **Network-wide fee flow.** Your token does not exist in isolation. Fees cascade bottom-up through 180+ pools across 21 reactors. Activity anywhere in the network generates fuel that eventually touches every connected pair.
- **Arb surface.** Each new pool creates price discrepancies that attract bot volume. One organic trade can ripple into 3-5x corrective volume across connected pools. More pools, more routes, more volume.
- **Permanent locked liquidity.** LP positions are locked inside the reactor contracts. There is no withdraw function. Liquidity cannot be removed — ever.
- **On-chain transparency.** Every reactor firing, every swap, every burn is verifiable. No dashboards to trust, no promises to believe. Read the chain.

## What It Costs

Nothing.

There is no fee to become a reactor pair. No rev-share. No token allocation required. The reactor network benefits from more pairs because more pairs means more fee surfaces, more arb routes, and more fuel flowing to the entire system.

## How to Integrate (4 Steps)

1. **Create a V3 LP position** pairing your token with MfT (or another network token like POOP, CHAR, BB, EB).
2. **Send the LP position** to the appropriate reactor contract. The reactor accepts it and locks it permanently.
3. **Reactor owner calls `addPool()`** to register the new pool. Once added, it fires on the next 2-hour cycle.
4. **Done.** No maintenance, no monitoring, no gas costs on your side. The keeper bot handles execution. Anyone can call `execute()` permissionlessly.

That is the entire integration. No SDK, no API keys, no partnership agreement.

## Why This Is Different

| Typical "Partnership" | Unruggable Reactor |
|---|---|
| Promises of buy pressure | Code that executes buy pressure, verifiable on-chain |
| Admin keys can change terms | 5 reactors renounced, immutable forever |
| Liquidity can be pulled | No withdraw function exists in the contract |
| Requires ongoing coordination | Fires autonomously every 2 hours |
| Benefits one side | Every pair strengthens the entire network |

The reactor network treats all activity as fuel — buys, sells, arb, MEV, even panic dumps generate fees that feed the next cycle. Volatility is the engine. The only enemy is apathy.

## The Network (May 2026)

- 27 active reactors on Base
- 180+ connected pools
- 5 reactors fully renounced (immutable)
- 2-hour firing cycle, bottom-up cascade
- 3% max price impact per pool per firing (slippage-capped)
- CHAR integration burns carbon credits on every cycle

## Contact

Farcaster: @jamesmagee
MfT token: `0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3` (Base)
Burn address: `0xfd780B0aE569e15e514B819ecFDF46f804953a4B` (no private key)

---

*Unruggable by code, not by promise.*
