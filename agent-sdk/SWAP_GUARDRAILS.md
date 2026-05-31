# Swap Tool Guardrails Specification

**Status**: APPROVED (G4-1, Emergency)
**Author**: Guardian
**Date**: 2026-05-10

Every guardrail below maps to a real loss event or near-miss.

## Hard Limits

| Rule | Value | Incident |
|------|-------|----------|
| Max per swap | $0.10 USDC equivalent | Prevents fat-finger losses on thin LPs |
| Min cooldown | 60 seconds between swaps | Chart optics — rapid-fire looks like wash trading |
| Slippage max | 5% for MfT/POOP pairs, 2% for stables | Zero-slippage bug drained value on low-liquidity pair |
| Gas limit | 500,000 per swap tx | Prevents stuck txs and excessive gas spend |

## Address Verification

**NEVER type an address from memory.** Lost $95 to a hallucinated address.

1. All token addresses MUST come from `contracts.ts`, `nft-lp-database`, or on-chain query output
2. Grep the project for existing refs before using any address
3. Validate checksum: `ethers.getAddress(addr)` before every swap
4. Allowlist only — swap tool refuses addresses not in the known token list

### Allowed Token Addresses (Base, chain 8453)

```
MfT:    0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3
WETH:   0x4200000000000000000000000000000000000006
USDC:   0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
cbBTC:  0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf
AZUSD:  0x3595ca37596D5895B70EFAB592ac315D5B9809B2
CHAR:   0x20b048fA035D5763685D695e66aDF62c5D9F5055
EARTH:  0xA5528D1fbd69791B7C6951ef1797DBC2c0e4024b
POOP:   0xB93bA1bcc0D09E3e1C7a7a1e3AC5CC57E795afBe
```

New launched tokens may be added dynamically from the factory event log, but must be verified against the V5.2 factory address before first swap.

## Pool Type Verification

**ALWAYS check V2/V3/Algebra before swapping.** Lost $50 to wrong pool type assumption.

1. Before any swap, query the router to determine pool type
2. Use Uniswap V3 `exactInputSingle` for V3 pools
3. Use Uniswap V2 `swapExactTokensForTokens` for V2 pools
4. NEVER assume pool type — verify on-chain
5. If pool type cannot be determined, ABORT the swap

## Transaction Flow

Every swap follows this sequence:

```
1. Validate: address in allowlist, checksum passes
2. Check: pool exists, pool type confirmed (V2/V3)
3. Quote: get expected output, check slippage bounds
4. Cooldown: reject if <60s since last swap from this wallet
5. Approve: ERC-20 approval if needed (exact amount, not unlimited)
6. Execute: swap with slippage protection
7. Verify: confirm output received matches expected (within slippage)
8. Log: record swap details (token, amount, tx hash, timestamp)
```

## Approval Safety

- Use exact approval amounts, NEVER `type(uint256).max`
- Revoke approvals after swap completes (gas permitting)
- Track outstanding approvals in local state

## Wallet Separation

- **Agent wallet** (`agent-wallet.js`): reactor execute(), launch ops
- **Trade wallet** (`trade-wallet.js`): swap operations only, $0.10 limit
- **Shark wallet** (`shark-wallet.js`): Shark agent autonomous trades, $0.10 limit
- **Game wallet**: POOP/USDC game operations only
- NEVER swap from the agent wallet — it holds admin keys

## Error Handling

- NEVER use empty `catch {}` — every failure must be visible
- Log failed swaps with full error context
- If a swap reverts, DO NOT retry automatically — investigate cause first
- If gas estimation fails, DO NOT force gas — the tx would fail on-chain anyway

## Monitoring

- Track cumulative daily spend per wallet
- Hard daily limit: $1.00 per wallet per day
- Alert if any single swap exceeds $0.05 (half of max)
- Log all swaps to a local JSON file for audit trail

## What This Spec Does NOT Authorize

- Swaps above $0.10
- Unlimited ERC-20 approvals
- Swaps from wallets not listed above
- Bypassing cooldown for any reason
- Swapping tokens not in the allowlist without committee vote
