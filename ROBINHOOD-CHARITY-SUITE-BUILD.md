# Robinhood Charity Suite — Build Report

Build date: 2026-07-12. **Fork-test only — NO mainnet deploys, NO txs, NO funds
moved.** All three components are written, compiled, and fork-tested against a
live mainnet-fork of Robinhood Chain (chainId 4663). This report is the
hand-off: contracts, test results, exact deploy sequence + per-tx gas, the
USDG-sourcing verdict, and a READY / BLOCKED status per component.

> ⚠️ **The blockers, loud and up front — there is NO AMM (Uniswap V3/V2 or any
> DEX) on Robinhood Chain 4663.** That single fact causes THREE blockers:
> 1. **Little John sell-wall** — needs a V3 NPM+factory. None exists. BLOCKED.
> 2. **USDG sourcing** — no on-chain pool to buy USDG; we can't mint it. BLOCKED
>    (gates any live vault use).
> 3. **NEW — the 3-way harvest split needs a MEME LP.** Founder (2026-07-12)
>    redefined the split: harvest legs 1 & 3 **BUY Meme-for-Trees from its LP**.
>    No AMM on RH ⇒ no meme LP ⇒ **`harvest()` reverts until a meme LP + router
>    exist on 4663** (the deposit/redeem 1:1 half still works without it). On
>    **Base** the meme LP + router already exist, so the split runs there.
> Details in §USDG Verdict, §3-way split, and §Component Status.

---

## What was built (file paths)

| File | Purpose |
|---|---|
| `C:\Users\bigji\Documents\MfT-Launch\contracts\CharityVaultMorpho.sol` | The vault. Adapts our Base `CharityFund.sol` — Aave swapped for Morpho ERC-4626. |
| `C:\Users\bigji\Documents\MfT-Launch\contracts\LittleJohn.sol` | `$LJ` meme — 1B fixed-supply ERC20, 18 dec, no admin. |
| `C:\Users\bigji\Documents\MfT-Launch\contracts\test\MockMorphoVault.sol` | TEST-ONLY mocks: freezable Morpho vault, USDG, meme token, and a V2-style router. Proves the honest-revert paths + the 3-way split. |
| `C:\Users\bigji\Documents\MfT-Launch\test\rh-charity-suite-fork.js` | Fork test vs the **real** Morpho vault on 4663. |
| `C:\Users\bigji\Documents\MfT-Launch\test\rh-charity-vault-unit.js` | Local unit test for redemption honesty + asset() binding. |
| `C:\Users\bigji\Documents\MfT-Launch\test\rh-gas-estimate.js` | Measures deploy + op gas on the fork. |
| `C:\Users\bigji\Documents\MfT-Launch\deploy\rh-charity-suite-deploy.cjs` | Staged, DRY-default, resumable deploy script (funding-gated). |
| `C:\Users\bigji\Documents\mftusd-build\rh-probe7-infra.cjs` | Read-only recon: AMM presence + gas + USDG on 4663. |
| `C:\Users\bigji\Documents\mftusd-build\rh-probe8-usdg-holders.cjs` | Read-only recon: USDG whales (fork-impersonation source). |
| `C:\Users\bigji\Documents\MfT-Launch\hardhat.config.js` | Added `FORK_RH=1` network (forks 4663) + solc overrides for the two contracts. |

---

## 1. CharityVaultMorpho.sol — the vault

Faithful 1:1 port of `CharityFund.sol`. The **only** structural change is the
yield adapter (per the recon scope):

| Aave (Base) | Morpho VaultV2 (RH) — as built |
|---|---|
| `aavePool.supply(usdc, amt, this, 0)` | `vault.deposit(amt, address(this))` |
| `aavePool.withdraw(usdc, amt, to)` | `vault.withdraw(amt, to, address(this))` |
| `aUsdc.balanceOf(this)` (backing) | `vault.convertToAssets(vault.balanceOf(this))` |
| `usdc` (6 dec) | `usdg` (6 dec) — receipt stays 6-dec, 1:1 |

