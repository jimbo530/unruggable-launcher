---
name: mft-charity-deposit
description: Deposit into a Meme for Trees charity vault from X/Farcaster or the CLI. Use when the user wants to deposit into "Money for Trees" / "Money" / mftUSD, "Grow Some Trees" / GST, or "Feed The People" / FTP — e.g. "deposit $25 into Money for Trees". Each vault takes a stablecoin (USDC on Base, USDG on Robinhood), mints the caller a 1:1 charity deposit receipt token, and the receipt is redeemable 1:1 at any time. Deposits fund tree-planting and feeding-people impact. On Base this executes today via Bankr; the Robinhood vaults are documented for when Bankr supports chain 4663.
---

# Meme for Trees — Charity Vault Deposit

Deposit a stablecoin into a Meme for Trees charity vault and receive a **1:1
charity deposit receipt** token. The receipt is fully backed and redeemable 1:1
at any time; the vault's *yield* (not your principal) funds the cause
(tree-planting / feeding people). Anyone can deposit — the vaults have a
public, permissionless `deposit()`.

> These receipt tokens (Money, GST, FTP) are charity **deposit receipts**, not
> stablecoins, and carry no financial return. Your principal stays 1:1
> redeemable; only the vault's yield is routed to the cause.

## Quick Start

Deposit **$25 into Money for Trees** on Base:

```bash
./scripts/deposit.sh money 25
```

That's it — the script builds an `approve` + `deposit` pair and submits both
through Bankr's arbitrary-transaction feature. You end up holding 25 `Money`
receipt tokens, redeemable 1:1 for USDC whenever you want.

## Vaults

| Key     | Friendly name       | Chain          | Chain ID | Vault address | Deposit asset | Asset address | Dec |
|---------|---------------------|----------------|----------|---------------|---------------|---------------|-----|
| `money` | Money for Trees     | Base           | 8453     | `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| `gst`   | Grow Some Trees     | Robinhood      | 4663     | `0x95eD511Dbdd7b52795e1F515314bE8d888Ea4F3F` | USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |
| `ftp`   | Feed The People     | Robinhood      | 4663     | `0x873739aeD7b49f005965377b5645914b1D78Ccd3` | USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |

- `money` — the mftUSD receipt; deposit funds tree-planting. **Executable via
  Bankr today** (Base is supported).
- `gst` / `ftp` — Robinhood-native receipts. **Not executable via Bankr yet** —
  Bankr's arbitrary-transaction / agent tooling does not currently reach chain
  4663 (Robinhood). Addresses + ABI are documented here so the moment Bankr
  adds Robinhood, the same flow works unchanged. See
  `references/robinhood-vaults.md`.

Aliases the agent should accept:
- Money for Trees → `money`, `mft`, `mftusd`, `money`, "money for trees"
- Grow Some Trees → `gst`, "grow some trees"
- Feed The People → `ftp`, "feed the people", "feed the people vault"

## How It Works

Every vault exposes the **same** two-function deposit interface:

```
deposit(uint256 amount)                 // mints receipt to msg.sender
depositFor(address to, uint256 amount)  // mints receipt to `to`
```

Both pull the deposit asset from the caller via `transferFrom`, so a deposit is
always **two transactions**:

1. `approve(vault, amount)` on the deposit-asset ERC-20 (USDC / USDG)
2. `deposit(amount)` on the vault → mints `amount` receipt tokens 1:1 to you

The scripts encode both as raw calldata and hand them to Bankr:

```bash
bankr agent "Submit this transaction: {\"to\":\"<asset>\",\"data\":\"0x095ea7b3…\",\"value\":\"0\",\"chainId\":8453}"
bankr agent "Submit this transaction: {\"to\":\"<vault>\",\"data\":\"0xb6b55f25…\",\"value\":\"0\",\"chainId\":8453}"
```

To deposit **on behalf of someone else** (mint the receipt to a different
address), use `depositFor` instead of `deposit` — see "Deposit for another
address" below.

## Usage

```bash
# Deposit $X of the vault's asset (approve + deposit), receipt to yourself
./scripts/deposit.sh <vault-key> <amount>

# Examples
./scripts/deposit.sh money 25       # 25 USDC -> 25 Money for Trees (Base)
./scripts/deposit.sh money 5

# Deposit and mint the receipt to another address (uses depositFor)
./scripts/deposit.sh money 25 0xRecipientAddress...
```

Amounts are in whole units of the deposit asset (dollars of USDC/USDG). The
script converts to 6-decimal base units.

## Natural-language patterns (X / Farcaster / chat)

When this skill is installed, the Bankr agent should map these to a
`money` deposit on Base:

- "deposit $25 into Money for Trees"
- "put $10 into Money"
- "@bankrbot deposit $50 into mftUSD"
- "fund trees with $5 via Money for Trees"

For Grow Some Trees / Feed The People, the agent should recognize the intent,
but until Bankr supports Robinhood (chain 4663) it must tell the user those two
vaults can't be executed through Bankr yet (see `references/robinhood-vaults.md`).

## Technical Details

### Function selectors

| Function | Selector |
|----------|----------|
| `approve(address,uint256)` | `0x095ea7b3` |
| `deposit(uint256)` | `0xb6b55f25` |
| `depositFor(address,uint256)` | `0x2f4f21e2` |

### Calldata encoding

`approve(spender, amount)`:
```
0x095ea7b3
  + spender  (address, left-padded to 32 bytes)
  + amount   (uint256, hex, left-padded to 32 bytes)
```

`deposit(amount)`:
```
0xb6b55f25
  + amount   (uint256, hex, left-padded to 32 bytes)
```

`depositFor(to, amount)`:
```
0x2f4f21e2
  + to       (address, left-padded to 32 bytes)
  + amount   (uint256, hex, left-padded to 32 bytes)
```

`amount` for a $25 deposit at 6 decimals = `25 * 10^6 = 25000000` =
`0x000000000000000000000000000000000000000000000000000000000017d7840`
(the scripts compute this programmatically — do not hand-encode).

### ABI (JSON)

See `references/abi.json` for the minimal ABI of the deposit asset (`approve`)
and the vault (`deposit`, `depositFor`, `redeem`, `balanceOf`).

## Requirements

- Bankr skill installed with an API key configured (this skill shells out to
  `bankr agent`).
- For `money`: USDC balance on Base and ETH for gas (Bankr covers gas).
- Arbitrary contract calls must be enabled on the wallet (Bankr Security →
  "Disable arbitrary contract calls" must be OFF). The deposit uses the raw
  transaction / arbitrary-transaction path, so a wallet that has disabled
  arbitrary calls will reject it.

## Notes

- **1:1 and redeemable.** `deposit(amount)` mints exactly `amount` receipt
  tokens (6 dec, matching the asset). `redeem(amount)` burns them back to the
  asset 1:1. There is no fee on deposit or redeem.
- **The cause is funded by yield, not principal.** Deposited USDC/USDG earns
  yield (Aave on Base, Morpho on Robinhood); a fixed share of *that yield* is
  routed to the cause wallet and to the Meme for Trees reactor. Your deposit
  itself stays fully backed.
- **Permissionless.** Anyone can call `deposit` — no allowlist, no owner.
- **Base only through Bankr for now.** GST/FTP are on Robinhood Chain (4663),
  which Bankr does not currently support; those two are documented, not wired.
