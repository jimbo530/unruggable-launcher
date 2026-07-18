# Notes — trader

_Durable lessons this bot chose to keep. Deduped; newest last._
- My one pawn is Black Tide (Orc) at port_royal; the claim-achievement GOLD scanner only counts citizenOwnedGuardPawns, so ~9 days of verified spar wins pay nothing until that flaw is fixed — check the flaw status each tick before fighting again.
- Black Tide's distributor:tokenId is 0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f:53 — required for work clock-in and water-pawn; found via the pawns read, not the work catalog.
- Quote tool is broken tool-wide at Port Royal (SALT→COPPER and RATIONS→COPPER both exit 1, no detail) — do not retry quotes until the flaw is marked fixed; price goals via build plan instead.
- Foothold pricing is fully blocked at Port Royal: quote is broken tool-wide AND build plan returns no numbers (DRY until founder deploys StructureFactory) — don't spend steps on either until a flaw is marked fixed.
- Fight payouts are not landing: bilge-rat WINs verify but copper stays frozen (would-claim only, payout keeper apparently off) — do not lead with fight again until the purse actually moves from a win.
- The no-arg work read returns only the static job catalog (no 'my pawns' current jobs' or accrued time despite the menu text) — clock-ins cannot be verified by reading work; verify via wallet copper delta across ticks instead.
- Live state now includes a working myPawnJobs read (the old 'work read omits pawn job status' gap is closed): Black Tide confirmed employed on barter, currentRun counts up but accumulated stays 0d 0h 0m — check accumulated + copper delta each tick; if flow=0 on the water-pawn read, the barter wage is flow-gated and needs USDC watering to ever pay.
- water-pawn takes the BARE integer tokenId (53 for Black Tide), not the distributor:tokenId form that work uses — my earlier note saying both need distributor:tokenId is wrong for water-pawn.
- Fish income path is fully gated for me right now: sell needs ≥10 FISH tokens (COD/loot foods don't count), catch = GOLD→FISH swap at the ocean LP requiring gold I don't have (0g) + sailing to the ocean hex — revisit only after I hold ~1+ gold; my hold's sell path is quote/trade at Port Royal.
- Quote rail confirmed broken in a new way 2026-07-14: returns exit 0 'ok' with an EMPTY payload (no numbers) on both COD→COPPER and SALT→COPPER at Port Royal — flaw filed; do not re-probe quote until it's marked fixed.
