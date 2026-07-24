# Money for Trees on Robinhood Chain (Morpho yield engine) — Build Scope

Recon date: 2026-07-12. Recon-only: no deploys, no txs, no funds moved. All
addresses below were read live from Robinhood Chain (chainId 4663) via
`https://rpc.mainnet.chain.robinhood.com` and cross-read against our canonical
Base contracts. Probe scripts: `mftusd-build/rh-probe*.cjs`.

---

## 0. Executive summary (go / no-go)

**GO — clean to build.** A native "RH-Money" charity vault on Robinhood Chain is
a small, well-scoped port of our existing Money-for-Trees vault. The only real
code change is the yield adapter: swap Aave V3 `supply/withdraw/aToken.balanceOf`
for Morpho Vault V2 ERC-4626 `deposit/withdraw/redeem/convertToAssets`. Everything
else (1:1 mint/redeem, yield sweep to charity, immutable design) is unchanged.

- **Buildable?** Yes. Permissionless chain, permissionless vault (all gates
  `address(0)`), permissionless contract deployment confirmed.
- **Yield source?** Morpho **Vault V2** "Steakhouse USDG" (`steakUSDG`),
  curated by Steakhouse Financial — the exact vault Robinhood Earn uses.
  Currently ~$67.1M assets, share price ~1.0012, ~$7.99M idle instant liquidity.
- **Biggest risk?** Withdrawal liquidity is NOT hard-guaranteed 1:1 at all sizes.
  Morpho Vault V2 lends USDG into markets; only the *idle* buffer (~$8M now) plus
  what's freeable is instantly redeemable. Our house rule is "never leak deposit
  tokens / always redeemable." A single tx that redeems more than on-hand
  liquidity can revert. Mitigation below (§3.1) — this is a design constraint, not
  a blocker.
- **Rough cost?** ~1 day to write + 1 day to test on fork/mainnet-small.
  ~$3–5 of USDG seed for the first live deposit/redeem test. Gas negligible.

---

## 1. What "Money for Trees" is (our canonical Base implementation)

Source read: `mftusd-build/contracts/CharityFund.sol` and
`mftusd-build/contracts/MoneyForTreesV2.sol`. Both are the same core pattern:

1. User `deposit(amount)` a stablecoin (USDC, 6 dec).
2. Contract `aavePool.supply(usdc, amount, this, 0)` — parks principal in Aave V3.
3. Contract `_mint(user, amount)` — mints the deposit-receipt token **1:1**.
4. Yield accrues as Aave `aUSDC.balanceOf(this)` grows above `totalSupply()`.
5. `harvest()`: `yield = aUSDC.balanceOf(this) - totalSupply()`; withdraw yield
   from Aave; split it (charity USDC / holder auto-compound / service→reactor).
6. `redeem(amount)`: `_burn(user, amount)` then
   `aavePool.withdraw(usdc, amount, user)` — returns stablecoin **1:1**.

Immutable, no owner, permissionless. The **entire** Aave coupling is 3 call sites:
- `IAaveV3Pool.supply(...)` in `deposit`/`depositFor`/`sweep`
- `IAaveV3Pool.withdraw(...)` in `redeem`/`harvest`
- `aUsdc.balanceOf(address(this))` as the "backing" reading in `harvest`,
  `pendingYield`, `totalBacking`.

That 3-point coupling is the whole thing we re-adapt.

---

## 2. Robinhood Chain / Morpho recon (all verified on-chain, chainId 4663)

| Thing | Address | Verified reading |
|---|---|---|
| Chain | chainId **4663** (0x1237), block ~8.08M | `eth_chainId` / `eth_blockNumber` |
| Gas token | ETH | Orbit default |
| Contract deploy | **permissionless** | `estimateGas` on a CREATE from a random addr succeeds |
| **USDG** (Global Dollar) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | name "Global Dollar", symbol **USDG**, **6 decimals**, totalSupply ~$193.98M, not paused |
| **Morpho Vault V2 (Steakhouse USDG)** | `0xBeEff033F34C046626B8D0A041844C5d1A5409dd` | name "Steakhouse USDG", symbol **steakUSDG**, **18 decimals**, ~21KB code |
| — vault `asset()` | = USDG above | **confirmed asset() == USDG** |
| — vault `totalAssets()` | 67,143,416,122,322 = **~$67.14M** USDG | live |
| — vault curator | `0x9023FBD6A08C666491A2d1648737E400cF42D2Fb` | Steakhouse |
| — vault owner | `0x337feFE49514fb901eB455A501b8Be76CDeF7660` | Steakhouse/RH |
| — liquidity adapter | `0x44ABc1d6cCFF2696d98890B92E2157AF242179c2` | where lent liquidity routes |

