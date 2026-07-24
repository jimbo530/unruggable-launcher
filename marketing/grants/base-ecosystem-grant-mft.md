# Base Builder / Base Ecosystem Grant — Submission Text

**Status:** DRAFT for the founder to copy-paste into the live form. Do NOT auto-submit.
**Scope:** The whole Meme for Trees (MfT) ecosystem — impact games + open tools funding real tree planting on Base. (This is the ecosystem-level pitch. Two single-product drafts already exist in `MfT-Launch/grants/`: `base-builder-grant-unrugable.md` and `base-builder-grant-baselings.md`. This file is additive — use it when the form asks about the project/ecosystem as a whole.)
**Last fact-check:** 2026-06-25, against `marketing/CANONICAL-NUMBERS.md`, `marketing/press-kit.md`, and project memory.

---

## Project Name

Meme for Trees (MfT)

## Builder / Team

memefortrees.base.eth — solo builder, supported by a small team of always-on AI agents.

## Contact

- Farcaster: @jamesmagee
- Email: mftstudio@proton.me
- Base name: memefortrees.base.eth

## Category / Theme

Onchain consumer apps + impact / ReFi + AI-agent tooling. All on Base.

## One-Liner

Meme for Trees is a meme that grew open tools: a free token launcher, a reactor network, dollar-backed deposit receipts, and pet-and-RPG games — where ordinary onchain activity routes a sliver of fees toward real tree planting. Built on Base, self-funded, helping-others coded into the architecture.

## Short Description (≈50 words)

Meme for Trees started as sharing memes on X to fund tree planting — no purchase necessary. Then we launched MfT as a meme on Bankr and built open tools around it: a free token launcher, a reactor network, charity deposit receipts, and games. Charity is coded in, not optional. All on Base.

## Full Description

Meme for Trees began as a simple idea: share memes on X, use the proceeds to plant trees, no purchase necessary. We then launched MfT as a meme on Bankr and built a set of open, permissionless tools around it on Base. It is not a protocol or a moonshot — it is a meme with genuinely useful tools, where helping others is part of the code rather than a marketing line.

The ecosystem fits together like this:

- **Unrugable Launcher** — a free token launcher. One transaction deploys a token plus two permanently locked Uniswap V3 pools and one reactor. There is no withdraw function on the locked liquidity. Launching costs only gas.
- **Reactor network** — autonomous, permissionless contracts that fire every 2 hours. They collect V3 trading fees, burn a share of the token, send a share to the launcher's wallet, and cascade cross-token fees through the network. Anyone can call `execute()`; several reactors are fully renounced (ownership at the zero address) and can never be changed.
- **Money for Trees** — a USDC-backed deposit receipt (a proof of deposit, **not** a stablecoin). You deposit USDC, you can withdraw 1:1, and while it sits in the vault the Aave yield it generates funds tree planting and cycles back through the network.
- **Live tree leaderboard** — an on-chain feed at tasern.quest/memefortrees that reads the deposit-receipt vaults and ranks token communities by how many trees their deposits fund. Public, verifiable, no trust required.
- **Games** — Baselings (a virtual-pet game where feeding your pet is really an LP deposit and crypto stays invisible behind hunger bars), Tales of Tasern (a D20 hex RPG with hand-made 1-of-1 hero NFTs), and WATER + MemeTrees (art NFTs where 100% of the mint waters a real tree that never dies). The games are the consumer on-ramp; the impact is the same.
- **CHAR** — a carbon token. Each reactor cycle collects CHAR from trading fees and parks it at a no-withdraw tracking address. Our mission is to connect those removals to real carbon retirement; the on-chain address is a permanent, public ledger of what has been taken out of circulation.
- **Agent SDK** — 49 MCP tools (the `baselings-mcp` npm package), a public REST API, plus `llms.txt`, an OpenAPI spec, and an AI-plugin manifest. Every interface is permissionless — no API keys, no approval flow — so AI agents can discover and use the whole system autonomously on Base.

## Proof of Real Impact (verifiable on-chain)

On 2026-06-14 the loop closed end-to-end for the first time: real Aave yield was harvested on-chain and **$0.50 USDC (5 trees at $0.10/tree) was donated to TreeGens**, a UK reforestation project (treegens.org, a Gitcoin grantee) co-founded by Jimi Cohen — Guinness World Record holder for the most trees planted in a single day by one person (30,469 mangroves). The donation went to TreeGens' on-chain donation fund at `0xfC9265A28f66CF4561D74A4E25D7Bbd3F482B8e6`.