Kept verbatim: 1:1 `_mint`/`_burn`, `depositFor`, a Synthetix-style accumulator,
`ReentrancyGuard`. **Dropped** the V2/V3 LP-reward registry (no AMM on RH — dead
weight). **The harvest split was redefined** by the founder (see below).

### The 3-way harvest split (founder 2026-07-12)

`harvest(minMemeOutWeb, minMemeOutDepositor)` pulls the accrued Morpho yield as
USDG and splits it into **three configurable legs** (bps, must sum to 10000;
default **3333 / 3334 / 3333**):

1. **WEB leg (`webBps`)** — buys Meme-for-Trees from its LP with half the leg,
   then `addLiquidity(usdg, meme)`; LP tokens go to `lpRecipient` (deepens the
   web). *Grows the meme's own liquidity.*
2. **CAUSE leg (`causeBps`)** — USDG sent straight to `charityWallet` (the actual
   donation; named-route / gap-fill). *The remainder leg — takes any rounding
   dust so nothing is lost.*
3. **DEPOSITOR leg (`depositorBps`)** — buys meme and distributes it to
   **depositors** pro-rata (build their bags; incentivize deposits). Depositors
   pull it with `claimMeme()`. Uses a Synthetix accumulator denominated in the
   **meme** token.

**Because legs 1 & 3 BUY the meme, a `memeToken` + `swapRouter` (+ `lpRecipient`)
must be wired via `setMemeWiring` before harvest works.** They start UNSET, so
the same contract deploys cleanly on a chain where the meme LP doesn't exist yet
(RH) — and **`harvest()` reverts with `"meme wiring unset…"` until wired.** The
deposit/redeem 1:1 half is fully functional without the meme wiring.

### Design decisions folded in

- **Reusable constructor:** `(name, symbol, usdg, vault, charityWallet, owner,
  yieldDestinationLabel)`. The split + meme wiring are owner-set post-deploy, so
  one deploy serves any chain/cause.
- **Named-cause-first doctrine:** `charityWallet` is settable via
  `setCharityWallet(owner-only)` so a specific real-world cause's on-chain
  address can be pointed to once identified. Until then it defaults to the
  **project operations wallet `0x0780…`** — the same cross-chain distributor that
  already collects the Base "Money for Trees" charity yield (one auditable
  collector-distributor identity). `owner` is **renounceable** (freezes the
  split, meme wiring, and destination forever). **The owner can ONLY set the
  split/meme-wiring/destination — never touch principal, the Morpho position, or
  holder receipts.**
- **Redemption honesty (unchanged):** `redeem()` uses `withdraw(assets,…)` so the
  user gets *exactly* `amount` USDG (ERC-4626 rounds shares up against the vault;
  the contract absorbs the 1-wei dust). If Morpho lacks instant liquidity the
  `try/catch` bubbles the clear reason `"insufficient vault liquidity - large
  redeems may queue, try smaller or retry later"`, and the same-tx burn is fully
  restored — never leaks, never fakes. **Every harvest leg is honest too:** if
  the yield withdrawal, a meme buy, or the addLiquidity fails, harvest **reverts
  with a specific reason** (`"meme buy failed…"`, `"addLiquidity failed…"`,
  `"insufficient vault liquidity for harvest…"`) — a leg is **never silently
  skipped**.
- **Anti-grief slippage:** meme buys reject `minOut = 0` and there's an
  owner-tunable `maxSlippageBps` floor; the caller passes real min-outs per
  harvest.
- **Exact approvals:** every external approval is `forceApprove(exact)` then
  reset to 0 — **no standing MaxUint256 allowance** anywhere (house rule).
- **Binding check:** constructor rejects any vault whose `asset() != usdg`.

---

## 2. Deploy plan — TWO vault instances

