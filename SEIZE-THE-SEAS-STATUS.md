# 🏴‍☠️ SEIZE THE SEAS — Project State (single source of truth)

_Last updated 2026-06-23. The cause=class pirate game + its on-chain economy._

---

## 🟢 LIVE RIGHT NOW
| Thing | Where / Address |
|---|---|
| **Game** (port town) | https://tasern.quest/seas/ — Port · Tavern · Store · Crew · Shipyard · Decks |
| **Crew paper-doll service** | https://tasern.quest/crew/render/ (real plain acorn dolls wired) |
| **BEACON** (INT / Solar charity token) | `0x605507E9213842fdef709C835921fA969baab9f9` |
| **CharityLaunchpad** (cookie-cutter factory, Vault-owned) | `0xc0b891c9A56aF3Eb4cEB9B34CC9c3cE3E8C7074b` |
| **The Black Tide** ship token | `0x8823E5c30a7EC507379e01aeD8F81e0A9Ef787a7` |
| └ reactor (LP fees → crew) | `0xD186C5c730ECe24401E436FCF7Daffa5D1901123` |
| └ **crew = 100 NFTs** (the pawns) | `0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f` |
| **PawnMarket** (open multi-seller) — LIVE | `0x63B44FB9F493905383F8B6FBDe67565b30C922A8` |
| └ distribution: 50 → dev wallet (play, ids 0-49) · 20 free (50-69) · 10@$1 (70-79) · 10@$5 (80-89) · 10@$10 (90-99) | seller = agent; proceeds → agent (sweep to dev) |

