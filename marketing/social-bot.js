/**
 * MfT Social Bot — posts memes + stats to X
 *
 * Alternates: meme → content/stats → meme → content every 93 min
 * Memes from C:/everythingslide (random pick, no repeats until all used)
 *
 * Setup:
 *   1. Create .env in this directory with X API keys
 *   2. npm install twitter-api-v2 dotenv ethers
 *   3. node social-bot.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// ── Config ──────────────────────────────────────────────────────────────────
const POST_INTERVAL = 20 * 60 * 1000; // 20 minutes
const STATE_FILE = path.join(__dirname, 'social-bot-state.json');
const MEME_DIR = 'C:/everythingslide';
const MEME_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

// ── On-chain config ─────────────────────────────────────────────────────────
const BASE_RPC = 'https://mainnet.base.org';
const MFT_ADDR = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const BURN_ADDR = '0xfd780B0aE569e15e514B819ecFDF46f804953a4B';
const AZUSD_MFT_POOL = '0x53f6bF5e58304eF210bfBD9d6389880Ecc522A62';

const BURN_TOKENS = [
  { sym: 'MfT',     addr: '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3' },
  { sym: 'CHAR',    addr: '0x20b048fA035D5763685D695e66aDF62c5D9F5055' },
  { sym: 'EGP',     addr: '0xc1BA76771bbF0dD841347630E57c793F9d5ACcEe' },
  { sym: 'BURGERS', addr: '0x06A05043eb2C1691b19c2C13219dB9212269dDc5' },
  { sym: 'POOP',    addr: '0x126555aecBAC290b25644e4b7f29c016aE95f4dc' },
];

const ERC20_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];
const POOL_ABI = [
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
];

// ── State ───────────────────────────────────────────────────────────────────
let state = { contentIndex: 0, postCount: 0, usedMemes: [], isMemeNext: true };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch (e) { /* fresh start */ }
function saveState() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

// ── Formatters ──────────────────────────────────────────────────────────────
function formatPrice(usd) {
  if (usd >= 0.01) return '$' + usd.toFixed(4);
  const s = usd.toFixed(18);
  const m = s.match(/^0\.(0+)(\d{2,4})/);
  if (m) return `$0.0{${m[1].length}}${m[2]}`;
  return '$' + usd.toExponential(2);
}

function formatNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (n >= 1) return Math.floor(n).toLocaleString();
  if (n > 0) return n.toFixed(4);
  return '0';
}

function formatMC(mc) {
  if (mc >= 1e9) return '$' + (mc / 1e9).toFixed(2) + 'B';
  if (mc >= 1e6) return '$' + (mc / 1e6).toFixed(2) + 'M';
  if (mc >= 1e3) return '$' + (mc / 1e3).toFixed(1) + 'K';
  return '$' + mc.toFixed(0);
}

// ── Live on-chain data ──────────────────────────────────────────────────────
async function getLiveData() {
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC);
    const mft = new ethers.Contract(MFT_ADDR, ERC20_ABI, provider);
    const pool = new ethers.Contract(AZUSD_MFT_POOL, POOL_ABI, provider);

    const [supply, mftBurnBal, slot0] = await Promise.all([
      mft.totalSupply(),
      mft.balanceOf(BURN_ADDR),
      pool.slot0(),
    ]);

    const sqrtPriceX96 = slot0[0];
    const rawPrice = Number(sqrtPriceX96) ** 2 / (2 ** 192);
    const mftPriceUsd = 1 / rawPrice;

    const totalSupply = Number(ethers.formatEther(supply));
    const mftBurned = Number(ethers.formatEther(mftBurnBal));
    const circulating = totalSupply - mftBurned;
    const mc = circulating * mftPriceUsd;
    const burnPct = ((mftBurned / totalSupply) * 100).toFixed(4) + '%';

    const burnList = [];
    for (const t of BURN_TOKENS) {
      try {
        const c = new ethers.Contract(t.addr, ERC20_ABI, provider);
        const bal = await c.balanceOf(BURN_ADDR);
        const amount = Number(ethers.formatEther(bal));
        if (amount > 0) burnList.push({ sym: t.sym, amount });
      } catch (_) { /* rate limit — skip */ }
    }

    return {
      price: formatPrice(mftPriceUsd),
      mc: formatMC(mc),
      mftBurns: formatNum(mftBurned),
      burnPct,
      impactList: burnList.map(b => `${formatNum(b.amount)} ${b.sym}`).join('\n') || formatNum(mftBurned) + ' MfT',
      tokenCount: burnList.length,
    };
  } catch (e) {
    console.error('[DATA] Fetch failed:', e.message);
    return null;
  }
}

