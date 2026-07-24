#!/usr/bin/env node
/**
 * deploy-potions.js — HEALTH + MANA POTION consumable tokens for "Seize the Seas" (founder 2026-06-27).
 *
 *   HEALTH POTIONS (category "potion"):  Small · Medium · Large · XLarge · Biggin   (5)
 *   MANA   POTIONS (category "potion"):  Small · Medium · Large · XLarge · Biggin   (5)
 *
 * Potions are VALUABLE combat consumables — bought off Port Royal sell walls, carried, and drunk
 * in combat to restore HP (health) or MANA (mana). Bigger size = more restore = higher price.
 * They mirror the raw-material / gear / food token pattern (LaunchToken fixed-supply ERC20s),
 * so the existing commodity-sheet + market plumbing picks them up with no special-casing.
 *
 * PRICE (gold) — PROPOSAL, FOUNDER-ADJUSTABLE. Anchored to the live scale (gold = $0.01; food
 * items 1-65g; gear wooden 1-25g .. steel up to 200g). Potions are premium combat consumables, so
 * the ladder rises steeply small -> biggin:
 *   S 2g · M 5g · L 12g · XL 30g · BIGGIN 80g   (identical ladder for health & mana)
 * Price is sell-wall / recipe METADATA — it does NOT affect supply.
 *
 * POTENCY — the restore amount (hp for health potions, mana for mana potions). This is GAME-LAYER
 * COMBAT CONFIG carried in the row meta (like food=N on food tokens). PROPOSAL, FOUNDER-ADJUSTABLE:
 *   S 25 · M 75 · L 200 · XL 500 · BIGGIN 1500
 * The combat layer reads hp=N / mana=N off the token meta to know the heal / mana-restore per size.
 *
 * Supply: UNIFORM 100B per token, MIRRORING the raw-material / gear precedent. Consumables are
 * abundant (you drink them), NOT scarce store-of-value. 100B leaves ample headroom for bulk flow.
 *
 * LaunchToken.sol — fixed supply, NO owner/mint/burn, immutable, 18 dec; 100% to treasury.
 *
 * Usage:  node deploy/deploy-potions.js            (DRY RUN — prints plan, sends nothing)
 *         node deploy/deploy-potions.js --execute  (COORDINATOR ONLY — broadcasts to Base)
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

// UNIFORM 100B supply for every potion token (mirrors raw-material / gear precedent).
const SUPPLY = 100_000_000_000n;

// PROPOSED price ladder (gold) by size — founder sign-off pending. Same for health & mana.
//   small 2 · medium 5 · large 12 · xlarge 30 · biggin 80
// PROPOSED potency ladder (restore amount) by size — founder sign-off pending.
//   small 25 · medium 75 · large 200 · xlarge 500 · biggin 1500
//
// id = lowercase-hyphen key (matches the in-game item registry scheme). symbol kept <=11 + unique.
// gold = PROPOSED Port Royal wall price. hp / mana = PROPOSED restore amount (combat config).

const HEALTH = [
  { id: 'health-potion-small',  name: 'Small Health Potion',  symbol: 'HEALPOTS',   gold: 2,  hp: 25,   emoji: '🧪', use: 'combat consumable — restores 25 HP' },
  { id: 'health-potion-medium', name: 'Medium Health Potion', symbol: 'HEALPOTM',   gold: 5,  hp: 75,   emoji: '🧪', use: 'combat consumable — restores 75 HP' },
  { id: 'health-potion-large',  name: 'Large Health Potion',  symbol: 'HEALPOTL',   gold: 12, hp: 200,  emoji: '🧪', use: 'combat consumable — restores 200 HP' },
  { id: 'health-potion-xlarge', name: 'XLarge Health Potion', symbol: 'HEALPOTXL',  gold: 30, hp: 500,  emoji: '🧪', use: 'combat consumable — restores 500 HP' },
  { id: 'health-potion-biggin', name: 'Biggin Health Potion', symbol: 'HEALPOTBIG', gold: 80, hp: 1500, emoji: '🧪', use: 'combat consumable — restores 1500 HP' },
];

const MANA = [
  { id: 'mana-potion-small',  name: 'Small Mana Potion',  symbol: 'MANAPOTS',   gold: 2,  mana: 25,   emoji: '🔵', use: 'combat consumable — restores 25 mana' },
  { id: 'mana-potion-medium', name: 'Medium Mana Potion', symbol: 'MANAPOTM',   gold: 5,  mana: 75,   emoji: '🔵', use: 'combat consumable — restores 75 mana' },
  { id: 'mana-potion-large',  name: 'Large Mana Potion',  symbol: 'MANAPOTL',   gold: 12, mana: 200,  emoji: '🔵', use: 'combat consumable — restores 200 mana' },
  { id: 'mana-potion-xlarge', name: 'XLarge Mana Potion', symbol: 'MANAPOTXL',  gold: 30, mana: 500,  emoji: '🔵', use: 'combat consumable — restores 500 mana' },
  { id: 'mana-potion-biggin', name: 'Biggin Mana Potion', symbol: 'MANAPOTBIG', gold: 80, mana: 1500, emoji: '🔵', use: 'combat consumable — restores 1500 mana' },
];

// container key MUST match build-commodity-sheet.cjs SRC entry so the CSV picks these up.
const PLAN = [
  { category: 'potion', containerKey: 'potions', out: 'potion-deployed.json', items: [...HEALTH, ...MANA] },
];

// public Base RPC lags read-after-write; retry transient 0x/BAD_DATA reads. (matches deploy-raw-materials.js)
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
      const potency = t.hp !== undefined ? `hp=${t.hp}` : `mana=${t.mana}`;
      console.log(`  ${t.emoji} ${t.symbol.padEnd(11)} ${t.name.padEnd(20)} ${String(t.gold).padStart(3)}g  ${potency.padEnd(9)} ${t.use}`);
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
        ...(t.hp !== undefined ? { hp: t.hp } : {}),
        ...(t.mana !== undefined ? { mana: t.mana } : {}),
      };
      fs.writeFileSync(OUT, JSON.stringify(record, null, 2)); // write after EACH (crash-safe)
    }
    console.log(`Saved ${group.category} addresses to ${OUT} (${Object.keys(bag).length}/${group.items.length} recorded)`);
    console.log('');
  }

  console.log('All potion tokens deployed.');
  console.log('Next: node deploy/build-commodity-sheet.cjs   (refresh game/seas/commodity-tokens.csv)');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
