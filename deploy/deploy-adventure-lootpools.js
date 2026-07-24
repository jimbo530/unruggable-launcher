#!/usr/bin/env node
/**
 * deploy-adventure-lootpools.js — DRY-PREP for the FOUR low-level adventure prize pools (numbered
 * pools 3-6 of the shared roll-chart prize system). Founder-approved 2026-06-27.
 *
 * Pools 1+2 (BILGE 0xE07CE9Ec…, GOBLIN 0xf917d166…) already exist + are stocked. These four are the
 * RATION + TRADE-GOOD heavy, COPPER + TIN tier low-level loot tables the roll charts draw from:
 *   3  COVE   Smuggler’s Cove   — cheap rations + light trade goods
 *   4  WRECK  Tidewater Wreck   — salvage: ore + ingots + coin
 *   5  CAVE   Coastal Cave      — forage + stone + coin
 *   6  ROAD   Old Coast Road    — rations + produce + coin
 *
 * EACH pool is the SAME canonical LootPool.sol pattern as Bilge/Goblin (admin = treasury, per-pawn
 * cooldown, addToken(token, bps), payout(collection, tokenId) pays floor(live balance × bps) of
 * EVERY stocked token to the winning pawn's owner). "Worth mostly copper and tin": the loot is
 * cheap goods (TIN ORE gold=0.05, COAL/COPPER/IRON ORE gold=0.5, SHALE gold=1, RICE/FLOUR/SALT/
 * RATIONS/CORN/WHEAT, COPPER coin) at SMALL bps — copper/tin-tier prizes, not gold.
 *
 * ⚠️ WHERE THIS RUNS: LootPool.sol lives in mftusd-build (NOT this repo). This script is the SINGLE
 * SOURCE OF TRUTH for the four loot tables (verified addresses + bps), authored here so it is
 * version-controlled with the roll-chart config it feeds. The COORDINATOR runs it FROM mftusd-build
 * (where the LootPool artifact + deployer wiring live) — set LOOTPOOL_ARTIFACT to the compiled
 * artifact path, or copy this file beside the existing bilge/goblin deploy script there. DRY by
 * default; it PRINTS the exact deploy + addToken plan and writes NOTHING until --execute.
 *
 * Real-or-nothing: every address below is VERIFIED against game/seas/commodity-tokens.csv (grep,
 * never hand-typed). No fake deploy — if the LootPool artifact isn't found, DRY still prints the
 * full plan and --execute REFUSES with a clear reason.
 *
 *   node deploy/deploy-adventure-lootpools.js              # DRY: print the deploy + seeding plan
 *   node deploy/deploy-adventure-lootpools.js --execute     # LIVE (coordinator, from mftusd-build)
 *
 * On --execute it writes deploy/adventure-lootpools-deployed.json with the four pool addresses; the
 * coordinator then back-fills POOLS[3..6].address in game/seas/roll-charts.js so the server can fire.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const EXECUTE = process.argv.includes('--execute');
const TREASURY = '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10';   // LootPool admin (agent treasury)
const OUT = path.join(__dirname, 'adventure-lootpools-deployed.json');

// ── VERIFIED cheap-goods addresses (grep-checked vs game/seas/commodity-tokens.csv 2026-06-28) ──
// COIN
const COPPER  = '0x0197896c617f20d61E73E06eC8b2A95eef176bee'; // Copper Coin
// TIN tier (cheapest good we hold — there is NO standalone "TIN coin"; TIN ORE is the tin-tier good)
const TINORE  = '0x2E8c7Be3bcbc11355ef24FE9c09feC0B9d650783'; // Tin Ore     gold=0.05  (cheapest)
// other copper-tier ore/stone
const COAL    = '0x2032BA002545070e7F0fC5992fAA8340308103B6'; // Coal        gold=0.5
const COPRORE = '0x84dc8489f5A913Ecc7d68C3D9adf0459051A28f0'; // Copper Ore  gold=0.5
const IRONORE = '0x9F60E86fF29bbB88fE1b3eCD5259202430cbF148'; // Iron Ore    gold=0.5
const SHALE   = '0x6171B2039199786750b24021c04400FDb8c07793'; // Shale       gold=1
const IRONING = '0xCe5f43a5104708740CE087CF2AF3c1A328badF5b'; // Iron Ingot  gold=1
// cheap rations / food
const RICE    = '0x00e466Fb90C8eF2e7BA1AA662a7c79C595906041'; // Rice
const FLOUR   = '0x111c5a52C3e631bf43e2e44DB001F08d20a9Ee73'; // Flour
const SALT    = '0xdDCB77AA553718ACc88aA61ba1514EE267Cc6825'; // Salt        1 cp
const RATIONS = '0x0867653716D37DC9F13c5347A8Ca8fFF6CA95926'; // Rations     5 sp
// cheap produce / forage
const CORN    = '0x01ebBdc30A6a173f145dC95e68151fb5A904Fa4C'; // Corn        food=1
const WHEAT   = '0x969b59Dc55167450B2D5d9dEcf81bc857e4f2604'; // Wheat       food=1
const BLKBRY  = '0x16C3ac67a9B739376D5fDCAF44D5Ba825579CD8b'; // Blackberry  food=1
const BLUBRY  = '0x8874085006b89541fbbe69cF2F4B63c66051434C'; // Blueberry   food=1

const COOLDOWN_SECS = 3600; // per-pawn, mirrors Bilge/Goblin (the SERVER roll-chart kinds also cool)

/**
 * The FOUR loot tables. Each token line: { sym, token, bps }. bps is OUT OF 10_000 (1% = 100 bps),
 * the SAME basis Bilge/Goblin use. LootPool.payout pays floor(live balance × bps/1e4) of each token,
 * so bps × the refilled balance sets the prize size. COPPER/TIN-tier goods at modest bps = small,
 * copper/tin-worth prizes. The water keeper (loot-refill-keeper.js) refills these from yield.
 */
