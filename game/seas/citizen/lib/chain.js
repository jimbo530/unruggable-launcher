// @ts-check
'use strict';
/**
 * chain.js — shared chain primitives for the First Citizen toolbelt.
 *
 * Loads the Citizen's DEDICATED wallet (../../.citizen-wallet.env → CITIZEN_PRIVATE_KEY), exposes
 * the provider, ERC20 helpers, balances, EXACT-amount approvals, and a guarded swap. Trading is
 * SMALL + PACED + EXACT (memory: small_swaps / exact_approvals) and routes ONLY through the working
 * fill routes the gap scanner picks — never the near-zero sell walls.
 *
 * This module never broadcasts a transaction on its own. executeSwap() only runs when a caller
 * passes execute:true AND CITIZEN_ALLOW_LIVE=1 is set — until the founder funds + flips that on,
 * everything stays DRY (real-or-nothing: we never fake a tx).
 */
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const gs = require('../../gap-scan.js');

// Default = the First Citizen's dedicated wallet. The brain harness drives the OTHER bot profiles
// (brawler/worker/fisher/trader) by setting CITIZEN_WALLET_ENV (which env file to read) and
// CITIZEN_KEY_NAME (the key prefix inside it, e.g. BRAWLER). Unset → the Citizen, byte-for-byte as
// before. This is the ONE knob that re-points every tool at a profile's wallet (no per-tool change).
const ENV_PATH = process.env.CITIZEN_WALLET_ENV
  ? path.resolve(process.env.CITIZEN_WALLET_ENV)
  : path.join(__dirname, '..', '..', '.citizen-wallet.env');
const KEY_NAME = (process.env.CITIZEN_KEY_NAME || 'CITIZEN').toUpperCase();

const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481'; // Uniswap SwapRouter02
const SLIP_BPS = 200n;        // 2% slippage guard
// Hard safety caps (USD notional per single trade) — never exceeded.
const MAX_USD_PER_TRADE = 0.25;
const MIN_USD_PER_TRADE = 0.10;

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
];
const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
];
const MONEY_ABI = ['function deposit(uint256 amount)', 'function redeem(uint256 amount)'];

// WorkClock V2 (Base 8453) — TIME-BASED work tracking. Owner-only writes (the pawn's current owner).
// A JOB target is a job-vault address; a SHIP target is a ship's crew-collection. The guard ladder
// keeper reads currentRun() on a target to pay the time ladder. We use the SAME deployed clock the
// jobs page + clock-crew.cjs use (workclockv2-deployment.json). Reads are free; setWork/clockOut are
// real owner txs — Base-paced, explicit nonce, real-or-nothing (never faked).
const WORKCLOCK = '0xE5DE012B9123C8594abb032471b6E7511f0bC601';
const WORKCLOCK_ABI = [
  'function setWork(address collection,uint256 tokenId,address target,uint8 ttype,uint8 mode)',
  'function clockOut(address collection,uint256 tokenId)',
  'function isEmployed(address,uint256) view returns (bool)',
  'function currentRun(address,uint256) view returns (uint256)',
  'function work(address,uint256) view returns (address target,uint8 ttype,uint8 mode,uint64 startedAt,uint64 accumulated,bool employed)',
];
const PAWN_OWNER_ABI = ['function ownerOf(uint256) view returns (address)'];

// LocationPool (Seize the Seas trade-route AMM, e.g. the ocean fish wall). A swap is GATED by a
// fresh game attestation (the seas-server gameSigner signs that the caller is AT the pool's
// location). We read quote/token0/reserves freely; swap() needs { minOut, expiry, sig } from the
// seas-server's /seas/trade-attest. ADD-ONLY; the buy side fills (gap-scan prices it via quote()).
const LOCATIONPOOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function location() view returns (uint256)',
  'function feeBps() view returns (uint16)',
  'function maxSwapIn() view returns (uint256)',
  'function open() view returns (bool)',
  'function getReserves() view returns (uint256,uint256)',
  'function quote(bool zeroForOne,uint256 amountIn) view returns (uint256)',
  'function swap(bool zeroForOne,uint256 amountIn,uint256 minOut,uint256 expiry,bytes sig) returns (uint256 amountOut)',
];

