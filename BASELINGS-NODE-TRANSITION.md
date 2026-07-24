# Baselings — House Base Node Transition & Game Review

_Prepared 2026-07-11. Read-only inventory + prep. Nothing repointed, no funds moved, no tx sent, no pm2 restarted, no git pushed._

---

## TL;DR

- **The whole Baselings backend is currently IDLE.** The live keeper (`baseling-keeper` / `unified-keeper.js`) has been **stopped since ~Jun 15**; `pp-keeper` and `reactor-keeper` are stopped too. Only `baseling-api` (server.js, the metadata + RPC-proxy + save API) is online. The game's own `/health/keeper` endpoint already reports `healthy:false`. This is a clean stop (empty error log), not a crash — so this is a good moment to prep the transition.
- **On-chain state is intact and restorable.** PP snapshot still holds real balances (211 POOP across pools, $34.57 USDC LP, 24 PP positions, 4 houses). Nothing was lost by the stop; the pipeline just hasn't run.
- **The house node is live but NOT at tip.** `127.0.0.1:8545` responds at block **48,181,464**; public Base tip is **48,357,262** → **~176k blocks behind (~4 days), still catching up.** Do NOT repoint anything yet.
- **Good news for the transition: the RPC surface is small and mostly already funneled.** Backend Node code shares patterns and there is already a `tools/base-rpc.js` helper. The browser game already routes reads through a **VPS `/rpc` proxy** (`tasern.quest/api/baseling/rpc`) in the modular source — so browser pages can reach the house node through **one proxy change on the VPS**, no home-PC public URL needed.
- **The 2.4h gate STAYS (founder call) — but its true origin is call walls**: founder 2026-07-11: the 10-slot batching "was 100% a huge effort made just to get farther into call walls" (the worker-clock framing is skin). Fine to keep; cadence is freely tunable on the node. Most other pacing (`await wait()` x53, retry ladders, batch-multicall-with-single-fallback) IS rate-limit scar tissue and becomes tunable/removable once on the node.

---

## 1. RPC CALL-SITE INVENTORY

