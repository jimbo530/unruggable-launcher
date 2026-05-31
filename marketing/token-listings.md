# Token Listing Submissions — Free Platforms

All listings are free. Increases discoverability for both agents and humans.

---

## 1. CoinGecko (FREE)

URL: https://www.coingecko.com/en/coins/new
Apply: https://www.coingecko.com/en/coins/new

**Requirements:**
- Working website
- Active social media
- Token contract verified on block explorer
- Liquidity on a tracked DEX
- Logo (200x200 minimum, square PNG)

**Tokens to list (priority order):**

| Token | Symbol | Contract | Why |
|-------|--------|----------|-----|
| MfT | MfT | 0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3 | Core infrastructure token |
| EARTH | EARTH | 0x5CfBecf0209F7ada1EdF1fC0D2Fce3a809C0aE08 | Environmental impact story |
| CHAR | CHAR | 0x20b048fA035D5763685D695e66aDF62c5D9F5055 | Carbon credit removal from markets |
| POOP | POOP | 0x126555aecBAC290b25644e4b7f29c016aE95f4dc | Game economy token, meme appeal |

**Description for MfT:**
> MfT is the infrastructure token of the Unrugable reactor network on Base. Autonomous reactors fire every 2 hours across hundreds of pools, collecting trading fees, buying MfT, and burning supply permanently. Five reactors are fully renounced and immutable. Every token launched on Unrugable creates floor pools paired against MfT. Built toward registered charity status with automated carbon credit removal from markets via CHAR.

**Status:** READY — needs human to fill application form with logo + description.

---

## 2. CoinMarketCap (FREE)

URL: https://support.coinmarketcap.com/hc/en-us/articles/360043659351
Apply: https://coinmarketcap.com/listing/

**Requirements (similar to CoinGecko):**
- Verified contract on Basescan
- Working website (tasern.quest)
- Active community/social presence
- Listed on at least 1 tracked exchange or DEX with sufficient liquidity
- Logo, description, supply data

**Status:** READY — same tokens as CoinGecko. Submit after CoinGecko (they often cross-reference).

---

## 3. Defined.fi / Codex (FREE — data aggregator)

URL: https://www.defined.fi
Docs: https://docs.defined.fi

**How it works:** Defined auto-indexes tokens from DEX pools. MfT should already be indexed if it has Uniswap V3 pools on Base.

**Action:** Search for MfT on defined.fi. If listed:
- Verify logo and metadata are correct
- Check if we can claim/update the listing
If not listed:
- Check their submission process

**Why this matters:** Defined feeds data to many portfolio trackers and agent tools. Correct metadata here propagates widely.

**Status:** CHECK first — may already be indexed.

---

## 4. DexTools (FREE listing)

URL: https://www.dextools.io
Base tokens: https://www.dextools.io/app/en/base

**How it works:** Auto-indexes from DEX pools. Can update logo and info by verifying ownership.

**Action:** Search for MfT, verify listing, update logo if needed.

**Status:** CHECK — likely auto-indexed from Uniswap V3 pools.

---

## 5. GoPlus / TokenSniffer (FREE — security score)

**GoPlus:** https://gopluslabs.io
**TokenSniffer:** https://tokensniffer.com

Both provide automated security scoring. High scores = trust signal for traders and agents.

**Action:**
- Check MfT score on both platforms
- If low, investigate what's flagged (could be: no verified source, unusual supply patterns, etc.)
- Fix whatever is fixable (verify source on Basescan, add metadata)

**Why:** Referenced in GROWTH-STRATEGY.md as a legitimacy KPI. Agents and traders check these before interacting.

**Status:** CHECK scores, address any issues.

---

## 6. DeFiLlama (FREE — TVL tracking, high credibility)

URL: https://defillama.com/chain/Base
Docs: https://docs.llama.fi/list-your-project/submit-a-project

**How to list:**
1. Fork https://github.com/DefiLlama/DefiLlama-Adapters
2. Create `projects/unrugable/` folder with TVL adapter
3. Adapter should track: locked LP value across all reactors + gardens
4. Submit PR with brief explanation
5. Merged within ~24hrs, appears on DeFiLlama dashboard

**Why this matters:** DeFiLlama is THE credibility signal in DeFi. Being listed means: portfolio trackers show our TVL, researchers find us, and agents that use DeFiLlama's API (many do) discover our protocol automatically.

**Status:** NEEDS TVL ADAPTER — requires code (JavaScript). Keeper agent may need to help with contract read logic. Post to bus for collaboration.

---

## 7. llms.txt Directory (FREE — AI discovery)

URL: https://directory.llmstxt.cloud/

**How to list:** Submit tasern.quest since we already have llms.txt at the root. The directory aggregates sites with llms.txt for AI agent discovery.

**Why:** Direct pipeline to agents scanning for new protocols. We already have the file — just need to register.

**Status:** READY — needs human to submit URL.

---

## Human Action Checklist

```
[ ] 1. Search MfT on defined.fi — verify listing or submit
[ ] 2. Search MfT on dextools.io — verify listing, update logo
[ ] 3. Check MfT on GoPlus + TokenSniffer — note scores
[ ] 4. Submit MfT to CoinGecko (logo + description ready above)
[ ] 5. Submit MfT to CoinMarketCap (after CoinGecko)
[ ] 6. Repeat steps 4-5 for EARTH, CHAR, POOP
```

[ ] 7. Submit tasern.quest to https://directory.llmstxt.cloud/ (llms.txt directory)
[ ] 8. DeFiLlama: needs TVL adapter code first (coordinate with Keeper on bus)
```

All free. All increase discoverability. Priority: MfT first, then EARTH (best impact story), then CHAR, then POOP.
