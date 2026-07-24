// ============================================================
//  deploy-commission-booth.cjs — deploy CommissionBooth on Base (chainId 8453).
//
//  CommissionBooth is the Bankr songsmith entrypoint: a fan approves their band
//  token, calls commission(bandId, idea, handle), contract pulls the price
//  straight to projectWallet (holds nothing), emits Commissioned.  The off-chain
//  watcher picks up the event and feeds the songsmith queue.
//
//  House rules: node script + AGENT_PRIVATE_KEY from .env; artifacts from
//  Hardhat build (NOT HTML, NOT Remix). Loud failures, no silent catch.
//
//  ── FLAGS ────────────────────────────────────────────────────────────────────
//    (none)                DRY  — prints the full plan + band table, sends nothing.
//    --live --mainnet      BROADCAST the deploy + all 14 setBand calls.
//                          --live REQUIRES --mainnet against a non-localhost RPC.
//                          On success writes deploy/commission-booth-deployed.json.
//
//  ── HOW TO FIRE (founder step, after contract is confirmed on-chain) ─────────
//    ! node deploy/deploy-commission-booth.cjs --live --mainnet
//
//  PREREQUISITES
//    1. Run `npx hardhat compile` first (artifacts must exist).
//    2. AGENT_PRIVATE_KEY set in .env (the project/agent wallet).
//    3. Wallet must hold enough ETH on Base (~0.001 ETH is plenty; 15 setBand
//       calls + 1 deploy ≈ well under 0.001 ETH total at 0.2 gwei).
// ============================================================
'use strict';
const fs   = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const LIVE    = process.argv.includes('--live');
const MAINNET = process.argv.includes('--mainnet');

// ── Band roster ──────────────────────────────────────────────────────────────
// Addresses verified against project memory / nft-lp-database.
// Price = 100 000 tokens × 1e18 per token (18-dec ERC20s).
// "Fixed count, cost rises with the token's value" — price constant in token units.
const PRICE = 100_000n * 10n ** 18n;  // 100 000 × 1e18

const BANDS = [
  { id: 1,  symbol: 'EBM',     token: '0xF113fe2A0E1181A21fA97B1F52ff232140B7692d' },
  { id: 2,  symbol: 'DD',      token: '0xa77D43A33AD5C50E27fCf27101c9E6aEfE066CE3' },
  { id: 3,  symbol: 'MYCO',    token: '0x36A01B05cf86a170490E3Ba4981eFd12B559a5a3' },
  { id: 4,  symbol: 'MR',      token: '0x8d669b539C7801c1271BC484Bdd8a6084b7788e7' },
  { id: 5,  symbol: 'JS',      token: '0x16Ba11AeDA2Da0eb2C64Ff7d0e74884033Ef2C65' },
  { id: 6,  symbol: 'NN',      token: '0x2beBaBdF57597F3ce75BDC75FAD3C40C4A9Fc8cc' },
  { id: 7,  symbol: 'DGT',     token: '0x52414B7cD2FA723E1c8f9295EB29F16d15aA7BB9' },
  { id: 8,  symbol: 'BONGO',   token: '0x85Dd5183D203CcE70b88234D31f075774AcCC453' },
  { id: 9,  symbol: 'RICKY',   token: '0x95286F2cce3C2de48EB75bB4E2Ec004429F18E53' },
  { id: 10, symbol: 'HT',      token: '0x7B105F45ddaA689AfDa5606628761a9Fb2dCd826' },
  { id: 11, symbol: 'WM',      token: '0x6f45F5cE7027745b1Ab11D5493F187960D00FCfc' },
  { id: 12, symbol: 'BIGGINS', token: '0x7C596a0d594D670ffB256bBfbB5379fC8Cf7d62B' },
  { id: 13, symbol: 'JASMINE', token: '0x3a952eFa41501c0463Cf8Af9f821f8F549f47Edf' },
  { id: 14, symbol: 'RISH',    token: '0x31c600871603bab5d855463E03c6d0a9eB661D26' },
];

// File-pinned: never type project wallet inline — read it from the record below
// and validate via ethers.getAddress.  The project wallet is:
//   0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2
const PROJECT_WALLET_RAW = '0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2';

const RPC      = process.env.ALCHEMY_RPC || process.env.FORK_RPC || 'https://mainnet.base.org';
const REC_PATH = path.join(__dirname, 'commission-booth-deployed.json');
const ART_DIR  = path.join(__dirname, '..', 'artifacts', 'contracts', 'CommissionBooth.sol');
// Base fee must clear basefee; ~0.2 gwei is safe at normal load.
const FEES = {
  maxFeePerGas:         ethers.parseUnits('0.2',  'gwei'),
  maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei'),
};
const log = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);

function loadArtifact() {
  const p = path.join(ART_DIR, 'CommissionBooth.json');
  if (!fs.existsSync(p)) {
    throw new Error('artifact missing — run `npx hardhat compile` first: ' + p);
  }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!j.bytecode || j.bytecode === '0x') throw new Error('empty bytecode for CommissionBooth');
  return { abi: j.abi, bytecode: j.bytecode };
}

function checksumAll() {
  // Validate all band addresses + project wallet up-front (loud, not silent).
  const projectWallet = ethers.getAddress(PROJECT_WALLET_RAW);
  const bands = BANDS.map(b => {
    try {
      return { ...b, token: ethers.getAddress(b.token) };
    } catch (e) {
      throw new Error('invalid token address for ' + b.symbol + ': ' + b.token);
    }
  });
  return { projectWallet, bands };
}

