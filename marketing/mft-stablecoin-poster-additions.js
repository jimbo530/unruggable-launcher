/**
 * Money for Trees Stablecoin — Additions for poster.js
 *
 * INSTRUCTIONS: Merge these into C:\everythingslide\x-poster\poster.js
 * The Marketer agent could not write to that directory (outside sandbox).
 *
 * 1. Add STABLECOIN_CAPTIONS entries to the end of the CAPTIONS array (before the closing ];)
 * 2. Add STABLECOIN_PROMOS entries to the end of the PROMO_TEMPLATES array (before the closing ];)
 */

// ============================================================
// ADD THESE TO THE END OF THE CAPTIONS ARRAY (line ~70, before ];)
// ============================================================

const STABLECOIN_CAPTIONS = [
  // Money for Trees stablecoin — meme slot captions
  "hold dollars. plant trees. withdraw anytime.\n\nMoney for Trees -- your stablecoin plants trees while you sleep\n\ntasern.quest/money-for-trees.html",
  "every dollar deposited into Money for Trees earns yield through Aave. 100% of that yield plants real trees.\n\nimmutable contract. dollar-backed. withdraw anytime.\n\ntasern.quest/money-for-trees.html",
  "park your money. do good. it really is that simple.\n\nMoney for Trees turns idle dollars into planted trees. no lock-up. no catch.\n\ntasern.quest/money-for-trees.html",
  "your savings account doesn't plant trees. this one does.\n\nMoney for Trees -- 1:1 dollar backed, yield funds forests, withdraw anytime\n\ntasern.quest/money-for-trees.html",
  "the more people deposit, the more trees get planted. the bigger the liquidity, the bigger the yield, the more forests grow.\n\nMoney for Trees\n\ntasern.quest/money-for-trees.html",
];

// ============================================================
// ADD THESE TO THE END OF THE PROMO_TEMPLATES ARRAY (line ~211, before ];)
// ============================================================

const STABLECOIN_PROMOS = [
  `Hold dollars. Plant trees. Withdraw anytime.\n\nMoney for Trees -- immutable, dollar-backed, yield funds forests\n\ntasern.quest/money-for-trees.html\n\n${'{tag}'} ${'{ca}'}`,
  `Your idle dollars could be planting trees right now.\n\nMoney for Trees: deposit, earn yield, 100% goes to forests. No lock-up.\n\ntasern.quest/money-for-trees.html\n\n${'{tag}'} ${'{ca}'}`,
];
