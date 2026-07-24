# Shipyard crew USDC payout keeper

Pushes claimable **USDC** out to the **100 crew NFT holders** of each Shipyard
launch, so holders never have to claim themselves. **DRY-RUN by default**,
import-safe, and **non-custodial** — it can only ever deliver USDC to rightful
holders, never take any.

This is a *separate* keeper from `MfT-Launch/relayer/` (which fulfils launch
requests via `Dock.fulfill`). This one handles the **fee-share payout** side.

---

## How the money flows (verified against contract source)

```
players trade a launched ship token
        │  (V3 LP fees accrue in the TOKEN/Money + TOKEN/Meme pools)
        ▼
SporeReactorV6.execute()            ← permissionless, 2h cooldown
        │  burns collected TOKEN, deepens Meme LP,
        │  redeems collected Money → USDC, forwards the USDC delta to ↓
        ▼
FeeShareDistributor (USDC)          ← one per launch, 100 NFTs (ids 0..99)
        │  accPerShare += delta/100 ; each NFT now has pending(id) USDC
        ▼
claimAll(ids)                       ← permissionless; pays ownerOf(id), not caller
        ▼
the 100 crew NFT holders receive USDC
```

- `FeeShareDistributor.sol` — `pending(id)`, `claim(id)`, `claimAll(ids)`. Payout
  token is **USDC** (the Shipyard constructs it with `usdc` as the payout token).
  No admin can drain the fee pool.
- `SporeReactorV6.sol` — `execute()`, `timeUntilExecute()`, `paused()`,
  `distributor()`. `execute()` is the top-up that makes USDC claimable.
- `Shipyard.sol` — `launchCount()` / `launches(i)` used to auto-discover every
  launch's distributor.

**Safety:** both `claimAll` and `execute` are permissionless and pay out only to
the rightful party (`ownerOf(id)` / the distributor). The keeper's signer can
**never** receive crew USDC — it only spends its own gas. Same "can never steal"
property as the launch relayer.

---

## What the keeper does each pass

1. **Resolve targets** — every crew distributor, from `SHIPYARD_ADDRESS`
   discovery *or* an explicit `DISTRIBUTOR_ADDRESSES` list.
2. **Phase A — optional top-up** (`TRIGGER_REACTOR=true`, default **off**): if the
   reactor's 2h cooldown has elapsed and it isn't paused, call `execute()` to
   collect fees → redeem Money → fund the distributor with fresh USDC. Wrapped in
   try/catch so it never blocks the payout. Off by default so the keeper never
   burns the cooldown on empty fees.
3. **Phase B — distribute** (core, always on): one Multicall3 batch reads
   `pending(id)` for ids 0..99, filters to ids with USDC waiting, and — if the
   distributor's total clears `MIN_CLAIM_USDC` — calls `claimAll(ids)` in chunks
   of `CLAIM_BATCH`. USDC lands in each `ownerOf(id)`.

---

## Run it

```bash
cd MfT-Launch/shipyard-relayer
npm install                      # ethers + dotenv
cp .env.example .env             # then edit .env

# DRY-RUN (default): reads pending, logs what it WOULD pay, sends nothing.
npm run dry
npm run once                     # single pass then exit

# LIVE — only after review + funding the signer with a little Base ETH for gas:
#   set DRY_RUN=false and PAYOUT_KEY in .env, then:
node shipyard-payout-keeper.js
```

The keeper **never** sends a transaction in dry mode and **never fires on
import** (the `main()` loop is guarded by `NODE_TEST_CONTEXT`, matching the
peg-keeper pattern). The signer **address** is logged; the **key is never
printed**.

### Always-on (PM2, on the VPS)

Mirror the existing `relayer/ecosystem.config.js` convention — e.g.:

```js
module.exports = {
  apps: [{
    name: 'shipyard-payout-keeper',
    script: 'shipyard-payout-keeper.js',
    cwd: __dirname,
    autorestart: true,
    max_restarts: 20,
    restart_delay: 5000,
    env: { NODE_ENV: 'production' },
  }],
};
```

Keep the key in a protected env file (e.g. `~/.shipyard-wallets.env`), not in the
repo. Use the **dedicated relayer wallet**, not the shared agent wallet, so it
won't collide with other PM2 bots.

---

## Config (.env)

| var | default | meaning |
|---|---|---|
| `ALCHEMY_RPC` | public Base RPC | Base RPC URL |
| `SHIPYARD_ADDRESS` | — | factory for auto-discovering distributors |
| `DISTRIBUTOR_ADDRESSES` | — | explicit distributor list (overrides discovery) |
| `PAYOUT_KEY` / `RELAYER_KEY` | — | signer key (only needed when `DRY_RUN=false`) |
| `DRY_RUN` | `true` | `false` actually sends; anything else = dry |
| `TRIGGER_REACTOR` | `false` | also fire `reactor.execute()` to top up |
| `MIN_CLAIM_USDC` | `0.10` | skip a distributor below this total (whole USDC) |
| `CLAIM_BATCH` | `50` | crew ids per `claimAll` tx (1..100) |
| `POLL_MS` | `300000` | loop interval ms |
| `ONCE` | `false` | single pass then exit |
| `MIN_ETH_WARN` | `0.0004` | log a warning if signer ETH drops below |
| `EXECUTE_GAS` | `8000000` | explicit gasLimit for `execute()` |

### Verified addresses (do not invent others)

From `deploy/shipyard-FINAL-deployed.json` (FINAL/LIVE, supersedes V1/V2):

- Shipyard (factory): `0x1afBe7101Acc6460d8793e17c40f9aa5Bbd7D573`
- Dock: `0x5A9185666551012B1ef381dA4cA309599AdF85D4`
- USDC (payout token): `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- owner / treasury (Vault): `0x799CfafABA99e9779fA8779B56dE62E193cb7B30`

Each `FeeShareDistributor` is **per-launch** (no single fixed address) — that's
why targets are discovered from the factory or passed explicitly.

---

## Economics caveat (honest)

Crew fee amounts are tiny early on. Pushing 100 small USDC transfers can cost
more gas than the USDC distributed, so this is a **funded operator service**
(gasless for holders), not a profit center. `MIN_CLAIM_USDC` is the floor that
stops the keeper from spending gas on pure dust — raise it if gas isn't worth it.

## Legal flag (carried from the contract)

An NFT bought specifically to earn fee revenue is Howey-shaped. The crew fee-share
is **gated behind legal review** before any public push (see
`docs/fee-share-nft-spec.md` and `project_feeshare_nft`). This keeper does not
change that posture — it only delivers USDC that holders could already claim
themselves.
