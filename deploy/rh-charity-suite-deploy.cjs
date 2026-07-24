// ============================================================
//  rh-charity-suite-deploy.cjs — STAGED deploy for the Robinhood Charity Suite
//  on Robinhood Chain (chainId 4663).  BUILD ARTIFACT — funding-gated.
//
//  ⚠️ DO NOT RUN --live WITHOUT: (1) Ethics Officer review, (2) founder's
//     explicit "yes", (3) USDG-sourcing resolved (see build doc §USDG verdict),
//     (4) a MEME LP + router on RH (harvest's web/depositor legs BUY the meme —
//     BLOCKED on 4663 today), (5) agent RH ETH topped up.  DRY default.
//
//  Stages (each recorded to rh-charity-suite-deployed.json, crash-safe/resumable):
//    A. "Money for Trees" vault (CharityVaultMorpho) → charityWallet = 0x0780 (gap-fill)
//    B. "Feeding People" ($FTP) vault (CharityVaultMorpho) → charityWallet = 0x0780
//    C. Little John ($LJ) meme (LittleJohn) → full supply to treasury 0xE2a4
//    D. LJ sell-wall vs $FTP  →  ⛔ BLOCKED: no Uniswap V3 (or any AMM) on 4663.
//       Left as a no-op with a loud skip until an AMM exists on RH.
//
//  Deploy per house rules: node script + agent wallet, artifacts from Hardhat
//  build (NOT an HTML page, NOT Remix). Exact approvals only. No silent catches.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const LIVE = process.argv.includes('--live');
const RH_RPC = process.env.RH_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const A = (s) => ethers.getAddress(s.toLowerCase());

// --- Verified live 4663 addresses (MFT-ROBINHOOD-MORPHO-SCOPE.md) ---
const USDG = A('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');   // 6 dec
const VAULT = A('0xBeEff033F34C046626B8D0A041844C5d1A5409dd');  // Morpho steakUSDG V2

// Wallets
const TREASURY = A('0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10');       // agent/deployer + LJ supply
const PROJECT_WALLET = A('0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2'); // gap-fill charity dest + destination-setter owner

// Vault harvest split (3-way, founder 2026-07-12): default 3333/3334/3333 is
// baked into the contract. The meme-buy legs (1 & 3) need memeToken + router
// wired post-deploy via setMemeWiring — BLOCKED on RH until a meme LP exists.

const ARTIFACTS = path.join(__dirname, '..', 'artifacts', 'contracts');
const OUT = path.join(__dirname, 'rh-charity-suite-deployed.json');
// RH gas: ~0.055 gwei base; keep a modest cap (probe measured 0.108 maxFee).
const FEES = { maxFeePerGas: ethers.parseUnits('0.5', 'gwei'), maxPriorityFeePerGas: 0n };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);

