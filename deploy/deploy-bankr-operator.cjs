// ============================================================
//  deploy-bankr-operator.cjs — deploy BankrLPOperator on Base (chainId 8453).
//
//  BankrLPOperator spins up its OWN fresh LocationLPFactory in its constructor and owns it,
//  so the Bankr agent wallet can create + seed/inject GATED location pools WITHOUT any reach
//  into the LIVE factory (0x54868729…). Ethics: GO-WITH-CHANGES (2026-07-15).
//
//  House rules: node script + agent wallet, artifacts from the Hardhat build (NOT HTML, NOT
//  Remix). Every address is FILE-PINNED from deploy/bankr-lp-deployed.json — no typed address
//  strings live in this script. Exact approvals only. Loud failures, no silent catch.
//
//  ── FLAGS ────────────────────────────────────────────────────────────────────────────────
//    (none)                DRY — prints the plan, sends nothing.
//    --live --mainnet      BROADCAST the deploy. Against a non-localhost RPC, --live REQUIRES
//                          --mainnet (matches the seed-script safety guard). Deploys the
//                          wrapper, echoes factory()/owner()/gameSigner(), asserts on-chain
//                          isolation (factory != live), writes the wrapper addr to the json.
//    --set-operator --live --mainnet
//                          SEPARATE guarded step (Ethics N1). Authorizes the Bankr operator on
//                          an ALREADY-DEPLOYED wrapper (setOperator(bankrOperator, true)) and
//                          echoes operators(bankrOperator). Does NOT deploy. Run this ONLY
//                          after the deploy is confirmed on-chain AND the N3 dust dry-run
//                          (owner createPool + seedPool a throwaway pair, wrapper nets to 0)
//                          has passed. See runDustTest() helper below for the exact recipe.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const LIVE = process.argv.includes('--live');
const MAINNET = process.argv.includes('--mainnet');
const SET_OPERATOR = process.argv.includes('--set-operator');

const RPC = process.env.ALCHEMY_RPC || process.env.FORK_RPC || 'https://mainnet.base.org';
const REC_PATH = path.join(__dirname, 'bankr-lp-deployed.json');
const ARTIFACTS = path.join(__dirname, '..', 'artifacts', 'contracts');
// Base is cheap; keep a modest, basefee-clearing cap (memory: fee must clear basefee ~0.15 gwei).
const FEES = { maxFeePerGas: ethers.parseUnits('0.2', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
const log = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);

function art(name, file) {
  const p = path.join(ARTIFACTS, file, name + '.json');
  if (!fs.existsSync(p)) throw new Error('artifact missing (run `npx hardhat compile`): ' + p);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!j.bytecode || j.bytecode === '0x') throw new Error('empty bytecode for ' + name);
  return { abi: j.abi, bytecode: j.bytecode };
}

// Load + checksum-validate a file-pinned address. Loud throw on any bad/missing value.
function pinnedAddr(rec, key) {
  const v = rec[key];
  if (!v || typeof v !== 'string') throw new Error('bankr-lp-deployed.json missing address for "' + key + '"');
  let checksummed;
  try { checksummed = ethers.getAddress(v); }
  catch (e) { throw new Error('bankr-lp-deployed.json "' + key + '" is not a valid address: ' + v); }
  return checksummed;
}

// Ethics N3 dust dry-run helper (recipe, not auto-run) — printed so the founder can execute it
// by hand with the OWNER wallet BEFORE --set-operator. Kept as a helper for reference/reuse.
function printDustRecipe(wrapperAddr, ownerAddr) {
  log('── N3 DUST DRY-RUN (do this as OWNER ' + ownerAddr + ', BEFORE --set-operator) ──');
  log('  1. Deploy/choose two THROWAWAY ERC20s you already hold (any pair; value can be ~dust).');
  log('  2. OWNER approves the wrapper (' + wrapperAddr + ') for the exact dust amounts of both.');
  log('  3. OWNER calls wrapper.createPool(locId, dustA, dustB, feeBps, maxSwapIn, cooldown).');
  log('  4. OWNER calls wrapper.seedPool(pool, dust0, dust1).');
  log('  5. CONFIRM: pool.getReserves() == (dust0, dust1) AND both dust tokens balanceOf(wrapper) == 0.');
  log('  6. Only if that holds cleanly → run this script with --set-operator --live --mainnet.');
}

