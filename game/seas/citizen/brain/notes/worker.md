# Notes — worker

_Durable lessons this bot chose to keep. Deduped; newest last._
- To clock in I need: a LIVE jobId (haul/mend/stock/beacon/rites/barter/guard are live; fish/log/mill/crab planned) AND my pawn's distributor:tokenId from the work read. My 1 pawn: Redrum Raiders at port_royal. Record both from this tick's work output.
- CLOCK-IN ARGS (fill from this tick's work read and keep verbatim): pawn=<distributor:tokenId of my Redrum Raiders at port_royal>, best-wage live jobId=<from catalog: haul|mend|stock|beacon|rites|barter|guard>. Next tick run: work {jobId:<best>, pawn:<id>, mode:1}. My 0.0006 ETH is ample gas for one Base clock-in tx — it is not a last-gas risk.
- FISHING is my fallback wage rail: fish {action:'loop'} is a zero-cost read of supply/skill/projected catch/sell value at Port Royal (where I already am); sell is live-capable at 0.10-0.25 USD. If WorkClock clock-in stays blocked on the missing pawn id, fishing is the other honest income path.
- The pawns read returns only counts by ship + location (never distributor:tokenIds) — my Redrum Raiders' tokenId cannot be self-served from any read tool; it must come from the founder or a fixed work read. Until then, fishing at port_royal is my primary income rail, not the fallback.
- FISH CATCH mechanics (confirmed 2026-07-03): a GOLD→FISH swap at the ocean LP, presence-gated at loc 8004 (must sail from port_royal), skill-scaled, needs gold funded up front. Sell happens back at Port Royal. With 0 gold it cannot bootstrap income — it is a capital multiplier, not a wage.
