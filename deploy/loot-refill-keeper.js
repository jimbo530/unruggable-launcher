#!/usr/bin/env node
/**
 * loot-refill-keeper.js — the PRIZE-WATER keeper: turn each prize-water's Aave yield into a
 * REFILL of its combat LootPool, so claiming a prize gets refunded over time (self-funding prizes).
 * Founder 2026-06-27: "every reward good gets its OWN funding water, routed to refill the prize pools."
 *
 * Mirrors the PROVEN ocean-water-keeper.js (RESOURCES registry, real-or-nothing, exact approvals).
 * The ONE difference: instead of INJECTING into a market LP, the bought good is TRANSFERRED to the
 * good's LootPool (LootPool.sol reads its live balance per-token BPS, so a plain transfer refills it —
 * no fund() call needed). Uniform per good:
 *
 *   (1) prize-water (WaterV2 payout=GOLD) holds USDC principal -> Aave YIELD.
 *   (2) harvest() -> 50% grows the water (compounds), 50% Money->GOLD on the fee-100 wall; claim to keeper.
 *   (3) BUY the good with that GOLD at the good's BUY VENUE (a Port Royal-style gated LocationPool,
 *       gold->good or copper->good; keeper self-attests presence with the seas location signer).
 *   (4) TRANSFER the bought good to the good's LootPool (Bilge or Goblin) -> refills the prize.
 *   LOOP: yield -> GOLD -> buy good -> top up LootPool. The yield fuels it; NO free treasury goods.
 *
 * ⚠️ BUY-ROUTE REALITY (on-chain scan 2026-06-27, base): MOST goods have NO buy wall yet. The keeper
 * REFUSES to fake a buy (chain-is-truth). Each RESOURCES entry carries routeStatus:
 *    'LIVE'        — a buy venue exists; the full loop runs.
 *    'MISSING_WALL'— no Money/good, GOLD/good, or Port Royal good wall exists. The keeper HARVESTS +
 *                    CLAIMS GOLD (still grows the endowment) but STOPS before the buy, logging that a
 *                    wall must be deployed (deploy-port-royal-goods-style) before this good can refill.
 * Current scan: SALT has a Port Royal SALT/COPPER wall; AMETHYST has a Port Royal AMETHYST/GOLD wall;
 * EVERY OTHER good (RATIONS HONEY APPLE CINNAMON COD ALE JERKY EMERALD RICE FLOUR PORK) = MISSING_WALL.
 * (COPPER itself uses the existing COPPERw water + COPPER/Money wall — routed by wire-copper-to-loot.)
 *
 *   node deploy/loot-refill-keeper.js status [good]                — read-only: yield/gold/route/pool bal
 *   node deploy/loot-refill-keeper.js run [good] [--usd N]         — DRY the full loop (default)
 *   BASE_RPC=<alchemy> node deploy/loot-refill-keeper.js run [good] [--usd N] --execute
 *                                                                  — LIVE (coordinator; peg paused)
 *
 * Real-or-nothing: every leg throws loudly; nothing faked. Exact approvals, 1-tx-at-a-time, 0.15 gwei.
 * DRY by default; --execute broadcasts (coordinator only).
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });

// seas location signer (gates LocationPool swaps; lives on the VPS). Surfaced at run time if missing.
let signSwap = null;
try { ({ signSwap } = require(path.join(__dirname, '..', 'game', 'server', 'location-signer.cjs'))); }
catch (e) { /* needed only for a LIVE gated buy */ }

const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const ONE = 10n ** 18n;

// ── Verified addresses (grep-checked vs commodity-tokens.csv / *-deployed.json) ──
const GOLD     = '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004';
const COPPER   = '0x0197896c617f20d61E73E06eC8b2A95eef176bee';
const GOLD_USD = 0.01;
const SLIP_BPS = 200n;
const FEES = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };

const MFTUSD = path.join(__dirname, '..', '..', 'mftusd-build');
const HOLDER_REC = path.join(MFTUSD, 'system-water-holder-deployed.json');   // collection + seat map
const recFor = (sym) => path.join(MFTUSD, 'waterv2-' + (sym + 'w').toLowerCase() + '-deployment.json');