const POOLS = [
  { n: 3, key: 'cove',  name: 'Smuggler’s Cove', cooldownSecs: COOLDOWN_SECS, loot: [
    { sym: 'COPPER',  token: COPPER,  bps: 100 },  // 1% copper floor (like Bilge)
    { sym: 'TINORE',  token: TINORE,  bps: 100 },  // tin-tier
    { sym: 'SALT',    token: SALT,    bps: 100 },
    { sym: 'RATIONS', token: RATIONS, bps: 100 },
    { sym: 'RICE',    token: RICE,    bps: 100 },
  ]},
  { n: 4, key: 'wreck', name: 'Tidewater Wreck', cooldownSecs: COOLDOWN_SECS, loot: [
    { sym: 'COPPER',  token: COPPER,  bps: 100 },
    { sym: 'TINORE',  token: TINORE,  bps: 100 },
    { sym: 'COPRORE', token: COPRORE, bps: 100 },
    { sym: 'IRONORE', token: IRONORE, bps: 100 },
    { sym: 'IRONING', token: IRONING, bps: 50 },   // ingot slightly rarer
  ]},
  { n: 5, key: 'cave',  name: 'Coastal Cave', cooldownSecs: COOLDOWN_SECS, loot: [
    { sym: 'COPPER',  token: COPPER,  bps: 100 },
    { sym: 'TINORE',  token: TINORE,  bps: 100 },
    { sym: 'COAL',    token: COAL,    bps: 100 },
    { sym: 'SHALE',   token: SHALE,   bps: 100 },
    { sym: 'BLKBRY',  token: BLKBRY,  bps: 100 },
    { sym: 'BLUBRY',  token: BLUBRY,  bps: 100 },
  ]},
  { n: 6, key: 'road',  name: 'Old Coast Road', cooldownSecs: COOLDOWN_SECS, loot: [
    { sym: 'COPPER',  token: COPPER,  bps: 100 },
    { sym: 'TINORE',  token: TINORE,  bps: 100 },
    { sym: 'FLOUR',   token: FLOUR,   bps: 100 },
    { sym: 'CORN',    token: CORN,    bps: 100 },
    { sym: 'WHEAT',   token: WHEAT,   bps: 100 },
  ]},
];

/** Load the compiled LootPool artifact (abi + bytecode) for an actual deploy. mftusd-build path. */
function loadLootPoolArtifact() {
  const candidates = [
    process.env.LOOTPOOL_ARTIFACT,                                   // explicit override (coordinator sets this)
    path.join(__dirname, '..', '..', 'mftusd-build', 'artifacts', 'LootPool.sol', 'LootPool.json'),
    path.join(__dirname, '..', '..', 'mftusd-build', 'artifacts', 'contracts', 'LootPool.sol', 'LootPool.json'),
    path.join(__dirname, '..', '..', 'mftusd-build', 'out', 'LootPool.sol', 'LootPool.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const abi = j.abi || (j.metadata && JSON.parse(j.metadata).output.abi);
      const bytecode = j.bytecode && j.bytecode.object ? j.bytecode.object : j.bytecode;
      if (abi && bytecode) return { abi, bytecode, path: p };
    }
  }
  return null;
}

