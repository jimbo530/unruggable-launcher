# seas-server.js — Location Authority + Rule-Gated Trade-Attestation Signer

**STAGED. Not deployed. Review before running as a live service.**

The trust anchor for the "Seize the Seas" market. It makes the in-game economy
**rule-governed**: every gated `LocationPool` only accepts a swap that carries a fresh
attestation from the factory's `gameSigner` proving the caller is *at* that pool's location.
This service decides "is this wallet really here, right now?" and only then asks
`location-signer.cjs` to sign.

This is **not anti-bot** — bots are welcome. The point is *no shortcutting*: you (human or bot)
must genuinely be at a location, having actually sailed there on the real server clock.

## What it does

1. **Location authority** — per wallet: `{ hex, port|null, voyage|null }`. Position changes
   **only** via a server-validated, server-clocked voyage. A client cannot set its own location.
2. **Rule-gated signer** — `/seas/trade-attest` reads the pool's on-chain `location()`, checks the
   server's authoritative record says the wallet is *at* that location **and** not mid-voyage, and
   only then signs the presence attestation. Otherwise **403**.

Map math (`hexDistance`, `PORTS`, grid bounds, `MS_PER_HEX`, `EIGHT_HOURS`) is loaded from the
shared `game/lib/location.js` — single source of truth, no drift. The server keeps its **own**
authoritative position store (it does *not* trust the client's localStorage journey state).

On-chain location encoding: `location = q*1000 + r` (see `deploy/deploy-port-keyed-pools.js`).

## Endpoints

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /` | — | service info + route list + `gameSigner`/`factory` (from deploy record) |
| `GET /seas/health` | — | liveness, `mapLoaded`, `signerAvailable`, store path |
| `GET /seas/location` | `?player=0x..` | authoritative `{ hex, port, location, atSea, voyage, secsLeft }` (resolves arrival first) |
| `POST /seas/sail` | `{ player, toHex:{q,r} }` | begins a server-clocked voyage → `{ voyage }`; 4xx on invalid/already-at-sea |
| `POST /seas/trade-attest` | `{ player, pool }` | **rule gate** → `{ expiry, sig, signer, location }` on pass; **403** "not at … / at sea"; **503** if signer key absent |

### How movement is server-clocked
`POST /seas/sail` resolves any finished voyage, rejects if still at sea, computes
`distance = hexDistance(currentHex, toHex)`, then stamps `departAt = now`,
`arriveAt = now + distance * MS_PER_HEX` on the **server clock** — the only clock that counts.
`GET /seas/location` lazily resolves arrival (like `tryArrive`): once `now >= arriveAt` the wallet
lands at `toHex` and the voyage clears. While in transit, the authoritative `hex` stays at the
origin (no teleporting) and `atSea` is true with a live `secsLeft`.

### How /seas/trade-attest enforces the rule
1. Resolve arrival (so position is current).
2. Read `pool.location()` from chain (`q*1000+r`).
3. **Gate** (`evaluateTradeGate`, pure): refuse if `atSea`; refuse if
   `encode(player.hex) !== poolLocation`. This equality + not-at-sea check **is** the entire trust
   boundary.
4. Only on pass, call `signSwap(pool, player)` — which re-reads `location()` on-chain and signs the
   exact message the contract verifies, so the signed location can never drift from the check.

If the key file is absent (it lives on the VPS), the gate still runs and the route returns **503**
with a clear message — never a fake success.

## Run

```sh
node --check game/server/seas-server.js        # syntax check
node game/server/seas-server.js --selftest     # in-process logic test (mock clock, no RPC/key)
node game/server/seas-server.js                # start the HTTP service (you choose to run it)
```

Env: `SEAS_PORT` (8799), `BASE_RPC`, `SEAS_STORE` (state file path). Signer key is read from
`~/.seas-location-signer.env` (same file `location-signer.cjs` uses).

## Persistence

In-memory store + a JSON-file layer (atomic tmp+rename writes), default
`~/.seas-server-state.json`. A corrupt state file **stops startup** (no silent reset) since the
store is the authority. **PROD: swap the JSON file for a real DB** (durability, atomic writes,
concurrency control).

## Dependencies

`ethers` (already in repo) + Node built-ins (`http`/`fs`/`os`/`path`/`url`). No Express required —
built on the `http` module with Express-style handlers; trivially portable to Express.
