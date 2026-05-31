# @elizaos/plugin-unrugable

ElizaOS plugin for the **Unrugable Launcher** on Base. Gives AI agents direct access to launched tokens, reactor chain data, adoption status, and guarded swap execution.

## What It Does

The Unrugable Launcher is a token launch platform on Base with permanently locked liquidity and a reactor chain that compounds volume across all launched tokens. This plugin exposes that data to any ElizaOS agent.

**Read actions** (no key required):
- Query infrastructure tokenomics (MfT, BB, EB, AZUSD, CHAR)
- List all launched tokens with metadata
- Get specific token info by address
- Read on-chain factory stats (launch count, min seed)
- Verify reactor validity
- Check token adoption status
- Get recent launches
- Get swap quotes via Uniswap V3
- List allowed ecosystem tokens

**Write actions** (requires private key):
- Execute guarded swaps with hard safety limits ($0.10 max, 60s cooldown, $1/day)

## Installation

```bash
npm install @elizaos/plugin-unrugable
```

Or add to your ElizaOS agent's plugin list:

```json
{
  "plugins": ["@elizaos/plugin-unrugable"]
}
```

## Configuration

Set these environment variables (or in your agent's settings):

| Variable | Required | Description |
|----------|----------|-------------|
| `UNRUGABLE_RPC_URL` | No | Base chain RPC (defaults to `https://mainnet.base.org`) |
| `UNRUGABLE_PRIVATE_KEY` | No | Private key for swap execution only. Read actions work without it. |

## Available Actions

### GET_UNRUGABLE_TOKENOMICS
Get the infrastructure token overview: MfT, BB, EB, AZUSD, CHAR addresses, roles, and reactor mechanics.

### GET_UNRUGABLE_TOKENS
List all tokens launched on Unrugable with metadata, images, and reactor addresses.

### GET_UNRUGABLE_TOKEN_INFO
Get metadata for a specific token by address (name, symbol, reactor, seed, image).

### GET_UNRUGABLE_FACTORY_INFO
On-chain factory stats: total launches, minimum USDC seed, upstream reactor.

### CHECK_UNRUGABLE_REACTOR
Verify whether an address is a valid Unrugable reactor.

### CHECK_UNRUGABLE_ADOPTION
Check if a token has been adopted into the network (returns adopter + reactor).

### GET_UNRUGABLE_RECENT_LAUNCHES
Get the 5 most recent launches with full details.

### GET_UNRUGABLE_SWAP_QUOTE
Get a Uniswap V3 swap quote between any two ecosystem tokens.

### GET_UNRUGABLE_ALLOWED_TOKENS
List all tokens available for swaps with their Base addresses.

### EXECUTE_UNRUGABLE_SWAP
Execute a swap (requires `UNRUGABLE_PRIVATE_KEY`). Hard limits enforced:
- Max $0.10 per swap
- 60 second cooldown between swaps
- $1.00 daily limit
- 5% max slippage
- Allowlisted tokens only

## Supported Tokens

| Symbol | Address | Role |
|--------|---------|------|
| MfT | `0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3` | Network index token |
| WETH | `0x4200000000000000000000000000000000000006` | Base wrapped ETH |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Stablecoin |
| cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | Coinbase BTC |
| AZUSD | `0x3595ca37596D5895B70EFAB592ac315D5B9809B2` | Algo stablecoin |
| CHAR | `0x20b048fA035D5763685D695e66aDF62c5D9F5055` | Carbon credit token |
| EARTH | `0xA5528D1fbd69791B7C6951ef1797DBC2c0e4024b` | Charity/rebase token |
| POOP | `0xB93bA1bcc0D09E3e1C7a7a1e3aC5CC57E795afBe` | Game economy fuel |

## How the Reactor Chain Works

Every token launched on Unrugable gets a **reactor** — a contract that compounds swap fees back into liquidity. Reactors are chained: fees from token A's reactor feed into token B's reactor, which feeds MfT. This creates buy pressure on MfT from every swap on every launched token.

Agents can:
1. Query which tokens exist and their reactors
2. Check if external tokens have been "adopted" (added to the chain)
3. Execute small swaps to participate in the ecosystem
4. Monitor launch activity for new opportunities

## Usage Example

```typescript
import { unrugablePlugin } from "@elizaos/plugin-unrugable";

// Register with your ElizaOS agent
const agent = new AgentRuntime({
  plugins: [unrugablePlugin],
  settings: {
    UNRUGABLE_RPC_URL: "https://mainnet.base.org",
    // Only needed for swap execution:
    // UNRUGABLE_PRIVATE_KEY: "0x..."
  },
});
```

## Safety

- All swap amounts are hard-capped at $0.10
- Cooldown prevents rapid-fire trading
- Only allowlisted tokens can be swapped
- Exact approvals only (never unlimited)
- Every error is surfaced (no silent failures)

## Links

- Website: https://tasern.quest/launcher/unrugable.html
- Chain: Base (8453)
- Factory: `0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51`

## License

MIT