let _provider = null, _wallet = null;

function provider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(gs.RPC, gs.CHAIN_ID, { staticNetwork: ethers.Network.from(gs.CHAIN_ID) });
  return _provider;
}

/** Load the dedicated wallet. Returns null (never throws) if the env/key is absent — callers report it. */
function loadWallet() {
  if (_wallet) return _wallet;
  if (!fs.existsSync(ENV_PATH)) return null;
  const re = new RegExp(`${KEY_NAME}_PRIVATE_KEY\\s*=\\s*(0x[0-9a-fA-F]{64})`);
  const m = fs.readFileSync(ENV_PATH, 'utf8').match(re);
  if (!m) return null;
  _wallet = new ethers.Wallet(m[1], provider());
  return _wallet;
}

/** Just the address (no key needed beyond the env). */
function walletAddress() {
  const w = loadWallet();
  if (w) return w.address;
  if (!fs.existsSync(ENV_PATH)) return null;
  const re = new RegExp(`${KEY_NAME}_ADDRESS\\s*=\\s*(0x[0-9a-fA-F]{40})`);
  const m = fs.readFileSync(ENV_PATH, 'utf8').match(re);
  return m ? m[1] : null;
}

const erc = (addr) => new ethers.Contract(addr, ERC20_ABI, provider());

/** Read the Citizen's key balances (human numbers). Read-only. */
async function balances(addr) {
  const a = addr || walletAddress();
  if (!a) return null;
  const [eth, usdc, money, gold, copper, silver] = await Promise.all([
    provider().getBalance(a),
    erc(gs.ADDR.usdc).balanceOf(a),
    erc(gs.ADDR.money).balanceOf(a),
    erc(gs.COIN_ADDR.gold).balanceOf(a),
    erc(gs.COIN_ADDR.copper).balanceOf(a),
    erc(gs.COIN_ADDR.silver).balanceOf(a),
  ]);
  const f = (v, d) => Number(ethers.formatUnits(v, d));
  return {
    address: a,
    eth: f(eth, 18), usdc: f(usdc, 6), money: f(money, 6),
    gold: f(gold, 18), copper: f(copper, 18), silver: f(silver, 18),
  };
}

/** Approve EXACTLY `amount` (never MaxUint256). Skips if already sufficient. Live tx. */
async function ensureAllowance(tokenAddr, spender, amount, fees, nonceRef) {
  const w = loadWallet();
  const c = new ethers.Contract(tokenAddr, ERC20_ABI, w);
  const cur = await c.allowance(w.address, spender);
  if (cur >= amount) return null;
  const tx = await c.approve(spender, amount, { ...fees, nonce: nonceRef.n++, gasLimit: 80000 });
  await tx.wait();
  return tx.hash;
}

/**
 * Execute ONE guarded single-hop swap (tokenIn→tokenOut, fee). LIVE — broadcasts.
 * Refuses unless execute===true AND CITIZEN_ALLOW_LIVE=1. Exact approval, slippage-guarded,
 * Base-paced fees. Never called in DRY mode.
 */
async function executeSwap({ tokenIn, tokenOut, fee, amountInWei, quotedOutWei }) {
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live trading disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
  const w = loadWallet();
  if (!w) throw new Error('no Citizen wallet loaded');
  const fees = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const nonceRef = { n: await provider().getTransactionCount(w.address, 'pending') };
  await ensureAllowance(tokenIn, ROUTER, amountInWei, fees, nonceRef);
  const minOut = (quotedOutWei * (10000n - SLIP_BPS)) / 10000n;
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, w);
  const tx = await router.exactInputSingle(
    { tokenIn, tokenOut, fee, recipient: w.address, amountIn: amountInWei, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n },
    { ...fees, nonce: nonceRef.n++, gasLimit: 300000 },
  );
  const rc = await tx.wait();
  return rc.hash;
}