Both via `deploy/rh-charity-suite-deploy.cjs` (staged, DRY-default, `--live`
gated, resumable). Split defaults to **3333/3334/3333**; meme wiring is a
**post-deploy** `setMemeWiring` call — **BLOCKED on RH (no meme LP)**.

| Instance | name / symbol | charityWallet (default) | label | TODO |
|---|---|---|---|---|
| Money for Trees | `"Money for Trees"` / `RH` | `0x0780…` (gap-fill) | `tree planting` | point at a named tree cause when identified |
| Feeding People | `"Feeding People"` / `FTP` | `0x0780…` (gap-fill) | `feeding people` | general food-security gap-fill vault; point at a named food cause when identified (a cause-specific food token comes later, transitioned via `setCharityWallet`) |

`owner` (governance: split / meme wiring / destination) is `0x0780…` for both,
renounceable.

**Post-deploy wiring (per vault):** `setMemeWiring(memeToken, swapRouter,
lpRecipient)` — **only possible where a meme LP + router exist.** On RH: BLOCKED.
On Base: the MfT LP + a V2 router already exist, so this is a single call.

---

## 3. Little John ($LJ) meme + wall

- **Token:** `LittleJohn.sol` — standard 1,000,000,000 fixed-supply ERC20, 18
  dec, entire supply minted to treasury `0xE2a4…aC10`, no owner/mint/pause.
  Same recipe as Base band tokens (RISH/BONGO/DGT/HT). **READY** to deploy.
- **Wall (1% one-sided, `$LJ` paired vs `$FTP`, start ~$10K MC):** the deploy
  code path exists but is a **loud no-op** because **⛔ there is no AMM on 4663**
  (see §USDG Verdict). The one-sided-wall pattern (`deploy-second-walls.cjs`)
  *requires* a Uniswap V3 NPM + factory; none exists on RH. Options in §Recos.

---

## Fork-test results (all green)

Forked live 4663 state → the **real** Morpho Steakhouse USDG vault
(`0xBeEff0…09dd`) and USDG (`0x5fc536…d168`) are used; a real USDG whale
(`0x8366a3…0951`, ~5.3M USDG) is impersonated to fund the depositor.

```
FORK_RH=1 npx hardhat test test/rh-charity-suite-fork.js
  RH Charity Suite (fork 4663)
    ✔ binds to the real USDG + Morpho vault
    ✔ deposit: mints receipt 1:1 and parks USDG in Morpho
    ✔ redeem: returns EXACTLY 1:1 USDG
    ✔ yield accrues and harvest() does the 3-way split honestly
    ✔ oversized redeem reverts CLEANLY (honest — never leaks, never fakes)
    ✔ governance: named-cause-first destination re-pointing
    ✔ LittleJohn: 1B fixed supply to treasury, no admin
  7 passing

npx hardhat test test/rh-charity-vault-unit.js   (mock meme + router + vault)
    ✔ defaults to a 3333/3334/3333 split
    ✔ deposit + redeem 1:1 when liquid
    ✔ redeem reverts with the HONEST reason when the vault is illiquid
    ✔ harvest REVERTS honestly when meme wiring is unset
    ✔ 3-way split: cause gets USDG, depositors get meme, web adds LP
    ✔ harvest reverts honestly if the meme BUY fails (thin LP)
    ✔ harvest reverts honestly if addLiquidity fails
    ✔ harvest reverts honestly if Morpho can't cover the yield withdrawal
    ✔ rejects minOut=0 (no blind-slippage grief)
    ✔ setSplit enforces sum==10000; owner-only
    ✔ rejects a vault whose asset() != usdg at construction
  11 passing
```

