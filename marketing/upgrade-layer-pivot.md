# Unrugable: The Upgrade Layer Pivot

Created: 2026-05-09
Status: DRAFT -- needs Guardian review before any public posting
Trigger: BURGERS token (launched on Flaunch) adopted into reactor network

---

## 1. Positioning Pivot Statement

Unrugable is not a competitor to Flaunch, Clanker, or any launch platform. It is the layer that comes after launch. Any token, from any platform, can be adopted into the reactor network -- gaining permanent locked liquidity, automated buy-back cycles, and carbon credit removal that run every 2 hours without admin keys. The total addressable market is not "people who want to launch tokens." It is every existing token that wants permanence.

---

## 2. Three Tweets

### Tweet 1: BURGERS Announcement

BURGERS was launched on @faboratory's Flaunch platform using V4 hooks.

Now it has its own Unrugable reactor -- permanent locked LP, automated buy-backs every 2 hours, carbon burns on every cycle.

Launched anywhere. Made unrugable here.

Reactor: 0xc858026Ec5D30280137032BC6EA86F46ea23C2CA


### Tweet 2: Educational -- Any Token Can Be Adopted

Unrugable is not just a launch platform.

Any token -- from Flaunch, Clanker, a custom deploy, wherever -- can be adopted into the reactor network.

What that means:
- Permanent locked V3 liquidity (no rug, no drain, no keys)
- Automated buy-back cycle every 2 hours
- Carbon credits removed from markets on every firing
- Deeper liquidity that compounds over time

You do not need to relaunch. You do not need to migrate. Your token stays exactly where it is. We just add permanence underneath it.


### Tweet 3: CTA -- Already Launched? Upgrade.

Already launched your token somewhere else?

For the cost of seeding a small LP position, you can add:
- Permanent locked liquidity (renounced contract, no withdraw function)
- Reactor buy-backs every 2 hours
- CHAR carbon credit removal on each cycle
- Your token feeding into the reactor network

Your token keeps its community. It just becomes unrugable.

Details: tasern.quest/launcher/

---

## 3. Tagline Options

1. "Make any token unrugable."
2. "Launch anywhere. Lock here."
3. "The permanence layer for Base."
4. "Born anywhere. Made unrugable."
5. "Your token's upgrade path."

---

## 4. Strategic Notes

### Why This Matters

Previous positioning: "Launch your token on Unrugable instead of Flaunch/Clanker."
- Problem: We compete on volume (we lose) and awareness (we lose).
- TAM: Only people who have not launched yet.

New positioning: "Already launched? Come to us for permanence."
- We are complementary, not competitive. Flaunch does the birth. We do the armor.
- TAM: Every existing token on Base that wants deeper, permanent liquidity.
- No switching cost. No migration. No relaunch. Just add.

### What We Actually Did With BURGERS

1. Created BURGERS/MfT V3 pool (1% fee tier)
2. Minted LP position, transferred to BURGERS reactor (0xc858)
3. Called addPool() -- LP is now permanently locked
4. Created BURGERS/MfT V2 pool for additional depth
5. Added cbBTC pool to reactor for BTC floor exposure
6. Reactor fires every 2 hours: collects fees, burns BURGERS, deepens LP

Total cost: gas + initial LP seed (small). Ongoing cost: zero (self-sustaining).

### Verifiable Claims Checklist

All claims in the tweets above are on-chain verifiable:
- [x] BURGERS reactor exists: 0xc858026Ec5D30280137032BC6EA86F46ea23C2CA
- [x] Reactor has no withdraw function (code-level fact)
- [x] Admin keys can only addPool (code-level fact)
- [x] Fires every 2 hours (permissionless execute)
- [x] CHAR carbon burns happen each cycle
- [x] Reactor network with hundreds of pools (from CANONICAL-NUMBERS.md, conservative)

### Compliance Notes

- Flaunch mentioned respectfully -- they are named as the origin platform, not criticized
- No price claims, no return promises
- No "pump" language -- used "buy-back cycle" and "automated buy-backs"
- Scope is accurate: "through reactor pools" not "every trade on Base"
- Carbon claim is factual: "removes carbon credits from markets" — no overhead to offset, we create demand for impact because we can

### Next Steps

- [ ] Guardian review of all three tweets
- [ ] Verify BURGERS reactor pool count is current (should be in roll call)
- [ ] Consider a dedicated "Adopt Your Token" page at tasern.quest/launcher/
- [ ] Outreach to Flaunch token creators -- "your token is already live, add permanence"
- [ ] Update press-kit.md with upgrade layer positioning
- [ ] Update competitive-analysis.md -- Flaunch moves from "competitor" to "complementary"
