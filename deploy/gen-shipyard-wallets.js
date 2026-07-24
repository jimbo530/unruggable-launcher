// Generates the Vault + Relayer wallets for the Shipyard.
// SECURITY: private keys are written ONLY to a protected file in the home dir,
// NEVER printed to stdout. Only the two public addresses are printed.
// Uses flag 'wx' so it can NEVER overwrite an existing key file.
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const OUT = path.join(require('os').homedir(), '.shipyard-wallets.env');

const vault = ethers.Wallet.createRandom();
const relayer = ethers.Wallet.createRandom();

const body =
`# Shipyard wallets — KEEP SECRET. Back this up offline. Do NOT commit. Do NOT share.
# Vault = treasury + prize + owner/deployer (where funds go and sit).
# Relayer = hot VPS bot, holds only ETH for gas.
VAULT_ADDRESS=${vault.address}
VAULT_PRIVATE_KEY=${vault.privateKey}
RELAYER_ADDRESS=${relayer.address}
RELAYER_PRIVATE_KEY=${relayer.privateKey}
`;

try {
  fs.writeFileSync(OUT, body, { flag: 'wx', mode: 0o600 });
} catch (e) {
  if (e.code === 'EEXIST') {
    console.error('REFUSING TO OVERWRITE: ' + OUT + ' already exists. Move/back it up first.');
    process.exit(1);
  }
  throw e;
}

console.log('Wallets generated. Keys written to:', OUT);
console.log('VAULT  :', vault.address);
console.log('RELAYER:', relayer.address);
