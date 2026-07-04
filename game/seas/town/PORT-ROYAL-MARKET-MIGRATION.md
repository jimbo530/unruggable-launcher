# Port Royal Goods Market — UI now, gated on-chain LPs later

**Status (2026-06-27):** the Port Royal goods market is a **game-layer (UI) shop** — `town/goods-market.html`
priced by `town/port-royal-market.js`. **No on-chain pools, no GOLD spent, no contracts.** This doc is
the plan for turning that UI market into **real, gated on-chain LocationPool LPs** as the game grows.

Founder course-correct that set this:
> "Port Royal trading is UI/game-layer NOW (not new on-chain pools — those come later, gated, seeded
> by buying some of each with GOLD so markets have a start). We should not need any gold for this at
> all yet … for now we build one sided market for every good."

---

## What exists today (game layer)

- **`town/port-royal-market.js`** — the SINGLE SOURCE OF TRUTH: 11 priority goods, each with a
  canonical `goldPrice` (the founder table), expressed in the `{ coin, price }` tier the shop charges
  in. These exact numbers are what the on-chain seed uses — change them in ONE place.
- **`town/goods-market.html`** — the shop. Reads the player's REAL coin balances on-chain
  (`balanceOf`), reads their REAL location from the seas-server (`GET /seas/location`), gates buying
  to **Port Royal (location 8003)**, enforces **whole-unit** quantities, and (beta) marks a buy to the
  player's hold off-chain. The on-chain pay leg is this migration.

### The 11 priority goods (founder table → coin tier the shop charges in)

| Good | GOLD price | Charged as |
|------|-----------:|-----------:|
| SALT | 0.0001 | 1 copper |
| RICE | 0.0002 | 2 copper |
| FLOUR | 0.0004 | 4 copper |
| HONEY | 0.001 | 10 copper |
| RATIONS | 0.005 | 50 copper |
| PORK | 0.01 | 1 silver |
| APPLE | 1 | 1 gold |
| CINNAMON | 1 | 1 gold |
| COD | 5 | 5 gold |
| JERKY | 7 | 7 gold |
| ALE | 8 | 8 gold |

(Coin tiers: 1 GOLD = 100 SILVER = 10000 COPPER; $0.01 / $0.001 / $0.0001.)

---

## The "one-sided market" shape (why it matches the live chain)

We hold huge balances of every good. A one-sided market **offers the good for sale** at a set price;
players bring **coins** to buy it. We seed **no coin reserve** — the core is the **sell-side**
(coin → good). This already matches the live on-chain pattern: every coin/good "wall" pool fills on the
**BUY side** at the anchor and reads **near-zero on the sell side** (see `game/seas/gap-scan.js` — it
prices + trades ONLY the buy direction and flags `sellSafe:false` everywhere but GOLD/Money). So a
coin-in / good-out shop is faithful to how the market behaves on-chain — we are NOT inventing a new
shape, we are skinning the existing one in UI before we re-pour it as new gated pools.

**Buy-back (good → coin) is intentionally NOT offered** in the UI, for the same reason: there is no
safe two-sided sell side yet, so a buy-back would be a near-zero drain. It arrives only with the
two-sided seed below.

---

## Migration: UI market → gated on-chain LocationPool LPs

The on-chain venue is the **gated LocationPool** family used by the fish wall + the AMETHYST/goods
walls. A LocationPool only accepts a `swap()` carrying a fresh **presence attestation** from the
factory's `gameSigner` proving the caller is AT the pool's `location()` — the SAME gate the UI already
checks via `/seas/location`. This is what makes a single-venue, presence-gated market arb-proof: you
can only trade it by genuinely being in Port Royal.

**Factory:** `LocationLPFactory 0x54868729015F0050B364729454a018f1FF7a2d01`
(deploy record: `deploy/location-lp-deployed.json`; pool ABI/flow: `game/seas/citizen/lib/chain.js`
`LOCATIONPOOL_ABI` + `swapLocationPool()`, server gate: `game/server/seas-server.js` `tradeAttest`).