function printPlan() {
  console.log('=== ADVENTURE LOOTPOOLS (numbered pools 3-6) — DEPLOY PLAN ===');
  console.log(`  admin (treasury): ${TREASURY}`);
  console.log(`  per-pawn cooldown: ${COOLDOWN_SECS}s  | bps basis: out of 10_000 (1% = 100)`);
  for (const p of POOLS) {
    console.log(`\n  POOL ${p.n}  ${p.name}  (key=${p.key})`);
    console.log(`    1) DEPLOY LootPool(admin=${TREASURY})`);
    for (const l of p.loot) {
      console.log(`    2) addToken(${l.sym.padEnd(8)} ${l.token}, ${String(l.bps).padStart(4)} bps)`);
    }
    console.log(`    3) SEED: transfer cheap ${p.loot.map((l) => l.sym).join('/')} the treasury holds → the pool`);
    console.log(`             (LootPool reads live balance × bps; a plain transfer stocks it — and the`);
    console.log(`              loot-refill-keeper.js water loop tops it up from yield thereafter).`);
  }
  console.log('\n  After --execute: writes', OUT, 'and the coordinator back-fills POOLS[3..6].address');
  console.log('  in game/seas/roll-charts.js so the server can fire these pools.');
}

async function main() {
  printPlan();
  const art = loadLootPoolArtifact();
  console.log('\n  LootPool artifact:', art ? `FOUND ${art.path}` : 'NOT FOUND in mftusd-build (set LOOTPOOL_ARTIFACT)');

  if (!EXECUTE) {
    console.log('\n  DRY RUN — nothing deployed, nothing moved. Re-run with --execute FROM mftusd-build');
    console.log('  (coordinator only; peg-onehop paused; verify the cheap-goods treasury balances first).');
    return;
  }

  // ---- LIVE (COORDINATOR ONLY, FROM mftusd-build) ----
  if (!art) throw new Error('LootPool artifact not found — run this FROM mftusd-build (LootPool.sol lives there) or set LOOTPOOL_ARTIFACT. NOT faking a deploy.');
  const { ethers } = require('ethers');
  require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
  const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
  if (!PRIVATE_KEY) throw new Error('no AGENT_PRIVATE_KEY — cannot deploy');
  const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
  const FEES = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  if (wallet.address.toLowerCase() !== TREASURY.toLowerCase()) {
    throw new Error(`deployer ${wallet.address} != treasury ${TREASURY} — refusing (admin must be the treasury)`);
  }
  const ERC20 = ['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'];
  const LOOT = ['function addToken(address,uint256)'];

  // resume-safe: keep any pools already deployed in a prior run.
  const record = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { pools: {} };
  let nonce = await provider.getTransactionCount(wallet.address, 'pending');

  for (const p of POOLS) {
    if (record.pools[p.n] && record.pools[p.n].address) { console.log(`  pool ${p.n} already deployed at ${record.pools[p.n].address} — skipping deploy`); continue; }
    const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
    // LootPool constructor is (string _label, uint256 _cooldown); admin = msg.sender (= TREASURY deployer).
    const c = await factory.deploy(p.name, BigInt(p.cooldownSecs), { ...FEES, nonce: nonce++ });
    await c.waitForDeployment();
    const addr = await c.getAddress();
    console.log(`  POOL ${p.n} ${p.name} deployed: ${addr}`);
    const lp = new ethers.Contract(addr, LOOT, wallet);
    for (const l of p.loot) {
      const tx = await lp.addToken(l.token, BigInt(l.bps), { ...FEES, nonce: nonce++ }); await tx.wait();
      console.log(`    addToken ${l.sym} ${l.bps}bps:`, tx.hash);
    }
    record.pools[p.n] = { n: p.n, key: p.key, name: p.name, address: addr, admin: TREASURY, cooldownSecs: p.cooldownSecs, loot: p.loot };
    fs.writeFileSync(OUT, JSON.stringify(record, null, 2));
  }
  console.log('\n  DEPLOYED. Now SEED each pool by transferring the cheap goods the treasury holds (separate, deliberate step),');
  console.log('  then back-fill POOLS[3..6].address in game/seas/roll-charts.js + wire the water keeper RESOURCES for these goods.');
}

main().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });

module.exports = { POOLS, TREASURY }; // re-used by loot-refill-keeper wiring + roll-charts back-fill