// ── WorkClock V2 helpers (read-only contract + owner-gated writes) ──────────────────────────────
/** Read-only WorkClock contract (no key needed). */
function workClock() { return new ethers.Contract(WORKCLOCK, WORKCLOCK_ABI, provider()); }

/** Read-only pawn-collection contract for ownerOf (auth check). */
function pawnOwner(collection) { return new ethers.Contract(collection, PAWN_OWNER_ABI, provider()); }

/**
 * Read a pawn's full work record from WorkClock V2. Read-only.
 * @returns {Promise<{target:string, ttype:number, mode:number, startedAt:number, accumulatedSecs:number, employed:boolean, currentRunSecs:number}>}
 */
async function readWork(collection, tokenId) {
  const wc = workClock();
  const [w, run] = await Promise.all([
    wc.work(collection, tokenId),
    wc.currentRun(collection, tokenId),
  ]);
  return {
    target: w[0],
    ttype: Number(w[1]),
    mode: Number(w[2]),
    startedAt: Number(w[3]),
    accumulatedSecs: Number(w[4]),
    employed: !!w[5],
    currentRunSecs: Number(run),
  };
}

/**
 * Clock a pawn INTO a job/ship via WorkClock V2.setWork. LIVE — broadcasts an owner tx.
 * Refuses unless CITIZEN_ALLOW_LIVE=1. Verifies on-chain that THIS wallet owns the pawn FIRST
 * (the contract enforces it too — we surface a clear error rather than a revert). Base-paced fee,
 * explicit nonce, gas 120k (matches clock-crew.cjs). Never faked: throws loudly on any failure.
 * @param {string} collection pawn NFT collection
 * @param {number|bigint} tokenId
 * @param {string} target job-vault (JOB) or ship crew-collection (SHIP)
 * @param {0|1} ttype 0=JOB, 1=SHIP
 * @param {1|2} mode 1=single, 2=double payout route
 * @returns {Promise<string>} tx hash
 */
async function setWork(collection, tokenId, target, ttype, mode) {
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
  const w = loadWallet();
  if (!w) throw new Error('no wallet loaded — run init-wallet.js + fund');
  const owner = await pawnOwner(collection).ownerOf(tokenId);
  if (owner.toLowerCase() !== w.address.toLowerCase()) throw new Error(`refusing setWork: pawn #${tokenId} owner ${owner} != this wallet ${w.address} (WorkClock is owner-only)`);
  const fees = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const nonce = await provider().getTransactionCount(w.address, 'pending');
  const wc = new ethers.Contract(WORKCLOCK, WORKCLOCK_ABI, w);
  const tx = await wc.setWork(collection, tokenId, target, ttype, mode, { ...fees, nonce, gasLimit: 120000 });
  const rc = await tx.wait();
  return rc.hash;
}

/** Clock a pawn OUT via WorkClock V2.clockOut. LIVE owner tx; same guards as setWork. */
async function clockOut(collection, tokenId) {
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
  const w = loadWallet();
  if (!w) throw new Error('no wallet loaded — run init-wallet.js + fund');
  const owner = await pawnOwner(collection).ownerOf(tokenId);
  if (owner.toLowerCase() !== w.address.toLowerCase()) throw new Error(`refusing clockOut: pawn #${tokenId} owner ${owner} != this wallet ${w.address} (WorkClock is owner-only)`);
  const fees = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const nonce = await provider().getTransactionCount(w.address, 'pending');
  const wc = new ethers.Contract(WORKCLOCK, WORKCLOCK_ABI, w);
  const tx = await wc.clockOut(collection, tokenId, { ...fees, nonce, gasLimit: 100000 });
  const rc = await tx.wait();
  return rc.hash;
}

