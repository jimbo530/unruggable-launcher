/**
 * agent-scout.js — Detects AI agent wallets on Base
 *
 * Agent wallets have distinctive patterns:
 * - Programmatic tx timing (exact intervals, no human jitter)
 * - Multi-hop swaps through routers (not simple transfers)
 * - Interactions with known agent platforms (Virtuals, Clanker, pump-style)
 * - Contract wallets (Safe, AA) with high swap volume
 * - Token launches via factory contracts
 * - Repeated interactions with the same pools
 *
 * Three detection strategies:
 * 1. Swap pattern analysis — find wallets doing 3+ swaps in short windows
 * 2. Factory watchers — find wallets deploying tokens on launch platforms
 * 3. Known agent contract interactions — Virtuals, Clanker, etc.
 *
 * Builds a scored target list for outreach.
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = "https://mainnet.base.org";
const TARGETS_FILE = path.join(__dirname, "agent-targets.json");

// Known agent-adjacent contracts on Base
const KNOWN_CONTRACTS = {
  // DEX routers — agents route through these
  uniV3Router:    "0x2626664c2603336e57b271c5c0b26f421741e481",
  uniUniversal:   "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad",
  aeroRouter:     "0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5",
  // Agent platforms
  virtuals:       "0x44ff8620b8ca30902395a7bd3f2407e1a091bf73",
  clanker:        "0x18e9e3783297049ef460e9463f6fb73d70948eda", // Clanker token deployer
  // Our factories (agents launching through us = highest priority)
  ourV4:          "0x51ef41e0730c0e607950421e1ee113b089867d3e",
  ourV42:         "0xb74fe5fa2d030706b4a0c901fdc42c5244695a6e",
  ourV5:          "0x2e0b20a4ffeacacb8d3cd0cf6b9bbe6660c4262e",
};

// Wallets to never target
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
  "0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51", // V5.2 Factory (active)
  "0x013a1091108D50eF5F9cC3FDa38f9b2BA4D3F81d", // UnrugableAdoption
  "0xfd780b0ae569e15e514b819ecfdf46f804953a4b", // burn address
  "0xc28e64551816535d9ef06ce95844f2b5317353ba", // EB relay reactor
  "0x84fb78ac1e60d33de602caf004eb5626cd2420be", // BB relay reactor
  "0xe693dd02bb1ba0850a1a153a03b99531004096b1", // KeeperBatch V4
  "0x2e06eb264db2c7bcd8b9a216827b7d0ef3beaca2", // EB v5 reactor
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

function loadTargets() {
  if (fs.existsSync(TARGETS_FILE)) {
    return JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
  }
  return { wallets: {}, lastBlock: 0, scannedAt: null, stats: { totalScanned: 0, totalFound: 0 } };
}

function saveTargets(targets) {
  targets.scannedAt = new Date().toISOString();
  fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2));
}

/**
 * Strategy 1: Swap pattern analysis
 * Find wallets making multiple swaps in a short time window
 */
async function scanSwapPatterns(provider, startBlock, endBlock) {
  const swapTopic = ethers.id("Swap(address,address,int256,int256,uint160,uint128,int24)");
  const txSenders = {}; // txHash -> blockNumber

  for (let from = startBlock; from <= endBlock; from += 500) {
    const to = Math.min(from + 499, endBlock);
    try {
      const logs = await provider.getLogs({ fromBlock: from, toBlock: to, topics: [swapTopic] });
      for (const log of logs) {
        if (!txSenders[log.transactionHash]) {
          txSenders[log.transactionHash] = log.blockNumber;
        }
      }
    } catch (e) {
      // Too many results — try smaller chunks
      console.warn('[scout] chunk too large, splitting:', e.message || e);
      for (let f2 = from; f2 <= to; f2 += 100) {
        const t2 = Math.min(f2 + 99, to);
        try {
          const logs = await provider.getLogs({ fromBlock: f2, toBlock: t2, topics: [swapTopic] });
          for (const log of logs) {
            if (!txSenders[log.transactionHash]) txSenders[log.transactionHash] = log.blockNumber;
          }
        } catch (e2) { console.warn('[scout] sub-chunk failed:', f2, '-', t2, e2.message || e2); }
      }
    }
  }

  // Resolve tx senders — sample up to 300 txs
  const hashes = Object.keys(txSenders).slice(0, 300);
  const walletActivity = {};

  for (const hash of hashes) {
    try {
      const tx = await provider.getTransaction(hash);
      if (!tx || !tx.from) continue;
      const sender = tx.from.toLowerCase();
      if (EXCLUDE.has(sender)) continue;

      if (!walletActivity[sender]) {
        walletActivity[sender] = { swapCount: 0, blocks: [], targets: new Set() };
      }
      walletActivity[sender].swapCount++;
      walletActivity[sender].blocks.push(tx.blockNumber);
      if (tx.to) walletActivity[sender].targets.add(tx.to.toLowerCase());
    } catch (e) { console.warn('[scout] tx resolve:', hash?.slice(0, 10), e.message || e); }
  }

  return walletActivity;
}

