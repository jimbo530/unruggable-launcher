// @ts-check
/**
 * maps/sea-cave.js — "Sea Caves & Grottos" terrain (the goblin-pack hideout).
 *
 * AREA-MAP.md: "tight chokepoints, stalagmite/crate cover, dark edges (limited sight)." A
 * smuggler-warren cut into the cliffs. A cave-wall barrier down the middle leaves a narrow
 * CHOKEPOINT (rows 3–5 of column 7) so the pack funnels — kill the Hobgoblin Boss and the rest
 * rout. Authored for the SQUAD board (16×9). Player enters from the mouth (left); goblins hold the
 * deep dark (right).
 *
 * Pure data — see maps/index.js for the shape + the terrain vocabulary. No engine, no DOM.
 */
export default {
  id: "sea-cave",
  name: "Sea Caves & Grottos",
  aliases: ["cave", "sea-caves"],
  grid: { cols: 16, rows: 9 },
  recommended: "squad",
  blurb: "A smuggler-warren grotto. A spur of cave wall splits the cavern, leaving one narrow gap — funnel the pack and break their boss at the choke.",
  deploy: {
    player: { cols: [0, 1] },        // the cave mouth
    enemy: { cols: [14, 15] },       // the deep dark
  },
  terrain: [
    // cave-wall spur down column 7 → WALL, with a gap at r=3,4,5 = the CHOKEPOINT
    { q: 7, r: 0, type: "wall", prop: "cave-wall", label: "Cave wall" },
    { q: 7, r: 1, type: "wall", prop: "cave-wall", label: "Cave wall" },
    { q: 7, r: 2, type: "wall", prop: "cave-wall", label: "Cave wall" },
    { q: 7, r: 6, type: "wall", prop: "cave-wall", label: "Cave wall" },
    { q: 7, r: 7, type: "wall", prop: "cave-wall", label: "Cave wall" },
    { q: 7, r: 8, type: "wall", prop: "cave-wall", label: "Cave wall" },
    // stalagmites / fallen rock → COVER
    { q: 5, r: 2, type: "cover", prop: "stalagmite", label: "Stalagmite", mod: { ac: 2 } },
    { q: 9, r: 5, type: "cover", prop: "stalagmite", label: "Stalagmite", mod: { ac: 2 } },
    { q: 6, r: 6, type: "cover", prop: "stalagmite", label: "Stalagmite", mod: { ac: 2 } },
    { q: 10, r: 3, type: "cover", prop: "rockfall", label: "Fallen rock", mod: { ac: 2 } },
    { q: 4, r: 5, type: "cover", prop: "stalagmite", label: "Stalagmite", mod: { ac: 2 } },
    // dark, broken edges → DIFFICULT ground (limited footing in the gloom)
    { q: 3, r: 1, type: "difficult", prop: "dark-rubble", label: "Dark rubble" },
    { q: 2, r: 7, type: "difficult", prop: "dark-rubble", label: "Dark rubble" },
    { q: 11, r: 7, type: "difficult", prop: "dark-rubble", label: "Dark rubble" },
    { q: 13, r: 1, type: "difficult", prop: "dark-rubble", label: "Dark rubble" },
    // a tide pool at the mouth → HAZARD
    { q: 2, r: 4, type: "hazard", prop: "tide-pool", label: "Tide pool" },
  ],
};
