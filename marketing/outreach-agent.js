/**
 * outreach-agent.js — Finds and engages crypto agent accounts on X and Farcaster
 *
 * Strategy:
 * 1. Search X for agent-related keywords + token launching
 * 2. Search Farcaster for agent/DeFi channels
 * 3. Generate contextual replies using Claude
 * 4. Post replies (with rate limiting and dedup)
 *
 * NOT spam — every reply is contextual and adds value.
 */

const { TwitterApi } = require("twitter-api-v2");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const { fetchChainData, formatNum } = require("./chain-data");

const OUTREACH_LOG = path.join(__dirname, "outreach-log.json");

// Search queries that find agents and agent operators
const X_SEARCHES = [
  // Agent operators looking for tokens
  '"AI agent" "token" "launch" -is:retweet',
  '"agent" "Base chain" "token" -is:retweet',
  '"autonomous agent" "DeFi" -is:retweet',
  // Agent frameworks
  '"ElizaOS" "token" -is:retweet',
  '"Virtuals" "agent" "launch" -is:retweet',
  // Unrugable/safe token seekers
  '"unrugable" OR "rug proof" "token" -is:retweet',
  '"locked liquidity" "forever" -is:retweet',
  // Carbon/impact angle
  '"carbon credits" "DeFi" OR "crypto" -is:retweet',
  // Agent-to-agent
  '"agent" "API" "token" OR "swap" -is:retweet',
];

const FARCASTER_CHANNELS = [
  "defi", "base", "agents", "ai", "memecoins", "trading",
  "base-builders", "onchain", "climate", "impact", "crypto-ai",
];

// Agent accounts to monitor (they post about launching/buying tokens)
const WATCH_ACCOUNTS = [
  "aixbt_agent", "truth_terminal", "luna_virtuals",
  "dolos_diary", "sekoia_virtuals", "aethernet_ai",
];

function loadLog() {
  if (fs.existsSync(OUTREACH_LOG)) {
    return JSON.parse(fs.readFileSync(OUTREACH_LOG, "utf8"));
  }
  return { replied: {}, posted: [], lastRun: null };
}

function saveLog(log) {
  log.lastRun = new Date().toISOString();
  fs.writeFileSync(OUTREACH_LOG, JSON.stringify(log, null, 2));
}

/**
 * Generate a contextual reply to a tweet/cast about agents or tokens
 */
async function generateReply(originalText, platform = "x") {
  const anthropic = new Anthropic();
  const data = await fetchChainData();

  const maxLen = platform === "farcaster" ? 800 : 240;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: `You write short, helpful replies on ${platform} for the MfT Unrugable Launcher.
You are NOT a bot — you are a builder sharing what you built. Be conversational.
Never start with "Hey!" or "Great post!". Get straight to the point.
Never be pushy or salesy. Offer information that's relevant to what they posted.

Key facts you can mention (pick 1-2 max):
- Unrugable Launcher: 100% supply locked in LPs, no withdraw function
- Reactors burn supply every 2hrs, floors mathematically increase
- Public API: tasern.quest/api/unrugable/tokenomics
- Agent discovery: tasern.quest/llms.txt + ai-plugin.json
- ${data.launchCount} tokens launched, ${data.totalReactors} reactors active
- Every trade removes carbon credits from markets (CHAR collected permanently at no-withdraw tracking address)
- ${formatNum(data.burns.MfT || 0)} MfT burned so far

Max ${maxLen} characters. Just the reply text, nothing else.`,
    messages: [{
      role: "user",
      content: `Someone posted this on ${platform}:\n\n"${originalText.slice(0, 500)}"\n\nWrite a relevant, helpful reply. If the post isn't about tokens, DeFi, agents, or launching — reply with just "SKIP".`,
    }],
  });

  const reply = response.content[0].text.trim();
  if (reply === "SKIP" || reply.length < 10) return null;
  return reply;
}

/**
 * Search X for outreach opportunities
 */
