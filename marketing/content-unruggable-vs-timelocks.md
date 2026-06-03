# Unrugable vs Timelocks — Content Package (V7)

Updated: 2026-06-03
Status: DRAFT — awaiting team-leader approval before any piece goes live.
Angle: Technical differentiator — no withdraw function in bytecode vs timelock patterns.

All claims are verifiable by reading deployed contract bytecode on Basescan.

---

## 1. Comparison Tweet (X — under 280 chars)

How to evaluate a token launcher's "locked" liquidity:

- Does a withdraw function exist in the bytecode?
- Is it behind a timelock, a multisig, or nothing at all?

If the function exists, it can execute. If it doesn't exist, it can't. Simple as that.

tasern.quest/unrugable.html

---

## 2. Educational Farcaster Post (/defi or /base-builders)

### Three kinds of "locked" liquidity — and why the difference matters

When a launcher says liquidity is "locked," there are three different things they might mean. Understanding the difference is the single most important due-diligence step before buying a launched token.

**Level 1: Timelock**

A withdraw function exists in the contract. A timelock delays when it can be called. The function is present in the bytecode — it has a selector, it accepts parameters, and under the right conditions (timestamp reached), it will execute normally.

Example: Clanker locks LP until the year 2100. The withdraw function is in the contract code. It cannot execute today, but the code path exists.

**Level 2: Multisig / Governance Lock**

A withdraw function exists, but requires N-of-M signers or a governance vote. The security assumption is that the signers won't collude. The function is still in the bytecode.

**Level 3: No Function**

The withdraw function does not exist in the deployed bytecode. There is no selector for it. No timelock to expire. No signers to collude. The EVM cannot execute code that doesn't exist.

This is how Unrugable's reactor contracts work. The admin key can call exactly one function: addPool(). It cannot withdraw. It cannot modify existing pools. Five reactors are fully renounced — even addPool is gone.

**The takeaway:**
- Timelock = "can't today"
- Multisig = "won't unless they agree"
- No function = "can't ever"

Know which one you're trusting.

Free to launch on Unrugable. You earn 50% of reactor fees. The other 50% gets burned. No one can touch the liquidity. Ever.

tasern.quest/unrugable.html

---

## 3. Visual Comparison Table

```
+--------------------+-------------------+-------------------+--------------------+
|                    | pump.fun          | Largest Base      | Unrugable V7      |
|                    | (Solana)          | Launcher          |                    |
+--------------------+-------------------+-------------------+--------------------+
| Launch cost        | Bonding curve     | Variable          | FREE (just gas)    |
|                    | buy-in            |                   |                    |
+--------------------+-------------------+-------------------+--------------------+
| Withdraw function  | Creator holds LP  | EXISTS            | DOES NOT EXIST     |
| in bytecode?       | (no lock)         | (timelocked 2100) | (no code path)     |
+--------------------+-------------------+-------------------+--------------------+
| Pools per launch   | 1 pool            | 1 pool            | 2 locked pools     |
|                    |                   |                   | (Money + Meme)     |
+--------------------+-------------------+-------------------+--------------------+
| Launcher earnings  | None              | Creator split     | 50% of token fees  |
|                    |                   | (platform keeps   | every 2 hours      |
|                    |                   | majority)         | (on-chain)         |
+--------------------+-------------------+-------------------+--------------------+
| Where do           | Platform treasury | Platform treasury | 50% burned,        |
| fees go?           |                   | + creator split   | 50% to launcher    |
+--------------------+-------------------+-------------------+--------------------+
| Admin capability   | Full control      | Treasury managed  | addPool() only     |
| on LP              |                   | by team           | (5 fully renounced)|
+--------------------+-------------------+-------------------+--------------------+
| Environmental      | No                | No                | Yes (CHAR + tree   |
| impact             |                   |                   | planting yield)    |
+--------------------+-------------------+-------------------+--------------------+

Verify any claim: read the bytecode on Basescan.
Launch free: tasern.quest/unrugable.html
```

---

## 4. Site One-Liner

"Other launchers timelock their withdraw functions. Ours doesn't have one. You can't call code that doesn't exist."

---

## Compliance Check

- [x] All claims verifiable on-chain (bytecode readable on Basescan)
- [x] No price predictions or return promises
- [x] No "pump" language or FOMO tactics
- [x] No disparaging language — positioned as educational
- [x] Competitor not named in tweet (referred to as "Largest Base Launcher")
- [x] Brand = "Unrugable" (one g) throughout
- [x] Link: tasern.quest/unrugable.html
- [x] Tone: factual, educational, lets reader draw conclusions