(async () => {
  const isLocalhost = /localhost|127\.0\.0\.1/.test(RPC);
  if (LIVE && !isLocalhost && !MAINNET) {
    throw new Error('SAFETY: --live against a non-localhost RPC requires --mainnet too. Refusing.');
  }

  const { projectWallet, bands } = checksumAll();

  const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1, staticNetwork: true });
  const net = await provider.getNetwork();
  log('chain ' + net.chainId + ' | ' + (LIVE ? 'LIVE DEPLOY' : 'DRY'));
  log('projectWallet: ' + projectWallet);

  // ── DRY ───────────────────────────────────────────────────────────────────
  if (!LIVE) {
    log('');
    log('DRY plan:');
    log('  1. Deploy CommissionBooth(projectWallet=' + projectWallet + ')');
    log('  2. Call setBand(id, token, ' + PRICE.toString() + ', true) for all 14 bands:');
    for (const b of bands) {
      log('     setBand(' + b.id + ', ' + b.token + ', ' + PRICE.toString() + ', true)  // ' + b.symbol);
    }
    log('  3. Write address + all band records to deploy/commission-booth-deployed.json');
    log('');
    log('Estimated cost: ~1 deploy + 14 setBand txs ≈ well under 0.001 ETH at 0.2 gwei on Base.');
    log('');
    log('  To fire:  node deploy/deploy-commission-booth.cjs --live --mainnet');
    log('');
    log('DRY ok. No transactions sent.');
    return;
  }

  // ── LIVE: hard guards ─────────────────────────────────────────────────────
  if (net.chainId !== 8453n) {
    throw new Error('chainId mismatch: got ' + net.chainId + ', expected 8453 (Base). Aborting.');
  }

  let pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) throw new Error('AGENT_PRIVATE_KEY missing in .env');
  pk = pk.startsWith('0x') ? pk : '0x' + pk;
  const wallet = new ethers.Wallet(pk, provider);
  log('signer: ' + wallet.address);

  const eth = await provider.getBalance(wallet.address);
  log('ETH balance: ' + ethers.formatEther(eth));
  if (eth < ethers.parseEther('0.0005')) {
    throw new Error('ETH balance too low (need ~0.001 ETH for deploy + 14 setBand calls)');
  }

  // Guard: refuse to re-deploy if a record already exists.
  if (fs.existsSync(REC_PATH)) {
    const existing = JSON.parse(fs.readFileSync(REC_PATH, 'utf8'));
    if (existing.address) {
      throw new Error(
        'commission-booth-deployed.json already has address ' + existing.address +
        '. Clear the file deliberately if you truly want a new deploy.'
      );
    }
  }

  // ── Deploy ────────────────────────────────────────────────────────────────
  const artifact = loadArtifact();
  log('=== deploying CommissionBooth ===');
  const Factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await Factory.deploy(projectWallet, FEES);
  log('  deploy tx: ' + contract.deploymentTransaction().hash);
  await contract.waitForDeployment();
  const boothAddr = await contract.getAddress();
  log('  CommissionBooth deployed → ' + boothAddr);

  // Verify on-chain (loud if wrong).
  const onChainOwner = await contract.owner();
  const onChainWallet = await contract.projectWallet();
  log('  owner()         = ' + onChainOwner + (onChainOwner === wallet.address ? ' ok' : ' MISMATCH'));
  log('  projectWallet() = ' + onChainWallet + (onChainWallet === projectWallet ? ' ok' : ' MISMATCH'));
  if (onChainOwner !== wallet.address || onChainWallet !== projectWallet) {
    throw new Error('post-deploy readback mismatch — NOT writing record; investigate');
  }

  // ── setBand (14 calls, one at a time — Base free RPC pace) ───────────────
  log('=== setBand calls (14 total) ===');
  const results = [];
  for (const b of bands) {
    log('  setBand(' + b.id + ', ' + b.symbol + ', price, true) …');
    const tx = await contract.setBand(b.id, b.token, PRICE, true, FEES);
    log('    tx: ' + tx.hash);
    await tx.wait();
    // Read back and verify.
    const slot = await contract.bands(b.id);
    if (slot.token.toLowerCase() !== b.token.toLowerCase() || !slot.active) {
      throw new Error('setBand readback failed for ' + b.symbol + ' (id ' + b.id + ')');
    }
    log('    confirmed: token=' + slot.token + ' active=' + slot.active);
    results.push({ id: b.id, symbol: b.symbol, token: b.token, price: PRICE.toString(), active: true, tx: tx.hash });
  }

  // ── Record ────────────────────────────────────────────────────────────────
  const record = {
    address: boothAddr,
    chain: 8453,
    deployedAt: new Date().toISOString(),
    deployTx: contract.deploymentTransaction().hash,
    owner: wallet.address,
    projectWallet,
    bands: results,
  };
  fs.writeFileSync(REC_PATH, JSON.stringify(record, null, 2));
  log('');
  log('DONE. CommissionBooth → ' + boothAddr);
  log('Record written to deploy/commission-booth-deployed.json');
  log('');
  log('Next steps:');
  log('  1. Confirm on Basescan: https://basescan.org/address/' + boothAddr);
  log('  2. Transfer ownership to project multisig / founder wallet if desired.');
  log('  3. Update commission-watcher.cjs with BOOTH_ADDRESS=' + boothAddr);
  log('  4. Update bankr-skills/mft-commission-song/catalog.json with the address.');
})().catch((e) => {
  console.error('ERR', e.reason || e.shortMessage || e.message || e);
  process.exit(1);
});
