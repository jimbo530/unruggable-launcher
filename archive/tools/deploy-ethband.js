const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const RPC = 'https://mainnet.base.org';
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY;
const GAME_KEY = process.env.AGENT_TEST_KEY;

if (!AGENT_KEY) { console.error('ERROR: AGENT_PRIVATE_KEY not found'); process.exit(1); }
if (!GAME_KEY) { console.error('ERROR: AGENT_TEST_KEY not found'); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC);
const agentWallet = new ethers.Wallet(AGENT_KEY, provider);
const gameWallet = new ethers.Wallet(GAME_KEY, provider);

const artifact = require('../artifacts/contracts/LaunchToken.sol/LaunchToken.json');
const SUPPLY = ethers.parseUnits('1000000000000', 18);

const BTCBAND = '0x2988187BDa15c71eC8b3Eb9873457174733d2524';
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)'
];

async function main() {
  console.log('Agent wallet:', agentWallet.address);
  console.log('Game wallet:', gameWallet.address);

  // Step 1: Transfer BTCband from game wallet to agent wallet
  console.log('\n--- TRANSFERRING BTCband to agent wallet ---');
  const btcband = new ethers.Contract(BTCBAND, ERC20_ABI, gameWallet);
  const bal = await btcband.balanceOf(gameWallet.address);
  console.log('BTCband in game wallet:', ethers.formatUnits(bal, 18));
  const tx1 = await btcband.transfer(agentWallet.address, bal);
  console.log('Transfer tx:', tx1.hash);
  await tx1.wait();
  const newBal = await btcband.balanceOf(agentWallet.address);
  console.log('BTCband in agent wallet:', ethers.formatUnits(newBal, 18));

  // Step 2: Deploy ETHband from agent wallet
  console.log('\n--- DEPLOYING ETHband ---');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, agentWallet);
  const contract = await factory.deploy('ETHband', 'ETHBAND', SUPPLY, agentWallet.address);
  console.log('Tx:', contract.deploymentTransaction().hash);
  await contract.waitForDeployment();
  const ethbandAddr = await contract.getAddress();
  console.log('DEPLOYED:', ethbandAddr);

  // Verify
  await new Promise(r => setTimeout(r, 2000));
  const ethband = new ethers.Contract(ethbandAddr, ERC20_ABI, provider);
  const [n, s] = await Promise.all([ethband.name(), ethband.symbol()]);
  console.log('Verified:', n, s);

  // Token ordering
  const cbBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'.toLowerCase();
  const WETH  = '0x4200000000000000000000000000000000000006'.toLowerCase();

  console.log('\n=== FINAL STATE ===');
  console.log('BTCband:', BTCBAND);
  console.log('ETHband:', ethbandAddr);
  console.log('Agent wallet:', agentWallet.address, '(holds both)');
  console.log('\nBTCband is token' + (BTCBAND.toLowerCase() < cbBTC ? '0' : '1') + ' in BTCband/cbBTC');
  console.log('ETHband is token' + (ethbandAddr.toLowerCase() < WETH ? '0' : '1') + ' in ETHband/WETH');
  console.log('BTCband is token' + (BTCBAND.toLowerCase() < ethbandAddr.toLowerCase() ? '0' : '1') + ' in BTCband/ETHband');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
