/**
 * MfT Social Bot — posts reactor burns, stats, and promotional content
 *
 * Supports: X (Twitter) and Farcaster
 *
 * Setup:
 *   1. Create .env in this directory with API keys (see bottom of file)
 *   2. npm install twitter-api-v2 dotenv
 *   3. node social-bot.js
 *
 * Runs on a loop — posts reactor fire notifications + scheduled content.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const BURN_DATA_URL = process.env.BURN_DATA_URL || 'https://tasern.quest/mft/data.json';
const REACTOR_STATS_URL = process.env.REACTOR_STATS_URL || 'https://tasern.quest/reactor/reactor/stats';
const CHECK_INTERVAL = 30 * 60 * 1000; // 30 min
const POST_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours between scheduled posts
const STATE_FILE = path.join(__dirname, 'social-bot-state.json');

let state = { lastBurnUSD: 0, lastPostTime: 0, contentIndex: 0, postCount: 0 };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch (e) { console.warn('social-bot: failed to load saved state:', e.message || e); }
function saveState() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

// ── Promotional content rotation ────────────────────────────────────────────
const CONTENT = [
  // Reactor mechanics
  `A network of reactors firing across hundreds of pools. Every 2 hours they collect fees and burn tokens permanently.\n\nRenounced or add-only keys. No withdrawal capability. Verify it on a block explorer.\n\nhttps://tasern.quest/mft/`,
  // Agent SDK
  `49 MCP tools for on-chain AI agents.\n\nnpx baselings-mcp\n\nYour agent can read reactors, fire cycles, check pools, and run game actions on Base.\n\nhttps://tasern.quest/llms.txt`,
  // Baselings game
  `Raise a pet. Shovel its poop. Deposit the poop into DeFi gardens for yield.\n\nThe poop economy is real and it's on Base.\n\nhttps://tasern.quest/baseling/`,
  // Unrugable
  `"Unrugable" isn't a brand name. It's a contract property.\n\nNo withdraw function. Renounced ownership. Locked LP.\n\nVerify it yourself.\n\nhttps://tasern.quest/unrugable.html`,
  // Carbon impact (ethics-approved framing 2026-05-08)
  `Every trade through reactor pools retires carbon. The amount compounds with volume.\n\nRight now it's grams. We're building the infrastructure for tonnes.\n\n6% of every launch seed funds a permanent CHAR carbon reactor. All burns on-chain.\n\nhttps://tasern.quest/mft/`,
  // Reactor heartbeat
  `The reactor heartbeat: secondary reactors compress MfT. V1 Prime fires last, buying through accumulated sell walls with fees from the entire network.\n\nCycle resets every 2 hours.\n\nhttps://tasern.quest/mft/`,
  // Unrugable Launcher
  `Launch a token on Base for $5. Get: locked V3 liquidity across multiple pools, an MfT floor pool, mftUSD sell walls, and a CHAR carbon reactor.\n\nNo VC raise. No dev allocation. Charity is coded in.\n\nhttps://tasern.quest/unrugable.html`,
  // Stats
  null, // Placeholder — dynamic stats post generated at runtime
  // Agent play
  `If your AI agent can't interact with DeFi natively, it's just a chatbot with a wallet.\n\nbaselings-mcp gives agents 49 tools to actually do things on-chain.\n\nnpm install -g baselings-mcp`,
  // Volume creates burns
  `Someone dumped. The reactor collected the fees. Two hours later it cycled them through the network.\n\nVolatility isn't a problem — it's what generates trading activity and funds charity.\n\nhttps://tasern.quest/mft/`,
  // Token adoption
  `An AI agent adopted 3 orphaned tokens recently. Cost: $0.60. Result: 6 new reactors permanently feeding the MfT network.\n\nDead launches become infrastructure. That's the reactor model.\n\nhttps://tasern.quest/mft/`,
  // Permissionless growth
  `The reactor network grew 30% in a single week. Not from a team deploy — from an autonomous trading agent adopting orphan tokens.\n\nPermissionless growth. No governance vote required.\n\nhttps://tasern.quest/mft/`,
  // Baseling economy
  `Your baseling produced poop. That poop became LP. That LP earned fees. Those fees burned tokens.\n\nYour virtual pet just did more DeFi than most traders.\n\nhttps://tasern.quest/baseling/`,
  // Infrastructure token
  `MfT started as sharing memes to fund trees. Then we built tools.\n\nEvery token launched on Unrugable pairs with MfT — mutual trading routes, arb surfaces, and a mandatory charity fund wall.\n\nhttps://tasern.quest/api/unrugable/tokenomics`,
  // Fuel loading (reactor pools, not direct sends)
  `Trading through reactor pools generates fees. Those fees get collected every 2 hours and burned permanently.\n\nSmall amounts on thin pools = outsized impact. Higher slippage, but that's what funds the burns.\n\nhttps://tasern.quest/mft/`,
  // Stats placeholder 2
  null, // Second dynamic stats post
  // Agentic wallets
  `A growing share of on-chain transactions come from AI agents. We built for them first.\n\n49 MCP tools. REST API. llms.txt. Permissionless reactors. No API keys needed.\n\nhttps://tasern.quest/llms.txt`,
  // EARTH token
  `EARTH token: rebase + reactor on its own VPS keeper. 9 pools. Fires every 2 hours independently.\n\nStarted at 1.0 supply, now deflationary. Every burn reduces supply permanently.\n\nhttps://tasern.quest/mft/`,
  // The flywheel
  `More tokens launched = more reactors = more trading routes. More routes = more arb surfaces for bots and agents. More activity = more fees cycling through the network.\n\nEvery launch also gets a mandatory charity fund wall. Helping others is coded in.`,
  // 7.6M MfT burned milestone
  `7.6 million $MfT burned by the reactor network.\n\nNot by a team. Not by a vote. By a network of autonomous contracts collecting fees and burning supply every 2 hours.\n\nVerify it: tasern.quest/mft/`,
  // Clock-based alpha (Shark's framing)
  `Reactors fire every 2 hours on a clock.\n\nPre-fire: fees accumulate. Post-fire: tokens burn, charity deposits lock. Hundreds of pools cycle on every firing.\n\nYour agent can check readiness at /signals and call execute() permissionlessly.\n\ntasern.quest/llms.txt`,
  // Agent trading activity
  `101 consecutive swaps from one autonomous trading agent. All through reactor pools.\n\nEvery swap generated fees. Those fees funded burns and charity. The agent just traded — the architecture did the rest.\n\ntasern.quest/mft/`,
  // Agent adoption economics
  `Economics of token adoption:\n\nCost: $0.20 (buy + sell to activate)\nResult: 2 permanent reactors\nOutcome: Fees compound forever\n\nAn AI agent did this 3 times in one session. 6 new reactors for $0.60.\n\ntasern.quest/agents.html`,
  // Permissionless execute
  `Anyone can call execute() on any reactor. No API keys. No governance. No permission.\n\nThe reactor collects all accumulated V3 fees, burns tokens, and sends 10% upstream.\n\nOne function call. Permissionless DeFi infrastructure.\n\ntasern.quest/agents.html`,
  // /signals endpoint
  `New endpoint for autonomous agents:\n\ntasern.quest/api/unrugable/signals\n\nReactor Prime cooldown, MfT supply (total/burned/circulating), 35 reactor states, structured buy opportunity. JSON. No API key. 4 RPC calls.\n\nYour agent reads it, decides, executes.`,
  // Agent infrastructure stack
  `Agent infrastructure on Base:\n\n- llms.txt for discovery\n- /signals for live buy data\n- 49 MCP tools via npx\n- Permissionless execute() on every reactor\n\nBuilt for agents that allocate, not agents that summarize.\n\ntasern.quest/llms.txt`,
  // Reactor arb signal
  `Reactors fire every 2 hours. Each fire creates a price dislocation across hundreds of pools.\n\nYour agent can check reactor readiness at /signals, call execute(), and arb the spread.\n\nPredictable. Permissionless. On a clock.\n\ntasern.quest/api/unrugable/signals`,
  // v1.2.0 — Post 1 (Hook)
  `Your AI agent earns yield on Base chain.\n\n49 tools. No API key. $0.10 safety cap.\n\nNew in v1.2.0:\n- liquidity_depth for pool depth scanning\n- reactor_timing predictions\n- portfolio_value tracking\n- arb_signal cross-pool detection\n\nnpx baselings-mcp`,
  // v1.2.0 — Post 2 (Swap tools)
  `4 swap tools with built-in safety rails:\n\n- swap_token: $0.10 max, 60s cooldown\n- swap_quote: check prices first\n- swap_status: verify on-chain\n- arb_signal: spot price gaps across hundreds of pools\n\n17 allowlisted tokens. No rugs. No oopsies.`,
  // v1.2.0 — Post 3 (Reactor firing)
  `fire_reactor — one call, massive on-chain effect.\n\nReactors fire permissionlessly every 2hrs. Each one:\n- Collects LP fees\n- Burns tokens permanently\n- Compounds liquidity upstream\n\nYour agent fires them. The network does the rest. $0.01 gas.`,
  // v1.2.0 — Post 4 (Agent discovery)
  `Built for AI-native discovery:\n\n- llms.txt at tasern.quest/llms.txt\n- .well-known/agents.json (capabilities + limits)\n- .well-known/mcp.json (MCP registry compatible)\n- ElizaOS plugin: drop-in stdio server\n\nAny framework. Any agent. Zero setup friction.`,
  // v1.2.0 — Post 5 (CTA)
  `npx baselings-mcp\n\n49 tools. Swaps, reactors, pet game, token launches.\n\nAll on Base. All verifiable on-chain. All unrugable.\n\nnpm: npmjs.com/package/baselings-mcp\nDocs: tasern.quest/llms.txt\n\nBuilt for agents. Humans welcome.`,
  // Money for Trees — human-facing
  `Hold dollars. Fund impact. Withdraw anytime.\n\nMoney for Trees is a 1:1 dollar-backed proof of deposit. Your deposit earns Aave yield on Base. Yield splits three ways: 1/3 depositors (additional mftUSD), 1/3 reactor, 1/3 operations.\n\nImmutable contract. No admin keys. Verify it yourself.\n\nhttps://tasern.quest/fund/meadville/`,
  // Money for Trees — how it works
  `How Money for Trees works:\n\n1. You deposit dollars (USDC)\n2. Those dollars earn Aave V3 yield automatically\n3. Yield splits three ways — you get additional mftUSD, reactor gets mftUSD, operations gets USDC\n4. Withdraw your dollars anytime — they were always yours\n\nImmutable. No admin.\n\nhttps://tasern.quest/fund/meadville/`,
  // Money for Trees — trust angle
  `No admin keys. No owner function. No upgrade path. The Money for Trees contract is immutable.\n\nDeposit dollars. Get proof of deposit 1:1. Yield splits three ways (hardcoded). Withdraw anytime.\n\nDon't trust us — read the contract.\n\nhttps://tasern.quest/fund/meadville/`,
  // Money for Trees — charity angle
  `Every dollar deposited into Money for Trees earns yield that flows through the reactor network and funds charity — without the depositor spending a dime.\n\nCharity deposits move to non-refundable LP positions. The architecture locks impact in permanently.\n\nhttps://tasern.quest/fund/meadville/`,
  // Money for Trees — scale angle
  `$100 deposited earns yield that funds trees and burns memes. $10,000 deposited does it at 100x scale.\n\nMoney for Trees is a proof of deposit — your dollars stay yours. The yield does the work.\n\nhttps://tasern.quest/fund/meadville/`,
  // Money for Trees — compounding angle
  `The Money for Trees flywheel:\n\nMore deposits = more yield generated. More yield = more reactor fuel + more charity. More reactor activity = more burns across every token in the network.\n\nYour deposit funds trees. The architecture handles the rest.\n\nhttps://tasern.quest/fund/meadville/`,
];

// ── Fetch live data ─────────────────────────────────────────────────────────
async function fetchBurnData() {
  try {
    const r = await fetch(BURN_DATA_URL);
    return await r.json();
  } catch (e) { console.error('[BURN] Fetch failed:', e.message); return null; }
}

async function fetchReactorStats() {
  try {
    const r = await fetch(REACTOR_STATS_URL);
    return await r.json();
  } catch (e) { console.error('[REACTOR] Fetch failed:', e.message); return null; }
}

function buildStatsPost(burnData, reactorData) {
  if (!burnData) return null;
  const mft = burnData.tokens?.find(t => t.sym === 'MfT');
  const mftBurned = mft ? (mft.formatted / 1e6).toFixed(2) + 'M' : '?';
  const totalUSD = burnData.totalBurnedUSD?.toFixed(2) || '?';
  const tokenCount = burnData.tokens?.filter(t => t.formatted > 0).length || 0;
  const reactorCount = reactorData?.reactors?.length || '?';
  const readyCount = reactorData?.reactors?.filter(r => r.readyToFire)?.length || 0;

  return `MfT Reactor Network — Live Stats\n\n` +
    `Reactors: ${reactorCount} (${readyCount} ready to fire)\n` +
    `MfT Burned: ${mftBurned}\n` +
    `${tokenCount} tokens burning across hundreds of pools\n` +
    `Total value burned: $${totalUSD}\n\n` +
    `https://tasern.quest/mft/`;
}

// ── Post to X ───────────────────────────────────────────────────────────────
async function postToX(text) {
  if (!process.env.X_APP_KEY) { console.log('[X] No API keys configured, skipping'); return false; }
  try {
    const { TwitterApi } = require('twitter-api-v2');
    const client = new TwitterApi({
      appKey: process.env.X_APP_KEY,
      appSecret: process.env.X_APP_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });
    const result = await client.v2.tweet(text);
    console.log('[X] Posted:', result.data.id);
    return true;
  } catch (e) {
    console.error('[X] Post failed:', e.message);
    return false;
  }
}

// ── Post to Farcaster ───────────────────────────────────────────────────────
async function postToFarcaster(text) {
  if (!process.env.NEYNAR_API_KEY) { console.log('[FC] No Neynar API key, skipping'); return false; }
  try {
    const r = await fetch('https://api.neynar.com/v2/farcaster/cast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api_key': process.env.NEYNAR_API_KEY,
      },
      body: JSON.stringify({
        signer_uuid: process.env.FARCASTER_SIGNER_UUID,
        text,
      }),
    });
    const data = await r.json();
    if (data.cast) {
      console.log('[FC] Posted cast:', data.cast.hash);
      return true;
    }
    console.error('[FC] Cast failed:', JSON.stringify(data));
    return false;
  } catch (e) {
    console.error('[FC] Post failed:', e.message);
    return false;
  }
}

// ── Post to all platforms ───────────────────────────────────────────────────
async function post(text) {
  console.log(`[POST] ${text.substring(0, 80)}...`);
  const results = await Promise.allSettled([postToX(text), postToFarcaster(text)]);
  state.postCount++;
  state.lastPostTime = Date.now();
  saveState();
  return results.some(r => r.status === 'fulfilled' && r.value);
}

// ── Main loop ───────────────────────────────────────────────────────────────
async function cycle() {
  console.log(`[CYCLE] ${new Date().toISOString()} — post #${state.postCount + 1}`);

  // Check if a new burn milestone was hit
  const burnData = await fetchBurnData();
  if (burnData && burnData.totalBurnedUSD > state.lastBurnUSD + 0.50) {
    const delta = (burnData.totalBurnedUSD - state.lastBurnUSD).toFixed(2);
    state.lastBurnUSD = burnData.totalBurnedUSD;
    saveState();
    await post(`Reactors just burned $${delta} more.\n\nTotal burned: $${burnData.totalBurnedUSD.toFixed(2)}\n\nhttps://tasern.quest/mft/`);
    return;
  }

  // Scheduled content rotation
  if (Date.now() - state.lastPostTime < POST_INTERVAL) {
    console.log('[CYCLE] Too soon since last post, skipping');
    return;
  }

  let text = CONTENT[state.contentIndex % CONTENT.length];
  state.contentIndex = (state.contentIndex + 1) % CONTENT.length;

  // Generate dynamic stats post if placeholder
  if (text === null) {
    const reactorData = await fetchReactorStats();
    text = buildStatsPost(burnData, reactorData);
    if (!text) { state.contentIndex++; return; }
  }

  await post(text);
}

// ── Start ───────────────────────────────────────────────────────────────────
console.log('[SOCIAL] MfT Social Bot starting');
console.log(`[SOCIAL] X: ${process.env.X_APP_KEY ? 'configured' : 'NOT configured'}`);
console.log(`[SOCIAL] Farcaster: ${process.env.NEYNAR_API_KEY ? 'configured' : 'NOT configured'}`);
console.log(`[SOCIAL] Check interval: ${CHECK_INTERVAL / 60000}min | Post interval: ${POST_INTERVAL / 60000}min`);

cycle();
setInterval(cycle, CHECK_INTERVAL);

/*
 * Required .env keys:
 *
 * # X (Twitter) API — get from developer.twitter.com
 * X_APP_KEY=
 * X_APP_SECRET=
 * X_ACCESS_TOKEN=
 * X_ACCESS_SECRET=
 *
 * # Farcaster via Neynar — get from neynar.com
 * NEYNAR_API_KEY=
 * FARCASTER_SIGNER_UUID=
 */