Proven against the **live Morpho vault**: **deposit → accrue → 3-way-harvest →
redeem 1:1 works.** The harvest sends the CAUSE slice as USDG to the project
wallet, accrues the DEPOSITOR slice as claimable **meme** to depositors, and mints
LP to the WEB-leg recipient. **Oversized/illiquid redeem reverts cleanly** and
fully restores balance (no leak). Every failure mode (meme wiring unset, meme buy
fails, addLiquidity fails, Morpho illiquid, minOut=0) **reverts with its own clear
reason** — no leg is ever skipped. The 1-wei ERC-4626 rounding is absorbed (redeem
returns *exactly* the requested USDG). (Meme legs on the fork use a mock meme +
mock router since RH has no AMM; the logic is chain-agnostic and runs on Base's
real LP/router.)

> Fork note: to run the live Morpho vault's 0.8.28 bytecode on the fork, the
> `FORK_RH` network executes under the **cancun** hardfork (the vault uses
> push0/mcopy). Our own contracts compile to **paris** (no Orbit-opcode
> assumptions) — see `hardhat.config.js` overrides.

---

## Exact deploy sequence + per-tx gas (measured on the 4663 fork)

Live RH gas at recon: base ~0.0539 gwei, maxFee ~0.108 gwei (probe7). Costs below
use **0.108 gwei** (conservative).

| # | Tx | Gas used | ETH @0.108 gwei |
|---|---|---:|---:|
| A | Deploy `CharityVaultMorpho` ("Money for Trees") | 2,466,670 | 0.00026640 |
| B | Deploy `CharityVaultMorpho` ("Feeding People") | 2,466,682 | 0.00026640 |
| C | Deploy `LittleJohn` ($LJ) | 521,686 | 0.00005634 |
| — | **Total deploy** | **5,455,038** | **~0.00059 ETH** |
| (op) | `deposit(1000 USDG)` | 379,648 | 0.00004100 |
| (op) | `redeem(500 USDG)` | 185,911 | 0.00002008 |
| (op) | `setMemeWiring` (post-deploy, when unblocked) | ~70,000 | ~0.00001 |

(Vault deploy grew from ~1.70M to ~2.47M gas vs. the pre-split version — the
3-way split + meme-buy legs added code; still well under EIP-170.)

Block gas limit on 4663 is `2^50` — **no per-tx gas-cap concern** (unlike Base's
~16.5M cap); no staging needed for gas reasons. The suite is staged anyway for
crash-safety/resumability.

### Total cost to ship

- **ETH (gas):** ~**0.00059 ETH** for all three deploys, + ~0.00006 ETH for a
  live deposit/redeem smoke test → **~0.00065 ETH all-in**.
- **Agent RH ETH on hand:** **0.00107 ETH** (`0xE2a4…aC10`, read live). **Still
  enough** for all deploys + smoke test (leaves ~0.0004 ETH). Top up to ~0.002
  ETH if you also want headroom for meme-wiring/ops later.
- **USDG:** a few USDG (~$3–5) to seed the first live deposit/redeem test — **but
  see the verdict: we currently have no way to obtain USDG on 4663.**

---

## USDG sourcing verdict — ⛔ CRITICAL BLOCKER (loud)

**We currently have NO on-chain path to acquire USDG on Robinhood Chain 4663.**

Evidence (all read live via `rh-probe7-infra.cjs`, 2026-07-12, block ~8.10M):

- **No AMM exists on 4663.** Every canonical DEX address is empty code:
  Uniswap V3 factory `0x1F98431c…` (0 bytes), V3 NPM `0xC36442b4…` (0 bytes),
  SwapRouter02 `0x68b34658…` (0 bytes), Uniswap V2 factory `0x5C69bEe7…`
  (0 bytes), and a Base-style Aerodrome router (0 bytes). **No pool = no swap =
  no buy USDG on-chain.**
- **USDG is issuer-controlled** (Global Dollar / Paxos-style; 194.2M supply). We
  **cannot mint it.** The 8M idle in the Morpho vault is the vault's, not ours.