// ── LocationPool (gated custom AMM, e.g. the ocean fish wall) ──────────────────────────────────
/** Read-only LocationPool contract. */
function locationPool(addr) { return new ethers.Contract(addr, LOCATIONPOOL_ABI, provider()); }

/**
 * Read a LocationPool's state (token0/1, location, fee, cap, open, reserves). Read-only.
 * @returns {Promise<{token0:string, token1:string, location:number, feeBps:number, maxSwapIn:bigint, open:boolean, reserve0:bigint, reserve1:bigint}>}
 */
async function readLocationPool(addr) {
  const c = locationPool(addr);
  const [t0, t1, loc, fee, cap, open, res] = await Promise.all([
    c.token0(), c.token1(), c.location(), c.feeBps(), c.maxSwapIn(), c.open(), c.getReserves(),
  ]);
  return { token0: t0, token1: t1, location: Number(loc), feeBps: Number(fee), maxSwapIn: cap, open: !!open, reserve0: res[0], reserve1: res[1] };
}

/** Quote a LocationPool swap (read-only): amountIn → amountOut for the given direction. */
async function quoteLocationPool(addr, zeroForOne, amountInWei) {
  return await locationPool(addr).quote(zeroForOne, amountInWei);
}

/**
 * Execute a GATED LocationPool swap (e.g. buy FISH with GOLD at the ocean wall). LIVE — broadcasts.
 * Refuses unless CITIZEN_ALLOW_LIVE=1. The attestation { expiry, sig } MUST come from the
 * seas-server (proves the caller is AT the pool's location) — we never forge it. Exact approval on
 * tokenIn, slippage-guarded minOut, Base-paced fee, explicit nonce. Real-or-nothing.
 * @param {object} a
 * @param {string} a.pool        LocationPool address
 * @param {string} a.tokenIn     token being spent (e.g. GOLD)
 * @param {boolean} a.zeroForOne true = token0 in / token1 out (must match tokenIn vs pool.token0)
 * @param {bigint} a.amountInWei
 * @param {bigint} a.quotedOutWei from quoteLocationPool (used for slippage minOut)
 * @param {number} a.expiry      attestation expiry (unix seconds) from the seas-server
 * @param {string} a.sig         gameSigner attestation from the seas-server
 * @returns {Promise<string>} tx hash
 */
async function swapLocationPool({ pool, tokenIn, zeroForOne, amountInWei, quotedOutWei, expiry, sig }) {
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
  if (!sig || !expiry) throw new Error('missing game attestation { expiry, sig } — must be at the pool location (seas-server trade-attest); refusing to forge presence');
  const w = loadWallet();
  if (!w) throw new Error('no wallet loaded — run init-wallet.js + fund');
  const fees = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const nonceRef = { n: await provider().getTransactionCount(w.address, 'pending') };
  await ensureAllowance(tokenIn, pool, amountInWei, fees, nonceRef); // exact approval
  const minOut = (quotedOutWei * (10000n - SLIP_BPS)) / 10000n;
  const c = new ethers.Contract(pool, LOCATIONPOOL_ABI, w);
  const tx = await c.swap(zeroForOne, amountInWei, minOut, expiry, sig, { ...fees, nonce: nonceRef.n++, gasLimit: 250000 });
  const rc = await tx.wait();
  return rc.hash;
}

// ── HarvestGround (the skill+flow-gated CATCH dispenser) ────────────────────────────────────────
// A catch is NOT a swap: the server (seas-server /seas/harvest) verifies co-location + skill + supply,
// computes the deterministic amount, and SIGNS a HarvestGround authorization. dispense() releases EXACTLY
// that amount of the resource to ownerOf(tokenId) against the signature — no token-in, no approval, no
// price. We never forge the authorization (it must come from the server). Real-or-nothing.
const HARVESTGROUND_ABI = [
  'function gameSigner() view returns (address)',
  'function isResource(address) view returns (bool)',
  'function stockOf(address) view returns (uint256)',
  'function readyAt(address,uint256) view returns (uint256)',
  'function usedNonce(bytes32) view returns (bool)',
  'function dispense(address collection,uint256 tokenId,address resource,uint256 amount,uint256 expiry,bytes32 nonce,bytes sig) returns (uint256)',
];