// Numbered shared prize pools (roll-chart system). 1+2 LIVE; 3-6 = the low-level adventure pools
// deployed by deploy-adventure-lootpools.js. Their addresses are READ from that deploy record so we
// NEVER hand-type them — null until the coordinator deploys (the keeper then skips an unborn pool).
const ADV_DEPLOY_JSON = path.join(__dirname, 'adventure-lootpools-deployed.json');
function advPool(n) {
  if (!fs.existsSync(ADV_DEPLOY_JSON)) return null;
  try { const j = JSON.parse(fs.readFileSync(ADV_DEPLOY_JSON, 'utf8')); const e = j.pools && j.pools[n]; return e && e.address ? e.address : null; }
  catch (e) { throw new Error(`corrupt ${ADV_DEPLOY_JSON}: ${e.message}`); } // no silent catch
}
const LOOTPOOL = {
  BILGE:  '0xE07CE9Ec642d42C5c8A0068203068BAc6042bF57',
  GOBLIN: '0xf917d1660c72F2D48141a965c82CCBE8a2A175A6',
  COVE:   advPool(3), // pool 3 Smuggler’s Cove  (null until deployed)
  WRECK:  advPool(4), // pool 4 Tidewater Wreck
  CAVE:   advPool(5), // pool 5 Coastal Cave
  ROAD:   advPool(6), // pool 6 Old Coast Road
};

/**
 * RESOURCES — one entry per prize good. waterRec = its WaterV2 (yield->GOLD). lootPool = where the
 * bought good is sent. buy = how the keeper acquires the good with GOLD/COPPER (a gated LocationPool).
 * routeStatus 'LIVE' = buy venue verified on-chain; 'MISSING_WALL' = harvest+claim only until a wall ships.
 *
 * To FLIP a good to LIVE: deploy its buy wall (Port Royal good/COPPER or good/GOLD LocationPool, same
 * pattern as the fish wall / rice-flour walls), set buy.{pool,loc,quoteToken}, and routeStatus:'LIVE'.
 */
