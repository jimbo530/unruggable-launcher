# Security Audit — MfT Launch Platform

**Date:** 2026-05-07
**Auditor:** Guardian agent (launch security)
**Scope:** All contracts (2,733 lines Solidity), scripts, API, client-side HTML in MfT-Launch

---

## FIXED IN THIS SESSION

- [x] Agent SDK stale factory address → updated to V5.2
- [x] Agent SDK ABI mismatch → fixed to 7-field `launches()`, `launchToken()` disabled
- [x] SVG serving in metadata API → removed from image extension list
- [x] Error message leakage in API 500 responses → generic "internal error" + server-side logging
- [x] Unescaped error in mycopad.html innerHTML → wrapped with `esc()`
- [x] Share endpoint missing address validation → added regex check

---

## SMART CONTRACT FINDINGS

### HIGH (Contracts — cannot fix, already deployed)

#### C1. SporeReactorV2: Lingering approval after fuel() failure
**File:** `contracts/SporeReactorV2.sol:435-442`
**Issue:** If `reactorPrime.fuel()` reverts, the approval to reactorPrime remains set. On next execute(), this lingering approval persists.
**Note:** SporeReactorV3 fixes this correctly by resetting approval in the catch block.

#### C2. MycoPadV5_2 & V3: Missing safe approve pattern
**Files:** `contracts/MycoPadV5_2.sol:345-372`, `contracts/MycoPadV3.sol:310-368`
**Issue:** USDC approve() calls overwrite previous approvals without resetting to 0 first. Some tokens (USDT-style) revert on non-zero to non-zero approve. USDC on Base doesn't have this issue currently, but it's fragile.

### MEDIUM (Contracts)

#### C3. MycoPadV5_2: rescue() can drain user deposits
**File:** `contracts/MycoPadV5_2.sol:759-763`
**Issue:** Owner can withdraw ANY token including USDC from pending launches. No event logged.
**Mitigant:** Owner is known (memefortrees.base.eth).

#### C4. MycoPadV5_2: Pending launches have no timeout
**File:** `contracts/MycoPadV5_2.sol:250,304-308`
**Issue:** User calls step1, NFT positions transferred to contract. If step2 is never called, positions are locked forever. cancelPending() returns charUsdc but not position NFTs.

#### C5. Spot price oracle for MfT walls
**Files:** `contracts/MycoPadV5_2.sol:604-622`, `contracts/MycoPadV3.sol:465-490`
**Issue:** MfT wall prices derived from spot pool price (slot0). Thin pools or front-running can give unfavorable pricing. 1.1x premium applied but no max-impact check.

#### C6. SporeReactorV3: Pause can deadlock downstream
**File:** `contracts/SporeReactorV3.sol:283-286`
**Issue:** Admin can pause indefinitely with no auto-unpause. If admin key lost, entire downstream chain stalls.

#### C7. No input validation for token name/symbol
**Files:** Both factories
**Issue:** Empty strings accepted for name/symbol. Creates tokens that display poorly on explorers.

#### C8. Single admin with no timelock
**All contracts:** Owner/admin is single EOA. Compromise allows setting minSeed to max, rescuing balances, pausing reactors.

#### C9. Deadline = block.timestamp in all swaps
**Files:** `MycoPadV5_2.sol`, `SporeReactorV4.sol`
**Issue:** Using `block.timestamp` as swap deadline is ineffective — always passes. Transactions stuck in mempool execute at stale prices.

### LOW (Contracts)

- SporeReactorV2: removePool() doesn't clear dangling approvals
- SporeReactorV2: depositLiquidity() allows 0/0 deposits (reverts at PM but wastes gas)
- MycoPadV5_2: No upper bound on minSeed (owner could block all launches)
- MycoPadV5_2: No event on cancelPending()
- MycoPadV5_2: Arithmetic precision loss in seed splits (1-2 wei dust, compensated)
- SporeReactorV3: hasXToken mapping never enforces uniqueness
- MycoPadV3: Reactor admin not renounced after launch

### INFO (Contracts — No Action Required)

