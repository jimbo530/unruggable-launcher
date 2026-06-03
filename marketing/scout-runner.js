/**
 * scout-runner.js — Automated scout + drop loop
 *
 * Scans Base for new agent wallets, then sends MfT business cards
 * with on-chain notes to hot/warm targets. Runs every 30 minutes.
 *
 * Usage:
 *   node scout-runner.js              — run once (scout + drop)
 *   node scout-runner.js --loop       — continuous every 30min
 *   node scout-runner.js --interval 15 — custom interval in minutes
 *
 * Safety:
 *   - Never hits the same wallet twice (checked in agent-targets.json)
 *   - Stops if ETH < 0.0003 (not enough for gas)
 *   - Stops if MfT < 100 (can't send even 1 drop)
 *   - Max 50 drops per cycle to avoid gas drain
 *   - 5s delay between sends
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
if (!process.env.AGENT_PRIVATE_KEY) {
  require("dotenv").config({ path: "C:/Users/bigji/Documents/Baselings/api/.env" });
}

const { ethers } = require("ethers");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RPC = "https://mainnet.base.org";
const MFT = "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3";
const TARGETS_FILE = path.join(__dirname, "agent-targets.json");
const DROP_LOG = path.join(__dirname, "drop-log.json");
const RUN_LOG = path.join(__dirname, "scout-runs.log");

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

const NOTE = [
  "MfT|0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3|BASE",
  "POOP|0x126555aecBAC290b25644e4b7f29c016aE95f4dc|BASE",
  "Reactor network 2hr cycles execute()=0x61461954 permissionless",
  "Baselings: on-chain pets earning yield 24/7|Gardens: POOP->LP locked forever",
  "Factory:0x5c11 FREE launch->2 locked pools+reactor+burn",
  "5 renounced immutable reactors|400+ holders|Docs: tasern.quest/llms.txt",
].join("\\n");
const DROP_AMOUNT = 100;
const MAX_PER_CYCLE = 50;
const MIN_ETH = 0.0003;
const SEND_DELAY = 5000;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(RUN_LOG, line + "\n");
}

function loadTargets() {
  if (fs.existsSync(TARGETS_FILE)) {
    return JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
  }
  return { wallets: {}, lastBlock: 0 };
}

function saveTargets(targets) {
  targets.scannedAt = new Date().toISOString();
  fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2));
}

function loadDropLog() {
  if (fs.existsSync(DROP_LOG)) {
    return JSON.parse(fs.readFileSync(DROP_LOG, "utf8"));
  }
  return { drops: [], totalSent: 0, totalMfT: 0 };
}

function saveDropLog(dl) {
  fs.writeFileSync(DROP_LOG, JSON.stringify(dl, null, 2));
}

async function runScout() {
  log("Running agent scout...");
  try {
    const output = execSync("node agent-scout.js", {
      cwd: __dirname,
      timeout: 120000,
      encoding: "utf8",
    });
    // Extract key stats from output
    const newMatch = output.match(/(\d+) new agents/);
    const totalMatch = output.match(/(\d+) total\)/);
    const newCount = newMatch ? newMatch[1] : "?";
    const totalCount = totalMatch ? totalMatch[1] : "?";
    log(`Scout found ${newCount} new agents (${totalCount} total)`);
    return parseInt(newCount) || 0;
  } catch (err) {
    log(`Scout error: ${err.message?.slice(0, 100)}`);
    return 0;
  }
}

async function runDrops() {
  const targets = loadTargets();
  const dropLog = loadDropLog();

  // Get uncontacted hot+warm targets
  // Exclude contracts, routers, burn addresses — sync with holder-scan.js
  const EXCLUDE = new Set([
    "0xe2a4a8b9d77080c57799a94ba8edeb2dd6e0ac10", "0x0780b1456d5e60cf26c8cd6541b85e805c8c05f2",
    "0x8f079761078bdf2c8143b431857046586fc26f3a", "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad",
    "0x2626664c2603336e57b271c5c0b26f421741e481", "0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5",
    "0x03a520b32c04bf3beef7beb72e919cf822ed34f1", "0xed3ae91b2bb22307c07438eeeba2500c18eabcfe",
    "0xfdb309f2a7055e2dd8221f9eb27655f11d2d43be", "0x513d2eb33f1a7ec3798cc221ab4b4ce2a3fafb98",
    "0x20a14d6a1ab57851a58d4a85c0fc06f23a7aea42", "0xd8af1b75c81ec5fc66d0f3f75c6d86fccf379281",
    "0xc2edd32dc7b3f07ccaf9b8df72d011c66c78f95f", "0xfd780b0ae569e15e514b819ecfdf46f804953a4b",
    "0xc28e64551816535d9ef06ce95844f2b5317353ba", "0x84fb78ac1e60d33de602caf004eb5626cd2420be",
    "0xe693dd02bb1ba0850a1a153a03b99531004096b1", "0x2e06eb264db2c7bcd8b9a216827b7d0ef3beaca2",
    "0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead",
  ]);
  const candidates = Object.values(targets.wallets)
    .filter(w => !w.contacted && !EXCLUDE.has(w.address.toLowerCase()) && (w.tier === "hot" || w.tier === "warm"))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PER_CYCLE);

  if (candidates.length === 0) {
    log("No new targets to drop.");
    return 0;
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const mft = new ethers.Contract(MFT, ERC20_ABI, wallet);

  // Check balances
  const [mftBal, ethBal] = await Promise.all([
    mft.balanceOf(wallet.address),
    provider.getBalance(wallet.address),
  ]);
  const mftNum = Number(ethers.formatEther(mftBal));
  const ethNum = Number(ethers.formatEther(ethBal));

  log(`Wallet: ${wallet.address} | MfT: ${mftNum.toFixed(0)} | ETH: ${ethNum.toFixed(6)}`);

  if (ethNum < MIN_ETH) {
    log(`ETH too low (${ethNum.toFixed(6)}). Need ${MIN_ETH}. Pausing drops until funded.`);
    return 0;
  }
  if (mftNum < DROP_AMOUNT) {
    log(`MfT too low (${mftNum.toFixed(0)}). Need ${DROP_AMOUNT}. Pausing drops.`);
    return 0;
  }

  // Limit to what we can afford
  const canAfford = Math.min(candidates.length, Math.floor(mftNum / DROP_AMOUNT));
  const toSend = candidates.slice(0, canAfford);

  log(`Dropping ${DROP_AMOUNT} MfT + note to ${toSend.length} targets...`);

  let sent = 0;
  const amountWei = ethers.parseEther(String(DROP_AMOUNT));

  for (const target of toSend) {
    // Re-check ETH each time (gas adds up)
    const currentEth = Number(ethers.formatEther(await provider.getBalance(wallet.address)));
    if (currentEth < MIN_ETH) {
      log(`ETH dropped below ${MIN_ETH}. Stopping drops.`);
      break;
    }

    try {
      // 1. Send MfT
      const tx = await mft.transfer(target.address, amountWei);
      await tx.wait();

      // 2. Send note as tiny ETH tx with UTF-8 data
      let noteTxHash = null;
      try {
        const noteTx = await wallet.sendTransaction({
          to: target.address,
          value: 1n,
          data: ethers.toUtf8Bytes(NOTE),
        });
        noteTxHash = noteTx.hash;
        await noteTx.wait();
      } catch (noteErr) {
        log(`  Note skipped for ${target.address.slice(0, 12)}..`);
      }

      // Mark contacted
      targets.wallets[target.address].contacted = true;
      targets.wallets[target.address].contactedAt = new Date().toISOString();
      targets.wallets[target.address].contactMethod = "mft-drop";
      saveTargets(targets);

      dropLog.drops.push({
        address: target.address,
        amount: DROP_AMOUNT,
        tier: target.tier,
        score: target.score,
        txHash: tx.hash,
        noteTxHash,
        timestamp: new Date().toISOString(),
      });
      dropLog.totalSent++;
      dropLog.totalMfT += DROP_AMOUNT;
      saveDropLog(dropLog);

      sent++;
      log(`  [${sent}/${toSend.length}] ${target.address.slice(0, 14)}.. [${target.tier}] score:${target.score} OK`);

      // Delay between sends
      if (toSend.indexOf(target) < toSend.length - 1) {
        await new Promise(r => setTimeout(r, SEND_DELAY));
      }
    } catch (err) {
      log(`  FAILED ${target.address.slice(0, 14)}.. : ${err.message?.slice(0, 80)}`);
    }
  }

  log(`Drops complete: ${sent}/${toSend.length} sent, ${sent * DROP_AMOUNT} MfT total`);
  return sent;
}

async function cycle() {
  log("=== Scout + Drop Cycle ===");
  const newAgents = await runScout();
  const dropped = await runDrops();
  log(`Cycle done. New agents: ${newAgents}, Drops: ${dropped}`);
  return { newAgents, dropped };
}

async function main() {
  const args = process.argv.slice(2);
  const loop = args.includes("--loop");

  let intervalMin = 30;
  const intIdx = args.indexOf("--interval");
  if (intIdx !== -1 && args[intIdx + 1]) intervalMin = Number(args[intIdx + 1]);

  if (!process.env.AGENT_PRIVATE_KEY) {
    console.error("AGENT_PRIVATE_KEY not found. Set in .env or Baselings/api/.env");
    process.exit(1);
  }

  log(`MfT Scout Runner starting (interval: ${intervalMin}min, loop: ${loop})`);

  await cycle();

  if (loop) {
    log(`Next scan in ${intervalMin} minutes...`);
    setInterval(async () => {
      try {
        await cycle();
        log(`Next scan in ${intervalMin} minutes...`);
      } catch (err) {
        log(`Cycle error: ${err.message?.slice(0, 100)}`);
      }
    }, intervalMin * 60 * 1000);
  }
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
