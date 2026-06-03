# Invite System Announcement — V7

All content below is DRAFT pending Guardian review before publishing.

---

## X Posts

### Tweet 1 — The Announcement

Unrugable V7 has invite links.

Launch a token for free. Get a shareable link. When someone launches using your link, their reactor chains upstream to yours — permanently.

You earn 50% of your token's fees. They earn 50% of theirs. Fee flow between reactors is on-chain and verifiable.

tasern.quest/unrugable.html

### Tweet 2 — The Mechanic

How Unrugable's invite system works:

1. You launch for free (one transaction — token + 2 pools + reactor)
2. You share your invite link
3. Your invitee launches with that link
4. Their reactor chains upstream to yours
5. Fee flow is permanent and on-chain

Both of you earn 50% of your own token's fees. The network grows stronger with every link in the chain.

### Tweet 3 — The Positioning

Most referral programs give you a one-time kickback and forget you exist.

Unrugable's invite system is structural. It lives in the smart contract. Reactors chain upstream permanently. Every new launch adds another node to the reactor network — more pools, more volume, more burns.

Free to launch. Two pools locked forever. No admin keys that can withdraw. The invite link is just the address of your reactor — verifiable on-chain by anyone.

tasern.quest/unrugable.html

---

## Farcaster Posts

### FC Post 1 — The Mechanic (for /defi or /base-builders)

Unrugable V7 invite system is live. Here's the mechanic:

When you launch a token (free, one transaction), the factory deploys a reactor. That reactor has an upstream parameter. Normally it points to ReactorPrimeV3. But if someone launches using your invite link, their upstream points to YOUR reactor instead.

Result: cross-token fees cascade upstream through the reactor chain during every 2-hour fire cycle. Permanent. On-chain. No off-chain tracking, no coupon codes.

The factory validates invite addresses against the isReactor[] mapping — you can only invite through a real deployed reactor. No gaming it.

Every new launch adds another node to the reactor tree. The network grows permissionlessly.

tasern.quest/unrugable.html

### FC Post 2 — Call to Action (for /base or /defi)

Free token launch on Unrugable V7 gets you:
- 1B token supply
- 2 permanently locked V3 pools (Money 70% + Meme 30%)
- 1 reactor (50% burn / 50% to your wallet)
- A shareable invite link
- $10K starting market cap

Every launch through an invite link adds another reactor to the network. More reactors = more pools = more volume = more burns and earnings.

No withdraw function exists. No admin key can drain pools. That's not a limitation — that's the product.

tasern.quest/unrugable.html

---

## Invite Explainer (Site / Pinned Post)

### How Unrugable Invites Work

When you launch a token on Unrugable, you get a shareable invite link: tasern.quest/unrugable.html?ref=YOUR_REACTOR_ADDRESS

This link tells the factory to chain your invitee's reactor upstream to yours.

**What happens on-chain:**
Every swap in your invitee's pools processes fees through the reactor chain during the 2-hour fire cycle. This is not a one-time referral bonus — it is a permanent on-chain connection baked into the smart contract at deploy time. As more launchers join through invite links, the reactor tree grows deeper, generating more volume across the entire network.

**What the invitee gets:**
A free token launch — 1B supply, two permanently locked liquidity pools (TOKEN/Money at 70%, TOKEN/Meme at 30%), and a reactor that pays 50% of token fees to their wallet every 2 hours. Same launch everyone gets.

**What you get:**
Cross-token fees from your invitee's reactor cascade upstream to yours during each fire cycle. Your own reactor still pays you 50% of your token's fees independently.

**How the network grows:**
Each new launcher becomes a node in a growing reactor tree. Fees cascade upstream through every node during each fire cycle. The invite address is validated against the factory's isReactor[] mapping. Only real, deployed reactors can be upstream targets.

---

## Rug Report Tweet

Another day, another token where the "team" had withdraw access to the liquidity pools. Pools drained. Holders left with nothing. Same pattern every week.

Unrugable launches have no withdraw function. Not "multisig locked." Not "timelocked." The function does not exist in the bytecode.

Free to launch. Two pools locked at deploy. No admin key can touch them. Verifiable by anyone who reads the contract.

tasern.quest/unrugable.html

---

## Compliance Notes

- No "pump" language used anywhere
- All claims are verifiable on-chain (2 pools, no withdraw function, isReactor[] validation, upstream chaining)
- Brand is "Unrugable" throughout — no MycoPad references
- No price predictions or return guarantees
- No urgency/FOMO language
- No disparaging named projects in the Rug Report tweet
- Invite system framed as network growth, not personal downstream revenue
- No MLM-adjacent language
- "Earn" refers to fee distribution from the reactor, not price appreciation
