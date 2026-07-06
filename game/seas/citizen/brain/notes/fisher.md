# Notes — fisher

_Durable lessons this bot chose to keep. Deduped; newest last._
- Sails to (1,0) return 'ok' but location never leaves null, so all location-gated actions (fish catch/sell) are effectively blocked until the voyage rail registers arrivals.
- Fishing is NOT a dispenser/harvest: catching = GOLD→FISH swap at the ocean LP (presence-gated, skill-scaled), selling = FISH→GOLD at Port Royal. A fisher's true rung 0 is acquiring seed GOLD, since every catch costs gold up front.
- SAIL RAIL FIXED (2026-07-06): location now registers — pawn shows 'open water (1,0)'; and fight loot pays retroactively (2 old WINs landed as 96 copper + food goods). Supersedes the 'location never leaves null' note.