**Location:** Port Royal = on-chain `location` id **8003** (q*1000+r encoding; see
`port-royal-goods-walls-deployed.json.locationId` and the legacy walls already keyed to 8003).

### Steps (ship-time, founder-gated — each is an on-chain tx, NONE happen now)

1. **Pick the goods to graduate first.** Start with the cheap, high-velocity prize goods (SALT, RICE,
   FLOUR, HONEY, RATIONS, PORK) — small coin walls, low value at risk.
2. **Clone one gated LocationPool per (good × its coin) at location 8003** via `LocationLPFactory`,
   following the fish-wall / AMETHYST-wall pattern (`deploy/deploy-port-royal-goods.js` /
   `deploy-port-keyed-pools.js` are the precedents). Price each pool at the **exact** `goldPrice`
   (well, the coin-tier price) from `port-royal-market.js` — same numbers, no drift.
3. **Two-sided seed at migration:** "buy some of each item with GOLD we have so markets have a start."
   Seed the pool with (a) a large good reserve (the sell-side wall we already conceptually hold) AND
   (b) a **small** coin reserve bought with GOLD, so the buy side fills AND a modest sell-back side
   exists. This is the FIRST time GOLD is spent on this market — it is a deliberate, small, ship-time
   seed, **not** a build-time cost.
4. **Wire the UI buy button to the real swap.** Replace the beta "mark to hold" path in
   `goods-market.html` `buy()` with: `POST /seas/trade-attest { player, pool }` → on success,
   `LocationPool.swap(coin → good, minOut, expiry, sig)` (exact coin approval, slippage-guarded —
   reuse `chain.js` `swapLocationPool()`). The presence gate already shown in the UI becomes the
   on-chain gate; nothing in the player flow changes except it's now real.
5. **Graduate the rest** (APPLE…ALE, then gems) as confidence + GOLD seed allow.

### Lock semantics — IMPORTANT

`LocationPool.sol` is **ADD-ONLY**: liquidity can be added but is **never admin-withdrawable** (see
the reactor/pool safety notes — pools are permanent once seeded; admin keys are add-only). Therefore:

- **On-chain seeding is a SHIP-TIME lock, not a build-time one.** Only seed a pool when the good +
  price are final and we are ready to ship that market. Do NOT pre-seed during prototype (that's how
  the Seas LocationPools got prematurely locked before).
- The good reserve we pour in is a one-way commitment; the small GOLD-bought coin reserve likewise.
  Size the GOLD seed deliberately (it cannot be reclaimed).

### Do NOT touch the legacy walls

`deploy/port-royal-goods-walls-deployed.json` holds **legacy on-chain V3 walls** (salt, honey,
rations, apple, cinnamon, cod, jerky, ale, pepper, wine, saffron + gems) already keyed to location
8003. **Do not unwind them.** The UI market is the active market now; the legacy walls stay as-is. When
a good graduates to a fresh gated LocationPool, decide per-good whether to point the UI at the new pool
or keep referencing the legacy wall — but never drain the legacy liquidity.

---

## Invariants to keep through migration

- **Whole units only** — the on-chain swap must still transact whole goods (round/clamp at the UI;
  the pool math handles 18-dec under the hood, but the player always buys integer units).
- **Presence-gated** — every real swap goes THROUGH `/seas/trade-attest` (never around it).
- **Prices live in ONE place** — `port-royal-market.js`. The seed script imports it (dynamic
  `import()`, like `seas-api.js` loads the map) so the on-chain pool price == the UI price by
  construction.
- **Hide crypto** — the player UI keeps speaking coins + whole units, never yield/LP/USD.
- **Real-or-nothing** — if the server is unreachable or the attestation is refused, the buy fails
  loudly; never fake a trade or a balance.