const RESOURCES = {
  // ---- COPPER FLOOR: the EXISTING COPPERw water (payout = COPPER itself) funds the copper floor in
  //      BOTH pools. No buy needed (payout IS copper). The keeper claims COPPER to the treasury then
  //      SPLITS it (transfer) to Bilge + Goblin. Special kind:'coin-split'. Uses COPPERw's own tree
  //      (Harbor Guard #0, pre-existing) — NOT a holder seat. Founder: "DON'T redeploy COPPER; ROUTE it."
  copper: {
    label: 'COPPER', token: COPPER, routeStatus: 'LIVE', kind: 'coin-split',
    waterVault: '0x0749c5107091F153a9f3950FC63d5B96Df04528B',         // existing COPPERw (payout=COPPER)
    waterTreeNft: '0x8C1f935F6DbB17d593BF3EC8114A2f045e350545',       // Harbor Guard crew (COPPERw tree NFT)
    waterTreeId: 0,                                                    // SEED_ID 0 (seed-coin-waters.cjs)
    // copper floor in EVERY deployed pool (Bilge+Goblin always; adventure pools 3-6 once deployed —
    // filtered to non-null so an unborn pool is never targeted). The split divides COPPER evenly.
    splitPools: [LOOTPOOL.BILGE, LOOTPOOL.GOBLIN, LOOTPOOL.COVE, LOOTPOOL.WRECK, LOOTPOOL.CAVE, LOOTPOOL.ROAD].filter(Boolean),
  },

  // ---- LIVE (a GOLD-quoted buy wall exists on-chain → keeper's GOLD buys it directly) ----
  amethyst: {
    label: 'AMETHYST', token: '0xC5a9BC41936EF545DE210727FedCf8a43aEFa95F', lootPool: LOOTPOOL.BILGE, jackpot: true,
    routeStatus: 'LIVE',
    // Port Royal AMETHYST/GOLD LocationPool (confirmed via LocationLPFactory.getPool(8003, AMETHYST, GOLD)).
    buy: { kind: 'location', loc: 8003, quoteToken: GOLD, quoteSym: 'GOLD' },
  },

  // ---- WALL_WRONG_QUOTE: a wall exists but it's COPPER-quoted; keeper holds GOLD. NOT directly
  //      buyable until a GOLD->COPPER hop is wired OR a GOLD-quoted SALT wall ships. Treated as not-LIVE. ----
  salt: {
    label: 'SALT', token: '0xdDCB77AA553718ACc88aA61ba1514EE267Cc6825', lootPool: LOOTPOOL.BILGE,
    routeStatus: 'WALL_WRONG_QUOTE',
    // Port Royal SALT/COPPER LocationPool exists (confirmed) but is COPPER-quoted.
    buy: { kind: 'location', loc: 8003, quoteToken: COPPER, quoteSym: 'COPPER',
           note: 'SALT/COPPER wall exists but keeper holds GOLD → needs GOLD->COPPER hop or a GOLD-quoted SALT wall before LIVE.' },
  },

  // ---- MISSING_WALL (no Money/good, GOLD/good, or Port Royal good wall on-chain 2026-06-27) ----
  rations:  { label: 'RATIONS',  token: '0x0867653716D37DC9F13c5347A8Ca8fFF6CA95926', lootPool: LOOTPOOL.BILGE,  routeStatus: 'MISSING_WALL' },
  honey:    { label: 'HONEY',    token: '0x92Cf60b74BD16aAb42f2C249e72E9860e83A765f', lootPool: LOOTPOOL.BILGE,  routeStatus: 'MISSING_WALL' },
  apple:    { label: 'APPLE',    token: '0xa7E88Ce1163e325Be877C54021da901A7DA8b170', lootPool: LOOTPOOL.BILGE,  routeStatus: 'MISSING_WALL' },
  cinnamon: { label: 'CINNAMON', token: '0x69a8d4AA5a9ee7965E583bC97288e2B325231b49', lootPool: LOOTPOOL.BILGE,  routeStatus: 'MISSING_WALL' },
  cod:      { label: 'COD',      token: '0xCdb48Fbea782D46b95426A6791cE9E1d2DDA7559', lootPool: LOOTPOOL.BILGE,  routeStatus: 'MISSING_WALL' },
  ale:      { label: 'ALE',      token: '0x102817fd347c1A8117dDB4f5a9A6D6E363D360F7', lootPool: LOOTPOOL.BILGE,  routeStatus: 'MISSING_WALL' },
  jerky:    { label: 'JERKY',    token: '0xA34Ce4E86D00d63a847Ec122B7E94D94c2A0FCa0', lootPool: LOOTPOOL.BILGE,  routeStatus: 'MISSING_WALL' },
  emerald:  { label: 'EMERALD',  token: '0x3220D7b78F0b3839248E624ed3c7c2c215389063', lootPool: LOOTPOOL.BILGE,  routeStatus: 'MISSING_WALL', jackpot: true },
  rice:     { label: 'RICE',     token: '0x00e466Fb90C8eF2e7BA1AA662a7c79C595906041', lootPool: LOOTPOOL.GOBLIN, routeStatus: 'MISSING_WALL' },
  flour:    { label: 'FLOUR',    token: '0x111c5a52C3e631bf43e2e44DB001F08d20a9Ee73', lootPool: LOOTPOOL.GOBLIN, routeStatus: 'MISSING_WALL' },
  pork:     { label: 'PORK',     token: '0x676d5a1C8438A9955bbA636e496aebddA4c49a2D', lootPool: LOOTPOOL.GOBLIN, routeStatus: 'MISSING_WALL' },

  // ── ADVENTURE POOLS 3-6 (low-level, copper/tin tier). COPPER floor handled by the coin-split above;
  //    these are the per-good waters (one GOLD-payout WaterV2 each on a SystemWaterHolder seat, same as
  //    the bilge/goblin goods). lootPool reads the deploy record (advPool) — pool:null means the pool is
  //    not deployed yet, so the keeper SKIPS it (never refills an unborn pool). All MISSING_WALL: these
  //    cheap goods have no GOLD-quoted buy wall yet (founder accepts: keeper harvests+grows the endowment
  //    and STOPS before a fake buy until a wall ships, exactly like the bilge/goblin food goods). ──
  // POOL 3 COVE
  cove_tinore:  { label: 'TINORE',  token: '0x2E8c7Be3bcbc11355ef24FE9c09feC0B9d650783', lootPool: LOOTPOOL.COVE,  routeStatus: 'MISSING_WALL' },
  cove_salt:    { label: 'SALT',    token: '0xdDCB77AA553718ACc88aA61ba1514EE267Cc6825', lootPool: LOOTPOOL.COVE,  routeStatus: 'MISSING_WALL' },
  cove_rations: { label: 'RATIONS', token: '0x0867653716D37DC9F13c5347A8Ca8fFF6CA95926', lootPool: LOOTPOOL.COVE,  routeStatus: 'MISSING_WALL' },
  cove_rice:    { label: 'RICE',    token: '0x00e466Fb90C8eF2e7BA1AA662a7c79C595906041', lootPool: LOOTPOOL.COVE,  routeStatus: 'MISSING_WALL' },
  // POOL 4 WRECK
  wreck_tinore: { label: 'TINORE',  token: '0x2E8c7Be3bcbc11355ef24FE9c09feC0B9d650783', lootPool: LOOTPOOL.WRECK, routeStatus: 'MISSING_WALL' },
  wreck_coprore:{ label: 'COPRORE', token: '0x84dc8489f5A913Ecc7d68C3D9adf0459051A28f0', lootPool: LOOTPOOL.WRECK, routeStatus: 'MISSING_WALL' },
  wreck_ironore:{ label: 'IRONORE', token: '0x9F60E86fF29bbB88fE1b3eCD5259202430cbF148', lootPool: LOOTPOOL.WRECK, routeStatus: 'MISSING_WALL' },
  wreck_ironing:{ label: 'IRONING', token: '0xCe5f43a5104708740CE087CF2AF3c1A328badF5b', lootPool: LOOTPOOL.WRECK, routeStatus: 'MISSING_WALL' },
  // POOL 5 CAVE
  cave_tinore:  { label: 'TINORE',  token: '0x2E8c7Be3bcbc11355ef24FE9c09feC0B9d650783', lootPool: LOOTPOOL.CAVE,  routeStatus: 'MISSING_WALL' },
  cave_coal:    { label: 'COAL',    token: '0x2032BA002545070e7F0fC5992fAA8340308103B6', lootPool: LOOTPOOL.CAVE,  routeStatus: 'MISSING_WALL' },
  cave_shale:   { label: 'SHALE',   token: '0x6171B2039199786750b24021c04400FDb8c07793', lootPool: LOOTPOOL.CAVE,  routeStatus: 'MISSING_WALL' },
  cave_blkbry:  { label: 'BLKBRY',  token: '0x16C3ac67a9B739376D5fDCAF44D5Ba825579CD8b', lootPool: LOOTPOOL.CAVE,  routeStatus: 'MISSING_WALL' },
  cave_blubry:  { label: 'BLUBRY',  token: '0x8874085006b89541fbbe69cF2F4B63c66051434C', lootPool: LOOTPOOL.CAVE,  routeStatus: 'MISSING_WALL' },
  // POOL 6 ROAD
  road_tinore:  { label: 'TINORE',  token: '0x2E8c7Be3bcbc11355ef24FE9c09feC0B9d650783', lootPool: LOOTPOOL.ROAD,  routeStatus: 'MISSING_WALL' },
  road_flour:   { label: 'FLOUR',   token: '0x111c5a52C3e631bf43e2e44DB001F08d20a9Ee73', lootPool: LOOTPOOL.ROAD,  routeStatus: 'MISSING_WALL' },
  road_corn:    { label: 'CORN',    token: '0x01ebBdc30A6a173f145dC95e68151fb5A904Fa4C', lootPool: LOOTPOOL.ROAD,  routeStatus: 'MISSING_WALL' },
  road_wheat:   { label: 'WHEAT',   token: '0x969b59Dc55167450B2D5d9dEcf81bc857e4f2604', lootPool: LOOTPOOL.ROAD,  routeStatus: 'MISSING_WALL' },
};

