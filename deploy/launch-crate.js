// Launch CRATE (STR cause-meme) via the EXISTING CharityLaunchpad. Reactor distributor
// = the CCC ImpactRetireRouter, so CRATE trade fees → buy + retire CCC → impact registry.
// Same proven path as launch-shells.js. Free launch (gas only).
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const ROUTER = '0xBd4c11f5dA711101C0a09122746C37aeDdeEf918'; // CCC ImpactRetireRouter (verified deployed)
const FEE = { maxFeePerGas: ethers.parseUnits('0.05', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.005', 'gwei') };

const padArt = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'CharityLaunchpad.sol', 'CharityLaunchpad.json'));
const beacon = require(path.join(__dirname, 'beacon-deployed.json'));
const LAUNCHPAD = beacon.launchpad;

(async () => {
  const key = execSync("grep AGENT_PRIVATE_KEY /c/Users/bigji/Documents/Baselings/api/.env | sed 's/.*=//'", { encoding: 'utf8' }).trim();
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1 });
  const wallet = new ethers.Wallet(key, provider);
  console.log('Deployer :', wallet.address, '| ETH:', ethers.formatEther(await provider.getBalance(wallet.address)));
  console.log('Launchpad:', LAUNCHPAD, '| Router:', ROUTER, '(CCC ImpactRetireRouter)');

  const pad = new ethers.Contract(LAUNCHPAD, padArt.abi, wallet);
  let est;
  try { est = await pad.launch.estimateGas('Crate', 'CRATE', ROUTER); console.log('launch gas est:', est.toString()); }
  catch (e) { console.error('estimateGas FAILED:', e.shortMessage || e.message); process.exit(1); }
  if (est > 16_000_000n) { console.error('estimate over RPC cap — use sequencer'); process.exit(1); }
  const gasLimit = est * 13n / 10n;

  console.log('\nLaunching CRATE...');
  const tx = await pad.launch('Crate', 'CRATE', ROUTER, { gasLimit, ...FEE });
  console.log('  tx:', tx.hash, '— waiting...');
  const rc = await tx.wait();
  console.log('  status:', rc.status, '| gasUsed:', rc.gasUsed.toString());

  const ev = rc.logs.map(l => { try { return pad.interface.parseLog(l); } catch { return null; } }).find(e => e && e.name === 'CharityTokenLaunched');
  if (!ev) throw new Error('CharityTokenLaunched not found');
  const out = { network: 'base', chainId: 8453, deployer: wallet.address, token: 'CRATE', stat: 'STR',
    impactToken: 'CCC', impactRouter: ROUTER, launchpad: LAUNCHPAD,
    crateToken: ev.args.token, reactor: ev.args.reactor, launchTx: tx.hash };
  console.log('\n  CRATE token:', out.crateToken, '| reactor:', out.reactor);

  const reactor = new ethers.Contract(out.reactor, ['function distributor() view returns (address)','function poolCount() view returns (uint256)','function token() view returns (address)'], provider);
  const dist = await reactor.distributor();
  console.log('--- verify --- distributor:', dist, '(== router?', dist.toLowerCase() === ROUTER.toLowerCase(), ') | poolCount:', (await reactor.poolCount()).toString(), '| token ok?', (await reactor.token()).toLowerCase() === out.crateToken.toLowerCase());

  fs.writeFileSync(path.join(__dirname, 'crate-deployed.json'), JSON.stringify(out, null, 2));
  console.log('\n=== CRATE LIVE ===\n' + JSON.stringify(out, null, 2));
  console.log('\nBaseScan: https://basescan.org/address/' + out.crateToken);
})().catch(e => { console.error('FATAL:', e.shortMessage || e.message); if (e.info) console.error(JSON.stringify(e.info).slice(0,300)); process.exit(1); });
