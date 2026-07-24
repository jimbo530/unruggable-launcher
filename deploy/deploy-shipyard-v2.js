/* ════════════════════════════════════════════════════════════════════════════
 *  ⚠️  REVIEW BEFORE RUNNING.  ⚠️
 *
 *  This script BROADCASTS REAL TRANSACTIONS TO BASE MAINNET when run with
 *  --broadcast (or BROADCAST=1). It deploys ShipyardV2 (dynamic crew metadata)
 *  + a new Dock, which INCLUDE the fee-share "crew" NFTs that Guardian has
 *  flagged as a POSSIBLE SECURITY / profit-sharing instrument — see
 *  docs/fee-share-nft-spec.md.
 *
 *  DO NOT RUN WITHOUT THE FOUNDER'S EXPLICIT GO.
 *
 *  Default mode is DRY-RUN: it simulates everything (estimateGas), prints a
 *  pre-flight checklist + the tx plan + estimated gas cost, and SENDS NOTHING.
 *  Live broadcast requires the explicit --broadcast flag.
 *
 *  REUSES the existing SporeReactorV6 impl — it is NOT redeployed.
 *
 *  Deploy order (on Base):
 *    1. ShipyardV2(... reactorImpl=EXISTING_V6 ..., crewBaseURI)  — factory
 *    2. Dock(shipyardV2, usdc)                                     — gasless relay
 *    Post-deploy (only if PRIZE_WALLET != TREASURY): shipyardV2.setPrizeWallet(...)
 *
 *  Required ENV:
 *    DEPLOY_PRIVATE_KEY   deployer wallet private key (pays gas, becomes owner)
 *    ALCHEMY_RPC          Base RPC URL (falls back to https://mainnet.base.org)
 *    TREASURY_ADDRESS     operator revenue wallet == the Vault (impact sink)
 *    PRIZE_WALLET         moonshot buy-in sink == the Vault (may equal treasury)
 *    USDC_ADDRESS         Base USDC (cross-checked against 0x8335…2913)
 *  Optional ENV:
 *    CREW_BASE_URI        crew-meta base (default https://crew.tasern.quest/crew/meta/)
 *    ETH_USD              price the gas estimate in USD
 *
 *  Run:
 *    node deploy/deploy-shipyard-v2.js              # DRY-RUN (default, sends nothing)
 *    node deploy/deploy-shipyard-v2.js --broadcast  # LIVE (founder go required)
 *    BROADCAST=1 node deploy/deploy-shipyard-v2.js  # LIVE (alt flag)
 * ════════════════════════════════════════════════════════════════════════════ */

const { ethers } = require('ethers');
const path = require('path');

// ── Known Base infra (VERBATIM from deploy/deploy-v7.js — cross-checked below) ─
const INFRA = {
  meme:            '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3', // Meme for Trees (18 dec)
  money:           '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072', // Money for Trees (6 dec)
  v3Factory:       '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  pm:              '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  router:          '0x2626664c2603336E57B271c5C0b26F421741e481',
  upstreamReactor: '0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA', // ReactorPrimeV3
  moneyMemeFee:    10000,                                        // 1% fee tier
};

// REUSED, NOT redeployed — the already-deployed SporeReactorV6 implementation.
const REACTOR_IMPL = '0xc735E699e72372fCbA064E1cf5A68CE0840De411';

// Expected Base USDC (env value is cross-checked against this; env still wins).
const EXPECTED_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Default crew-meta base (the crew-meta service resolves <distributor>:<id>).
const DEFAULT_CREW_BASE_URI = 'https://crew.tasern.quest/crew/meta/';

// Defaults that ShipyardV2 sets in-contract (state-var defaults; setters exist).
const DEFAULT_LAUNCH_FEE = 1_000_000n; // $1   (ShipyardV2.launchFee default)
const DEFAULT_BUY_IN     =   500_000n; // $0.50 (ShipyardV2.buyInAmount default)

const BROADCAST = process.argv.includes('--broadcast') || process.env.BROADCAST === '1';

function die(msg) {
  console.error('\n❌ ' + msg + '\n');
  process.exit(1);
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) die(`Missing required ENV: ${name}. Refusing to use a placeholder — set it and re-run.`);
  return v.trim();
}

