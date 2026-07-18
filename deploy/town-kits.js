// town-kits.js — the TOWN SIZE TEMPLATES for droppable Seas markets (data only, no I/O).
// Four sizes; each larger size = the smaller one + more shelves. Prices are the SAME
// Port Royal / D&D book prices already live on-chain (commodity-tokens.csv is the source
// of truth these rows were copied from — never retype an address anywhere else).
//
// Depth scales with size (units of the good per pool; coin side = units * price):
// a hamlet's shelves are thin and swing hard, a city's are deep and steady.
// maxSwapIn caps one bite so a thin pool can't be one-shot drained (V1 port precedent).

const COIN = {
  copper: '0x0197896c617f20d61E73E06eC8b2A95eef176bee',
  silver: '0x36cF0ceDEee07b14C496f77C61d010268c31E0e9',
  gold:   '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004',
};

// good id → { addr, coin, price } (price in that coin's units, from the on-chain book)
const GOODS = {
  // staples (every settlement)
  salt:          { addr: '0xdDCB77AA553718ACc88aA61ba1514EE267Cc6825', coin: 'copper', price: 1 },
  apple:         { addr: '0xa7E88Ce1163e325Be877C54021da901A7DA8b170', coin: 'gold',   price: 1 },
  rations:       { addr: '0x0867653716D37DC9F13c5347A8Ca8fFF6CA95926', coin: 'silver', price: 5 },
  ale:           { addr: '0x102817fd347c1A8117dDB4f5a9A6D6E363D360F7', coin: 'gold',   price: 8 },
  logs:          { addr: '0xD8DA82E017bf28C261Aa2d6Be6f62C6283683D08', coin: 'gold',   price: 1 },
  // village shelves
  honey:         { addr: '0x92Cf60b74BD16aAb42f2C249e72E9860e83A765f', coin: 'silver', price: 1 },
  fish:          { addr: '0x907D043d33A243cd9818d6e2ccd5b3C9ef9905B5', coin: 'gold',   price: 1 },
  lumber:        { addr: '0x7a97e5e76C93267e1FF2EBc38DCC7C7B6f40fF4c', coin: 'gold',   price: 5 },
  'spear-iron':  { addr: '0xe9B1e898b3233c949f4b6D96Cc6ae44eCfA9ec0f', coin: 'gold',   price: 2 },
  // town shelves
  jerky:         { addr: '0xA34Ce4E86D00d63a847Ec122B7E94D94c2A0FCa0', coin: 'gold',   price: 7 },
  wine:          { addr: '0x796Ac66a177f0e18aaCd53D3Ac91c3329A48a7d1', coin: 'gold',   price: 40 },
  'iron-ingot':  { addr: '0xCe5f43a5104708740CE087CF2AF3c1A328badF5b', coin: 'gold',   price: 1 },
  'sword-iron':  { addr: '0xbe0536caE25eaD6473bFc861A9975Af4710Aa655', coin: 'gold',   price: 15 },
  'healpot-s':   { addr: '0x888CC7e77D5CaEEa293800Ca1f1cbC912a074770', coin: 'gold',   price: 2 },
  // city shelves
  pepper:        { addr: '0x27A6c9B2D29A5f1716fc64D6c4913F8501099CC5', coin: 'gold',   price: 30 },
  saffron:       { addr: '0xc5e642378D39C24a549a5d6e9C8848771bBa2932', coin: 'gold',   price: 65 },
  'sword-steel': { addr: '0x48a0d4D9Fa81Bb699c0Cd7A21502dF346835C4DE', coin: 'gold',   price: 60 },
  'shield-steel':{ addr: '0x2608424B1e548B81Bc56533C816125d08f6713B3', coin: 'gold',   price: 80 },
  'chain-shirt': { addr: '0xF18e361015a2EaC801F4A1b50B2bDbD31e611740', coin: 'gold',   price: 100 },
  'healpot-m':   { addr: '0x7861ac3D4F120DCC8188B97854B02C61b8500E38', coin: 'gold',   price: 5 },
};

const HAMLET  = ['salt', 'apple', 'rations', 'ale', 'logs'];
const VILLAGE = [...HAMLET, 'honey', 'fish', 'lumber', 'spear-iron'];
const TOWN    = [...VILLAGE, 'jerky', 'wine', 'iron-ingot', 'sword-iron', 'healpot-s'];
const CITY    = [...TOWN, 'pepper', 'saffron', 'sword-steel', 'shield-steel', 'chain-shirt', 'healpot-m'];

// units of the good seeded per pool + one-swap bite cap (both in whole units; 18 dec on-chain)
const SIZES = {
  hamlet:  { goods: HAMLET,  units: 250,  maxSwapIn: 50  },
  village: { goods: VILLAGE, units: 500,  maxSwapIn: 100 },
  town:    { goods: TOWN,    units: 1000, maxSwapIn: 200 },
  city:    { goods: CITY,    units: 2500, maxSwapIn: 500 },
};

const FEE_BPS = 30;      // 0.30% — same as the live V1 port pools
const COOLDOWN = 0;      // pace via maxSwapIn (V1 port precedent)
const KIT_BASE = 9_000_000; // must match LocationLPFactoryV2.KIT_BASE

module.exports = { COIN, GOODS, SIZES, FEE_BPS, COOLDOWN, KIT_BASE };
