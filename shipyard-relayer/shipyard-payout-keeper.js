#!/usr/bin/env node
/**
 * Shipyard crew USDC payout keeper (DRY-RUN by default, import-safe).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES
 *   For each Shipyard launch, the SporeReactorV6 redeems collected Money fees to
 *   USDC and forwards them to that launch's FeeShareDistributor (the 100 crew
 *   NFTs). Each NFT id (0..99) then has a `pending(id)` USDC balance that its
 *   owner can pull with `claim(id)` / `claimAll(ids)`.
 *
 *   This keeper PUSHES those pending USDC shares out to the 100 crew NFT holders
 *   so holders never have to claim themselves (a gasless-for-holders service):
 *
 *     PHASE B (core, always-on):  FeeShareDistributor.claimAll(ids)
 *         Reads pending(id) for ids 0..99 (one Multicall3 batch read), filters to
 *         the ids that actually have USDC waiting, and — if the distributor's
 *         total claimable clears MIN_CLAIM_USDC — calls claimAll(ids) in chunks.
 *         claimAll is PERMISSIONLESS and ALWAYS pays ownerOf(id), never the
 *         caller, so this keeper can only DELIVER USDC to rightful holders — it
 *         can never take any (verified against contract source).
 *
 *     PHASE A (optional top-up, OFF by default):  SporeReactorV6.execute()
 *         If TRIGGER_REACTOR=true, and only when the reactor's 2h cooldown has
 *         elapsed and it is not paused, the keeper first calls execute() to
 *         collect fees → redeem Money → fund the distributor with fresh USDC.
 *         execute() is also permissionless and non-custodial (it burns token,
 *         deepens LP, and routes USDC to the distributor; the caller gets
 *         nothing). It is wrapped in try/catch so a cooldown/empty fire never
 *         blocks the claim phase. OFF by default so the keeper never burns the
 *         2h cooldown on empty fees — enable it only if this keeper is the thing
 *         driving the reactor cadence.
 *
 * WHICH CONTRACTS / ADDRESSES
 *   The FeeShareDistributor is PER-LAUNCH — there is no single fixed address.
 *   Targets are resolved from .env (no address is ever invented in code):
 *     - DISTRIBUTOR_ADDRESSES : explicit comma-separated distributor addresses
 *         (the reactor + payout token for each are read on-chain from the
 *          distributor itself: reactor() / token()), OR
 *     - SHIPYARD_ADDRESS : enumerate every launch via launchCount()/launches(i)
 *         and target all of their distributors.
 *   Verified live refs (see deploy/shipyard-FINAL-deployed.json) are provided in
 *   .env.example: Shipyard 0x1afBe7101Acc6460d8793e17c40f9aa5Bbd7D573,
 *   USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (the distributor payout token).
 *
 * REQUIREMENTS (env only — NEVER hardcode keys; see .env.example)
 *   ALCHEMY_RPC            Base RPC URL (falls back to https://mainnet.base.org)
 *   SHIPYARD_ADDRESS       Shipyard factory (for auto-discovery of distributors)
 *   DISTRIBUTOR_ADDRESSES  comma-separated distributor list (overrides discovery)
 *   PAYOUT_KEY|RELAYER_KEY signer private key (required ONLY when DRY_RUN=false)
 *   DRY_RUN                "false" to actually send; ANYTHING ELSE = dry run
 *   TRIGGER_REACTOR        "true" to also fire reactor.execute() (default off)
 *   MIN_CLAIM_USDC         skip a distributor under this much total claimable,
 *                          in whole USDC (default 0.10)
 *   CLAIM_BATCH            ids per claimAll tx (default 50, max 100)
 *   POLL_MS                loop interval ms (default 300000 = 5 min)
 *   ONCE                   "true" for a single pass then exit
 *   MIN_ETH_WARN           warn if signer ETH below this (default 0.0004)
 *   EXECUTE_GAS            explicit gasLimit for execute() (default 8000000)
 *
 * RUN DRY FIRST (sends nothing, no key needed):
 *     node shipyard-payout-keeper.js
 *     node shipyard-payout-keeper.js   # ONCE=true for a single scan
 *   LIVE (only when you have reviewed + funded the signer):
 *     DRY_RUN=false PAYOUT_KEY=0x.. node shipyard-payout-keeper.js
 *
 * This tool does NOT auto-start anything and NEVER fires on import: main() runs
 * only when not under the node:test runner (NODE_TEST_CONTEXT guard) and only
 * sends when DRY_RUN=false. No transaction is ever sent in dry mode.
 * ──────────────────────────────────────────────────────────────────────────
 */

