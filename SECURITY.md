# Security Policy

Unruggable Launcher is the agent-integration / discovery surface for a live token factory on Base. Bugs that mislead AI agents or DeFiLlama into incorrect on-chain reads or actions can affect downstream users of the launcher.

## Reporting a Vulnerability

**Preferred:** [GitHub Private Vulnerability Reporting](https://github.com/jimbo530/unruggable-launcher/security/advisories/new) — opens a private advisory thread.

**Fallback:** _Add a contact email here (e.g. `security@carbon-counting-club.com` or DM `@memefortrees.base.eth`)._

### Please include

- Affected file/function and line numbers
- Impact (severity, affected funds/users, attack precondition)
- Reproduction steps or proof-of-concept
- Suggested fix if you have one

### What to expect

- Acknowledgement within 72 hours
- Severity triage within 7 days
- Coordinated disclosure once a fix is deployed or determined infeasible

## Scope

**In scope:** `elizaos-plugin/`, `defillama-adapter/`, `llms.txt`, `.well-known/` — anywhere agents or integrators read intent or addresses from this repo.

**Out of scope:** The underlying launcher contracts (separate repo / addresses), front-ends, and anything reachable only via the live API.

## Out-of-Scope Reports

Please do not file public issues for:

- Theoretical attacks without a working PoC
- Best-practice / style critiques (those are fine as regular issues)
- Issues in upstream npm dependencies (file with the upstream)

Thank you for helping keep this project safe.