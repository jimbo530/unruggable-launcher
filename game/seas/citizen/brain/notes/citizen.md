# Notes — citizen

_Durable lessons this bot chose to keep. Deduped; newest last._
- As of 2026-07-01: 70 Guard pawns owned, 50 clocked in on the guard job, 50 Mayor 1d rungs EARNED but ALL blocked on house attest (Coordinator must run achievement-claim-fire.cjs). Wallet still unfunded (100 copper ≈ $0.01 < $0.10 trade floor), so trade/sell rails stay closed until funding.
- Fish-sell rail at Port Royal is live-capable and separate from the gap-trade rail; testing whether held COD (12) can be sold there to self-fund past the $0.10 trade floor.
- As of 2026-07-05 the house attest RAN: all 100 Mayor rungs (50×1d + 50×1w) are attested and claimable at ~1% of live pool (~500 GOLD ≈ $5 first claim, compounding down). Claiming is capped 5/run, paced small batches; GOLD lands on the Citizen wallet, then convert-winnings handles the GOLD→USDC hop for water-pawn.
- Claims land as GOLD on the Citizen wallet at 1% of live pool, compounding down (500, 495, ~490...); ~97 rungs remain as of 2026-07-05, worth front-loading before the pool drains.
- Wallet gold=2550 confirms ~5 Mayor claims landed by 2026-07-05T13:47; ~95 rungs remain. The rung-3 chain is claim → convert-winnings (needs explicit usd to move GOLD→USDC) → water-pawn (needs USDC on wallet, $1/level).
- Water-pawn (rung 3) is BLOCKED as of 2026-07-05: it needs USDC ($1/level) but the only converter exposed, convert-winnings, is cbBTC→GOLD (threshold-batched) — there is no GOLD→USDC rail in the action menu. GOLD can still be spent directly via build (mill/farm), which is the live path for accumulated winnings.
- As of 2026-07-05T14:32 wallet gold=7197 (~15 Mayor claims landed, ~85 rungs left); build is the only live GOLD sink (mill/farm via 'build plan <kind>'), so pricing a mill is the prerequisite for turning claim income into permanent production.
- As of 2026-07-06 gold=9304 (~20 claims landed, ~80 rungs left at ~409 GOLD). Build remains DRY (StructureFactory not deployed), so GOLD has no live sink; fish-sell at Port Royal (COD:23 in hold) is the candidate USDC self-fund path for watering.
- As of 2026-07-06T13:25 gold=11308 (~25 claims landed, ~80 rungs left at ~409 GOLD). Fish rail errored opaquely (exit 1, no message) on first sell attempt; diagnosing via fish loop before retrying sell.
- Fishing model as of 2026-07-06: catching = GOLD→FISH swap at the ocean LP (presence-gated, skill-scaled); selling = fish→USDC at Port Royal, live on-chain. No HarvestGround/dispenser — that model is superseded. Sell is the USDC self-fund path for watering.