/** Read-only HarvestGround contract. */
function harvestGround(addr) { return new ethers.Contract(addr, HARVESTGROUND_ABI, provider()); }

/** Read a ground's stock of a resource (wei) + whether it's a registered resource. Read-only. */
async function readGroundStock(ground, resource) {
  const g = harvestGround(ground);
  const [isRes, stock] = await Promise.all([g.isResource(resource), g.stockOf(resource)]);
  return { isResource: !!isRes, stock };
}

/**
 * Execute a CATCH via HarvestGround.dispense, using a server-signed authorization. LIVE — broadcasts.
 * Refuses unless CITIZEN_ALLOW_LIVE=1. The { amount, expiry, nonce, sig } MUST come from the seas-server
 * /seas/harvest (proves co-location + skill + supply + the server-computed amount) — we never forge it.
 * No token approval needed (the ground holds the stock; it pays ownerOf(tokenId)). Base-paced, explicit
 * nonce. Real-or-nothing: throws loudly on any failure.
 * @param {{ground:string, collection:string, tokenId:string|number|bigint, resource:string,
 *           amount:string|bigint, expiry:number, nonce:string, sig:string}} a
 * @returns {Promise<string>} tx hash
 */
async function dispenseHarvest(a) {
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
  if (!a || !a.sig || !a.expiry || !a.nonce || a.amount === undefined) throw new Error('missing server catch authorization { amount, expiry, nonce, sig } — must come from seas-server /seas/harvest; refusing to forge a catch');
  const w = loadWallet();
  if (!w) throw new Error('no wallet loaded — run init-wallet.js + fund');
  const fees = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const nonce = await provider().getTransactionCount(w.address, 'pending');
  const g = new ethers.Contract(a.ground, HARVESTGROUND_ABI, w);
  const tx = await g.dispense(a.collection, a.tokenId, a.resource, BigInt(a.amount), a.expiry, a.nonce, a.sig, { ...fees, nonce, gasLimit: 180000 });
  const rc = await tx.wait();
  return rc.hash;
}

// ── StructureFactory (the BUILD keystone — pay GOLD -> structure NFT + its own WaterV2 endowment) ──
// FOUNDER-GATED deploy: the factory address is read from MfT-Launch/deploy/structure-factory-
// deployment.json (written by deploy-structure-factory.cjs --live). Until that file exists, the
// factory is NOT deployed and build.js stays DRY (real-or-nothing — never fakes a build). Reads are
// free; build() is a real GOLD-spending tx, so it self-gates on CITIZEN_ALLOW_LIVE=1 + exact
// approval + a caller-supplied minMoneyOut (priced off the live GOLD/Money pool by build.js).
const STRUCTUREFACTORY_ABI = [
  'function kindCount() view returns (uint256)',
  'function kindIdAt(uint256) view returns (bytes32)',
  'function kinds(bytes32) view returns (bool exists,string label,uint256 goldCost,address producedGood,address endowmentVault)',
  'function structureCount() view returns (uint256)',
  'function structures(uint256) view returns (bytes32 kind,uint256 loc,uint256 seedWater,uint256 treeId,bool sealed_,string structName)',
  'function ownerOf(uint256) view returns (address)',
  'function build(string kindId,uint256 loc,string structName,uint256 minMoneyOut) returns (uint256)',
  'function seal(uint256 tokenId)',
  'function reclaimSeed(uint256 tokenId)',
];