/**
 * Strategy 2: Factory interaction scanner
 * Find wallets that deployed tokens through known launchpads
 */
async function scanFactoryUsers(provider, startBlock, endBlock) {
  const launchers = {};

  // Look for contract creation txs (to = null) and factory interactions
  // Check Transfer events from factory contracts (token creation)
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const zeroAddr = ethers.zeroPadValue("0x00", 32);

  for (const [name, addr] of Object.entries(KNOWN_CONTRACTS)) {
    if (!name.startsWith("our") && name !== "clanker" && name !== "virtuals") continue;

    try {
      const logs = await provider.getLogs({
        fromBlock: startBlock, toBlock: endBlock,
        address: addr,
      });

      for (const log of logs) {
        try {
          const tx = await provider.getTransaction(log.transactionHash);
          if (!tx || !tx.from) continue;
          const sender = tx.from.toLowerCase();
          if (EXCLUDE.has(sender)) continue;

          if (!launchers[sender]) {
            launchers[sender] = { deployCount: 0, platforms: new Set() };
          }
          launchers[sender].deployCount++;
          launchers[sender].platforms.add(name);
        } catch (e) { console.warn('[scout] factory tx resolve:', e.message || e); }
      }
    } catch (e) { console.warn('[scout] factory scan:', name, e.message || e); }
  }

  return launchers;
}

/**
 * Strategy 3: Timing analysis
 * Agents transact at regular intervals — detect programmatic timing
 */
function analyzeTimingRegularity(blocks) {
  if (blocks.length < 3) return 0;

  blocks.sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < blocks.length; i++) {
    gaps.push(blocks[i] - blocks[i - 1]);
  }

  if (gaps.length < 2) return 0;

  // Calculate coefficient of variation (low = regular = likely agent)
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (mean === 0) return 0;
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / mean;

  // CV < 0.3 = very regular (strong agent signal)
  // CV < 0.6 = somewhat regular
  // CV > 1.0 = random (human-like)
  if (cv < 0.3) return 15;
  if (cv < 0.6) return 8;
  if (cv < 0.8) return 3;
  return 0;
}

/**
 * Score a wallet based on all signals
 */
async function scoreWallet(provider, addr, swapData, launchData) {
  let score = 0;
  const signals = [];

  // Swap volume
  if (swapData) {
    if (swapData.swapCount >= 10) { score += 20; signals.push("high-freq-swapper"); }
    else if (swapData.swapCount >= 5) { score += 12; signals.push("active-swapper"); }
    else if (swapData.swapCount >= 3) { score += 6; signals.push("swapper"); }

    // Uses multiple routers = sophisticated
    if (swapData.targets.size >= 3) { score += 5; signals.push("multi-router"); }

    // Timing regularity
    const timingScore = analyzeTimingRegularity(swapData.blocks);
    if (timingScore > 0) {
      score += timingScore;
      signals.push(timingScore >= 10 ? "programmatic-timing" : "semi-regular");
    }
  }

  // Token launching
  if (launchData) {
    score += Math.min(launchData.deployCount * 10, 30);
    signals.push("launcher:" + [...launchData.platforms].join(","));
  }

  // Is it a contract wallet? (Smart account / AA = strong agent signal)
  try {
    const code = await provider.getCode(addr);
    if (code.length > 2) {
      score += 10;
      signals.push("contract-wallet");
    }
  } catch (e) { console.warn('[scout] getCode:', addr?.slice(0, 10), e.message || e); }

  // Check wallet age via nonce — new wallets with high activity = likely agent
  try {
    const nonce = await provider.getTransactionCount(addr);
    if (nonce > 100) { score += 5; signals.push("high-nonce:" + nonce); }
    if (nonce > 1000) { score += 10; signals.push("very-high-nonce"); }
  } catch (e) { console.warn('[scout] nonce check:', addr?.slice(0, 10), e.message || e); }

  return { score, signals };
}