## 🟡 BUILT — NEXT
| Thing | Note |
|---|---|
| **Tavern storefront** — wallet-connect → buy/claim from PawnMarket → owned crew = your pawns | the in-game face of the live market (Phase 1 finish) |
| CharityFeeRouter (BEACON's, deployed `0x203e8d…E0E1`) | reuse per charity |

## 🔵 THE CORE LOOP (the game)
**Get a pawn → work JOBS (grind a stat + earn water) → buy GEAR with earned water → FIGHT → Captain → Admiral**
- Built: Tavern, Store (gear art in), Crew (gear up + active fighter), Decks (battle + equips), Shipyard (rank ladder), rooms.
- Revenue split: **cosmetics = the only real-money/dev line**; gear = earned-water; ship/infra fees = charity/impact.

---

## 🔑 KEY ADDRESSES (Base)
**Stat tokens (all Base-verified):** BEACON(INT) `0x605507E9213842fdef709C835921fA969baab9f9` · BURGERS(CON) `0x06A05043eb2C1691b19c2C13219dB9212269dDc5` · TGN(CHA) `0xD75dfa972C6136f1c594Fec1945302f885E1ab29` · EGP(DEX) `0xc1ba76771bbf0dd841347630e57c793f9d5accee` · CHAR(WIS) `0x20b048fA035D5763685D695e66aDF62c5D9F5055` · **CCC(STR) `0xd0581088eaaa4bf9a948b15a057b809c2b0cd61c` ✅ (Carbon Counting Coin, ⚠️ 16 decimals — NOT 18)**
**Infra:** Money `0xe3dd38…A072` · MfT `0x8FB87d…9bA3` · USDC `0x833589…2913`
**Wallets/system:** agent `0xE2a4A8…aC10` · Vault(owner) `0x799Cfa…7B30` · Shipyard `0x1afBe7…D573` · Dock `0x5A9185…85D4`
**Charity:** Solar Foundation `0xB936d9…A420` · trees fallback `0x0780b1…05F2`

---

## 📋 BUILD PHASES
**Phase 1 — get friends playing** (deploy PawnMarket → distribute Black Tide 100: **20 free · 50 → dev wallet · 10@$1 · 10@$5 · 10@$10** → Tavern wallet-connect storefront)
**Phase 2 — jobs + watering** (lift the **acorn idle jobs + its water factory** = `WaterV2.sol` + `deploy-job-vault.cjs`). **WATER STATUS:** CHA=TGNw ✅ · CON=BURGERSw ✅ · **DEX=EGPw ✅ `0xb303c9…` (2026-06-23)** · **INT=BEACONw ✅ `0x90B54D…` (2026-06-23)** · **WIS=SHELLS ✅ FULL FLYWHEEL LIVE (2026-06-23):** SHELLS token `0xef61b7…7824` (launched via CharityLaunchpad) + SHELLSw vault `0x8C121f…Df39` (waters the WIS port grind) + reactor `0x876EB2…3CE4` → CHAR ImpactRetireRouter `0x07A7cF…391f` → buy+retire CHAR → impact registry `0xfd78…3a4B`. · **STR=CRATE ✅ FULL FLYWHEEL LIVE (2026-06-23):** CRATE token `0x48aE78…1F9A` + CRATEw vault `0xD6D793…5f22` + reactor `0xfD13d3…0f80` → CCC ImpactRetireRouter `0xBd4c11…f918` → buy+retire CCC → registry. CCC made buyable via seeded USDC/CCC pool `0x5B5b22Ee…` (thin, widen later). **🎉 ALL 6 STATS WATERED: STR·DEX·CON·INT·WIS·CHA.** NEXT WIRING: add all 6 Xw vaults to jobs-keeper + /plant UI; per-pawn ImpactVaults (CCC+CHAR) still to deploy; gear → earned water.
**Phase 3 — open Shipyard** (self-serve $1 launch → 100 pawns; buy-in OFF, send at 16.7M gas via sequencer; keeper re-wired; new captains undercut in the open market)

## ⛔ BLOCKERS — what I need from you to run
1. ✅ **Dev wallet address** — `0x0780b1…05F2` (done; 50 play-pawns sent)
2. ✅ **Acorn idle water factory** — FOUND 2026-06-23 = `WaterV2.sol` mold + `deploy-job-vault.cjs` fire-button in `mftusd-build`; **50/50 (grow endowment/level + buy X token) verified in source, matches the Seas spec**. Live clones: TGNw (CHA) + BURGERSw (CON). See TOOLS.md.
3. ✅ **Base CCC address** — `0xd0581088…d61c` (16-dec) in the roster.
4. ✅ **DEX + INT watered 2026-06-23** — EGPw + BEACONw deployed live (both fee 10000, against EGP's funded Money pool + BEACON's deep one-sided Money wall). Verified on-chain.
5. 🟡 **STR=CCC + WIS=CHAR remain** = the **BURN/IMPACT pair**, a DIFFERENT model (NOT the airdrop Xw vault): yield 50% endowment + 50% buys the impact token (CCC/CHAR) and **HOLDS it locked at the NFT / forever vault** = retirement / removed from circulation = the character's stat, kept in the same place as the water tokens, **nothing paid out, no reroute**. To build LATER (founder: "let players reroute with in-game choices later, sort as we go"). Blockers: CCC has no on-chain route at all (outside token); CHAR has only USDC/CHAR (no Money pool).
6. 🟡 **WIRE EGPw+BEACONw** into the jobs-keeper harvest list + the /plant jobs UI so players can work them.

## 🧠 HARD-WON LESSONS (don't relearn)
- **Black Tide / heavy launches:** the **buy-in** reverts launches (set `buyInAmount=0`); RPC providers reject sends >~17M gas ("gas limit too high") even though Base's block limit is 400M, and **drpc silently drops** them → **send via sequencer (mainnet.base.org) at ≤16.7M gas**, poll receipt via Alchemy.
- **Grok art:** rooms = cinematic photoreal, characters = storybook acorns; reload+retry on stall; shrink before encoded capture.
- **Cutouts:** green-screen keys cleaner than magenta for warm dolls (no desaturation).

## 📚 MEMORY FILES (background detail)
`project_seas_core_loop` · `project_game_entryway` · `reference_seize_seas_art` · `reference_charity_cookie_cutter` · `project_cause_token_roster` · `project_charity_game_flywheel` · `project_general_store_revenue`
