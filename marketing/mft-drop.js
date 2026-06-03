/**
 * mft-drop.js — Send tiny MfT "business cards" to agent wallets
 *
 * Sends small MfT amounts to hot/warm agent wallets found by agent-scout.
 * Agent portfolio scanners discover the token, find the API/llms.txt.
 *
 * Usage:
 *   node mft-drop.js --dry-run       — preview who would get drops (no tx)
 *   node mft-drop.js --send          — actually send drops (requires confirmation)
 *   node mft-drop.js --send --tier hot — only hot targets
 *   node mft-drop.js --amount 50     — send 50 MfT per target (default: 100)
 *   node mft-drop.js --max 10        — max 10 drops per run (default: 20)
 *   node mft-drop.js --status        — show drop history
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
// Also try Baselings .env for AGENT_PRIVATE_KEY
if (!process.env.AGENT_PRIVATE_KEY) {
  require("dotenv").config({ path: "C:/Users/bigji/Documents/Baselings/api/.env" });
}

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = "https://mainnet.base.org";
const MFT = "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3";
const TARGETS_FILE = path.join(__dirname, "agent-targets.json");
const DROP_LOG = path.join(__dirname, "drop-log.json");

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

// On-chain note sent as tiny ETH tx with UTF-8 data
// Agent-optimized: structured data, actionable info, no fluff
const NOTE = [
  "MfT|0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3|BASE",
  "POOP|0x126555aecBAC290b25644e4b7f29c016aE95f4dc|BASE",
  "Reactor network 2hr cycles execute()=0x61461954 permissionless",
  "Arb: predictable 2hr post-firing windows across all pools",
  "Baselings: on-chain pet game—13 workers earning yield 24/7",
  "POOP/USDC:0xd92A713A1BA56bA2b0c90bFaac8Cae918Fa9e281 3% MEV cap/cycle",
  "Gardens sell POOP→food LP locked forever $0.39/day compounding",
  "Power plants burn POOP+memes earn ETH/USDC blue chips",
  "Factory:0x5c11 FREE launch→2 locked pools+reactor+burn",
  "V1 Prime:0xed3aE91b2bb22307c07438EEebA2500C18EABcFE|5 renounced immutable reactors",
  "MCP: npx baselings-mcp 49 tools|REST: tasern.quest/api/unrugable/tokenomics",
  "Docs: tasern.quest/llms.txt|400+ holders organic growth",
].join("\n");

// Exclude contracts, routers, burn addresses — sync with holder-scan.js/multi-drop.js
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
  "0xe693dd02bb1ba0850a1a153a03b99531004096b1", // KeeperBatch V4
  "0x2e06eb264db2c7bcd8b9a216827b7d0ef3beaca2", // EB v5 reactor
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

function loadTargets() {
  if (!fs.existsSync(TARGETS_FILE)) {
    console.error("No agent-targets.json found. Run agent-scout.js first.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
}

function loadDropLog() {
  if (fs.existsSync(DROP_LOG)) {
    return JSON.parse(fs.readFileSync(DROP_LOG, "utf8"));
  }
  return { drops: [], totalSent: 0, totalMfT: 0 };
}

function saveDropLog(log) {
  fs.writeFileSync(DROP_LOG, JSON.stringify(log, null, 2));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: args.includes("--dry-run"),
    send: args.includes("--send"),
    status: args.includes("--status"),
    tier: null,
    amount: 100,
    max: 20,
    delay: 5000, // 5s between sends (not rapid-fire)
  };

  const tierIdx = args.indexOf("--tier");
  if (tierIdx !== -1 && args[tierIdx + 1]) opts.tier = args[tierIdx + 1];

  const amtIdx = args.indexOf("--amount");
  if (amtIdx !== -1 && args[amtIdx + 1]) opts.amount = Number(args[amtIdx + 1]);

  const maxIdx = args.indexOf("--max");
  if (maxIdx !== -1 && args[maxIdx + 1]) opts.max = Number(args[maxIdx + 1]);

  const delayIdx = args.indexOf("--delay");
  if (delayIdx !== -1 && args[delayIdx + 1]) opts.delay = Number(args[delayIdx + 1]);

  return opts;
}

async function showStatus() {
  const log = loadDropLog();
  const targets = loadTargets();
  const contacted = Object.values(targets.wallets).filter(w => w.contacted).length;
  const total = Object.keys(targets.wallets).length;

  console.log("\n=== MfT Drop Status ===\n");
  console.log(`Total targets: ${total}`);
  console.log(`Contacted: ${contacted} (${((contacted / total) * 100).toFixed(1)}%)`);
  console.log(`Total drops sent: ${log.totalSent}`);
  console.log(`Total MfT sent: ${log.totalMfT}`);

  if (log.drops.length > 0) {
    console.log("\nRecent drops:");
    for (const d of log.drops.slice(-10)) {
      console.log(`  ${d.address.slice(0, 12)}.. ${d.amount} MfT [${d.tier}] ${d.timestamp}`);
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
    console.log("Usage: node mft-drop.js --dry-run | --send | --status");
    console.log("  --tier hot|warm    Filter by tier");
    console.log("  --amount 100       MfT per drop (default: 100)");
    console.log("  --max 20           Max drops per run (default: 20)");
    console.log("  --delay 5000       Ms between sends (default: 5000)");
    console.log("\nUsed by scout-runner.js for automated scout+drop loops.");
    return;
  }

  const targets = loadTargets();
  const dropLog = loadDropLog();

  // Get uncontacted targets, sorted by score descending
  let candidates = Object.values(targets.wallets)
    .filter(w => !w.contacted)
    .filter(w => !EXCLUDE.has(w.address.toLowerCase()))
    .filter(w => opts.tier ? w.tier === opts.tier : (w.tier === "hot" || w.tier === "warm"))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.max);

  if (candidates.length === 0) {
    console.log("No uncontacted targets matching criteria. Run agent-scout.js to find more.");
    return;
  }

  console.log(`\n=== MfT Business Card Drop ===\n`);
  console.log(`Mode: ${opts.dryRun ? "DRY RUN (no tx)" : "LIVE SEND"}`);
  console.log(`Amount: ${opts.amount} MfT per target`);
  console.log(`Targets: ${candidates.length} wallets`);
  console.log(`Total MfT needed: ${opts.amount * candidates.length}`);
  console.log(`Delay between sends: ${opts.delay / 1000}s\n`);

  console.log("Target list:");
  for (const c of candidates) {
    console.log(`  [${c.tier}] ${c.address.slice(0, 14)}.. score:${c.score} txs:${c.txCount} (${c.signals.join(", ")})`);
  }

  if (opts.dryRun) {
    console.log("\n[DRY RUN] No transactions sent.");
    return;
  }

  // Live send mode
  if (!process.env.AGENT_PRIVATE_KEY) {
    console.error("\nERROR: AGENT_PRIVATE_KEY not found in .env");
    console.error("Set it in marketing/.env or Baselings/api/.env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const mft = new ethers.Contract(MFT, ERC20_ABI, wallet);

  // Check balance
  const balance = await mft.balanceOf(wallet.address);
  const balanceNum = Number(ethers.formatEther(balance));
  const needed = opts.amount * candidates.length;

  console.log(`\nSender: ${wallet.address}`);
  console.log(`MfT balance: ${balanceNum.toFixed(2)}`);
  console.log(`MfT needed: ${needed}`);

  if (balanceNum < needed) {
    console.error(`\nInsufficient MfT balance. Have ${balanceNum.toFixed(2)}, need ${needed}.`);
    if (balanceNum < opts.amount) {
      console.error("Not enough for even 1 drop. Fund the wallet first.");
      process.exit(1);
    }
    // Reduce to what we can afford
    const canAfford = Math.floor(balanceNum / opts.amount);
    candidates = candidates.slice(0, canAfford);
    console.log(`Reduced to ${candidates.length} drops (what balance allows).`);
  }

  // Check ETH for gas
  const ethBal = await provider.getBalance(wallet.address);
  const ethNum = Number(ethers.formatEther(ethBal));
  console.log(`ETH balance: ${ethNum.toFixed(6)} ETH`);
  if (ethNum < 0.0005) {
    console.error("Low ETH for gas. Need at least 0.0005 ETH.");
    process.exit(1);
  }

  console.log(`\nSending ${candidates.length} drops of ${opts.amount} MfT each...`);
  console.log("(Ctrl+C to abort)\n");

  let sent = 0;
  let failed = 0;
  const amountWei = ethers.parseEther(String(opts.amount));

  for (const target of candidates) {
    try {
      console.log(`  Sending ${opts.amount} MfT + note to ${target.address.slice(0, 14)}.. [${target.tier}, score:${target.score}]`);

      // 1. Send MfT tokens
      const tx = await mft.transfer(target.address, amountWei);
      console.log(`    mft tx: ${tx.hash}`);
      await tx.wait();

      // 2. Send tiny ETH tx with on-chain note in data field
      let noteTxHash = null;
      try {
        const noteTx = await wallet.sendTransaction({
          to: target.address,
          value: 1n, // 1 wei
          data: ethers.toUtf8Bytes(NOTE),
        });
        noteTxHash = noteTx.hash;
        console.log(`    note tx: ${noteTx.hash}`);
        await noteTx.wait();
      } catch (noteErr) {
        console.log(`    note skipped: ${noteErr.message?.slice(0, 60)}`);
      }
      console.log(`    confirmed`);

      // Mark as contacted
      targets.wallets[target.address].contacted = true;
      targets.wallets[target.address].contactedAt = new Date().toISOString();
      targets.wallets[target.address].contactMethod = "mft-drop";
      saveTargets(targets);

      // Log the drop
      dropLog.drops.push({
        address: target.address,
        amount: opts.amount,
        tier: target.tier,
        score: target.score,
        txHash: tx.hash,
        noteTxHash,
        timestamp: new Date().toISOString(),
      });
      dropLog.totalSent++;
      dropLog.totalMfT += opts.amount;
      saveDropLog(dropLog);

      sent++;

      // Delay between sends (not rapid-fire)
      if (candidates.indexOf(target) < candidates.length - 1) {
        await new Promise(r => setTimeout(r, opts.delay));
      }
    } catch (err) {
      console.error(`    FAILED: ${err.message?.slice(0, 80)}`);
      failed++;
    }
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}, Total MfT: ${sent * opts.amount}`);
}

function saveTargets(targets) {
  targets.scannedAt = new Date().toISOString();
  fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2));
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