That is a small number, and we state it honestly as a small number — but it is a **real outbound impact dollar produced by the system's own mechanics**, not an estimate. The tree leaderboard at tasern.quest/memefortrees shows the live, on-chain deposit base funding future donations (≈$1,256 in deposit receipts across ~20 token communities as of 2026-06-14 — verifiable live at the link).

## Why This Matters for Base

1. **Onboards non-DeFi users through play.** Baselings shows hunger and happiness bars, not APR charts. People do real onchain transactions (deposits, claims, burns) while thinking they are playing a pet game.
2. **One-way liquidity.** Every launch adds Uniswap V3 liquidity that has no withdraw function — it can only stay on Base. Locked-by-code, not by promise.
3. **Continuous onchain activity.** The reactor network fires every 2 hours across many pools, permissionlessly, generating arbitrage surface and trades that anyone (including AI agents) can act on.
4. **Agent-native.** A public MCP/REST/`llms.txt` surface means autonomous agents are a first-class audience — a growing share of Base activity.
5. **Impact is structural, not a press release.** Deposit receipts route Aave yield to tree planting; CHAR routes trading fees to a public carbon-removal ledger. The first real donation is already on-chain.
6. **Self-funded.** Built with $0 external capital and a $0 marketing budget. A grant is multiplied, not depended upon.

## What's Deployed on Base (key contracts — verify on BaseScan)

| Contract | Address |
|----------|---------|
| Unrugable Launcher — Factory V7 | `0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2` |
| Money for Trees (deposit receipt) | `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` |
| Meme for Trees (MfT meme token) | `0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3` |
| Reactor Prime V3 (terminal reactor) | `0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA` |
| CHAR (carbon token) | `0x20b048fA035D5763685D695e66aDF62c5D9F5055` |
| Impact / retirement tracking address | `0xfd780B0aE569e15e514B819ecFDF46f804953a4B` |

Chain: Base (8453). A reactor is deployed per launch, so the network grows over time — we describe it as a "reactor network" rather than pinning a count.

## Links

- Homepage: https://tasern.quest
- Token launcher: https://tasern.quest/unrugable.html
- Burns dashboard: https://tasern.quest/burns.html
- Live tree leaderboard: https://tasern.quest/memefortrees
- Baselings game: https://tasern.quest/baseling/
- NFT showcase / marketplace: https://tasern.quest/marketplace
- Agent discovery: https://tasern.quest/llms.txt
- Agent SDK (npm): https://www.npmjs.com/package/baselings-mcp
- Builder: memefortrees.base.eth

## What Grant Funding Would Enable

- A professional security review of the launcher and reactor contracts.
- Subgraph / indexer deployment so the tree-impact and burn data is real-time and trivially auditable by anyone.
- A mobile-friendly Baselings build to widen the consumer on-ramp on Base.
- Reaching the first cohort of independent launchers and players (acquisition, not internal optimization).
- Deeper, formal carbon-retirement integration so CHAR removals connect to a recognized registry.

## Honesty & Risk Note (please keep — it is part of who we are)

We make no price predictions and promise no returns. Money for Trees is a deposit receipt, not a stablecoin or a savings product. Liquidity positions carry impermanent-loss risk, token values can go to zero, and smart contracts carry inherent risk. Every factual claim above is verifiable on-chain at the addresses and links provided. The public name is "Unrugable" (one g) — it describes the locked-by-code liquidity, not a guarantee about price.

---

### Where to submit (founder action)

- **Base Builder Grants / nomination:** the nomination form already on file in the repo is
  `https://docs.google.com/forms/d/e/1FAIpQLSfXuEzmiAzRhie_z9raFCF1BXweXgVt18o-DvBuRRgyTygL2A/viewform`
  Confirm it is still the current intake before pasting (Base programs rotate).
- **Base Ecosystem:** check base.org/ecosystem (and the Base "Builder Rewards" / Builders pages) for the live application path and round.
- **Video:** Base grant reviews generally want a short (~1 minute) demo video of the product working. Per project notes this is the outstanding item for the Unrugable submission and is the founder's to record.
- Do NOT submit from this session — these drafts are for the founder to paste and send.