function art(name, file) {
  const p = path.join(ARTIFACTS, file, name + '.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode };
}

(async () => {
  const provider = new ethers.JsonRpcProvider(RH_RPC, undefined, { batchMaxCount: 1, staticNetwork: true });
  const net = await provider.getNetwork();
  if (net.chainId !== 4663n) throw new Error('RH chainId mismatch: got ' + net.chainId + ', expected 4663');
  log('chain 4663 | block ' + await provider.getBlockNumber() + ' | ' + (LIVE ? 'LIVE' : 'DRY'));

  const Vault = art('CharityVaultMorpho', 'CharityVaultMorpho.sol');
  const LJ = art('LittleJohn', 'LittleJohn.sol');

  const INSTANCES = [
    { key: 'moneyForTrees', name: 'Money for Trees', symbol: 'RH', label: 'tree planting' },
    { key: 'feedingPeople', name: 'Feeding People', symbol: 'FTP', label: 'feeding people' },
  ];

  if (!LIVE) {
    log('DRY plan:');
    for (const i of INSTANCES) {
      log('  A/B ' + i.symbol + ' CharityVaultMorpho("' + i.name + '","' + i.symbol + '",');
      log('        usdg=' + USDG + ', vault=' + VAULT + ',');
      log('        charityWallet=' + PROJECT_WALLET + ' (gap-fill), owner=' + PROJECT_WALLET + ',');
      log('        label="' + i.label + '") — split defaults 3333/3334/3333');
      log('        POST-DEPLOY: setMemeWiring(meme,router,lpRecipient) — ⛔ BLOCKED on RH (no meme LP/AMM)');
    }
    log('  C   LittleJohn(treasury=' + TREASURY + ') — 1B $LJ to treasury');
    log('  D   LJ/FTP 1% sell-wall — ⛔ BLOCKED: no AMM on 4663 (see build doc)');
    log('  NOTE harvest() reverts until meme wiring is set — both vaults are inert');
    log('       for the WEB/DEPOSITOR legs until a meme LP + router exist on RH.');
    log('DRY ok — re-run with --live ONLY after Ethics review + founder yes + USDG sourcing + meme-LP + RH gas');
    return;
  }

  // --- LIVE path (gated; requires explicit founder approval upstream) ---
  let pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) throw new Error('AGENT_PRIVATE_KEY missing');
  pk = pk.startsWith('0x') ? pk : '0x' + pk;
  const wallet = new ethers.Wallet(pk, provider);
  if (wallet.address !== TREASURY) throw new Error('signer != treasury (' + wallet.address + ')');
  const gas = await provider.getBalance(wallet.address);
  log('deployer ' + wallet.address + ' | RH ETH ' + ethers.formatEther(gas));
  if (gas < ethers.parseEther('0.0006')) throw new Error('RH ETH too low for suite deploy (~0.00043 ETH needed + buffer)');

  const rec = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { chain: 4663, usdg: USDG, vault: VAULT };

  // Stages A/B — the two vaults
  for (const i of INSTANCES) {
    if (rec[i.key]) { log('skip ' + i.symbol + ' (recorded ' + rec[i.key] + ')'); continue; }
    log('=== deploy ' + i.symbol + ' vault ===');
    const F = new ethers.ContractFactory(Vault.abi, Vault.bytecode, wallet);
    const c = await F.deploy(i.name, i.symbol, USDG, VAULT, PROJECT_WALLET, PROJECT_WALLET, i.label, FEES);
    log('  tx ' + c.deploymentTransaction().hash);
    await c.waitForDeployment();
    rec[i.key] = await c.getAddress();
    fs.writeFileSync(OUT, JSON.stringify(rec, null, 2));
    log('  ' + i.symbol + ' → ' + rec[i.key]);
    await sleep(4000);
  }

  // Stage C — Little John meme
  if (!rec.littleJohn) {
    log('=== deploy Little John ($LJ) ===');
    const F = new ethers.ContractFactory(LJ.abi, LJ.bytecode, wallet);
    const c = await F.deploy(TREASURY, FEES);
    log('  tx ' + c.deploymentTransaction().hash);
    await c.waitForDeployment();
    rec.littleJohn = await c.getAddress();
    fs.writeFileSync(OUT, JSON.stringify(rec, null, 2));
    log('  $LJ → ' + rec.littleJohn + ' (1B to treasury)');
    await sleep(4000);
  } else log('skip $LJ (recorded ' + rec.littleJohn + ')');

  // Stage D — LJ/FTP sell-wall
  log('=== LJ/FTP sell-wall ===');
  log('  ⛔ BLOCKED: no Uniswap V3 / V2 / any AMM deployed on 4663 (verified via');
  log('     rh-probe7-infra: all canonical factory+NPM addresses are empty).');
  log('     The one-sided-wall pattern REQUIRES an NPM+factory. Skipping until an');
  log('     AMM exists on RH, or the wall is placed on Base instead (see build doc).');
  rec.ljWall = { status: 'BLOCKED', reason: 'no AMM on 4663', checkedBlock: await provider.getBlockNumber() };
  fs.writeFileSync(OUT, JSON.stringify(rec, null, 2));

  rec.deployedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(rec, null, 2));
  log('DONE — rh-charity-suite-deployed.json written');
})().catch((e) => { console.error(e.reason || e.shortMessage || e.message); process.exit(1); });