/**
 * Main scan — combines all strategies
 */
async function scanForAgents(blocksBack = 1000) {
  const provider = new ethers.JsonRpcProvider(RPC);
  const currentBlock = await provider.getBlockNumber();
  const targets = loadTargets();
  const startBlock = Math.max(targets.lastBlock + 1, currentBlock - blocksBack);

  if (startBlock >= currentBlock) {
    console.log("No new blocks to scan.");
    return targets;
  }

  console.log(`Scanning blocks ${startBlock} to ${currentBlock} (${currentBlock - startBlock} blocks)...`);

  // Run strategies
  console.log("  Strategy 1: Swap patterns...");
  const swapData = await scanSwapPatterns(provider, startBlock, currentBlock);
  console.log(`    Found ${Object.keys(swapData).length} active swap wallets`);

  console.log("  Strategy 2: Factory interactions...");
  const launchData = await scanFactoryUsers(provider, startBlock, currentBlock);
  console.log(`    Found ${Object.keys(launchData).length} launcher wallets`);

  // Merge all candidate wallets
  const allCandidates = new Set([
    ...Object.keys(swapData),
    ...Object.keys(launchData),
  ]);

  console.log(`  Scoring ${allCandidates.size} unique wallets...`);

  let newAgents = 0;
  let updated = 0;

  for (const addr of allCandidates) {
    if (EXCLUDE.has(addr)) continue;

    // Update existing
    if (targets.wallets[addr]) {
      targets.wallets[addr].lastSeen = new Date().toISOString();
      if (swapData[addr]) targets.wallets[addr].txCount += swapData[addr].swapCount;
      updated++;
      continue;
    }

    // Quick pre-score from swap/launch data only (no RPC calls)
    let preScore = 0;
    const signals = [];

    if (swapData[addr]) {
      const sc = swapData[addr].swapCount;
      if (sc >= 10) { preScore += 20; signals.push("high-freq-swapper"); }
      else if (sc >= 5) { preScore += 12; signals.push("active-swapper"); }
      else if (sc >= 3) { preScore += 6; signals.push("swapper"); }

      if (swapData[addr].targets.size >= 3) { preScore += 5; signals.push("multi-router"); }

      const timingScore = analyzeTimingRegularity(swapData[addr].blocks);
      if (timingScore > 0) {
        preScore += timingScore;
        signals.push(timingScore >= 10 ? "programmatic-timing" : "semi-regular");
      }
    }

    if (launchData[addr]) {
      preScore += Math.min(launchData[addr].deployCount * 10, 30);
      signals.push("launcher:" + [...launchData[addr].platforms].join(","));
    }

    // Only do expensive RPC checks (code, nonce) for promising candidates
    let score = preScore;
    if (preScore >= 6) {
      try {
        const code = await provider.getCode(addr);
        if (code.length > 2) { score += 10; signals.push("contract-wallet"); }
      } catch (e) { console.warn('[scout] getCode:', addr?.slice(0, 10), e.message || e); }

      try {
        const nonce = await provider.getTransactionCount(addr);
        if (nonce > 1000) { score += 15; signals.push("very-high-nonce:" + nonce); }
        else if (nonce > 100) { score += 5; signals.push("high-nonce:" + nonce); }
      } catch (e) { console.warn('[scout] nonce check:', addr?.slice(0, 10), e.message || e); }
    }

    if (score >= 6) {
      targets.wallets[addr] = {
        address: addr,
        score,
        signals,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        txCount: swapData[addr]?.swapCount || 0,
        deployCount: launchData[addr]?.deployCount || 0,
        contacted: false,
        platform: null,
        tier: score >= 30 ? "hot" : score >= 15 ? "warm" : "cold",
      };
      newAgents++;
    }
  }

  targets.lastBlock = currentBlock;
  if (!targets.stats) targets.stats = { totalScanned: 0, totalFound: 0 };
  targets.stats.totalScanned += allCandidates.size;
  targets.stats.totalFound += newAgents;
  saveTargets(targets);

  console.log(`\nResults: ${newAgents} new agents, ${updated} updated (${Object.keys(targets.wallets).length} total)`);

  // Print tier breakdown
  const all = Object.values(targets.wallets);
  const hot = all.filter(w => w.tier === "hot").length;
  const warm = all.filter(w => w.tier === "warm").length;
  const cold = all.filter(w => w.tier === "cold" || !w.tier).length;
  console.log(`Tiers: ${hot} hot / ${warm} warm / ${cold} cold`);

  return targets;
}