- **Agent USDG balance on 4663 = 0.**
- **The MfT bridge cannot help.** `rh-deploy.cjs`/`rh-relayer.cjs` is a
  **lock-and-mint TWIN bridge for MfT specifically** (Base MfT → RH twin). USDG
  is *native* on RH, not an MfT twin — the bridge has no USDG lane and adding one
  would require a USDG lock vault on the origin chain (which we don't control).

**So how does USDG get onto 4663 at all?** From the recon + this probe, the only
observed inflow path is the **Robinhood app / ERC-4337 EntryPoint**
(`0x0000007172…`) — i.e. USDG arrives via **Robinhood's own product rails**, not
a permissionless DEX or a bridge we can drive. **Whether we (agent wallet
`0xE2a4…`) can obtain even a few USDG is UNKNOWN and probably requires the
founder to move USDG in through the Robinhood app / an off-chain on-ramp and then
transfer it to our wallet on 4663.**

### Consequence

- **Vault half (Money for Trees + Feeding People):** the contracts are **built and
  fork-proven**, but a **live deposit/redeem test is BLOCKED until USDG is in a
  wallet we control on 4663.** We can deploy the vault contracts without USDG
  (they hold no funds at deploy), but they're inert until someone can deposit.
- **Meme + wall half:** `$LJ` token is **deployable now** (no USDG needed), but
  the **wall is BLOCKED — no AMM on 4663** (independent of the USDG issue).

**FOUNDER ACTION NEEDED:** confirm whether a few USDG can be routed to
`0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10` on Robinhood Chain (via the RH app
or any on-ramp you have). If not, the vault half cannot be live-tested and the
whole USDG-denominated product is on hold on RH.

---

## Meme-LP precondition — ⛔ SECOND BLOCKER for harvest (loud)

The founder's 3-way split makes **`harvest()` depend on an on-chain Meme-for-Trees
LP + a swap router** (legs 1 & 3 BUY the meme). This is a **hard precondition,
alongside USDG**:

- **On RH (4663):** there is **no AMM**, therefore **no meme LP and no router** —
  so even after USDG is sourced and deposits happen, **`harvest()` reverts**
  (`"meme wiring unset…"`) until a meme LP + router exist on RH. The vault still
  takes deposits and honors 1:1 redeems; it just can't run the yield split. The
  contract is built to **not** fake it: `setMemeWiring` stays unset and harvest
  refuses to run rather than silently dropping legs.
- **On Base:** the MfT LP + a Uniswap-V2-style router **already exist**, so
  `setMemeWiring(MfT, router, lpRecipient)` is a single post-deploy call and the
  split runs immediately. **This is the strong argument for running the vaults on
  Base** (or dual-homing) rather than waiting on RH infrastructure.

**Two independent things gate live harvest on RH: (a) USDG sourcing, (b) a meme
LP + router.** Both are absent today; on Base only (a) trivially holds (USDC via
any DEX) and (b) already exists.

---

## Component status — READY / BLOCKED

| Component | Status | Notes |
|---|---|---|
| `CharityVaultMorpho.sol` (contract, 3-way split) | ✅ **READY** | Written, compiled, 7/7 fork + 11/11 unit tests pass vs the real Morpho vault. |
| "Money for Trees" vault instance (deploy) | 🟡 **READY to deploy, BLOCKED to fully use** | Deployable ~0.00027 ETH. Deposit/redeem 1:1 needs USDG; `harvest()` also needs a meme LP + router (both absent on RH). |
| "Feeding People" vault instance (deploy) | 🟡 **READY to deploy, BLOCKED to fully use** | Same as above. |
| `LittleJohn.sol` ($LJ token) | ✅ **READY** | Deployable now, ~0.00006 ETH, no USDG needed. |
| $LJ / $FTP sell-wall | ⛔ **BLOCKED** | No Uniswap V3 / any AMM on 4663. Cannot place a wall. |
| `harvest()` 3-way split (live) | ⛔ **BLOCKED on RH** | Needs a meme LP + router on 4663 (none exist). Runs on Base where the MfT LP already exists. |
| Live deposit/redeem smoke test | ⛔ **BLOCKED** | Needs USDG on 4663 in our wallet (see verdict). |
| Gas / RH ETH | ✅ **READY** | 0.00107 ETH on hand > ~0.00065 ETH all-in needed. |

**All of the above is deploy-gated on: (1) Ethics Officer review, (2) founder's
explicit "yes", (3) the FUNDING PAUSE (no capital asks until ~07-15), (4) the
USDG-sourcing resolution, (5) a meme LP + router for live harvest.** Nothing is
live. Nothing is committed/pushed.

---

## Two disclaimers that MUST appear in the vault UI/docs

**(1) Withdrawal-queue disclaimer — "the tool, not us":**
> "Your deposit is 1:1 backed by USDG held in Morpho's Steakhouse USDG vault, a
> third-party yield vault. Morpho lends USDG into markets and keeps an idle
> buffer for instant withdrawals. Very large single withdrawals may exceed the
> instant buffer and will fail cleanly — asking you to withdraw a smaller amount
> or retry later — until liquidity frees up. This is Morpho's withdrawal
> behavior, not a lock imposed by us. Your balance is never lost; a failed
> withdrawal changes nothing."

**(2) Charity-distributor framing (per `project_ships_manual` / Good Standard),
now covering the 3-way split:**
> "Vault yield is split three ways: about a third is the donation — routed to a
> named cause where one is identified on-chain (direct, transparent routing), and
> otherwise collected by the project operations wallet which distributes it to the
> cause (tree-planting / food security) until a named cause is set. About a third
> buys the Meme-for-Trees token and adds it to that token's liquidity (deepening
> the shared web). About a third buys the meme token and gives it to depositors as
> a reward. Donation funds are not held as ours — they route through us to the
> cause; the destination is visible on-chain and every change is logged
> (`CharityWalletChanged`). The split itself is on-chain and logged
> (`SplitChanged`)."

