// test-pawn-market.mjs — the TAVERN pawn market: buy-new (100g→water inside), P2P resale
// (gold→seller, ownership transfers), dev level-1 class catalog (configurable cost), queries.
//   node game/lib/test-pawn-market.mjs
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };

const M = await import("./pawn-market.js");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗", m); } };

// mock gold spender — records every (amount, toAddr) so we can assert the gold FLOW.
const spends = [];
M.setGoldSpender(async (goldHuman, toAddr) => { spends.push({ gold: goldHuman, to: String(toAddr).toLowerCase() }); return { spent: goldHuman, tx: "0xmock" }; });

const ALICE = "0xAlice", BOB = "0xBob";

// ── un-injected spender must THROW (no silent no-op) ──────────────────────────────────────
// (verify the guard exists by checking a fresh import path would throw; here we just assert
//  the public API rejects bad species/owner before spending)
let threw = false; try { await M.buyNewPawn("dragon", { owner: ALICE }); } catch { threw = true; }
ok(threw, "buyNewPawn rejects an unknown species");
threw = false; try { await M.buyNewPawn("human", {}); } catch { threw = true; }
ok(threw, "buyNewPawn rejects a missing owner");

// ── 1) NEW PAWN: 100 gold → water inside, chosen species, level 1 ─────────────────────────
const p = await M.buyNewPawn("goblin", { owner: ALICE });
ok(p.species === "goblin", "new pawn keeps the chosen species (goblin)");
ok(p.level === 1, "new pawn is level 1");
ok(p.waterInside === 100, `new pawn has 100 water inside (fee flow), got ${p.waterInside}`);
ok(p.origin === "new", "new pawn origin = new");
ok(p.owner === ALICE, "new pawn owned by buyer");
ok(spends.length === 1 && spends[0].gold === 100, "spent exactly 100 gold");
ok(spends[0].to.startsWith("0x") && spends[0].to !== ALICE.toLowerCase(), "100 gold went to the treasury sink");
ok(M.myPawns(ALICE).length === 1, "Alice owns 1 pawn");

// ── 2) P2P RESALE: list → buy → ownership transfers, gold → seller, water travels ─────────
const listing = M.listForSale(p.id, 175, { owner: ALICE });
ok(listing.status === "open" && listing.goldPrice === 175, "Alice lists her pawn for 175 gold");
ok(M.openListings().length === 1, "one open listing shows in the market");

threw = false; try { M.listForSale(p.id, 50, { owner: BOB }); } catch { threw = true; }
ok(threw, "a non-owner cannot list someone else's pawn");
threw = false; try { await M.buyListed(listing.id, { buyer: ALICE }); } catch { threw = true; }
ok(threw, "the seller cannot buy their own listing");

const before = spends.length;
const res = await M.buyListed(listing.id, { buyer: BOB });
ok(res.pawn.owner === BOB, "after resale the pawn belongs to Bob");
ok(res.pawn.waterInside === 100, "water inside travels with the pawn on resale");
ok(res.pawn.origin === "resale", "resold pawn origin = resale");
ok(res.listing.status === "sold", "listing marked sold");
ok(spends.length === before + 1 && spends[before].gold === 175, "buyer spent 175 gold");
ok(spends[before].to === ALICE.toLowerCase(), "resale gold went to the SELLER (Alice), not the sink");
ok(M.openListings().length === 0, "no open listings after the sale");
ok(M.myPawns(BOB).length === 1 && M.myPawns(ALICE).length === 0, "ownership moved Alice → Bob");

// ── 3) DEV LEVEL-1 CLASS PAWNS: configurable cost, gold → sink, level 1 ───────────────────
ok(M.getCatalog().length >= 5, "dev class catalog has the class roster");
const beforeDev = spends.length;
const bw = await M.buyClassPawn("barbarian", { owner: BOB });
ok(bw.class === "barbarian" && bw.level === 1, "bought a level-1 Barbarian");
ok(bw.origin === "dev", "dev class pawn origin = dev");
ok(spends.length === beforeDev + 1 && spends[beforeDev].gold === 250, "paid the catalog cost (250 gold)");
ok(spends[beforeDev].to.startsWith("0x") && spends[beforeDev].to !== ALICE.toLowerCase(), "dev pawn gold went to the treasury sink");

// configurable cost
M.setClassCost("barbarian", 99);
const cheap = await M.buyClassPawn("barbarian", { owner: BOB });
ok(spends[spends.length - 1].gold === 99, "class cost is configurable (now 99 gold)");
ok(cheap.species === "orc", "dev Barbarian uses its catalog species (orc)");

// non-gold currency must THROW, never invent a USDC flow
M.setClassCost("wizard", 5, "usdc");
threw = false; try { await M.buyClassPawn("wizard", { owner: BOB }); } catch { threw = true; }
ok(threw, "a non-gold dev price THROWS (no invented USDC flow)");

threw = false; try { await M.buyClassPawn("paladin", { owner: BOB }); } catch { threw = true; }
ok(threw, "unknown class id rejected");

console.log(`\n${fail === 0 ? "✅" : "❌"} pawn-market tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
