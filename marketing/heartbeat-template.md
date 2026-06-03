# Heartbeat Report Template — V7

Weekly stats report. Cross-platform: Farcaster (long), X (thread).

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
- Total value destroyed: $[TOTAL_USD]

Launches:
- V7 launches: [V7_COUNT] (free, 2 pools each)
- Launcher earnings paid: [EARNINGS_TOTAL] tokens
- New reactors: [NEW_REACTORS]

Trend: [ONE_LINE_INSIGHT]

tasern.quest/unrugable.html
```

---

## X Thread Version (3 tweets)

**1/3**
```
Heartbeat Report — [DATE]

[ACTIVE_COUNT] reactors. [POOL_COUNT]+ pools. Every 2 hours.

$[TOTAL_USD] permanently burned this week.
[MFT_BURNED] MfT destroyed.
[LAUNCH_COUNT] free launches on V7.

The heartbeat doesn't stop.
```

**2/3**
```
This week:
- [NEW_REACTORS] new reactors added
- [LAUNCH_COUNT] tokens launched (free)
- [EARNINGS_TOTAL] tokens paid to launchers
- [INSIGHT_STAT] [describe growth or milestone]

Every launch adds fuel. Every trade generates fees. Every cycle burns supply and pays launchers.
```

**3/3**
```
Verify everything on-chain:
- Launcher: tasern.quest/unrugable.html
- Burns: tasern.quest/burns.html
- API: tasern.quest/api/unrugable/tokenomics
- Agent tools: tasern.quest/llms.txt

Free to launch. You earn when they trade. Reactor network on Base.
```

---

## Data Sources

```javascript
// Pull from chain-data.js or API
const report = {
  activeReactors: data.totalReactors,
  readyReactors: data.readyReactors,
  totalPools: data.totalPools,
  burns: data.burns,
  totalBurnedUSD: data.totalBurnedUSD,
  v7LaunchCount: data.v7Launches,
  launcherEarnings: data.launcherEarnings,
  mftPrice: data.mftPriceUsd,
};
```

---

## Guidelines

- Only use real numbers from chain data. Never estimate or round up.
- If a number is zero, skip that line.
- Tone: matter-of-fact, like a protocol status dashboard. Not hype.
- Include one human-readable insight line
- Post every Monday 15:00 UTC (or closest day with notable data)
- Cross-post best version to both platforms
