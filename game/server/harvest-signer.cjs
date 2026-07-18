#!/usr/bin/env node
/**
 * harvest-signer.cjs — the GAME BACKEND signer that authorizes a CATCH on a HarvestGround.
 *
 * Mirrors location-signer.cjs exactly, for the harvest dispenser. The seas-server (the referee) has
 * ALREADY verified the pawn is at the grounds, read its skill + the standing flow-supply, and computed
 * the deterministic catch amount (citizen/lib/harvest.js). This module then signs the EXACT message
 * HarvestGround.catchHash expects so HarvestGround.dispense() will release that amount:
 *
 *   toEthSignedMessageHash( keccak256(abi.encodePacked(
 *       ground, collection, tokenId, resource, amount, expiry, nonce, chainId )) )
 *
 * The amount + nonce + expiry are decided by the server (NOT the client) — the contract only releases
 * what THIS key signs, so a player can never mint themselves a bigger catch or replay a ticket.
 *
 * SECURITY: this is the trusted game key — it only ATTESTS a server-computed catch (it moves no funds;
 * the dispenser holds the stock). It REUSES the same key file as location-signer (one game signer for
 * the whole seas backend) unless HARVEST_SIGNER_ENV points elsewhere. Keep server-side only (VPS).
 *
 * Usage (module):  const { signCatch } = require('./harvest-signer.cjs');
 *                  await signCatch({ ground, collection, tokenId, resource, amount, expiry, nonce })
 *   `amount` is a wei-string/BigInt (resource's smallest unit); `nonce` is a 0x..32-byte hex.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHAIN_ID = 8453n;
// One game signer for the whole seas backend: default to the SAME key file location-signer uses, so a
// single VPS key both attests presence AND authorizes catches. Override with HARVEST_SIGNER_ENV.
const SIGNER_ENV = process.env.HARVEST_SIGNER_ENV || path.join(os.homedir(), '.seas-location-signer.env');
const KEY_RE = /(?:SEAS_LOCATION_SIGNER_KEY|SEAS_HARVEST_SIGNER_KEY)=(0x[0-9a-fA-F]{64})/;

function signerKeyPresent() { return fs.existsSync(SIGNER_ENV) && KEY_RE.test(fs.readFileSync(SIGNER_ENV, 'utf8')); }

function loadSigner() {
  if (!fs.existsSync(SIGNER_ENV)) throw new Error(`harvest signer env not found: ${SIGNER_ENV}`);
  const m = fs.readFileSync(SIGNER_ENV, 'utf8').match(KEY_RE);
  if (!m) throw new Error('SEAS_LOCATION_SIGNER_KEY / SEAS_HARVEST_SIGNER_KEY missing in ' + SIGNER_ENV);
  return new ethers.Wallet(m[1]);
}

/**
 * Build + sign a catch authorization. All fields are server-decided; the contract releases EXACTLY
 * `amount` of `resource` to ownerOf(tokenId), once, before `expiry`, for the single-use `nonce`.
 * @param {{ground:string, collection:string, tokenId:string|number|bigint, resource:string,
 *           amount:string|bigint, expiry:number, nonce:string}} a
 * @returns {{ground,collection,tokenId,resource,amount,expiry,nonce,sig,signer}}
 */
async function signCatch(a) {
  const ground = ethers.getAddress(a.ground);
  const collection = ethers.getAddress(a.collection);
  const resource = ethers.getAddress(a.resource);
  const tokenId = BigInt(a.tokenId);
  const amount = BigInt(a.amount);
  const expiry = Number(a.expiry);
  const nonce = ethers.hexlify(a.nonce); // normalize / validate 32-byte hex
  if (ethers.dataLength(nonce) !== 32) throw new Error('nonce must be 32 bytes');
  if (!(amount > 0n)) throw new Error('amount must be > 0');
  const signer = loadSigner();
  const raw = ethers.solidityPackedKeccak256(
    ['address', 'address', 'uint256', 'address', 'uint256', 'uint256', 'bytes32', 'uint256'],
    [ground, collection, tokenId, resource, amount, expiry, nonce, CHAIN_ID]
  );
  const sig = await signer.signMessage(ethers.getBytes(raw));
  return { ground, collection, tokenId: tokenId.toString(), resource, amount: amount.toString(), expiry, nonce, sig, signer: signer.address };
}

module.exports = { signCatch, loadSigner, signerKeyPresent, SIGNER_ENV, CHAIN_ID };

// ── CLI / self-test ────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    // Deterministic local check: sign with a throwaway key (no VPS key needed) and recover it the way
    // the contract does, proving the packed encoding round-trips. Real signing uses the VPS key file.
    const ground = '0x' + '11'.repeat(20), collection = '0x' + '22'.repeat(20), resource = '0x' + '33'.repeat(20);
    const tokenId = 7n, amount = ethers.parseUnits('50', 18), expiry = Math.floor(Date.now() / 1000) + 300;
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const w = ethers.Wallet.createRandom();
    const raw = ethers.solidityPackedKeccak256(
      ['address', 'address', 'uint256', 'address', 'uint256', 'uint256', 'bytes32', 'uint256'],
      [ground, collection, tokenId, resource, amount, expiry, nonce, CHAIN_ID]
    );
    const sig = await w.signMessage(ethers.getBytes(raw));
    const recovered = ethers.verifyMessage(ethers.getBytes(raw), sig);
    console.log('signer key file:', SIGNER_ENV, '| present:', signerKeyPresent());
    console.log(recovered.toLowerCase() === w.address.toLowerCase()
      ? 'OK — catch signature recovers to the signer (HarvestGround would accept it)'
      : 'MISMATCH — encoding bug; the contract would reject this');
    process.exit(recovered.toLowerCase() === w.address.toLowerCase() ? 0 : 1);
  })().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
}
