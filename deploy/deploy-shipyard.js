/* ════════════════════════════════════════════════════════════════════════════
 *  ⚠️  REVIEW BEFORE RUNNING.  ⚠️
 *
 *  This script BROADCASTS REAL TRANSACTIONS TO BASE MAINNET when run with
 *  --broadcast (or BROADCAST=1). It deploys the FULL Shipyard system, which
 *  INCLUDES the fee-share "crew" NFTs that Guardian has flagged as a POSSIBLE
 *  SECURITY / profit-sharing instrument — see docs/fee-share-nft-spec.md.
 *
 *  DO NOT RUN WITHOUT THE FOUNDER'S EXPLICIT GO.
 *
 *  Default mode is DRY-RUN: it simulates everything (callStatic + estimateGas),
 *  prints a pre-flight checklist + the full tx plan + estimated gas cost, and
 *  SENDS NOTHING. Live broadcast requires the explicit --broadcast flag.
 *
 *  Deploy order (on Base):
 *    1. SporeReactorV6   — reactor implementation (cloned per launch; no args)
 *    2. Shipyard         — factory (10 ctor args; infra verbatim + env treasury)
 *    3. Dock(shipyard, usdc) — gasless-relay escrow
 *    Post-deploy (only if PRIZE_WALLET != TREASURY): shipyard.setPrizeWallet(...)
 *
 *  Required ENV:
 *    DEPLOY_PRIVATE_KEY   deployer wallet private key (pays gas, becomes owner)
 *    ALCHEMY_RPC          Base RPC URL (falls back to https://mainnet.base.org)
 *    TREASURY_ADDRESS     operator revenue wallet (launch-fee remainder sink)
 *    PRIZE_WALLET         moonshot buy-in TOKEN bag sink (may equal treasury)
 *    USDC_ADDRESS         Base USDC (cross-checked against 0x8335…2913)
 *
 *  Run:
 *    node deploy/deploy-shipyard.js              # DRY-RUN (default, sends nothing)
 *    node deploy/deploy-shipyard.js --broadcast  # LIVE (founder go required)
 *    BROADCAST=1 node deploy/deploy-shipyard.js  # LIVE (alt flag)
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

// Expected Base USDC (env value is cross-checked against this; env still wins).
const EXPECTED_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Defaults that the Shipyard sets in-contract (state-var defaults; setters exist).
const DEFAULT_LAUNCH_FEE = 1_000_000n; // $1   (Shipyard.launchFee default)
const DEFAULT_BUY_IN     =   500_000n; // $0.50 (Shipyard.buyInAmount default)

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
  console.log('  Shipyard system deploy —', BROADCAST ? '🔴 LIVE BROADCAST' : '🟢 DRY-RUN (no txs sent)');
  console.log('════════════════════════════════════════════════════════════════');

  // ── Cross-check the infra addresses against deploy/deploy-v7.js ──────────────
  // (We hold them verbatim above; this asserts they still match the source file.)
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

  // ── Load artifacts ───────────────────────────────────────────────────────────
  const v6Art   = loadArtifact('SporeReactorV6');
  const yardArt = loadArtifact('Shipyard');
  const dockArt = loadArtifact('Dock');

  // ── Pre-flight checklist ─────────────────────────────────────────────────────
  const bal = await provider.getBalance(wallet.address);
  console.log('\n──────────────── PRE-FLIGHT CHECKLIST ────────────────');
  console.log('RPC                :', RPC.split('/v2/')[0], `(chainId ${net.chainId})`);
  console.log('Deployer           :', wallet.address);
  console.log('Deployer ETH       :', ethers.formatEther(bal));
  console.log('');
  console.log('ENV addresses (verify by eye):');
  console.log('  TREASURY_ADDRESS :', TREASURY);
  console.log('  PRIZE_WALLET     :', PRIZE_WALLET, PRIZE_WALLET.toLowerCase() === TREASURY.toLowerCase() ? '(== treasury; no setter needed)' : '(distinct; setPrizeWallet will be called)');
  console.log('  USDC_ADDRESS     :', USDC);
  console.log('');
  console.log('Infra (verbatim from deploy-v7.js):');
  for (const [k, v] of Object.entries(INFRA)) console.log(`  ${k.padEnd(16)} :`, v);
  console.log('');
  console.log('Contract sizes     :',
    `V6=${(v6Art.bytecode.length - 2) / 2}B  Shipyard=${(yardArt.bytecode.length - 2) / 2}B  Dock=${(dockArt.bytecode.length - 2) / 2}B`);
  console.log('Defaults           :', `launchFee=${DEFAULT_LAUNCH_FEE} ($1)  buyIn=${DEFAULT_BUY_IN} ($0.50)  [state-var defaults; setters available]`);
  console.log('Deploy order       : 1) SporeReactorV6  2) Shipyard  3) Dock' +
    (PRIZE_WALLET.toLowerCase() !== TREASURY.toLowerCase() ? '  4) shipyard.setPrizeWallet' : ''));
  console.log('──────────────────────────────────────────────────────\n');

  // ── Gas estimation (no broadcast) ────────────────────────────────────────────
  // Deploy-tx gas can't be estimated for steps 2/3 without the step-1 address,
  // so we estimate per-contract deployment gas via eth_estimateGas on the deploy
  // calldata with PLACEHOLDER constructor args (real args for step 1; for 2/3 we
  // use the deployer address as a stand-in — gas is arg-value-independent here).
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;

  async function estimateDeploy(art, args) {
    const f = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
    const tx = await f.getDeployTransaction(...args);
    try {
      return await provider.estimateGas({ ...tx, from: wallet.address });
    } catch (e) {
      // Fall back to a size-based heuristic if estimateGas reverts in simulation.
      const codeBytes = (art.bytecode.length - 2) / 2;
      return BigInt(Math.ceil(codeBytes * 200 + 300000)); // ~200 gas/byte + base
    }
  }

  const gV6 = await estimateDeploy(v6Art, []);
  // For the Shipyard estimate use the (not-yet-real) reactorImpl = deployer addr
  // as a stand-in; ctor gas is independent of the address value.
  const yardArgs = [
    INFRA.meme, INFRA.money, USDC, INFRA.v3Factory, INFRA.pm, INFRA.router,
    wallet.address /* reactorImpl stand-in */, INFRA.upstreamReactor, INFRA.moneyMemeFee, TREASURY,
  ];
  const gYard = await estimateDeploy(yardArt, yardArgs);
  const gDock = await estimateDeploy(dockArt, [wallet.address /* shipyard stand-in */, USDC]);

  let totalGas = gV6 + gYard + gDock;
  let setterGas = 0n;
  if (PRIZE_WALLET.toLowerCase() !== TREASURY.toLowerCase()) {
    setterGas = 60000n; // setPrizeWallet ~ a single SSTORE + event
    totalGas += setterGas;
  }

  const ethCost = gasPrice * totalGas;
  let usd = null;
  if (process.env.ETH_USD) usd = (Number(ethers.formatEther(ethCost)) * Number(process.env.ETH_USD));

  console.log('──────────────── GAS PLAN (estimated, NOT sent) ────────────────');
  console.log('gasPrice           :', ethers.formatUnits(gasPrice, 'gwei'), 'gwei');
  console.log('1) SporeReactorV6  :', gV6.toString(), 'gas');
  console.log('2) Shipyard        :', gYard.toString(), 'gas');
  console.log('3) Dock            :', gDock.toString(), 'gas');
  if (setterGas > 0n) console.log('4) setPrizeWallet  :', setterGas.toString(), 'gas');
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
      reactorImpl: '0x… (V6)', shipyard: '0x…', dock: '0x…',
      usdc: USDC, treasury: TREASURY, prizeWallet: PRIZE_WALLET,
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

  // 1) SporeReactorV6 (no constructor args)
  console.log('\n[1/3] Deploying SporeReactorV6 (reactor impl)...');
  const v6Factory = new ethers.ContractFactory(v6Art.abi, v6Art.bytecode, wallet);
  const v6 = await v6Factory.deploy();
  console.log('  tx:', v6.deploymentTransaction().hash);
  await v6.waitForDeployment();
  const reactorImpl = await v6.getAddress();
  console.log('  ✓ SporeReactorV6:', reactorImpl);

  // 2) Shipyard (real reactorImpl from step 1)
  console.log('\n[2/3] Deploying Shipyard (factory)...');
  const yardFactory = new ethers.ContractFactory(yardArt.abi, yardArt.bytecode, wallet);
  const yard = await yardFactory.deploy(
    INFRA.meme, INFRA.money, USDC, INFRA.v3Factory, INFRA.pm, INFRA.router,
    reactorImpl, INFRA.upstreamReactor, INFRA.moneyMemeFee, TREASURY,
  );
  console.log('  tx:', yard.deploymentTransaction().hash);
  await yard.waitForDeployment();
  const shipyard = await yard.getAddress();
  console.log('  ✓ Shipyard:', shipyard);

  // 3) Dock(shipyard, usdc)
  console.log('\n[3/3] Deploying Dock (gasless relay)...');
  const dockFactory = new ethers.ContractFactory(dockArt.abi, dockArt.bytecode, wallet);
  const dock = await dockFactory.deploy(shipyard, USDC);
  console.log('  tx:', dock.deploymentTransaction().hash);
  await dock.waitForDeployment();
  const dockAddr = await dock.getAddress();
  console.log('  ✓ Dock:', dockAddr);

  // 4) Post-deploy: set prize wallet if distinct from treasury.
  if (PRIZE_WALLET.toLowerCase() !== TREASURY.toLowerCase()) {
    console.log('\n[4] setPrizeWallet ->', PRIZE_WALLET);
    const yardWrite = new ethers.Contract(shipyard, yardArt.abi, wallet);
    const tx = await yardWrite.setPrizeWallet(PRIZE_WALLET);
    console.log('  tx:', tx.hash);
    await tx.wait();
    console.log('  ✓ prizeWallet set');
  } else {
    console.log('\n[4] prizeWallet == treasury (default) — no setter call needed.');
  }

  // ── Final output JSON ────────────────────────────────────────────────────────
  const out = {
    network: 'base', chainId: 8453, deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    reactorImpl, shipyard, dock: dockAddr,
    usdc: USDC, treasury: TREASURY, prizeWallet: PRIZE_WALLET,
    launchFee: DEFAULT_LAUNCH_FEE.toString(), buyIn: DEFAULT_BUY_IN.toString(),
    infra: INFRA,
    basescan: {
      reactorImpl: 'https://basescan.org/address/' + reactorImpl,
      shipyard: 'https://basescan.org/address/' + shipyard,
      dock: 'https://basescan.org/address/' + dockAddr,
    },
  };
  console.log('\n════════════════════ DEPLOYED (consume this JSON) ════════════════════');
  console.log(JSON.stringify(out, null, 2));
  console.log('\nNext: verify on BaseScan, then point the launcher UI + relayer keeper at these addresses.');
})().catch((e) => die('deploy failed: ' + (e.shortMessage || e.message || e)));
