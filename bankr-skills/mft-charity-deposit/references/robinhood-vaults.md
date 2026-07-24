# Robinhood vaults (GST / FTP) — documented, not yet Bankr-executable

The **Grow Some Trees (GST)** and **Feed The People (FTP)** vaults live on
**Robinhood Chain (chainId 4663)**. Their deposit interface is identical to the
Base "Money for Trees" vault — `deposit(uint256)` / `depositFor(address,uint256)`,
1:1 receipt, redeemable — but **Bankr does not currently support chain 4663**.

Bankr's arbitrary-transaction / agent tooling reaches Base (8453), Ethereum (1),
Polygon (137), and Unichain (130). Robinhood is not on that list, so `deposit.sh`
intentionally refuses to run for `gst` / `ftp` and points here.

## Addresses (verified on-chain 2026-07-14)

| Vault | Address | Deposit asset (USDG) | Cause |
|-------|---------|----------------------|-------|
| Grow Some Trees (GST) | `0x95eD511Dbdd7b52795e1F515314bE8d888Ea4F3F` | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Tree-planting |
| Feed The People (FTP) | `0x873739aeD7b49f005965377b5645914b1D78Ccd3` | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Feeding people |

- Chain ID: **4663**
- RPC: `https://rpc.mainnet.chain.robinhood.com`
- Explorer: `https://robinhoodchain.blockscout.com/address/<addr>`
- USDG decimals: 6
- Both are Morpho/USDG vaults (Steakhouse USDG ERC-4626 backing), NOT
  CharityFund clones — but they expose the same public `deposit()` /
  `depositFor()` receipt interface.

## Manual deposit flow (until Bankr adds Robinhood)

Two transactions on chain 4663, exactly like Base:

1. `approve(vault, amount)` on USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
   - calldata: `0x095ea7b3` + vault (32B) + amount (32B, 6-dec base units)
2. `deposit(amount)` on the vault
   - calldata: `0xb6b55f25` + amount (32B)

Any Robinhood-capable wallet or script (e.g. an ethers provider pointed at the
RH RPC, or the Shillwood/RH tooling in `mftusd-build`) can submit these. The
`mftusd-build` repo already has RH deposit helpers (e.g.
`deposit-rh-feedingpeople.cjs`) that do this natively.

## When Bankr adds chain 4663

No code change needed beyond flipping `EXECUTABLE="yes"` for `gst` / `ftp` in
`scripts/deposit.sh`. The selectors, addresses, decimals, and two-tx flow are
already correct and identical to the Base path.