async function searchX(client) {
  const log = loadLog();
  const opportunities = [];

  for (const query of X_SEARCHES) {
    try {
      const results = await client.v2.search(query, {
        max_results: 10,
        "tweet.fields": "author_id,created_at,public_metrics",
        sort_order: "recency",
      });

      for await (const tweet of results) {
        // Skip if already replied
        if (log.replied[tweet.id]) continue;

        // Skip low-engagement tweets
        const metrics = tweet.public_metrics || {};
        if ((metrics.like_count || 0) < 1 && (metrics.reply_count || 0) < 1) continue;

        opportunities.push({
          platform: "x",
          id: tweet.id,
          text: tweet.text,
          authorId: tweet.author_id,
          engagement: (metrics.like_count || 0) + (metrics.retw_count || 0) * 2,
        });
      }
    } catch (e) {
      console.log("X search error:", e.message?.slice(0, 80));
    }

    // Rate limit between searches
    await new Promise(r => setTimeout(r, 2000));
  }

  // Sort by engagement (reply to most visible posts first)
  opportunities.sort((a, b) => b.engagement - a.engagement);
  return opportunities.slice(0, 5); // max 5 per cycle
}

/**
 * Search Farcaster for outreach opportunities via Neynar
 */
async function searchFarcaster(neynarKey) {
  if (!neynarKey) return [];

  const log = loadLog();
  const opportunities = [];

  const searchTerms = [
    "AI agent token launch",
    "unrugable liquidity",
    "agent DeFi Base",
    "token launcher API",
    "autonomous trading agent",
    "MCP tools crypto",
    "carbon credits onchain",
    "Base chain launch",
    "agentic wallet DeFi",
    "play to earn impact",
  ];

  for (const term of searchTerms) {
    try {
      const res = await fetch(
        `https://api.neynar.com/v2/farcaster/feed/search?q=${encodeURIComponent(term)}&limit=5`,
        { headers: { api_key: neynarKey, accept: "application/json" } }
      );
      if (!res.ok) continue;
      const data = await res.json();

      for (const cast of (data.result?.casts || [])) {
        if (log.replied["fc_" + cast.hash]) continue;

        opportunities.push({
          platform: "farcaster",
          id: cast.hash,
          text: cast.text,
          author: cast.author?.username,
          fid: cast.author?.fid,
          engagement: (cast.reactions?.likes_count || 0) + (cast.replies?.count || 0),
        });
      }
    } catch (e) {
      console.log("Farcaster search error:", e.message?.slice(0, 80));
    }

    await new Promise(r => setTimeout(r, 1100));
  }

  opportunities.sort((a, b) => b.engagement - a.engagement);
  return opportunities.slice(0, 3); // max 3 per cycle
}

/**
 * Execute outreach cycle
 */
async function runOutreach(opts = {}) {
  const { dryRun = false, xClient = null, neynarKey = null, signerUuid = null } = opts;
  const log = loadLog();
  const results = [];

  console.log("\n=== Outreach Cycle ===\n");

  // 1. Search X
  if (xClient) {
    const xOpps = await searchX(xClient);
    console.log(`Found ${xOpps.length} X opportunities`);

    for (const opp of xOpps) {
      const reply = await generateReply(opp.text, "x");
      if (!reply) {
        console.log(`  SKIP: ${opp.text.slice(0, 60)}...`);
        continue;
      }

      console.log(`  REPLY to [${opp.id}]: ${reply.slice(0, 80)}...`);

      if (!dryRun) {
        try {
          await xClient.v2.reply(reply, opp.id);
          log.replied[opp.id] = { at: new Date().toISOString(), reply };
          results.push({ platform: "x", id: opp.id, reply });
          // Rate limit: max 1 reply per 3 minutes
          await new Promise(r => setTimeout(r, 180000));
        } catch (e) {
          console.log(`  POST ERROR: ${e.message?.slice(0, 60)}`);
        }
      } else {
        log.replied[opp.id] = { at: new Date().toISOString(), reply, dryRun: true };
        results.push({ platform: "x", id: opp.id, reply, dryRun: true });
      }
    }
  }

  // 2. Search Farcaster
  if (neynarKey) {
    const fcOpps = await searchFarcaster(neynarKey);
    console.log(`Found ${fcOpps.length} Farcaster opportunities`);

    for (const opp of fcOpps) {
      const reply = await generateReply(opp.text, "farcaster");
      if (!reply) {
        console.log(`  SKIP: ${opp.text.slice(0, 60)}...`);
        continue;
      }

      console.log(`  REPLY to @${opp.author} [${opp.id.slice(0, 10)}]: ${reply.slice(0, 80)}...`);

      if (!dryRun && signerUuid) {
        try {
          await fetch("https://api.neynar.com/v2/farcaster/cast", {
            method: "POST",
            headers: {
              api_key: neynarKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              signer_uuid: signerUuid,
              text: reply,
              parent: opp.id,
            }),
          });
          log.replied["fc_" + opp.id] = { at: new Date().toISOString(), reply, author: opp.author };
          results.push({ platform: "farcaster", id: opp.id, reply });
          await new Promise(r => setTimeout(r, 60000)); // 1 min between FC replies
        } catch (e) {
          console.log(`  FC POST ERROR: ${e.message?.slice(0, 60)}`);
        }
      } else {
        log.replied["fc_" + opp.id] = { at: new Date().toISOString(), reply, dryRun: true };
        results.push({ platform: "farcaster", id: opp.id, reply, dryRun: true });
      }
    }
  }

  saveLog(log);
  console.log(`\nOutreach complete: ${results.length} replies ${dryRun ? "(dry run)" : "sent"}`);
  return results;
}

