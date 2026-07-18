// @ts-check
// gear-tokens.js — gear ERC20s with a LIVE Port Royal GOLD wall (buyable on-chain in the store).
// AUTO-GENERATED from deploy/port-royal-walls-deployed.json. id matches the armory id; gold = wall price.
// Items not listed have no wall yet (store falls back to beta off-chain add).
export const GEAR_TOKENS = {
  "battleaxe-wooden": { address: "0x85ef6781508775cF1BC7AF4d5a2459e2C32918B3", gold: 5 },
  "club-wooden": { address: "0x47CCe4872F4b8F740CBB10d7d7Cf2f882D56BF6A", gold: 1 },
  "dagger-wooden": { address: "0xB8Ad33a435401ACb73814af77D9796cceC2bAa6E", gold: 1 },
  "dart-wooden": { address: "0x48d4ae81435e699Ed22C697516c1C61F3505b192", gold: 1 },
  "flail-wooden": { address: "0xE9c29631488a98eFEbE75BaAE3b23Df7308c8EF0", gold: 4 },
  "glaive-wooden": { address: "0xA1e7616F3F883777c083bd08ccacb8c540f48E15", gold: 4 },
  "greatclub-wooden": { address: "0x8AEAc0dF15Ad651B444F0F8C02Ff8D15a0bfBB75", gold: 3 },
  "handaxe-wooden": { address: "0xC03FAC7e8cd622883EB60dDcD6BaC344bF819Af1", gold: 3 },
  "javelin-wooden": { address: "0x2d81bC23a528f27d99033eE272cD0c5179C92870", gold: 1 },
  "light-hammer-wooden": { address: "0x97eba3dbCd862DC0e7e114baE6902d8b85EcbcBC", gold: 1 },
  "pike-wooden": { address: "0x9a926c027f0691A6d64109A62D8466868d29E59b", gold: 3 },
  "quarterstaff-wooden": { address: "0x022c59520F2a28656FBB2B24839770106d993A68", gold: 1 },
  "shield-bronze": { address: "0x52d27347A685De67dF190D14bc4D796016Fb738D", gold: 40 },
  "shield-iron": { address: "0x68502de98506Ec34ce662854844F196750Ccf283", gold: 20 },
  "shield-steel": { address: "0x2608424B1e548B81Bc56533C816125d08f6713B3", gold: 80 },
  "shield-wooden": { address: "0xa5FE49a0E5967F660Cc79E85ba286c70835c9E3F", gold: 10 },
  "shortsword-wooden": { address: "0x8456b1Bf9c044E708b1cc7EF5b33f3D5f1c857b9", gold: 5 },
  "sickle-wooden": { address: "0xA76e4915b133C5295196287E328D8e0C8a3EEf77", gold: 3 },
  "sling-wooden": { address: "0x2270AfC1e62c189CBfc68BD9785ca4037EC66557", gold: 1 },
  "spear-bronze": { address: "0x2806286DD33379a7817075E791d396C972AC9628", gold: 4 },
  "spear-iron": { address: "0xe9B1e898b3233c949f4b6D96Cc6ae44eCfA9ec0f", gold: 2 },
  "spear-steel": { address: "0x56EC69B3BC57C8C5BF0F7a50da34555D0C40B85A", gold: 8 },
  "spear-wooden": { address: "0x1f6570373Fd475Dd55bad6Bf184d140f66212f2C", gold: 1 },
  "sword-bronze": { address: "0xeE5788B20ed6fC9B0D95236C60949748320A2E78", gold: 30 },
  "sword-iron": { address: "0xbe0536caE25eaD6473bFc861A9975Af4710Aa655", gold: 15 },
  "sword-steel": { address: "0x48a0d4D9Fa81Bb699c0Cd7A21502dF346835C4DE", gold: 60 },
  "sword-wooden": { address: "0xd44e0DB7AB7c26A1a13759C009DC20F4Ebf13aBf", gold: 7.5 },
};

/** Is this armory item backed by an on-chain token + wall? */
export const isTokenized = (id) => Object.prototype.hasOwnProperty.call(GEAR_TOKENS, id);
