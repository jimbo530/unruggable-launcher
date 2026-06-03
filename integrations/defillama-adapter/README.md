# Unrugable Launcher — DeFiLlama TVL Adapter

## What It Tracks

Permanently locked Uniswap V3 liquidity across the Unrugable Launcher reactor network on Base (chain 8453).

When a token is launched via any Unrugable factory contract, the factory atomically:
1. Deploys the token
2. Creates 2 Uniswap V3 LP positions (TOKEN/Money 70% + TOKEN/Meme 30%)
3. Locks all positions inside 1 SporeReactor contract (50% fee burn + 50% to launcher)

Reactor contracts have **no withdraw, transfer, or remove function**. The liquidity is locked forever by the absence of withdrawal code — not by a timelock or multisig.

Note: Earlier factory versions (V4–V5) created 8 LP positions across 2 reactors. V7 simplifies to 2 pools + 1 reactor.

## How TVL Is Calculated

1. Enumerate all launches from factory contracts (V4.2 through V7) using `launchCount()` and `launches(i)` view functions
2. Collect every reactor address
3. Use DeFiLlama SDK's `sumTokens2` with `resolveUniV3: true` to value all Uniswap V3 NFT positions held by those reactors

This counts the underlying token amounts in each V3 position at current prices.

## Factory Contracts (Base, 8453)

| Version | Address |
|---------|---------|
| V4.2 | `0x73dA1ac6f2f83291acbe2eBCA9Ab4BF970f9dE29` |
| V4.3 | `0x51eF41E0730c0e607950421e1EE113b089867d3e` |
| V5 | `0xb74fe5fA2D030706B4A0C901fDC42C5244695A6e` |
| V5.1 | `0x2e0b2d7c9b0680F3050BB3Da460F9B4E16BB5F3d` |
| V5.2 | `0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51` |
| V5.3 | `0x65F8227f37932e1aF1771398DFA76B4079fbDb21` |
| V5.4 | `0xb1fE1deeA42F85F124E7cB166B2f52a1D7f1d054` |
| V5.5 | `0x9FCE6fF019570dC09678C6Fcd513bDF5cf766fC9` |

All contracts are verified on BaseScan.

## Why This Is Real TVL

- No admin can withdraw — there is no withdraw function in the bytecode
- No timelock expiry — locks are permanent, not time-based
- No upgrade proxy — reactor contracts are immutable
- Factory contracts are verified — anyone can confirm the absence of withdrawal code
- Liquidity only grows over time as reactors compound trade fees into deeper positions

## Testing

From the DefiLlama-Adapters repo root:

```bash
node test.js projects/unrugable-launcher/index.js
```

## Submission

This adapter is submitted as a PR to:
https://github.com/DefiLlama/DefiLlama-Adapters

Place the `index.js` file at:
```
projects/unrugable-launcher/index.js
```

## Links

- Launcher UI: https://tasern.quest/launcher/unrugable.html
- Reactor Network Map: https://tasern.quest/launcher/reactor-map.html
- Security Doc: https://tasern.quest/launcher/security.html
- Factory (V5.2) on BaseScan: https://basescan.org/address/0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51
