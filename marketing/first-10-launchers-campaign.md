# First 10 External Launchers Campaign

Deploy instructions: Copy-paste ready. Fill placeholders in [BRACKETS]. Post within 2 minutes of detection.

---

## 1. Pinned Tweet Template (First External Launch)

Post immediately when first external launcher detected. Pin to profile.

```
The first external project just launched on Unrugable.

[TOKEN_NAME] ($[TOKEN_SYMBOL]) by [LAUNCHER_HANDLE_OR_"an independent team"]

- [NUM_POOLS] reactor pools locked
- Burn-vesting active
- Liquidity immutable from block one

Reactor: [REACTOR_ADDRESS]
Verify yourself on-chain. That's the point.

Welcome to the network.

tasern.quest/launcher/
```

If launcher wants to remain anonymous, use: "an independent builder" instead of handle.

---

## 2. Subsequent Launcher Tweets (Launchers 2-10)

Each should feel like momentum building, not a repeated format. Rotate between these structures:

**Launcher 2:**
```
Second project live on Unrugable.

$[TOKEN_SYMBOL] just locked [NUM_POOLS] pools into the reactor network. No admin keys. No rug path.

That's two teams who chose immutable over "trust me."

tasern.quest/launcher/
```

**Launcher 3:**
```
Three projects. Three sets of locked liquidity. Zero admin withdraw functions.

$[TOKEN_SYMBOL] is live on Unrugable. The reactor network grows.

tasern.quest/launcher/
```

**Launcher 4:**
```
$[TOKEN_SYMBOL] launched today on Unrugable.

Every launch fuels the reactor. Every reactor removes carbon credits from markets. Every pool is permanent.

Four teams building on infrastructure they can't rug. Even if they wanted to.

tasern.quest/launcher/
```

**Launcher 5:**
(Use milestone post from Section 5)

**Launcher 6:**
```
Six projects on the network now. Each one chose:
- Renounced contracts
- Locked liquidity
- Reactor-backed volume

$[TOKEN_SYMBOL] is the latest. Won't be the last.

tasern.quest/launcher/
```

**Launcher 7:**
```
$[TOKEN_SYMBOL] just went live.

Seven teams. Zero rug pulls possible. Not because they promised -- because the contracts won't allow it.

tasern.quest/launcher/
```

**Launcher 8:**
```
The reactor network now has eight projects fueling it.

$[TOKEN_SYMBOL] locked [NUM_POOLS] pools today. Immutable. Verifiable. Permanent.

tasern.quest/launcher/
```

**Launcher 9:**
```
Nine.

Nine teams chose to build where rugging isn't a feature.

$[TOKEN_SYMBOL] is live. One more and the first ten are complete.

tasern.quest/launcher/
```

**Launcher 10:**
(Use milestone post from Section 5)

---

## 3. DM Template (Post-Launch Outreach)

Send within 1 hour of launch detection. Adjust tone based on whether they used an invite link or found it organically.

**Standard DM:**
```
Hey [NAME] -- saw your launch on Unrugable just went live. Congrats on getting $[TOKEN_SYMBOL] out there.

We're highlighting the first 10 external projects that launch through the platform. Would you be open to us featuring your project in a post? We'd tag your account and link to the reactor address for verification.

No pressure either way. Just want to make sure builders get visibility if they want it.

Let me know.
```

**If they came through an invite link:**
```
Hey [NAME] -- congrats on the $[TOKEN_SYMBOL] launch. Saw you came through [INVITER_HANDLE]'s invite link.

We're documenting the first invite chains on Unrugable and would love to feature your project if you're comfortable with that. We'd tag you and show the reactor address so people can verify on-chain.

Let me know if you'd like to be included or prefer to stay under the radar. Either works.
```

**If they decline:**
Respect it. No follow-up. Do not post their handle or token name without consent.

---

## 4. Leaderboard Concept ("First 10" Section)

**Location:** tasern.quest/launcher/first-10 (or dedicated section on launcher page)

**Display per entry:**

| Field | Source | Notes |
|-------|--------|-------|
| Token Name / $SYMBOL | Launch event | Link to Defined.fi pool page |
| Launch Date | Block timestamp | Format: "May 12, 2026" |
| Downstream Invites | Invite system DB | Count of launchers who used their invite link |
| Reactor Fire Count | On-chain processAll calls | Total times their reactor has processed |
| CHAR Burned | CHAR collection contract | Amount of CHAR sent to collection address from their reactor activity |

**Design notes:**
- Each entry is a card, not a table row
- Show reactor address (truncated, click to expand) with block explorer link
- Green indicator if reactor has fired in last 24h
- Badge system: "Pioneer" for first 10, "Chain Starter" if they generated 1+ downstream invite
- No price data displayed. No TVL. No market cap. This is about network participation, not speculation.
- Carbon burned should show cumulative CHAR with equivalent "X lbs CO2e" via CCC conversion

**Data refresh:** Every 15 minutes from on-chain reads. No Supabase caching needed for 10 entries.

---

## 5. Milestone Posts

**5th Launcher:**
```
Five projects now live on Unrugable.

Five sets of locked liquidity. Five reactors removing carbon credits from markets. Five teams that chose infrastructure over promises.

The first ten slots are half full. Every one of them verifiable on-chain.

tasern.quest/launcher/
```

**10th Launcher:**
```
Ten.

Ten independent projects launched on Unrugable. Ten reactors locked and firing. Ten teams that chose contracts over trust.

The "First 10" are now complete. This page is permanent:
tasern.quest/launcher/first-10

Every pool address. Every reactor. Every CHAR burn. Verify it all yourself.

What comes next is bigger. But these ten came first.
```

**First Invite Chain (someone launched via another launcher's invite link):**
```
It just happened.

[LAUNCHER_B] launched $[TOKEN_B] through [LAUNCHER_A]'s invite link.

That's not us marketing. That's one builder telling another: "this infrastructure is real."

The reactor network is now growing peer-to-peer.

tasern.quest/launcher/
```

**First 3-Deep Chain (A invited B, B invited C, C launched):**
```
Three degrees of separation from us.

[A] launched on Unrugable.
[A] invited [B]. [B] launched.
[B] invited [C]. [C] launched today.

We didn't talk to [C]. We didn't pitch them. Someone who trusted someone who trusted the infrastructure -- that was enough.

This is how networks grow. Not ads. Not hype. Builders telling builders.

tasern.quest/launcher/
```

---

## Deployment Checklist

When first external launch is detected:

1. [ ] Verify launch is genuinely external (not a test, not our team)
2. [ ] Check if launcher has public social handle
3. [ ] Send DM template (Section 3) -- wait for response before tagging
4. [ ] If approved: post Pinned Tweet (Section 1) within 2 minutes
5. [ ] Pin the post
6. [ ] Log in campaign tracker: token, symbol, handle, date, invite source
7. [ ] Update leaderboard page if live
8. [ ] Notify team via agent bus

**Do NOT post if:**
- Launcher asks to remain anonymous
- Launch appears to be a test/spam token
- Token name/content violates platform standards

---

## Compliance Notes

- All claims in these posts are verifiable on-chain (locked pools, renounced contracts, reactor fire counts)
- No price language, no "moon", no financial predictions
- "Unrugable" refers to the platform mechanism (immutable contracts), not a guarantee of token value
- Carbon claims reference actual CHAR burns traceable to collection address
- If anyone asks "is this financial advice" -- it is not, and we never frame it as such
