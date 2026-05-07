# Security

## Contract Immutability

All LaunchToken contracts deployed through MfT factories are fully immutable:

- **No owner** — no admin, no governance, no privileged functions
- **No mint** — fixed supply set at deployment, cannot be increased
- **No burn** — supply cannot be decreased
- **No pause** — transfers cannot be stopped or frozen
- **No blacklist** — no address can be blocked from sending or receiving
- **No proxy** — contracts are not upgradeable
- **No tax** — zero buy/sell/transfer tax, pure ERC-20
- **No external calls** — no callbacks, no hooks, no reentrancy surface

Once deployed, a LaunchToken cannot be modified by anyone, including the factory, the launcher, or the MfT team.

## Liquidity Lock

Every launch creates 9+ Uniswap V3 liquidity positions that are transferred to a SporeReactor contract. Reactor contracts have:

- **No withdrawal function** — LP positions cannot be removed
- **No transferFrom for NFTs** — LP position NFTs cannot be transferred out
- **Permanent lock** — liquidity is locked for the lifetime of the blockchain

This is verifiable on-chain: inspect the reactor contract source code on Basescan and confirm no function exists to withdraw or transfer position NFTs.

## Verified Source Code

All contracts are verified on Basescan with full source code:

| Contract | Address | Status |
|---|---|---|
| Factory V5.2 (Unruggable2) | `0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51` | Verified |
| Factory V4.3 (MycoPadV4) | `0x51eF41E0730c0e607950421e1EE113b089867d3e` | Verified |
| SporeReactorV4 (impl) | `0x82eC86F4536167A95eF302056162b1c8b9c7F4FA` | Verified |
| All launched tokens | Various | Verified (auto-verified on launch) |

## Audit Status

MfT smart contracts have not undergone a formal third-party security audit. The contracts are minimal by design to reduce attack surface:

- LaunchToken: 79 lines of Solidity, standard ERC-20 with no extensions
- Factory contracts: create tokens and lock liquidity in a single atomic transaction

We welcome community review of all verified source code on Basescan.

## Metadata API

The token metadata API (`/api/unruggable/metadata/`) is secured with:

- **No-overwrite policy** — once metadata is stored, it cannot be replaced
- **Factory verification** — only tokens from known MfT factories can have metadata stored
- **Rate limiting** — max 5 POST requests per minute per IP
- **SVG rejection** — SVG uploads are blocked to prevent XSS
- **Input validation** — addresses validated against strict hex pattern

## Known Limitations

1. **LP not recognized by scanners** — GoPlus and TokenSniffer show LP as "not locked" because the reactor contract is not a widely-recognized lock provider (like Team.finance or Unicrypt). The LP is permanently locked by contract design, but automated scanners cannot detect this.

2. **Single admin wallet** — factory deployment and reactor management use a single wallet. Multi-sig is planned but not yet implemented.

3. **No testnet deployment** — all contracts are deployed to Base mainnet only. Testnet deployments for development are planned.

## Responsible Disclosure

If you discover a security vulnerability in any MfT smart contract or infrastructure:

1. **Do not** exploit the vulnerability or disclose it publicly
2. Contact us at: **@jamesmagee** on Farcaster
3. Include: description of the vulnerability, steps to reproduce, potential impact
4. We will acknowledge receipt within 48 hours and work to resolve the issue

We do not currently offer a bug bounty program, but we deeply appreciate responsible disclosure and will credit researchers who help improve our security.

## Security Checklist for Launchers

Before launching a token through MfT, verify:

- [ ] Source code is verified on Basescan (automatic for all launches)
- [ ] Token has no owner or admin functions (guaranteed by LaunchToken design)
- [ ] Liquidity is locked in reactor (verifiable on-chain)
- [ ] contractURI returns valid EIP-7572 metadata (automatic)