**Contract type (important):** the vault is verified on Blockscout as **`VaultV2`**
(Morpho **Vault V2**, compiler 0.8.28), NOT classic MetaMorpho V1. It is fully
ERC-4626, but with two differences that matter for our port:

1. **Gate system.** VaultV2 has `receiveSharesGate`, `sendAssetsGate`,
   `sendSharesGate`, `receiveAssetsGate`. If any is set, deposits/withdrawals are
   permissioned (KYC/allowlist style). **Live reading: ALL FOUR GATES ARE
   `address(0)` (OPEN).** `canReceiveShares(EOA)`, `canSendAssets(EOA)`,
   `canReceiveAssets(EOA)` all return `true` for an arbitrary address. => The vault
   is **currently permissionless.** Robinhood app deposits route through ERC-4337
   (EntryPoint `0x00...71727De2...`) by product choice, not because the vault
   requires it.
2. **`max*` views quirk.** `maxDeposit/maxMint/maxWithdraw/maxRedeem` return **0**
   for every address (including real share holders). Do NOT rely on `max*` for
   logic — VaultV2 doesn't populate them the MetaMorpho-V1 way. Use
   `previewDeposit/previewRedeem` (both compute correctly) and just do the call.

**ERC-4626 math verified live:**
- `previewDeposit(1000 USDG)` = `998.793e18` shares (share price ~1.0012).
- `previewRedeem(1e18 shares)` = `1,001,208` = 1.001208 USDG.
- **Roundtrip:** deposit 1000 USDG → shares → redeem = **999.999999 USDG**
  (loss = **1 asset unit = 0.000001 USDG**). ERC-4626 rounds against the
  depositor by 1 wei-of-asset. Our 1:1 wrapper MUST absorb this (see §3.2).
- **Live full redemption succeeds:** a real holder (550.7 shares) static-redeemed
  → **551.41 USDG out** (principal + accrued yield). No lock/queue at that size.
- **Instant liquidity now:** ~**$7.99M USDG idle** in the vault, redeemable
  immediately; the rest is lent out.

---

## 3. Architecture — RH-Money vault

Same shape as `CharityFund.sol`, adapter swapped. Decimals note: USDG is 6-dec
(same as USDC) so RH-Money stays **6 decimals** and 1 RH-Money = 1 USDG. The
Morpho *shares* are 18-dec — that conversion lives entirely inside the adapter.

### deposit(amount)  [amount in USDG, 6 dec]
1. `usdg.safeTransferFrom(user, this, amount)`
2. `vault.deposit(amount, address(this))`  // ERC-4626, returns shares (18 dec) to `this`
3. `_mint(user, amount)`  // RH-Money 1:1 with USDG deposited
4. emit Deposit

### redeem(amount)  [amount in RH-Money = USDG out]
1. `_burn(user, amount)`
2. `uint256 shares = vault.previewWithdraw(amount)`  // shares needed for `amount` USDG
3. `vault.withdraw(amount, user, address(this))`  // pulls exactly `amount` USDG to user, burns shares from `this`
4. emit Withdraw
   - `withdraw(assets,...)` guarantees the user receives EXACTLY `amount` USDG
     (ERC-4626 rounds shares UP against us — safe direction, we hold the buffer).

### yield accounting
- **Backing (was `aUSDC.balanceOf(this)`):**
  `backing = vault.convertToAssets(vault.balanceOf(address(this)))`
  = current USDG value of all shares this contract holds.
- `yield = backing - totalSupply()` (both in 6-dec USDG terms). Identical to the
  Aave version conceptually.

### harvest()
- `yield = vault.convertToAssets(vault.balanceOf(this)) - totalSupply()`
- require `yield >= MIN_HARVEST`
- `vault.withdraw(charityShare + serviceShare, address(this), address(this))`
  // pull the yield portion out as USDG