const WATERV2_ABI = [
  'function pendingYield() view returns (uint256)',
  'function totalBacking() view returns (uint256)',
  'function treeIdFor(address,uint256) view returns (uint256)',
  'function pendingPayout(uint256) view returns (uint256)',
  'function harvest(uint256 minPayoutOut)',
  'function claimPayout(uint256 treeId)',
];
const LOCPOOL_ABI = [
  'function token0() view returns (address)',
  'function location() view returns (uint256)',
  'function maxSwapIn() view returns (uint256)',
  'function open() view returns (bool)',
  'function quote(bool,uint256) view returns (uint256)',
  'function swap(bool,uint256,uint256,uint256,bytes) returns (uint256)',
];
const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
];
const LOCF_ABI = ['function getPool(uint256,address,address) view returns (address)'];
const LOC_FACTORY = '0x54868729015F0050B364729454a018f1FF7a2d01';
const HOLDER_ABI = ['function ownerOf(uint256) view returns (address)'];

const human = (wei, d = 18) => Number(ethers.formatUnits(wei, d));
function loadJson(p, what) { if (!fs.existsSync(p)) throw new Error(`${what} missing at ${p}`); return JSON.parse(fs.readFileSync(p, 'utf8')); }
function resolve(key) { const r = RESOURCES[(key || '').toLowerCase()]; if (!r) throw new Error(`unknown good "${key}" — known: ${Object.keys(RESOURCES).join(', ')}`); return r; }

/** Resolve the buy LocationPool address for a LIVE route (verifies the wall actually exists). */
async function resolveBuyPool(provider, R) {
  if (!R.buy || R.buy.kind !== 'location') throw new Error(`${R.label}: no location buy config`);
  const f = new ethers.Contract(LOC_FACTORY, LOCF_ABI, provider);
  const pool = await f.getPool(BigInt(R.buy.loc), R.token, R.buy.quoteToken);
  if (pool === ethers.ZeroAddress) throw new Error(`${R.label}: buy wall ${R.token}/${R.buy.quoteSym} @ loc ${R.buy.loc} does NOT exist on-chain — routeStatus is wrong or wall not deployed`);
  return pool;
}

