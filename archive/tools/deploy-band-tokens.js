const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load env from Baselings
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const RPC = 'https://mainnet.base.org';
const PRIVATE_KEY = process.env.AGENT_TEST_KEY;

if (!PRIVATE_KEY) { console.error('ERROR: AGENT_TEST_KEY not found in env'); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// LaunchToken bytecode from compiled artifacts
const artifact = require('../artifacts/contracts/LaunchToken.sol/LaunchToken.json');
const BYTECODE = artifact.bytecode;
const ABI = artifact.abi;

const SUPPLY = ethers.parseUnits('1000000000000', 18); // 1 trillion

async function deploy(name, symbol) {
  const addr = wallet.address;
  console.log(`\nDeploying ${name} (${symbol})...`);
  console.log(`  Supply: 1,000,000,000,000`);
  console.log(`  Recipient: ${addr}`);

  const factory = new ethers.ContractFactory(ABI, BYTECODE, wallet);
  const contract = await factory.deploy(name, symbol, SUPPLY, addr);
  console.log(`  Tx: ${contract.deploymentTransaction().hash}`);
  console.log(`  Waiting for confirmation...`);
  await contract.waitForDeployment();
  const deployed = await contract.getAddress();
  console.log(`  DEPLOYED: ${deployed}`);

  // Verify
  const token = new ethers.Contract(deployed, ['function name() view returns (string)', 'function symbol() view returns (string)', 'function totalSupply() view returns (uint256)'], provider);
  const [n, s, ts] = await Promise.all([token.name(), token.symbol(), token.totalSupply()]);
  console.log(`  Verified: ${n} (${s}), supply=${ethers.formatUnits(ts, 18)}`);

  // Token ordering info
  const cbBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
  const WETH  = '0x4200000000000000000000000000000000000006';
  const paired = name === 'BTCband' ? cbBTC : WETH;
  const pairedName = name === 'BTCband' ? 'cbBTC' : 'WETH';
  const isToken0 = deployed.toLowerCase() < paired.toLowerCase();
  console.log(`  ${name} vs ${pairedName}: ${name} is token${isToken0 ? '0' : '1'}`);

  return deployed;
}

async function main() {
  console.log('Agent wallet:', wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log('ETH balance:', ethers.formatEther(bal));

  const btcband = await deploy('BTCband', 'BTCBAND');
  const ethband = await deploy('ETHband', 'ETHBAND');

  console.log('\n=== RESULTS ===');
  console.log('BTCband:', btcband);
  console.log('ETHband:', ethband);

  // Token ordering summary
  const cbBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'.toLowerCase();
  const WETH  = '0x4200000000000000000000000000000000000006'.toLowerCase();
  const otherToken = btcband.toLowerCase();
  console.log('\nBTCband is token' + (btcband.toLowerCase() < cbBTC ? '0' : '1') + ' in BTCband/cbBTC pool');
  console.log('ETHband is token' + (ethband.toLowerCase() < WETH ? '0' : '1') + ' in ETHband/WETH pool');
  console.log('BTCband is token' + (btcband.toLowerCase() < ethband.toLowerCase() ? '0' : '1') + ' in BTCband/ETHband cross-pool');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