- send `charityShare` USDG → charityWallet
- holder/service split: same as canonical (auto-compound and/or route to a
  reactor). On RH there is no MfT reactor yet — v1 can send the full non-charity
  slice to charity or hold it as auto-compound; wire a reactor later if/when an
  RH-side MfT venue exists.

### ERC-4626 calls used (all confirmed present & working on the live vault)
`deposit(uint256 assets, address receiver)`,
`withdraw(uint256 assets, address receiver, address owner)`,
`redeem(uint256 shares, address receiver, address owner)`,
`previewWithdraw(uint256 assets)`, `previewRedeem(uint256 shares)`,
`convertToAssets(uint256 shares)`, `convertToShares(uint256 assets)`,
`balanceOf(address)`. (Avoid `maxDeposit/maxWithdraw` — they read 0 on VaultV2.)

---

## 3.1 THE critical constraint — withdrawal liquidity (house rule: always redeemable)

Aave and Morpho behave differently here and this is the one thing to design around:

- **Aave (Base):** `aToken.balanceOf` is 1:1 with the underlying and withdrawal is
  bounded only by pool utilization; for a stablecoin market it's effectively
  always fully redeemable at the exact amount.
- **Morpho Vault V2 (RH):** the vault lends USDG into Morpho markets. Only the
  **idle buffer** (~$8M now) + whatever can be pulled from the allocation is
  instantly withdrawable. A redeem larger than available liquidity **reverts**.

This does NOT break 1:1 *value* (share price is ~1.0012, never < 1 unless a market
takes a bad-debt loss), but it can break 1:1 *availability* for a large single
redeem if the vault is highly utilized at that instant.

Mitigations (pick per risk appetite — all preserve "no leaked deposit tokens"):
1. **Accept ERC-4626 semantics as-is.** `withdraw(assets,...)` reverts cleanly if
   liquidity is short; user simply retries or redeems in tranches. No funds lost,
   just a possible "try again / smaller amount." Simplest, honest, matches the
   underlying reality. Recommend for v1.
2. **Optional idle micro-buffer.** Keep a small % of deposits as raw USDG in the
   RH-Money contract (not in Morpho) to service small redeems instantly; only the
   remainder goes to Morpho. Costs a little yield. Nice-to-have, not required.
3. **View helper** `availableToRedeem()` reading the vault's idle USDG so the UI
   can warn before a too-large redeem.

Given ~$8M idle vs. our expected deposit sizes (tens–hundreds of USDG), option 1
is safe in practice today. Note it explicitly for the Ethics Officer review.

## 3.2 ERC-4626 rounding (the 1-wei problem)

Roundtrip loses 1 asset unit (0.000001 USDG) because shares round down on deposit.
If we mint RH-Money 1:1 with USDG-in but shares are worth 1 wei less on the way
out, redeeming the *last* holder could come up 1 wei short. Handle by:
- Using `withdraw(assets,...)` on redeem (rounds shares UP against the vault, in
  our favor — the contract eats the dust from accrued yield), AND
- Requiring a nonzero accrued-yield buffer before the final redeem, OR seeding a
  tiny dust amount at deploy. In practice accrued yield (share price >1) already
  covers the 1-wei rounding many times over. Trivial to handle; note in tests.

---

## 4. What changes vs. the Aave version (exact swap list)

Everything is a 1:1 structural port of `CharityFund.sol`. Replace:

| Aave version | Morpho VaultV2 version |
|---|---|
| `IAaveV3Pool public aavePool` + `IERC20 public aUsdc` | `IERC4626 public vault` (single ref) |
| `usdc` (6-dec) | `usdg` (6-dec) — same decimals, RH-Money stays 6-dec |
| `aavePool.supply(usdc, amount, this, 0)` (deposit) | `vault.deposit(amount, address(this))` |
| `aavePool.withdraw(usdc, amount, to)` (redeem) | `vault.withdraw(amount, to, address(this))` |
| `aavePool.withdraw(usdc, yield, this)` (harvest) | `vault.withdraw(yieldPortion, this, this)` |
| `aUsdc.balanceOf(this)` (backing) | `vault.convertToAssets(vault.balanceOf(this))` |
| `IERC20(usdc).approve(aavePool, max)` in init | `IERC20(usdg).approve(vault, max)` in init |

