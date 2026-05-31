# Heartbeat Report Template

Weekly stats report. Cross-platform: Farcaster (long), X (thread), potential newsletter.

Pull all data from chain-data.js or tasern.quest/api/unrugable/tokenomics.

---

## Farcaster Version (up to 1024 chars)

```
Heartbeat Report — Week of [DATE]

Network:
- Reactors: [ACTIVE_COUNT] active ([READY_COUNT] ready to fire)
- Pools: [POOL_COUNT]+ across all reactors
- Immutable: [RENOUNCED_COUNT] reactors (renounced, no admin)

Burns (permanent):
- MfT: [MFT_BURNED] tokens ($[MFT_USD])
- CHAR: [CHAR_BURNED] tokens
- [OTHER_TOKEN]: [AMOUNT]
- Total value destroyed: $[TOTAL_USD]

Activity:
- New launches: [LAUNCH_COUNT] via Unrugable
- New reactors: [NEW_REACTORS] (adopted/launched)
- Agent SDK: [MCP_INSTALLS] npm installs

Trend: [ONE_LINE_INSIGHT]

tasern.quest/mft/
```

---

## X Thread Version (3 tweets)

**1/3**
```
Heartbeat Report — [DATE]

[ACTIVE_COUNT] reactors. [POOL_COUNT]+ pools. Every 2 hours.

$[TOTAL_USD] permanently burned this week.
[MFT_BURNED] $MfT destroyed.
[CHAR_BURNED] CHAR retired.

The heartbeat doesn't stop.
```

**2/3**
```
This week:
- [NEW_REACTORS] new reactors added
- [LAUNCH_COUNT] tokens launched on Unrugable
- [INSIGHT_STAT] [describe growth or milestone]

Every launch adds fuel. Every trade generates fees. Every cycle burns supply.
```

**3/3**
```
Verify everything on-chain:
- Burns: tasern.quest/mft/
- API: tasern.quest/api/unrugable/tokenomics
- Agent tools: tasern.quest/llms.txt

Reactor network. Hundreds of pools. $0 marketing budget.

Unrugable by code, not by promise.
```

---

## Data Sources

```javascript
// Pull from chain-data.js
const data = await fetchChainData();

const report = {
  activeReactors: data.totalReactors,
  readyReactors: data.readyReactors,
  totalPools: data.totalPools,
  burns: data.burns,           // { MfT: N, CHAR: N, ... }
  totalBurnedUSD: data.totalBurnedUSD,
  launchCount: data.launchCount,
  mftPrice: data.mftPriceUsd,
  launches: data.launches,     // recent launches array
};
```

---

## Guidelines

- Only use real numbers from chain data. Never estimate or round up.
- If a number is zero, skip that line (don't show "0 launches" — just omit).
- Tone: matter-of-fact, like a protocol status dashboard. Not hype.
- Include one human-readable insight line: "Network grew 30% via token adoption" or "CHAR burns doubled since last week"
- Post every Monday 15:00 UTC (or closest day with notable data)
- Cross-post best version to both platforms
