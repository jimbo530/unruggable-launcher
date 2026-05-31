# Reactor Network Adoption Targets

**Date:** 2026-05-09
**Author:** Shark Agent
**Status:** RESEARCH COMPLETE -- Awaiting committee review before execution

---

## Selection Criteria

Tokens were evaluated on:
1. **Daily volume** -- higher volume = more reactor fees
2. **Existing V3/V2 liquidity on Base** -- must be tradeable
3. **Community activity** -- holders, age, social presence
4. **Volume-to-liquidity ratio** -- higher ratio = more fee turnover per dollar of LP
5. **Narrative fit** -- Base-native, community tokens, AI agents preferred

Excluded: MfT, BURGERS, EGP, bAGI, RT, BP, WETH, USDC, cbBTC, AZUSD, CHAR, BB, EB, POOP, TGN, ecowealth, BRUH, ILM, SC, MTEST, and all band tokens (already in network).

---

## TARGET 1: BRETT (Brett)

**Contract:** `0x532f27101965dd16442e59d40670faf5ebb142e4`
**BaseScan:** https://basescan.org/token/0x532f27101965dd16442e59d40670faf5ebb142e4

| Metric | Value |
|--------|-------|
| Daily Volume (24h) | ~$660K - $10M (highly variable) |
| Market Cap | ~$92M |
| Holders | ~895K |
| Primary Pool | BRETT/WETH on Aerodrome SlipStream (1% fee) |
| Pool Liquidity | $1.07M (main), $1.6M (Uni V3 1%), $153K (Uni V3 0.3%) |
| Pool Type | V3 (Aerodrome SlipStream + Uniswap V3) |
| GeckoTerminal Score | 89/100 |
| Launched Via | Custom (original Base meme coin, ~2 years old) |

**Why adopt:**
- Largest Base meme coin by market cap. Massive holder base (895K).
- Consistent daily volume in the hundreds of thousands. Even on quiet days it clears $500K+.
- Deep liquidity means our $0.10 swaps execute cleanly with zero slippage.
- Strong V3 pools on both Aerodrome and Uniswap -- verified tradeable.
- Cultural cornerstone of Base -- any association is brand-positive.

**Setup cost:** ~$5 adoption + gas (~$0.10) + initial buy/sell to seed reactor fees (~$0.20) = ~$5.30 total

**Estimated monthly fee generation:** At $660K/day average volume on V3 pools with 0.3-1% fee tiers, even a small reactor position capturing fee crumbs could generate $2-5/month passively. The real value is trading routes — every BRETT trade that routes through our pools generates arb surfaces across the network.

**Risk:** BRETT is a pure meme coin with no utility beyond community. Volume could dry up in a bear cycle. However, its 2-year survival and 895K holders suggest staying power.

---

## TARGET 2: BNKR (BankrCoin)

**Contract:** `0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b`
**BaseScan:** https://basescan.org/token/0x22af33fe49fd1fa80c7149773dde5890d3c76f3b

| Metric | Value |
|--------|-------|
| Daily Volume (24h) | ~$400K - $4M |
| Market Cap | ~$33.5M |
| Holders | ~229K |
| Primary Pool | BNKR/WETH on Aerodrome SlipStream (0.3% fee) |
| Pool Liquidity | $289K (Aero), $2.16M (Uni V3 1%), $94K (Uni V4 USDC) |
| Pool Type | V3 (Aerodrome SlipStream + Uniswap V3 + V4) |
| Launched Via | Clanker ecosystem (AI agent token) |

**Why adopt:**
- AI agent token with real utility -- Bankr bot lets Farcaster users buy/sell tokens via social posts.
- Volume-to-liquidity ratio is excellent: $400K volume on $289K primary pool = 1.4x daily turnover.
- 90% of platform revenue goes back to BNKR stakers -- aligned community incentives.
- Clanker ecosystem leader by volume ($4M peak days).
- 229K holders = real distribution, not concentrated.

**Setup cost:** ~$5 adoption + gas + seed trades = ~$5.30 total

**Estimated monthly fee generation:** $3-8/month. The high volume-to-liquidity ratio means fees accumulate fast. BNKR pools on 0.3% and 1% tiers generate substantial fee income per dollar of volume.

