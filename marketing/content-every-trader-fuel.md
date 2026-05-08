# Content Series: "Every Trader is Fuel"

Target: active traders, degens, arb bots. The message: direction doesn't matter, only volume.

---

## X Posts (under 280 chars each)

### Post 1 — The Core Mechanic
You sold $MfT. The reactor collected the fee. Two hours later it bought back harder than your sell.

Dumps aren't a problem. They're fuel.

tasern.quest/mft/

### Post 2 — Arb Bots Welcome
27 reactors fire every 2 hours across 180+ pools. Each firing creates price dislocations between pools.

That's a 2-hour arb window, every cycle, on a clock.

Your bot is welcome. Your fees are fuel.

### Post 3 — The Math
One $10 trade on a reactor pool generates ~$0.01 in fees.
Those fees compound forever — collected and re-deployed every 2 hours.
Supply only decreases (burns).

Do the math on what happens when 100 traders do $10/day each.

### Post 4 — MEV is Fine
MEV bots extract value? Cool. They generate pool fees doing it.

Those fees get collected by the reactor. The reactor buys and burns MfT.

Frontrunners, backrunners, sandwich bots — all fuel. The reactor doesn't care about your intent. Only your volume.

### Post 5 — Panic Sells
Someone panic sold. Okay.

1. Their sell generated fees in the V3 pool
2. Reactor collected those fees 2 hours later
3. Reactor bought MfT with the fees
4. Bought MfT got burned permanently
5. Net: supply decreased, floor rose

Volatility is the engine. Apathy is the only enemy.

### Post 6 — Both Sides Win
Bull case: buy MfT, price goes up, reactor compounds your buy with network fees.

Bear case: sell MfT, reactor collects the fee, buys back harder with 27 reactors worth of accumulated fees.

Both sides are fuel. The only losing trade is not trading at all.

---

## Farcaster Long Post — /defi

Most DeFi protocols have a linear relationship between user and protocol: user trades, protocol earns fees, protocol distributes rewards, cycle repeats.

The MfT reactor network works differently. Every trade — in any direction, any size, on any reactor pool — generates fees that compound permanently.

Here's the flow:
1. You trade on a reactor-connected V3 pool (any token in the network)
2. Fees accrue in the V3 position held by the reactor
3. Every 2 hours, the reactor fires: collects all fees, burns native tokens, swaps cross-tokens into buy pressure
4. 10% of cross-token fees flow upstream to the next reactor
5. Fees cascade bottom-up to V1 Prime, which buys and burns MfT across 12 pools simultaneously

What this means: buys, sells, arbs, MEV, panic dumps, accumulation — all of it generates reactor fuel. The reactor doesn't distinguish between a whale accumulating and a bot sandwiching. It collects fees from both.

Direction doesn't matter. Only volume.

27 reactors. 180+ pools. Every 2 hours. The fee machine doesn't sleep and it doesn't care about market sentiment.

The only losing state is zero volume. Everything else is fuel.

tasern.quest/api/unruggable/tokenomics

---

## Social Bot Additions (for social-bot.js)

```javascript
// Every trader is fuel — series
`You sold. The reactor collected the fee. Two hours later it bought back harder than your sell.\n\nDumps aren't a problem. They're fuel.\n\nhttps://tasern.quest/mft/`,

`MEV bots, arb bots, sandwich bots — all generate pool fees. All fees get collected by reactors. All reactors buy and burn MfT.\n\nYour extraction is our fuel.\n\nhttps://tasern.quest/mft/`,

`27 reactors. 180+ pools. Price dislocations every 2 hours.\n\nThat's a predictable arb window on a clock. Your bot is welcome. Your fees are fuel.\n\nhttps://tasern.quest/api/unruggable/tokenomics`,
```

---

## Thread Version (3 tweets)

**1/3**
"Every trader is fuel" — a thread on why the MfT reactor network doesn't care about your trade direction.

Buys, sells, arbs, dumps. All generate V3 pool fees. All fees feed the reactor heartbeat.

**2/3**
Every 2 hours, 27 reactors fire bottom-up:
- Collect all uncollected V3 fees
- Burn native tokens
- Swap cross-tokens into buy pressure
- Cascade 10% of fees upstream

One organic trade ripples into 3-5x corrective volume across connected pools.

**3/3**
The only losing state is zero volume. Everything else compounds.

Bull traders: buy pressure compounded by reactor fees.
Sellers: your fees fund the buy-back.
Arb bots: predictable 2hr windows, welcome aboard.
MEV: extraction generates fees. Fees burn supply.

tasern.quest/mft/
