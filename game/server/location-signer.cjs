#!/usr/bin/env node
/**
 * location-signer.cjs — the GAME BACKEND signer that unlocks gated LocationPool swaps.
 *
 * Every swap on a keyed pool (the 94 market pools + the mill LPs) requires a fresh attestation from
 * the factory's gameSigner (0xF426…) proving the caller is AT the pool's location. This module holds
 * that key (~/.seas-location-signer.env, written by deploy/deploy-location-lp.js) and signs the EXACT
 * message LocationPool.attestationHash expects:
 *     toEthSignedMessageHash( keccak256(abi.encodePacked(poolAddr, player, location, expiry, chainId)) )
 * The pool's `location` is read live from chain so it can never drift from what the contract checks.
 *
 * SECURITY: this is the trusted game key — it only ATTESTS presence (never moves funds; swaps still
 * pull the player's own tokens). The CALLER (game server) must verify the player is genuinely at the
 * port (co-location check, game state) BEFORE asking for a signature. Keep this server-side only.
 *
 * Usage (module):  const { signSwap } = require('./location-signer.cjs'); await signSwap(pool, player)
 * Usage (CLI test): node game/server/location-signer.cjs <poolAddr> [player] [--verify]
 */
const { ethers } = require('ethers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const CHAIN_ID = 8453n;
const SIGNER_ENV = path.join(os.homedir(), '.seas-location-signer.env');
const TTL_SECS = Number(process.env.ATTEST_TTL || 300);   // attestations expire in 5 min by default

const POOL_ABI = ['function location() view returns (uint256)', 'function factory() view returns (address)'];
const FACTORY_ABI = ['function gameSigner() view returns (address)'];

function loadSigner() {
  if (!fs.existsSync(SIGNER_ENV)) throw new Error(`signer env not found: ${SIGNER_ENV}`);
  const m = fs.readFileSync(SIGNER_ENV, 'utf8').match(/SEAS_LOCATION_SIGNER_KEY=(0x[0-9a-fA-F]{64})/);
  if (!m) throw new Error('SEAS_LOCATION_SIGNER_KEY missing in ' + SIGNER_ENV);
  return new ethers.Wallet(m[1]);
}

/** Build + sign the presence attestation for (pool, player). Reads the pool's location from chain. */
async function signSwap(poolAddr, player, opts = {}) {
  const provider = new ethers.JsonRpcProvider(RPC);
  const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
  const location = await pool.location();
  const now = (await provider.getBlock('latest')).timestamp;
  const expiry = opts.expiry || now + TTL_SECS;
  const signer = loadSigner();
  const raw = ethers.solidityPackedKeccak256(
    ['address', 'address', 'uint256', 'uint256', 'uint256'],
    [poolAddr, player, location, expiry, CHAIN_ID]
  );
  const sig = await signer.signMessage(ethers.getBytes(raw));
  return { pool: poolAddr, player, location: location.toString(), expiry, sig, signer: signer.address };
}

module.exports = { signSwap, loadSigner };

// ── CLI / self-test ────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const [poolAddr, playerArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
    if (!poolAddr) { console.error('usage: location-signer.cjs <poolAddr> [player] [--verify]'); process.exit(1); }
    const player = playerArg || '0x000000000000000000000000000000000000dEaD';
    const a = await signSwap(poolAddr, player);
    console.log('attestation:', JSON.stringify({ pool: a.pool, player: a.player, location: a.location, expiry: a.expiry, signer: a.signer }, null, 2));
    console.log('sig:', a.sig.slice(0, 22) + '…');

    // VERIFY: recover the signer the way the contract does, + confirm it matches the factory's gameSigner
    const raw = ethers.solidityPackedKeccak256(
      ['address', 'address', 'uint256', 'uint256', 'uint256'],
      [a.pool, a.player, BigInt(a.location), a.expiry, CHAIN_ID]
    );
    const recovered = ethers.verifyMessage(ethers.getBytes(raw), a.sig);
    const provider = new ethers.JsonRpcProvider(RPC);
    const factory = await new ethers.Contract(poolAddr, POOL_ABI, provider).factory();
    const onchainSigner = await new ethers.Contract(factory, FACTORY_ABI, provider).gameSigner();
    console.log('recovered  :', recovered);
    console.log('on-chain gameSigner:', onchainSigner);
    console.log(recovered.toLowerCase() === onchainSigner.toLowerCase()
      ? '✅ signature recovers to the on-chain gameSigner — swap would be accepted'
      : '❌ MISMATCH — the pool would reject this attestation');
  })().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
}