/**
 * Post original content to X and Farcaster
 */
async function postContent(content, opts = {}) {
  const { dryRun = false, xClient = null, neynarKey = null, signerUuid = null } = opts;
  const log = loadLog();

  console.log(`\nPosting content (${content.type}):`);
  console.log(content.content.slice(0, 120) + "...");

  if (content.type === "thread" && xClient && !dryRun) {
    // Split thread by numbered markers
    const parts = content.content.split(/\n\n(?=\d+\/)/);
    let lastTweetId = null;
    for (const part of parts) {
      try {
        if (lastTweetId) {
          const reply = await xClient.v2.reply(part, lastTweetId);
          lastTweetId = reply.data.id;
        } else {
          const tweet = await xClient.v2.tweet(part);
          lastTweetId = tweet.data.id;
        }
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.log("Thread post error:", e.message?.slice(0, 60));
        break;
      }
    }
    log.posted.push({ type: "thread", tweetId: lastTweetId, at: new Date().toISOString() });
  } else if (xClient && !dryRun) {
    try {
      const tweet = await xClient.v2.tweet(content.content);
      log.posted.push({ type: content.type, tweetId: tweet.data.id, at: new Date().toISOString() });
    } catch (e) {
      console.log("Tweet error:", e.message?.slice(0, 60));
    }
  }

  // Also post to Farcaster if it's not a thread
  if (neynarKey && signerUuid && content.type !== "thread" && !dryRun) {
    // Pick channel based on content type for better targeting
    const CHANNEL_MAP = {
      tweet: ["base", "defi", "memecoins"],
      agent_pitch: ["agents", "ai", "crypto-ai", "base-builders"],
      farcaster: ["defi", "base", "onchain"],
      agent_reply: ["agents", "ai"],
      heartbeat_report: ["defi", "base", "climate", "impact"],
    };
    const channels = CHANNEL_MAP[content.type] || ["defi"];
    const channel = channels[Math.floor(Math.random() * channels.length)];

    try {
      // Farcaster allows longer posts, use full content
      const fcText = content.content.length > 1024 ? content.content.slice(0, 1021) + "..." : content.content;
      await fetch("https://api.neynar.com/v2/farcaster/cast", {
        method: "POST",
        headers: {
          api_key: neynarKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          signer_uuid: signerUuid,
          text: fcText,
          channel_id: channel,
        }),
      });
      log.posted.push({ type: content.type, platform: "farcaster", channel, at: new Date().toISOString() });
      console.log(`  Posted to Farcaster /${channel}`);
    } catch (e) {
      console.log("Farcaster post error:", e.message?.slice(0, 60));
    }
  }

  if (dryRun) {
    log.posted.push({ type: content.type, dryRun: true, at: new Date().toISOString() });
  }

  saveLog(log);
}

// Run standalone
if (require.main === module) {
  runOutreach({ dryRun: true }).catch(console.error);
}

module.exports = { runOutreach, postContent, generateReply, searchX, searchFarcaster };
