#!/usr/bin/env node
/**
 * Dock launch relayer keeper (DRY-RUN by default).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES
 *   Watches the Dock contract for `LaunchRequested` events. For each unfulfilled
 *   request it calls `Dock.fulfill(id)` from a relayer wallet — the relayer pays
 *   the heavy launch gas; the ship always lands in the original requester's
 *   wallet (the user is stored on-chain, so fulfilling can never steal a ship).
 *
 * REQUIREMENTS
 *   - A FUNDED ETH relayer wallet on Base (fulfill costs real gas).
 *   - Env config (NEVER hardcode keys):
 *       ALCHEMY_RPC        Base RPC URL (falls back to https://mainnet.base.org)
 *       DOCK_ADDRESS       deployed Dock contract address (required)
 *       RELAYER_KEY        relayer private key (required only when DRY_RUN=false)
 *       DRY_RUN            "false" to actually send; ANYTHING ELSE = dry run
 *       POLL_MS            poll interval (default 15000)
 *       FROM_BLOCK         starting block for the first scan (default: latest-5000)
 *       MIN_ETH_WARN       warn if relayer ETH below this (default 0.002)
 *       FULFILL_GAS        FIXED gas limit sent for fulfill (default 24000000)
 *       GAS_FLOOR/GAS_CAP  legacy, retained for back-compat (no longer gate send)
 *
 * GAS NOTE (root cause of the 2026-06-23 "first launch reverts" incident):
 *   A full launch uses ~16.5M gas but fulfill() REVERTS below a ~17.2M gas CLIFF
 *   (the buy-in's nested try/catch self-call starves under EIP-150's 63/64 rule).
 *   So `eth_estimateGas` REVERTS (it binary-searches below the cliff) even though
 *   the tx runs fine at a fixed high gas. We therefore send a FIXED FULFILL_GAS
 *   (24M) and NEVER let estimateGas size or gate the send. A funded relayer needs
 *   enough ETH for a ~16.5M-gas tx on Base.
 *
 * RUN DRY FIRST:
 *       node relayer/launch-keeper.js                 # DRY-RUN, sends nothing
 *       DRY_RUN=false RELAYER_KEY=0x.. node relayer/launch-keeper.js   # live
 *
 * This tool does NOT auto-start anything. It only sends when DRY_RUN=false.
 * ──────────────────────────────────────────────────────────────────────────
 */

const { ethers } = require("ethers");

// ── Config (env only) ──────────────────────────────────────────────────────
const RPC = process.env.ALCHEMY_RPC || "https://mainnet.base.org";
const DOCK_ADDRESS = process.env.DOCK_ADDRESS || "";
const RELAYER_KEY = process.env.RELAYER_KEY || "";
const DRY_RUN = process.env.DRY_RUN !== "false"; // default TRUE (safe)
const POLL_MS = parseInt(process.env.POLL_MS || "15000", 10);
const MIN_ETH_WARN = parseFloat(process.env.MIN_ETH_WARN || "0.002");
// GAS — THE root cause of the "first launch reverts" incident (diagnosed on a
// live + forked Base reproduction, 2026-06-23):
//
//   A full launch uses ~16.5M gas, BUT fulfill() REVERTS at any gas limit below
//   a ~17.2M CLIFF and only succeeds at/above it. This non-monotonic gas region
//   comes from the buy-in's nested `try this.executeBuyIn{63/64 gas}()` self-call
//   (EIP-150): below the cliff the sub-call is starved and the revert propagates.
//
//   Consequence: `eth_estimateGas` (a binary search) PROBES below the cliff, sees
//   a revert, and returns "execution reverted" with NO reason — even though the
//   tx executes fine at a fixed high gas (verified: live eth_call reverts @17M,
//   OK @17.2M/20M/30M). So we must NEVER let estimateGas gate the send, and must
//   send a FIXED explicit gasLimit safely ABOVE the cliff.
//
// FULFILL_GAS is a flat, explicit limit (default 24M: ~1.45x real usage, well
// above the 17.2M cliff, far under Base's 400M block limit). estimateGas is used
// only for informational logging, never to compute the sent limit.
const FULFILL_GAS = BigInt(process.env.FULFILL_GAS || "24000000");
// Retained for back-compat with older env; no longer gate the send.
const GAS_FLOOR = BigInt(process.env.GAS_FLOOR || "20000000");
const GAS_CAP = BigInt(process.env.GAS_CAP || "28000000");

