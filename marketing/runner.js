/**
 * runner.js — Main orchestrator for MfT Agent Marketing System
 *
 * Three loops running on intervals:
 * 1. Content — generates and posts original content (tweets, threads, agent pitches)
 * 2. Scout — scans Base for agent wallets, enriches with Farcaster data
 * 3. Outreach — finds relevant posts on X/Farcaster and replies contextually
 *
 * Usage:
 *   node runner.js              # run all loops
 *   node runner.js --scout-only
 *   node runner.js --content-only
 *   node runner.js --outreach-only
 *   DRY_RUN=true node runner.js # no actual posting
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { TwitterApi } = require("twitter-api-v2");
const { generateContent } = require("./content-agent");
const { scanForAgents, enrichTargets } = require("./agent-scout");
const { runOutreach, postContent } = require("./outreach-agent");

const DRY_RUN = process.env.DRY_RUN === "true";
const CONTENT_INTERVAL = (parseInt(process.env.CONTENT_INTERVAL || "120", 10)) * 60 * 1000;
const SCOUT_INTERVAL = (parseInt(process.env.SCOUT_INTERVAL || "60", 10)) * 60 * 1000;
const OUTREACH_INTERVAL = (parseInt(process.env.OUTREACH_INTERVAL || "180", 10)) * 60 * 1000;

const args = process.argv.slice(2);
const SCOUT_ONLY = args.includes("--scout-only");
const CONTENT_ONLY = args.includes("--content-only");
const OUTREACH_ONLY = args.includes("--outreach-only");

function createXClient() {
  const { API_KEY, API_SECRET, ACCESS_TOKEN, ACCESS_TOKEN_SECRET } = process.env;
  if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !ACCESS_TOKEN_SECRET) {
    console.log("X/Twitter API credentials not set — X features disabled");
    return null;
  }
  return new TwitterApi({
    appKey: API_KEY,
    appSecret: API_SECRET,
    accessToken: ACCESS_TOKEN,
    accessSecret: ACCESS_TOKEN_SECRET,
  }).readWrite;
}

// Content types cycle through different formats
const CONTENT_TYPES = ["tweet", "agent_pitch", "farcaster", "tweet", "thread", "agent_reply", "heartbeat_report", "farcaster"];
let contentIndex = 0;

async function contentLoop() {
  console.log("\n--- Content Loop ---");
  try {
    const type = CONTENT_TYPES[contentIndex % CONTENT_TYPES.length];
    contentIndex++;

    const content = await generateContent(type);
    console.log(`Generated ${type}:`);
    console.log(content.content);

    const xClient = createXClient();
    await postContent(content, {
      dryRun: DRY_RUN,
      xClient,
      neynarKey: process.env.NEYNAR_API_KEY,
      signerUuid: process.env.FARCASTER_SIGNER_UUID,
    });
  } catch (e) {
    console.error("Content loop error:", e.message);
  }
}

async function scoutLoop() {
  console.log("\n--- Scout Loop ---");
  try {
    await scanForAgents(500);
    await enrichTargets(process.env.NEYNAR_API_KEY);
  } catch (e) {
    console.error("Scout loop error:", e.message);
  }
}

async function outreachLoop() {
  console.log("\n--- Outreach Loop ---");
  try {
    const xClient = createXClient();
    await runOutreach({
      dryRun: DRY_RUN,
      xClient,
      neynarKey: process.env.NEYNAR_API_KEY,
      signerUuid: process.env.FARCASTER_SIGNER_UUID,
    });
  } catch (e) {
    console.error("Outreach loop error:", e.message);
  }
}

async function main() {
  console.log("=== MfT Agent Marketing System ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Content interval: ${CONTENT_INTERVAL / 60000}min`);
  console.log(`Scout interval: ${SCOUT_INTERVAL / 60000}min`);
  console.log(`Outreach interval: ${OUTREACH_INTERVAL / 60000}min`);

  const xClient = createXClient();
  console.log(`X/Twitter: ${xClient ? "connected" : "disabled"}`);
  console.log(`Farcaster: ${process.env.NEYNAR_API_KEY ? "connected" : "disabled"}`);
  console.log(`Claude API: ${process.env.ANTHROPIC_API_KEY ? "connected" : "MISSING"}`);
  console.log("");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required. Set it in .env");
    process.exit(1);
  }

  // Run selected loops or all
  if (SCOUT_ONLY) {
    await scoutLoop();
    return;
  }
  if (CONTENT_ONLY) {
    await contentLoop();
    return;
  }
  if (OUTREACH_ONLY) {
    await outreachLoop();
    return;
  }

  // Run all loops on intervals
  // Stagger initial runs to avoid hitting APIs simultaneously
  console.log("Starting all loops...\n");

  // Scout first (builds target list)
  await scoutLoop();

  // Then content (posts original content)
  setTimeout(async () => {
    await contentLoop();
    setInterval(contentLoop, CONTENT_INTERVAL);
  }, 10000);

  // Then outreach (replies to others)
  setTimeout(async () => {
    await outreachLoop();
    setInterval(outreachLoop, OUTREACH_INTERVAL);
  }, 30000);

  // Scout continues on its interval
  setInterval(scoutLoop, SCOUT_INTERVAL);

  console.log("All loops running. Press Ctrl+C to stop.");
}

main().catch(console.error);