- LaunchToken: unchecked block in _transfer() is safe (balance check precedes it)
- SporeReactorV3: Pool unlock check is best-effort TOCTOU — acceptable
- SporeReactorV3: clone initialize() correctly sets _locked = 1
- **No CRITICAL vulnerabilities found in any contract**
- Strong defense-in-depth: reentrancy guards, safe transfers, slippage protection in reactors

---

## SCRIPT & API FINDINGS

### HIGH (Scripts — FIXED)

#### S1. Agent SDK stale factory address — FIXED
Updated `agent-sdk/launch.js` from dead `0x88f6...` to active V5.2 `0xF0c1...`. ABI corrected. `launchToken()` disabled with hard throw until USDC flow rewrite.

### HIGH (Scripts — Still Open)

#### S2. Zero slippage in launch-buyer
**File:** `tools/launch-buyer.js:151`
`amountOutMinimum: 0n` — sandwich-attackable. $5 total per token.

### MEDIUM (Scripts — Some Fixed)

#### S3. SVG serving — FIXED
Removed SVG from metadata API image serve/check lists.

#### S4. Empty catch{} blocks — NOT FIXED
20+ across active scripts. See files: `deploy/server-update.js`, `tools/reactor-roll-call.js`, `tools/burn-leaderboard.js`, `tools/reactor-map-data.js`, `marketing/agent-scout.js` (6), `marketing/chain-data.js` (3), `site/reactor-dashboard.html`.

#### S5. Error message leakage — FIXED
All API 500 responses now return generic "internal error" with server-side logging.

#### S6. Share endpoint missing validation — FIXED
Added `^0x[0-9a-f]{40}$` regex check.

### LOW (Scripts)

- Open CORS (`*`) on all API endpoints including POST
- Single RPC in reactor-roll-call.js (no Alchemy fallback)
- Cross-project .env loading in launch-buyer.js
- Unbounded outreach-log.json growth

---

## CLIENT-SIDE HTML FINDINGS

### MEDIUM

#### H1. ethers.js from CDN without SRI hashes
**Files:** `reactor-dashboard.html`, `reactor-detail.html`, `reactor-map.html`, `leaderboard.html`, `burns.html`
**Issue:** `import { ethers } from "https://cdnjs.cloudflare.com/..."` without Subresource Integrity. CDN compromise would inject malicious code into all reactor pages.
**Fix:** Add SRI hash: `integrity="sha384-..." crossorigin="anonymous"`

#### H2. Empty catch{} in reactor-dashboard.html
**File:** `site/reactor-dashboard.html:212-215`

### LOW

- Missing `maxlength` on token name input in mycopad.html (contract validates, UX issue)
- `out()` function uses innerHTML but only receives hardcoded messages (safe currently)

### SAFE

- **No XSS found:** Token names/symbols properly escaped with `esc()`, URL params validated
- **No private keys** in any HTML file — all wallet ops via window.ethereum
- **Wallet handling correct:** All tx require user signature, addresses from validated config
- **Referral parameter** validated on-chain (factory.isReactor()) before use
- **Supabase anon key** in client JS is intentional (read-only, RLS protected)

---

## SUMMARY

| Severity | Contracts | Scripts | HTML | Status |
|----------|-----------|---------|------|--------|
| CRITICAL | 0 | 0 | 0 | — |
| HIGH | 2 (deployed, unfixable) | 1 open, 1 fixed | 0 | S2 needs fix |
| MEDIUM | 7 (deployed) | 2 open, 3 fixed | 2 | S4, H1, H2 need fix |
| LOW | 7 | 4 | 2 | — |

**Overall:** The platform is well-built with strong fundamentals. No critical vulnerabilities. The deployed contracts have medium-severity issues that cannot be patched but are mitigated by the known-owner trust model. The highest-priority open items are: launch-buyer slippage (S2), empty catch blocks (S4), and CDN SRI hashes (H1).

---

## Recommendations (Priority Order)

1. **Add slippage protection to launch-buyer** (HIGH, open)
2. **Fix all empty catch{} blocks** (MEDIUM, 20+ occurrences)
3. **Add SRI hashes to ethers.js CDN imports** (MEDIUM, 5 pages)
4. **Add RPC fallback to reactor-roll-call** (LOW)
5. **Deploy updated server.js to VPS** (carries all API fixes)
6. **Tighten CORS for POST endpoints** (LOW)
