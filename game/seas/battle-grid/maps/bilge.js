// @ts-check
/**
 * maps/bilge.js — "Ship's Bilge & Hold" terrain (the signature first squad fight: bilge-rat swarm).
 *
 * AREA-MAP.md: "cramped, water pools (hazard), barrels = cover." A tight below-decks scrap where a
 * swarm of cheap bodies teaches squad tactics. Authored for the SQUAD board (16×9) that game.js
 * auto-selects for group fights. Player musters port (left); rats boil up from the bilge (right).
 *
 * Pure data — see maps/index.js for the shape + the terrain vocabulary. No engine, no DOM.
 */
export default {
  id: "bilge",
  name: "Ship's Bilge & Hold",
  aliases: ["ship-bilge"],
  grid: { cols: 16, rows: 9 },
  recommended: "squad",
  blurb: "Below your own decks — cramped, dark, ankle-deep in bilge water. Cargo and barrels give cover; the standing pools are slick footing.",
  deploy: {
    player: { cols: [0, 1] },        // port muster
    enemy: { cols: [14, 15] },       // rats spill from the stern bilge
  },
  terrain: [
    // barrels & cargo crates → COVER
    { q: 4, r: 2, type: "cover", prop: "crate", label: "Cargo crate", mod: { ac: 2 } },
    { q: 7, r: 3, type: "cover", prop: "barrel", label: "Water barrel", mod: { ac: 2 } },
    { q: 9, r: 5, type: "cover", prop: "barrel", label: "Powder barrel", mod: { ac: 2 } },
    { q: 6, r: 6, type: "cover", prop: "crate", label: "Lashed cargo", mod: { ac: 2 } },
    { q: 10, r: 2, type: "cover", prop: "crate", label: "Cargo crate", mod: { ac: 2 } },
    { q: 8, r: 7, type: "cover", prop: "barrel", label: "Grog cask", mod: { ac: 2 } },
    // standing bilge water → HAZARD (slick footing)
    { q: 7, r: 4, type: "hazard", prop: "water-pool", label: "Bilge pool" },
    { q: 8, r: 4, type: "hazard", prop: "water-pool", label: "Bilge pool" },
    { q: 6, r: 4, type: "hazard", prop: "water-pool", label: "Bilge pool" },
    { q: 10, r: 6, type: "hazard", prop: "water-pool", label: "Bilge pool" },
    { q: 5, r: 6, type: "hazard", prop: "water-pool", label: "Bilge pool" },
    // hull ribs / bulkheads → WALL (blocking, frames the cramped hold)
    { q: 3, r: 0, type: "wall", prop: "hull-rib", label: "Hull rib" },
    { q: 12, r: 0, type: "wall", prop: "hull-rib", label: "Hull rib" },
    { q: 3, r: 8, type: "wall", prop: "hull-rib", label: "Hull rib" },
    { q: 12, r: 8, type: "wall", prop: "hull-rib", label: "Hull rib" },
    // sodden muck → DIFFICULT ground (slows the crossing)
    { q: 9, r: 3, type: "difficult", prop: "muck", label: "Sodden planking" },
    { q: 9, r: 4, type: "difficult", prop: "muck", label: "Sodden planking" },
  ],
};