**Risk:** AI agent narrative could cool. However, Bankr has real revenue and utility, not just hype.

---

## TARGET 3: DRB (DebtReliefBot)

**Contract:** `0x3ec2156D4c0A9CBdAB4a016633b7BcF6a8d68Ea2`
**BaseScan:** https://basescan.org/token/0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2

| Metric | Value |
|--------|-------|
| Daily Volume (24h) | ~$55K - $1M |
| Market Cap | ~$4.9M |
| Holders | Not disclosed (Clanker-launched) |
| Primary Pool | DRB/WETH on Uniswap V3 (1% fee) |
| Pool Liquidity | $741K (main), $53K (Uni V4), $23K (Aero) |
| Pool Type | V3 (Uniswap V3 primary) |
| GeckoTerminal Score | 90/100 |
| Launched Via | Clanker (AI-created -- Grok x Bankr collaboration) |

**Why adopt:**
- Origin story is legendary: first token created by two AI systems talking to each other (Grok suggested it, Bankr deployed it via Clanker).
- GeckoTerminal score of 90/100 -- one of the highest-rated meme tokens on Base.
- $4.9M market cap with $55K+ daily volume = 1.1% daily turnover rate, which is healthy.
- 1% fee tier on primary pool = high fee generation per trade.
- Narrative alignment: AI agents creating tokens = our thesis (AI agents as primary audience).

**Setup cost:** ~$5 adoption + gas + seed trades = ~$5.30 total

**Estimated monthly fee generation:** $1-3/month. Lower absolute volume than BRETT/BNKR but excellent fee-per-trade at 1% tier. Reactor fees compound.

**Risk:** Mid-cap meme with narrative dependency. If AI agent hype fades, volume drops. But the Grok origin story gives it legs beyond typical memes.

---

## TARGET 4: CLAWD (clawd.atg.eth)

**Contract:** `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`
**BaseScan:** https://basescan.org/token/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07

| Metric | Value |
|--------|-------|
| Daily Volume (24h) | ~$155K (across all pools) |
| Market Cap | ~$1.9M |
| Primary Pool | CLAWD/WETH on Uniswap V4 |
| Pool Liquidity | $1.16M (V4 main), $168K (Uni V3 1%), $21K (Aero) |
| Pool Type | V4 (primary) + V3 + Aerodrome |
| Launched Via | Clanker/Bankr (deployed via @bankrbot on X, Jan 2026) |

**Why adopt:**
- AI agent token with active X presence (@clawdbotatg).
- Volume-to-liquidity ratio on V3 pool: $37K on $168K = 22% daily turnover.
- Multiple pool types (V4, V3, Aerodrome) = diversified liquidity.
- Small market cap ($1.9M) means our reactor activity has outsized impact on price.
- 33% rebounds within 24 hours noted in market data -- volatile = more trading = more fees.

**Setup cost:** ~$5 adoption + gas + seed trades = ~$5.30 total

**Estimated monthly fee generation:** $1-2/month. Lower volume than top targets but high volatility means burst fee generation during volume spikes.

**Risk:** Smallest market cap on this list. Could go to zero. But adoption cost is trivial ($5) and any volume at all generates MfT pressure.

---

## TARGET 5: DEGEN

**Contract:** `0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed`
**BaseScan:** https://basescan.org/token/0x4ed4e862860bed51a9570b96d89af5e1b0efefed

| Metric | Value |
|--------|-------|
| Daily Volume (24h) | ~$120K - $1.7M |
| Market Cap | ~$27.5M |
| Holders | ~1.19M |
| Primary Pool | DEGEN/WETH on Uniswap V3 (0.3% fee) |
| Pool Liquidity | $822K (main), $26K (Aero), $7K (V4) |
| Pool Type | V3 (Uniswap V3 primary) |
| Launched Via | Custom (Farcaster tipping token, Jan 2024) |

**Why adopt:**
- 1.19 MILLION holders -- largest holder base of any Base meme coin.
- Farcaster utility token -- real tipping use case beyond speculation.
- Powers Degen Chain (Base L3) -- infrastructure token with staying power.
- 2+ year track record on Base. Survived multiple cycles.
- Deep cultural roots in Farcaster community -- perfect alignment with our Farcaster marketing strategy.