/** Read the deployed StructureFactory address from the deploy record, or null if not deployed yet. */
function structureFactoryAddress() {
  const p = path.join(__dirname, '..', '..', '..', '..', 'deploy', 'structure-factory-deployment.json');
  if (!fs.existsSync(p)) return null;
  try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return j.structureFactory || null; }
  catch (e) { throw new Error(`could not read structure-factory-deployment.json: ${e.message}`); } // visible, never silent
}

/** Read-only StructureFactory contract (no key needed). Returns null if not deployed. */
function structureFactory() {
  const addr = structureFactoryAddress();
  return addr ? new ethers.Contract(addr, STRUCTUREFACTORY_ABI, provider()) : null;
}

/**
 * Build a structure on-chain via the StructureFactory. LIVE — broadcasts (pays GOLD).
 * Refuses unless CITIZEN_ALLOW_LIVE=1 AND the factory is deployed. The caller MUST pass goldCost
 * (the kind's exact gold cost, read on-chain) so we approve EXACTLY that — never MaxUint256 — and
 * minMoneyOut (priced off the live GOLD/Money pool by build.js) for slippage. Base-paced fee,
 * explicit nonce, real-or-nothing.
 * @param {{kindId:string, loc:number|bigint, structName:string, goldCostWei:bigint, minMoneyOutWei:bigint}} a
 * @returns {Promise<string>} tx hash
 */
async function buildStructure(a) {
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
  const addr = structureFactoryAddress();
  if (!addr) throw new Error('StructureFactory not deployed (no deploy/structure-factory-deployment.json) — building is founder-gated; refusing to fake a build');
  if (!a || !a.kindId || !a.goldCostWei || !a.minMoneyOutWei) throw new Error('buildStructure needs { kindId, loc, structName, goldCostWei, minMoneyOutWei }');
  const w = loadWallet();
  if (!w) throw new Error('no wallet loaded — run init-wallet.js + fund');
  const fees = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const nonceRef = { n: await provider().getTransactionCount(w.address, 'pending') };
  await ensureAllowance(gs.COIN_ADDR.gold, addr, a.goldCostWei, fees, nonceRef); // EXACT gold approval
  const sf = new ethers.Contract(addr, STRUCTUREFACTORY_ABI, w);
  const tx = await sf.build(a.kindId, BigInt(a.loc || 0), a.structName || '', a.minMoneyOutWei,
    { ...fees, nonce: nonceRef.n++, gasLimit: 900000 });
  const rc = await tx.wait();
  return rc.hash;
}

// ── WaterV2 vault (the LEVEL / FLOW endowment that drives the class-engine + job wages) ─────────
// depositAndWater(treeId, usdcAmount) LOCKS USDC as a pawn-tree's permanent backing (BY DESIGN =
// endowment; the USDC is supplied to Aave and never withdrawn). $1 (1e6 USDC) = 1 water = 1 level.
// treeIdFor(collection,tokenId) returns treeId+1 (0 = unplanted); plantTree registers the NFT as a
// tree (idempotent). TWO live vaults share this exact ABI but DIFFERENT downstream meaning:
//   • 0x9789…f8B2  = generic WATER vault (_diffuse base LEVEL; what the class-engine reads).
//   • 0x44c504Ce…  = MayorVault = the Guard-the-Port JOB vault (its harvest buys cbBTC → 45% systems
//                    → the Mayor prize-pool tap = the JOB-WAGE/FLOW source). Watering here lights
//                    wages, not the generic level. (Verified: water-crew.cjs waters HERE; deckhand-
//                    pawns.cjs waters the LEVEL vault.) water-pawn.js exposes both and labels them.
const WATER_LEVEL_VAULT = '0x9789c459f08896148E8D1a8b2B7a4Bb95FAAf8B2';
const WATER_FLOW_VAULT  = '0x44c504Ce08635536635f153B6Ae5d9D6d8b3131F';
const WATER_ABI = [
  'function plantTree(address collection,uint256 tokenId) returns (uint256)',
  'function depositAndWater(uint256 treeId,uint256 usdcAmount)',
  'function treeIdFor(address collection,uint256 tokenId) view returns (uint256)', // treeId+1, 0=unplanted
  'function treeWater(uint256 treeId) view returns (uint256)',
];

