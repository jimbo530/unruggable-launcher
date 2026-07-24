# Fee-Share NFT Model — Spec (NEW LAUNCHES ONLY)

Status: **REMODEL IN PROGRESS, NOT DEPLOYED.** Needs legal review before live.
Securities status: user has knowingly placed "get stamped" on the roadmap
(not in current budget). Guardian flag stands; build proceeds by user decision.

## The idea in one line

Every new launch mints **100 NFTs**. The reactor turns collected **Money fees
into USDC** and splits that USDC across the 100 NFTs. **Each NFT = 1/100.**
All 100 go to the launcher to keep or sell.

## Reactor remodel — per pool, when it fires

A launch has 2 pools: **TOKEN/Money** (70%) and **TOKEN/Meme** (30%).
Collecting fees yields three assets: TOKEN, Money, Meme(MfT).

1. **Collected TOKEN (launched token) → BURN 100%.** No launcher cut anymore.
2. **Collected Money → REDEEM to USDC, send to distributor.** Money never
   leaves the reactor as Money ("can't leak"). Reactor calls `Money.redeem()`
   (verified-on-fork selector — NOT `withdraw`), measures its real USDC balance
   increase, forwards that USDC to the FeeShareDistributor via `notifyDeposit`.
3. **Collected Meme (MfT) → ADD LP (LP-only, no upstream fuel).** 100% of the
   collected MfT fees buy half TOKEN and deepen the TOKEN/Meme position. The
   upstream-fuel diversion has been removed — that "engine" now lives in the
   game layer, not the contract.

**Positions are permanent — only fees are processed.** Both the Money (calm /
stable anchor) and Meme (volatile) LP positions are never withdrawn, decreased,
or drained; the reactor only ever `collect()`s fees and `increaseLiquidity()`s
to deepen. There is no decreaseLiquidity / withdraw / position-transfer path in
the reactor, so the LP principal can never be reduced.

## Pieces

1. **FeeShareDistributor** (already built) — ERC-721, fixed 100 supply, dividend
   accounting. **Payout token set to USDC.** Each deposit adds `usdc/100` to a
   running per-NFT counter; holders `claim`. Selling an NFT passes only FUTURE
   USDC; past earnings settle to the seller as withdrawable escrow.
2. **SporeReactorV6** (new) — the remodel above. `initialize` extended to receive
   `money`, `usdc`, and the `distributor`.
3. **MycoPadV9** (new factory) — like V8 but wires V6, passes money+usdc, and
   constructs the distributor with USDC as the payout token, minting 100 NFTs to
   the launcher.

## Superseded (kept for reference, NOT deployed)
- SporeReactorV5 / MycoPadV8 — earlier "pay in the launched token" version.

## Hard gates before any deploy
- ~~Verify the LIVE Money contract: redemption is holder-callable AND returns
  USDC.~~ **RESOLVED — verified on Base mainnet fork (block 47510000).** The live
  Money at `0xe3dd…A072` is an EIP-1167 clone (impl `0xbea5…c96f`) that exposes a
  `usdc()` getter returning the real Base USDC (`0x8335…2913`). The holder-callable
  redemption function is **`redeem(uint256)`** (NOT `withdraw(uint256)`, which does
  not exist on the impl) and it delivers **USDC at 1:1**. `SporeReactorV6.IMoney`
  is corrected to `redeem(uint256)`; the AS-BUILT reactor's own `execute()`
  redeems real Money through to the distributor on the fork (test/e2e-fork-v9.js).
  No Money/USDC swap-fallback is required.
- Confirm USDC + Money addresses from a trusted source (never hardcode/typed).
- **Legal sign-off on securities exposure — the only remaining gate.**

## ⚠️ Legal flag (on the bus)

An NFT bought to earn a USDC share of fees is close to a security / profit-share
instrument. Paying in USDC strengthens this vs. paying in token. Do not deploy
until legal reviews.