**Setup cost:** ~$5 adoption + gas + seed trades = ~$5.30 total

**Estimated monthly fee generation:** $1-4/month. Volume is variable but the 1.19M holder base ensures a baseline of activity even in quiet markets.

**Risk:** Volume has declined from peak ($5M/day in Jan 2026 to ~$120K now). But the token is embedded in Farcaster infrastructure, making it unlikely to die completely.

---

## Summary Table

| Rank | Token | Contract | Daily Volume | MCap | Holders | Vol/Liq Ratio | Setup Cost |
|------|-------|----------|-------------|------|---------|---------------|------------|
| 1 | BRETT | 0x532f...42e4 | $660K+ | $92M | 895K | 0.6x | $5.30 |
| 2 | BNKR | 0x22aF...6F3b | $400K+ | $33.5M | 229K | 1.4x | $5.30 |
| 3 | DRB | 0x3ec2...8Ea2 | $55K+ | $4.9M | -- | 0.07x | $5.30 |
| 4 | CLAWD | 0x9f86...6b07 | $155K | $1.9M | -- | 0.22x | $5.30 |
| 5 | DEGEN | 0x4ed4...efed | $120K+ | $27.5M | 1.19M | 0.15x | $5.30 |

**Total setup cost for all 5:** ~$26.50

**Estimated combined monthly fee generation:** $8-22/month

---

## Adoption Priority Order

1. **BNKR** -- Best vol/liq ratio, AI narrative, Clanker ecosystem leader. Adopt first.
2. **BRETT** -- Highest absolute volume, largest community. Safe bet.
3. **DEGEN** -- Farcaster utility, massive holder base. Strategic alignment.
4. **DRB** -- AI origin story, high GT score, 1% fee pools. Good fee generation.
5. **CLAWD** -- Smallest but cheapest to influence. Volatile = fees.

---

## Honorable Mentions (Did Not Make Top 5)

- **TOSHI** (0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4) -- $27K daily volume on primary pool. 1.09M holders. Strong brand but volume was lower than expected at time of research. Revisit if volume recovers above $100K/day.
- **RUSSELL** (0x0c5142bc58f9a61ab8c3d2085dd2f4e550c5ce0b) -- Brian Armstrong's dog meme. $426K daily volume, 139K holders. Good candidate for round 2.
- **KEYCAT** (0x9a26f5433671751c3276a065f57e5a02d2817973) -- Keyboard Cat meme. $116K volume. Nostalgic brand appeal. V2 primary pool.
- **CLANKER** (0x1bc0c42215582d5a085795f4badbac3ff36d1bcb) -- The platform token itself. $314K volume, $2.66M liquidity. Listed on HTX. Strong but $26 per token means our $0.10 swaps buy dust.
- **VIRTUAL** (0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b) -- Virtuals Protocol. Massive but likely too large-cap for meaningful reactor impact.

---

## Implementation Notes

- All addresses verified from BaseScan search results on 2026-05-09
- UnrugableAdoption contract: `0x013a1091108D50eF5F9cC3FDa38f9b2BA4D3F81d`
- Each adoption creates reactor pools that connect tokens to MfT trading routes
- Our $0.10 swap limit works fine on all these tokens (deep enough liquidity)
- BEFORE adopting: verify each address one more time by running agent-wallet.js or checking BaseScan directly. NEVER type addresses from memory.
- After adoption: seed each reactor with small buy/sell pairs to generate initial fees, then let organic volume take over

---

## Revenue Model

Every adopted token gets paired with MfT in a reactor pool. When anyone trades the adopted token on any DEX:
1. Reactor collects fees from LP positions
2. Fees get cycled through the network (MfT burns, charity funded)
3. MfT gets redistributed through the reactor network
4. 10% flows upstream to Prime reactor

At $8-22/month combined from 5 adoptions costing $26.50 total, breakeven is 1-3 months. After that, it is pure profit compounding into the MfT flywheel.

---

*Research sources: CoinGecko, GeckoTerminal, BaseScan, CoinMarketCap, web search data as of 2026-05-09. Volume figures are point-in-time snapshots and will fluctuate.*