Also surface, honestly: backing = "USDG value of Morpho shares," **not a hard
peg** — if a Morpho market takes bad debt, redemptions could return slightly
under 1:1 (same tail-risk category as trusting Aave on Base).

---

## Recommendations (open threads for the founder / committee)

1. **Two blockers gate live vault operation on RH — resolve both or move to
   Base:** (a) **USDG sourcing** (no on-chain path to buy USDG on 4663), and
   (b) **a meme LP + router** (harvest legs 1 & 3 buy the meme; none exists on
   4663). On **Base** both are solved today (USDC via any DEX; the MfT LP + a V2
   router already exist), so **strongly consider running the vaults on Base** —
   or dual-home — rather than waiting on RH infrastructure.
2. **The wall can't live on RH either.** Honest options, founder's call:
   (a) place the **$LJ / $FTP wall on Base** (Base has our whole V3 stack + the
   band-wall pattern), keeping the vaults wherever they land; or (b) wait for an
   AMM on RH. Do **not** deploy a wall to a chain with no AMM.
3. **Confirm the split** — default is **3333/3334/3333** (web / cause / depositor);
   `setSplit` can tune it (must sum to 10000). Confirm with the Ethics Officer
   alongside the destination doctrine and the depositor-reward mechanic (buying
   the meme for depositors is an incentive — make sure the framing avoids any
   "returns/investment" language per house rules).
4. **Wire the meme legs** post-deploy via `setMemeWiring(memeToken, router,
   lpRecipient)` — only where a meme LP + router exist. Set a real `lpRecipient`
   (the project wallet) so WEB-leg LP is held by the project.
5. **Deploy order when unblocked:** vaults (A, B) → $LJ (C) → [wall D only if
   moved to Base] → `setMemeWiring` per vault. Script is resumable; run DRY
   first, then `--live` after the gates clear and (per the funding-pause note)
   after ~07-15.
```