/**
 * Enrich targets with social profiles
 * Checks if wallets have Farcaster accounts linked
 */
async function enrichTargets(neynarKey) {
  if (!neynarKey) {
    console.log("No Neynar key — skipping enrichment");
    return;
  }

  const targets = loadTargets();
  const unenriched = Object.values(targets.wallets)
    .filter(w => !w.platform && !w.enrichFailed)
    .sort((a, b) => b.score - a.score) // prioritize high-score
    .slice(0, 20);

  if (unenriched.length === 0) {
    console.log("All targets enriched.");
    return targets;
  }

  console.log(`Enriching ${unenriched.length} targets with Farcaster data...`);

  for (const wallet of unenriched) {
    try {
      const res = await fetch(
        `https://api.neynar.com/v2/farcaster/user/by_verification?address=${wallet.address}`,
        { headers: { api_key: neynarKey, accept: "application/json" } }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.result && data.result.user) {
          wallet.platform = "farcaster";
          wallet.fid = data.result.user.fid;
          wallet.username = data.result.user.username;
          wallet.displayName = data.result.user.display_name;
          wallet.followerCount = data.result.user.follower_count;
          wallet.bio = data.result.user.profile?.bio?.text?.slice(0, 200) || "";
          console.log(`  ${wallet.address.slice(0, 10)} -> @${wallet.username} (${wallet.followerCount} followers) "${wallet.bio.slice(0, 50)}"`);

          // Boost score if bio mentions agent/bot/trading/DeFi
          const bioLower = (wallet.bio + " " + wallet.displayName).toLowerCase();
          if (/agent|bot|automat|trading|defi|yield|swap/.test(bioLower)) {
            wallet.score += 15;
            wallet.signals = wallet.signals || [];
            wallet.signals.push("bio-match:" + bioLower.match(/agent|bot|automat|trading|defi|yield|swap/)[0]);
            wallet.tier = wallet.score >= 30 ? "hot" : wallet.score >= 15 ? "warm" : "cold";
          }
        }
      }
      if (!wallet.platform) {
        wallet.enrichFailed = true;
      }
    } catch (e) {
      console.warn('[scout] enrich failed:', wallet.address?.slice(0, 10), e.message || e);
      wallet.enrichFailed = true;
    }

    await new Promise(r => setTimeout(r, 1100));
  }

  saveTargets(targets);
  return targets;
}

/**
 * Get prioritized outreach targets
 */
function getOutreachTargets(limit = 10) {
  const targets = loadTargets();
  return Object.values(targets.wallets)
    .filter(w => !w.contacted && w.score >= 6)
    .sort((a, b) => {
      // Hot tier first, then by platform (farcaster = can reach them), then score
      const tierOrder = { hot: 0, warm: 1, cold: 2 };
      const aTier = tierOrder[a.tier] ?? 2;
      const bTier = tierOrder[b.tier] ?? 2;
      if (aTier !== bTier) return aTier - bTier;
      if (a.platform && !b.platform) return -1;
      if (!a.platform && b.platform) return 1;
      return b.score - a.score;
    })
    .slice(0, limit);
}

function markContacted(address) {
  const targets = loadTargets();
  if (targets.wallets[address]) {
    targets.wallets[address].contacted = true;
    targets.wallets[address].contactedAt = new Date().toISOString();
    saveTargets(targets);
  }
}

