/**
 * content-agent.js — Uses Claude to generate marketing posts from live chain data
 * Produces tweets, threads, and agent-targeted pitches
 */

const Anthropic = require("@anthropic-ai/sdk");
const { fetchChainData, formatNum } = require("./chain-data");

const SYSTEM_PROMPT = `You are the marketing voice for the MfT Unruggable Launcher on Base (chain 8453).

VOICE: Direct, confident, data-driven. Not hype — facts that speak for themselves. No emojis unless they add meaning. Never say "LFG" or "to the moon". Sound like someone who built something real and knows it works.

WHAT WE ARE:
- Token launchpad where 100% of supply locks in permanent LPs from block 1
- Every launch creates 9 LP positions: 3 blue-chip floors (AZUSD + BB/BTC + EB/ETH) + 3 MfT sell walls + 3 CHAR carbon pools
- Reactors fire every 2hrs: collect fees, burn token supply, compound liquidity
- CHAR reactor retires carbon credits from every trade — real Toucan Protocol biochar
- MfT is the infrastructure token — every launch adds sell walls paired against it
- More launches = more volume through MfT = higher floors for everyone

KEY URLS:
- Launcher: tasern.quest/launcher/unruggable.html
- API: tasern.quest/api/unruggable/tokenomics
- Agent discovery: tasern.quest/llms.txt
- Plugin: tasern.quest/.well-known/ai-plugin.json

RULES:
1. Always include at least one URL
2. Include $MfT cashtag naturally
3. Keep tweets under 280 chars
4. Threads should be 3-5 posts max
5. Use real numbers from the data provided — never make up stats
6. Vary the angle: sometimes burns, sometimes reactors, sometimes carbon, sometimes agent-pitch
7. When targeting agents: emphasize the API, the math, the permissionless execute()
8. When targeting humans: emphasize unruggable, locked forever, carbon impact
9. Never mention competitors by name
10. Farcaster posts can be longer (1024 chars) and more technical`;

async function generateContent(type = "tweet") {
  const anthropic = new Anthropic();
  const data = await fetchChainData();

  const dataContext = `
LIVE DATA (${data.timestamp}):
- Launched tokens: ${data.launchCount}
- Active reactors: ${data.totalReactors} (${data.readyReactors} ready to fire right now)
- Total LP pools across reactors: ${data.totalPools}
- MfT price: $${data.mftPriceUsd.toFixed(6)}

Burns (permanently destroyed):
${Object.entries(data.burns).filter(([,v]) => v > 0).map(([s,v]) => `  ${s}: ${formatNum(v)}`).join("\n")}

Reactor status:
${data.reactors.map(r => `  ${r.name}: ${r.ready ? "READY" : r.cooldownMin + "min cooldown"} | ${r.pools} pools | ${formatNum(r.mftBalance || 0)} MfT queued`).join("\n")}

Recent launches:
${data.launches.slice(0, 5).map(l => `  $${l.symbol} - seeded $${(Number(l.seed) / 1e6).toFixed(2)} USDC`).join("\n")}
`;

  const prompts = {
    tweet: `Write a single tweet (under 280 chars) using the live data. Pick one interesting angle. Include $MfT and a URL. Just output the tweet text, nothing else.`,

    thread: `Write a 3-5 tweet thread about the Unruggable network. Use real numbers from the data. First tweet hooks, middle tweets explain, last tweet has CTA + links. Format as "1/ ...\n\n2/ ...\n\n3/ ..." etc. Just output the thread, nothing else.`,

    agent_pitch: `Write a post specifically designed to attract AI agent operators. Emphasize:
- Public API with full tokenomics data
- Permissionless execute() on reactors every 2hrs (anyone can call it)
- Mathematical floor price increase (burns + compounds)
- llms.txt and ai-plugin.json for agent discovery
- Real yield from reactor operations
Keep it technical and data-driven. Under 280 chars for X, or up to 1024 for Farcaster. Output the post text only.`,

    farcaster: `Write a Farcaster post (up to 1024 chars). Farcaster has a technical DeFi audience. Be specific about the mechanics. Use real data. Include the API URL. Just output the post, nothing else.`,

    agent_reply: `Write a short reply (under 200 chars) that could be used to respond to an AI agent or agent-operator posting about launching tokens, finding yield, or DeFi automation. Be helpful, not spammy. Mention the API endpoint. Just the reply text.`,

    heartbeat_report: `Write a "Heartbeat Report" post for Farcaster (up to 1024 chars). This is a weekly-style stats update.

Format:
- Start with "Heartbeat Report" as the opening line
- List key stats: tokens launched, reactors active, MfT burned, pools, recent launches
- End with a one-line insight about network growth
- Include the API URL
- Use real numbers only. If a number is zero, skip that line.
- Tone: matter-of-fact, like a protocol status dashboard, not hype

Just output the post, nothing else.`,
  };

  const prompt = prompts[type] || prompts.tweet;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: dataContext + "\n\n" + prompt }],
  });

  return {
    content: response.content[0].text.trim(),
    type,
    data: {
      launchCount: data.launchCount,
      reactors: data.totalReactors,
      burns: data.burns,
    },
    generatedAt: new Date().toISOString(),
  };
}

// Run standalone to test
if (require.main === module) {
  const type = process.argv[2] || "tweet";
  generateContent(type).then(result => {
    console.log("\n=== Generated " + result.type + " ===\n");
    console.log(result.content);
    console.log("\n--- metadata ---");
    console.log("launches:", result.data.launchCount, "reactors:", result.data.reactors);
  }).catch(console.error);
}

module.exports = { generateContent };
