---
name: mft-buy-band
description: Buy a Meme for Trees band token with USDC on Base via Bankr. Use when the user wants to buy a band token — e.g. "buy $EBM with 10 USDC", "buy EBM token", "get me some Rish". The band tokens are only paired against "Money" (Money for Trees, a 1:1 USDC receipt), and the tradeable pools are ONE-SIDED band-token walls that Bankr's auto-router will NOT find on its own. This skill spells out the exact 2-step path: (1) MINT Money from USDC 1:1 via the Money vault, then (2) swap Money → band token through the band's Uniswap V3 wall. Read the volatility note before buying — these are thin, one-sided-wall tokens.
---

# Meme for Trees — Buy a Band Token

Buy one of the 14 Meme for Trees band tokens with USDC on Base. Bankr's
auto-router **cannot** find the route on its own, because:

1. The band tokens are only paired against **Money** (Money for Trees), not USDC.
2. The tradeable pools are **one-sided Uniswap V3 walls** (band tokens on one
   side only) that the router does not index as normal liquidity.
3. The direct USDC/Money pool is shallow (~$92) — routing USDC→Money through it
   would break on any real size.

So this skill uses the correct path: **mint Money 1:1 from USDC via the Money
vault** (unlimited depth, no slippage), then **swap Money → band token** through
the band's wall.

> **Volatility note (read this):** Each band token trades against a single
> one-sided wall of band tokens seeded by the project. There is a buy wall but
> (until fans sell back) little or no sell-side depth. Price can move sharply and
> you may not be able to sell back at the price you bought. These are community /
> collectible tokens for the bands, **not** an investment and **not** a
> stablecoin. Only spend what you're happy to spend on the band.

## Quick summary

Fan says: **"buy $EBM with 10 USDC"**

- **Step 1 — MINT Money (not a swap):** approve 10 USDC to the Money vault, then
  `deposit(10_000000)` → you receive 10 Money (1:1, 6 decimals).
- **Step 2 — swap Money → band:** approve 10 Money to the Uniswap V3 SwapRouter02,
  then `exactInputSingle(Money → EBM, fee=10000, amountOutMinimum=<bounded>)`.

Result: the fan holds EBM band tokens; the USDC minted Money that backs the
charity vault 1:1.

## Parameters

| Parameter    | From          | Notes                                                        |
|--------------|---------------|-------------------------------------------------------------|
| `band`       | user input    | Band name/symbol (case-insensitive). See the roster below.  |
| `usdcAmount` | user input    | How much USDC to spend, in whole dollars (e.g. `10`).        |

Resolve `band` → `{ token, wallFee }` from the roster. If it isn't in the roster,
tell the user the band isn't available and list the valid symbols.

## Band roster — token + Money-wall fee tier

All 14 live Money walls are the **1% (fee = 10000)** tier. The old 0.01%
(fee = 100) pools are **empty and must not be used** — this skill pins the
correct live wall per band.

| Symbol  | Band                          | Token (Base)                                 | Wall fee |
|---------|-------------------------------|----------------------------------------------|----------|
| EBM     | Elves of Ballinmoore          | `0xF113fe2A0E1181A21fA97B1F52ff232140B7692d` | 10000    |
| DD      | Digerie Dude                  | `0xa77D43A33AD5C50E27fCf27101c9E6aEfE066CE3` | 10000    |
| MYCO    | Myco                          | `0x36A01B05cf86a170490E3Ba4981eFd12B559a5a3` | 10000    |
| MR      | Moon Rasta                    | `0x8d669b539C7801c1271BC484Bdd8a6084b7788e7` | 10000    |
| JS      | Jony Sings                    | `0x16Ba11AeDA2Da0eb2C64Ff7d0e74884033Ef2C65` | 10000    |
| NN      | Natilie Nightclub             | `0x2beBaBdF57597F3ce75BDC75FAD3C40C4A9Fc8cc` | 10000    |
| DGT     | The Damned Good Time Orchestra| `0x52414B7cD2FA723E1c8f9295EB29F16d15aA7BB9` | 10000    |
| BONGO   | Bongo                         | `0x85Dd5183D203CcE70b88234D31f075774AcCC453` | 10000    |
| RICKY   | Ricky Bobbie                  | `0x95286F2cce3C2de48EB75bB4E2Ec004429F18E53` | 10000    |
| HT      | Hammer Tone                   | `0x7B105F45ddaA689AfDa5606628761a9Fb2dCd826` | 10000    |
| WM      | War Machine                   | `0x6f45F5cE7027745b1Ab11D5493F187960D00FCfc` | 10000    |
| BIGGINS | Biggins Mcjammin              | `0x7C596a0d594D670ffB256bBfbB5379fC8Cf7d62B` | 10000    |
| JASMINE | Jasmine the Tiger             | `0x3a952eFa41501c0463Cf8Af9f821f8F549f47Edf` | 10000    |
| RISH    | Rish                          | `0x31c600871603bab5d855463E03c6d0a9eB661D26` | 10000    |

Accept common aliases: bare symbol ("EBM"), `$` prefix ("$EBM"), and the band's
name ("Elves of Ballinmoore").

## Fixed addresses (Base, chain 8453)

