#!/usr/bin/env node
/**
 * patch-orb-ownerOf-harden.cjs — SMALL surgical follow-up to patch-cooldowns-seas.cjs.
 *
 * BUG (live, non-blocking): /seas/use-chrono-orb does an on-chain ownerOf(tokenId) to verify the caller
 * owns the pawn. For a SYNTHETIC free-play pawn (the sentinel collection 0x5ea5…a5 is not a deployed
 * NFT), ownerOf returns "0x" → ethers throws BAD_DATA ("could not decode result data") → the throw is
 * uncaught inside useChronoOrb → the route handler returns a raw 500 leaking ethers internals.
 *
 * FIX: wrap the ownerOf read in a try/catch. A revert / BAD_DATA / "0x" / RPC error now returns a CLEAN
 * 403 with a clear reason instead of a 500 — the documented free-play case (synthetic pawns can't pass
 * ownerOf; the orb-skip needs a wallet-owned pawn). REAL-OR-NOTHING preserved: this is BEFORE any orb
 * debit or cooldown clear, so the failure path moves nothing.
 *
 * Idempotent (re-run = no-op once patched). DRY by default; --write applies. Aborts LOUDLY if the
 * anchor is missing/drifted (no blind insert). Backs up to .pre-orb-harden.bak.
 *
 * This is a SEPARATE patch file (NOT a new step in patch-cooldowns-seas.cjs) because the 16-step
 * cooldown patch is ALREADY applied live; this anchors on the CURRENT live state (cooldown patch present).
 *
 * USAGE (on the VPS, coordinator):
 *   node patch-orb-ownerOf-harden.cjs --server /var/www/tasern/server/seas-server.js          # DRY
 *   node patch-orb-ownerOf-harden.cjs --server /var/www/tasern/server/seas-server.js --write    # applies
 *
 * Then: node --check → node seas-server.js --selftest → pm2 restart seas-server → curl-verify.
 *
 * NO SILENT CATCHES in the server: the wrapped catch returns a VISIBLE 403 with the real failure reason.
 */
'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WRITE = args.includes('--write');
const SERVER = opt('--server');
if (!SERVER) { console.error('required: --server <path to live seas-server.js>'); process.exit(1); }

// ── the single byte-exact anchor (the ownership read inside useChronoOrb, written by the cooldown patch).
//   We replace just this one line with a try/catch'd version. 2-space indent, unique in the file.
const ANCHOR = `  const owner = await readPawnOwner(collection, tid);`;
const REPLACEMENT =
`  // OWNERSHIP read is on-chain; a SYNTHETIC / non-deployed collection makes ownerOf return "0x" (BAD_DATA)
  // or revert. Catch it and answer a CLEAN 403 — never a raw 500 leaking ethers internals. This runs
  // BEFORE any orb debit / cooldown clear, so the failure path is real-or-nothing (moves nothing).
  let owner;
  try {
    owner = await readPawnOwner(collection, tid);
  } catch (e) {
    return { status: 403, body: { ok: false, action, collection, tokenId: tid.toString(),
      reason: 'that pawn is not a recognized on-chain NFT (orb-skip needs a wallet-owned pawn)' } };
  }`;

// idempotency marker — the unique reason string the wrapped catch returns.
const MARKER = 'that pawn is not a recognized on-chain NFT (orb-skip needs a wallet-owned pawn)';

function apply(src) {
  const s = src;
  if (s.includes(MARKER)) return { s, changed: false };

  if (!s.includes(ANCHOR)) {
    throw new Error('ANCHOR NOT FOUND — the live file drifted from the expected (cooldown-patched) text.\n' +
      'Patch by hand. Expected to find exactly this line:\n--- BEGIN ANCHOR ---\n' + ANCHOR + '\n--- END ANCHOR ---');
  }
  if (s.indexOf(ANCHOR) !== s.lastIndexOf(ANCHOR)) {
    throw new Error('AMBIGUOUS anchor — the ownerOf read line appears more than once; refusing to guess. Patch by hand.');
  }

  const out = s.replace(ANCHOR, REPLACEMENT);

  // post-condition: the marker must now be present (proves the wrap landed)
  if (!out.includes(MARKER)) throw new Error('POST-PATCH CHECK FAILED — the hardening marker is missing after the edit.');
  return { s: out, changed: true };
}

(function main() {
  if (!fs.existsSync(SERVER)) { console.error('server file not found:', SERVER); process.exit(1); }
  const src = fs.readFileSync(SERVER, 'utf8');
  const { s, changed } = apply(src);

  console.log('patch plan for', SERVER);
  console.log(changed ? '  ~ wrap useChronoOrb ownerOf read in try/catch → clean 403 (was raw 500)'
                      : '  (already hardened — no changes)');

  if (!WRITE) {
    console.log('\nDRY — re-run with --write to apply, then:');
    console.log('  1) node --check ' + SERVER);
    console.log('  2) node ' + SERVER + ' --selftest        (must print "ALL PASSED")');
    console.log('  3) pm2 restart seas-server');
    console.log('  4) curl-verify: use-chrono-orb with a synthetic pawn → 403 (not 500).');
    return;
  }

  if (!changed) { console.log('\nserver already hardened — left as-is'); return; }

  const bak = SERVER + '.pre-orb-harden.bak';
  fs.copyFileSync(SERVER, bak);
  fs.writeFileSync(SERVER, s);
  console.log('\npatched', SERVER, '(backup:', bak + ')');
  console.log('NEXT (coordinator): node --check → node seas-server.js --selftest → pm2 restart seas-server → curl-verify.');
})();
