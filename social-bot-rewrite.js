/**
 * MfT Social Bot — posts reactor burns, stats, promotional content, and launch announcements
 *
 * Features:
 *   - Alternates between engage-queue.json and built-in CONTENT[]
 *   - Auto-posts new token launches from /tmp/reactor-map-trigger
 *   - Attaches images to every post (sprites for baseling, memes for everything else)
 *   - Posts to X (Twitter) and Farcaster
 *
 * Setup:
 *   1. Create .env in this directory with API keys (see bottom of file)
 *   2. npm install twitter-api-v2 dotenv
 *   3. node social-bot.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const BURN_DATA_URL = process.env.BURN_DATA_URL || 'https://tasern.quest/mft/data.json';
const REACTOR_STATS_URL = process.env.REACTOR_STATS_URL || 'https://tasern.quest/reactor/reactor/stats';
const CHECK_INTERVAL = 30 * 60 * 1000;   // 30 min
const POST_INTERVAL  = 4 * 60 * 60 * 1000; // 4 hours between scheduled posts

const STATE_FILE          = path.join(__dirname, 'social-bot-state.json');
const QUEUE_FILE          = path.join(__dirname, 'engage-queue.json');
const LAUNCH_TRIGGER_FILE = '/tmp/reactor-map-trigger';
const SPRITE_DIR          = path.join(__dirname, 'images', 'sprites');
const MEME_DIR            = path.join(__dirname, 'images', 'memes');
const OG_LAUNCHER         = '/var/www/tasern/launcher/og-launcher.png';

// ── State ───────────────────────────────────────────────────────────────────
let state = { lastBurnUSD: 0, lastPostTime: 0, contentIndex: 0, queueIndex: 0, postCount: 0 };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch (e) { console.warn('[social-bot] failed to load state:', e.message || e); }
function saveState() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

// ── Engage queue ────────────────────────────────────────────────────────────
function loadQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); }
  catch (e) { return []; }
}

function getNextQueuePost() {
  const queue = loadQueue();
  if (!queue.length) return null;
  const idx = state.queueIndex % queue.length;
  state.queueIndex = (state.queueIndex + 1) % queue.length;
  return queue[idx];
}

// ── Launch announcements ────────────────────────────────────────────────────
function checkNewLaunch() {
  try {
    if (!fs.existsSync(LAUNCH_TRIGGER_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(LAUNCH_TRIGGER_FILE, 'utf8'));
    fs.unlinkSync(LAUNCH_TRIGGER_FILE);
    const name = data.fullName || data.name || 'New Token';
    const sym  = data.name || '???';
    const token = data.token;
    return {
      text: `New token launched on Unrugable:\n\n${name} ($${sym})\n\nCA: ${token}\n\nLocked liquidity. Reactor live. Buy+burn every 2 hours.\n\ntasern.quest/launcher/`,
      type: 'launch'
    };
  } catch (e) { return null; }
}

// ── Image picker ────────────────────────────────────────────────────────────
function pickImage(type) {
  let dir;
  if (type === 'baselings') {
    dir = SPRITE_DIR;
  } else {
    dir = MEME_DIR;
  }

  try {
    const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
    if (files.length) {
      return path.join(dir, files[Math.floor(Math.random() * files.length)]);
    }
  } catch (e) { console.warn('[social-bot] failed to read image dir:', e.message || e); }

  // Fallback: try og-launcher for non-baseling, or sprites for baseling
  if (type !== 'baselings' && fs.existsSync(OG_LAUNCHER)) return OG_LAUNCHER;

  // Last resort: try whichever dir we didn't try
  const fallbackDir = dir === SPRITE_DIR ? MEME_DIR : SPRITE_DIR;
  try {
    const files = fs.readdirSync(fallbackDir).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
    if (files.length) {
      return path.join(fallbackDir, files[Math.floor(Math.random() * files.length)]);
    }
  } catch (e) { console.warn('[social-bot] failed to read fallback dir:', e.message || e); }

  return null;
}

// ── Promotional content rotation ────────────────────────────────────────────
const CONTENT = [
  `35+ reactors. 180+ pools. Every 2 hours they fire, collect fees, and burn tokens permanently.\n\nRenounced or add-only keys. No withdrawal capability. Verify it on a block explorer.\n\nhttps://tasern.quest`,
  `49 MCP tools for on-chain AI agents.\n\nnpx baselings-mcp\n\nYour agent can read reactors, fire cycles, check pools, and run game actions on Base.\n\nhttps://tasern.quest`,
  `Raise a pet. Shovel its poop. Deposit the poop into DeFi gardens for yield.\n\nThe poop economy is real and it's on Base.\n\nhttps://tasern.quest`,
  `"Unrugable" isn't a brand name. It's a contract property.\n\nNo withdraw function. Renounced ownership. Locked LP.\n\nVerify it yourself.\n\nhttps://tasern.quest`,
  `Every trade through reactor pools retires carbon. The amount compounds with volume.\n\nToday it's grams. We're building the infrastructure for tonnes.\n\n6% of every launch seed funds a permanent CHAR carbon reactor. All burns on-chain.\n\nhttps://tasern.quest`,
  `The reactor heartbeat: secondary reactors compress MfT. V1 Prime fires last, buying through accumulated sell walls with fees from the entire network.\n\nCycle resets every 2 hours.\n\nhttps://tasern.quest`,
  `Launch a token on Base for $5. Get: locked V3 liquidity, 8 LP positions, reactor integration, automated buy+burn every 2 hours.\n\nNo VC raise. No dev allocation drama.\n\nhttps://tasern.quest`,
  null, // dynamic stats
  `If your AI agent can't interact with DeFi natively, it's just a chatbot with a wallet.\n\nbaselings-mcp gives agents 49 tools to actually do things on-chain.\n\nnpm install -g baselings-mcp`,
  `Someone dumped. The reactor collected the fees. Two hours later it bought back harder than the dump.\n\nVolatility isn't a problem — it's fuel.\n\nhttps://tasern.quest`,
  `An AI agent adopted 3 orphaned tokens this week. Cost: $0.60. Result: 6 new reactors permanently feeding the MfT network.\n\nDead launches become infrastructure. That's the reactor model.\n\nhttps://tasern.quest`,
  `The reactor network grew 30% this week. Not from a team deploy — from an autonomous trading agent adopting orphan tokens.\n\nPermissionless growth. No governance vote required.\n\nhttps://tasern.quest`,
  `Your baseling produced poop. That poop became LP. That LP earned fees. Those fees burned tokens.\n\nYour virtual pet just did more DeFi than most traders.\n\nhttps://tasern.quest`,
  `MfT, cbBTC, and WETH are infrastructure tokens for the Unrugable network.\n\nEvery meme launched creates floor pools paired against them. More launches = more volume = higher floors.\n\nhttps://tasern.quest`,
  `Trading through reactor pools generates fees. Those fees get collected every 2 hours and burned permanently.\n\nSmall amounts on thin pools = outsized impact. Higher slippage, but that's what funds the burns.\n\nhttps://tasern.quest`,
  null, // dynamic stats
  `A growing share of on-chain transactions come from AI agents. We built for them first.\n\n49 MCP tools. REST API. llms.txt. Permissionless reactors. No API keys needed.\n\nhttps://tasern.quest`,
  `EARTH token: rebase + reactor on its own VPS keeper. 9 pools. Fires every 2 hours independently.\n\nStarted at 1.0 supply, now deflationary. Every burn reduces supply permanently.\n\nhttps://tasern.quest`,
  `More tokens launched = more reactors = more fuel to Prime. More fuel = bigger MfT buy pressure each cycle. Buy pressure activates sell walls across every token.\n\nThe flywheel compounds. Every launch strengthens the whole network.`,
  `7.6 million $MfT burned by the reactor network.\n\nNot by a team. Not by a vote. By 37 autonomous contracts collecting fees and burning supply every 2 hours.\n\nVerify it: tasern.quest`,
  `35+ reactors fire every 2 hours on a clock.\n\nPre-fire: accumulate. Post-fire: distribute. 180+ pools shift price on every cycle.\n\nThis isn't speculation — it's a scheduled buy event. Your agent can time it.\n\ntasern.quest`,
  `101 consecutive buy swaps. 101 green candles on the MfT chart. All from one autonomous trading agent doing its thing.\n\nThe heartbeat is real and it shows up on the chart.\n\ntasern.quest`,
  `Economics of token adoption:\n\nCost: $0.20 (buy + sell to activate)\nResult: 2 permanent reactors\nOutcome: Fees compound forever\n\nAn AI agent did this 3 times yesterday. 6 new reactors for $0.60.\n\ntasern.quest`,
  `Anyone can call execute() on any reactor. No API keys. No governance. No permission.\n\nThe reactor collects all accumulated V3 fees, burns tokens, and sends 10% upstream.\n\nOne function call. Permissionless DeFi infrastructure.\n\ntasern.quest`,
  `New endpoint for autonomous agents:\n\ntasern.quest\n\nReactor Prime cooldown, MfT supply (total/burned/circulating), 35 reactor states, structured buy opportunity. JSON. No API key. 4 RPC calls.\n\nYour agent reads it, decides, executes.`,
  `Agent infrastructure on Base:\n\n- llms.txt for discovery\n- /signals for live buy data\n- 49 MCP tools via npx\n- Permissionless execute() on 35+ reactors\n\nBuilt for agents that allocate, not agents that summarize.\n\ntasern.quest`,
  `35 reactors fire every 2 hours. Each fire creates a price dislocation across 180+ pools.\n\nYour agent can check reactor readiness at /signals, call execute(), and arb the spread.\n\nPredictable. Permissionless. On a clock.\n\ntasern.quest`,
  `Your AI agent earns yield on Base chain.\n\n49 tools. No API key. $0.10 safety cap.\n\nNew in v1.2.0:\n- liquidity_depth for pool depth scanning\n- reactor_timing predictions\n- portfolio_value tracking\n- arb_signal cross-pool detection\n\nnpx baselings-mcp`,
  `4 swap tools with built-in safety rails:\n\n- swap_token: $0.10 max, 60s cooldown\n- swap_quote: check prices first\n- swap_status: verify on-chain\n- arb_signal: spot price gaps across 180+ pools\n\n17 allowlisted tokens. No rugs. No oopsies.`,
  `fire_reactor — one call, massive on-chain effect.\n\n35+ reactors fire permissionlessly every 2hrs. Each one:\n- Collects LP fees\n- Burns tokens permanently\n- Compounds liquidity upstream\n\nYour agent fires them. The network does the rest. $0.01 gas.`,
  `Built for AI-native discovery:\n\n- llms.txt at tasern.quest\n- .well-known/agents.json (capabilities + limits)\n- .well-known/mcp.json (MCP registry compatible)\n- ElizaOS plugin: drop-in stdio server\n\nAny framework. Any agent. Zero setup friction.`,
  `npx baselings-mcp\n\n49 tools. Swaps, reactors, pet game, token launches.\n\nAll on Base. All verifiable on-chain. All unrugable.\n\nnpm: npmjs.com/package/baselings-mcp\nDocs: tasern.quest\n\nBuilt for agents. Humans welcome.`,
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
  const reactorCount = reactorData?.reactors?.length || 37;
  const readyCount = reactorData?.reactors?.filter(r => r.readyToFire)?.length || 0;

  return `MfT Reactor Network — Live Stats\n\n` +
    `Reactors: ${reactorCount} (${readyCount} ready to fire)\n` +
    `MfT Burned: ${mftBurned}\n` +
    `${tokenCount} tokens burning across 180+ pools\n` +
    `Total value burned: $${totalUSD}\n\n` +
    `https://tasern.quest`;
}

// ── Post to X (with image) ──────────────────────────────────────────────────
async function postToX(text, imagePath) {
  if (!process.env.X_APP_KEY) { console.log('[X] No API keys configured, skipping'); return false; }
  try {
    const { TwitterApi } = require('twitter-api-v2');
    const client = new TwitterApi({
      appKey:       process.env.X_APP_KEY,
      appSecret:    process.env.X_APP_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    let mediaIds;
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        const mediaId = await client.v1.uploadMedia(imagePath);
        mediaIds = [mediaId];
        console.log('[X] Uploaded image:', path.basename(imagePath));
      } catch (imgErr) {
        console.error('[X] Image upload failed:', imgErr.message, '— posting without image');
      }
    }

    const tweetData = { text };
    if (mediaIds && mediaIds.length) tweetData.media = { media_ids: mediaIds };

    const result = await client.v2.tweet(tweetData);
    console.log('[X] Posted:', result.data.id, imagePath ? `(image: ${path.basename(imagePath)})` : '(no image)');
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
async function post(text, imagePath) {
  console.log(`[POST] ${text.substring(0, 80)}...`);
  if (imagePath) console.log(`[POST] Image: ${path.basename(imagePath)}`);
  const results = await Promise.allSettled([postToX(text, imagePath), postToFarcaster(text)]);
  state.postCount++;
  state.lastPostTime = Date.now();
  saveState();
  return results.some(r => r.status === 'fulfilled' && r.value);
}

// ── Main cycle ──────────────────────────────────────────────────────────────
async function cycle() {
  console.log(`[CYCLE] ${new Date().toISOString()} — post #${state.postCount + 1}`);

  // 1. Check burn milestone
  const burnData = await fetchBurnData();
  if (burnData && burnData.totalBurnedUSD > state.lastBurnUSD + 0.50) {
    const delta = (burnData.totalBurnedUSD - state.lastBurnUSD).toFixed(2);
    state.lastBurnUSD = burnData.totalBurnedUSD;
    saveState();
    const img = pickImage('info');
    await post(`Reactors just burned $${delta} more.\n\nTotal burned: $${burnData.totalBurnedUSD.toFixed(2)}\n\nhttps://tasern.quest`, img);
    return;
  }

  // 2. Check for new launch announcement (priority)
  const launch = checkNewLaunch();
  if (launch) {
    const img = fs.existsSync(OG_LAUNCHER) ? OG_LAUNCHER : pickImage('launch');
    await post(launch.text, img);
    return;
  }

  // 3. Respect post interval
  if (Date.now() - state.lastPostTime < POST_INTERVAL) {
    console.log('[CYCLE] Too soon since last post, skipping');
    return;
  }

  // 4. Alternate: even posts from queue, odd from CONTENT
  let text, type;

  if (state.postCount % 2 === 0) {
    // Queue post
    const queueItem = getNextQueuePost();
    if (queueItem) {
      text = queueItem.text;
      type = queueItem.type || 'info';
    } else {
      // Fallback to CONTENT if queue is empty
      text = CONTENT[state.contentIndex % CONTENT.length];
      type = 'info';
      state.contentIndex = (state.contentIndex + 1) % CONTENT.length;
    }
  } else {
    // CONTENT post
    text = CONTENT[state.contentIndex % CONTENT.length];
    type = 'info';
    state.contentIndex = (state.contentIndex + 1) % CONTENT.length;
  }

  // Handle dynamic stats placeholder
  if (text === null) {
    const reactorData = await fetchReactorStats();
    text = buildStatsPost(burnData, reactorData);
    type = 'info';
    if (!text) {
      console.log('[CYCLE] Stats post failed, skipping');
      return;
    }
  }

  // Pick image based on post type
  const img = pickImage(type);
  await post(text, img);
}

// ── Start ───────────────────────────────────────────────────────────────────
console.log('[SOCIAL] MfT Social Bot starting');
console.log(`[SOCIAL] X: ${process.env.X_APP_KEY ? 'configured' : 'NOT configured'}`);
console.log(`[SOCIAL] Farcaster: ${process.env.NEYNAR_API_KEY ? 'configured' : 'NOT configured'}`);
console.log(`[SOCIAL] Check interval: ${CHECK_INTERVAL / 60000}min | Post interval: ${POST_INTERVAL / 60000}min`);
console.log(`[SOCIAL] Sprites: ${SPRITE_DIR}`);
console.log(`[SOCIAL] Memes: ${MEME_DIR}`);

// Log available images
try {
  const sprites = fs.readdirSync(SPRITE_DIR).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
  console.log(`[SOCIAL] ${sprites.length} sprites available`);
} catch (e) { console.log('[SOCIAL] No sprites found'); }
try {
  const memes = fs.readdirSync(MEME_DIR).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
  console.log(`[SOCIAL] ${memes.length} memes available`);
} catch (e) { console.log('[SOCIAL] No memes found (upload in progress?)'); }

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
