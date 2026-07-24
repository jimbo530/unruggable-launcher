# 🧰 TOOLS — our deployed on-chain machines (Base unless noted)

_Catalog of the factories, reactors, generators, vaults & markets. Several categories
have multiple working models for different reasons — listed per category. Add new tools
here when deployed. (For the game project map see `SEIZE-THE-SEAS-STATUS.md`.)_

---

## 🏭 TOKEN LAUNCHPADS / FACTORIES (make tokens + pools + a reactor)
| Model | Address | What / why |
|---|---|---|
| **MycoPad V7** (free launch, 2 pools + V4 reactor) | `0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2` | the live general free-launch factory |
| **CharityLaunchpad** (cookie-cutter: V6 reactor → CharityFeeRouter) | `0xc0b891c9A56aF3Eb4cEB9B34CC9c3cE3E8C7074b` | charity cause-tokens (BEACON's factory); owner = Vault |
| Older adoption factories V5.x / V6 (superseded) | `0x5c11fd8D…`, `0x51eF41E0…`, `0xb1fE1e30…`, `0xF0c1B3d6…`, `0x955383723E…`, `0x9a9E797e…` | ⚠️ TO LABEL — sweep + tag each |
| _(external)_ Uniswap V3 Factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | not ours; pools |

## ⚛️ REACTOR IMPLEMENTATIONS (cloned per launch; process LP fees)
| Model | Impl address | Behavior |
|---|---|---|
| **V4** | `0x891587AD62bcBc6aceE9061D9C4306b9aB16cE45` | 50/50 launcher split |
| **V5** | `0x82eC86F4536167A95eF302056162b1c8b9c7F4FA` | adoption-era |
| **V6** | `0xc735E699e72372fCbA064E1cf5A68CE0840De411` | burn TOKEN 100% · Money→USDC→distributor · Meme→LP (used by Shipyard + CharityLaunchpad) |
| Upstream terminal: ReactorPrimeV3 | `0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA` | MfT terminal of the reactor chain |

## 🌱 GENERATORS (impact generators — burn paired tokens, compound Money, ERC-4626)
`0x7876e05BfA1bCF90110199B68849eaE3eC0F75d3` · `0xe0cD43F031A9F8b3C5A2eB89EA0B1fCa06B6C4b1` · `0x9A6Af2DF740adEa8B0a8d1533b7458B7dA487275` — ⚠️ confirm per-fund mapping.

## 💧 WATER / VAULTS (yield; the JOBS pay in "water" tokens)
| Tool | Address | Note |
|---|---|---|
| **WATER** | `0x9789c459f08896148E8D1a8b2B7a4Bb95FAAf8B2` | direct USDC→MfT harvest engine |
| **Community LP Vault factory** (createVault → USDC→LP vault, yield→depositors+trees) | `0x1f6fF7370e2E897db7cf5d72684EF76d988Caaf1` | ⚠️ NOT the jobs water vault — this is the community LP vault model (deposit USDC→LP) |
| Community LP Vault factory — fee-on-transfer variant | `0x53b418bb3d27D45c34C240A5969121A7A34424C0` | same model, FOT tokens |
| **Xw JOBS WATER FACTORY** ✅ FOUND = `WaterV2.sol` mold + `deploy-job-vault.cjs` fire-button (in `C:\Users\bigji\Documents\mftusd-build`) | _not an on-chain factory — a reusable Solidity mold + env-driven deploy script_ | **THIS is the jobs water vault.** Each fire = a fresh WaterV2 clone for one payout token. **Harvest = exact 50/50: 50% grows the tree (yield-USDC stays locked in Aave forever = the endowment/stat level) + 50% buys the X token → NFT owner (spendable funds).** VERIFIED in source 2026-06-23 — matches the Seas job spec exactly. Reuses shared DestinationRegistry `0x79c13040B3b857f713f4d094DB8b1782186a7cC0`. **Per-token prereq: a Money/X Uniswap-V3 0.01% pool (fee 100) must exist + be seeded** (the harvest buy route) before firing. |
| └ live Xw vaults (deployed clones) | **TGNw `0xc0813524820df5C6bb9a63a521fE218ff974b1B4`** (CHA) · **BURGERSw `0x893531A85f249cC38Da772be9056762E188302F6`** (CON) · **EGPw `0xb303c91724485462e3450A0Bd4513a521df997cB`** (DEX, deployed 2026-06-23, fee 10000) · **BEACONw `0x90B54DA4Ac020fB163C51237e169FecEaC2369be`** (INT, deployed 2026-06-23, fee 10000) · **SHELLSw `0x8C121fC0171944C3EA40d14FE549dFf7107BDf39`** (WIS, deployed 2026-06-23, fee 10000, waters off the launched Money/SHELLS wall) · **CRATEw `0xD6D793628dc6Eed71EB37dd6c51678E8a9c25f22`** (STR, deployed 2026-06-23, fee 10000) | Money/X pools (V3): TGN `0x8dade0…` (fee100) · BURGERS `0x72df7b…` (fee100) · EGP `0x981fEbA0…` (fee10000, $92 Money) · BEACON `0xfEE4c657…` (fee10000, deep one-sided 700M-BEACON sell-wall, 0 Money — buys fill against the wall at ~$1.0e-5, near-zero slippage). All 4 reuse DestinationRegistry `0x79c1…7cC0`. **STILL TO WIRE: add EGPw+BEACONw to the jobs-keeper harvest list + the /plant jobs UI.** |
| Per-token vaults (live) | BTC `0x9e730…` · USDC-peg MoneyPegVault `0xFAc84b28…` · Toshi `0xaD5B…` | community LP vaults (different model) |

## ♻️ IMPACT VAULTS / ROUTERS (burn-stat tokens — buy + RETIRE the impact token, never paid out)
_The burn/impact counterpart to the airdrop Xw vaults. For STR=CCC (carbon) + WIS=CHAR (biochar): retire the impact token instead of airdropping it. Both molds in `C:\Users\bigji\Documents\mftusd-build`, fork-tested green 2026-06-23, NOT an on-chain factory (mold + fire-button)._
| Tool | Where | Behavior |
|---|---|---|
| **ImpactVault** mold + `deploy-impact-vault.cjs` | `ImpactVault.sol` | per-pawn: Aave yield 50% endowment/level + 50% buy impact token (USDC→X **direct**) → **lock on the NFT forever** (retired = stat). No payout, no reroute, immutable, no path to move the locked token out. CHAR DRY gas ~2.14M. |
| **ImpactRetireRouter** mold + `deploy-impact-router.cjs` | `ImpactRetireRouter.sol` | drop-in SporeReactorV6 distributor: takes a meme's LP-fee USDC → buy impact token → send straight to the impact registry (retired). Keeper-gated `retire(minOut)`, never custodies the token, no owner/drain. ~0.66M gas. |
| └ **CHAR ImpactRetireRouter** (live) | `0x07A7cFe7cddD02C884c428A3Ef09DDd0a4B8391f` | impact=CHAR, fee 3000, registry `0xfd78…3a4B`. = the SHELLS reactor's distributor. |
| └ **CCC ImpactRetireRouter** (live) | `0xBd4c11f5dA711101C0a09122746C37aeDdeEf918` | impact=CCC, fee 10000, registry `0xfd78…3a4B`. = the CRATE reactor's distributor. |
| └ **USDC/CCC V3 pool** (seeded so CCC is buyable) | `0x5B5b22Ee08dfa2324cb76ef11a3ff0e13f128b43` | fee 10000, ~$0.92/side at $0.0389 (thin — CCC only had a UniV2 CCC/WETH pair `0x2e87a4…`; widen later). |

## 🐚 SEAS CAUSE-MEMES (launched via CharityLaunchpad, reactor→ImpactRetireRouter)
| Token | Address | Reactor / flow |
|---|---|---|
| **SHELLS** (WIS meme) | `0xef61b7217c1DE74875c286D05e06Ca2d64cC7824` | reactor `0x876EB25FbAdcAF20103aB8766e0B5bb772043CE4` → distributor = CHAR router `0x07A7cFe7…` → buy+retire CHAR → registry. Watered by SHELLSw. **Full WIS flywheel LIVE 2026-06-23.** |
| **CRATE** (STR meme) | `0x48aE78d708B9b06Fa514f2cA39Dbd1dBEc981F9A` | reactor `0xfD13d3586d09878160c6565fF80a933106120f80` → distributor = CCC router `0xBd4c11f5…` → buy+retire CCC → registry. Watered by CRATEw. **Full STR flywheel LIVE 2026-06-23** (thin CCC pool, widen later). |

## 🛒 MARKETS
| Tool | Address | |
|---|---|---|
| **PawnMarket** (open multi-seller pawn market) | `0x63B44FB9F493905383F8B6FBDe67565b30C922A8` | LIVE — Black Tide pawns listed |

## 🚢 SHIPS (crew-NFT fee-share launches)
| Tool | Address | |
|---|---|---|
| ShipyardV2 (V6 + FeeShareDistributor; buy-in now 0) | `0x1afBe7101Acc6460d8793e17c40f9aa5Bbd7D573` | owner = Vault |
| Dock (gasless $1 relay) | `0x5A9185666551012B1ef381dA4cA309599AdF85D4` | |
| The Black Tide (token / reactor / crew) | `0x8823E5…a7a7` / `0xD186C5…1123` / `0x2E2AB7…8e1f` | first ship |

## ❤️ CHARITY
| Tool | Address | |
|---|---|---|
| CharityFeeRouter (BEACON's → Solar) | `0x203e8d717712965F6650506DeFD824225E4Ee0E1` | reuse per charity |
| Money (CharityFund clone, USDC receipt) | `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` | |
| **FTP — Feed The People** (CharityFundKeyed, USDC receipt) | `0xBcd96451257506eD1c8Bf04Cb1638F9011b2af8b` | deployed 2026-07-24; KEYED mint/redeem (0xE2a4+0x0780, addKey/renounceKeys); ⅓ charity USDC→0x0780, ⅓ service mints mftUSD V2 `0x85C7…47B1`→ReactorPrime (burn machine), ⅓ holders; tribe cause fund 🔥 |
| **OCC — Ocean Conservation** (CharityFundKeyed, USDC receipt) | `0xc35111BE2B41BAAAbd411963139748D9EF68EbC3` | same wiring as FTP; tribe cause fund 🌊 |
| **EDU — Education** (CharityFundKeyed, USDC receipt) | `0x9b55bCa2a00ffF1152732402F2B78bD15095548E` | same wiring as FTP; tribe cause fund 🌬️ |
| mftUSD V2 (burn-machine feed, "Money for Trees") | `0x85C78B8104D874d17e698b8c5678e3B8072347B1` | service-leg target of cause funds: harvest = ⅓ USDC→0x0780 + ⅔ buys MfT meme (half burn/LP via ReactorPrime, half holders). Source: mftusd-build/contracts/MoneyForTreesV2.sol |
| **Impact registry / network BURN-tracking sink** | `0xfd780B0aE569e15e514B819ecFDF46f804953a4B` | the one address ALL reactors burn to + `burn-leaderboard.js` reads = the provable on-chain impact ledger ([[project_impact_registry]]). Contract sink, already holds CHAR/MfT/TGN burns. **= the retirement destination for the CRATE/SHELLS LP-fee → buy CCC/CHAR ImpactRetireRouter.** |

## 🪙 STAT TOKENS (Base-verified)
BEACON(INT) `0x605507…b9f9` · BURGERS(CON) `0x06A050…dDc5` · TGN(CHA) `0xD75dfa…ab29` · EGP(DEX) `0xc1ba76…ccee` · CHAR(WIS) `0x20b048…5055` · CCC(STR) `0xd05810…d61c` (16-dec)
Infra: MfT `0x8FB87d…9bA3` · USDC `0x833589…2913`

## 🔑 WALLETS
agent `0xE2a4A8…aC10` (hot, operates) · Vault `0x799Cfa…7B30` (cold, owner) · founder/dev/tree `0x0780b1…05F2` (smart wallet) · relayer `0xC4040c…E023`

---
### ⏳ TODO on this catalog
1. ~~Pin down the acorn-idle water factory~~ ✅ DONE 2026-06-23 = `WaterV2.sol` + `deploy-job-vault.cjs` in `mftusd-build` (the mold + fire-button; 50/50 verified in source).
2. **Water the 4 remaining stat tokens** (STR=CCC · DEX=EGP · INT=BEACON · WIS=CHAR): per token (a) create + seed a Money/X 0.01% V3 pool at the LIVE oracle price, then (b) fire `deploy-job-vault.cjs` (JOB_SYMBOL=Xw, JOB_PAYOUT=token, JOB_REGISTRY=`0x79c1…7cC0`). Needs user go + bots paused.
3. Label the unlabeled adoption factories + generators (sweep each on-chain).

## 🌲₿ CARBON RETIREMENT + BTC/ETH FAMILY (all deployed 2026-07-07)
| Thing | Address | Notes |
|---|---|---|
| **CHAR-R fund** (Char Retirement Fund) | `0xde12963128CBe9aF173a37FFF866cA4D4A194ff4` | CharityFund clone; yield ⅓ buys CHAR→registry, ⅓ ReactorPrime, ⅓ holders. CHAR = 1 t CO₂e |
| **CCC-R fund** (CCC Retirement Fund) | `0xb1265a9C15a467D7Fce45e61D926e900CCb6bF7B` | same; CCC = 1 lb CO₂e, **16 decimals!** |
| CHAR-R retire router (dedicated) | `0x228Eac0Afc16fD6995586c8E1039B538e30DaA16` | USDC→CHAR fee 3000 → registry 0xfd78…3a4B |
| CCC-R retire router (dedicated) | `0xf12636665De97c00120c480bF56b8f4d74e55cDc` | USDC→CCC fee 10000 (thin pool) → same registry |
| CHAR-R RetirementVault (no-circulation) | `0xD4110DA32E769cebc0Fe43B98BF8081cbae5AF2e` | USDC in/out, custody, deposit(amount, displayName) |
| CCC-R RetirementVault | `0xdD7E7596BD1F89D0d7f529A03EA5307342824b6A` | same |
| **BTC-T** (BTC for Trees) | `0x839BAa00734f319C11F2869bC155C6B5Fe35a283` | AssetTreeFund: cbBTC in 1:1; yield ⅓ RAW cbBTC→tree wallet 0x0780, ⅓ Prime (as BTC-T), ⅓ holders |
| **ETH-T** (ETH for Trees) | `0x80d1edd0236A06283fd1212FDB12cfA79516933d` | same in wETH |
| **cbBTC-C compounder** | `0xf245B7a1825FaA0525A2a452Abb29011680E434A` | 100% self-compounding Aave wrapper, LP-ready (the "sails") — UNSEEDED |
| **wETH-C compounder** | `0x31B18E177D9E520E8113745F91Eb31C6e0ADa7ea` | same — UNSEEDED |
| BTC-T/MfT V3 pool (fee 10000) | `0x5e7D447b9B72Df378Cf1e9AF04Eb83D03f75f825` | seed NFT #5509601 owned by ReactorPrime + registered w/ BTC-T fund |
| **cbBTC→Meme LP public vault** | `0x8A0Facd90dF1a0bfbc45C8cBb640d5D981beF409` | CommunityV3PoolVault(cbBTC, BTC-T, MfT, pool); page btc-lp-vault.html; call registerForYield() after first deposit |
| Thalnor Rootwarden endowment | `0xF7fCDf2A6e2B4F43C974C6Ee28798a1971924BD3` | TR contract holds 25 CHAR-R + 25 CCC-R (dvslewis $50, genesis deposits) |
| Pages | char-r-vault / ccc-r-vault / btc-lp-vault / retire-leaderboard .html | leaderboard has public harvest/claim cranks + boards strip on all 6 boards |
| Keeper | charw-keeper (VPS PM2) | now harvests Money V4/PRGT/CHAR-R/CCC-R/BTC-T/ETH-T + fires both retire routers (quoter-guarded) daily |

## 🎵 BAND TOKENS (all 1B fixed, no admin; 1% one-sided walls; sealed burn reactors)
| Band | Token | Walls (V3 fee 10000) | Sealed reactor (admin=0x0) | Community vault / page |
|---|---|---|---|---|
| EBM | `0xF113fe2A0E1181A21fA97B1F52ff232140B7692d` | EGP `0xA05eC6d7…4280` + Money `0x53bF2AAC…16ad` (0.01% originals EMPTY) | `0xA01B9202…5095` | `0xdd47bdDD…Ed95` / ebm-vault.html |
| RISH | `0x31c600871603bab5d855463E03c6d0a9eB661D26` | Money `0x983F5054…EFAe` + PKT `0x4f0Da48E…A6F1` | `0x98D55914…542a` | `0x131bd427…98E1` / rish-vault.html |
| BONGO | `0x85Dd5183D203CcE70b88234D31f075774AcCC453` | Money `0x76AE74cc…1dda` + BTN `0x09f4426C…28A1` | `0xA607F5Ea…a76E` | `0x3aF2d7CC…198f` / bongo-vault.html |
| DGT | `0x52414B7cD2FA723E1c8f9295EB29F16d15aA7BB9` | Money `0x4dABc580…eD9C` + IGS `0xEFbcb137…A007` | `0x6ab04d2d…200c` | `0x43ebB722…a367` / dgt-vault.html |
All four on VPS reactor call line. Poster carries $TAG + CA on every song share.

## 🏴 NATION MARKETS (2026-07-07: all 8 nations have Money + MemeForTrees V2 LPs — see nft-lp-database/lp-pairs.json for all pairs)
Nations Exchange bot: PM2 `tasern-nations-exchange`, wallet `0xCfFc12793F2C0442BE10F070A05341d2701d7e39` (NATIONS_COLLECTOR_KEY) — collects all 8 nations via Money↔MEME venue arb (MEME priced via EGP hub on-chain). ⚠️ decimals: BTN/IGS/DHG = 8; CCC = 16.

## 🏠 HOUSE-NODE STAGING (built 2026-07-07, NOT ON — runbook mftusd-build/IMPACT-V2-TURNON.md)
impact-indexer-v2.cjs (local) → impact-v2.json → tree-leaderboard.v2.html (staged) · node-tunnel.cmd (house→VPS reverse tunnel) · /root/node-switch/switch-to-house-node.sh + rollback-to-remote.sh (7-bot fleet flip)
