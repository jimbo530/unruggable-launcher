const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, provider);

// ─── Addresses ───────────────────────────────────────────────────────
const MFT        = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM        = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const ROUTER     = '0x2626664c2603336E57B271c5C0b26F421741e481';
const V3FACTORY  = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const MYCOPAD_RX = '0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045';
const cbBTC      = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const WETH       = '0x4200000000000000000000000000000000000006';

const SUPPLY = ethers.parseUnits('1000000', 18); // 1M tokens

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)'
];

const REACTOR_ABI = [
  'function initialize(address _token, address _mft, address _pm, address _router, address _factory, address _reactorPrime) external',
  'function admin() view returns (address)',
  'function initialized() view returns (bool)'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Wallet:', wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log('ETH:', ethers.formatEther(bal));

  const tokenArtifact = require('../artifacts/contracts/LaunchToken.sol/LaunchToken.json');
  const reactorArtifact = require('../artifacts/contracts/SporeReactorV2.sol/SporeReactorV2.json');

  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: Deploy BTCband v2
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 1: Deploy BTCband v2 (1M supply) ═══');
  const btcFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, wallet);
  const btcToken = await btcFactory.deploy('BTCband', 'BTCBAND', SUPPLY, wallet.address);
  console.log('  Tx:', btcToken.deploymentTransaction().hash);
  await btcToken.waitForDeployment();
  const btcAddr = await btcToken.getAddress();
  console.log('  BTCband v2:', btcAddr);

  await sleep(2000);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 2: Deploy ETHband v2
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 2: Deploy ETHband v2 (1M supply) ═══');
  const ethFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, wallet);
  const ethToken = await ethFactory.deploy('ETHband', 'ETHBAND', SUPPLY, wallet.address);
  console.log('  Tx:', ethToken.deploymentTransaction().hash);
  await ethToken.waitForDeployment();
  const ethAddr = await ethToken.getAddress();
  console.log('  ETHband v2:', ethAddr);

  await sleep(2000);

  // Verify tokens
  const btc = new ethers.Contract(btcAddr, ERC20_ABI, provider);
  const eth_ = new ethers.Contract(ethAddr, ERC20_ABI, provider);
  const [bName, bSym, bSupply] = await Promise.all([btc.name(), btc.symbol(), btc.totalSupply()]);
  const [eName, eSym, eSupply] = await Promise.all([eth_.name(), eth_.symbol(), eth_.totalSupply()]);
  console.log(`\n  BTCband: ${bName} (${bSym}) supply=${ethers.formatUnits(bSupply, 18)}`);
  console.log(`  ETHband: ${eName} (${eSym}) supply=${ethers.formatUnits(eSupply, 18)}`);

  // Token ordering
  console.log(`\n  BTCband vs cbBTC: BTCband is token${btcAddr.toLowerCase() < cbBTC.toLowerCase() ? '0' : '1'}`);
  console.log(`  ETHband vs WETH:  ETHband is token${ethAddr.toLowerCase() < WETH.toLowerCase() ? '0' : '1'}`);
  console.log(`  BTCband vs MfT:   BTCband is token${btcAddr.toLowerCase() < MFT.toLowerCase() ? '0' : '1'}`);
  console.log(`  ETHband vs MfT:   ETHband is token${ethAddr.toLowerCase() < MFT.toLowerCase() ? '0' : '1'}`);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 3: Deploy BTCband Reactor
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 3: Deploy BTCband v2 Reactor ═══');
  const btcRxFactory = new ethers.ContractFactory(REACTOR_ABI, reactorArtifact.bytecode, wallet);
  const btcRxContract = await btcRxFactory.deploy({ gasLimit: 6000000 });
  console.log('  Tx:', btcRxContract.deploymentTransaction().hash);
  await btcRxContract.waitForDeployment();
  const btcRxAddr = await btcRxContract.getAddress();
  console.log('  BTCband Reactor:', btcRxAddr);

  await sleep(2000);

  console.log('  Initializing...');
  const btcRx = new ethers.Contract(btcRxAddr, REACTOR_ABI, wallet);
  const initTx1 = await btcRx.initialize(btcAddr, MFT, NPM, ROUTER, V3FACTORY, MYCOPAD_RX, { gasLimit: 300000 });
  console.log('  Tx:', initTx1.hash);
  await initTx1.wait();
  console.log('  Admin:', await btcRx.admin());

  await sleep(2000);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 4: Deploy ETHband Reactor
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 4: Deploy ETHband v2 Reactor ═══');
  const ethRxFactory = new ethers.ContractFactory(REACTOR_ABI, reactorArtifact.bytecode, wallet);
  const ethRxContract = await ethRxFactory.deploy({ gasLimit: 6000000 });
  console.log('  Tx:', ethRxContract.deploymentTransaction().hash);
  await ethRxContract.waitForDeployment();
  const ethRxAddr = await ethRxContract.getAddress();
  console.log('  ETHband Reactor:', ethRxAddr);

  await sleep(2000);

  console.log('  Initializing...');
  const ethRx = new ethers.Contract(ethRxAddr, REACTOR_ABI, wallet);
  const initTx2 = await ethRx.initialize(ethAddr, MFT, NPM, ROUTER, V3FACTORY, MYCOPAD_RX, { gasLimit: 300000 });
  console.log('  Tx:', initTx2.hash);
  await initTx2.wait();
  console.log('  Admin:', await ethRx.admin());

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  const endBal = await provider.getBalance(wallet.address);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           BAND v2 CONTRACTS DEPLOYED                    ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ BTCband v2:     ${btcAddr}`);
  console.log(`║ ETHband v2:     ${ethAddr}`);
  console.log(`║ Supply:         1,000,000 each ($1/token, $1M FDV)`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ BTCband Reactor: ${btcRxAddr}`);
  console.log(`║ ETHband Reactor: ${ethRxAddr}`);
  console.log(`║ Upstream:        MycoPad (${MYCOPAD_RX})`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║ NEXT STEPS (need USDC + ETH):                          ║');
  console.log('║  1. Create USDC reference pools ($1 price anchor)      ║');
  console.log('║  2. Create cbBTC/WETH band pools + one-sided positions  ║');
  console.log('║  3. Send band NFTs to reactors + addPool()             ║');
  console.log('║  4. 5% kept in wallet for future reactor LPs           ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ ETH remaining: ${ethers.formatEther(endBal)}`);
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
