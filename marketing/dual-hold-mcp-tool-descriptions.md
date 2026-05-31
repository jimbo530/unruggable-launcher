# MCP Tool Descriptions -- MfT Dual-Hold

> These are proposed tool description strings for the baselings-mcp package.
> Each description is written for agent consumption -- structured, verifiable, no marketing fluff.

---

## New Tools to Add

### mft_stable_deposit

```json
{
  "name": "mft_stable_deposit",
  "description": "Deposit USDC into the Money for Trees V2 deposit contract on Base. Mints proof of deposit 1:1. Reserves earn yield in Aave V3. Yield split three ways (hardcoded, immutable): 1/3 depositors (additional mftUSD), 1/3 reactor (mftUSD), 1/3 operations (USDC). Principal is withdrawable anytime via mft_stable_withdraw. Contract is immutable -- no admin, no owner. Contract: 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072. USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913. Chain: Base (8453).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "amount": {
        "type": "string",
        "description": "Amount of USDC to deposit, in human-readable format (e.g. '100' for 100 USDC). Will be converted to 6-decimal format internally."
      }
    },
    "required": ["amount"]
  }
}
```

### mft_stable_withdraw

```json
{
  "name": "mft_stable_withdraw",
  "description": "Withdraw USDC from the Money for Trees V2 deposit contract. Burns proof of deposit, returns USDC 1:1. No lock-up period. No penalty. Contract: 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072. Chain: Base (8453).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "amount": {
        "type": "string",
        "description": "Amount to withdraw, in human-readable format (e.g. '100' for 100 USDC). Will be converted to 6-decimal format internally."
      }
    },
    "required": ["amount"]
  }
}
```

### mft_stable_harvest

```json
{
  "name": "mft_stable_harvest",
  "description": "Harvest accrued Aave yield from the MfT V2 deposit contract. Permissionless -- any wallet can call this. Splits yield three ways: 1/3 depositors (additional mftUSD), 1/3 reactor (mftUSD), 1/3 operations (USDC). All hardcoded and immutable. Only succeeds if pendingYield > MIN_HARVEST. Contract: 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072. Chain: Base (8453).",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

### mft_stable_status

```json
{
  "name": "mft_stable_status",
  "description": "Query the current state of the MfT V2 deposit contract: total supply, total backing (USDC in Aave), pending yield available to harvest. Use this to verify the 1:1 backing ratio (totalBacking >= totalSupply) and check if harvest() should be called. Contract: 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072. Chain: Base (8453).",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

### mft_dual_hold_analysis

```json
{
  "name": "mft_dual_hold_analysis",
  "description": "Analyze the dual-hold strategy for a wallet holding both MfT tokens. Returns: deposit balance, MfT meme balance, current deposit backing ratio, pending yield, estimated annual yield at current Aave rate. MfT meme: 0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3. MfT deposit: 0xe3dd3881477c20C17Df080cEec0C1bD0C065A072. Chain: Base (8453).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "wallet": {
        "type": "string",
        "description": "Wallet address to analyze (0x format)"
      }
    },
    "required": ["wallet"]
  }
}
```

---

## Updated Existing Tool Descriptions

### unrugable_tokenomics (updated description)

```
"description": "Fetch full Unrugable reactor network state: all reactors, pool data, MfT meme price, burn totals, launch history. MfT meme token (0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3) receives automated buy+burn pressure from the reactor network every 2 hours. The deposit contract yield split sends additional mftUSD to depositors and to the reactor (0xe3dd3881477c20C17Df080cEec0C1bD0C065A072). Chain: Base (8453)."
```

### unrugable_launch (updated description)

```
"description": "Launch a new token on the Unrugable platform. Creates permanent locked LP positions and reactor pair. Each launch generates MfT volume (MfT is the top pool in every launched token stack). Every launch also gets a charity fund sell wall -- helping others is coded into the architecture. Factory: 0xb1fE1e3073Cd42e3DB721473F997C1b4c73a1B5e. Chain: Base (8453)."
```

---

## llms.txt Addition

> Append to existing llms.txt under a new section.

```
## MfT Dual-Hold Strategy

Two MfT tokens on Base form a feedback loop:

- MfT meme (0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3): deflationary, reactor buy+burn every 2hr
- MfT deposit (0xe3dd3881477c20C17Df080cEec0C1bD0C065A072): 1:1 USDC proof of deposit, Aave V3 yield, immutable

Yield split (hardcoded): 1/3 depositors (additional mftUSD), 1/3 reactor (mftUSD), 1/3 operations (USDC).
Deposits generate Aave lending rewards that mint additional mftUSD into the ecosystem.
Hold both: your deposits feed the reactor and earn you additional mftUSD. Verify on-chain: call pendingYield(), totalBacking() on the deposit contract.

deposit(uint256) -- deposit USDC, get proof of deposit 1:1
withdraw(uint256) -- burn proof of deposit, get USDC 1:1
harvest() -- permissionless, splits yield three ways
claim(address) -- permissionless, claims accrued mftUSD for any holder
```
