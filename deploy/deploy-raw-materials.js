#!/usr/bin/env node
/**
 * deploy-raw-materials.js — RAW MATERIAL trade-good tokens for "Seize the Seas" (founder 2026-06-27).
 *
 *   STONES (category "stone"):  MARBLE · SHALE · LIMESTONE                                 (3)
 *   ORES   (category "ore")  :  COPPER ORE · TIN ORE · IRON ORE · COAL · SILVER ORE · GOLD ORE  (6)
 *
 * These are the BASE of the crafting lines — raw rock + ore mined/quarried, carried to a
 * smelter/mason (a location-gated conversion LP, later) that turns them into the metals and
 * stone goods the existing gear/build tiers consume:
 *   gear-data.js MATERIALS ladder (live):  wooden ½ · iron 1× · bronze 2× · steel 4× (locked).
 *     bronze metal  <-  COPPER ORE + TIN ORE   (smelt)
 *     iron   metal  <-  IRON ORE              (smelt)
 *     steel  metal  <-  IRON ORE + COAL        (smelt, hotter)
 *     silver metal  <-  SILVER ORE             (smelt) -> luxury/fine goods (jewelry, gilding)
 *     gold   metal  <-  GOLD ORE               (smelt) -> luxury endgame (noble mansions, gilded statues/fountains)
 *   stones feed the BUILD economy (no in-game material tier yet — distinct uses):
 *     shale     -> cheap bulk fill / rough walls
 *     limestone -> mortar / lime (binds stone builds)
 *     marble    -> premium / high-HP / noble builds
 *
 * NOTE — SILVER + GOLD ore are INCLUDED (founder 2026-06-27): they have a clear consumer, the
 * luxury / fine-goods / noble-mansion lane (jewelry, gilding, precious-metal gear, the rank
 * endgame). MITHRIL ORE stays DEFERRED — the live gear ladder has NO "dwarven"/mithril material
 * tier (Dwarven is a weapon-name prefix, not a metal); add it only when a tier consumes it.
 *
 * Gold prices below are PROPOSALS (founder sign-off pending). Anchored to the live scale:
 * LOG 1g · LUMBER 5g · gear wooden 1-25g .. steel up to 200g. Gold = $0.01. Price is metadata
 * for the Port Royal sell walls / future crafting recipes — it does NOT affect supply.
 *
 * Supply: UNIFORM 100B per token, MIRRORING the gear precedent (gear-deployed.json). Raw
 * materials are abundant consumable inputs to crafting (like gear), NOT scarce store-of-value
 * (like gems, which use inverse-FDV). 100B leaves ample headroom for bulk industrial flow.
 *
 * LaunchToken.sol — fixed supply, NO owner/mint/burn, immutable, 18 dec; 100% to treasury.
 *
 * Usage:  node deploy/deploy-raw-materials.js            (DRY RUN — prints plan, sends nothing)
 *         node deploy/deploy-raw-materials.js --execute  (COORDINATOR ONLY — broadcasts to Base)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found in env'); process.exit(1); }

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');

const DECIMALS = 18n;
const ONE = 10n ** DECIMALS;

// UNIFORM 100B supply for every raw-material token (mirrors gear precedent). gold = sell-wall metadata.
const SUPPLY = 100_000_000_000n;

// id = lowercase key (matches the in-game material registry scheme). symbol kept short + unique.
// gold = PROPOSED Port Royal wall price (founder sign-off pending).
const STONES = [
  { id: 'shale',     name: 'Shale',     symbol: 'SHALE',     gold: 1,  emoji: '🪨', use: 'clay-like — fired into BRICKS (brick chain → oven/structures)' },
  { id: 'limestone', name: 'Limestone', symbol: 'LIME',      gold: 5,  emoji: '🪨', use: 'COMMON building stone (= lumber price)' },
  { id: 'sandstone', name: 'Sandstone', symbol: 'SANDSTONE', gold: 7,  emoji: '🟫', use: 'sometimes — mid build stone' },
  { id: 'granite',   name: 'Granite',   symbol: 'GRANITE',   gold: 10, emoji: '🪨', use: 'sometimes — hard build stone (high HP)' },
  { id: 'marble',    name: 'Marble',    symbol: 'MARBLE',    gold: 12, emoji: '🏛️', use: 'premium / high-HP / noble builds' },
];

const ORES = [
  { id: 'copper-ore', name: 'Copper Ore', symbol: 'COPRORE', gold: 3,  emoji: '🟤', use: 'bronze metal (with tin)' },
  { id: 'tin-ore',    name: 'Tin Ore',    symbol: 'TINORE',  gold: 3,  emoji: '⚪', use: 'bronze metal (with copper)' },
  { id: 'iron-ore',   name: 'Iron Ore',   symbol: 'IRONORE', gold: 5,  emoji: '⛏️', use: 'iron metal; steel (with coal)' },
  { id: 'coal',       name: 'Coal',       symbol: 'COAL',    gold: 2,  emoji: '⚫', use: 'fuel; steel (with iron ore)' },
  { id: 'silver-ore', name: 'Silver Ore', symbol: 'SILVRORE',gold: 10, emoji: '⚪', use: 'silver metal; luxury/fine goods (jewelry, gilding) — silver coin tier $0.001' },
  { id: 'gold-ore',   name: 'Gold Ore',   symbol: 'GOLDORE', gold: 40, emoji: '🟡', use: 'gold metal; luxury endgame (noble mansions, gilded statues/fountains) — gold coin tier $0.01' },
];

// REFINED METALS — smelter output. Gold prices are PROPOSALS (founder sign-off pending), derived by
// the rule "ore = half processed value" => ingot ~= 2x its ore input, aligned to gear-data.js
// MATERIALS tiers (iron 1x / bronze 2x / steel 4x):
//   iron   ore 5  -> iron ingot   ~10? No: pegged to the gear tier, IRON=base 1x. iron ore 5 -> 1g? The
//                    tier multiplier is 1x, so IRON INGOT sits at the tier base = 1g (the iron benchmark).
//   bronze (copper 3 + tin 3 inputs ~6 ore-value) -> 2g  (tier 2x).
//   steel  is the NOTED EXCEPTION: inputs (iron ore 5 + coal 2) ~= bronze's ore cost, but the coal-fired
//          premium + tier 4x prices STEEL INGOT at 4g, not at its raw input cost.
//   silver ore 5  -> 10  (2x ore; luxury/fine goods).   [silver-ore listed 10 above = pair-with-tin cost; ingot peg 2x base-5]
//   gold   ore 50 -> 100 (2x ore; luxury endgame).      [gold-ore listed 40 above; ingot peg 2x base-50]
const INGOTS = [
  { id: 'iron-ingot',   name: 'Iron Ingot',   symbol: 'IRONINGOT',   gold: 1,   emoji: '🔩', use: 'iron metal — smelt iron ore → iron gear' },
  { id: 'bronze-ingot', name: 'Bronze Ingot', symbol: 'BRONZEINGOT', gold: 2,   emoji: '🥉', use: 'bronze metal — copper+tin ore → bronze gear' },
  { id: 'steel-ingot',  name: 'Steel Ingot',  symbol: 'STEELINGOT',  gold: 4,   emoji: '⚙️', use: 'steel metal — iron ore + coal → steel gear' },
  { id: 'silver-ingot', name: 'Silver Ingot', symbol: 'SILVERINGOT', gold: 10,  emoji: '🪙', use: 'silver metal — silver ore → luxury/fine goods' },
  { id: 'gold-ingot',   name: 'Gold Ingot',   symbol: 'GOLDINGOT',   gold: 100, emoji: '🥇', use: 'gold metal — gold ore → luxury endgame' },
];

// FIRED CLAY — brickworks output (shale → brick), feeds ovens/structures in the BUILD economy.
const BRICKS = [
  { id: 'brick', name: 'Brick', symbol: 'BRICK', gold: 2, emoji: '🧱', use: 'fired from shale (brickworks) → oven/structures' },
];

// container key MUST match build-commodity-sheet.cjs SRC entries so the CSV picks these up.
const PLAN = [
  { category: 'stone', containerKey: 'stones', out: 'stone-deployed.json', items: STONES },
  { category: 'ore',   containerKey: 'ores',   out: 'ore-deployed.json',   items: ORES },
  { category: 'ingot', containerKey: 'ingots', out: 'ingot-deployed.json', items: INGOTS },
  { category: 'brick', containerKey: 'bricks', out: 'brick-deployed.json', items: BRICKS },
];

// public Base RPC lags read-after-write; retry transient 0x/BAD_DATA reads. (matches deploy-gear.js)
async function retryRead(fn, label, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 2500));
    }
  }
}

async function main() {
  const artifact = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'LaunchToken.sol', 'LaunchToken.json'));
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const treasury = wallet.address; // derived from the key, never hand-typed

  const bal = await provider.getBalance(treasury);
  const totalTokens = PLAN.reduce((n, p) => n + p.items.length, 0);
  console.log('Treasury / deployer:', treasury);
  console.log('ETH balance        :', ethers.formatEther(bal), 'ETH');
  console.log('Mode               :', EXECUTE ? 'EXECUTE (broadcasting)' : 'DRY RUN (nothing sent)');
  console.log('Uniform supply     :', SUPPLY.toLocaleString(), 'each (= ' + SUPPLY + 'e18)');
  console.log('');

  for (const group of PLAN) {
    console.log(`Planned ${group.category.toUpperCase()} tokens (${group.items.length}) -> ${group.out}:`);
    for (const t of group.items) {
      console.log(`  ${t.emoji} ${t.symbol.padEnd(8)} ${t.name.padEnd(11)} ${String(t.gold).padStart(3)}g   ${t.use}`);
    }
    console.log('');
  }
  console.log(`Total: ${totalTokens} tokens.`);
  console.log('');

  if (!EXECUTE) { console.log('DRY RUN complete. Re-run with --execute to deploy (coordinator only).'); return; }
  if (bal < ethers.parseEther('0.0005')) { console.error(`Refusing to deploy: ETH too low for ${totalTokens} deploys.`); process.exit(1); }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  // explicit fees clear Base basefee with margin; explicit nonce avoids lagging-read collisions.
  const fees = { maxFeePerGas: ethers.parseUnits('0.1', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  let nextNonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await provider.getTransactionCount(treasury, 'pending');

  for (const group of PLAN) {
    const OUT = path.join(__dirname, group.out);
    // resume: load any already-deployed ids so a re-run only fills the gaps (idempotent).
    const record = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8'))
      : { chain: 'base', chainId: 8453, treasury, deployedAt: new Date().toISOString(), [group.containerKey]: {} };
    if (!record[group.containerKey]) record[group.containerKey] = {};
    const bag = record[group.containerKey];

    for (const t of group.items) {
      if (bag[t.id]) { console.log(`Skipping ${t.symbol} (already in ${group.out}: ${bag[t.id].address})`); continue; }
      const supply = SUPPLY * ONE;
      console.log(`Deploying ${t.symbol} (${t.name}) ... (nonce ${nextNonce})`);
      const token = await factory.deploy(t.name, t.symbol, supply, treasury, '', { ...fees, nonce: nextNonce });
      nextNonce++;
      await token.waitForDeployment();
      const addr = await token.getAddress();

      const c = new ethers.Contract(addr, [
        'function totalSupply() view returns (uint256)',
        'function balanceOf(address) view returns (uint256)',
      ], provider);
      const ts = await retryRead(() => c.totalSupply(), `${t.symbol}.totalSupply`);
      const tb = await retryRead(() => c.balanceOf(treasury), `${t.symbol}.balanceOf`);
      if (ts !== supply || tb !== supply) throw new Error(`Supply mismatch for ${t.symbol}: total=${ts} treasury=${tb} expected=${supply}`);
      console.log(`  ${t.symbol} -> ${addr}  (verified ${SUPPLY.toLocaleString()})`);

      bag[t.id] = {
        id: t.id, name: t.name, symbol: t.symbol, address: addr, decimals: 18,
        gold: t.gold, whole: SUPPLY.toString(), supplyWei: supply.toString(),
      };
      fs.writeFileSync(OUT, JSON.stringify(record, null, 2)); // write after EACH (crash-safe)
    }
    console.log(`Saved ${group.category} addresses to ${OUT} (${Object.keys(bag).length}/${group.items.length} recorded)`);
    console.log('');
  }

  console.log('All raw-material tokens deployed.');
  console.log('Next: node deploy/build-commodity-sheet.cjs   (refresh game/seas/commodity-tokens.csv)');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
