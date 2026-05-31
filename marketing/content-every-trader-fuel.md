# Content Series: "Every Trader is Fuel"

Target: active traders, degens, arb bots. The message: direction doesn't matter, only volume.

---

## X Posts (under 280 chars each)

### Post 1 — The Core Mechanic
You sold $MfT. The reactor collected the fee. Two hours later it used those fees to buy back.

Sells generate reactor fuel. That's how the mechanism works.

tasern.quest/mft/

### Post 2 — Arb Bots Welcome
The reactor network fires every 2 hours across hundreds of pools. Each firing creates price dislocations between pools.

That's a 2-hour arb window, every cycle, on a clock.

Your bot is welcome. Your fees are fuel.

### Post 3 — The Math
One $10 trade on a reactor pool generates ~$0.01 in fees.
Those fees compound every cycle — collected and re-deployed every 2 hours.
Supply decreases with every burn cycle.

The mechanism runs on volume, not sentiment.

### Post 4 — MEV is Part of the Ecosystem
MEV bots generate pool fees. Those fees get collected by the reactor. The reactor buys and burns MfT.

Frontrunners, backrunners, sandwich bots — all generate fees that feed the reactor. The mechanism doesn't distinguish intent, only volume.

### Post 5 — Panic Sells
Someone panic sold. Okay.

1. Their sell generated fees in the V3 pool
2. Reactor collected those fees 2 hours later
3. Reactor bought MfT with the fees
4. Bought MfT got burned permanently
5. Net: supply decreased

Every trade generates reactor fuel. Token values can still go to zero — but every sell feeds the burn engine.

### Post 6 — Both Sides Generate Fuel
Buy MfT — price moves, fees generated, reactor collects.

Sell MfT — price moves, fees generated, reactor collects.

Both directions generate reactor fuel. Every trade feeds the burn engine regardless of direction.

---

## Farcaster Long Post — /defi

Most DeFi protocols have a linear relationship between user and protocol: user trades, protocol earns fees, protocol distributes rewards, cycle repeats.

The MfT reactor network works differently. Every trade — in any direction, any size, on any reactor pool — generates fees that compound permanently.

Here's the flow:
1. You trade on a reactor-connected V3 pool (any token in the network)
2. Fees accrue in the V3 position held by the reactor
3. Every 2 hours, the reactor fires: collects all fees, burns native tokens, cycles cross-tokens through the network
4. 10% of cross-token fees flow upstream to the next reactor
5. Fees cascade bottom-up to V1 Prime, which buys and burns MfT across 12 pools simultaneously

What this means: buys, sells, arbs, MEV, panic dumps, accumulation — all of it generates reactor fuel. The reactor doesn't distinguish between a whale accumulating and a bot arbitraging. It collects fees from both.

Direction doesn't matter. Only volume.

A network of reactors. Hundreds of pools. Every 2 hours. The mechanism runs on volume, not sentiment.

The only state where no burns happen is zero volume. Everything else is fuel.

tasern.quest/api/unrugable/tokenomics

---

## Social Bot Additions (for social-bot.js)

```javascript
// Every trader is fuel — series
`You sold. The reactor collected the fee. Two hours later it used those fees to buy back.\n\nSells generate reactor fuel.\n\nhttps://tasern.quest/mft/`,

`MEV bots, arb bots, sandwich bots — all generate pool fees. All fees get collected by reactors. All reactors buy and burn MfT.\n\nEvery trade feeds the burn engine.\n\nhttps://tasern.quest/mft/`,

`A network of reactors. Hundreds of pools. Price dislocations every 2 hours.\n\nThat's a predictable arb window on a clock. Your bot is welcome. Your fees are fuel.\n\nhttps://tasern.quest/api/unrugable/tokenomics`,
```

---

## Thread Version (3 tweets)

**1/3**
"Every trader is fuel" — a thread on why the MfT reactor network runs on volume, not direction.

Buys, sells, arbs, dumps. All generate V3 pool fees. All fees feed the reactor mechanism.

**2/3**
Every 2 hours, the reactor network fires bottom-up:
- Collect all uncollected V3 fees
- Burn native tokens
- Cycle cross-tokens through connected pools
- Cascade 10% of fees upstream

One organic trade ripples into corrective volume across connected pools.

**3/3**
The only state where no burns happen is zero volume. Everything else generates fuel.

Buy traders: fees compound into reactor burns.
Sellers: your fees feed the same engine.
Arb bots: predictable 2hr windows, welcome aboard.

Token values can go to zero. But every trade feeds the burn mechanism.

tasern.quest/mft/
