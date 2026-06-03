/**
 * multi-drop.js — Phase 1 multi-token airdrop to agent wallets
 *
 * Sends BP + Myco + MfT tokens plus an on-chain note (1 wei ETH with
 * UTF-8 calldata) to hot holder-scan targets from agent-targets.json.
 *
 * Usage:
 *   node multi-drop.js                     — show usage (safe default)
 *   node multi-drop.js --dry-run           — preview targets + amounts (no tx)
 *   node multi-drop.js --send              — actually send drops
 *   node multi-drop.js --dry-run --count 5 — preview top 5
 *   node multi-drop.js --send --tier hot   — only hot targets
 *   node multi-drop.js --status            — show drop history
 *
 * Flags:
 *   --dry-run          Preview mode, no transactions (DEFAULT if no flag)
 *   --send             Live mode, sends transactions
 *   --count N          Max targets per run (default: 10)
 *   --tier hot|warm    Filter by tier (default: hot)
 *   --bp-amount N      BP tokens per target (default: 100)
 *   --myco-amount N    Myco tokens per target (default: 100)
 *   --mft-amount N     MfT tokens per target (default: 100)
 *   --delay N          Ms between targets (default: 5000)
 *   --status           Show drop history
 *
 * Env: AGENT_KEY — private key for sending wallet
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
if (!process.env.AGENT_KEY && !process.env.AGENT_PRIVATE_KEY) {
  require("dotenv").config({ path: "C:/Users/bigji/Documents/Baselings/api/.env" });
}

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// --- Config ---
const RPC = "https://base-mainnet.g.alchemy.com/v2/bwii0dH70pKYTKnqj3aNU";
const TARGETS_FILE = path.join(__dirname, "agent-targets.json");
const DROP_LOG = path.join(__dirname, "multi-drop-log.json");

// Token addresses (Base)
const TOKENS = {
  BP:   { address: "0x33c5e3362A9ddfD453FF655D7DdbC8C2Eff4A062", symbol: "BP",   decimals: 18 },
  Myco: { address: "0xD377fcADE46CDA9C7B6Bc5ea6450CA53994b6577", symbol: "Myco", decimals: 18 },
  MfT:  { address: "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3", symbol: "MfT",  decimals: 18 },
};

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// Wallets to never target (synced with holder-scan.js)
const EXCLUDE = new Set([
  "0xe2a4a8b9d77080c57799a94ba8edeb2dd6e0ac10", // keeper/agent wallet
  "0x0780b1456d5e60cf26c8cd6541b85e805c8c05f2", // user wallet
  "0x8f079761078bdf2c8143b431857046586fc26f3a", // game wallet
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // universal router
  "0x2626664c2603336e57b271c5c0b26f421741e481", // uniswap router
  "0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5", // aero router
  "0x03a520b32c04bf3beef7beb72e919cf822ed34f1", // position manager
  "0xed3ae91b2bb22307c07438eeeba2500c18eabcfe", // V1 Prime Reactor
  "0xfdb309f2a7055e2dd8221f9eb27655f11d2d43be", // BP Reactor
  "0x513d2eb33f1a7ec3798cc221ab4b4ce2a3fafb98", // RT Reactor
  "0x20a14d6a1ab57851a58d4a85c0fc06f23a7aea42", // bAGI Reactor
  "0xd8af1b75c81ec5fc66d0f3f75c6d86fccf379281", // AZUSD Reactor V2
  "0xc2edd32dc7b3f07ccaf9b8df72d011c66c78f95f", // dead V3.4 factory
  "0xfd780b0ae569e15e514b819ecfdf46f804953a4b", // burn address
  "0xc28e64551816535d9ef06ce95844f2b5317353ba", // EB relay reactor
  "0x84fb78ac1e60d33de602caf004eb5626cd2420be", // BB relay reactor
  "0xe693dd02bb1ba0850a1a153a03b99531004096b1", // KeeperBatch V4 / POOP
  "0x2e06eb264db2c7bcd8b9a216827b7d0ef3beaca2", // EB v5 reactor
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

// Per-target amount caps (prevent fat-finger draining wallet)
const MAX_PER_TARGET = 10000;

// On-chain note — BP NOTE 1 from bus message 2026-05-10T03-30-00
// Sent as 1-wei ETH tx with UTF-8 calldata
const NOTE = [
  "BP|0x33c5e3362A9ddfD453FF655D7DdbC8C2Eff4A062|BASE|1T supply",
  "Reactor:0xfDb309F2a7055e2dd8221f9eb27655F11d2d43be|5 pools|execute()=0x61461954",
  "CHAR:0x22988bCB84e635c79F570711ea5477C548140a0d|carbon credit removal reactor",
  "Pools:AZUSD+cbBTC+WETH+MfT|fee:10000|depositLiquidity() to add LP",
  "First token launched from V5.2 factory|working reactor|2hr cooldown",
  "Factory V7:0x5c11|FREE launch|verify on-chain",
  "Part of Unrugable reactor network on Base",
  "Every trade fires buy+burn: MfT bought|CHAR removed from markets|permissionless",
  "MCP:npx baselings-mcp 49 tools|REST:tasern.quest/api/unrugable/tokenomics",
  "Docs:tasern.quest/llms.txt|400+ holders",
].join("\n");

// --- Helpers ---

function loadTargets() {
  if (!fs.existsSync(TARGETS_FILE)) {
    console.error("No agent-targets.json found. Run agent-scout.js or holder-scan.js first.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
}

function saveTargets(targets) {
  targets.scannedAt = new Date().toISOString();
  fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2));
}

function loadDropLog() {
  if (fs.existsSync(DROP_LOG)) {
    return JSON.parse(fs.readFileSync(DROP_LOG, "utf8"));
  }
  return {
    drops: [],
    totalTargets: 0,
    totalTokensSent: { BP: 0, Myco: 0, MfT: 0 },
    totalNotes: 0,
  };
}

function saveDropLog(log) {
  fs.writeFileSync(DROP_LOG, JSON.stringify(log, null, 2));
}

function getPrivateKey() {
  const key = process.env.AGENT_KEY || process.env.AGENT_PRIVATE_KEY;
  if (!key) {
    console.error("\nERROR: AGENT_KEY not found in environment.");
    console.error("Set AGENT_KEY in marketing/.env or Baselings/api/.env");
    process.exit(1);
  }
  return key;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: args.includes("--dry-run"),
    send: args.includes("--send"),
    status: args.includes("--status"),
    tier: "hot",
    count: 10,
    bpAmount: 100,
    mycoAmount: 100,
    mftAmount: 100,
    delay: 5000,
  };

  const tierIdx = args.indexOf("--tier");
  if (tierIdx !== -1 && args[tierIdx + 1]) opts.tier = args[tierIdx + 1];

  const countIdx = args.indexOf("--count");
  if (countIdx !== -1 && args[countIdx + 1]) opts.count = Number(args[countIdx + 1]);

  const bpIdx = args.indexOf("--bp-amount");
  if (bpIdx !== -1 && args[bpIdx + 1]) opts.bpAmount = Math.min(Number(args[bpIdx + 1]), MAX_PER_TARGET);

  const mycoIdx = args.indexOf("--myco-amount");
  if (mycoIdx !== -1 && args[mycoIdx + 1]) opts.mycoAmount = Math.min(Number(args[mycoIdx + 1]), MAX_PER_TARGET);

  const mftIdx = args.indexOf("--mft-amount");
  if (mftIdx !== -1 && args[mftIdx + 1]) opts.mftAmount = Math.min(Number(args[mftIdx + 1]), MAX_PER_TARGET);

  const delayIdx = args.indexOf("--delay");
  if (delayIdx !== -1 && args[delayIdx + 1]) opts.delay = Number(args[delayIdx + 1]);

  return opts;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Commands ---

async function showStatus() {
  const log = loadDropLog();
  const targets = loadTargets();
  const allWallets = Object.values(targets.wallets);
  const holderScan = allWallets.filter(w => w.source === "holder-scan");
  const contacted = holderScan.filter(w => w.contacted).length;

  console.log("\n=== Multi-Token Drop Status ===\n");
  console.log(`Holder-scan targets: ${holderScan.length}`);
  console.log(`Contacted: ${contacted}`);
  console.log(`Remaining: ${holderScan.length - contacted}`);
  console.log(`Total drop runs: ${log.totalTargets}`);
  console.log(`Tokens sent: BP=${log.totalTokensSent.BP}, Myco=${log.totalTokensSent.Myco}, MfT=${log.totalTokensSent.MfT}`);
  console.log(`Notes sent: ${log.totalNotes}`);

  if (log.drops.length > 0) {
    console.log("\nRecent drops:");
    for (const d of log.drops.slice(-10)) {
      console.log(`  ${d.target.slice(0, 14)}.. BP:${d.amounts.BP} Myco:${d.amounts.Myco} MfT:${d.amounts.MfT} [${d.tier}] ${d.timestamp}`);
    }
  }
}

async function main() {
  const opts = parseArgs();

  if (opts.status) {
    await showStatus();
    return;
  }

  if (!opts.dryRun && !opts.send) {
    console.log("Usage: node multi-drop.js --dry-run | --send | --status");
    console.log("");
    console.log("  --dry-run            Preview targets (DEFAULT, no tx)");
    console.log("  --send               Send tokens (requires confirmation)");
    console.log("  --count 10           Max targets per run (default: 10)");
    console.log("  --tier hot           Filter by tier (default: hot)");
    console.log("  --bp-amount 100      BP per target (default: 100)");
    console.log("  --myco-amount 100    Myco per target (default: 100)");
    console.log("  --mft-amount 100     MfT per target (default: 100)");
    console.log("  --delay 5000         Ms between targets (default: 5000)");
    console.log("  --status             Show drop history");
    return;
  }

  const targets = loadTargets();
  const dropLog = loadDropLog();

  // Filter: uncontacted, tier match, source=holder-scan, not excluded, sorted by score desc
  let candidates = Object.values(targets.wallets)
    .filter(w => !w.contacted)
    .filter(w => w.tier === opts.tier)
    .filter(w => w.source === "holder-scan")
    .filter(w => !EXCLUDE.has(w.address.toLowerCase()))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.count);

  if (candidates.length === 0) {
    console.log(`No uncontacted ${opts.tier} holder-scan targets. Run holder-scan.js to find more.`);
    return;
  }

  const totalBP = opts.bpAmount * candidates.length;
  const totalMyco = opts.mycoAmount * candidates.length;
  const totalMfT = opts.mftAmount * candidates.length;

  console.log(`\n=== Multi-Token Airdrop — Phase 1 ===\n`);
  console.log(`Mode: ${opts.dryRun ? "DRY RUN (no tx)" : "LIVE SEND"}`);
  console.log(`Tier: ${opts.tier}`);
  console.log(`Targets: ${candidates.length}`);
  console.log(`Per target: ${opts.bpAmount} BP + ${opts.mycoAmount} Myco + ${opts.mftAmount} MfT + on-chain note`);
  console.log(`Totals needed: ${totalBP} BP, ${totalMyco} Myco, ${totalMfT} MfT`);
  console.log(`Delay between targets: ${opts.delay / 1000}s`);
  console.log(`Note size: ${Buffer.byteLength(NOTE, "utf8")} bytes\n`);

  console.log("Target list:");
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    console.log(`  ${i + 1}. [${c.tier}] ${c.address.slice(0, 14)}.. score:${c.score} txs:${c.txCount} (${c.signals.join(", ")})`);
  }

  if (opts.dryRun) {
    console.log("\n[DRY RUN] No transactions sent.");
    console.log(`Would send ${candidates.length * 3} token transfers + ${candidates.length} on-chain notes.`);
    console.log(`Estimated gas: ~${candidates.length * 4} transactions.`);
    return;
  }

  // --- Live send mode ---
  const pk = getPrivateKey();
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(pk, provider);

  const bpContract = new ethers.Contract(TOKENS.BP.address, ERC20_ABI, wallet);
  const mycoContract = new ethers.Contract(TOKENS.Myco.address, ERC20_ABI, wallet);
  const mftContract = new ethers.Contract(TOKENS.MfT.address, ERC20_ABI, wallet);

  // Check balances
  const [bpBal, mycoBal, mftBal, ethBal] = await Promise.all([
    bpContract.balanceOf(wallet.address),
    mycoContract.balanceOf(wallet.address),
    mftContract.balanceOf(wallet.address),
    provider.getBalance(wallet.address),
  ]);

  const bpNum = Number(ethers.formatEther(bpBal));
  const mycoNum = Number(ethers.formatEther(mycoBal));
  const mftNum = Number(ethers.formatEther(mftBal));
  const ethNum = Number(ethers.formatEther(ethBal));

  console.log(`\nSender: ${wallet.address}`);
  console.log(`Balances: ${bpNum.toFixed(2)} BP, ${mycoNum.toFixed(2)} Myco, ${mftNum.toFixed(2)} MfT, ${ethNum.toFixed(6)} ETH`);
  console.log(`Needed:   ${totalBP} BP, ${totalMyco} Myco, ${totalMfT} MfT`);

  // Check each token balance
  const maxByBP = opts.bpAmount > 0 ? Math.floor(bpNum / opts.bpAmount) : Infinity;
  const maxByMyco = opts.mycoAmount > 0 ? Math.floor(mycoNum / opts.mycoAmount) : Infinity;
  const maxByMfT = opts.mftAmount > 0 ? Math.floor(mftNum / opts.mftAmount) : Infinity;
  const maxAffordable = Math.min(maxByBP, maxByMyco, maxByMfT, candidates.length);

  if (maxAffordable < 1) {
    console.error("\nInsufficient token balance for even 1 drop. Fund the wallet first.");
    if (bpNum < opts.bpAmount) console.error(`  BP: have ${bpNum.toFixed(2)}, need ${opts.bpAmount}`);
    if (mycoNum < opts.mycoAmount) console.error(`  Myco: have ${mycoNum.toFixed(2)}, need ${opts.mycoAmount}`);
    if (mftNum < opts.mftAmount) console.error(`  MfT: have ${mftNum.toFixed(2)}, need ${opts.mftAmount}`);
    process.exit(1);
  }

  if (maxAffordable < candidates.length) {
    console.log(`\nInsufficient balance for all ${candidates.length} targets. Reducing to ${maxAffordable}.`);
    candidates = candidates.slice(0, maxAffordable);
  }

  if (ethNum < 0.001) {
    console.error(`\nLow ETH for gas (${ethNum.toFixed(6)} ETH). Need at least 0.001 ETH for ${candidates.length} targets x 4 txs.`);
    process.exit(1);
  }

  console.log(`\nSending to ${candidates.length} targets (${candidates.length * 4} transactions)...`);
  console.log("(Ctrl+C to abort)\n");

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const target = candidates[i];
    const addr = target.address;
    const label = `${addr.slice(0, 14)}.. [${target.tier}, score:${target.score}]`;

    console.log(`  [${i + 1}/${candidates.length}] Sending to ${label}`);

    try {
      const txHashes = { BP: null, Myco: null, MfT: null, note: null };

      // 1. Send BP
      if (opts.bpAmount > 0) {
        const amt = ethers.parseEther(String(opts.bpAmount));
        const tx = await bpContract.transfer(addr, amt);
        txHashes.BP = tx.hash;
        console.log(`    BP tx:   ${tx.hash}`);
        await tx.wait();
      }

      // 2. Send Myco
      if (opts.mycoAmount > 0) {
        const amt = ethers.parseEther(String(opts.mycoAmount));
        const tx = await mycoContract.transfer(addr, amt);
        txHashes.Myco = tx.hash;
        console.log(`    Myco tx: ${tx.hash}`);
        await tx.wait();
      }

      // 3. Send MfT
      if (opts.mftAmount > 0) {
        const amt = ethers.parseEther(String(opts.mftAmount));
        const tx = await mftContract.transfer(addr, amt);
        txHashes.MfT = tx.hash;
        console.log(`    MfT tx:  ${tx.hash}`);
        await tx.wait();
      }

      // 4. Send on-chain note (1 wei ETH with UTF-8 calldata)
      try {
        const noteTx = await wallet.sendTransaction({
          to: addr,
          value: 1n, // 1 wei
          data: ethers.toUtf8Bytes(NOTE),
        });
        txHashes.note = noteTx.hash;
        console.log(`    Note tx: ${noteTx.hash}`);
        await noteTx.wait();
      } catch (noteErr) {
        console.log(`    Note skipped: ${noteErr.message?.slice(0, 60)}`);
      }

      console.log(`    Confirmed.`);

      // Mark as contacted in agent-targets.json
      targets.wallets[addr].contacted = true;
      targets.wallets[addr].contactedAt = new Date().toISOString();
      targets.wallets[addr].contactMethod = "multi-drop";
      saveTargets(targets);

      // Log the drop
      const dropEntry = {
        target: addr,
        tier: target.tier,
        score: target.score,
        amounts: {
          BP: opts.bpAmount,
          Myco: opts.mycoAmount,
          MfT: opts.mftAmount,
        },
        txHashes,
        timestamp: new Date().toISOString(),
      };
      dropLog.drops.push(dropEntry);
      dropLog.totalTargets++;
      dropLog.totalTokensSent.BP += opts.bpAmount;
      dropLog.totalTokensSent.Myco += opts.mycoAmount;
      dropLog.totalTokensSent.MfT += opts.mftAmount;
      if (txHashes.note) dropLog.totalNotes++;
      saveDropLog(dropLog);

      sent++;

      // 5-second delay between targets (batch-through-gates rule)
      if (i < candidates.length - 1) {
        await sleep(opts.delay);
      }
    } catch (err) {
      console.error(`    FAILED: ${err.message?.slice(0, 100)}`);
      failed++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Sent: ${sent}, Failed: ${failed}`);
  console.log(`Tokens: ${sent * opts.bpAmount} BP, ${sent * opts.mycoAmount} Myco, ${sent * opts.mftAmount} MfT`);
  console.log(`Notes: ${dropLog.totalNotes} total on-chain`);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
