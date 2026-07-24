#!/usr/bin/env node
/**
 * rental-consent.cjs — REAL signed-permission rentals for "Hire a Hero" (founder 2026-06-26:
 * "signed permission"). An owner LETS another player USE their pawn in a party WITHOUT selling it:
 * the owner signs a consent, the game VERIFIES the signature against the on-chain ownerOf, and the
 * NFT never moves. Real consent, zero risk to the NFT. Mirrors location-signer.cjs.
 *
 * THE OWNER SIGNS (client-side, their own wallet — NOT a central key):
 *   personal_sign( keccak256(abi.encodePacked(dist, tokenId, renter, expiry, chainId)) )
 * meaning: "the holder of pawn <dist>:<tokenId> permits <renter> to use it until <expiry>".
 *
 * THE GAME VERIFIES (here): recover the signer, confirm it === the LIVE on-chain ownerOf(dist,tokenId),
 * and that expiry hasn't passed. If the pawn is sold/transferred, ownerOf changes → the old consent
 * stops verifying automatically (a stale permission can never hijack a transferred pawn).
 *
 *   const { rentalHash, verifyRentalConsent } = require('./rental-consent.cjs');
 *   await verifyRentalConsent({ dist, tokenId, renter, expiry, sig })  // -> { valid, owner, reason }
 */
const { ethers } = require('ethers');

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const CHAIN_ID = 8453n;
const ERC721_ABI = ['function ownerOf(uint256) view returns (address)'];

/** The exact message an owner signs to lend pawn <dist>:<tokenId> to <renter> until <expiry>. */
function rentalHash(dist, tokenId, renter, expiry, chainId = CHAIN_ID) {
  return ethers.solidityPackedKeccak256(
    ['address', 'uint256', 'address', 'uint256', 'uint256'],
    [dist, BigInt(tokenId), renter, BigInt(expiry), BigInt(chainId)]
  );
}

/** What the owner's wallet signs (personal_sign over the raw hash bytes). Client helper. */
async function signRentalConsent(signer, { dist, tokenId, renter, expiry }) {
  const raw = rentalHash(dist, tokenId, renter, expiry);
  const sig = await signer.signMessage(ethers.getBytes(raw));
  return { dist, tokenId: String(tokenId), renter, expiry, sig };
}

/**
 * Verify a rental consent against the LIVE on-chain owner. Returns { valid, owner, recovered, reason }.
 * NO silent failure — a bad/expired/forged consent returns valid:false with a reason, never throws on
 * a normal rejection (only throws on an RPC/connectivity error so it's visible).
 */
async function verifyRentalConsent({ dist, tokenId, renter, expiry, sig }, opts = {}) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!dist || tokenId == null || !renter || !expiry || !sig) {
    return { valid: false, reason: 'missing field (need dist,tokenId,renter,expiry,sig)' };
  }
  if (Number(expiry) <= now) return { valid: false, reason: `consent expired (${expiry} <= ${now})` };

  const raw = rentalHash(dist, tokenId, renter, expiry);
  let recovered;
  try { recovered = ethers.verifyMessage(ethers.getBytes(raw), sig); }
  catch (e) { return { valid: false, reason: 'bad signature: ' + (e.shortMessage || e.message) }; }

  const provider = opts.provider || new ethers.JsonRpcProvider(RPC);
  let owner;
  try { owner = await new ethers.Contract(dist, ERC721_ABI, provider).ownerOf(BigInt(tokenId)); }
  catch (e) { throw new Error(`ownerOf(${dist},${tokenId}) read failed: ${e.shortMessage || e.message}`); } // visible

  const valid = owner.toLowerCase() === recovered.toLowerCase();
  return {
    valid, owner, recovered,
    reason: valid ? null : 'signer is not the current on-chain owner (sold/transferred or forged)',
  };
}

module.exports = { rentalHash, signRentalConsent, verifyRentalConsent, CHAIN_ID };

// ── self-test ────────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    // 1) recovery logic: a throwaway wallet signs → verify recovers to IT (then ownerOf mismatch → invalid)
    const w = ethers.Wallet.createRandom();
    const dist = '0x9500880DEC9B310b4a728C75A271a25615A2443E'; // Sol del Mar (agent owns #0)
    const consent = await signRentalConsent(w, { dist, tokenId: 0, renter: '0x000000000000000000000000000000000000dEaD', expiry: Math.floor(Date.now() / 1000) + 3600 });
    const raw = rentalHash(consent.dist, consent.tokenId, consent.renter, consent.expiry);
    const rec = ethers.verifyMessage(ethers.getBytes(raw), consent.sig);
    console.log('recover == signer:', rec.toLowerCase() === w.address.toLowerCase() ? 'OK' : 'FAIL');
    // 2) full verify: random signer is NOT the on-chain owner → valid:false (real ownerOf read)
    const res = await verifyRentalConsent(consent);
    console.log('random-signer consent valid?', res.valid, '|', res.reason, '| on-chain owner:', res.owner);
    // 3) expiry guard
    const exp = await verifyRentalConsent({ ...consent, expiry: 1 });
    console.log('expired consent valid?', exp.valid, '|', exp.reason);
  })().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}
