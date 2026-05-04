const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

async function main() {
  console.log('Wallet:', w.address);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  const SUPPLY = ethers.parseUnits('1000000', 18);
  const artifact = require('../artifacts/contracts/LaunchToken.sol/LaunchToken.json');

  console.log('\nDeploying BB...');
  const bbF = new ethers.ContractFactory(artifact.abi, artifact.bytecode, w);
  const bb = await bbF.deploy('BB', 'BB', SUPPLY, w.address);
  await bb.waitForDeployment();
  const BB = await bb.getAddress();
  console.log('BB:', BB);

  await new Promise(r => setTimeout(r, 3000));

  console.log('\nDeploying EB...');
  const ebF = new ethers.ContractFactory(artifact.abi, artifact.bytecode, w);
  const eb = await ebF.deploy('EB', 'EB', SUPPLY, w.address);
  await eb.waitForDeployment();
  const EB = await eb.getAddress();
  console.log('EB:', EB);

  console.log('\n=== NEW TOKENS ===');
  console.log('BB:', BB);
  console.log('EB:', EB);
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
