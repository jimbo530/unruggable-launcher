#!/usr/bin/env node
/**
 * verify-seas-market.cjs — Basescan-verify the WHOLE Seize-the-Seas market stack in one pass.
 *
 * Verifies, idempotently (skips anything already verified):
 *   1. LocationPool IMPLEMENTATION (0x6700ded6…) — the clone template. Verify ONCE and Basescan
 *      auto-marks all 94 pool clones as "Similar Match" (they are EIP-1167 minimal proxies).
 *   2. LocationLPFactory (0x54868729…) — constructor (implementation, gameSigner), read from records.
 *   3. Every in-game TOKEN (coins + goods) — all are LaunchToken.sol. Constructor
 *      (name, symbol, supply, recipient, baseURI) is reconstructed EXACTLY from chain truth:
 *        name/symbol/totalSupply via reads; baseURI via contractURI() minus its 42-char hex suffix;
 *        recipient via the mint Transfer(0x0 → recipient) log. No guessing — chain is truth.
 *
 * REQUIRES: BASESCAN_API_KEY in .env (free at basescan.org → API Keys). Nothing else.
 * RUN:  npx hardhat run deploy/verify-seas-market.cjs --network base
 *
 * Safe: read-only + verification only. Moves no funds, sends no game tx. Real-or-nothing logging.
 */
const hre = require('hardhat');
const path = require('path');
const fs = require('fs');

const DEPLOY = __dirname;
function readRec(f) { return JSON.parse(fs.readFileSync(path.join(DEPLOY, f), 'utf8')); }

const ERC20_META = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function contractURI() view returns (string)',
];
const TRANSFER_TOPIC = hre.ethers.id('Transfer(address,address,uint256)');
const ZERO_TOPIC = '0x' + '0'.repeat(64);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reconstruct a LaunchToken's EXACT constructor args from on-chain state. */
async function launchTokenArgs(provider, addr) {
  const c = new hre.ethers.Contract(addr, ERC20_META, provider);
  const [name, symbol, supply] = await Promise.all([c.name(), c.symbol(), c.totalSupply()]);
  // baseURI = contractURI() with the trailing "0x…addr" (42 chars) stripped. If contractURI reverts
  // (older token), fall back to '' — the common case (deploy-coins.js used '').
  let baseURI = '';
  try { const uri = await c.contractURI(); baseURI = uri.length >= 42 ? uri.slice(0, uri.length - 42) : ''; }
  catch { baseURI = ''; }
  // recipient = the address the full supply was minted to (Transfer from 0x0). Exact, not assumed.
  let recipient = null;
  try {
    const logs = await provider.getLogs({ address: addr, topics: [TRANSFER_TOPIC, ZERO_TOPIC], fromBlock: 0, toBlock: 'latest' });
    if (logs.length) recipient = hre.ethers.getAddress('0x' + logs[0].topics[2].slice(26));
  } catch { /* fall through to record owner below */ }
  return { name, symbol, supply, recipient, baseURI };
}

async function verify(label, address, constructorArguments, contract) {
  process.stdout.write(`\n• ${label}  ${address}\n`);
  try {
    await hre.run('verify:verify', { address, constructorArguments, contract });
    console.log(`  ✅ verified`);
    return 'verified';
  } catch (e) {
    const msg = (e && (e.message || String(e))) || 'unknown';
    if (/already verified/i.test(msg)) { console.log(`  ↺ already verified`); return 'already'; }
    console.log(`  ✗ FAILED: ${msg.split('\n')[0].slice(0, 240)}`);
    return 'failed';
  }
}

async function main() {
  if (!process.env.BASESCAN_API_KEY) {
    throw new Error('BASESCAN_API_KEY is not set — add it to .env (free at basescan.org → API Keys), then re-run.');
  }
  const provider = hre.ethers.provider;

  const loc = readRec('location-lp-deployed.json');       // implementation, factory, gameSigner
  const pk = readRec('port-keyed-pools-deployed.json');   // owner + goods tokens
  const ownerFallback = hre.ethers.getAddress(pk.owner);

  // ── unique token set: coins + goods ──
  const tokens = new Map(); // addr(lower) -> checksummed
  const coins = (readRec('port-royal-goods-walls-deployed.json').coins) || {};
  for (const a of Object.values(coins)) tokens.set(a.toLowerCase(), hre.ethers.getAddress(a));
  for (const p of Object.values(pk.pools)) tokens.set(p.goodAddr.toLowerCase(), hre.ethers.getAddress(p.goodAddr));

  console.log('=================================================================');
  console.log(' SEIZE THE SEAS — Basescan verification (chainId 8453)');
  console.log(`   implementation : ${loc.implementation}`);
  console.log(`   factory        : ${loc.factory}  (impl, gameSigner)`);
  console.log(`   unique tokens  : ${tokens.size}  (LaunchToken.sol)`);
  console.log(`   pool clones    : ${Object.keys(pk.pools).length}  (auto "Similar Match" once impl verifies)`);
  console.log('=================================================================');

  const tally = { verified: 0, already: 0, failed: 0 };
  const bump = (r) => { tally[r] = (tally[r] || 0) + 1; };

  // 1) implementation (no constructor args)
  bump(await verify('LocationPool (implementation)', hre.ethers.getAddress(loc.implementation), [], 'contracts/LocationPool.sol:LocationPool'));
  await sleep(1500);

  // 2) factory (implementation, gameSigner)
  bump(await verify('LocationLPFactory', hre.ethers.getAddress(loc.factory),
    [hre.ethers.getAddress(loc.implementation), hre.ethers.getAddress(loc.gameSigner)],
    'contracts/LocationLPFactory.sol:LocationLPFactory'));
  await sleep(1500);

  // 3) every token
  for (const addr of tokens.values()) {
    let args;
    try { args = await launchTokenArgs(provider, addr); }
    catch (e) { console.log(`\n• token ${addr}\n  ✗ FAILED to read on-chain args: ${e.message}`); bump('failed'); continue; }
    const recipient = args.recipient || ownerFallback;
    bump(await verify(`LaunchToken ${args.symbol} (${args.name})`, addr,
      [args.name, args.symbol, args.supply, recipient, args.baseURI],
      'contracts/LaunchToken.sol:LaunchToken'));
    await sleep(1500); // pace for the free-tier Basescan rate limit
  }

  console.log('\n=================================================================');
  console.log(` DONE. verified=${tally.verified} already=${tally.already} failed=${tally.failed}`);
  console.log(' The 94 pool clones will show as "Similar Match" to the verified implementation.');
  console.log('=================================================================');
  if (tally.failed) process.exitCode = 1;
}

main().catch((e) => { console.error('[verify-seas] FATAL:', e.message || e); process.exit(1); });