Untouched: 1:1 `_mint`/`_burn`, `deposit`/`depositFor`, Synthetix reward
accumulator, `harvest` split math, charity wiring, immutability, `ReentrancyGuard`.
The V2/V3 LP-reward registry machinery can be **dropped for v1** (no RH LP venues
yet) to shrink the contract, or kept verbatim.

New interface:
```solidity
interface IMorphoVaultV2 {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function balanceOf(address) external view returns (uint256);
    function asset() external view returns (address);
}
```

---

## 5. Risks / unknowns

1. **Withdrawal liquidity (§3.1)** — biggest one. Not 1:1-availability-guaranteed
   at arbitrary size. Design accepts clean reverts; no fund leakage. FLAG for
   Ethics Officer.
2. **Curator / pause / gate risk** — Steakhouse (curator `0x9023FB…`, owner
   `0x337feF…`) controls the vault. They could set a gate (`receiveSharesGate`
   etc.) later, which would block our deposits, or change allocations. Gates are
   OPEN today; monitor them. This is trust in Steakhouse/Morpho V2, same category
   as trusting Aave governance on Base.
3. **Share-price down-move** — share price is 1.0012 (>1). It only drops below the
   deposited ratio if a Morpho market takes bad debt. Then redeem returns <1:1.
   Same tail risk as Aave insolvency; low but nonzero. RH-Money should be honest
   that backing = "USDG value of Morpho shares," not a hard peg.
4. **USDG acquisition** — USDG is issuer-controlled (Global Dollar / Paxos-style,
   owner `0xcFA038…`). We can't mint it; we must **acquire USDG** (bridge in, or
   buy) to seed the first test. Confirm our RH wallet can obtain a few USDG before
   build. Not permissionlessly mintable — expected for a regulated stablecoin.
5. **`max*` = 0 quirk** — already handled (§2): don't use `max*` in logic.
6. **ERC-4626 1-wei rounding (§3.2)** — trivial, handled by using
   `withdraw(assets)` + accrued-yield buffer.
7. **Orbit/EVM quirks** — none blocking observed; standard eth_call/estimateGas
   behave normally, Solidity 0.8.28 deployed fine (the vault itself is 0.8.28).

---

## 6. Cost + steps to build & deploy (when funded)

**Contracts to write/adapt:**
- `RHMoney.sol` — copy `CharityFund.sol`, apply the §4 swap list, drop or keep the
  LP registry. ~1 solidity file, no new libraries.
- Optional `RHMoneyFactory.sol` (EIP-1167 clone) if we want multiple named
  charity vaults, mirroring `CharityFundFactory.sol`. Skip for a single vault.

**Test path:**
- Fork test against RH mainnet state (fork the 4663 RPC in Hardhat/Foundry),
  simulate deposit → accrue → harvest → redeem with the live vault. Confirms
  adapter wiring and the 1-wei rounding handling.
- Small live test: seed ~$3–5 USDG, deposit, redeem, confirm exact 1:1 out.

**Deploy (per our rules — node script + agent wallet, NOT an HTML page, NOT
Remix):** single constructor with `usdg`, `vault`, `charityWallet`, bps params.
Immutable; no owner. Review by Ethics Officer + committee before the deploy tx.

**Seed capital:** a few USD of USDG on RH for the first deposit/redeem test, plus
a dust amount to pre-cover the 1-wei rounding. Gas is ETH on 4663, negligible.

**Effort:** ~1 day write + ~1 day fork/live test. Low complexity — it is our
existing, battle-tested vault with a 6-line adapter swap.

---

## 7. Hard boundaries honored in this recon
- Read-only: no deploys, no transactions, no funds moved.
- Did not touch the existing RH bridge work (`rh-relayer.cjs`, `rh-deploy.cjs`,
  `recon-robinhood-rpc.cjs` left untouched; my probes are separate `rh-probe*.cjs`).
- No git commit/push. Public RPC used gently (a handful of eth_calls).
- Every address above came from a live on-chain reading, not from docs alone;
  USDG was derived from `vault.asset()`, not typed from a webpage.