### Endpoint legend
- **PUBLIC-DIRECT** = browser/script hits a public Base RPC directly (`mainnet.base.org`, `llamarpc`, `publicnode`, `drpc`, etc.)
- **VPS-PROXY** = request goes to `tasern.quest/api/baseling/rpc` → server.js `/rpc` handler → upstream `ALCHEMY_RPC || mainnet.base.org`
- **ALCHEMY/PUBLIC-FALLBACK** = Node script reads `process.env.ALCHEMY_RPC` and falls back to `mainnet.base.org` (note: keeper `.env` has **no** ALCHEMY_RPC set → it's effectively public today)

### A. BROWSER PAGES

| File | Line | Endpoint | Reads/Writes | Volume pattern |
|---|---|---|---|---|
| `Baselings/game/src/wallet.js` | 142 | VPS-PROXY (`tasern.quest/api/baseling/rpc`) | Main pet-game provider — all on-chain reads + `eth_sendRawTransaction` for feeds/mints/deposits | Burst on load (batched multicalls), then per-action |
| `Baselings/game/index-vps.html` | 457, 467 | PUBLIC-DIRECT (`mainnet.base.org`) | Older flat build's provider (chain-sync, mint, LP add, deposits) | Same, but direct |
| `Baselings/game/index-live.html` | 541, 552 | PUBLIC-DIRECT | Flat build variant; comment at 938 notes "BATCHED CHAIN SYNC — replaces 50+ individual RPC calls with 3 multicalls" | Burst on load |
| `MfT-Launch/site/games/nft-loader.js` | 5–9, 43, 77, 158 | PUBLIC-DIRECT fallback list (`mainnet.base.org` → `llamarpc` → `publicnode`) | Arcade minigame roster: `balanceOf` for hero+baseling NFT ownership; `wallet_addEthereumChain` uses `mainnet.base.org` | Once per arcade page load, batched `eth_call` |
| `MfT-Launch/site/games/baseling-player.js` | 30, 100, 140 | ROSTER via `/api/baseling/arcade-roster`; `mainnet.base.org` only in `addEthereumChain` | Reads baseling roster from API (no direct chain), wallet network-add | Once per load |

**Deployed reality:** the live `/var/www/tasern/baseling/index.html` (built Jun 12) contains **both** one `tasern.quest/api/baseling/rpc` reference **and** one `mainnet.base.org` reference — i.e. proxy-primary with a public fallback (or vice-versa in the `addEthereumChain` call). Confirm which is primary when you touch it.

### B. VPS SERVER (the RPC gateway)

| File | Line | Endpoint | Role |
|---|---|---|---|
| `/root/baseling-api/server.js` | 62–95 | `/rpc` proxy → `process.env.ALCHEMY_RPC || 'https://mainnet.base.org'` | **THE browser gateway.** Allowlists ~17 methods, rate-limits 1200/min/IP, hides upstream key. This is the single choke-point for all browser chain traffic. |

### C. KEEPERS / PIPELINES (all Node, all on VPS `/root/baseling-api/`)

| File | Line | Endpoint | What it does | Volume |
|---|---|---|---|---|
| `unified-keeper.js` (**LIVE keeper**, pm2 `baseling-keeper`, STOPPED) | 37, 1947, 2293 | `ALCHEMY_RPC \|\| mainnet.base.org` | Full 2.4h cycle: worker skims, POOP mint/credit, garden + power-plant pipeline, flower/park distribution, KeeperBatch collect. **53 `await wait()` pacing calls.** | 10 cycles/day, heavy multicall per cycle |
| `powerplant-keeper.js` (pm2 `pp-keeper`, STOPPED) | 39, 482 | **hardcoded** `mainnet.base.org` | PowerPlant 3-way split (salary+burn+LP) | Periodic |
| `poop-economy-keeper.js` (STOPPED) | 24, 390, 419 | `ALCHEMY_RPC \|\| mainnet.base.org` | POOP economy; boots "offset by 60s after main keeper to avoid RPC contention" | Periodic |
| `garden-keeper-multi.js` | 31, 357 | **hardcoded** `mainnet.base.org` | Multi-garden V3 position processing | Periodic |
| `keeper-v4.js` (legacy) | 33, 834, 895 + pacing at 260/379 | `ALCHEMY_RPC \|\| mainnet.base.org` | Superseded keeper; contains explicit "pace RPC — free Base endpoint rate-limits rapid reads" | — |
| `arb-bot.js` (**NOT running** — repo file only) | 21, 2337 | `ALCHEMY_RPC \|\| mainnet.base.org` | Trading/arb; fund-mover — out of scope, keep OFF | — |
| `Baselings/tools/base-rpc.js` (shared helper, git-modified) | 11–19 | 7-RPC public fallback list (`drpc`, `mainnet.base.org`, `blastapi`, `publicnode`, `meowrpc`, `tenderly`, `nodies`) | Reusable `getProvider()`/`getWallet()` with timeout+failover | Used by tools/ scripts |

**Old duplicate dir** `/root/baseling-keeper/` (keeper.js, poop-keeper.js, powerplant-keeper.js, garden-keeper.js) — this is the **superseded** copy. The LIVE code is in `/root/baseling-api/`. Don't edit the old dir.

---

## 2. TRANSITION PLAN (staged — DO NOT APPLY UNTIL NODE AT TIP)

**Guiding principle: one config change per layer, not scattered edits.**

### Layer 1 — Keepers & Node scripts (easiest, biggest win)
All keeper scripts already read `process.env.ALCHEMY_RPC` (or should). The house node is local to the VPS's peer only if the node were on the VPS — **it's on the founder's home PC**, so the VPS keepers reach it via the home PC's public URL / tunnel, OR (cleaner) we run a **read cache/relay**. Two options:

- **Option A (preferred, minimal):** Set `ALCHEMY_RPC=<house-node-url>` in `/root/baseling-api/.env` (single line). Every keeper that uses `ALCHEMY_RPC || mainnet.base.org` picks it up on restart. **BUT** two scripts **hardcode** `mainnet.base.org` and must be edited to honor the env: `powerplant-keeper.js:39` and `garden-keeper-multi.js:31`. Change both to `process.env.ALCHEMY_RPC || 'https://mainnet.base.org'`.
- **Requirement:** the house node needs a stable **reachable URL from the VPS** (Cloudflare tunnel / Tailscale / static-IP:8545). If exposing 8545 publicly, gate it behind the same allowlist the `/rpc` proxy uses.

### Layer 2 — Browser game (via the ONE proxy)
The browser already funnels through `server.js` `/rpc`. **Change only `server.js:82`'s upstream** (or the `ALCHEMY_RPC` env it reads) → house node. Then **every browser page that uses the proxy transitions with zero page edits.** This is the cleanest path and needs **no public URL on the home PC exposed to end-users** (only the VPS reaches the node; browsers still hit `tasern.quest`).
- **Cleanup task:** make ALL browser chain reads go through the proxy. Today `index-vps.html`/`index-live.html` and `nft-loader.js` still hit `mainnet.base.org` **directly**. Repoint those direct references to the proxy path so they inherit the node automatically and stop leaking to public RPCs. This is the "single shared config" for the browser: **the proxy URL string.**

### Layer 3 — Shared config object (stage now, wire later)
Create one source of truth per side:
- **Node side:** extend `Baselings/tools/base-rpc.js` — add the house node as `RPCS[0]` behind an env flag `USE_HOUSE_NODE=1`, keep public list as fallback. Point keepers at `getProvider()` instead of ad-hoc `new JsonRpcProvider()`.
- **Browser side:** a single `const CHAIN_RPC = '/api/baseling/rpc'` constant that every page imports/copies, replacing the scattered `BASE_RPCS` arrays and inline `mainnet.base.org` strings.

**STAGE the config files/flags now; leave the actual endpoint pointing at public until the node hits tip.** Flip a single env/flag when ready.

---

## 3. CALL-WALL SCAR TISSUE (what exists only because of rate limits)

| Scar tissue | Location | Why it exists | After transition |
|---|---|---|---|
| **2.4h gate / SLOT_MS** | `unified-keeper.js:33` (`SLOT_MS = 144min`), header line 4 "matches in-game worker clock" | **BORN AS A RATE-LIMIT WORKAROUND (founder-confirmed), kept by choice — reads as a worker cadence and batches gas nicely.** | **KEEP (founder: fine to keep).** Do not remove. Node makes each cycle faster/cheaper but the cadence is the game clock. Could optionally run cycles more granularly for smoother UX, but that's a design call, not a tech one. |
| **53× `await wait()` pacing** | `unified-keeper.js` (500ms–4000ms sleeps between reads) | Free public RPC throttles rapid reads ("could not coalesce") | **REMOVABLE/TUNABLE.** Node has no per-IP cap → drop or shrink to near-zero. Biggest cycle-time win. |
| **Explicit "pace RPC" sleeps** | `keeper-v4.js:260,379,895`; `poop-economy-keeper.js:419` (60s stagger) | Same throttle avoidance / cross-keeper contention | **REMOVABLE.** No contention on a local node. |
| **Multicall-then-single-fallback** | `nft-loader.js:70–110`, keeper `batchBalances():520` | Batch to cut call count under public limits; individual fallback when batch endpoint flakes | **KEEP multicall (still efficient), but the fallback path rarely fires on node.** Can simplify. |
| **3-RPC / 7-RPC fallback lists + timeouts** | `nft-loader.js:5`, `tools/base-rpc.js:11` | Public endpoints go down / rate-limit → rotate | **DEMOTE.** Node becomes primary; keep 1–2 public as emergency fallback only. |
| **1200/min proxy rate-limit** | `server.js:77` | Protects the shared upstream key from browser abuse | **RELAX.** With a local node, raise the ceiling substantially (still keep some limit for abuse). |
| **"snapshot-first, RPC-fallback" reads** | `index-vps.html:4805–4845` (PP snapshot JSON before any RPC) | Avoid live reads entirely on page load | **KEEP as UX optimization** (snapshots are instant), but the RPC fallback becomes cheap/reliable. Snapshot staleness stops mattering once keeper runs again. |
| **`showMsg('… RPC busy, try again')` UX** | `index-vps.html:1119, 10795, 10986` | User-facing apology for public-RPC failures on writes | **Should largely disappear** — node write path is reliable. |

---

## 4. GAME REVIEW (what's testable without spending funds)

### What I could verify (safe, read-only / no funds)
- **Death/evolution logic — HEALTHY.** Ran `game/test-death-evolution-logic.js`: **22/22 PASS.** Covers death-of-record sync guard (no free revives), 90s load-grace window, per-stage evolution baselines (SWIFT→STEADY→ANCIENT), egg/dead no-ops. This is solid, tested logic.
- **Death timer constant confirmed:** `render.js:490` = **72h (3 days)** for baselings, enforced client-side with a load-grace window; dead → graveyard, revive costs vault LP. Matches design (baselings 3 days).
- **On-chain state intact:** PP snapshot shows live balances preserved (211 POOP in pools, $34.57 USDC LP, 24 PP positions, 4 houses, 0.99 POOP house storage). Confirms "state restorable from chain alone."
- **Feature completeness (built, sizeable, present):** `evolution.js` (1129 ln), `breeding.js` (1012 ln), `battle.js` (1397 ln), `yieldling.js` (2513 ln). Breeding gates on `hunger>=80 && happy>=80`, rarity-scaled hatch (24h base → ~72h mythic). These are **built but need live playtesting** once the node is up.

### Broken / stuck things
1. **Keeper is DOWN (root cause of "idle").** `baseling-keeper`, `pp-keeper`, `reactor-keeper` all pm2-**stopped** since ~Jun 15. No POOP flows, no worker earnings credited, no garden/PP pipeline, no flower distribution. `/health/keeper` self-reports `healthy:false`. Nothing runs until it's restarted (after node is ready). **Not a code bug — a stopped process.**
2. **Undeployed local work.** `Baselings` git working tree has **uncommitted edits** to `game/src/{breeding,gameplay,render,sprites,wallet,ui,rooms,main}.js`, `game/dist/index.html`, `api/unified-keeper.js`, plus `.bak` files. The deployed `/var/www/.../index.html` is **older (Jun 12)** than these edits → **the current local game (incl. the death/evolution/breeding fixes that pass tests) is NOT what's live.** This is the "Beast push shipped-but-undeployed" backlog.
3. **RPC endpoint drift between builds.** `wallet.js` (modular) uses the VPS proxy; `index-vps.html`/`index-live.html` (flat) use `mainnet.base.org` direct. Same game, two chain paths → inconsistent reliability. Consolidate during transition (§2 Layer 2).
4. **Two hardcoded-RPC keepers** (`powerplant-keeper.js`, `garden-keeper-multi.js`) ignore `ALCHEMY_RPC` — they'll be missed by an env-only repoint. Flagged in §2.

### Untested-but-built (needs live node + a test wallet, no real funds beyond gas-less flows)
- **Breeding** — full flow (parent selection, care gates, egg creation, hatch timer, trait inheritance). Never exercised on-chain end-to-end.
- **Evolution** — logic passes unit tests, but the on-chain stage-advance + sprite/room transitions need a live run.
- **Battle grid** — `battle.js` is large; grid state, gear loss sink, off-chain combat resolution untested against current builds.
- **Yieldling** (2513 ln) — largest module; 14-day flower death timer, cross-game WoW unit role — untested.
- **Park / flower distribution** — keeper-driven, so idle while keeper is down.

### Top 10 improvement candidates (ranked by player impact; respecting design law: crypto hidden from UI, POOP never minted externally, brett LP = reward only)

1. **Deploy the tested local game build** (breeding/evolution/death fixes) to VPS. Highest impact: players are on an older build than the code that passes tests. _(Deploy only — no funds.)_
2. **Bring the keeper back up on the house node.** Everything downstream (earnings, POOP, gardens, flowers) is dead until this runs. Do it the moment the node is at tip.
3. **Consolidate browser RPC through the proxy** and point the proxy at the node — one change reliability-fixes every "RPC busy, try again" write failure players hit.
4. **Kill/relax the 53 pacing sleeps** on the node → keeper cycles finish in seconds not minutes; smoother, fresher game state.
5. **Snapshot freshness guarantee:** once keeper runs, ensure PP/garden snapshots regenerate each cycle so the snapshot-first UI never shows stale numbers.
6. **Unify the two flat builds** (`index-vps` / `index-live`) or retire the dead one — avoid future drift between chain paths and death logic.
7. **Playtest breeding end-to-end** on the node with a test pet pair — it's demand-driving (breeding-exclusive features) and completely unproven live.
8. **Battle grid smoke test** — verify gear-loss sink and grid state persist correctly against the current build.
9. **Keeper health surfacing:** `/health/keeper` already exists and reads `healthy:false` — wire a quiet in-game/admin indicator (NOT player-facing crypto detail) so a stopped keeper is noticed in minutes, not weeks.
10. **Yieldling shakeout** — largest untested module and the WoW cross-game bridge; needs a dedicated live pass after the basics are green.

_(All 10 are build/deploy/test/config — none require moving or spending user funds. Items touching chain writes go to §5 and need the node live + Ethics review before any tx.)_

---

## 5. TEST BACKLOG (run once the node is at tip)

**Node/infra**
- [ ] Confirm house node reached tip (`eth_blockNumber` == public tip) and stays synced.
- [ ] Confirm VPS can reach the node URL (tunnel/Tailscale/IP:8545) reliably; latency acceptable.
- [ ] Stage `ALCHEMY_RPC=<node>` in `.env`; edit `powerplant-keeper.js:39` + `garden-keeper-multi.js:31` to honor the env.
- [ ] Point `server.js` `/rpc` upstream at the node; raise/relax the 1200/min ceiling.
- [ ] Repoint `index-vps.html`/`index-live.html`/`nft-loader.js` direct RPCs to the proxy path.

**Keeper / pipeline**
- [ ] Restart `baseling-keeper` (unified-keeper.js) on the node; watch one full 2.4h cycle in `logs/keeper-out.log`.
- [ ] Verify worker skims → POOP credited → garden + PowerPlant pipeline → flower/park distribution all complete without pacing sleeps.
- [ ] Restart `pp-keeper` and confirm PP 3-way split (salary+burn+LP) executes.
- [ ] Confirm POOP is only minted from gameplay (never externally) — audit the mint path in the live cycle.
- [ ] Verify PP/garden snapshot JSON regenerates each cycle and matches chain.
- [ ] Keep the 2.4h gate for now (founder call); on the node the cadence is a free dial — revisit only if gameplay wants smoother ticks.

**Game (browser)**
- [ ] Load the game on the node-backed proxy; confirm no "RPC busy" errors on mint/feed/LP-add/deposit.
- [ ] Death timer: baseling dies at 72h, load-grace holds within 90s, graveyard + revive-for-LP works.
- [ ] Evolution: on-chain stage advance + sprite/room transition for each tier.
- [ ] Breeding: care-gate (hunger/happy ≥80), egg creation, rarity-scaled hatch, trait inheritance.
- [ ] Battle grid: grid state, gear-loss sink, off-chain combat resolution.
- [ ] Yieldling: 14-day flower death timer; WoW cross-game unit behavior.
- [ ] Grocery/food: LP-as-food shows as groceries (no yield%/LP in UI); brett LP appears ONLY as yield-flower reward, never as food.
- [ ] Arcade minigames: `nft-loader.js` roster reads resolve via node; hero+baseling ownership correct.

**Regression / safety**
- [ ] Re-run `game/test-death-evolution-logic.js` after any src edits (should stay 22/22).
- [ ] Confirm no direct-to-reactor token sends anywhere in keeper writes (use `depositLiquidity()`).
- [ ] Any on-chain write test uses a throwaway test pet + minimal amounts, Ethics-reviewed, explicit "yes" before tx.

---

## Key file paths
- Live server + RPC proxy: `/root/baseling-api/server.js` (proxy at lines 62–95)
- Live keeper (STOPPED): `/root/baseling-api/unified-keeper.js` (SLOT_MS:33, RPC:37)
- PM2 source of truth: `/root/baseling-api/ecosystem.config.js`
- Hardcoded-RPC keepers to fix: `/root/baseling-api/powerplant-keeper.js:39`, `/root/baseling-api/garden-keeper-multi.js:31`
- Shared Node RPC helper: `C:\Users\bigji\Documents\Baselings\tools\base-rpc.js`
- Main game (modular src, proxy RPC): `C:\Users\bigji\Documents\Baselings\game\src\wallet.js:142`
- Main game flat builds (direct RPC): `C:\Users\bigji\Documents\Baselings\game\index-vps.html:457`, `index-live.html:541`
- Arcade RPC list: `C:\Users\bigji\Documents\MfT-Launch\site\games\nft-loader.js:5`
- Death/evo/breeding: `C:\Users\bigji\Documents\Baselings\game\src\{render.js:490, evolution.js, breeding.js, battle.js, yieldling.js}`
- Passing logic test: `C:\Users\bigji\Documents\Baselings\game\test-death-evolution-logic.js`
- Deployed (older) game: `/var/www/tasern/baseling/index.html` (Jun 12)