(async () => {
  // ── guards ────────────────────────────────────────────────────────────────────────────
  const isLocalhost = /localhost|127\.0\.0\.1/.test(RPC);
  if (LIVE && !isLocalhost && !MAINNET) {
    throw new Error('SAFETY: --live against a non-localhost RPC requires --mainnet too. Refusing to broadcast.');
  }

  const rec = JSON.parse(fs.readFileSync(REC_PATH, 'utf8'));
  const IMPL = pinnedAddr(rec, 'impl');
  const SIGNER = pinnedAddr(rec, 'gameSigner');
  const OWNER = pinnedAddr(rec, 'owner');
  const BANKR = pinnedAddr(rec, 'bankrOperator');
  const LIVE_FACTORY = pinnedAddr(rec, 'liveFactoryDoNotTouch');

  const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1, staticNetwork: true });
  const net = await provider.getNetwork();
  log('chain ' + net.chainId + ' | block ' + (await provider.getBlockNumber()) +
      ' | ' + (SET_OPERATOR ? 'SET-OPERATOR ' : 'DEPLOY ') + (LIVE ? 'LIVE' : 'DRY'));
  log('file-pinned: impl=' + IMPL);
  log('             gameSigner=' + SIGNER);
  log('             owner(treasury)=' + OWNER);
  log('             bankrOperator=' + BANKR);
  log('             liveFactoryDoNotTouch=' + LIVE_FACTORY + '  (never called by this script)');

  const Wrapper = art('BankrLPOperator', 'BankrLPOperator.sol');

  // ── DRY: print the plan for whichever mode, send nothing ────────────────────────────────
  if (!LIVE) {
    if (SET_OPERATOR) {
      const w = rec.operator;
      log('DRY plan (--set-operator): on wrapper ' + (w || '<operator not yet in json>') +
          ' call setOperator(' + BANKR + ', true), then echo operators(' + BANKR + ').');
      if (!w) log('  ⚠️ json.operator is null — deploy first, then re-run --set-operator.');
    } else {
      log('DRY plan (deploy): BankrLPOperator(impl=' + IMPL + ', gameSigner=' + SIGNER + ', owner=' + OWNER + ')');
      log('  ctor deploys a FRESH LocationLPFactory owned by the wrapper (isolated from live).');
      log('  post-deploy: read back factory()/owner()/gameSigner(); assert factory() != ' + LIVE_FACTORY + ';');
      log('  write wrapper addr → operator in bankr-lp-deployed.json.');
      log('  ⛔ does NOT authorize Bankr — that is a separate --set-operator run (Ethics N1).');
      if (rec.operator) log('  NOTE json.operator already set (' + rec.operator + ') — a re-deploy would OVERWRITE it.');
    }
    log('DRY ok — re-run with --live --mainnet to broadcast (Ethics per-tx sign-off required first).');
    return;
  }

  // ── LIVE: hard preconditions ────────────────────────────────────────────────────────────
  if (net.chainId !== 8453n) throw new Error('chainId mismatch: got ' + net.chainId + ', expected 8453 (Base)');
  let pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) throw new Error('AGENT_PRIVATE_KEY missing in .env');
  pk = pk.startsWith('0x') ? pk : '0x' + pk;
  const wallet = new ethers.Wallet(pk, provider);
  if (wallet.address !== OWNER) {
    throw new Error('signer != owner/treasury. signer=' + wallet.address + ' expected=' + OWNER);
  }
  const gas = await provider.getBalance(wallet.address);
  log('signer ' + wallet.address + ' | ETH ' + ethers.formatEther(gas));
  if (gas < ethers.parseEther('0.0005')) throw new Error('ETH too low for deploy (~0.0003 ETH needed + buffer)');

  // ── --set-operator: SEPARATE guarded step (does NOT deploy) ──────────────────────────────
  if (SET_OPERATOR) {
    const wrapperAddr = pinnedAddr(rec, 'operator'); // must be filled by a prior deploy
    const code = await provider.getCode(wrapperAddr);
    if (code === '0x') throw new Error('no contract at json.operator ' + wrapperAddr + ' — deploy first');
    const wrapper = new ethers.Contract(
      wrapperAddr,
      ['function setOperator(address,bool) external', 'function operators(address) view returns (bool)', 'function owner() view returns (address)'],
      wallet
    );
    const onChainOwner = await wrapper.owner();
    if (onChainOwner !== OWNER) throw new Error('wrapper.owner()=' + onChainOwner + ' != treasury ' + OWNER);
    const already = await wrapper.operators(BANKR);
    log('pre: operators(' + BANKR + ') = ' + already);
    if (already) { log('already authorized — nothing to do.'); return; }
    log('setOperator(' + BANKR + ', true) …');
    const tx = await wrapper.setOperator(BANKR, true, FEES);
    log('  tx ' + tx.hash);
    await tx.wait();
    const nowAuthed = await wrapper.operators(BANKR);
    log('post: operators(' + BANKR + ') = ' + nowAuthed);
    if (!nowAuthed) throw new Error('setOperator did not take effect');
    rec.bankrOperatorAuthorized = true;
    rec.bankrOperatorAuthorizedAt = new Date().toISOString();
    fs.writeFileSync(REC_PATH, JSON.stringify(rec, null, 2));
    log('DONE — Bankr operator authorized; bankr-lp-deployed.json updated.');
    return;
  }

  // ── LIVE deploy ─────────────────────────────────────────────────────────────────────────
  if (rec.operator) {
    throw new Error('json.operator already set (' + rec.operator + '). Refusing to re-deploy over a recorded wrapper. Clear it deliberately if you truly want a new one.');
  }
  log('=== deploy BankrLPOperator ===');
  const F = new ethers.ContractFactory(Wrapper.abi, Wrapper.bytecode, wallet);
  const c = await F.deploy(IMPL, SIGNER, OWNER, FEES);
  log('  tx ' + c.deploymentTransaction().hash);
  await c.waitForDeployment();
  const wrapperAddr = await c.getAddress();
  log('  BankrLPOperator → ' + wrapperAddr);

  // ── POST-DEPLOY safety echo + on-chain isolation check ──────────────────────────────────
  const readback = new ethers.Contract(
    wrapperAddr,
    ['function factory() view returns (address)', 'function owner() view returns (address)'],
    provider
  );
  const freshFactory = await readback.factory();
  const wOwner = await readback.owner();
  const factoryC = new ethers.Contract(freshFactory, ['function gameSigner() view returns (address)', 'function owner() view returns (address)', 'function implementation() view returns (address)'], provider);
  const fSigner = await factoryC.gameSigner();
  const fOwner = await factoryC.owner();
  const fImpl = await factoryC.implementation();

  log('── readback ──');
  log('  wrapper.owner()      = ' + wOwner + (wOwner === OWNER ? ' ✅' : ' ❌ expected ' + OWNER));
  log('  wrapper.factory()    = ' + freshFactory + ' (fresh)');
  log('  factory.owner()      = ' + fOwner + (fOwner === wrapperAddr ? ' ✅ (== wrapper)' : ' ❌ expected wrapper'));
  log('  factory.gameSigner() = ' + fSigner + (fSigner === SIGNER ? ' ✅' : ' ❌ expected ' + SIGNER));
  log('  factory.impl()       = ' + fImpl + (fImpl === IMPL ? ' ✅' : ' ❌ expected ' + IMPL));

  // Hard isolation assertion (on-chain): the fresh factory must NOT be the live one.
  if (freshFactory.toLowerCase() === LIVE_FACTORY.toLowerCase()) {
    throw new Error('ISOLATION FAILURE: fresh factory == live factory ' + LIVE_FACTORY + ' — aborting record write');
  }
  if (wOwner !== OWNER || fOwner !== wrapperAddr || fSigner !== SIGNER || fImpl !== IMPL) {
    throw new Error('post-deploy readback mismatch (see ❌ above) — NOT writing record; investigate before use');
  }
  log('  isolation OK: fresh factory ' + freshFactory + ' != live ' + LIVE_FACTORY);

  // ── record ──────────────────────────────────────────────────────────────────────────────
  rec.operator = wrapperAddr;
  rec.freshFactory = freshFactory;
  rec.deployedAt = new Date().toISOString();
  rec.deployTx = c.deploymentTransaction().hash;
  fs.writeFileSync(REC_PATH, JSON.stringify(rec, null, 2));
  log('DONE — wrapper recorded in bankr-lp-deployed.json.');
  log('  ⛔ Bankr NOT yet authorized. Next: N3 dust dry-run (below), THEN --set-operator --live --mainnet.');
  printDustRecipe(wrapperAddr, OWNER);
})().catch((e) => { console.error('ERR', e.reason || e.shortMessage || e.message); process.exit(1); });