function fillTemplate(template, data) {
  return template
    .replace(/\{price\}/g, data.price)
    .replace(/\{mc\}/g, data.mc)
    .replace(/\{mftBurns\}/g, data.mftBurns)
    .replace(/\{burnPct\}/g, data.burnPct)
    .replace(/\{impactList\}/g, data.impactList)
    .replace(/\{tokenCount\}/g, data.tokenCount);
}

// ── Stats tweet templates (use live data) ───────────────────────────────────
const STATS_TWEETS = [
  `$MfT live stats:\n\nPrice: {price}\nMarket Cap: {mc}\nMfT Burned: {mftBurns} ({burnPct})\n\nImpact burn address holds {tokenCount} tokens from the reactor network.\nAll verifiable on-chain.`,

  `The $MfT impact burn address:\n\n{impactList}\n\nNo withdraw function. Tokens go in, they stay forever.\n\nPrice: {price}\nMC: {mc}`,

  `$MfT by the numbers:\n\n{price} per token\n{mc} market cap\n{mftBurns} MfT burned ({burnPct})\n\nThe burn address holds tokens from every reactor in the network.\nAll permanently locked. All on-chain.`,

  `How the $MfT reactor network works:\n\n1. Reactors collect V3 fees\n2. 50% of token fees burned permanently\n3. 50% sent to launcher's wallet\n4. Cross-token fees compound as LP\n5. Fees cascade to Prime, burn MfT\n\n{mftBurns} MfT burned. Price: {price}`,

  `$MfT — Meme For Trees\n\nEvery trade across the reactor network feeds the burn.\n\nPrice: {price}\nMC: {mc}\nMfT burned: {mftBurns}\n\nImpact burns include MfT + community tokens.\nAll locked forever at the impact address.`,
];

