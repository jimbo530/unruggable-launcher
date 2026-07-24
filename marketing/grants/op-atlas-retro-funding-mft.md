# Optimism — OP Atlas / Retro Funding — Submission Text

**Status:** DRAFT for the founder to copy-paste into OP Atlas. Do NOT auto-submit.
**Why eligible:** Base is built on the OP Stack and is part of the Optimism Superchain, so a Base-native public good is Superchain public-goods work — no bridging or redeploy required to qualify.
**Last fact-check:** 2026-06-25, against `marketing/CANONICAL-NUMBERS.md`, `marketing/press-kit.md`, and project memory.

---

## Project Name

Meme for Trees (MfT)

## Tagline

A meme that grew open, permissionless tools on the Superchain — routing everyday onchain activity toward real tree planting.

## Team / Builder

memefortrees.base.eth — solo builder with a team of always-on AI agents. Self-funded, $0 external capital.

## Contact

- Farcaster: @jamesmagee
- Email: mftstudio@proton.me
- Base name: memefortrees.base.eth

## Suggested Retro Funding Categories

- **Onchain Builders** — consumer apps and contracts generating sustained onchain activity on a Superchain chain (Base).
- **Dev Tooling** — an open, permissionless AI-agent toolkit (MCP server + REST + discovery manifests) any builder or agent can use.

(Confirm the exact category names against the current open round — they change between rounds.)

## Project Description

Meme for Trees started as sharing memes on X to fund tree planting — no purchase necessary — then launched MfT as a meme on Bankr and built open tools around it on Base. It is a meme with useful, permissionless tools, not a protocol or a moonshot. Everything lives on Base, which is part of the Optimism Superchain.

The pieces:

- **Unrugable Launcher** — a free token launcher. One transaction deploys a token plus two permanently locked Uniswap V3 pools and one autonomous reactor. The locked liquidity has no withdraw function. Cost to launch: gas only.
- **Reactor network** — permissionless contracts that fire every 2 hours, collecting V3 fees, burning a share, paying the launcher a share, and cascading cross-token fees through the network. Anyone — human or agent — can call `execute()`. Several reactors are fully renounced (ownership at the zero address) and are immutable forever.
- **Money for Trees** — a USDC-backed deposit receipt (proof of deposit, **not** a stablecoin). Deposit USDC, withdraw 1:1; the Aave yield generated while it sits funds tree planting and cycles through the network.
- **Live on-chain tree leaderboard** (tasern.quest/memefortrees) — reads the deposit vaults and ranks token communities by trees funded. Fully public and verifiable.
- **Games** — Baselings (virtual pet game; feeding a pet is an LP deposit, crypto hidden behind hunger bars), Tales of Tasern (D20 hex RPG with hand-made 1-of-1 hero NFTs), WATER + MemeTrees (art NFTs; 100% of a mint waters a real tree that never dies).
- **CHAR** — a carbon token; each reactor cycle moves CHAR collected from trading fees to a no-withdraw tracking address, a permanent public ledger of carbon credits removed from circulation. Our mission is to connect those removals to real retirement.
- **Open Agent SDK** — 49 MCP tools published as the `baselings-mcp` npm package, plus a public REST API, `llms.txt`, an OpenAPI spec, and an AI-plugin manifest. No API keys, no gatekeeping.

## Why This Is a Public Good (Retro Funding framing)

Retro Funding rewards impact already delivered. Here is what is already shipped and verifiable:

