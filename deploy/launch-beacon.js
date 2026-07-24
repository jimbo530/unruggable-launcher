// Launch BEACON (INT cause-token) via the CharityLaunchpad cookie-cutter.
//   1. Deploy CharityFeeRouter → The Solar Foundation (governance = Vault, trees fallback)
//   2. Deploy CharityLaunchpad (reusing the live SporeReactorV6 impl)
//   3. launch("Beacon","BEACON", router) → token + 2 pools + V6 reactor wired to router
//   4. Transfer launchpad ownership to the Vault
// Free launch — gas only. All addresses verified from shipyard-FINAL-deployed.json /
// tools/sweep-lps.js / the e2e fork test (NONE typed by hand).
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';

const A = {
  meme:        '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3',
  money:       '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072',
  usdc:        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  v3Factory:   '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  pm:          '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  swapRouter:  '0x2626664c2603336E57B271c5C0b26F421741e481',
  reactorImpl: '0xc735E699e72372fCbA064E1cf5A68CE0840De411', // live SporeReactorV6 impl
  upstream:    '0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA',
  moneyMemeFee: 10000,
  trees:       '0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2', // Tree wallet (immortal fallback)
  solar:       '0xB936d993379e5f52b6b8fdcDFA380508F037A420', // The Solar Foundation (Giveth Base recipient)
  vault:       '0x799CfafABA99e9779fA8779B56dE62E193cb7B30', // cold Vault → router governance + factory owner
};
const DELAY = 2 * 24 * 3600; // 2-day timelock on repoints

const FEE = { maxFeePerGas: ethers.parseUnits('0.05', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.005', 'gwei') };

function art(name) {
  return require(path.join(__dirname, '..', 'artifacts', 'contracts', name + '.sol', name + '.json'));
}

(async () => {
  const key = execSync("grep AGENT_PRIVATE_KEY /c/Users/bigji/Documents/Baselings/api/.env | sed 's/.*=//'", { encoding: 'utf8' }).trim();
  if (!key) throw new Error('no AGENT_PRIVATE_KEY');
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1 });
  const wallet = new ethers.Wallet(key, provider);
  console.log('Deployer:', wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log('ETH:', ethers.formatEther(bal));
  if (bal < ethers.parseEther('0.0012')) throw new Error('insufficient ETH');

  const out = { network: 'base', chainId: 8453, deployer: wallet.address, token: 'BEACON', stat: 'INT', charity: 'The Solar Foundation', solar: A.solar, trees: A.trees, vault: A.vault };

  // 1. CharityFeeRouter → Solar (governance = Vault).
  const routerArt = art('CharityFeeRouter');
  const RouterF = new ethers.ContractFactory(routerArt.abi, routerArt.bytecode, wallet);
  console.log('\n[1/4] Deploying CharityFeeRouter → Solar Foundation...');
  const router = await RouterF.deploy(A.usdc, A.trees, A.solar, DELAY, A.vault, FEE);
  await router.waitForDeployment();
  out.charityRouter = await router.getAddress();
  console.log('   router:', out.charityRouter, '| tx:', router.deploymentTransaction().hash);

  // 2. CharityLaunchpad (owner = deployer for launch, transferred to Vault after).
  const padArt = art('CharityLaunchpad');
  const PadF = new ethers.ContractFactory(padArt.abi, padArt.bytecode, wallet);
  console.log('\n[2/4] Deploying CharityLaunchpad...');
  const pad = await PadF.deploy(A.meme, A.money, A.usdc, A.v3Factory, A.pm, A.swapRouter, A.reactorImpl, A.upstream, A.moneyMemeFee, FEE);
  await pad.waitForDeployment();
  out.launchpad = await pad.getAddress();
  console.log('   launchpad:', out.launchpad, '| tx:', pad.deploymentTransaction().hash);
  fs.writeFileSync(path.join(__dirname, 'beacon-deployed.json'), JSON.stringify(out, null, 2));

  // 3. launch BEACON.
  console.log('\n[3/4] Launching BEACON (explicit 20M gas — heavy: 2 pools + reactor)...');
  const tx = await pad.launch('Beacon', 'BEACON', out.charityRouter, { gasLimit: 20_000_000n, ...FEE });
  console.log('   launch tx:', tx.hash, '— waiting...');
  const rc = await tx.wait();
  console.log('   status:', rc.status, '| gasUsed:', rc.gasUsed.toString());
  const ev = rc.logs.map(l => { try { return pad.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === 'CharityTokenLaunched');
  if (!ev) throw new Error('CharityTokenLaunched not found — check tx');
  out.beaconToken = ev.args.token;
  out.reactor = ev.args.reactor;
  console.log('   BEACON token:', out.beaconToken);
  console.log('   reactor     :', out.reactor);
  fs.writeFileSync(path.join(__dirname, 'beacon-deployed.json'), JSON.stringify(out, null, 2));

  // verify
  const reactor = new ethers.Contract(out.reactor, [
    'function distributor() view returns (address)',
    'function poolCount() view returns (uint256)',
    'function token() view returns (address)',
  ], provider);
  console.log('\n--- verify ---');
  console.log('   reactor.distributor():', await reactor.distributor(), '(== router?', (await reactor.distributor()).toLowerCase() === out.charityRouter.toLowerCase(), ')');
  console.log('   reactor.poolCount()  :', (await reactor.poolCount()).toString());
  console.log('   reactor.token()      :', await reactor.token());

  // 4. transfer launchpad ownership → Vault.
  console.log('\n[4/4] Transferring launchpad ownership → Vault...');
  const t2 = await pad.transferOwnership(A.vault, FEE);
  await t2.wait();
  out.launchpadOwner = A.vault;
  console.log('   owner now:', await pad.owner());

  fs.writeFileSync(path.join(__dirname, 'beacon-deployed.json'), JSON.stringify(out, null, 2));
  console.log('\n=== BEACON LIVE ===');
  console.log(JSON.stringify(out, null, 2));
  console.log('\nBaseScan token: https://basescan.org/address/' + out.beaconToken);
})().catch(e => { console.error('FATAL:', e.shortMessage || e.message); if (e.info) console.error(JSON.stringify(e.info).slice(0,300)); process.exit(1); });
