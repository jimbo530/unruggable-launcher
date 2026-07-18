// @ts-check
// goods-tokens.js — Port Royal TRADE-GOOD markets (food + gems) with live coin walls.
// Buying swaps the item's native coin → good on its wall (deploy-port-royal-goods.js).
// price = book value in that coin. Generated from deploy/port-royal-goods-walls-deployed.json.
export const GOODS = [
  // ── food (consumables / provisions) ──
  { id: 'salt',     name: 'Salt',     emoji: '🧂', kind: 'food', coin: 'copper', price: 1,  address: '0xdDCB77AA553718ACc88aA61ba1514EE267Cc6825' },
  { id: 'honey',    name: 'Honey',    emoji: '🍯', kind: 'food', coin: 'silver', price: 1,  address: '0x92Cf60b74BD16aAb42f2C249e72E9860e83A765f' },
  { id: 'rations',  name: 'Rations',  emoji: '🥖', kind: 'food', coin: 'silver', price: 5,  address: '0x0867653716D37DC9F13c5347A8Ca8fFF6CA95926' },
  { id: 'apple',    name: 'Apple',    emoji: '🍎', kind: 'food', coin: 'gold',   price: 1,  address: '0xa7E88Ce1163e325Be877C54021da901A7DA8b170' },
  { id: 'cinnamon', name: 'Cinnamon', emoji: '🌿', kind: 'food', coin: 'gold',   price: 1,  address: '0x69a8d4AA5a9ee7965E583bC97288e2B325231b49' },
  { id: 'cod',      name: 'Cod',      emoji: '🐟', kind: 'food', coin: 'gold',   price: 5,  address: '0xCdb48Fbea782D46b95426A6791cE9E1d2DDA7559' },
  { id: 'jerky',    name: 'Jerky',    emoji: '🥩', kind: 'food', coin: 'gold',   price: 7,  address: '0xA34Ce4E86D00d63a847Ec122B7E94D94c2A0FCa0' },
  { id: 'ale',      name: 'Ale',      emoji: '🍺', kind: 'food', coin: 'gold',   price: 8,  address: '0x102817fd347c1A8117dDB4f5a9A6D6E363D360F7' },
  { id: 'pepper',   name: 'Pepper',   emoji: '🌶️', kind: 'food', coin: 'gold',   price: 30, address: '0x27A6c9B2D29A5f1716fc64D6c4913F8501099CC5' },
  { id: 'wine',     name: 'Wine',     emoji: '🍷', kind: 'food', coin: 'gold',   price: 40, address: '0x796Ac66a177f0e18aaCd53D3Ac91c3329A48a7d1' },
  { id: 'saffron',  name: 'Saffron',  emoji: '🌺', kind: 'food', coin: 'gold',   price: 65, address: '0xc5e642378D39C24a549a5d6e9C8848771bBa2932' },
  // ── gems (high-value trade goods, all gold-priced) ──
  { id: 'platinum', name: 'Platinum', emoji: '⚪', kind: 'gem', coin: 'gold', price: 10,    address: '0x6722ef27d1854E73269b0abE42290C000D3EfddA' },
  { id: 'amethyst', name: 'Amethyst', emoji: '🟣', kind: 'gem', coin: 'gold', price: 100,   address: '0xC5a9BC41936EF545DE210727FedCf8a43aEFa95F' },
  { id: 'ruby',     name: 'Ruby',     emoji: '🔴', kind: 'gem', coin: 'gold', price: 1000,  address: '0xE78023faFb55e61dC4d28D13F623e32fE9a3Fe6A' },
  { id: 'emerald',  name: 'Emerald',  emoji: '🟢', kind: 'gem', coin: 'gold', price: 1000,  address: '0x3220D7b78F0b3839248E624ed3c7c2c215389063' },
  { id: 'diamond',  name: 'Diamond',  emoji: '💎', kind: 'gem', coin: 'gold', price: 10000, address: '0x567c3EA4E2eB7fb0C55523162a248a5A25fD5Bb0' },
];
