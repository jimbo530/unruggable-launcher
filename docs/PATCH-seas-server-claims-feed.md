# PATCH: close the severed loot-claims feed (seas-server)

**Why:** `POST /seas/verify-fight` computes an authoritative win + names the LootPool prize, then
returns it in the HTTP response and FORGETS it. Nothing persists the win as a payable claim, so the
loot keeper (which only reads a static `loot-claims.pending.json`) never sees new wins. This is the
root cause of zero payouts after Jul 6.

**Fix:** persist each verified win as an append-only claim (keyed by the single-use `nonce` → natural
dedup, no double-claim) and expose the UNPAID ones on a read endpoint the keeper pulls.

**Boundary respected:** this does NOT touch fight VERIFICATION logic. It only records the already-
computed result (payout path).

Apply on the VPS to `/var/www/tasern/server/seas-server.js` (local byte-identical copy in mftusd-build).

---

## 1) state migration — add `claims` map (in `loadState()`, next to the other additive migrations)

After the `ships` migration line (`if (!parsed.ships ...) parsed.ships = {};`) add:

```js
    // loot claims (payout feed): { [nonce]: { runId, poolAddress, collection, tokenId,
    //   serverVerified:true, prizeLabel, wonAt, paidTx:null } }. Append-only; nonce is single-use so
    //   a claim can never be recorded twice. paidTx is stamped by the keeper's ack (see GET/POST below).
    if (!parsed.claims || typeof parsed.claims !== 'object') parsed.claims = {};
```

Also add `claims: {}` to the default return in `loadState()`'s first line (the no-file branch).

## 2) record the claim — inside `verifyFight()`, in the EXISTING `if (playerWon) { ... }` prize block

Right after `if (fire) prize = { ... };` (where `prize` is built), add:

```js
    // ── PERSIST the win as a PAYABLE CLAIM (payout feed). Keyed by the single-use nonce → the same
    //    fight can never yield two claims. Only recorded on a genuine, conclusive, pawn-bearing win
    //    that named a deployed pool. The keeper reads GET /seas/claims and fires payout() per claim.
    if (prize && prize.deployed && rec.pawn && prize.poolAddress) {
      const st = ensureState();
      if (!st.claims || typeof st.claims !== 'object') st.claims = {};
      if (!st.claims[nonce]) {                         // idempotent on nonce
        st.claims[nonce] = {
          runId: `win-${rec.fight}-${nonce}`,
          poolAddress: prize.poolAddress,
          collection: rec.pawn.split(':')[0],
          tokenId: rec.pawn.split(':')[1],
          serverVerified: true,
          prizeLabel: prize.label,
          wonAt: new Date(_now()).toISOString(),
          paidTx: null,
        };
        saveState();
      }
    }
```

(`rec.pawn` is the `collection:tokenId` pawnKey the issue-seed recorded.)

## 3) read endpoint — in the router (next to `GET /seas/cooldown`)

```js
  if (route === 'GET /seas/claims') {
    // Payout feed: unpaid server-verified wins for the keeper. ?all=1 to include paid ones.
    const st = ensureState();
    const all = u.searchParams.get('all') === '1';
    const list = Object.values(st.claims || {})
      .filter((c) => all || !c.paidTx)
      .map(({ runId, poolAddress, collection, tokenId, serverVerified, prizeLabel, wonAt, paidTx }) =>
        ({ runId, poolAddress, collection, tokenId, serverVerified, prizeLabel, wonAt, paidTx }));
    return sendJSON(res, 200, { ok: true, count: list.length, claims: list });
  }
```

## 4) ack endpoint — mark a claim paid after the keeper confirms on-chain (idempotent, ADMIN-gated)

```js
  if (route === 'POST /seas/claims/ack') {
    // The keeper POSTs { runId, txHash, secret } after an on-chain-confirmed payout so the claim
    // stops showing as unpaid. Gated by a shared secret (env SEAS_CLAIM_ACK_SECRET) — ack only
    // stamps a record, it moves NO funds, but we still don't want open writes.
    const body = await readBody(req);
    if (!process.env.SEAS_CLAIM_ACK_SECRET || body.secret !== process.env.SEAS_CLAIM_ACK_SECRET) {
      return sendJSON(res, 403, { ok: false, reason: 'bad or missing ack secret' });
    }
    const st = ensureState();
    const hit = Object.values(st.claims || {}).find((c) => c.runId === body.runId);
    if (!hit) return sendJSON(res, 404, { ok: false, reason: `no claim ${body.runId}` });
    hit.paidTx = body.txHash || 'acked';
    saveState();
    return sendJSON(res, 200, { ok: true, runId: body.runId, paidTx: hit.paidTx });
  }
```

## 5) ROUTES doc lines (cosmetic, add to the `ROUTES` array)

```js
  'GET  /seas/claims[?all=1]  — payout feed: unpaid server-verified wins (keeper reads this)',
  'POST /seas/claims/ack { runId, txHash, secret } — mark a claim paid (keeper ack; SEAS_CLAIM_ACK_SECRET-gated)',
```

## Deploy
1. Edit `/var/www/tasern/server/seas-server.js` with the 5 blocks above.
2. `export SEAS_CLAIM_ACK_SECRET=<random>` in the seas-server PM2 env (and give the keeper the same).
3. `pm2 restart seas-server --update-env` and hit `GET /seas/health` + `GET /seas/claims` to confirm.

Because claims are keyed by the single-use nonce and only written on a conclusive verified win, this is
double-pay-safe by construction, and the on-chain cooldown remains the belt-and-suspenders anti-double-fire.
