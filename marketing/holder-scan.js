/**
 * holder-scan.js — Find wallets holding ecosystem tokens
 *
 * Scans Transfer events on MfT/POOP/BB/EB/EARTH/AZUSD to find
 * wallets that already bought into the ecosystem. These are the
 * highest quality airdrop targets.
 *
 * Usage:
 *   node holder-scan.js              — scan and add to agent-targets.json
 *   node holder-scan.js --dry-run    — preview without saving
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// Use Alchemy for reliable, fast scanning
const RPC = "https://base-mainnet.g.alchemy.com/v2/bwii0dH70pKYTKnqj3aNU";
const TARGETS_FILE = path.join(__dirname, "agent-targets.json");

const TOKENS = {
  MfT:     "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3",
  POOP:    "0x126555aecBAC290b25644e4b7f29c016aE95f4dc",
  EARTH:   "0x9e24415D1e549eBc626a13A482Bb117a2B43e9CF",
  AZUSD:   "0x3595ca37596D5895B70EFAB592ac315D5B9809B2",
  BURGERS: "0x06A05043eb2C1691b19c2C13219dB9212269dDc5",
  TGN:     "0xD75dfa972C6136f1c594Fec1945302f885E1ab29",
  BP:      "0x33c5e3362A9ddfD453FF655D7DdbC8C2Eff4A062",
};

// Wallets to never target (our own + routers + known contracts)
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

async function scanTokenHolders(provider, blocksBack = 200000) {
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const currentBlock = await provider.getBlockNumber();
  const startBlock = currentBlock - blocksBack;
  const holders = {};

  console.log(`Scanning ${blocksBack} blocks (${(blocksBack * 2 / 3600).toFixed(0)}hrs) for token transfers...`);

  for (const [name, addr] of Object.entries(TOKENS)) {
    let tokenTransfers = 0;
    console.log(`  ${name} (${addr.slice(0, 10)}...)...`);

    // Scan in 10K block chunks
    for (let from = startBlock; from <= currentBlock; from += 10000) {
      const to = Math.min(from + 9999, currentBlock);
      try {
        const logs = await provider.getLogs({
          fromBlock: from, toBlock: to,
          address: addr,
          topics: [transferTopic],
        });

        for (const log of logs) {
          if (log.topics.length < 3) continue;
          // topic[2] = recipient address
          const recipient = "0x" + log.topics[2].slice(26);
          const normalized = recipient.toLowerCase();

          if (EXCLUDE.has(normalized)) continue;
          // Skip zero-ish addresses and contracts we know
          if (normalized.startsWith("0x00000000")) continue;

          if (!holders[normalized]) {
            holders[normalized] = { tokens: new Set(), txCount: 0, address: normalized };
          }
          holders[normalized].tokens.add(name);
          holders[normalized].txCount++;
          tokenTransfers++;
        }
      } catch (e) {
        // Rate limit — wait and retry
        if (e.message?.includes("rate") || e.message?.includes("429")) {
          await new Promise(r => setTimeout(r, 2000));
          from -= 10000; // retry this chunk
        }
      }
    }
    console.log(`    ${tokenTransfers} transfers found`);
  }

  return holders;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const provider = new ethers.JsonRpcProvider(RPC);
  const targets = loadTargets();

  const holders = await scanTokenHolders(provider);

  // Score and tier
  const scored = [];
  for (const [addr, data] of Object.entries(holders)) {
    // Skip already known wallets
    if (targets.wallets[addr]) {
      continue;
    }

    const tokenCount = data.tokens.size;
    const score = tokenCount * 15 + Math.min(data.txCount, 30);
    const tier = tokenCount >= 3 ? "hot" : tokenCount >= 2 ? "warm" : "cold";
    const signals = [`holds:${[...data.tokens].join("+")}`, `transfers:${data.txCount}`];

    scored.push({ address: addr, score, tier, signals, tokenCount, txCount: data.txCount });
  }

  // Sort by score desc
  scored.sort((a, b) => b.score - a.score);

  const hot = scored.filter(s => s.tier === "hot");
  const warm = scored.filter(s => s.tier === "warm");
  const cold = scored.filter(s => s.tier === "cold");

  console.log(`\n=== Holder Scan Results ===`);
  console.log(`New wallets found: ${scored.length}`);
  console.log(`  Hot (3+ tokens): ${hot.length}`);
  console.log(`  Warm (2 tokens): ${warm.length}`);
  console.log(`  Cold (1 token):  ${cold.length}`);

  if (scored.length > 0) {
    console.log(`\nTop targets:`);
    for (const s of scored.slice(0, 15)) {
      console.log(`  [${s.tier}] ${s.address.slice(0, 16)}.. score:${s.score} (${s.signals.join(", ")})`);
    }
  }

  if (dryRun) {
    console.log("\n[DRY RUN] No changes saved.");
    return;
  }

  // Add to targets
  let added = 0;
  for (const s of scored) {
    targets.wallets[s.address] = {
      address: s.address,
      score: s.score,
      tier: s.tier,
      signals: s.signals,
      txCount: s.txCount,
      contacted: false,
      source: "holder-scan",
      discoveredAt: new Date().toISOString(),
    };
    added++;
  }

  saveTargets(targets);
  console.log(`\nAdded ${added} new targets to agent-targets.json`);
  console.log(`Total targets: ${Object.keys(targets.wallets).length}`);

  const uncontacted = Object.values(targets.wallets).filter(w => !w.contacted);
  const uncontactedHot = uncontacted.filter(w => w.tier === "hot");
  const uncontactedWarm = uncontacted.filter(w => w.tier === "warm");
  console.log(`Uncontacted: ${uncontacted.length} (${uncontactedHot.length} hot, ${uncontactedWarm.length} warm)`);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