// ── Promotional content (no live data needed) ───────────────────────────────
const PROMO_CONTENT = [
  `Free token launches on Base. One transaction: token, two locked pools, reactor.\n\n50% of fees burned. 50% to your wallet. Every 2 hours. Forever.\n\nhttps://tasern.quest/unrugable.html`,

  `"Unrugable" isn't a brand name. It's a contract property.\n\nNo withdraw function. Locked LP. 50/50 burn-and-earn reactor.\n\nVerify it yourself.\n\nhttps://tasern.quest/unrugable.html`,

  `Other platforms charge you to launch and keep the fees.\n\nUnrugable: free to launch, 50% of reactor fees go to your wallet every 2 hours. The other 50% gets burned.\n\nhttps://tasern.quest/unrugable.html`,

  `Two pools per token.\n\nMoney pool (70%): semi-stable, Aave yield funds tree planting.\nMeme pool (30%): wild ride, reactor heartbeat.\n\nBoth locked forever. Both earning fees.\n\nhttps://tasern.quest/unrugable.html`,

  `Raise a pet. Shovel its poop. Deposit the poop into DeFi gardens for yield.\n\nThe poop economy is real and it's on Base.\n\nhttps://tasern.quest/baseling/`,

  `The reactor heartbeat: secondary reactors compress MfT. V1 Prime fires last, buying through accumulated sell walls with fees from the entire network.\n\nCycle resets every 2 hours.\n\nhttps://tasern.quest/burns.html`,

  `MfT started as sharing memes to fund trees. Then we built a free token launcher, a reactor network, and a pet game.\n\nEvery launch strengthens the whole network.\n\nhttps://tasern.quest/unrugable.html`,

  `More launches = more reactors = more trading routes.\nMore routes = more arb surfaces for bots and agents.\nMore activity = more fees = more burns + launcher earnings.\n\nFree to launch. You earn when they trade.`,

  `Money for Trees: deposit USDC, get a 1:1 proof of deposit. Your deposit earns Aave yield that funds tree planting.\n\nEvery V7 token pairs 70% of supply against Money — connecting your token to real yield infrastructure.\n\nhttps://tasern.quest/money-for-trees.html`,

  `Launch a token for free. Get an invite link.\n\nWhen someone launches with your link, their reactor chains upstream to yours. Permanent. On-chain.\n\nThe network grows with every launch.\n\nhttps://tasern.quest/unrugable.html`,

  `You sold. The reactor collected the fee. Two hours later: half burned, half sent to the launcher.\n\nSells generate reactor fuel and launcher income.\n\nhttps://tasern.quest/unrugable.html`,

  `Every reactor cycle collects CHAR from trading fees. CHAR tracks carbon credits removed from markets.\n\nYour DeFi activity removes carbon from circulation whether you meant to or not.\n\nhttps://tasern.quest/burns.html`,

  `Anyone can call execute() on any reactor. No API keys. No governance. No permission.\n\nThe reactor burns supply, pays the launcher, and compounds liquidity.\n\nOne function call. Permissionless DeFi infrastructure.\n\nhttps://tasern.quest/agents.html`,

  `49 MCP tools for on-chain AI agents.\n\nnpx baselings-mcp\n\nYour agent can read reactors, fire cycles, launch tokens, check pools, and run game actions on Base.\n\nhttps://tasern.quest/llms.txt`,

  `Your baseling produced poop. That poop became LP. That LP earned fees. Those fees burned tokens.\n\nYour virtual pet just did more DeFi than most traders.\n\nhttps://tasern.quest/baseling/`,

  `Fund trees. Burn memes. Impact Generators compound charity LP positions automatically — trading into partner tokens every cycle to grow their own holdings. No admin. No keys. Anyone can call execute() and trigger the next compound.\n\nhttps://tasern.quest/generator.html`,

  `Impact Generators are selfish contracts. They compound to grow their own LP positions. To do that, they trade into partner tokens every cycle — it is how the math works. The charity fund grows. The LP deepens. Nobody touches the money.\n\nhttps://tasern.quest/generator.html`,

  `Every token launched on Unrugable gets a charity fund. Every charity fund has an Impact Generator that compounds automatically. Per-token leaderboards track which community has funded the most trees. Permissionless. On-chain. Verifiable.\n\nhttps://tasern.quest/generator.html`,
];

// ── X client ────────────────────────────────────────────────────────────────
function createClient() {
  const { TwitterApi } = require('twitter-api-v2');
  const key = process.env.X_APP_KEY || process.env.API_KEY;
  const secret = process.env.X_APP_SECRET || process.env.API_SECRET;
  const token = process.env.X_ACCESS_TOKEN || process.env.ACCESS_TOKEN;
  const tokenSecret = process.env.X_ACCESS_SECRET || process.env.ACCESS_TOKEN_SECRET;
  if (!key || !secret || !token || !tokenSecret) {
    console.error('[X] Missing API credentials in .env');
    process.exit(1);
  }
  return new TwitterApi({ appKey: key, appSecret: secret, accessToken: token, accessSecret: tokenSecret });
}