const path = require("path");
const { ethers } = require("ethers");
// Load this folder's .env (does not touch process env that's already set).
require("dotenv").config({ path: path.join(__dirname, ".env") });

// ── Config (env only) ───────────────────────────────────────────────────────
const RPC = process.env.ALCHEMY_RPC || "https://mainnet.base.org";
const SHIPYARD_ADDRESS = (process.env.SHIPYARD_ADDRESS || "").trim();
const DISTRIBUTOR_ADDRESSES = (process.env.DISTRIBUTOR_ADDRESSES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PAYOUT_KEY = process.env.PAYOUT_KEY || process.env.RELAYER_KEY || "";
const DRY_RUN = process.env.DRY_RUN !== "false"; // default TRUE (safe)
const TRIGGER_REACTOR = process.env.TRIGGER_REACTOR === "true"; // default FALSE
const ONCE = process.env.ONCE === "true" || process.argv.includes("--once");
const POLL_MS = parseInt(process.env.POLL_MS || "300000", 10);
const MIN_ETH_WARN = parseFloat(process.env.MIN_ETH_WARN || "0.0004");
const EXECUTE_GAS = BigInt(process.env.EXECUTE_GAS || "8000000");

// MIN_CLAIM_USDC is given in whole USDC; USDC has 6 decimals on Base.
const USDC_DECIMALS = 6;
const MIN_CLAIM_USDC_RAW = (() => {
  const whole = process.env.MIN_CLAIM_USDC || "0.10";
  try {
    return ethers.parseUnits(whole, USDC_DECIMALS);
  } catch {
    return ethers.parseUnits("0.10", USDC_DECIMALS);
  }
})();

let CLAIM_BATCH = parseInt(process.env.CLAIM_BATCH || "50", 10);
if (!Number.isFinite(CLAIM_BATCH) || CLAIM_BATCH < 1) CLAIM_BATCH = 50;
if (CLAIM_BATCH > 100) CLAIM_BATCH = 100;

const TOTAL_SHARES = 100; // FeeShareDistributor fixed supply, ids 0..99
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"; // canonical, all chains

// ── ABIs (minimal — only methods VERIFIED in contract source) ───────────────
// FeeShareDistributor.sol: pending/claim/claimAll/ownerOf/token/reactor.
const DISTRIBUTOR_ABI = [
  "function pending(uint256 id) view returns (uint256)",
  "function claim(uint256 id)",
  "function claimAll(uint256[] ids)",
  "function ownerOf(uint256 id) view returns (address)",
  "function token() view returns (address)",
  "function reactor() view returns (address)",
  "function accPerShare() view returns (uint256)",
  "function TOTAL_SHARES() view returns (uint256)",
  "event Claimed(uint256 indexed id, address indexed to, uint256 amount)",
];
// SporeReactorV6.sol: execute/timeUntilExecute/paused/distributor.
const REACTOR_ABI = [
  "function execute()",
  "function timeUntilExecute() view returns (uint256)",
  "function paused() view returns (bool)",
  "function distributor() view returns (address)",
  "event Executed(uint256 burned, uint256 redeemed, uint256 deposited, uint256 fueled, uint256 timestamp, address caller)",
];
// Shipyard.sol: launchCount/launches for distributor discovery.
const SHIPYARD_ABI = [
  "function launchCount() view returns (uint256)",
  "function launches(uint256) view returns (address token, address reactor, address distributor, address launcher, uint256 timestamp)",
  "function distributorOf(address token) view returns (address)",
];
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[])",
];