function requireAddr(name) {
  const v = requireEnv(name);
  if (!ethers.isAddress(v)) die(`ENV ${name} is not a valid address: "${v}"`);
  return ethers.getAddress(v); // checksummed
}

function loadArtifact(contract) {
  const p = path.join(__dirname, '..', 'artifacts', 'contracts', `${contract}.sol`, `${contract}.json`);
  let art;
  try { art = require(p); }
  catch (e) { die(`Artifact not found for ${contract} at ${p}. Run "npx hardhat compile" first.`); }
  if (!art.bytecode || art.bytecode === '0x') die(`Artifact ${contract} has empty bytecode.`);
  return art;
}

(async () => {
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  ShipyardV2 deploy —', BROADCAST ? '🔴 LIVE BROADCAST' : '🟢 DRY-RUN (no txs sent)');
  console.log('════════════════════════════════════════════════════════════════');

  // ── Cross-check the infra addresses against deploy/deploy-v7.js ──────────────
  try {
    const v7 = require('fs').readFileSync(path.join(__dirname, 'deploy-v7.js'), 'utf8').toLowerCase();
    for (const [k, v] of Object.entries(INFRA)) {
      if (k === 'moneyMemeFee') continue;
      if (!v7.includes(v.toLowerCase())) {
        die(`Infra cross-check FAILED: ${k} (${v}) not found in deploy-v7.js. Verify before deploying.`);
      }
    }
    console.log('✓ Infra addresses cross-checked against deploy-v7.js');
  } catch (e) {
    if (e && e.message && e.message.startsWith('Infra cross-check')) throw e;
    console.log('⚠ Could not read deploy-v7.js for cross-check (continuing with verbatim INFRA).');
  }

  // ── Required ENV ─────────────────────────────────────────────────────────────
  const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
  const KEY = requireEnv('DEPLOY_PRIVATE_KEY');
  const TREASURY = requireAddr('TREASURY_ADDRESS');
  const PRIZE_WALLET = requireAddr('PRIZE_WALLET');
  const USDC = requireAddr('USDC_ADDRESS');
  const CREW_BASE_URI = (process.env.CREW_BASE_URI || DEFAULT_CREW_BASE_URI).trim();

  if (USDC.toLowerCase() !== EXPECTED_USDC.toLowerCase()) {
    console.log(`⚠ WARNING: USDC_ADDRESS (${USDC}) != expected Base USDC (${EXPECTED_USDC}).`);
    console.log('  Proceeding because env wins — but VERIFY this is intentional.');
  } else {
    console.log('✓ USDC_ADDRESS matches expected Base USDC');
  }

  const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1 });
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 8453) {
    console.log(`⚠ WARNING: RPC chainId is ${net.chainId}, expected 8453 (Base). VERIFY before broadcasting.`);
  }
  const wallet = new ethers.Wallet(KEY, provider);

  // ── Verify the reused V6 impl actually has code on-chain ──────────────────────
  try {
    const code = await provider.getCode(REACTOR_IMPL);
    if (!code || code === '0x') {
      console.log(`⚠ WARNING: REACTOR_IMPL (${REACTOR_IMPL}) has NO code on this RPC. VERIFY the impl address before broadcasting.`);
    } else {
      console.log(`✓ Reusing SporeReactorV6 impl ${REACTOR_IMPL} (has code, ${(code.length - 2) / 2} bytes)`);
    }
  } catch (e) {
    console.log('⚠ Could not read REACTOR_IMPL code:', e.shortMessage || e.message);
  }

  // ── Load artifacts (no SporeReactorV6 deploy — reused) ───────────────────────
  const yardArt = loadArtifact('ShipyardV2');
  const dockArt = loadArtifact('Dock');

  // ── Pre-flight checklist ─────────────────────────────────────────────────────
  const bal = await provider.getBalance(wallet.address);
  console.log('\n──────────────── PRE-FLIGHT CHECKLIST ────────────────');
  console.log('RPC                :', RPC.split('/v2/')[0], `(chainId ${net.chainId})`);
  console.log('Deployer           :', wallet.address);
  console.log('Deployer ETH       :', ethers.formatEther(bal));
  console.log('');
  console.log('ENV addresses (verify by eye):');
  console.log('  TREASURY_ADDRESS :', TREASURY, '(should be the Vault / impact sink)');
  console.log('  PRIZE_WALLET     :', PRIZE_WALLET, PRIZE_WALLET.toLowerCase() === TREASURY.toLowerCase() ? '(== treasury; no setter needed)' : '(distinct; setPrizeWallet will be called)');
  console.log('  USDC_ADDRESS     :', USDC);
  console.log('  CREW_BASE_URI    :', CREW_BASE_URI);
  console.log('');
  console.log('Reused (NOT redeployed):');
  console.log('  SporeReactorV6   :', REACTOR_IMPL);
  console.log('');
  console.log('Infra (verbatim from deploy-v7.js):');
  for (const [k, v] of Object.entries(INFRA)) console.log(`  ${k.padEnd(16)} :`, v);
  console.log('');
  console.log('Contract sizes     :',
    `ShipyardV2=${(yardArt.bytecode.length - 2) / 2}B  Dock=${(dockArt.bytecode.length - 2) / 2}B`);
  console.log('Defaults           :', `launchFee=${DEFAULT_LAUNCH_FEE} ($1)  buyIn=${DEFAULT_BUY_IN} ($0.50)  [state-var defaults; setters available]`);
  console.log('Deploy order       : 1) ShipyardV2  2) Dock' +
    (PRIZE_WALLET.toLowerCase() !== TREASURY.toLowerCase() ? '  3) shipyardV2.setPrizeWallet' : ''));
  console.log('──────────────────────────────────────────────────────\n');

  // ── Gas estimation (no broadcast) ────────────────────────────────────────────
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;

  async function estimateDeploy(art, args) {
    const f = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
    const tx = await f.getDeployTransaction(...args);
    try {
      return await provider.estimateGas({ ...tx, from: wallet.address });
    } catch (e) {
      const codeBytes = (art.bytecode.length - 2) / 2;
      return BigInt(Math.ceil(codeBytes * 200 + 300000)); // ~200 gas/byte + base
    }
  }

  // ShipyardV2 ctor: meme, money, usdc, factory, pm, router, reactorImpl, upstream, moneyMemeFee, treasury, crewBaseURI
  const yardArgs = [
    INFRA.meme, INFRA.money, USDC, INFRA.v3Factory, INFRA.pm, INFRA.router,
    REACTOR_IMPL, INFRA.upstreamReactor, INFRA.moneyMemeFee, TREASURY, CREW_BASE_URI,
  ];
  const gYard = await estimateDeploy(yardArt, yardArgs);
  // Dock estimate uses the deployer as a shipyard stand-in (gas is value-independent).
  const gDock = await estimateDeploy(dockArt, [wallet.address /* shipyard stand-in */, USDC]);

  let totalGas = gYard + gDock;
  let setterGas = 0n;
  if (PRIZE_WALLET.toLowerCase() !== TREASURY.toLowerCase()) {
    setterGas = 60000n;
    totalGas += setterGas;
  }

  const ethCost = gasPrice * totalGas;
  let usd = null;
  if (process.env.ETH_USD) usd = (Number(ethers.formatEther(ethCost)) * Number(process.env.ETH_USD));

  console.log('──────────────── GAS PLAN (estimated, NOT sent) ────────────────');
  console.log('gasPrice           :', ethers.formatUnits(gasPrice, 'gwei'), 'gwei');
  console.log('1) ShipyardV2      :', gYard.toString(), 'gas');
  console.log('2) Dock            :', gDock.toString(), 'gas');
  if (setterGas > 0n) console.log('3) setPrizeWallet  :', setterGas.toString(), 'gas');
  console.log('   TOTAL           :', totalGas.toString(), 'gas');
  console.log('   est. ETH cost   :', ethers.formatEther(ethCost), 'ETH');
  if (usd !== null) console.log('   est. USD cost   : $' + usd.toFixed(2), `(at $${process.env.ETH_USD}/ETH)`);
  else console.log('   est. USD cost   : set ETH_USD env to price it');
  console.log('────────────────────────────────────────────────────────────────\n');

  if (bal < ethCost) {
    console.log(`⚠ WARNING: deployer ETH (${ethers.formatEther(bal)}) < estimated cost (${ethers.formatEther(ethCost)}). Top up before broadcasting.`);
  }

  if (!BROADCAST) {
    console.log('🟢 DRY-RUN complete. Nothing was sent.');
    console.log('   To broadcast for real (FOUNDER GO REQUIRED): re-run with --broadcast');
    console.log('   Suggested output JSON shape (filled in on a live run):');
    console.log(JSON.stringify({
      network: 'base', chainId: 8453,
      reactorImpl: REACTOR_IMPL + ' (REUSED)', shipyardV2: '0x…', dock: '0x…',
      usdc: USDC, treasury: TREASURY, prizeWallet: PRIZE_WALLET, crewBaseURI: CREW_BASE_URI,
      launchFee: DEFAULT_LAUNCH_FEE.toString(), buyIn: DEFAULT_BUY_IN.toString(),
      infra: INFRA,
    }, null, 2));
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  LIVE BROADCAST PATH (only reached with --broadcast)
  // ════════════════════════════════════════════════════════════════════════════
  if (bal < ethers.parseEther('0.001')) die('Deployer ETH too low to broadcast.');

  console.log('🔴 BROADCASTING to Base mainnet in 5s — Ctrl-C to abort...');
  await new Promise((r) => setTimeout(r, 5000));

  // 1) ShipyardV2 (reusing the existing V6 impl)
  console.log('\n[1/2] Deploying ShipyardV2 (factory, reusing V6 impl)...');
  const yardFactory = new ethers.ContractFactory(yardArt.abi, yardArt.bytecode, wallet);
  const yard = await yardFactory.deploy(
    INFRA.meme, INFRA.money, USDC, INFRA.v3Factory, INFRA.pm, INFRA.router,
    REACTOR_IMPL, INFRA.upstreamReactor, INFRA.moneyMemeFee, TREASURY, CREW_BASE_URI,
  );
  console.log('  tx:', yard.deploymentTransaction().hash);
  await yard.waitForDeployment();
  const shipyard = await yard.getAddress();
  console.log('  ✓ ShipyardV2:', shipyard);

  // 2) Dock(shipyardV2, usdc)
  console.log('\n[2/2] Deploying Dock (gasless relay)...');
  const dockFactory = new ethers.ContractFactory(dockArt.abi, dockArt.bytecode, wallet);
  const dock = await dockFactory.deploy(shipyard, USDC);
  console.log('  tx:', dock.deploymentTransaction().hash);
  await dock.waitForDeployment();
  const dockAddr = await dock.getAddress();
  console.log('  ✓ Dock:', dockAddr);

  // 3) Post-deploy: set prize wallet if distinct from treasury.
  if (PRIZE_WALLET.toLowerCase() !== TREASURY.toLowerCase()) {
    console.log('\n[3] setPrizeWallet ->', PRIZE_WALLET);
    const yardWrite = new ethers.Contract(shipyard, yardArt.abi, wallet);
    const tx = await yardWrite.setPrizeWallet(PRIZE_WALLET);
    console.log('  tx:', tx.hash);
    await tx.wait();
    console.log('  ✓ prizeWallet set');
  } else {
    console.log('\n[3] prizeWallet == treasury (default) — no setter call needed.');
  }

  // ── Final output JSON ────────────────────────────────────────────────────────
  const out = {
    network: 'base', chainId: 8453, deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    reactorImpl: REACTOR_IMPL, // reused
    shipyardV2: shipyard, dock: dockAddr,
    usdc: USDC, treasury: TREASURY, prizeWallet: PRIZE_WALLET, crewBaseURI: CREW_BASE_URI,
    launchFee: DEFAULT_LAUNCH_FEE.toString(), buyIn: DEFAULT_BUY_IN.toString(),
    infra: INFRA,
    basescan: {
      shipyardV2: 'https://basescan.org/address/' + shipyard,
      dock: 'https://basescan.org/address/' + dockAddr,
    },
  };
  console.log('\n════════════════════ DEPLOYED (consume this JSON) ════════════════════');
  console.log(JSON.stringify(out, null, 2));
  console.log('\nNext: point the launcher UI + relayer keeper at the new Dock; confirm crew tokenURI resolves at CREW_BASE_URI.');
})().catch((e) => die('deploy failed: ' + (e.shortMessage || e.message || e)));