1. **Permissionless, free tooling.** Anyone can launch a token, fire a reactor, deepen liquidity, or read the network with no approval, no KYC, and no fee beyond gas. The contracts are publicly callable; launched tokens are verified on BaseScan.
2. **Open developer/agent tooling.** `baselings-mcp` is a publicly installable npm package; the REST API and `llms.txt`/OpenAPI/ai-plugin manifests let any agent framework auto-discover and integrate. This is reusable infrastructure, not a walled garden.
3. **One-way liquidity on the Superchain.** Every launch adds Uniswap V3 liquidity with no withdraw function — it stays on Base permanently.
4. **Sustained onchain activity.** The reactor network fires every 2 hours across many pools, permissionlessly, producing trades and arbitrage surface — measurable Superchain activity that grows with each launch.
5. **Provable real-world impact.** On 2026-06-14 the system harvested real Aave yield on-chain and donated **$0.50 USDC (5 trees at $0.10/tree) to TreeGens** (treegens.org, a Gitcoin grantee), whose co-founder Jimi Cohen holds the Guinness World Record for the most trees planted in a day (30,469 mangroves). Recipient fund: `0xfC9265A28f66CF4561D74A4E25D7Bbd3F482B8e6`. Small but real — a genuine outbound impact dollar from the system's own mechanics, plus a public on-chain retirement ledger at `0xfd780B0aE569e15e514B819ecFDF46f804953a4B`.

## Impact Metrics (verifiable, not projected)

- First real on-chain charitable donation executed: 5 trees / $0.50 USDC to TreeGens (2026-06-14).
- Deposit-receipt base funding future donations: ≈$1,256 across ~20 token communities as of 2026-06-14 (live and on-chain at tasern.quest/memefortrees — verify at the link).
- A reactor deployed per launch, each firing every 2 hours, permissionlessly.
- 49 MCP tools published to npm for open agent integration.

We deliberately do not cite invented user counts or transaction totals — reviewers can pull live figures from the contracts and the public API below.

## Contracts & Artifacts (Base / Superchain — verify on BaseScan)

| Contract | Address |
|----------|---------|
| Unrugable Launcher — Factory V7 | `0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2` |
| Money for Trees (deposit receipt) | `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` |
| Meme for Trees (MfT meme token) | `0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3` |
| Reactor Prime V3 (terminal reactor) | `0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA` |
| CHAR (carbon token) | `0x20b048fA035D5763685D695e66aDF62c5D9F5055` |
| Impact / retirement tracking address | `0xfd780B0aE569e15e514B819ecFDF46f804953a4B` |

- Public API: https://tasern.quest/api/unrugable/tokenomics
- Agent discovery: https://tasern.quest/llms.txt
- npm package: https://www.npmjs.com/package/baselings-mcp

Chain: Base (8453), an OP Stack chain in the Optimism Superchain.

## Links

- Homepage: https://tasern.quest
- Token launcher: https://tasern.quest/unrugable.html
- Live tree leaderboard: https://tasern.quest/memefortrees
- Baselings: https://tasern.quest/baseling/
- Burns dashboard: https://tasern.quest/burns.html
- Builder: memefortrees.base.eth

## What Continued Support Would Enable

- Formal security review of the launcher and reactor contracts.
- An open subgraph/indexer so the impact and burn ledger is real-time and auditable by anyone in the Superchain ecosystem.
- Wider, formal carbon-retirement integration for CHAR.
- Broadening the open agent toolkit so more Superchain builders can compose on top.

## Honesty & Risk Note (keep this)

No price predictions, no promised returns. Money for Trees is a deposit receipt, not a stablecoin or savings product. Liquidity positions carry impermanent-loss risk, token values can go to zero, and smart contracts carry inherent risk. Every claim above is verifiable on-chain at the addresses and links provided. The public name is "Unrugable" (one g) — it describes locked-by-code liquidity, not a price guarantee.

---

### Where to submit (founder action)

- **Register / apply at OP Atlas:** https://atlas.optimism.io — create or claim the project, then apply to the open Retro Funding round. Confirm the live round, its category names, and deadlines before submitting (rounds rotate).
- **Contract verification step:** OP Atlas / Retro Funding typically asks you to **verify ownership of your deployer/contract addresses by signing with the deployer wallet**, and to link any public repos and the npm package. Decide which contracts and repos to attest to before starting — and confirm which contract source is publicly verified vs. private (the founder/Auditor should confirm BaseScan verification status for each address above).
- **Optional but strong:** link the `baselings-mcp` npm package and the public `llms.txt`/API as the open dev-tooling artifacts.
- Do NOT submit or sign anything from this session — these drafts are for the founder to review, then paste and sign.
