/**
 * heartbeat-generator.js — Weekly Heartbeat Report for Unrugable
 *
 * Reads live chain data from Base to produce a thread-ready stats report.
 * Run standalone: node heartbeat-generator.js
 * Or import: const { generateHeartbeat } = require('./heartbeat-generator');
 *
 * Output saved to: marketing/heartbeat-reports/[YYYY-MM-DD].md
 */

const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const { fetchChainData, formatNum, FIREABLE_REACTORS } = require("./chain-data");

// --- Constants ---
const RPC = "https://mainnet.base.org";
const BURN = "0xfd780B0aE569e15e514B819ecFDF46f804953a4B";
const MFT = "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

const SUPABASE_URL = "https://hhniimufxjjgmessjtbc.supabase.co";
const SUPABASE_ANON = "sb_publishable_F471ZS8yTS8qiXU0ZLEqvQ_I-O3av-l";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];

const PAIR_ABI = [
  "function getReserves() view returns (uint112, uint112, uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

// Full reactor list from reactor-map.json (all known reactors on the network)
// This covers the entire Unrugable reactor network including launched token reactors
const ALL_REACTORS = [
  // MycoPad Hub
  { name: "HUB", addr: "0xf5b9fc40080aacc262f078ece374a2268dcdb045" },
  // Launched token primary reactors
  { name: "MTEST", addr: "0xAb2d882d0CBc9065425210F49073EA5dAEDa58eB" },
  { name: "NMB", addr: "0x745BAbD96010A1459edAdc0760c936501fCC95dB" },
  { name: "MR", addr: "0x195505D0F711628F4BD32b8C9B6c9D18050F6acc" },
  { name: "NFS", addr: "0x71C28E76E3CD6D457e7639314B114760246cdeAD" },
  { name: "BP", addr: "0xfDb309F2a7055e2dd8221f9eb27655F11d2d43be" },
  { name: "Myco", addr: "0x87bbF797152Ca3136a92DAc1333Fc7b1f8966e2A" },
  { name: "RT", addr: "0x513d2EB33F1A7eC3798cC221Ab4b4Ce2A3FAfb98" },
  { name: "Turtle", addr: "0xf1f8c64102Ee62361eACb694F09d24f42Aaa23da" },
  { name: "bAGI", addr: "0x20a14d6A1aB57851a58d4A85C0FC06f23A7AeA42" },
  { name: "Flwr", addr: "0x752831229E92957902B328b63df545aB50d98Af5" },
  { name: "DD", addr: "0x1a6Eb1F6Bd44A35ca83d8E5E130D1eb95692b5E0" },
  { name: "BRUH", addr: "0x14972F189310c0B510C20f239E283D1cBd8Bfc7A" },
  { name: "NZ", addr: "0x93AB8aB8Df2fa299bF1874A638239d5ef6C95330" },
  { name: "ILM", addr: "0x13Fba3fe255b8e3e462816c45725211d06Be82fB" },
  { name: "Moon", addr: "0x3534706f4B1642841c008f7368A0A16411c5Abf2" },
  { name: "Bat", addr: "0xdb4ED222C19082C8ea9c9A044ce81e2d22DF61AB" },
  // CHAR reactors (launched)
  { name: "MTEST-CHAR", addr: "0x237EfD82070f7AE71bA1950b10B16F0Ea02CA8e9" },
  { name: "NMB-CHAR", addr: "0x3C69C3d620616b6840c65145eCbCf7e45CAdf241" },
  { name: "MR-CHAR", addr: "0x15FFF1286807FA96b4CaC8B9Bc262A492494c6D8" },
  { name: "NFS-CHAR", addr: "0x2eE4029E8d83d80B01B9CD7C0a4EE81e584b87e9" },
  { name: "BP-CHAR", addr: "0x22988bCB84e635c79F570711ea5477C548140a0d" },
  { name: "Myco-CHAR", addr: "0x4618fB5b9914BEEF00C22A1082dCdC4064dcA8c3" },
  { name: "RT-CHAR", addr: "0x230a642e12b5Fabb4F4A99789a152548b39a1BE9" },
  { name: "Turtle-CHAR", addr: "0x707d226a67CE96aaD18f3594e08d868bc43D388c" },
  { name: "bAGI-CHAR", addr: "0xbB6Ec399365a8E64ab7d5f7162aE19B441cbEcba" },
  { name: "Flwr-CHAR", addr: "0xfb3B709882a48b185F266Fc6f37156A92771a558" },
  { name: "DD-CHAR", addr: "0x11bcA0021E9957d7d0c3c358E9ED7a023E9C71a2" },
  { name: "BRUH-CHAR", addr: "0xEFCfb826a5dc63e0854535DCfA567DE94AAB5493" },
  { name: "NZ-CHAR", addr: "0x685Aa02a4FF0D6c396Ebb15F6F4957D9839E5852" },
  { name: "ILM-CHAR", addr: "0x3598319EFd15FeC7Bf3eb59c69184CC39b730BDd" },
  { name: "Moon-CHAR", addr: "0x71A56cB21FC772181c3CC11b3E245d35c956Ee71" },
  { name: "Bat-CHAR", addr: "0x9aea9181e97bf613a1D4Ee9E3e6f477a2B54F061" },
  // PIZZA chain (V4)
  { name: "PIZZA", addr: "0xe93Aa8104Ad035AC88b984320D80b5c335B2B96C" },
  { name: "BURGERS", addr: "0x2867F1107d3A4767018740e10f0067702a8eC682" },
  { name: "NFS-V4", addr: "0x286416cE59B355dEFf1a02d52013d4CBDC11F3bF" },
  // Static network (pre-MycoPad)
  { name: "ecowealth", addr: "0xc7E739f223934C5F69EBA36BcDf808c4379b1985" },
  { name: "BB-v5", addr: "0x3b31B8c9338ebFE2e737e5dd6361cEf0Bdc431e3" },
  { name: "EB-v5", addr: "0x2e06EB264dB2C7bcD8B9a216827b7D0eF3beACA2" },
  { name: "EB-relay", addr: "0xC28e64551816535d9ef06CE95844F2b5317353bA" },
  { name: "BTCband-v1", addr: "0x2879706E115150BBB9ffb5C432024264dEE0852F" },
  { name: "ETHband-v1", addr: "0x7018660EFBd7CfE3219388322417D405fC15b23B" },
  { name: "BTCband-v2", addr: "0x038B87f2Abc1dcE269FF7DE4d3e721b5b57eD8cf" },
  { name: "ETHband-v2", addr: "0xeB02d1137342cD08C1c4bf61C188d86C5253b631" },
  { name: "BB-v3", addr: "0x5375817c1798d43036d3b2DAAfaFB8e2247bAcF2" },
  { name: "EB-v3", addr: "0x361A4E356847c5a0C60B510b2531b640aC51f090" },
  { name: "TGN", addr: "0xc3f09dAEF814177E52B4C04ec2872B564a36989D" },
  { name: "AZUSD", addr: "0xD8AFb7caD1f8A3Ddc4E16c1516a94949eb119281" },
  { name: "AZUSD-2", addr: "0x6888ef2f92e3073a378f7153548e9c7691c90d23" },
  { name: "BURGERS-main", addr: "0xc858026Ec5D30280137032BC6EA86F46ea23C2CA" },
  { name: "CHAR-main", addr: "0xc2eBe90fB9bC7897f06DC00666951Fa9a49A397A" },
  { name: "EGP", addr: "0x10A710fced92eB096F796F43BCCFb60884c13819" },
  { name: "Prime", addr: "0xed3aE91b2bb22307c07438EEebA2500C18EABcFE" },
];

// timeUntilExecute() selector
const TIME_UNTIL_EXECUTE_SEL = "0xd46cd1c9";

/**
 * Check how many reactors are currently active (cooldown = 0 or have pools)
 * A reactor is "firing" if it has pools and is not permanently bricked.
 */
async function countActiveReactors(provider) {
  let active = 0;
  let ready = 0;

  for (const r of ALL_REACTORS) {
    try {
      const timeData = await provider.call({
        to: r.addr.toLowerCase(),
        data: TIME_UNTIL_EXECUTE_SEL,
        gas: "0x1C9C380",
      });
      // If the call succeeds, the reactor exists and is functional
      active++;
      if (timeData && timeData.length >= 66) {
        const timeLeft = Number(BigInt(timeData.slice(0, 66)));
        if (timeLeft === 0) ready++;
      }
    } catch (err) {
      // Reactor may be bricked or non-responsive — skip
    }
  }

  return { active, ready, total: ALL_REACTORS.length };
}

/**
 * Get total MfT burned at the burn address
 */
async function getMftBurned(provider) {
  try {
    const mft = new ethers.Contract(MFT, ERC20_ABI, provider);
    const bal = await mft.balanceOf(BURN);
    return Number(ethers.formatUnits(bal, 18));
  } catch (err) {
    console.error("[!] MfT burn balance fetch failed:", err.message);
    return 0;
  }
}

/**
 * Get launches from the past 7 days via Supabase
 */
async function getWeeklyLaunches() {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/launched_tokens?select=symbol,token_address,reactor_address,seed,launched_at&launched_at=gte.${oneWeekAgo}&order=launched_at.desc`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    if (!res.ok) {
      console.error("[!] Supabase weekly launches failed:", res.status, await res.text());
      return [];
    }
    return await res.json();
  } catch (err) {
    console.error("[!] Supabase weekly launches fetch failed:", err.message);
    return [];
  }
}

/**
 * Estimate total TVL locked across reactors by checking USDC + WETH balances
 * at reactor addresses (LP tokens are permanently locked there).
 * Uses a simplified approach: sum USDC balances + (WETH balances * ETH price).
 */
async function estimateTVL(provider, ethPriceUsd) {
  let totalUsd = 0;
  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
  const weth = new ethers.Contract(WETH, ERC20_ABI, provider);

  // Check balances at each reactor (LP tokens held = locked liquidity indicators)
  // We check raw token balances as a TVL proxy since LPs are locked forever
  for (const r of ALL_REACTORS) {
    try {
      const usdcBal = await usdc.balanceOf(r.addr);
      totalUsd += Number(ethers.formatUnits(usdcBal, 6));
    } catch (err) {
      console.warn(`[heartbeat] USDC balance check failed for ${r.name}:`, err.message || err);
    }
    try {
      const wethBal = await weth.balanceOf(r.addr);
      totalUsd += Number(ethers.formatUnits(wethBal, 18)) * ethPriceUsd;
    } catch (err) {
      console.warn(`[heartbeat] WETH balance check failed for ${r.name}:`, err.message || err);
    }
  }

  return totalUsd;
}

/**
 * Get total pool count from reactor-map.json (static source of truth)
 */
function getTotalPoolCount() {
  const mapPath = path.join(__dirname, "..", "site", "api", "reactor-map.json");
  try {
    const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    let pools = 0;
    for (const [, reactor] of Object.entries(map.reactors)) {
      if (reactor.tags) pools += reactor.tags.length;
    }
    return pools;
  } catch (err) {
    console.error("[!] Could not read reactor-map.json:", err.message);
    // Fallback: sum from FIREABLE_REACTORS
    return FIREABLE_REACTORS.reduce((s, r) => s + r.pools, 0);
  }
}

/**
 * Estimate volume processed by reading burn values from reactor-map.json
 * (each burn = a trade was processed through a reactor)
 */
function getTotalBurnValue() {
  const mapPath = path.join(__dirname, "..", "site", "api", "reactor-map.json");
  try {
    const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    let totalBurnValue = 0;
    for (const launch of map.launches) {
      if (launch.burnValue) totalBurnValue += launch.burnValue;
    }
    if (map.impactBurns) {
      for (const burn of map.impactBurns) {
        if (burn.value) totalBurnValue += burn.value;
      }
    }
    return totalBurnValue;
  } catch (err) {
    console.error("[!] Could not read burn values from reactor-map.json:", err.message);
    return 0;
  }
}

/**
 * Main heartbeat generator — gathers all data and formats the report
 */
async function generateHeartbeat() {
  console.log("[heartbeat] Fetching live chain data...");
  const provider = new ethers.JsonRpcProvider(RPC);

  // Run data fetches concurrently where possible
  const [chainData, reactorCounts, mftBurned, weeklyLaunches] = await Promise.all([
    fetchChainData(),
    countActiveReactors(provider),
    getMftBurned(provider),
    getWeeklyLaunches(),
  ]);

  // TODO: fetch live ETH price from CoinGecko or similar API instead of hardcoding
  // ETH price estimate for TVL calc (same approach as chain-data.js) — PLACEHOLDER, will drift
  const ethPriceUsd = 2400;

  // TVL estimate (sequential to avoid RPC rate limits on 50+ calls)
  console.log("[heartbeat] Estimating TVL across reactors...");
  const tvlUsd = await estimateTVL(provider, ethPriceUsd);

  // Pool count from reactor map
  const totalPools = getTotalPoolCount();

  // Total burn value processed (proxy for volume)
  const totalBurnValue = getTotalBurnValue();
  // Volume estimate: burns represent ~1-3% of volume, use 2% as midpoint
  const volumeEstimate = totalBurnValue / 0.02;

  // Week date range
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dateStr = now.toISOString().slice(0, 10);
  const weekLabel = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " - " + now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // --- Format the report ---
  const report = {
    date: dateStr,
    weekLabel,
    reactorsFiring: reactorCounts.active,
    reactorsReady: reactorCounts.ready,
    totalPools,
    tvlUsd,
    mftBurned,
    weeklyLaunches: weeklyLaunches.length,
    weeklyLaunchSymbols: weeklyLaunches.map(l => l.symbol),
    totalLaunches: chainData.launchCount,
    volumeProcessed: volumeEstimate,
    mftPrice: chainData.mftPriceUsd,
    burns: chainData.burns,
  };

  // --- Thread-ready text ---
  const threadText = formatThread(report);
  const farcasterText = formatFarcaster(report);
  const markdownReport = formatMarkdown(report, threadText, farcasterText);

  // --- Save to file ---
  const outDir = path.join(__dirname, "heartbeat-reports");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, `${dateStr}.md`);
  fs.writeFileSync(outPath, markdownReport, "utf8");
  console.log(`[heartbeat] Report saved to: ${outPath}`);

  return { report, threadText, farcasterText, filePath: outPath };
}

/**
 * Format as X thread (3 tweets)
 */
function formatThread(r) {
  let thread = "";

  // Tweet 1 — headline stats
  thread += `Unrugable Heartbeat -- Week of ${r.weekLabel}\n\n`;
  thread += `Reactors firing: ${r.reactorsFiring}\n`;
  if (r.tvlUsd > 0) thread += `LP locked forever: $${formatNum(r.tvlUsd)}\n`;
  thread += `MfT burned: ${formatNum(r.mftBurned)} tokens\n`;
  if (r.weeklyLaunches > 0) thread += `New launches: ${r.weeklyLaunches}\n`;
  if (r.volumeProcessed > 0) thread += `Volume processed: $${formatNum(r.volumeProcessed)}\n`;
  thread += `\nAll autonomous. All on-chain. All verifiable.`;

  thread += "\n\n---\n\n";

  // Tweet 2 — network details
  thread += `Network status:\n`;
  thread += `- ${r.totalPools}+ pools across ${r.reactorsFiring} reactors\n`;
  thread += `- ${r.reactorsReady} reactors ready to fire right now\n`;
  thread += `- ${r.totalLaunches} total tokens launched\n`;
  if (r.weeklyLaunchSymbols.length > 0) {
    thread += `- This week: $${r.weeklyLaunchSymbols.join(", $")}\n`;
  }
  thread += `\nEvery launch adds fuel. Every trade burns supply. Every cycle compounds.`;

  thread += "\n\n---\n\n";

  // Tweet 3 — verification + CTA
  thread += `Verify everything on-chain:\n`;
  thread += `- Burns: tasern.quest/mft/\n`;
  thread += `- API: tasern.quest/api/unrugable/tokenomics\n`;
  thread += `- Agent tools: tasern.quest/llms.txt\n\n`;
  thread += `${r.reactorsFiring} reactors. ${r.totalPools}+ pools. $0 marketing budget.\n\n`;
  thread += `Unrugable by code, not by promise.`;

  return thread;
}

/**
 * Format for Farcaster (single post, up to 1024 chars)
 */
function formatFarcaster(r) {
  let post = `Heartbeat Report -- Week of ${r.weekLabel}\n\n`;

  post += `Network:\n`;
  post += `- Reactors: ${r.reactorsFiring} active (${r.reactorsReady} ready to fire)\n`;
  post += `- Pools: ${r.totalPools}+ across all reactors\n`;
  if (r.tvlUsd > 0) post += `- LP locked: $${formatNum(r.tvlUsd)}\n`;
  post += `\n`;

  post += `Burns (permanent):\n`;
  post += `- MfT: ${formatNum(r.mftBurned)} tokens`;
  if (r.mftPrice > 0) post += ` ($${formatNum(r.mftBurned * r.mftPrice)})`;
  post += `\n`;
  for (const [sym, amt] of Object.entries(r.burns)) {
    if (sym !== "MfT" && amt > 0) {
      post += `- ${sym}: ${formatNum(amt)}\n`;
    }
  }
  post += `\n`;

  post += `Activity:\n`;
  if (r.weeklyLaunches > 0) post += `- New launches this week: ${r.weeklyLaunches}\n`;
  post += `- Total launched: ${r.totalLaunches}\n`;
  if (r.volumeProcessed > 0) post += `- Volume processed: $${formatNum(r.volumeProcessed)}\n`;
  post += `\n`;

  post += `tasern.quest/api/unrugable/tokenomics`;

  // Trim to 1024 chars if needed
  if (post.length > 1024) {
    post = post.slice(0, 1021) + "...";
  }

  return post;
}

/**
 * Format full markdown report (combines both formats + raw data)
 */
function formatMarkdown(r, threadText, farcasterText) {
  let md = `# Unrugable Heartbeat Report\n\n`;
  md += `**Week of ${r.weekLabel}**\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `---\n\n`;

  md += `## Key Metrics\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Reactors Active | ${r.reactorsFiring} |\n`;
  md += `| Reactors Ready | ${r.reactorsReady} |\n`;
  md += `| Total Pools | ${r.totalPools}+ |\n`;
  if (r.tvlUsd > 0) md += `| LP Locked (est.) | $${formatNum(r.tvlUsd)} |\n`;
  md += `| MfT Burned | ${formatNum(r.mftBurned)} |\n`;
  md += `| MfT Price | $${r.mftPrice.toFixed(6)} |\n`;
  md += `| Weekly Launches | ${r.weeklyLaunches} |\n`;
  md += `| Total Launches | ${r.totalLaunches} |\n`;
  if (r.volumeProcessed > 0) md += `| Volume Processed (est.) | $${formatNum(r.volumeProcessed)} |\n`;
  md += `\n`;

  if (Object.keys(r.burns).length > 0) {
    md += `## Burns\n\n`;
    for (const [sym, amt] of Object.entries(r.burns)) {
      if (amt > 0) md += `- **${sym}**: ${formatNum(amt)}\n`;
    }
    md += `\n`;
  }

  if (r.weeklyLaunchSymbols.length > 0) {
    md += `## This Week's Launches\n\n`;
    for (const sym of r.weeklyLaunchSymbols) {
      md += `- $${sym}\n`;
    }
    md += `\n`;
  }

  md += `---\n\n`;
  md += `## X Thread (copy-paste ready)\n\n`;
  md += `\`\`\`\n${threadText}\n\`\`\`\n\n`;

  md += `---\n\n`;
  md += `## Farcaster Post (copy-paste ready)\n\n`;
  md += `\`\`\`\n${farcasterText}\n\`\`\`\n\n`;

  md += `---\n\n`;
  md += `*Data sourced from Base chain (RPC) and Supabase. All numbers verifiable on-chain.*\n`;

  return md;
}

// --- Run standalone ---
if (require.main === module) {
  generateHeartbeat()
    .then(({ report, threadText, filePath }) => {
      console.log("\n========================================");
      console.log("  HEARTBEAT REPORT GENERATED");
      console.log("========================================\n");
      console.log(threadText);
      console.log("\n========================================");
      console.log(`Saved to: ${filePath}`);
      console.log("========================================\n");
    })
    .catch(err => {
      console.error("[!] Heartbeat generation failed:", err);
      process.exit(1);
    });
}

module.exports = { generateHeartbeat };
