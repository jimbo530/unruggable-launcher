// @ts-check
/**
 * maps/open-sea-kraken.js — "Open Deck vs the Kraken" terrain (the showcase break-free fight).
 *
 * AREA-MAP.md / CONTENT-WISHLIST.md §2: "big open deck; rails = fall-overboard hazard, masts =
 * cover, water-edge hexes where tentacles rise." The Kraken's arms surface on the WATER EDGE — the
 * right-hand rim of the deck, which is exactly where the (now board-wide) enemy spawns land. Win by
 * SEVERING arms or OUTLASTING the onslaught, not a wipe. Authored for the SQUAD board (16×9); also
 * serves the open-sea deck. Player musters amidships (left); the sea heaves on the right.
 *
 * Pure data — see maps/index.js for the shape + the terrain vocabulary. No engine, no DOM.
 */
export default {
  id: "open-sea-kraken",
  name: "Open Deck — The Kraken",
  aliases: ["kraken-sea", "open-deck", "deep-sea", "open-sea"],
  grid: { cols: 16, rows: 9 },
  recommended: "squad",
  blurb: "A heaving open deck over the abyss. Keep off the rails or go overboard; use the masts for cover. The arms break the surface along the seaward rail.",
  deploy: {
    player: { cols: [0, 1, 2] },         // amidships muster
    enemy: { cols: [13, 14, 15] },       // the seaward rail — where the arms rise
  },
  terrain: [
    // the rails fore & aft → HAZARD (a knock here pitches you overboard)
    { q: 4, r: 0, type: "hazard", prop: "rail", label: "Rail — overboard!" },
    { q: 6, r: 0, type: "hazard", prop: "rail", label: "Rail — overboard!" },
    { q: 8, r: 0, type: "hazard", prop: "rail", label: "Rail — overboard!" },
    { q: 10, r: 0, type: "hazard", prop: "rail", label: "Rail — overboard!" },
    { q: 4, r: 8, type: "hazard", prop: "rail", label: "Rail — overboard!" },
    { q: 6, r: 8, type: "hazard", prop: "rail", label: "Rail — overboard!" },
    { q: 8, r: 8, type: "hazard", prop: "rail", label: "Rail — overboard!" },
    { q: 10, r: 8, type: "hazard", prop: "rail", label: "Rail — overboard!" },
    // masts & rigging → COVER
    { q: 6, r: 3, type: "cover", prop: "mast", label: "Mainmast", mod: { ac: 2 } },
    { q: 9, r: 3, type: "cover", prop: "mast", label: "Mizzen", mod: { ac: 2 } },
    { q: 7, r: 4, type: "cover", prop: "rigging", label: "Fallen rigging", mod: { ac: 2 } },
    { q: 7, r: 5, type: "cover", prop: "mast", label: "Foremast", mod: { ac: 2 } },
    { q: 10, r: 5, type: "cover", prop: "capstan", label: "Capstan", mod: { ac: 2 } },
    // the seaward rim → WATER-EDGE (the band the tentacles rise from — the enemy/kraken spawn side)
    { q: 15, r: 0, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 15, r: 1, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 15, r: 2, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 15, r: 3, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 15, r: 4, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 15, r: 5, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 15, r: 6, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 15, r: 7, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 15, r: 8, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 14, r: 1, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 14, r: 4, type: "water-edge", prop: "foam", label: "Heaving sea" },
    { q: 14, r: 7, type: "water-edge", prop: "foam", label: "Heaving sea" },
  ],
};