// ── Meme picker ─────────────────────────────────────────────────────────────
function pickMeme() {
  if (!state.usedMemes) state.usedMemes = [];
  let allFiles;
  try {
    allFiles = fs.readdirSync(MEME_DIR).filter(f => MEME_EXTS.has(path.extname(f).toLowerCase()));
  } catch (e) {
    console.error('[MEME] Cannot read meme dir:', e.message);
    return null;
  }
  if (allFiles.length === 0) return null;

  let available = allFiles.filter(f => !state.usedMemes.includes(f));
  if (available.length === 0) {
    state.usedMemes = [];
    available = allFiles;
  }

  const pick = available[Math.floor(Math.random() * available.length)];
  state.usedMemes.push(pick);
  return path.join(MEME_DIR, pick);
}

// ── Post functions ──────────────────────────────────────────────────────────
function ts() { return new Date().toISOString().slice(0, 19); }

async function postMeme(client) {
  const memePath = pickMeme();
  if (!memePath) { console.log(`[${ts()}] No memes found`); return false; }

  try {
    const mediaId = await client.v1.uploadMedia(memePath);
    const result = await client.v2.tweet({ media: { media_ids: [mediaId] } });
    console.log(`[${ts()}] Meme: ${path.basename(memePath)} — tweet ${result.data.id}`);
    return true;
  } catch (e) {
    console.error(`[${ts()}] Meme failed: ${(e.message || e).toString().slice(0, 120)}`);
    return false;
  }
}

async function postStats(client) {
  const data = await getLiveData();
  if (!data) { console.log(`[${ts()}] Stats skipped — no chain data`); return false; }

  const idx = state.contentIndex % STATS_TWEETS.length;
  const tweet = fillTemplate(STATS_TWEETS[idx], data);
  state.contentIndex++;

  try {
    const result = await client.v2.tweet(tweet);
    console.log(`[${ts()}] Stats #${idx + 1}: ${tweet.slice(0, 60)}...`);
    return true;
  } catch (e) {
    console.error(`[${ts()}] Stats failed: ${(e.message || e).toString().slice(0, 120)}`);
    return false;
  }
}

async function postPromo(client) {
  const idx = state.contentIndex % PROMO_CONTENT.length;
  const tweet = PROMO_CONTENT[idx];
  state.contentIndex++;

  try {
    const result = await client.v2.tweet(tweet);
    console.log(`[${ts()}] Promo #${idx + 1}: ${tweet.slice(0, 60)}...`);
    return true;
  } catch (e) {
    console.error(`[${ts()}] Promo failed: ${(e.message || e).toString().slice(0, 120)}`);
    return false;
  }
}

// ── Main cycle: meme → stats → meme → promo → repeat ───────────────────────
async function postCycle() {
  const client = createClient();
  const cycle = state.postCount % 4;

  console.log(`[${ts()}] Post #${state.postCount + 1} (cycle phase: ${cycle})`);

  if (cycle === 0 || cycle === 2) {
    await postMeme(client);
  } else if (cycle === 1) {
    await postStats(client);
  } else {
    await postPromo(client);
  }

  state.postCount++;
  saveState();
}

// ── Start ───────────────────────────────────────────────────────────────────
console.log(`[${ts()}] MfT Social Bot starting — every 93 min`);
console.log(`[${ts()}] Meme dir: ${MEME_DIR}`);
try {
  const count = fs.readdirSync(MEME_DIR).filter(f => MEME_EXTS.has(path.extname(f).toLowerCase())).length;
  console.log(`[${ts()}] ${count} memes available`);
} catch (e) { console.log(`[${ts()}] Meme dir not found — will post text only`); }

postCycle();
setInterval(postCycle, POST_INTERVAL);

/*
 * Required .env keys (either naming convention works):
 *
 * X_APP_KEY= (or API_KEY=)
 * X_APP_SECRET= (or API_SECRET=)
 * X_ACCESS_TOKEN= (or ACCESS_TOKEN=)
 * X_ACCESS_SECRET= (or ACCESS_TOKEN_SECRET=)
 */
