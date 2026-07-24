const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');
const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const SHIPYARD = '0x1afBe7101Acc6460d8793e17c40f9aa5Bbd7D573';
const VAULT = '0x799CfafABA99e9779fA8779B56dE62E193cb7B30';
const KEY = process.env.DEPLOY_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const yard = new ethers.Contract(SHIPYARD,
    ['function owner() view returns (address)', 'function transferOwnership(address) external'], wallet);
  const before = await yard.owner();
  console.log('owner before:', before);
  if (before.toLowerCase() === VAULT.toLowerCase()) { console.log('already Vault.'); return; }
  if (before.toLowerCase() !== wallet.address.toLowerCase()) { console.error('caller not owner'); process.exit(1); }
  const tx = await yard.transferOwnership(VAULT);
  console.log('tx:', tx.hash); await tx.wait();
  const after = await yard.owner();
  console.log('owner after :', after, after.toLowerCase() === VAULT.toLowerCase() ? '✓ Vault' : '⚠ mismatch');
})().catch(e => { console.error('ERR', e.shortMessage || e.message); process.exit(1); });
