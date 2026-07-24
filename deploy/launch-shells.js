// Launch SHELLS (WIS cause-meme) via the EXISTING CharityLaunchpad (BEACON's, Vault-owned,
// launch() is permissionless). The reactor's distributor = our ImpactRetireRouter (CHAR),
// so SHELLS trade fees → buy + retire CHAR → impact registry. Free launch (gas only).
// Reuses the proven launch-beacon.js path. Launchpad addr read from beacon-deployed.json.
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const ROUTER = '0x07A7cFe7cddD02C884c428A3Ef09DDd0a4B8391f'; // our deployed CHAR ImpactRetireRouter (verified)
const FEE = { maxFeePerGas: ethers.parseUnits('0.05', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.005', 'gwei') };

const padArt = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'CharityLaunchpad.sol', 'CharityLaunchpad.json'));
const beacon = require(path.join(__dirname, 'beacon-deployed.json'));
const LAUNCHPAD = beacon.launchpad; // 0xc0b8... verified from BEACON's record

(async () => {
  const key = execSync("grep AGENT_PRIVATE_KEY /c/Users/bigji/Documents/Baselings/api/.env | sed 's/.*=//'", { encoding: 'utf8' }).trim();
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1 });
  const wallet = new ethers.Wallet(key, provider);
  console.log('Deployer :', wallet.address, '| ETH:', ethers.formatEther(await provider.getBalance(wallet.address)));
  console.log('Launchpad:', LAUNCHPAD);
  console.log('Router   :', ROUTER, '(CHAR ImpactRetireRouter)');

  const pad = new ethers.Contract(LAUNCHPAD, padArt.abi, wallet);

  // estimate gas for the launch (heavy: 2 pool creates + 2 NPM mints + reactor clone)
  let est;
  try {
    est = await pad.launch.estimateGas('Shells', 'SHELLS', ROUTER);
    console.log('launch gas est:', est.toString());
  } catch (e) {
    console.error('estimateGas FAILED:', e.shortMessage || e.message);
    process.exit(1);
  }
  // gasLimit = est +30%, capped under the RPC send-cap (16.7M); if est itself is over cap, abort for sequencer path
  if (est > 16_000_000n) { console.error('estimate over RPC cap — use sequencer path'); process.exit(1); }
  const gasLimit = est * 13n / 10n;
  console.log('using gasLimit:', gasLimit.toString());

  console.log('\nLaunching SHELLS...');
  const tx = await pad.launch('Shells', 'SHELLS', ROUTER, { gasLimit, ...FEE });
  console.log('  tx:', tx.hash, '— waiting...');
  const rc = await tx.wait();
  console.log('  status:', rc.status, '| gasUsed:', rc.gasUsed.toString());

  const ev = rc.logs.map(l => { try { return pad.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === 'CharityTokenLaunched');
  if (!ev) throw new Error('CharityTokenLaunched not found');
  const out = {
    network: 'base', chainId: 8453, deployer: wallet.address, token: 'SHELLS', stat: 'WIS',
    impactToken: 'CHAR', impactRouter: ROUTER, launchpad: LAUNCHPAD,
    shellsToken: ev.args.token, reactor: ev.args.reactor, launchTx: tx.hash,
  };
  console.log('\n  SHELLS token:', out.shellsToken);
  console.log('  reactor     :', out.reactor);

  // verify the reactor wired our router as its distributor
  const reactor = new ethers.Contract(out.reactor, [
    'function distributor() view returns (address)',
    'function poolCount() view returns (uint256)',
    'function token() view returns (address)',
  ], provider);
  const dist = await reactor.distributor();
  console.log('\n--- verify ---');
  console.log('  reactor.distributor():', dist, '(== our router?', dist.toLowerCase() === ROUTER.toLowerCase(), ')');
  console.log('  reactor.poolCount()  :', (await reactor.poolCount()).toString());
  console.log('  reactor.token()      :', await reactor.token(), '(== SHELLS?', (await reactor.token()).toLowerCase() === out.shellsToken.toLowerCase(), ')');

  fs.writeFileSync(path.join(__dirname, 'shells-deployed.json'), JSON.stringify(out, null, 2));
  console.log('\n=== SHELLS LIVE ===\n' + JSON.stringify(out, null, 2));
  console.log('\nBaseScan: https://basescan.org/address/' + out.shellsToken);
})().catch(e => { console.error('FATAL:', e.shortMessage || e.message); if (e.info) console.error(JSON.stringify(e.info).slice(0,300)); process.exit(1); });
