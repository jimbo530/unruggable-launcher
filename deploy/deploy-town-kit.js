#!/usr/bin/env node
/**
 * deploy-town-kit.js — build a DROPPABLE town market kit (LocationPoolV2 clones, UNPLACED).
 *
 * A kit = one pool per good for a size template (deploy/town-kits.js), pre-seeded at the
 * Port Royal book price, created under a kit id (>= KIT_BASE) so it has NO hex yet. When
 * players explore a new site, deploy/drop-town.js places every pool on the real hex in one
 * pass (pool.placeAt — one-time, then locked forever).
 *
 * V2 pools are WITHDRAWABLE during the build phase (adminWithdraw) and get locked add-only
 * via the one-way renounceAdminWithdraw() at ship — the no-premature-lock lesson, on purpose.
 *
 * First run deploys the LocationPoolV2 implementation + LocationLPFactoryV2 (reusing the
 * live V1 gameSigner so the seas-server attestation flow works unchanged), then records
 * everything in deploy/town-kits-deployed.json (resume-safe: recorded steps are skipped).
 *
 * Usage:
 *   node deploy/deploy-town-kit.js --size hamlet --name saltcreek            (DRY RUN)
 *   node deploy/deploy-town-kit.js --size hamlet --name saltcreek --execute  (LIVE)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const READ_RPC = process.env.BASE_READ_RPC || 'http://127.0.0.1:8545'; // local node for cheap reads
const EXECUTE = process.argv.includes('--execute');

const { COIN, GOODS, SIZES, FEE_BPS, COOLDOWN, KIT_BASE } = require('./town-kits.js');

const V1_RECORD = path.join(__dirname, 'location-lp-deployed.json');   // source of the live gameSigner
const RECORD = path.join(__dirname, 'town-kits-deployed.json');
const ONE = 10n ** 18n;
const FEES = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? null) : null; }
function loadRecord() {
  if (!fs.existsSync(RECORD)) return { chain: 'base', chainId: 8453, kits: {} };
  return JSON.parse(fs.readFileSync(RECORD, 'utf8'));
}
function saveRecord(rec) { fs.writeFileSync(RECORD, JSON.stringify(rec, null, 2)); }
function artifact(name) {
  const p = path.join(__dirname, '..', 'artifacts', 'contracts', `${name}.sol`, `${name}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const FACTORY_ABI = [
  'function createPool(uint256 key, address tokenA, address tokenB, uint16 feeBps, uint256 maxSwapIn, uint32 cooldown) returns (address)',
  'function getPool(uint256 key, address tokenA, address tokenB) view returns (address)',
  'function owner() view returns (address)',
  'function gameSigner() view returns (address)',
  'function KIT_BASE() view returns (uint256)',
  'event PoolCreated(uint256 indexed key, address indexed token0, address indexed token1, address pool, uint16 feeBps, bool placed)',
];
const POOL_ABI = [
  'function token0() view returns (address)',
  'function seed(uint256 amount0, uint256 amount1)',
  'function getReserves() view returns (uint256, uint256)',
  'function placed() view returns (bool)',
];
const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];

// public-RPC reads get rate-limited during a long deploy — retry with backoff, loudly.
async function retryRead(fn, label, tries = 10) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === tries - 1) throw new Error(`${label}: ${e.shortMessage || e.message}`);
      console.log(`  (read retry ${i + 1}/${tries} ${label})`);
      await sleep(3000 * (i + 1));
    }
  }
}

async function main() {
  const size = (flag('--size') || '').toLowerCase();
  const name = (flag('--name') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!SIZES[size]) { console.error(`--size must be one of: ${Object.keys(SIZES).join(', ')}`); process.exit(1); }
  if (!name) { console.error('--name <kit name> required (e.g. saltcreek)'); process.exit(1); }

  const tmpl = SIZES[size];
  const provider = new ethers.JsonRpcProvider(RPC);
  const readProvider = new ethers.JsonRpcProvider(READ_RPC); // local node: no rate limits
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  const rec = loadRecord();

  // ── the live V1 gameSigner (same signer key = the seas-server flow works unchanged) ──
  const v1 = JSON.parse(fs.readFileSync(V1_RECORD, 'utf8'));
  const gameSigner = ethers.getAddress(v1.gameSigner);

  console.log(`[town-kit] ${EXECUTE ? 'LIVE' : 'DRY RUN'} | size=${size} name=${name} | deployer=${me}`);
  console.log(`[town-kit] goods=${tmpl.goods.length} units/pool=${tmpl.units} maxSwapIn=${tmpl.maxSwapIn} fee=${FEE_BPS}bps`);

  // ── balance preflight (goods + coin totals this kit needs) ──
  const need = {}; // addr -> wei
  for (const g of tmpl.goods) {
    const spec = GOODS[g];
    need[spec.addr] = (need[spec.addr] || 0n) + BigInt(tmpl.units) * ONE;
    const coinAddr = COIN[spec.coin];
    need[coinAddr] = (need[coinAddr] || 0n) + BigInt(tmpl.units * spec.price) * ONE;
  }
  let short = false;
  for (const [addr, amt] of Object.entries(need)) {
    const bal = await new ethers.Contract(addr, ERC20_ABI, readProvider).balanceOf(me);
    const ok = bal >= amt;
    if (!ok) short = true;
    console.log(`  ${ok ? 'ok ' : 'SHORT'} ${addr} need=${ethers.formatUnits(amt, 18)} have=${ethers.formatUnits(bal, 18)}`);
  }
  if (short) { console.error('[town-kit] treasury short on a token — refusing.'); process.exit(1); }

  if (!EXECUTE) {
    console.log('[town-kit] DRY RUN complete — plan is fundable. Re-run with --execute.');
    for (const g of tmpl.goods) {
      const s = GOODS[g];
      console.log(`  pool ${g}: ${tmpl.units} ${g} vs ${tmpl.units * s.price} ${s.coin}  (price ${s.price} ${s.coin})`);
    }
    return;
  }

  let nonce = await provider.getTransactionCount(me, 'pending');

  // ── 1) implementation + factory (once) ──
  if (!rec.implementation) {
    const a = artifact('LocationPoolV2');
    const f = new ethers.ContractFactory(a.abi, a.bytecode, wallet);
    const c = await f.deploy({ nonce: nonce++, ...FEES });
    await c.waitForDeployment();
    rec.implementation = await c.getAddress();
    saveRecord(rec);
    console.log(`[town-kit] LocationPoolV2 impl: ${rec.implementation}`);
    await sleep(4000);
  }
  if (!rec.factory) {
    const a = artifact('LocationLPFactoryV2');
    const f = new ethers.ContractFactory(a.abi, a.bytecode, wallet);
    const c = await f.deploy(rec.implementation, gameSigner, { nonce: nonce++, ...FEES });
    await c.waitForDeployment();
    rec.factory = await c.getAddress();
    rec.gameSigner = gameSigner;
    rec.kitBase = KIT_BASE;
    saveRecord(rec);
    console.log(`[town-kit] LocationLPFactoryV2: ${rec.factory}`);
    await sleep(4000);
  }
  const factory = new ethers.Contract(rec.factory, FACTORY_ABI, wallet);

  // ── 2) the kit ──
  if (!rec.kits[name]) {
    const used = Object.values(rec.kits).map((k) => k.kitId);
    const kitId = used.length ? Math.max(...used) + 1 : KIT_BASE + 1;
    rec.kits[name] = { kitId, size, createdAt: new Date().toISOString(), placedAt: null, hex: null, pools: {} };
    saveRecord(rec);
  }
  const kit = rec.kits[name];
  if (kit.size !== size) { console.error(`kit ${name} already exists with size=${kit.size}`); process.exit(1); }
  console.log(`[town-kit] kit "${name}" id=${kit.kitId}`);

  for (const g of tmpl.goods) {
    const spec = GOODS[g];
    const coinAddr = COIN[spec.coin];
    kit.pools[g] = kit.pools[g] || {};
    const p = kit.pools[g];

    // create — re-sync from the registry first so a recorded-late create never repeats
    if (!p.pool) {
      const existing = await retryRead(() => factory.getPool(kit.kitId, spec.addr, coinAddr), `getPool ${g}`);
      if (existing && existing !== ethers.ZeroAddress) {
        p.pool = existing;
      } else {
        const tx = await factory.createPool(kit.kitId, spec.addr, coinAddr, FEE_BPS, BigInt(tmpl.maxSwapIn) * ONE, COOLDOWN, { nonce: nonce++, gasLimit: 600000, ...FEES });
        const rcpt = await tx.wait();
        // the receipt's own PoolCreated event carries the address — no registry polling
        const ev = rcpt.logs.map((l) => { try { return factory.interface.parseLog(l); } catch (e) { return null; } })
          .find((l) => l && l.name === 'PoolCreated');
        if (!ev) { console.error(`createPool ${g}: no PoolCreated event in receipt ${tx.hash} — stopping`); process.exit(1); }
        p.pool = ev.args.pool;
        p.createTx = tx.hash;
      }
      p.good = spec.addr; p.coin = spec.coin; p.coinAddr = coinAddr; p.price = spec.price;
      saveRecord(rec);
      console.log(`  created ${g}: ${p.pool}`);
      await sleep(4000);
    }

    // seed (good units + coin units*price, mapped onto sorted token0/token1)
    if (!p.seeded) {
      const pool = new ethers.Contract(p.pool, POOL_ABI, wallet);
      const [r0] = await retryRead(() => pool.getReserves(), `getReserves ${g}`);
      if (r0 > 0n) { p.seeded = true; saveRecord(rec); continue; } // seeded in a prior run
      const goodAmt = BigInt(tmpl.units) * ONE;
      const coinAmt = BigInt(tmpl.units * spec.price) * ONE;
      // token0 = lower address (mirrors the factory's sort) — no on-chain read needed
      const goodIsT0 = BigInt(spec.addr) < BigInt(coinAddr);
      const [amount0, amount1] = goodIsT0 ? [goodAmt, coinAmt] : [coinAmt, goodAmt];

      // exact approvals only
      for (const [addr, amt] of [[spec.addr, goodAmt], [coinAddr, coinAmt]]) {
        const erc = new ethers.Contract(addr, ERC20_ABI, wallet);
        const cur = await retryRead(() => erc.allowance(me, p.pool), `allowance ${g}`);
        if (cur < amt) {
          const atx = await erc.approve(p.pool, amt, { nonce: nonce++, gasLimit: 80000, ...FEES });
          await atx.wait();
          await sleep(2000);
        }
      }
      const stx = await pool.seed(amount0, amount1, { nonce: nonce++, gasLimit: 250000, ...FEES });
      await stx.wait();
      p.seeded = true; p.seedTx = stx.hash; p.units = tmpl.units;
      saveRecord(rec);
      console.log(`  seeded  ${g}: ${tmpl.units} + ${tmpl.units * spec.price} ${spec.coin}`);
      await sleep(4000);
    }
  }

  console.log(`[town-kit] DONE — kit "${name}" (${size}) built UNPLACED: ${Object.keys(kit.pools).length} pools.`);
  console.log(`[town-kit] drop it later with: node deploy/drop-town.js --town ${name} --hex <q*1000+r> --execute`);
}

main().catch((e) => { console.error('[town-kit] FAILED:', e.shortMessage || e.message); process.exit(1); });