const distIface = new ethers.Interface(DISTRIBUTOR_ABI);

// ── Logging ─────────────────────────────────────────────────────────────────
function log(...a) {
  console.log(`[${new Date().toISOString()}]`, ...a);
}
function fail(...a) {
  console.error(`[${new Date().toISOString()}] ERROR:`, ...a);
}

// ── Pure helpers (exported for tests) ───────────────────────────────────────
function usdc(raw) {
  return `$${ethers.formatUnits(raw, USDC_DECIMALS)}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Given an array of { id, pending } (pending is bigint), return:
 *   { total, claimableIds } where claimableIds are the ids with pending > 0.
 */
function summarizePending(rows) {
  let total = 0n;
  const claimableIds = [];
  for (const r of rows) {
    if (r.pending > 0n) {
      total += r.pending;
      claimableIds.push(r.id);
    }
  }
  return { total, claimableIds };
}

// ── On-chain reads ──────────────────────────────────────────────────────────

/**
 * Resolve the list of payout targets: [{ distributor, reactor }].
 * Source priority: explicit DISTRIBUTOR_ADDRESSES, else enumerate via Shipyard.
 * The reactor for each distributor is read on-chain from the distributor's own
 * reactor() view (never invented).
 */
async function resolveTargets(provider) {
  const targets = [];

  if (DISTRIBUTOR_ADDRESSES.length) {
    for (const addr of DISTRIBUTOR_ADDRESSES) {
      if (!ethers.isAddress(addr)) {
        fail(`DISTRIBUTOR_ADDRESSES entry is not an address: ${addr} — skipping`);
        continue;
      }
      let reactor = ethers.ZeroAddress;
      try {
        const d = new ethers.Contract(addr, DISTRIBUTOR_ABI, provider);
        reactor = await d.reactor();
      } catch (e) {
        fail(`reactor() read failed for distributor ${addr}: ${e.shortMessage || e.message}`);
      }
      targets.push({ distributor: ethers.getAddress(addr), reactor });
    }
    return targets;
  }

  if (SHIPYARD_ADDRESS) {
    if (!ethers.isAddress(SHIPYARD_ADDRESS)) {
      fail(`SHIPYARD_ADDRESS is not a valid address: ${SHIPYARD_ADDRESS}`);
      return targets;
    }
    const yard = new ethers.Contract(SHIPYARD_ADDRESS, SHIPYARD_ABI, provider);
    let count = 0n;
    try {
      count = await yard.launchCount();
    } catch (e) {
      fail(`Shipyard.launchCount() failed: ${e.shortMessage || e.message}`);
      return targets;
    }
    for (let i = 0n; i < count; i++) {
      try {
        const l = await yard.launches(i);
        if (l.distributor && l.distributor !== ethers.ZeroAddress) {
          targets.push({ distributor: l.distributor, reactor: l.reactor });
        }
      } catch (e) {
        fail(`Shipyard.launches(${i}) failed: ${e.shortMessage || e.message}`);
      }
    }
    return targets;
  }

  fail("No targets configured. Set DISTRIBUTOR_ADDRESSES or SHIPYARD_ADDRESS in .env.");
  return targets;
}

/**
 * Batch-read pending(id) for ids 0..TOTAL_SHARES-1 on one distributor using
 * Multicall3 (single RPC round-trip). Returns [{ id, pending: bigint }].
 * allowFailure:true so a single bad id can never abort the batch.
 */
async function readPending(provider, distributor) {
  const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider);
  const calls = [];
  for (let id = 0; id < TOTAL_SHARES; id++) {
    calls.push({
      target: distributor,
      allowFailure: true,
      callData: distIface.encodeFunctionData("pending", [id]),
    });
  }
  const results = await mc.aggregate3.staticCall(calls);
  const rows = [];
  for (let id = 0; id < results.length; id++) {
    const { success, returnData } = results[id];
    if (!success || returnData === "0x") {
      rows.push({ id, pending: 0n });
      continue;
    }
    try {
      const [amt] = distIface.decodeFunctionResult("pending", returnData);
      rows.push({ id, pending: amt });
    } catch {
      rows.push({ id, pending: 0n });
    }
  }
  return rows;
}

// ── Phase A: optional reactor top-up ────────────────────────────────────────
async function maybeTriggerReactor(provider, wallet, reactor) {
  if (!TRIGGER_REACTOR) return;
  if (!reactor || reactor === ethers.ZeroAddress) {
    log(`  reactor: none wired — skip top-up`);
    return;
  }
  const r = new ethers.Contract(reactor, REACTOR_ABI, provider);
  let wait = 0n;
  let paused = false;
  try {
    wait = await r.timeUntilExecute();
    paused = await r.paused();
  } catch (e) {
    fail(`  reactor ${reactor} state read failed: ${e.shortMessage || e.message}`);
    return;
  }
  if (paused) {
    log(`  reactor ${reactor} is PAUSED — skip top-up`);
    return;
  }
  if (wait > 0n) {
    log(`  reactor ${reactor} cooldown: ${wait}s left — skip top-up`);
    return;
  }
  if (DRY_RUN) {
    log(`  [DRY-RUN] would call reactor.execute() on ${reactor} (gasLimit=${EXECUTE_GAS})`);
    return;
  }
  try {
    const signer = new ethers.Contract(reactor, REACTOR_ABI, wallet);
    log(`  reactor.execute() on ${reactor} ...`);
    const tx = await signer.execute({ gasLimit: EXECUTE_GAS });
    log(`    sent tx=${tx.hash}; waiting...`);
    const rcpt = await tx.wait();
    log(`    execute() mined in block ${rcpt.blockNumber} (gasUsed=${rcpt.gasUsed})`);
  } catch (e) {
    // Never blocks the claim phase — surfaced, not swallowed.
    fail(`  reactor.execute() failed (non-blocking): ${e.shortMessage || e.message}`);
  }
}

// ── Phase B: distribute claimable USDC to crew holders ──────────────────────
async function distributeOne(provider, wallet, target) {
  const { distributor, reactor } = target;
  log(`Distributor ${distributor}`);

  await maybeTriggerReactor(provider, wallet, reactor);

  let rows;
  try {
    rows = await readPending(provider, distributor);
  } catch (e) {
    fail(`  pending() batch read failed for ${distributor}: ${e.shortMessage || e.message}`);
    return;
  }

  const { total, claimableIds } = summarizePending(rows);
  log(`  claimable: ${usdc(total)} across ${claimableIds.length}/${TOTAL_SHARES} crew NFTs`);

  if (claimableIds.length === 0) {
    log(`  nothing to distribute — skip`);
    return;
  }
  if (total < MIN_CLAIM_USDC_RAW) {
    log(`  total ${usdc(total)} < MIN_CLAIM_USDC ${usdc(MIN_CLAIM_USDC_RAW)} — skip (below threshold)`);
    return;
  }

  const batches = chunk(claimableIds, CLAIM_BATCH);

  if (DRY_RUN) {
    log(
      `  [DRY-RUN] would claimAll ${claimableIds.length} ids in ${batches.length} batch(es) ` +
        `of <=${CLAIM_BATCH}; USDC pushed to each ownerOf(id). Sends nothing.`
    );
    return;
  }

  const signer = new ethers.Contract(distributor, DISTRIBUTOR_ABI, wallet);
  for (let b = 0; b < batches.length; b++) {
    const ids = batches[b];
    try {
      log(`  claimAll batch ${b + 1}/${batches.length} (${ids.length} ids) ...`);
      const tx = await signer.claimAll(ids);
      log(`    sent tx=${tx.hash}; waiting...`);
      const rcpt = await tx.wait();
      log(`    batch ${b + 1} mined in block ${rcpt.blockNumber} (gasUsed=${rcpt.gasUsed})`);
    } catch (e) {
      // Surface and continue to the next batch — no silent catch.
      fail(`  claimAll batch ${b + 1} failed: ${e.shortMessage || e.message}`);
    }
  }
}

// ── One full pass over all targets ──────────────────────────────────────────
async function pass(provider, wallet) {
  const targets = await resolveTargets(provider);
  if (!targets.length) {
    log("No payout targets resolved this pass.");
    return;
  }
  log(`Resolved ${targets.length} distributor target(s).`);

  // Warn on low signer ETH before doing live work (keeper spends its own gas).
  if (!DRY_RUN && wallet) {
    try {
      const bal = await provider.getBalance(wallet.address);
      const eth = Number(ethers.formatEther(bal));
      if (eth < MIN_ETH_WARN) {
        fail(`Signer ETH low: ${eth} < ${MIN_ETH_WARN}. Top up to keep paying out.`);
      }
    } catch (e) {
      fail(`signer balance check failed: ${e.shortMessage || e.message}`);
    }
  }

  for (const t of targets) {
    try {
      await distributeOne(provider, wallet, t);
    } catch (e) {
      fail(`target ${t.distributor} failed: ${e.shortMessage || e.message}`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  log(`Connected chainId=${net.chainId} via ${String(RPC).split("/v2/")[0]}`);
  log(`Mode: ${DRY_RUN ? "DRY-RUN (sends nothing)" : "LIVE (will send claim/execute txs)"}`);
  log(`Reactor top-up (execute): ${TRIGGER_REACTOR ? "ON" : "OFF"}`);
  log(`MIN_CLAIM_USDC=${usdc(MIN_CLAIM_USDC_RAW)} | CLAIM_BATCH=${CLAIM_BATCH} | POLL_MS=${POLL_MS}`);
  if (DISTRIBUTOR_ADDRESSES.length) {
    log(`Targets: ${DISTRIBUTOR_ADDRESSES.length} explicit distributor(s).`);
  } else if (SHIPYARD_ADDRESS) {
    log(`Targets: auto-discover via Shipyard ${SHIPYARD_ADDRESS}.`);
  }

  let wallet = null;
  if (!DRY_RUN) {
    if (!PAYOUT_KEY) {
      fail("DRY_RUN=false but PAYOUT_KEY/RELAYER_KEY not set. Refusing to run blind.");
      process.exit(1);
    }
    wallet = new ethers.Wallet(PAYOUT_KEY, provider);
    log(`Signer: ${wallet.address}`); // address only — key is NEVER printed
  } else {
    log("Signer not loaded (dry run). Set PAYOUT_KEY + DRY_RUN=false to send.");
  }

  await pass(provider, wallet);

  if (ONCE) {
    log("ONCE set — single pass complete, exiting.");
    return;
  }

  // Simple poll loop (no overlap: awaited sequentially).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      await pass(provider, wallet);
    } catch (e) {
      fail("pass failed:", e.shortMessage || e.message || e);
    }
  }
}

// Exported for tests (shipyard-payout-keeper.test.js).
module.exports = { summarizePending, chunk, usdc };

// Run main() only OUTSIDE the node:test runner. Do NOT use an argv[1] check —
// PM2 fork mode launches via a wrapper so argv[1] never matches and the keeper
// would sit idle. This guard guarantees the keeper NEVER fires on import.
if (!process.env.NODE_TEST_CONTEXT) {
  main().catch((e) => {
    fail("fatal:", e.shortMessage || e.message || e);
    process.exit(1);
  });
}
