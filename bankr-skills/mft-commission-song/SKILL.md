---
name: mft-commission-song
description: Commission a song from a Meme for Trees band via Bankr on Base. Use when the user wants to commission/order a song from a band — e.g. "commission a song from EBM about a storm at sea", "get Rish to write a song about my cat". The fan pays a fixed 100,000 of the band's ERC-20 token to the CommissionBooth contract, which pulls the tokens to the project wallet and emits a Commissioned event; an off-chain watcher feeds the songsmith queue and the band writes + posts the song on X, tagging the fan. Two transactions: approve(CommissionBooth, price) on the band token, then commission(bandId, idea, handle). CommissionBooth address is filled after deploy.
---

# Meme for Trees — Commission a Song

A fan commissions a song from a Meme for Trees band by paying with the band's token.
Two transactions from the fan's wallet:
  1. `approve(CommissionBooth, price)` on the band's ERC20 token.
  2. `commission(bandId, idea, handle)` on CommissionBooth.

The contract pulls the price straight to the project wallet and emits `Commissioned`.
The off-chain watcher feeds the event into the songsmith queue. The band produces a
song inspired by the fan's idea and posts it to X, tagging the fan's handle.

---

## Trigger phrases (natural language)

- "commission a song from [BAND] about [IDEA]"
- "get [BAND] to write a song about [IDEA]"
- "order a song from [BAND]"
- "songsmith [BAND] [IDEA]"

---

## Required parameters

| Parameter | Source           | Description                                |
|-----------|------------------|--------------------------------------------|
| `band`    | user input       | Band name (case-insensitive). See table.   |
| `idea`    | user input       | Song topic / idea (≤280 chars recommended) |
| `handle`  | user's X handle  | For attribution in the finished song post  |

---

## Band table

| bandId | Symbol  | Token (Base)                               | Price (tokens)      |
|--------|---------|---------------------------------------------|---------------------|
| 1      | EBM     | 0xF113fe2A0E1181A21fA97B1F52ff232140B7692d  | 100 000 × 1e18      |
| 2      | DD      | 0xa77D43A33AD5C50E27fCf27101c9E6aEfE066CE3  | 100 000 × 1e18      |
| 3      | MYCO    | 0x36A01B05cf86a170490E3Ba4981eFd12B559a5a3  | 100 000 × 1e18      |
| 4      | MR      | 0x8d669b539C7801c1271BC484Bdd8a6084b7788e7  | 100 000 × 1e18      |
| 5      | JS      | 0x16Ba11AeDA2Da0eb2C64Ff7d0e74884033Ef2C65  | 100 000 × 1e18      |
| 6      | NN      | 0x2beBaBdF57597F3ce75BDC75FAD3C40C4A9Fc8cc  | 100 000 × 1e18      |
| 7      | DGT     | 0x52414B7cD2FA723E1c8f9295EB29F16d15aA7BB9  | 100 000 × 1e18      |
| 8      | BONGO   | 0x85Dd5183D203CcE70b88234D31f075774AcCC453  | 100 000 × 1e18      |
| 9      | RICKY   | 0x95286F2cce3C2de48EB75bB4E2Ec004429F18E53  | 100 000 × 1e18      |
| 10     | HT      | 0x7B105F45ddaA689AfDa5606628761a9Fb2dCd826  | 100 000 × 1e18      |
| 11     | WM      | 0x6f45F5cE7027745b1Ab11D5493F187960D00FCfc  | 100 000 × 1e18      |
| 12     | BIGGINS | 0x7C596a0d594D670ffB256bBfbB5379fC8Cf7d62B  | 100 000 × 1e18      |
| 13     | JASMINE | 0x3a952eFa41501c0463Cf8Af9f821f8F549f47Edf  | 100 000 × 1e18      |
| 14     | RISH    | 0x31c600871603bab5d855463E03c6d0a9eB661D26  | 100 000 × 1e18      |

