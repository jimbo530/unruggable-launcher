# Unrugable vs Timelocks — Content Package

Created: 2026-05-09
Status: DRAFT — awaiting team-leader approval before any piece goes live.
Angle: Technical differentiator — no withdraw function in bytecode vs timelock patterns.

All claims are verifiable by reading deployed contract bytecode on Basescan.

---

## 1. Comparison Tweet (X — under 280 chars)

How to evaluate a token launcher's "locked" liquidity:

- Does a withdraw function exist in the bytecode?
- Is it behind a timelock, a multisig, or nothing at all?

If the function exists, it can execute. If it doesn't exist, it can't. Simple as that.

tasern.quest/launcher/

(276 chars)

---

## 2. Educational Farcaster Post (/defi or /base-builders)

### Title: Three kinds of "locked" liquidity — and why the difference matters

When a launcher says liquidity is "locked," there are three different things they might mean. Understanding the difference is the single most important due-diligence step before buying a launched token.

**Level 1: Timelock**

A withdraw function exists in the contract. A timelock delays when it can be called. The function is present in the bytecode — it has a selector, it accepts parameters, and under the right conditions (timestamp reached), it will execute normally.

Example: Clanker locks LP until the year 2100. The withdraw function is in the contract code. You can verify this yourself by decompiling the bytecode. It cannot execute today, but the code path exists. If the timelock logic were ever upgradeable, or if the lock contract were replaceable, execution becomes possible.

Is 2100 far enough away to be "safe"? Probably. But "probably safe because it's far away" and "literally impossible" are two different security properties.

**Level 2: Multisig / Governance Lock**

A withdraw function exists, but requires N-of-M signers or a governance vote to execute. The security assumption is that the signers won't collude. The function is still in the bytecode — it's callable if the social layer fails.

This is the model most DeFi protocols use. It works when the signers are trustworthy. It fails if they aren't, or if keys are compromised.

**Level 3: No Function**

The withdraw function does not exist in the deployed bytecode. There is no selector for it. There are no parameters to call it with. No timelock to expire. No signers to collude. No governance to compromise. The EVM cannot execute code that doesn't exist.

This is how Unrugable's reactor contracts work. The admin key can call exactly one function: addPool(). It cannot withdraw. It cannot modify existing pools. The bytecode literally does not contain a withdrawal code path. Five of these reactors are fully renounced — even addPool is gone.

**How to verify this yourself:**

1. Go to Basescan
2. Find the reactor contract
3. Read the verified source (or decompile the bytecode)
4. Search for any function that moves LP tokens out
5. It's not there

The takeaway isn't "timelocks are bad." It's that there's a spectrum:

- Timelock = "can't today"
- Multisig = "won't unless they agree"
- No function = "can't ever"

Know which one you're trusting.

More on how the Unrugable launcher works: tasern.quest/launcher/

---

## 3. Visual Comparison Table (for tweet image or site section)

```
+--------------------+-------------------+-------------------+--------------------+
|                    | pump.fun          | Largest Base      | Unrugable         |
|                    | (Solana)          | Launcher          |                    |
+--------------------+-------------------+-------------------+--------------------+
| Withdraw function  | Creator holds LP  | EXISTS            | DOES NOT EXIST     |
| in bytecode?       | (no lock)         | (timelocked 2100) | (no code path)     |
+--------------------+-------------------+-------------------+--------------------+
| LP lock method     | None — creator    | Timelock          | No function in     |
|                    | can sell anytime  | (function exists, | bytecode. Cannot   |
|                    |                   | execution delayed)| execute ever.      |
+--------------------+-------------------+-------------------+--------------------+
| Platform fee       | 1% on swaps       | 1% on swaps       | 0% on swaps        |
| on trades          |                   | (60% to platform) |                    |
+--------------------+-------------------+-------------------+--------------------+
| Where do           | Platform treasury | Platform treasury | 100% to reactor    |
| fees go?           |                   | + creator split   | burns (autonomous, |
|                    |                   |                   | immutable)         |
+--------------------+-------------------+-------------------+--------------------+
| Admin capability   | Full control      | Treasury managed  | addPool() only     |
| on LP              |                   | by team           | (5 reactors fully  |
|                    |                   |                   | renounced)         |
+--------------------+-------------------+-------------------+--------------------+
| Tokens per launch  | 1 pool            | 1 pool            | 8 locked pools     |
|                    |                   |                   |                    |
+--------------------+-------------------+-------------------+--------------------+
| Carbon credit      | No                | No                | Yes (CHAR removed  |
| removal            |                   |                   | from markets)      |
+--------------------+-------------------+-------------------+--------------------+

Verify any claim: read the bytecode on Basescan.
Launch: tasern.quest/launcher/
```

---

## 4. Site One-Liner (for comparison section on tasern.quest/launcher/)

"Other launchers timelock their withdraw functions. Ours doesn't have one. You can't call code that doesn't exist."

---

## Compliance Check

- [x] All claims verifiable on-chain (bytecode readable on Basescan)
- [x] No price predictions or return promises
- [x] No "pump" language or FOMO tactics
- [x] No disparaging language — positioned as educational
- [x] Competitor not named in tweet (referred to as "Largest Base Launcher")
- [x] Competitor named in FC educational post (appropriate for technical audience)
- [x] Brand = "Unrugable" (one g) throughout (no MycoPad)
- [x] Link included: tasern.quest/launcher/
- [x] Tone: factual, educational, lets reader draw conclusions
- [x] No urgency language

---

## Notes

- The claim "withdraw function does not exist in bytecode" must be verified against the current deployed reactor contracts before posting. Run a bytecode check to confirm no transfer/withdraw selectors exist.
- Clanker's LP lock to 2100 is verifiable in their locker contract — confirm this is still current before posting.
- The "60% to platform" fee split for Clanker comes from their public documentation. Verify before posting.
- "5 reactors fully renounced" matches the 2026-05-03 renounce queue in project memory.
