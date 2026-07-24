#!/usr/bin/env node
/**
 * deploy-gear.js — Equippable GEAR item tokens for "Seize the Seas" (founder 2026-06-25).
 *
 *   Sword / Spear / Shield  ×  Wooden / Iron / Bronze / Steel  = 12 ERC20s.
 *
 * Prices = authentic D&D 3.5 base (Long Sword 15g · Spear 2g · Shield 20g) × the game's
 * MATERIAL ladder (gear-data.js): wooden ½ · iron 1× · bronze 2× · steel 4×. Denominated
 * in GOLD (gold = $0.01). Uniform 100B supply for every gear token (founder 2026-06-25);
 * gold price is metadata for the Port Royal sell walls. Token id = `<item>-<material>` to
 * match the in-game armory + enemy loadouts (items.js).
 *
 * LaunchToken.sol — fixed supply, NO owner/mint/burn, immutable, 18 dec; 100% to treasury.
 *
 * Usage:  node deploy/deploy-gear.js            (DRY RUN)
 *         node deploy/deploy-gear.js --execute  (broadcasts to Base mainnet)
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

// base book price (gold) per item × material multiplier
const BASE = { sword: 15, spear: 2, shield: 20 };               // Long Sword / Spear / Shield (D&D 3.5)
const MAT  = { wooden: 0.5, iron: 1, bronze: 2, steel: 4 };     // gear-data.js MATERIALS ladder
const EMOJI = { sword: '⚔️', spear: '🔱', shield: '🛡️' };
const MLABEL = { wooden: 'Wooden', iron: 'Iron', bronze: 'Bronze', steel: 'Steel' };
const ILABEL = { sword: 'Sword', spear: 'Spear', shield: 'Shield' };

// build the 12 token specs. UNIFORM 100B supply for every gear token (founder choice).
const SUPPLY = 100_000_000_000n;
const GEAR = [];
for (const item of ['sword', 'spear', 'shield']) {
  for (const mat of ['wooden', 'iron', 'bronze', 'steel']) {
    const gold = BASE[item] * MAT[mat];
    const whole = SUPPLY;
    GEAR.push({
      id: `${item}-${mat}`,                                  // matches armory id scheme
      name: `${MLABEL[mat]} ${ILABEL[item]}`,
      symbol: `${item.slice(0, 2).toUpperCase()}${mat[0].toUpperCase()}`, // SWW, SWI, SWB, SWS, SPW... SHW...
      gold, whole, emoji: EMOJI[item],
    });
  }
}

const OUT = path.join(__dirname, 'gear-deployed.json');

// public Base RPC lags read-after-write; retry transient 0x/BAD_DATA reads.
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
  const treasury = wallet.address;

  const bal = await provider.getBalance(treasury);
  console.log('Treasury / deployer:', treasury);
  console.log('ETH balance        :', ethers.formatEther(bal), 'ETH');
  console.log('Mode               :', EXECUTE ? 'EXECUTE (broadcasting)' : 'DRY RUN (nothing sent)');
  console.log('');
  console.log('Planned gear tokens (12):');
  for (const g of GEAR) {
    console.log(`  ${g.emoji} ${g.symbol.padEnd(4)} ${g.name.padEnd(16)} ${String(g.gold).padStart(5)}g  supply ${g.whole.toLocaleString()}`);
  }
  console.log('');

  if (!EXECUTE) { console.log('DRY RUN complete. Re-run with --execute to deploy.'); return; }
  if (bal < ethers.parseEther('0.0008')) { console.error('Refusing to deploy: ETH too low for 12 deploys.'); process.exit(1); }

  // resume: load any already-deployed ids so a re-run only fills the gaps.
  const record = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8'))
    : { chain: 'base', chainId: 8453, treasury, deployedAt: new Date().toISOString(), gear: {} };
  if (!record.gear) record.gear = {};

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const fees = { maxFeePerGas: ethers.parseUnits('0.1', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  let nextNonce = process.env.START_NONCE ? Number(process.env.START_NONCE) : await provider.getTransactionCount(treasury, 'pending');

  for (const g of GEAR) {
    if (record.gear[g.id]) { console.log(`Skipping ${g.symbol} (already in ${path.basename(OUT)}: ${record.gear[g.id].address})`); continue; }
    const supply = g.whole * ONE;
    console.log(`Deploying ${g.symbol} (${g.name}) ... (nonce ${nextNonce})`);
    const token = await factory.deploy(g.name, g.symbol, supply, treasury, '', { ...fees, nonce: nextNonce });
    nextNonce++;
    await token.waitForDeployment();
    const addr = await token.getAddress();

    const t = new ethers.Contract(addr, [
      'function totalSupply() view returns (uint256)',
      'function balanceOf(address) view returns (uint256)',
    ], provider);
    const ts = await retryRead(() => t.totalSupply(), `${g.symbol}.totalSupply`);
    const tb = await retryRead(() => t.balanceOf(treasury), `${g.symbol}.balanceOf`);
    if (ts !== supply || tb !== supply) throw new Error(`Supply mismatch for ${g.symbol}: total=${ts} treasury=${tb} expected=${supply}`);
    console.log(`  ${g.symbol} -> ${addr}  (verified ${g.whole.toLocaleString()})`);

    record.gear[g.id] = { id: g.id, name: g.name, symbol: g.symbol, address: addr, decimals: 18,
      gold: g.gold, whole: g.whole.toString(), supplyWei: supply.toString() };
    fs.writeFileSync(OUT, JSON.stringify(record, null, 2));   // write after EACH (crash-safe)
  }

  console.log('\nSaved addresses to', OUT, `(${Object.keys(record.gear).length}/12 recorded)`);
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
