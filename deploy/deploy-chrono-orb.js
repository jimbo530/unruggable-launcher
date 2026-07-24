#!/usr/bin/env node
/**
 * deploy-chrono-orb.js — CHRONO ORB consumable token for "Seize the Seas" (founder 2026-06-27:
 * "wire chrono orbs into the cooldowns").
 *
 *   CHRONO ORB (category "orb"):  CHRONORB   (1)
 *
 * The Chrono Orb is a PREMIUM time-magic consumable. Consuming ONE orb CLEARS a pawn's active
 * COOLDOWN so it can act again immediately — the dungeon/arena "skip the wait" item. The orb buys
 * the WAIT ONLY: a pawn that skips the goblin-cave cooldown still has to RUN and WIN the cave to get
 * any loot (no win or reward is ever bought — see game/lib/goblin-cave.js spendChronoOrbToSkip()).
 *
 * It mirrors the raw-material / gear / potion token pattern (LaunchToken fixed-supply ERC20s), so the
 * existing commodity-sheet + market plumbing picks it up with no special-casing.
 *
 * PRICE (gold) — PROPOSAL, FOUNDER-ADJUSTABLE. ⚑ PREMIUM. Anchored to the live scale (gold = $0.01;
 * food items 1-65g; gear wooden 1-25g .. steel up to 200g; the Biggin Health Potion = 80g). Skipping a
 * 7-day goblin-cave cooldown (or any future cooldown) is a strong convenience, so the orb sits ABOVE
 * the premium-potion ceiling — a deliberate sink, not a casual buy:
 *   CHRONORB 250g   (= $2.50 at gold $0.01)   ⚑ premium — founder may move it up/down
 * Price is sell-wall / recipe METADATA — it does NOT affect supply.
 *
 * Supply: UNIFORM 100B, MIRRORING the potion / raw-material / gear precedent (LaunchToken fixed supply).
 * Consumables are abundant (you spend them); 100B leaves ample headroom for bulk flow. Scarcity is
 * created by the GOLD PRICE (premium), not by a small cap.
 *
 * LaunchToken.sol — fixed supply, NO owner/mint/burn, immutable, 18 dec; 100% to treasury.
 *
 * Usage:  node deploy/deploy-chrono-orb.js            (DRY RUN — prints plan, sends nothing)
 *         node deploy/deploy-chrono-orb.js --execute  (COORDINATOR ONLY — broadcasts to Base)
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

// UNIFORM 100B supply (mirrors potion / raw-material / gear precedent). gold = sell-wall metadata.
const SUPPLY = 100_000_000_000n;

// id = lowercase-hyphen key (matches the in-game item registry scheme). symbol kept <=11 + unique.
// gold = PROPOSED Port Royal wall price (founder sign-off pending). ⚑ PREMIUM by design.
const ORBS = [
  { id: 'chrono-orb', name: 'Chrono Orb', symbol: 'CHRONORB', gold: 250, premium: true, emoji: '⏳',
    use: 'PREMIUM time-magic consumable — spend 1 to CLEAR a pawn\'s cooldown (skip the WAIT only; still must RUN+WIN)' },
];

// container key MUST match build-commodity-sheet.cjs SRC entry so the CSV picks these up.
const PLAN = [
  { category: 'orb', containerKey: 'orbs', out: 'orb-deployed.json', items: ORBS },
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
      const flag = t.premium ? ' ⚑PREMIUM' : '';
      console.log(`  ${t.emoji} ${t.symbol.padEnd(11)} ${t.name.padEnd(12)} ${String(t.gold).padStart(4)}g${flag}   ${t.use}`);
    }
    console.log('');
  }
  console.log(`Total: ${totalTokens} token(s).`);
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
        gold: t.gold, premium: !!t.premium, whole: SUPPLY.toString(), supplyWei: supply.toString(),
      };
      fs.writeFileSync(OUT, JSON.stringify(record, null, 2)); // write after EACH (crash-safe)
    }
    console.log(`Saved ${group.category} addresses to ${OUT} (${Object.keys(bag).length}/${group.items.length} recorded)`);
    console.log('');
  }

  console.log('Chrono Orb token deployed.');
  console.log('Next: 1) node deploy/build-commodity-sheet.cjs   (refresh game/seas/commodity-tokens.csv)');
  console.log('      2) wire the live orb address into game/lib/goblin-cave.js CHRONO_ORB (currently null — game-layer balance works without it).');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