const DOCK_ABI = [
  "event LaunchRequested(uint256 indexed id, address indexed user, string name, string symbol, uint256 amount)",
  "event LaunchFulfilled(uint256 indexed id, address indexed user, address token, address reactor, address distributor)",
  "function fulfill(uint256 id)",
  "function isFulfilled(uint256 id) view returns (bool)",
  "function requestCount() view returns (uint256)",
  "function requests(uint256) view returns (address user, string name, string symbol, address upstream, uint256 amount, bool fulfilled, uint256 createdAt)",
];

function log(...a) {
  console.log(`[${new Date().toISOString()}]`, ...a);
}
function fail(...a) {
  console.error(`[${new Date().toISOString()}] ERROR:`, ...a);
}

// ids we've already tried and that reverted — back off, don't infinite-retry.
const attempted = new Map(); // id -> { tries, lastErr }
const MAX_TRIES = 3;

// Gas limit for fulfill: estimate*1.5, floored/capped (estimate under-shoots).
function gasLimitFor(est) {
  let g = (est * 3n) / 2n;
  if (g < GAS_FLOOR) g = GAS_FLOOR;
  if (g > GAS_CAP) g = GAS_CAP;
  return g;
}

async function main() {
  if (!DOCK_ADDRESS) {
    fail("DOCK_ADDRESS not set. Aborting.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  log(`Connected to chainId=${net.chainId} via ${RPC.split("/v2/")[0]}`);
  log(`Dock: ${DOCK_ADDRESS}`);
  log(`Mode: ${DRY_RUN ? "DRY-RUN (sends nothing)" : "LIVE (will send fulfill txs)"}`);

  let wallet = null;
  let signerDock = null;
  if (!DRY_RUN) {
    if (!RELAYER_KEY) {
      fail("DRY_RUN=false but RELAYER_KEY not set. Refusing to run blind.");
      process.exit(1);
    }
    wallet = new ethers.Wallet(RELAYER_KEY, provider);
    signerDock = new ethers.Contract(DOCK_ADDRESS, DOCK_ABI, wallet);
    log(`Relayer: ${wallet.address}`);
  } else {
    log("Relayer wallet not loaded (dry run). Set RELAYER_KEY + DRY_RUN=false to send.");
  }

  const readDock = new ethers.Contract(DOCK_ADDRESS, DOCK_ABI, provider);

  const latest = await provider.getBlockNumber();
  let fromBlock = process.env.FROM_BLOCK
    ? parseInt(process.env.FROM_BLOCK, 10)
    : Math.max(0, latest - 5000);

  log(`Scanning from block ${fromBlock}...`);

  // simple poll loop
  while (true) {
    try {
      await tick(provider, readDock, signerDock, wallet, fromBlock).then((nb) => {
        fromBlock = nb;
      });
    } catch (e) {
      // Never silently swallow — log loudly and keep going.
      fail("tick failed:", e.shortMessage || e.message || e);
    }
    await sleep(POLL_MS);
  }
}

async function tick(provider, readDock, signerDock, wallet, fromBlock) {
  const latest = await provider.getBlockNumber();
  if (latest < fromBlock) return fromBlock;

  // Pull new LaunchRequested events since last scan.
  const filter = readDock.filters.LaunchRequested();
  const events = await readDock.queryFilter(filter, fromBlock, latest);
  if (events.length) {
    log(`Found ${events.length} LaunchRequested event(s) in [${fromBlock}, ${latest}]`);
  }

  for (const ev of events) {
    const id = ev.args.id;
    const user = ev.args.user;
    const name = ev.args.name;
    const symbol = ev.args.symbol;
    const amount = ev.args.amount;
    await handleRequest(provider, readDock, signerDock, wallet, id, user, name, symbol, amount);
  }

  return latest + 1;
}

async function handleRequest(provider, readDock, signerDock, wallet, id, user, name, symbol, amount) {
  const key = id.toString();

  // Skip if already fulfilled on-chain (idempotent / restart-safe).
  let fulfilled;
  try {
    fulfilled = await readDock.isFulfilled(id);
  } catch (e) {
    fail(`isFulfilled(${key}) read failed:`, e.shortMessage || e.message);
    return;
  }
  if (fulfilled) {
    log(`id=${key} already fulfilled/reclaimed — skip.`);
    return;
  }

  // Back off ids that keep reverting.
  const rec = attempted.get(key);
  if (rec && rec.tries >= MAX_TRIES) {
    log(`id=${key} hit MAX_TRIES (${MAX_TRIES}); backing off. Last err: ${rec.lastErr}`);
    return;
  }

  const usd = (Number(amount) / 1e6).toFixed(2);

  if (DRY_RUN) {
    // We ALWAYS send with a fixed gasLimit (FULFILL_GAS) above the revert cliff.
    // estimateGas is EXPECTED to revert here (it probes below the cliff) and is
    // NOT used to size the send — we report it only for visibility.
    let estStr = "n/a";
    try {
      const est = await readDock.fulfill.estimateGas(id);
      estStr = `estimateGas=${est} (informational only)`;
    } catch (e) {
      estStr = `estimateGas REVERTS (expected — gas cliff; not a blocker): ${(e.shortMessage || e.message || "").slice(0, 60)}`;
    }
    log(`[DRY-RUN] would fulfill id=${key} ship="${name}"(${symbol}) for user=${user} fee=$${usd} | would send fixed gasLimit=${FULFILL_GAS} | ${estStr}`);
    return;
  }

  // ── LIVE PATH ────────────────────────────────────────────────────────────
  // Warn on low relayer ETH (gas) before sending.
  try {
    const bal = await wallet.provider.getBalance(wallet.address);
    const eth = Number(ethers.formatEther(bal));
    if (eth < MIN_ETH_WARN) {
      fail(`Relayer ETH low: ${eth} < ${MIN_ETH_WARN}. Top up to keep fulfilling.`);
    }
  } catch (e) {
    fail("balance check failed:", e.shortMessage || e.message);
  }

  try {
    log(`Fulfilling id=${key} ship="${name}"(${symbol}) for user=${user} fee=$${usd} ...`);
    // CRITICAL: send a FIXED explicit gasLimit above the ~17.2M revert cliff.
    // Do NOT derive it from estimateGas — estimateGas reverts here (it probes
    // below the cliff). Passing { gasLimit } makes ethers skip its own auto
    // estimateGas, so the tx is broadcast as-is and executes (cliff cleared).
    const gasLimit = FULFILL_GAS;
    const tx = await signerDock.fulfill(id, { gasLimit });
    log(`  sent tx=${tx.hash} (fixed gasLimit=${gasLimit}); waiting...`);
    const rcpt = await tx.wait();
    log(`  fulfilled id=${key} in block ${rcpt.blockNumber} (gasUsed=${rcpt.gasUsed})`);
    attempted.delete(key);
  } catch (e) {
    const msg = e.shortMessage || e.message || String(e);
    const prev = attempted.get(key) || { tries: 0 };
    attempted.set(key, { tries: prev.tries + 1, lastErr: msg });
    fail(`fulfill(${key}) failed (try ${prev.tries + 1}/${MAX_TRIES}): ${msg}`);
    // No infinite retry — the backoff guard above stops us after MAX_TRIES.
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  fail("fatal:", e.shortMessage || e.message || e);
  process.exit(1);
});
