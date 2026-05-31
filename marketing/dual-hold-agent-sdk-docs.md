# MfT Dual-Hold Strategy -- Agent SDK Documentation

> For AI agents, trading bots, and autonomous wallets on Base.

---

## Overview

The MfT ecosystem has two tokens with the same ticker, different mechanics, and a verifiable on-chain feedback loop between them.

| Token | Type | Address | Decimals |
|-------|------|---------|----------|
| MfT (meme) | Deflationary ERC-20 | `0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3` | 18 |
| MfT (deposit) | 1:1 USDC-backed proof of deposit | `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072` | 6 |

**Chain:** Base (8453)

---

## The Mechanism

### MfT Deposit Token (NEVER call this a "stablecoin" — GENIUS Act)

- 1:1 USDC backed proof of deposit. Reserves deposited to Aave V3 on Base.
- `deposit(uint256 amount)` -- deposit USDC, receive proof of deposit 1:1.
- `withdraw(uint256 amount)` -- burn proof of deposit, receive USDC 1:1.
- `harvest()` -- permissionless. Anyone can call. Splits accrued Aave lending rewards three ways.
- `claim(address holder)` -- permissionless. Claims accrued mftUSD for any holder.
- `claimV2Pool(address pool, address lpHolder)` -- claims rewards for V2 LP holders.
- `claimV3Position(uint256 tokenId)` -- claims rewards for V3 position owners.
- `pendingYield()` -- view function. Returns harvestable yield in USDC (6 decimals).
- Contract is immutable. No owner. No admin. No proxy. No upgrade path.

**Yield split (hardcoded and immutable in V2 contract):**
- 1/3 -- depositors (additional mftUSD minted from yield)
- 1/3 -- reactor (mftUSD minted to hardcoded Meme for Trees reactor `0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA`)
- 1/3 -- operations (USDC sent to hardcoded operations wallet `0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2`)

**Key dependency addresses:**
```
USDC:       0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Aave V3:    0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
aBasUSDC:   0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB
Reactor:    0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA
Operations: 0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2
```

### MfT Meme Token

- Deflationary. Reactors buy and burn MfT every 2 hours.
- MfT sits on top of every Unrugable launched token's pool stack -- every buy/sell of any launched token generates MfT volume.
- A growing reactor network with hundreds of pools. All permissionless. 5 fully renounced (immutable).
- V1 Prime Reactor (`0xed3aE91b2bb22307c07438EEebA2500C18EABcFE`) fires last, buying MfT across 12 pools with accumulated network fees.

---

## The Dual-Hold Loop

```
Agent deposits USDC
    |
    v
Mints proof of deposit (1:1, withdraw anytime)
    |
    v
USDC earns yield in Aave V3 (variable lending rewards)
    |
    v
harvest() called (permissionless, anyone can trigger)
    |
    v
Yield split three ways (hardcoded, immutable):
    |-- 1/3 --> depositors (additional mftUSD minted from yield)
    |-- 1/3 --> reactor (mftUSD deepens ecosystem liquidity)
    |-- 1/3 --> operations (USDC for trees, maintenance)
    |
    v
Reactor receives mftUSD + LP holder rewards compound
    |
    v
More deposits = more Aave lending rewards = more mftUSD flowing through ecosystem
```

**What the agent gets:**
1. Principal is safe -- proof of deposit is 1:1 USDC backed, withdraw anytime.
2. Additional mftUSD accrues automatically (claim anytime).
3. The reactor share deepens liquidity, generating more trading fees network-wide.
4. LP holders double-earn: holder rewards + normal LP fees.

**What is verifiable on-chain:**
- Aave deposit: check `aBasUSDC.balanceOf(mftDepositContract)` -- must equal or exceed `mftDeposit.totalSupply()`
- Pending yield: call `mftDeposit.pendingYield()`
- MfT meme burns: track Transfer events to burn address `0xfd780B0aE569e15e514B819ecFDF46f804953a4B`
- Reactor state: call `execute()` on any reactor or query via `tasern.quest/api/unrugable/tokenomics`

---

## Integration Code

### Deposit into MfT V2
```javascript
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MFT_DEPOSIT = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';

const usdc = new ethers.Contract(USDC, [
  'function approve(address,uint256) external returns (bool)',
  'function balanceOf(address) view returns (uint256)'
], wallet);

const mftDeposit = new ethers.Contract(MFT_DEPOSIT, [
  'function deposit(uint256) external',
  'function withdraw(uint256) external',
  'function harvest() external',
  'function claim(address) external',
  'function pendingYield() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)'
], wallet);

// Deposit 100 USDC
const amount = ethers.parseUnits('100', 6);
await usdc.approve(MFT_DEPOSIT, amount);
await mftDeposit.deposit(amount);

// Check pending yield
const pending = await mftDeposit.pendingYield();
console.log('Pending yield:', ethers.formatUnits(pending, 6), 'USDC');

// Harvest yield (splits 1/3 each -- anyone can call)
if (pending > 0n) {
  await mftDeposit.harvest();
}

// Claim accrued mftUSD for your wallet
await mftDeposit.claim(wallet.address);
```

### Buy MfT Meme Token
```javascript
const MFT_MEME = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';

// Use Uniswap V3 or any DEX aggregator on Base
// MfT meme has 12+ pools in the reactor network
// Deepest liquidity pools: MfT/WETH, MfT/USDC, MfT/cbBTC
```

### Monitor the Loop
```javascript
// Check your deposit backing
const backing = await mftDeposit.totalBacking();
const supply = await mftDeposit.totalSupply();
console.log('Backing ratio:', Number(backing) / Number(supply));
// Should always be >= 1.0 (yield accrues on top)
```

---

## API Endpoints

| Endpoint | Returns |
|----------|---------|
| `tasern.quest/api/unrugable/tokenomics` | Full network state: reactors, burns, MfT price, pool data |
| `tasern.quest/llms.txt` | Machine-readable ecosystem description |
| `tasern.quest/.well-known/ai-plugin.json` | OpenAI plugin manifest |
| `tasern.quest/.well-known/openapi.json` | OpenAPI spec |

---

## Why Both Tokens

| Metric | MfT Deposit | MfT Meme |
|--------|-----------|----------|
| Risk to principal | None (1:1 USDC) | Market risk |
| Yield generation | Aave V3 (variable rate) | Reactor buy+burn |
| Supply direction | Grows with deposits | Shrinks (deflationary) |
| Role in loop | Generates the yield | Receives reactor burns |
| Verification | `pendingYield()` on-chain | Burn address balance on-chain |

Holding only deposit: you earn additional mftUSD but miss the reactor-driven appreciation.
Holding only meme: you get reactor burns but no yield-funded ecosystem growth from your own capital.
Holding both: your deposit's lending rewards mint mftUSD into the reactor and back to you. The two tokens feed each other.

---

## Contract Source

Verified on Basescan: `0xe3dd3881477c20C17Df080cEec0C1bD0C065A072`

Source: `MoneyForTreesV2.sol` -- ERC20 + ReentrancyGuard, Synthetix accumulator, no admin functions, no proxy, immutable.

---

## Discovery

| Standard | URL |
|----------|-----|
| llms.txt | https://tasern.quest/llms.txt |
| OpenAI Plugin | https://tasern.quest/.well-known/ai-plugin.json |
| OpenAPI Spec | https://tasern.quest/.well-known/openapi.json |
| Agent Landing Page | https://tasern.quest/agents.html |
| npm Package | https://www.npmjs.com/package/baselings-mcp |
| Farcaster | @jamesmagee |
