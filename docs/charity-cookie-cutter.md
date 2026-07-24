# Charity Cookie-Cutter 🍪

A repeatable template for launching a token that funds a charity we like — with
**all the standard LP tooling** and **USDC fees routed straight to the charity, no
middleman.** Copy this per charity. First instance: **Fins Attached** (ocean) via
`CORAL`. See [project_coral], [project_cause_token_roster].

## The principle
We **never sit in between the money.** Fees flow on-chain to the charity in USDC,
and the chain proves it. We hold nothing. Our only lever is *re-pointing* a dead
charity to a new one or the trees fallback — never to ourselves.

## The pieces
1. **Standard token + LP tooling** — launch via the existing free factory
   (V7 `0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2`) / reactor. Token gets burns,
   locked LP, the meme wall — the "remaining good" that keeps holders whole even if
   the charity later fails.
2. **`CharityFeeRouter.sol`** (the cookie-cutter core) — ONE per charity:
   - Holds nothing; `flush()` (permissionless) pushes 100% of its USDC to the charity.
   - **No owner withdraw/drain anywhere.** USDC only leaves via flush, only to a
     verified charity or the immortal trees fallback.
   - One lever: `proposeBeneficiary`/`executeBeneficiary` (2-step timelock) to
     repoint if the charity dies / its deposit address rotates — **never to self.**
   - Auto-fallback to trees if the beneficiary is unset/de-verified.
   - `totalRouted` + `Flushed` events = the on-chain feed for the page tracker.
3. **Fee wiring** — point the token's USDC fee stream (LP-fee USDC, and/or the
   reactor's Money→USDC charity leg) at the router address.
4. **Page + disbursement tracker** — a `tasern.quest/<charity>` page that links the
   charity and shows `totalRouted` + each `Flushed` tx (proof the claim is true).
   Mirror the tree-leaderboard pattern.

## Recipe (per new charity)
1. **Verify the charity** — real org + a **permanent on-chain USDC receive address**.
   - **Giveth** orgs have permanent addresses → ideal, route direct.
   - **The Giving Block** orgs are custodial / may rotate deposit addresses → confirm
     a static address exists; if not, point the router at the **trees fallback** and
     sweep to the charity manually (or wait for a stable address). NEVER guess an
     address — copy it from the charity's own verified page.
2. **Deploy `CharityFeeRouter`** with `(usdc, trees, charityAddr, timelockDelay, governance)`.
3. **Launch the token** (standard factory) and **point its USDC fees at the router.**
4. **Build the page + tracker** (`tasern.quest/<charity>`).
5. **Only claim "funds <charity>" once the path is live and verified on-chain.**

## Safety invariants (must hold for every copy)
- Charities paid in **USDC**, never the meme/partner token.
- **No operator custody** — we never hold or skim; flush is permissionless.
- **Repoint = charity-or-trees only**, 2-step timelocked, never to us.
- **Honest labeling** — page states exactly what flows on-chain.
- Framing stays **game/meme**, never investment.

## Status
- `contracts/CharityFeeRouter.sol` — WRITTEN, not yet tested/deployed.
- TODO: fork test → verify Fins Attached USDC address → deploy (gated on approval)
  → wire CORAL fees → build CORAL/Fins Attached page + tracker.