| What                         | Address                                      | Dec |
|------------------------------|----------------------------------------------|-----|
| USDC                         | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6   |
| Money (Money for Trees, MfT) | `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` | 6   |
| Money vault (deposit target) | `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` | 6   |
| Uniswap V3 SwapRouter02      | `0x2626664c2603336E57B271c5C0b26F421741e481` | —   |
| Uniswap V3 Quoter (min-out)  | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` | —   |

Note: the Money **vault** and the Money **token** are the same contract
(`0xe3dd3881…A072`). You `deposit(usdc)` into it and it mints you Money; the swap
in step 2 then spends that same Money token. Money is 6 decimals, matching USDC,
so `usdcAmount` and the resulting `moneyAmount` are the same base-units number.

## The exact 2-step transaction sequence

For "buy `<BAND>` with `<usdcAmount>` USDC", with
`amt = usdcAmount * 10^6` (both USDC and Money are 6-dec):

### Step 1 — USDC → Money (MINT, not swap)

**Tx 1a — approve USDC to the Money vault**
- to: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (USDC)
- function: `approve(address spender, uint256 amount)`
  - `spender` = `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` (Money vault)
  - `amount`  = `amt`  (exact — not MaxUint256)

**Tx 1b — deposit into the Money vault (mints Money 1:1)**
- to: `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` (Money vault)
- function: `deposit(uint256 amount)`  ← selector `0xb6b55f25`
  - `amount` = `amt`
- effect: mints `amt` Money to the fan (6-dec, 1:1). No slippage, unlimited depth.

### Step 2 — Money → band token (swap through the wall)

**Tx 2a — approve Money to the V3 SwapRouter02**
- to: `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` (Money)
- function: `approve(address spender, uint256 amount)`
  - `spender` = `0x2626664c2603336E57B271c5C0b26F421741e481` (SwapRouter02)
  - `amount`  = `amt`

**Tx 2b — exactInputSingle (Money → band token)**
- to: `0x2626664c2603336E57B271c5C0b26F421741e481` (SwapRouter02)
- function:
  `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))`
  - `tokenIn`  = `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` (Money)
  - `tokenOut` = `<band token address>` from the roster
  - `fee`      = `<band wall fee>` from the roster (all 10000 today)
  - `recipient`= the fan's wallet
  - `amountIn` = `amt`
  - `amountOutMinimum` = slippage-bounded (see below) — **do not pass 0**
  - `sqrtPriceLimitX96` = `0`

Always send 1a → 1b → 2a → 2b in order, waiting for each to confirm (2b's
`transferFrom` on Money needs 1b to have minted it and 2a to have approved it).

### Setting `amountOutMinimum` (required)

Do not send the band swap with `amountOutMinimum = 0` — a one-sided wall with
thin sell-side depth can hand back far fewer tokens than expected. Before Tx 2b:

1. Call the Quoter `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a`:
   `quoteExactInputSingle((tokenIn=Money, tokenOut=band, amountIn=amt, fee=<wallFee>, sqrtPriceLimitX96=0))`
   → returns `amountOut`.
2. If `amountOut == 0`, the wall has no Money side yet (no fan has bought this
   band); tell the user this band can't be bought right now.
3. Set `amountOutMinimum = amountOut * 97 / 100` (3% slippage tolerance — the
   same tolerance the project's own settle script uses). Tighten to 1–2% for very
   small buys if you want.

## User-facing response template

After all four txs confirm:

> Bought **<AMOUNT> <SYMBOL>** for <usdcAmount> USDC.
> Path: <usdcAmount> USDC → minted <usdcAmount> Money → swapped for <SYMBOL>.
> Swap tx: basescan.org/tx/<TX2B_HASH>
> Heads up: <SYMBOL> is a thin, one-sided-wall band token — price can swing and
> sell-back depth may be limited. Not an investment.

## Error handling

| Situation                              | Message to the user                                                    |
|----------------------------------------|------------------------------------------------------------------------|
| Band symbol not in roster              | "I don't have a band called <X>. Available: EBM, DD, MYCO, MR, JS, NN, DGT, BONGO, RICKY, HT, WM, BIGGINS, JASMINE, RISH." |
| USDC balance < amount                  | "You need <amount> USDC on Base to buy <SYMBOL>."                       |
| Quoter returns 0                       | "That band's wall has no liquidity to sell right now — try again later." |
| deposit() reverts                      | "The USDC→Money mint failed — check your USDC approval and balance."   |
| exactInputSingle reverts on min-out    | "Price moved past the slippage limit — try again (or a smaller amount)." |
| arbitrary contract calls disabled      | "Enable arbitrary contract calls in Bankr Security to run this."       |

## Why mint Money instead of swapping USDC→Money?

The Money vault mints 1:1 with **unlimited depth and zero slippage** — deposit N
USDC, get exactly N Money, always. The on-chain USDC/Money V3 pool is only ~$92
deep, so swapping any real size through it would move the price and lose value.
Minting is strictly better for this leg, and it's the same thing the project's own
`songsmith-settle.cjs` relies on (Money is the settlement asset for every band
wall). This skill therefore always mints for step 1 and only swaps for step 2.

## Requirements

- Bankr skill installed with an API key configured.
- USDC balance on Base (Bankr covers gas).
- Arbitrary contract calls enabled (Bankr Security → keep "Disable arbitrary
  contract calls" OFF) — all four txs use the raw/arbitrary-transaction path.

## Machine-readable references

- `references/addresses.json` — the full band roster (symbol, name, token,
  `wallFee`, `moneyPool`), the fixed addresses (USDC / Money / SwapRouter02 /
  Quoter), the 4-tx `sequence`, and the preflight checks — as structured JSON.
- `references/abi.json` — minimal ABIs + selectors for the ERC-20 `approve`, the
  Money vault `deposit`, the V3 `exactInputSingle`, and the Quoter
  `quoteExactInputSingle`.