/**
 * COPPER coin-split: COPPERw payout IS COPPER. Harvest+claim COPPER to the treasury, then SPLIT it
 * evenly (transfer) to every pool in R.splitPools (Bilge + Goblin copper floor). No buy. Real-or-nothing.
 */
async function runCoinSplit(provider, R, cmd, EXECUTE) {
  const vault = new ethers.Contract(R.waterVault, WATERV2_ABI, provider);
  const copper = new ethers.Contract(R.token, ERC20_ABI, provider);
  const [py, backing] = await Promise.all([vault.pendingYield(), vault.totalBacking()]);
  const treeP1 = await vault.treeIdFor(R.waterTreeNft, BigInt(R.waterTreeId));
  const treeId = treeP1 > 0n ? treeP1 - 1n : null;
  console.log(`=== ${R.label} coin-split — ${cmd.toUpperCase()} ${EXECUTE ? '(LIVE)' : '(DRY)'} ===`);
  console.log(`  COPPERw ${R.waterVault} | backing $${human(backing, 6).toFixed(4)} | pending yield $${human(py, 6).toFixed(6)}`);
  console.log(`  tree ${treeId === null ? 'NOT PLANTED (run seed-coin-waters.cjs)' : '#' + treeId + ' (NFT ' + R.waterTreeNft + ' #' + R.waterTreeId + ')'}`);
  for (const lp of R.splitPools) console.log(`  pool ${lp} current COPPER: ${human(await copper.balanceOf(lp)).toFixed(0)}`);
  if (treeId === null) throw new Error('COPPERw has no tree — run seed-coin-waters.cjs first');

  if (cmd === 'status') return;
  if (!EXECUTE) {
    const claimable = await vault.pendingPayout(treeId);
    console.log(`\n  DRY: harvest (if yield>=$0.10) -> claim ${human(claimable).toFixed(2)} COPPER -> split to ${R.splitPools.length} pools (~${(human(claimable) / R.splitPools.length).toFixed(0)} each).`);
    console.log('  DRY — re-run with --execute (coordinator, peg paused).');
    return;
  }
  if (!PRIVATE_KEY) throw new Error('no AGENT_PRIVATE_KEY');
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const vaultW = new ethers.Contract(R.waterVault, WATERV2_ABI, wallet);
  const copperW = new ethers.Contract(R.token, ERC20_ABI, wallet);
  let nonce = await provider.getTransactionCount(wallet.address, 'pending');
  if (py >= 100000n) {
    // COPPERw harvest swaps Money->COPPER; minOut anchored conservatively (COPPER ~no USD price → minOut 0-floor not safe;
    // use a tight slippage off the live quote is N/A for coin; pass 0 and rely on the 1-tx pacing + small amounts).
    const tx = await vaultW.harvest(0n, { ...FEES, nonce: nonce++, gasLimit: 600000 }); await tx.wait();
    console.log(`  harvested ($${human(py, 6).toFixed(4)} yield -> COPPER):`, tx.hash);
  } else console.log('  harvest skipped — yield below $0.10; splitting COPPER on hand.');
  const claimable = await vault.pendingPayout(treeId);
  if (claimable > 0n) { const tx = await vaultW.claimPayout(treeId, { ...FEES, nonce: nonce++, gasLimit: 200000 }); await tx.wait(); console.log(`  claimed ${human(claimable).toFixed(2)} COPPER:`, tx.hash); }
  let bal = await copper.balanceOf(wallet.address);
  if (bal === 0n) { console.log('  no COPPER on hand to split — nothing to refill this run.'); return; }
  const each = bal / BigInt(R.splitPools.length);
  if (each === 0n) { console.log('  COPPER on hand too small to split — skipping.'); return; }
  for (const lp of R.splitPools) {
    const tx = await copperW.transfer(lp, each, { ...FEES, nonce: nonce++, gasLimit: 90000 }); await tx.wait();
    console.log(`  sent ${human(each).toFixed(0)} COPPER -> ${lp}:`, tx.hash);
  }
  console.log('\n  COPPER floor refilled in both pools from COPPERw yield. No free treasury copper.');
}

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--execute');
  const EXECUTE = process.argv.includes('--execute');
  const cmd = (args[0] || 'run').toLowerCase();
  const goodKey = (args[1] && !args[1].startsWith('--')) ? args[1] : null;
  const usdIdx = process.argv.indexOf('--usd');
  const usdTarget = usdIdx >= 0 ? Number(process.argv[usdIdx + 1]) : null;

  const provider = new ethers.JsonRpcProvider(RPC);
  const holderRec = loadJson(HOLDER_REC, 'system-water-holder-deployed.json');
  const HOLDER = holderRec.collection;

  // status with no good = summary table of every good's route + pool balance.
  if (cmd === 'status' && !goodKey) {
    console.log('=== loot-refill keeper — ALL goods ===');
    for (const [k, R] of Object.entries(RESOURCES)) {
      if (R.kind === 'coin-split') {
        const bals = [];
        for (const lp of R.splitPools) { try { bals.push(human(await new ethers.Contract(R.token, ERC20_ABI, provider).balanceOf(lp)).toFixed(0)); } catch (e) { bals.push('?'); } }
        console.log(`  ${R.label.padEnd(9)} ${R.routeStatus.padEnd(17)} (coin-split BILGE+GOBLIN) bal=[${bals.join(', ')}]  water ${R.waterVault}`);
        continue;
      }
      if (!R.lootPool) { console.log(`  ${k.padEnd(13)} ${R.routeStatus.padEnd(17)} pool NOT DEPLOYED yet (run deploy-adventure-lootpools.js) — keeper SKIPS until then`); continue; }
      const seat = holderRec.seats[R.label];
      const recPath = recFor(R.label);
      const vault = fs.existsSync(recPath) ? loadJson(recPath, R.label).vault : '(no vault yet)';
      let bal = '?'; try { bal = human(await new ethers.Contract(R.token, ERC20_ABI, provider).balanceOf(R.lootPool)).toFixed(0); } catch (e) {}
      const poolName = R.lootPool === LOOTPOOL.BILGE ? 'BILGE' : R.lootPool === LOOTPOOL.GOBLIN ? 'GOBLIN'
        : R.lootPool === LOOTPOOL.COVE ? 'COVE' : R.lootPool === LOOTPOOL.WRECK ? 'WRECK'
        : R.lootPool === LOOTPOOL.CAVE ? 'CAVE' : R.lootPool === LOOTPOOL.ROAD ? 'ROAD' : '?';
      console.log(`  ${k.padEnd(13)} ${R.routeStatus.padEnd(17)} seat ${seat ?? '-'} pool ${poolName.padEnd(6)} bal=${bal}  vault ${vault}`);
    }
    console.log('\n  LIVE goods run the full loop; MISSING_WALL goods harvest+claim only (need a buy wall first).');
    return;
  }

  const R = resolve(goodKey);

  // ── COPPER coin-split: payout IS copper; claim from the EXISTING COPPERw + split to ALL pools.
  //    No holder seat, no buy. (founder: route the existing COPPER water to the copper floor in pools.)
  if (R.kind === 'coin-split') { await runCoinSplit(provider, R, cmd, EXECUTE); return; }

  // A good bound to an adventure pool that isn't deployed yet → SKIP (real-or-nothing: can't refill an
  // unborn pool). The good flips live automatically once deploy-adventure-lootpools.js writes its record.
  if (!R.lootPool) {
    console.log(`=== ${R.label} (${goodKey}) — pool NOT DEPLOYED ===`);
    console.log(`  This good refills numbered adventure pool that deploy-adventure-lootpools.js hasn't created yet.`);
    console.log(`  Deploy the pool first; then its address is read from deploy/adventure-lootpools-deployed.json and this good goes live. NOTHING faked.`);
    return;
  }

  const seatId = holderRec.seats[R.label];
  if (seatId == null) throw new Error(`${R.label}: no holder seat in ${HOLDER_REC} — run deploy-system-water-holder.cjs`);
  const vaultRec = loadJson(recFor(R.label), `${R.label} water deploy record`);
  const VAULT = vaultRec.vault;
  if (!ethers.isAddress(VAULT)) throw new Error(`bad ${R.label} water vault: ${VAULT}`);

  const holder = new ethers.Contract(HOLDER, HOLDER_ABI, provider);
  const seatOwner = await holder.ownerOf(seatId);

  if (cmd === 'status') {
    const vault = new ethers.Contract(VAULT, WATERV2_ABI, provider);
    const [py, backing] = await Promise.all([vault.pendingYield(), vault.totalBacking()]);
    const poolBal = await new ethers.Contract(R.token, ERC20_ABI, provider).balanceOf(R.lootPool);
    console.log(`=== ${R.label} loot-refill — STATUS (${R.routeStatus}) ===`);
    console.log(`  water vault   : ${VAULT}`);
    console.log(`  seat          : ${HOLDER} #${seatId} owner ${seatOwner} ${seatOwner.toLowerCase() === '0xe2a4a8b9d77080c57799a94ba8edeb2dd6e0ac10' ? '(treasury ✓)' : '(NOT treasury!)'}`);
    console.log(`  backing (Aave): $${human(backing, 6).toFixed(4)}`);
    console.log(`  pending yield : $${human(py, 6).toFixed(6)}  (harvestable >= $0.10)`);
    console.log(`  LootPool      : ${R.lootPool}  current ${R.label} balance: ${human(poolBal).toFixed(0)}`);
    if (R.routeStatus === 'LIVE') {
      const pool = await resolveBuyPool(provider, R);
      console.log(`  buy wall      : ${pool} (${R.label}/${R.buy.quoteSym} @ loc ${R.buy.loc}) — quote in ${R.buy.quoteSym}`);
    } else {
      console.log(`  buy wall      : MISSING — deploy a ${R.label} buy wall (Port Royal good/GOLD LocationPool) before this good can refill.`);
    }
    return;
  }

  if (cmd !== 'run') { console.log('usage: loot-refill-keeper.js status [good] | run <good> [--usd N] [--execute]'); return; }

  const wallet = EXECUTE ? new ethers.Wallet(PRIVATE_KEY, provider) : null;
  const agent = wallet ? wallet.address : '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10';
  const vault = new ethers.Contract(VAULT, WATERV2_ABI, EXECUTE ? wallet : provider);
  const gold = new ethers.Contract(GOLD, ERC20_ABI, EXECUTE ? wallet : provider);

  const py = await vault.pendingYield();
  const treeIdP1 = await vault.treeIdFor(HOLDER, seatId);
  if (treeIdP1 === 0n) throw new Error(`${R.label} water has no tree for holder seat #${seatId} — run wire-prize-waters.cjs first`);
  const treeId = treeIdP1 - 1n;
  const pendingPayout = await vault.pendingPayout(treeId);

  console.log(`=== ${R.label} loot-refill — RUN ${EXECUTE ? '(LIVE)' : '(DRY)'} [${R.routeStatus}] ===`);
  console.log(`  water vault ${VAULT}  tree #${treeId} on seat #${seatId}`);
  console.log(`  pending yield $${human(py, 6).toFixed(6)} | tree pending GOLD ${human(pendingPayout).toFixed(4)} | agent GOLD ${human(await gold.balanceOf(agent)).toFixed(4)}`);

  if (R.routeStatus !== 'LIVE') {
    console.log(`\n  ROUTE = ${R.routeStatus}: this good has NO buy wall on-chain. The keeper will HARVEST + CLAIM GOLD`);
    console.log(`  (grows the endowment + holds GOLD), but will NOT fake a buy. Deploy a ${R.label} buy wall`);
    console.log(`  (Port Royal ${R.label}/GOLD LocationPool, fish-wall pattern) then set routeStatus:'LIVE' + buy{} here.`);
  }

  if (!EXECUTE) {
    console.log('\n  DRY loop (no tx):');
    console.log(`   1) HARVEST ${R.label} water (need yield >= $0.10): 50% grows water, 50% Money->GOLD via ${vaultRec.goldMoneyPool || 'GOLD/Money fee100'}.`);
    console.log(`   2) CLAIM tree #${treeId} GOLD -> agent ${agent}.`);
    if (R.routeStatus === 'LIVE') {
      const pool = await resolveBuyPool(provider, R);
      console.log(`   3) BUY ${R.label} @ loc ${R.buy.loc} pool ${pool} (quote ${R.buy.quoteSym}) — gated swap, keeper self-attests presence.`);
      console.log(`   4) TRANSFER bought ${R.label} -> LootPool ${R.lootPool} (refills the prize; LootPool reads balance).`);
      if (R.buy.quoteSym !== 'GOLD') console.log(`   ⚠️ wall quote is ${R.buy.quoteSym}, keeper holds GOLD → needs a GOLD->${R.buy.quoteSym} hop (not yet wired). FLAGGED.`);
    } else {
      console.log(`   3) (SKIPPED) no buy wall — see note above.`);
    }
    if (!signSwap && R.routeStatus === 'LIVE') console.log('   NOTE: location-signer.cjs not loadable here — a LIVE gated buy needs it on the VPS.');
    console.log('\n  DRY — re-run with --execute (BASE_RPC=<alchemy>, coordinator, peg-onehop paused).');
    return;
  }

  // ---- LIVE (COORDINATOR ONLY) ----
  if (!PRIVATE_KEY) throw new Error('no AGENT_PRIVATE_KEY');
  let nonce = await provider.getTransactionCount(wallet.address, 'pending');

  // Step 1 — harvest (if yield >= $0.10). minOut from the GOLD anchor, slippage-guarded.
  if (py >= 100000n) {
    const swapUsdc = py / 2n;
    const expectedGold = ethers.parseUnits((human(swapUsdc, 6) / GOLD_USD).toFixed(18), 18);
    const minPayoutOut = (expectedGold * (10000n - SLIP_BPS)) / 10000n;
    const tx = await vault.harvest(minPayoutOut, { ...FEES, nonce: nonce++, gasLimit: 600000 });
    await tx.wait(); console.log(`  harvested ($${human(py, 6).toFixed(4)} yield):`, tx.hash);
  } else console.log('  HARVEST skipped — yield below $0.10; will use GOLD on hand.');

  // Step 2 — claim the tree's GOLD to the keeper.
  const claimable = await vault.pendingPayout(treeId);
  if (claimable > 0n) { const tx = await vault.claimPayout(treeId, { ...FEES, nonce: nonce++, gasLimit: 200000 }); await tx.wait(); console.log(`  claimed ${human(claimable).toFixed(4)} GOLD:`, tx.hash); }

  if (R.routeStatus !== 'LIVE') { console.log(`\n  STOP: ${R.label} has no buy wall — GOLD held, endowment grown, NO fake buy. Deploy the wall to enable refill.`); return; }
  if (R.buy.quoteSym !== 'GOLD') throw new Error(`${R.label}: buy wall is ${R.buy.quoteSym}-quoted but keeper holds GOLD — wire a GOLD->${R.buy.quoteSym} hop before LIVE buys (refusing to guess a route).`);
  if (!signSwap) throw new Error('location-signer.cjs not available — cannot attest presence to buy at the gated wall');

  // Step 3 — buy the good with GOLD at its gated LocationPool.
  const pool = await resolveBuyPool(provider, R);
  const lp = await (async () => { const c = new ethers.Contract(pool, LOCPOOL_ABI, provider); const [t0, cap, open] = await Promise.all([c.token0(), c.maxSwapIn(), c.open()]); return { c, goldIsT0: t0.toLowerCase() === GOLD.toLowerCase(), cap, open }; })();
  if (!lp.open) throw new Error(`${R.label} buy wall ${pool} is CLOSED`);
  let goldToSpend = await gold.balanceOf(agent);
  if (usdTarget != null) { const capUsd = ethers.parseUnits((usdTarget / GOLD_USD).toFixed(18), 18); if (goldToSpend > capUsd) goldToSpend = capUsd; }
  if (lp.cap > 0n && goldToSpend > lp.cap) goldToSpend = lp.cap;
  if (goldToSpend === 0n) { console.log('  BUY: no GOLD to spend — nothing to refill this run.'); return; }
  const quotedOut = await lp.c.quote(lp.goldIsT0, goldToSpend);
  if (quotedOut === 0n) throw new Error(`${R.label} buy quote 0 — not filling; NOT faking`);
  const minOut = (quotedOut * (10000n - SLIP_BPS)) / 10000n;
  const att = await signSwap(pool, wallet.address);
  if ((await gold.allowance(wallet.address, pool)) < goldToSpend) await (await gold.approve(pool, goldToSpend, { ...FEES, nonce: nonce++, gasLimit: 80000 })).wait();
  const buyPool = new ethers.Contract(pool, LOCPOOL_ABI, wallet);
  const stx = await buyPool.swap(lp.goldIsT0, goldToSpend, minOut, att.expiry, att.sig, { ...FEES, nonce: nonce++, gasLimit: 300000 });
  await stx.wait();
  const goodC = new ethers.Contract(R.token, ERC20_ABI, wallet);
  const bought = await goodC.balanceOf(agent);
  console.log(`  bought ${human(bought).toFixed(2)} ${R.label} for ${human(goldToSpend).toFixed(2)} GOLD:`, stx.hash);

  // Step 4 — transfer the good to its LootPool (refills the prize; LootPool reads balance per BPS).
  if (bought === 0n) throw new Error(`bought 0 ${R.label} — refusing to refill nothing`);
  const ttx = await goodC.transfer(R.lootPool, bought, { ...FEES, nonce: nonce++, gasLimit: 90000 });
  await ttx.wait();
  console.log(`  refilled LootPool ${R.lootPool} with ${human(bought).toFixed(2)} ${R.label}:`, ttx.hash);
  console.log('\n  LOOP COMPLETE: yield -> GOLD -> bought good -> LootPool refilled. The yield fueled it. No free treasury goods.');
}
main().catch(e => { console.error('ERROR:', e.reason || e.shortMessage || e.message || e); process.exit(1); });
