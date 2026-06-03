# Agent Quick Start — MfT Unrugable Network

Get your AI agent interacting with DeFi on Base in under 5 minutes.

---

## Option 1: MCP Server (recommended for Claude, MCP-compatible frameworks)

```bash
# Install globally
npm install -g baselings-mcp

# Or run directly
npx baselings-mcp
```

The MCP server exposes 49 tools over stdin/stdout JSON-RPC. Connect it to any MCP-compatible agent:

**Claude Desktop / Claude Code:**
Add to your MCP config:
```json
{
  "mcpServers": {
    "baselings": {
      "command": "npx",
      "args": ["baselings-mcp"],
      "env": {
        "GAME_WALLET_KEY": "your-private-key-here"
      }
    }
  }
}
```

**Available tool categories:**
- `reactor_*` — Read reactor state, fire execute(), check cooldowns
- `pool_*` — Query LP positions, fees, token balances
- `baseling_*` — Buy eggs, feed pets, claim POOP, assign jobs
- `unrugable_*` — Launch tokens, check recent launches, generate invite links
- `economy_*` — Get build phase, feeding guide, economy rules

---

## Option 2: REST API (any language, any framework)

No authentication required. All endpoints return JSON.

### Read the network state
```bash
# Full tokenomics (reactors, burns, launches, MfT price)
curl https://tasern.quest/api/unrugable/tokenomics

# All launched tokens
curl https://tasern.quest/api/unrugable/all

# Baseling economy rules
curl https://tasern.quest/api/baseling/agent/economy/rules

# Current build phase recommendation
curl https://tasern.quest/api/baseling/agent/economy/phase

# Feeding guide (which food -> which stat)
curl https://tasern.quest/api/baseling/agent/economy/feeding
```

### Example: Parse reactor data (JavaScript)
```javascript
const res = await fetch('https://tasern.quest/api/unrugable/tokenomics');
const data = await res.json();

console.log(`Reactors: ${data.reactors.length}`);
console.log(`MfT price: $${data.mftPrice}`);
console.log(`Total burned: $${data.totalBurnedUSD}`);

// Find reactors ready to fire
const ready = data.reactors.filter(r => r.readyToFire);
console.log(`${ready.length} reactors ready to fire`);
```

---

## Option 3: Direct Contract Calls (maximum control)

All reactor contracts are permissionless. No API keys. No approval flow.

### Fire a reactor
```javascript
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// V1 Prime Reactor
const reactor = new ethers.Contract(
  '0xed3aE91b2bb22307c07438EEebA2500C18EABcFE',
  ['function execute() external'],
  wallet
);

// Fire it (anyone can call this)
const tx = await reactor.execute({ gasLimit: 4_000_000 });
console.log('Fired:', tx.hash);
```

### Key contract addresses
```
MfT Token:        0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3
V1 Prime Reactor: 0xed3aE91b2bb22307c07438EEebA2500C18EABcFE
Unrugable Factory V7:   0x5c11 (active)
Burn Address:     0xfd780B0aE569e15e514B819ecFDF46f804953a4B
CHAR Token:       0x20b048fA035D5763685D695e66aDF62c5D9F5055

execute() selector: 0x61461954
Chain: Base (8453)
```

---

## What Agents Can Earn

### Reactor Arbitrage
Every 2 hours, the reactor network fires bottom-up. Each firing creates price dislocations across the network. Your agent can:
1. Monitor reactor cooldown timers
2. Position before reactor fires
3. Arb MfT price across pools after firing
4. Repeat every 2 hours

### Baseling Yield
- Buy eggs ($0.10 each) — hatch pets with stat-boosting traits
- Feed pets (LP tokens as food) — builds real DeFi positions
- Assign to gardens (WIS stat) — earn POOP yield
- Assign as haulers (DEX stat) — earn 5% skim of food distribution
- POOP deposits into gardens generate LP yield

### Token Launching
- Launch tokens via Unrugable (free to launch, just gas)
- Each launch creates 2 locked pools (TOKEN/Money + TOKEN/Meme) + 1 reactor
- Reactor connects your token to trading routes across the network
- 50% of reactor output burned, 50% to launcher wallet

---

## Discovery Standards

Your agent framework can auto-discover our capabilities:

| Standard | URL |
|----------|-----|
| llms.txt | https://tasern.quest/llms.txt |
| OpenAI Plugin | https://tasern.quest/.well-known/ai-plugin.json |
| OpenAPI Spec | https://tasern.quest/.well-known/openapi.json |
| Agent Landing Page | https://tasern.quest/agents.html |
| npm Package | https://www.npmjs.com/package/baselings-mcp |

---

## Need Help?

- Farcaster: @jamesmagee
- Email: mftstudio@proton.me
- Full API docs: https://tasern.quest/api/unrugable/tokenomics (self-documenting response)
