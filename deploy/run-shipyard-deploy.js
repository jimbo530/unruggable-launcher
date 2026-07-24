// Wrapper: injects env for deploy-shipyard.js WITHOUT exposing the key on the
// command line. Key is read from the existing .env (AGENT_PRIVATE_KEY). Public
// addresses are set here. Dry-run by default; pass "broadcast" to go live.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });

process.env.DEPLOY_PRIVATE_KEY = process.env.DEPLOY_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
process.env.ALCHEMY_RPC   = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
process.env.TREASURY_ADDRESS = '0x799CfafABA99e9779fA8779B56dE62E193cb7B30'; // Vault
process.env.PRIZE_WALLET     = '0x799CfafABA99e9779fA8779B56dE62E193cb7B30'; // Vault (== treasury)
process.env.USDC_ADDRESS     = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base USDC
process.env.ETH_USD          = process.env.ETH_USD || '1748';

if (process.argv.includes('broadcast')) process.env.BROADCAST = '1';

require('./deploy-shipyard.js');
