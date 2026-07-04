/*
  free-heroes.js — SINGLE SOURCE for the house's free hosted heroes.
  These are REAL pawns the house wallet (agent treasury 0xE2a4…aC10) OWNS on-chain.
  Free-play HIRES them (a USE of pawns we own) — ownership NEVER moves to the player and is
  NEVER faked. Token ids verified agent-owned 2026-06-26 (orc = Black Tide #52; the others #0);
  elf druid = Verdant Warden #0 verified on-chain 2026-07-04 (100-seat all-elf crew, house-held).
  crew/ and play/ both read window.SEAS_FREE_HEROES so the roster can never drift between pages.
  Render any hero's sprite at:  https://tasern.quest/crew/render/<crewId>.png   (crewId = dist:tokenId)
*/
(function (g) {
  g.SEAS_FREE_HEROES = [
    { crewId: "0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f:52", species: "Orc",    ship: "The Black Tide",   vibe: "Strong & fearless",  blurb: "Hits the hardest. Walks straight at trouble." },
    { crewId: "0x9500880DEC9B310b4a728C75A271a25615A2443E:0",  species: "Elf",    ship: "Sol del Mar",      vibe: "Quick & clever",     blurb: "Fast on her feet, sun at her back." },
    { crewId: "0x4ECe491951B759363bCBAF75389a202Fe0584080:0",  species: "Goblin", ship: "Redrum Raiders",   vibe: "Sneaky & scrappy",   blurb: "Small, mean, and full of dirty tricks." },
    { crewId: "0x8C1f935F6DbB17d593BF3EC8114A2f045e350545:0",  species: "Human",  ship: "The Harbor Guard", vibe: "Steady & tough",     blurb: "Holds the line. Never breaks first." },
    { crewId: "0x4FB1502c3835cf4A9646f2C7c0dDf3584B45b9f1:0",  species: "Elf",    ship: "The Verdant Warden", vibe: "Wise & rooted",    blurb: "Druid of the green deeps. The grove strikes back." },
  ];
})(typeof window !== "undefined" ? window : globalThis);
