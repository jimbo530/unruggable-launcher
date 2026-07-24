# Burn Address — Third-Party Declaration Submissions

Ready-to-paste text for declaring the MfT network burn address with explorers and
aggregators. The canonical reference these all point to:
https://tasern.quest/launcher/verify-burn.html

Burn address: `0xfd780B0aE569e15e514B819ecFDF46f804953a4B` (Base, chain 8453)

---

## 1. BaseScan public name tag

Form: https://basescan.org/contactus (select "Name Tagging / Label Address")
Requires a free BaseScan account.

**Suggested tag:** `MfT Network: Burn Address`

**Description to paste:**

> This address is the dedicated burn destination for the Meme for Trees (MfT)
> reactor network on Base. It is hardcoded as a constant in the Unrugable token
> factory (0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2) and all network reactors.
> It is an immutable EIP-1167 minimal proxy with no ERC-20 withdrawal functions —
> tokens transferred here are permanently removed from circulation. The address
> has only inbound token transfers in its entire history.
> Technical verification guide: https://tasern.quest/launcher/verify-burn.html
> Live burn dashboard: https://tasern.quest/launcher/burns.html

---

## 2. CoinGecko

MfT is NOT yet listed on CoinGecko (checked 2026-06-10; GeckoTerminal auto-indexes
the pools but does not adjust supply). Declaring the burn address happens INSIDE
the listing application — there is no standalone burn-address form.

Application: https://www.coingecko.com/en/coins/new (Google account required)

Key fields ready:
- Token: MemeForTrees (MfT), Base, `0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3`
- Total supply: 100,000,000,000 (100B)
- **Burn/locked wallets to exclude from circulating supply:**
  `0xfd780B0aE569e15e514B819ecFDF46f804953a4B` — network burn address, see
  https://tasern.quest/launcher/verify-burn.html
- Website: https://tasern.quest
- Explorer: https://basescan.org/token/0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3

Note: CoinGecko listing also wants social links, launch date, and proof of team
association (post from official X account referencing the application).

---

## 3. CoinMarketCap

Same situation — declaration is part of the listing request:
https://support.coinmarketcap.com/hc/en-us/requests/new (select "Add cryptoasset")

Use the same burn-wallet declaration text as CoinGecko above. CMC explicitly asks
for "addresses excluded from circulating supply" with an explanation URL — use the
verify-burn page.

---

## Compliance notes (per marketing rules)

- Every claim above is verifiable on-chain; the verify-burn page documents the method.
- Do NOT describe the burn address as "no private key" — it is an immutable proxy
  contract, not a keyless EOA. The correct phrasing: "immutable contract with no
  ERC-20 withdrawal functions." (Old copy in llms.txt said "no private key";
  corrected 2026-06-10.)
- No price language anywhere in these submissions.
