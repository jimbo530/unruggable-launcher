// Flip the launch-keeper LIVE. Loads the relayer key from the protected
// ~/.shipyard-wallets.env (never printed), wires the deployed Dock + RPC, and
// sets DRY_RUN=false. The relayer can ONLY call Dock.fulfill (ships go to the
// stored user; it can never steal) and only ever spends its own gas.
const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.join(os.homedir(), '.shipyard-wallets.env') });

process.env.RELAYER_KEY   = process.env.RELAYER_KEY || process.env.RELAYER_PRIVATE_KEY;
process.env.ALCHEMY_RPC   = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
process.env.DOCK_ADDRESS  = '0x8Dd30d8858Cc61dEBE638623851d3f97a3773C05';
process.env.DRY_RUN       = 'false';
process.env.MIN_ETH_WARN  = process.env.MIN_ETH_WARN || '0.0004';
process.env.POLL_MS       = process.env.POLL_MS || '15000';

require('./launch-keeper.js');