Price in wei: `100000000000000000000000` (100 000 × 10^18)

---

## CommissionBooth contract

**Address (Base, chain 8453):** `FILL_AFTER_DEPLOY`

**ABI (minimal — only the two fan-facing functions needed):**

```json
[
  {
    "name": "commission",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      { "name": "bandId", "type": "uint8" },
      { "name": "idea",   "type": "string" },
      { "name": "handle", "type": "string" }
    ],
    "outputs": []
  },
  {
    "name": "bands",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{ "name": "", "type": "uint8" }],
    "outputs": [
      { "name": "token",  "type": "address" },
      { "name": "price",  "type": "uint256" },
      { "name": "active", "type": "bool" }
    ]
  },
  {
    "name": "paused",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bool" }]
  }
]
```

**ERC20 approve ABI (same for every band token):**

```json
[
  {
    "name": "approve",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      { "name": "spender", "type": "address" },
      { "name": "amount",  "type": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "bool" }]
  },
  {
    "name": "allowance",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      { "name": "owner",   "type": "address" },
      { "name": "spender", "type": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256" }]
  }
]
```

---

## Transaction sequence

Bankr sends these two transactions from the fan's wallet in order:

### Tx 1 — approve

- **Contract:** `bands[bandId].token` (the band's ERC20)
- **Function:** `approve(spender, amount)`
  - `spender` = CommissionBooth address (`FILL_AFTER_DEPLOY`)
  - `amount`  = `100000000000000000000000` (exact price, NOT MaxUint256)
- **Chain:** 8453 (Base)

### Tx 2 — commission

- **Contract:** CommissionBooth (`FILL_AFTER_DEPLOY`)
- **Function:** `commission(bandId, idea, handle)`
  - `bandId` = uint8 from the band table (e.g. 1 for EBM)
  - `idea`   = the fan's song topic string (trim to ≤280 chars before encoding)
  - `handle` = the fan's X handle (include the `@`)
- **Chain:** 8453 (Base)

Always send Tx 1 and wait for confirmation before sending Tx 2 (the contract will
revert on transferFrom if the approval hasn't landed).

---

## Pre-flight checks (before building txs)

1. Call `booth.paused()` — if true, reply "Songsmith queue is currently paused, try again later."
2. Call `booth.bands(bandId)` — verify `active == true`.
3. Call `token.allowance(fanWallet, boothAddress)` — if already >= price, skip Tx 1.
4. Trim `idea` to 280 chars if longer (warn the user if trimmed).

---

## User-facing response template

After both txs confirm:

> Your commission is in the queue! [BAND] will write a song about "[IDEA]".
> We'll tag you (@HANDLE) when it's posted. Tx: basescan.org/tx/[TX2_HASH]

---

## Error handling

| Error                        | User message                                              |
|------------------------------|-----------------------------------------------------------|
| booth.paused()               | "Songsmith is paused right now, try again soon."         |
| band not active              | "That band isn't taking commissions yet."                 |
| fan has insufficient balance | "You need [PRICE] [SYMBOL] tokens to commission a song." |
| approve tx fails             | "Token approval failed — check your [SYMBOL] balance."   |
| commission tx reverts "pay"  | "Payment failed — did the approval go through?"           |
| commission tx reverts "band" | "That band is not active. Try another."                   |

---

## Machine-readable references

- `references/addresses.json` — the band roster (id, symbol, name, token), the
  CommissionBooth address (`FILL_AFTER_DEPLOY`), the fixed price
  (`100000000000000000000000` wei = 100,000 tokens), the 2-tx sequence, and the
  preflight checks — as structured JSON.
- `references/abi.json` — minimal ABIs + selectors for the ERC-20 `approve` and
  the CommissionBooth `commission` / `bands` / `paused` functions
  (`commission(uint8,string,string)` = `0xf2a50707`).

> After the CommissionBooth is deployed, fill the address in both
> `references/addresses.json` and the **CommissionBooth contract** section above.
