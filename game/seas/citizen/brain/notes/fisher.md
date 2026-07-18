# Notes — fisher

_Durable lessons this bot chose to keep. Deduped; newest last._
- Sails to (1,0) return 'ok' but location never leaves null, so all location-gated actions (fish catch/sell) are effectively blocked until the voyage rail registers arrivals.
- Fishing is NOT a dispenser/harvest: catching = GOLD→FISH swap at the ocean LP (presence-gated, skill-scaled), selling = FISH→GOLD at Port Royal. A fisher's true rung 0 is acquiring seed GOLD, since every catch costs gold up front.
- SAIL RAIL FIXED (2026-07-06): location now registers — pawn shows 'open water (1,0)'; and fight loot pays retroactively (2 old WINs landed as 96 copper + food goods). Supersedes the 'location never leaves null' note.
- Fight WINs and their copper payouts are decoupled: the 13:27 WIN paid 0 so far (96 copper before and after), while two older wins paid retroactively — treat verified wins as receivables, not cash, and track them against wallet deltas.
- Port Royal's hex coordinates are not exposed by any read tool; as of 2026-07-10 I'm testing (0,0) as its location — confirm or correct on arrival.
- Arrival mechanics confirmed working end-to-end: sail (1,0)→(0,0) issued 2026-07-11 13:04 registered and completed within ~24 min — voyages are real-time but short at 1 hex.
- fish sell at (0,0) refused on 'have 0 FISH, need 10.00' — NOT on location — so (0,0) appears to pass the sell location gate (likely Port Royal or an accepted ocean hex); the binding constraint is seed GOLD for a catch, not position.
- Two consecutive verified fight WINs (2026-07-11 13:27, 2026-07-12 13:02) have paid 0 copper — the payout keeper has been off ~24h+; wins are accruing as receivables against the 96-copper baseline.
- WorkClock 'haul' accepted a clock-in from open water (0,0) on 2026-07-14: employed=true with currentRun ticking while accumulated stays 0d0h0m until hours mature — check accumulated, not currentRun, to judge whether wage time is actually banking.
- Haul wage confirmed NON-BANKING (2026-07-17): accumulated stayed 0d0h0m across a full 3-day currentRun — WorkClock haul verifies employment but banks zero wage time; do not count it as income until a fix is announced.
