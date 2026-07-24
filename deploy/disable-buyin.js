// Skip the Shipyard buy-in: agent funds the Vault a little gas, Vault sets
// buyInAmount=0 (the launch's `if (bi>0)` guard then skips executeBuyIn entirely).
// Buy-in becomes a later keeper job. Then retry-launch-black-tide.js can run.
const { ethers } = require('ethers');
const { execSync } = require('child_process');
const path = require('path'); const os = require('os');

const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const YARD = '0x1afBe7101Acc6460d8793e17c40f9aa5Bbd7D573';
const VAULT = '0x799CfafABA99e9779fA8779B56dE62E193cb7B30';
const FEE = { maxFeePerGas: ethers.parseUnits('0.05', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.004', 'gwei') };

function grepKey(file, name) {
  return execSync(`grep ${name} "${file}" | sed 's/.*=//' | tr -d '"'`, { encoding: 'utf8' }).trim();
}

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1 });
  const agentKey = grepKey('C:/Users/bigji/Documents/Baselings/api/.env', 'AGENT_PRIVATE_KEY');
  const vaultKey = grepKey(path.join(os.homedir(), '.shipyard-wallets.env'), 'VAULT_PRIVATE_KEY');
  const agent = new ethers.Wallet(agentKey, p);
  const vault = new ethers.Wallet(vaultKey, p);
  if (vault.address.toLowerCase() !== VAULT.toLowerCase()) throw new Error('vault key mismatch: ' + vault.address);

  // 1. Fund the Vault for gas if it's dry.
  let vb = await p.getBalance(VAULT);
  console.log('Vault ETH:', ethers.formatEther(vb));
  if (vb < ethers.parseEther('0.00005')) {
    console.log('Funding Vault 0.0002 ETH from agent...');
    const t = await agent.sendTransaction({ to: VAULT, value: ethers.parseEther('0.0002'), ...FEE });
    await t.wait();
    vb = await p.getBalance(VAULT);
    console.log('  Vault ETH now:', ethers.formatEther(vb));
  }

  // 2. Vault sets buyInAmount = 0.
  const yard = new ethers.Contract(YARD, [
    'function setBuyIn(uint256)', 'function buyInAmount() view returns (uint256)', 'function owner() view returns (address)',
  ], vault);
  console.log('\nbuyInAmount before:', (await yard.buyInAmount()).toString());
  const tx = await yard.setBuyIn(0n, FEE);
  console.log('setBuyIn(0) tx:', tx.hash, '— waiting...');
  await tx.wait();
  console.log('buyInAmount after :', (await yard.buyInAmount()).toString(), '✅ buy-in disabled');
  console.log('\nNow run: node deploy/retry-launch-black-tide.js');
})().catch(e => { console.error('FATAL:', e.shortMessage || e.message); process.exit(1); });