/** Read-only WaterV2 vault contract. */
function waterVault(addr) { return new ethers.Contract(addr, WATER_ABI, provider()); }

/**
 * Read a pawn's planted state + current water (level) in a vault. Read-only.
 * @returns {Promise<{planted:boolean, treeId:bigint|null, waterWei:bigint, waterUsd:number}>}
 */
async function readWater(vaultAddr, collection, tokenId) {
  const v = waterVault(vaultAddr);
  const tp = await v.treeIdFor(collection, tokenId); // treeId+1
  if (tp === 0n) return { planted: false, treeId: null, waterWei: 0n, waterUsd: 0 };
  const treeId = tp - 1n;
  const waterWei = await v.treeWater(treeId);
  return { planted: true, treeId, waterWei, waterUsd: Number(ethers.formatUnits(waterWei, 6)) };
}

/**
 * Plant + water a pawn-tree in a WaterV2 vault from the Citizen wallet. LIVE — broadcasts (spends USDC).
 * Refuses unless CITIZEN_ALLOW_LIVE=1. Verifies the wallet OWNS the pawn first (clear error, not a
 * revert). Approves EXACTLY usdcAmountWei to the vault (never MaxUint256). plantTree is idempotent
 * (only if unplanted). depositAndWater needs ~600k gas (Aave supply — 200k starves it; learned the
 * hard way in water-crew.cjs). Base-paced fee, explicit nonces, await each. Real-or-nothing.
 * @param {{vault:string, collection:string, tokenId:number|bigint, usdcAmountWei:bigint}} a
 * @returns {Promise<{plantTx:string|null, waterTx:string, treeId:bigint}>}
 */
async function waterPawn(a) {
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
  if (!a || !a.vault || !a.collection || a.usdcAmountWei === undefined) throw new Error('waterPawn needs { vault, collection, tokenId, usdcAmountWei }');
  if (a.usdcAmountWei <= 0n) throw new Error('usdcAmountWei must be > 0');
  const w = loadWallet();
  if (!w) throw new Error('no Citizen wallet loaded — run init-wallet.js + fund');
  const owner = await pawnOwner(a.collection).ownerOf(a.tokenId);
  if (owner.toLowerCase() !== w.address.toLowerCase()) throw new Error(`refusing water: pawn #${a.tokenId} owner ${owner} != this wallet ${w.address} (water the pawns you hold)`);
  // Must actually hold the USDC (exact-spend; never a partial/failed leg).
  const usdcBal = await erc(gs.ADDR.usdc).balanceOf(w.address);
  if (usdcBal < a.usdcAmountWei) throw new Error(`insufficient USDC: have ${ethers.formatUnits(usdcBal, 6)}, need ${ethers.formatUnits(a.usdcAmountWei, 6)} — fund via convert-winnings.js (cbBTC→USDC) first`);

  const fees = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const nonceRef = { n: await provider().getTransactionCount(w.address, 'pending') };
  const vaultW = new ethers.Contract(a.vault, WATER_ABI, w);

  // 1) plant (idempotent — only if unplanted)
  let plantTx = null;
  let tp = await vaultW.treeIdFor(a.collection, a.tokenId);
  if (tp === 0n) {
    const ptx = await vaultW.plantTree(a.collection, a.tokenId, { ...fees, nonce: nonceRef.n++, gasLimit: 240000 });
    await ptx.wait();
    plantTx = ptx.hash;
    tp = await vaultW.treeIdFor(a.collection, a.tokenId);
    if (tp === 0n) throw new Error('plant failed (treeIdFor still 0) — refusing to water an unplanted tree');
  }
  const treeId = tp - 1n;

  // 2) exact approval (never MaxUint) then depositAndWater (Aave supply → ~600k gas)
  await ensureAllowance(gs.ADDR.usdc, a.vault, a.usdcAmountWei, fees, nonceRef);
  const wtx = await vaultW.depositAndWater(treeId, a.usdcAmountWei, { ...fees, nonce: nonceRef.n++, gasLimit: 600000 });
  await wtx.wait();
  return { plantTx, waterTx: wtx.hash, treeId };
}

