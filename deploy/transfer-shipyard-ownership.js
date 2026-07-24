// Transfer Shipyard ownership from the deployer (agent wallet) to the Vault,
// so admin control sits on the clean cold wallet. Key from .env, never printed.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });

const { ethers } = require('ethers');

const RPC      = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const SHIPYARD = '0x4a2097E0DC0735731f34B05EF49F5c84b44e3542';
const VAULT    = '0x799CfafABA99e9779fA8779B56dE62E193cb7B30';
const KEY      = process.env.DEPLOY_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const yard = new ethers.Contract(SHIPYARD,
    ['function owner() view returns (address)', 'function transferOwnership(address) external'],
    wallet);

  const before = await yard.owner();
  console.log('Current owner :', before);
  if (before.toLowerCase() === VAULT.toLowerCase()) { console.log('Already the Vault. Nothing to do.'); return; }
  if (before.toLowerCase() !== wallet.address.toLowerCase()) { console.error('Caller is not the owner. Abort.'); process.exit(1); }

  const tx = await yard.transferOwnership(VAULT);
  console.log('transferOwnership tx:', tx.hash);
  await tx.wait();
  const after = await yard.owner();
  console.log('New owner     :', after);
  console.log(after.toLowerCase() === VAULT.toLowerCase() ? '✓ Ownership now on the Vault.' : '⚠ Owner did not change as expected.');
})().catch(e => { console.error('ERROR:', e.shortMessage || e.message); process.exit(1); });