function getStats() {
  const targets = loadTargets();
  const all = Object.values(targets.wallets);
  return {
    total: all.length,
    hot: all.filter(w => w.tier === "hot").length,
    warm: all.filter(w => w.tier === "warm").length,
    cold: all.filter(w => w.tier === "cold" || !w.tier).length,
    contacted: all.filter(w => w.contacted).length,
    withFarcaster: all.filter(w => w.platform === "farcaster").length,
    lastScanned: targets.scannedAt,
    lastBlock: targets.lastBlock,
  };
}

/**
 * Continuous scan loop — runs forever, scanning new blocks every INTERVAL
 */
async function runContinuous(intervalMin = 30, blocksPerScan = 500) {
  const ms = intervalMin * 60 * 1000;
  console.log("=== MfT Agent Scout — Continuous Mode ===");
  console.log(`Scanning every ${intervalMin}min, ${blocksPerScan} blocks per scan\n`);

  const run = async () => {
    const ts = new Date().toISOString().slice(0, 19);
    console.log(`\n[${ts}] Starting scan...`);
    try {
      await scanForAgents(blocksPerScan);
      const s = getStats();
      console.log(`[${ts}] Done. ${s.total} total (${s.hot} hot / ${s.warm} warm). Next scan in ${intervalMin}min.`);
    } catch (e) {
      console.error(`[${ts}] Scan error:`, e.message?.slice(0, 100));
    }
  };

  await run();
  setInterval(run, ms);
}

/**
 * Export targets as CSV for easy review
 */
function exportCSV() {
  const targets = loadTargets();
  const rows = ["address,score,tier,txCount,nonce_signal,timing,platform,username,firstSeen"];
  const sorted = Object.values(targets.wallets).sort((a, b) => b.score - a.score);
  for (const w of sorted) {
    const nonceSignal = (w.signals || []).find(s => s.includes("nonce")) || "";
    const timing = (w.signals || []).find(s => s.includes("timing") || s.includes("regular")) || "";
    rows.push([
      w.address, w.score, w.tier || "cold", w.txCount,
      nonceSignal, timing, w.platform || "", w.username || "", w.firstSeen,
    ].join(","));
  }
  return rows.join("\n");
}

// Run standalone
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--loop")) {
    // Continuous mode: node agent-scout.js --loop [intervalMin] [blocksPerScan]
    const interval = parseInt(args[1] || "30", 10);
    const blocks = parseInt(args[2] || "500", 10);
    runContinuous(interval, blocks);
  } else if (args.includes("--csv")) {
    // Export CSV: node agent-scout.js --csv
    console.log(exportCSV());
  } else if (args.includes("--stats")) {
    // Just show stats
    console.log(JSON.stringify(getStats(), null, 2));
  } else if (args.includes("--top")) {
    // Show top targets
    const limit = parseInt(args[1] || "20", 10);
    const outreach = getOutreachTargets(limit);
    console.log(`Top ${outreach.length} agent targets:\n`);
    for (const t of outreach) {
      const tag = t.username ? ` @${t.username}` : "";
      const sigs = (t.signals || []).slice(0, 3).join(", ");
      console.log(`  [${t.tier}] ${t.address} score:${t.score} txs:${t.txCount}${tag}`);
      console.log(`         ${sigs}`);
    }
  } else {
    // Single scan: node agent-scout.js [blocksBack]
    const blocksBack = parseInt(args[0] || "1000", 10);
    console.log("=== MfT Agent Scout ===\n");
    scanForAgents(blocksBack).then(() => {
      const outreach = getOutreachTargets(10);
      if (outreach.length > 0) {
        console.log("\nTop targets:");
        for (const t of outreach) {
          const tag = t.username ? ` @${t.username}` : "";
          const sigs = (t.signals || []).slice(0, 3).join(", ");
          console.log(`  [${t.tier}] ${t.address.slice(0, 14)}.. score:${t.score} txs:${t.txCount}${tag} (${sigs})`);
        }
      }
      console.log("\n" + JSON.stringify(getStats(), null, 2));
    }).catch(console.error);
  }
}

module.exports = { scanForAgents, enrichTargets, getOutreachTargets, markContacted, getStats };