/**
 * Plant a pawn as a tree in a WaterV2 vault (REGISTER only — no watering, no USDC). LIVE owner tx.
 * Used by the dockside sign-on flow: WaterV2.plantTree is PERMISSIONLESS + idempotent (see WaterV2.sol
 * — no admin gate), so a mixed-crew rower's (collection,tokenId) is planted by the PLAYER's own wallet.
 * Registering a tree gives it 0 shares (no backing, no free income) — the row-token PAYOUT only flows
 * once the oars are FUNDED (the founder-gated sail->row bridge), so this never creates income by itself.
 * Refuses unless CITIZEN_ALLOW_LIVE=1; verifies the wallet OWNS the pawn first (clear error, not a revert).
 * @param {{vault:string, collection:string, tokenId:number|bigint}} a
 * @returns {Promise<{plantTx:string|null, treeId:bigint, alreadyPlanted:boolean}>}
 */
async function plantPawn(a) {
  if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
  if (!a || !a.vault || !a.collection || a.tokenId === undefined) throw new Error('plantPawn needs { vault, collection, tokenId }');
  const w = loadWallet();
  if (!w) throw new Error('no wallet loaded — run init-wallet.js + fund');
  const owner = await pawnOwner(a.collection).ownerOf(a.tokenId);
  if (owner.toLowerCase() !== w.address.toLowerCase()) throw new Error(`refusing plant: pawn #${a.tokenId} owner ${owner} != this wallet ${w.address} (plant only pawns you hold)`);
  const vaultW = new ethers.Contract(a.vault, WATER_ABI, w);
  let tp = await vaultW.treeIdFor(a.collection, a.tokenId); // treeId+1 (0 = unplanted)
  if (tp !== 0n) return { plantTx: null, treeId: tp - 1n, alreadyPlanted: true }; // idempotent — already a tree
  const fees = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
  const nonce = await provider().getTransactionCount(w.address, 'pending');
  const ptx = await vaultW.plantTree(a.collection, a.tokenId, { ...fees, nonce, gasLimit: 240000 });
  await ptx.wait();
  tp = await vaultW.treeIdFor(a.collection, a.tokenId);
  if (tp === 0n) throw new Error('plant failed (treeIdFor still 0) — refusing to report a fake plant');
  return { plantTx: ptx.hash, treeId: tp - 1n, alreadyPlanted: false };
}

module.exports = {
  provider, loadWallet, walletAddress, balances, ensureAllowance, executeSwap, erc,
  ROUTER, MONEY_ABI, MONEY_ADDR: gs.ADDR.money, USDC_ADDR: gs.ADDR.usdc,
  MAX_USD_PER_TRADE, MIN_USD_PER_TRADE, SLIP_BPS, ENV_PATH,
  // WaterV2 vaults (level + flow)
  WATER_LEVEL_VAULT, WATER_FLOW_VAULT, WATER_ABI, waterVault, readWater, waterPawn, plantPawn,
  // WorkClock V2
  WORKCLOCK, workClock, pawnOwner, readWork, setWork, clockOut,
  // LocationPool (ocean fish wall etc.)
  locationPool, readLocationPool, quoteLocationPool, swapLocationPool,
  // HarvestGround (catch dispenser)
  harvestGround, readGroundStock, dispenseHarvest,
  // StructureFactory (build keystone)
  STRUCTUREFACTORY_ABI, structureFactoryAddress, structureFactory, buildStructure,
};
