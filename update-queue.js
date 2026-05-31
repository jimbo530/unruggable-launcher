const fs = require('fs');
const queue = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const newBaselings = [
  {
    text: "Eat. Poop. Profit.\n\nBaselings \u2014 the pet game where your creature's diet builds its stats and its poop fuels the whole economy.\n\nhttps://tasern.quest/baseling/",
    added: "2026-05-18",
    type: "baselings"
  },
  {
    text: "Eat. Poop. Profit.\n\nMy Baseling ate 4 burgers today. Gained 3 strength levels. Pooped out game fuel.\n\nI've never been this invested in a pixel creature's digestive system.\n\nhttps://tasern.quest/baseling/",
    added: "2026-05-18",
    type: "baselings"
  },
  {
    text: "Eat. Poop. Profit.\n\n- Hatch a mystery egg\n- Feed your pet at the grocery store\n- Watch it level up and evolve\n- Decorate its house (yes, it has shoes)\n- Neglect it and it dies in 3 days\n\nTamagotchi with real consequences.\n\nhttps://tasern.quest/baseling/",
    added: "2026-05-18",
    type: "baselings"
  },
  {
    text: "Eat. Poop. Profit.\n\nIf you don't feed your Baseling for 3 days, it dies. No undo. No revive. Gone.\n\nThe food is cheap. The guilt is not.\n\nhttps://tasern.quest/baseling/",
    added: "2026-05-18",
    type: "baselings"
  },
  {
    text: "Pet game tier list:\n\nS \u2014 Baselings (Eat. Poop. Profit.)\nA \u2014 Tamagotchi (nostalgia carry)\nB \u2014 Neopets (RIP)\nC \u2014 that fish screensaver from 2004\n\nhttps://tasern.quest/baseling/",
    added: "2026-05-18",
    type: "baselings"
  },
  {
    text: "Eat. Poop. Profit.\n\nHatch an egg. Feed it burgers for strength. Salads for wisdom. 8 foods, each shapes your pet differently.\n\nYour diet strategy determines its evolution path.\n\nhttps://tasern.quest/baseling/",
    added: "2026-05-18",
    type: "baselings"
  },
  {
    text: "Eat. Poop. Profit.\n\nPOOP is only created by Baselings eating. No minting. No team allocation. No pre-mine.\n\nIf all pets die, production stops. Keep yours alive.\n\nhttps://tasern.quest/baseling/",
    added: "2026-05-18",
    type: "baselings"
  },
  {
    text: "Eat. Poop. Profit.\n\nA burger-fed tank evolves differently than a salad-fed sage. Multiple pets means multiple builds.\n\nIt's a Tamagotchi that quietly became an RPG.\n\nhttps://tasern.quest/baseling/",
    added: "2026-05-18",
    type: "baselings"
  },
  {
    text: "Eat. Poop. Profit.\n\nYour Baseling has a house. Buy rooms. Give it shoes. Grow a garden. Plant real trees.\n\nThe poop economy runs 24/7.\n\nhttps://tasern.quest/baseling/",
    added: "2026-05-18",
    type: "baselings"
  },
  {
    text: "Eat. Poop. Profit.\n\nSprites are live. Eggs are cracking. Gardens are growing.\n\nBaselings on Base.\n\nhttps://tasern.quest/baseling/",
    added: "2026-05-18",
    type: "baselings"
  }
];

// Replace all baseling entries, keep non-baseling ones
const nonBaseling = queue.filter(q => q.type !== 'baselings');
const result = [];
let bIdx = 0, nIdx = 0;

// Interleave: baseling, non-baseling, baseling, non-baseling
while (bIdx < newBaselings.length || nIdx < nonBaseling.length) {
  if (bIdx < newBaselings.length) result.push(newBaselings[bIdx++]);
  if (nIdx < nonBaseling.length) result.push(nonBaseling[nIdx++]);
}

fs.writeFileSync(process.argv[3] || process.argv[2], JSON.stringify(result, null, 2));
console.log(`${result.length} posts (${newBaselings.length} baseling, ${nonBaseling.length} other)`);
