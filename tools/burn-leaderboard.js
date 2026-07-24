#!/usr/bin/env node
/**
 * Burn Leaderboard — tracks all token burns to the MfT impact address
 * Scans Transfer events to BURN address from all launched token reactors + CHAR reactors
 * Outputs lifetime + weekly leaderboard, saves to Supabase
 *
 * Usage: node burn-leaderboard.js
 * PM2:   pm2 start burn-leaderboard.js --cron "0 0 * * 0"  (weekly Sunday midnight)
 */

const path = require('path');
const fs = require('fs');
const localEnv = path.join(__dirname, '..', '..', 'Baselings', 'api', '.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '.env') });
const { ethers } = require('ethers');

const RPC = 'https://mainnet.base.org';
const BURN = '0xfd780B0aE569e15e514B819ecFDF46f804953a4B';
const FACTORY = '0x51eF41E0730c0e607950421e1EE113b089867d3e';
const FACTORY_DEPLOY_BLOCK = 45523770;
const CHUNK = 9999;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const FACTORY_ABI = [
  'event TokenLaunched(address indexed token, address indexed reactor, address indexed charReactor, address launcher, string name, string symbol, uint256 supply, uint256 seed)'
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const BURN_TOPIC = ethers.zeroPadValue(BURN, 32).toLowerCase();

const provider = new ethers.JsonRpcProvider(RPC);

function ts() { return new Date().toISOString().slice(0, 19); }
function short(a) { return a.slice(0, 6) + '...' + a.slice(-4); }

// Also track burns for static network tokens (MfT, CHAR, etc.)
const STATIC_TOKENS = [
  { symbol: 'MfT', token: '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3', decimals: 18 },
  { symbol: 'CHAR', token: '0x20b048fA035D5763685D695e66aDF62c5D9F5055', decimals: 18 },
  { symbol: 'AZUSD', token: '0x3595ca37596D5895B70EFAB592ac315D5B9809B2', decimals: 18 },
  { symbol: 'BB', token: '0xf967bf3dccF8b6826F82de1781C98E61Bda3b106', decimals: 18 },
  { symbol: 'EB', token: '0x17a176Ab2379b86F1E65D79b03bD8c75981244D8', decimals: 18 },
  { symbol: 'BURGERS', token: '0x06A05043eb2C1691b19c2C13219dB9212269dDc5', decimals: 18 },
  { symbol: 'TGN', token: '0xD75dfa972C6136f1c594Fec1945302f885E1ab29', decimals: 18 },
  { symbol: 'EGP', token: '0x2D9a906DEea5e2EAD43E78A80bF45dCE49498193', decimals: 18 },
  { symbol: 'POOP', token: '0x108bD96080870BF50B1b0e3b310E5219C5AEf43D', decimals: 18 },
];

async function discoverLaunches() {
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const currentBlock = await provider.getBlockNumber();
  const events = [];

  console.log(`[${ts()}] Scanning factory ${short(FACTORY)} blocks ${FACTORY_DEPLOY_BLOCK}→${currentBlock}...`);

  for (let from = FACTORY_DEPLOY_BLOCK; from <= currentBlock; from += CHUNK + 1) {
    const to = Math.min(from + CHUNK, currentBlock);
    const chunk = await factory.queryFilter('TokenLaunched', from, to);
    events.push(...chunk);
  }

  console.log(`[${ts()}] Found ${events.length} launched token(s)`);
  return events.map(ev => ({
    symbol: ev.args.symbol,
    name: ev.args.name,
    token: ev.args.token,
    reactor: ev.args.reactor,
    charReactor: ev.args.charReactor,
    launcher: ev.args.launcher,
    seed: ev.args.seed,
  }));
}

/**
 * Get lifetime burn balance for a token at the BURN address
 */
async function getLifetimeBurn(tokenAddr, decimals) {
  const contract = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
  try {
    const bal = await contract.balanceOf(BURN);
    return { raw: bal, formatted: ethers.formatUnits(bal, decimals) };
  } catch (e) {
    console.warn('[burn-board] balance read failed:', e.message || e);
    return { raw: 0n, formatted: '0' };
  }
}

/**
 * Get weekly burns by scanning Transfer events to BURN in last 7 days (~302400 blocks at 2s/block)
 */
async function getWeeklyBurns(tokenAddr, currentBlock) {
  const weekBlocks = 302400; // ~7 days at 2s/block
  const fromBlock = Math.max(currentBlock - weekBlocks, 0);

  const checksumAddr = ethers.getAddress(tokenAddr.toLowerCase());
  let totalBurned = 0n;

  for (let from = fromBlock; from <= currentBlock; from += CHUNK + 1) {
    const to = Math.min(from + CHUNK, currentBlock);
    try {
      const logs = await provider.getLogs({
        address: checksumAddr,
        topics: [TRANSFER_TOPIC, null, BURN_TOPIC],
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        totalBurned += BigInt(log.data);
      }
    } catch (e) {
      console.error(`  Log scan error ${from}-${to}: ${e.message.slice(0, 60)}`);
    }
  }

  return totalBurned;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  BURN LEADERBOARD');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`[${ts()}] Burn address: ${BURN}`);
  console.log('');

  const currentBlock = await provider.getBlockNumber();

  // Discover launched tokens
  const launches = await discoverLaunches();
  console.log('');

  // Build token list: static + launched
  const allTokens = [];

  for (const s of STATIC_TOKENS) {
    allTokens.push({ symbol: s.symbol, token: s.token, decimals: s.decimals, source: 'network' });
  }

  for (const l of launches) {
    // Get decimals for launched token
    const contract = new ethers.Contract(l.token, ERC20_ABI, provider);
    let decimals = 18;
    try { decimals = Number(await contract.decimals()); } catch (e) { console.warn('[burn-board] decimals fallback 18:', l.symbol, e.message || e); }
    allTokens.push({ symbol: l.symbol, token: l.token, decimals, source: 'launched', launcher: l.launcher });
  }

  console.log(`[${ts()}] Tracking ${allTokens.length} tokens (${STATIC_TOKENS.length} network + ${launches.length} launched)`);
  console.log('');

  // Get lifetime + weekly burns for each
  const results = [];

  for (const t of allTokens) {
    process.stdout.write(`  ${t.symbol.padEnd(10)} `);

    const lifetime = await getLifetimeBurn(t.token, t.decimals);
    const weeklyRaw = await getWeeklyBurns(t.token, currentBlock);
    const weeklyFormatted = ethers.formatUnits(weeklyRaw, t.decimals);

    results.push({
      symbol: t.symbol,
      token: t.token,
      source: t.source,
      decimals: t.decimals,
      lifetime_burned: lifetime.formatted,
      lifetime_burned_raw: lifetime.raw.toString(),
      weekly_burned: weeklyFormatted,
      weekly_burned_raw: weeklyRaw.toString(),
      launcher: t.launcher || null,
    });

    console.log(`lifetime=${Number(lifetime.formatted).toLocaleString()} weekly=${Number(weeklyFormatted).toLocaleString()}`);

    // Brief pause to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  // Sort by lifetime burns (descending)
  const lifetimeBoard = [...results].sort((a, b) => {
    const aVal = BigInt(a.lifetime_burned_raw);
    const bVal = BigInt(b.lifetime_burned_raw);
    return bVal > aVal ? 1 : bVal < aVal ? -1 : 0;
  });

  const weeklyBoard = [...results].sort((a, b) => {
    const aVal = BigInt(a.weekly_burned_raw);
    const bVal = BigInt(b.weekly_burned_raw);
    return bVal > aVal ? 1 : bVal < aVal ? -1 : 0;
  });

  console.log('');
  console.log('── LIFETIME LEADERBOARD ──');
  for (let i = 0; i < lifetimeBoard.length; i++) {
    const r = lifetimeBoard[i];
    if (BigInt(r.lifetime_burned_raw) === 0n) continue;
    console.log(`  ${String(i + 1).padStart(2)}. ${r.symbol.padEnd(10)} ${Number(r.lifetime_burned).toLocaleString().padStart(20)} burned  [${r.source}]`);
  }

  console.log('');
  console.log('── WEEKLY LEADERBOARD ──');
  for (let i = 0; i < weeklyBoard.length; i++) {
    const r = weeklyBoard[i];
    if (BigInt(r.weekly_burned_raw) === 0n) continue;
    console.log(`  ${String(i + 1).padStart(2)}. ${r.symbol.padEnd(10)} ${Number(r.weekly_burned).toLocaleString().padStart(20)} burned  [${r.source}]`);
  }

  // Save to Supabase if configured
  if (SUPABASE_URL && SUPABASE_KEY) {
    const snapshot = {
      timestamp: new Date().toISOString(),
      block: currentBlock,
      burn_address: BURN,
      factory: FACTORY,
      lifetime: lifetimeBoard.filter(r => BigInt(r.lifetime_burned_raw) > 0n).map(r => ({
        symbol: r.symbol,
        token: r.token,
        source: r.source,
        burned: r.lifetime_burned,
        burned_raw: r.lifetime_burned_raw,
      })),
      weekly: weeklyBoard.filter(r => BigInt(r.weekly_burned_raw) > 0n).map(r => ({
        symbol: r.symbol,
        token: r.token,
        source: r.source,
        burned: r.weekly_burned,
        burned_raw: r.weekly_burned_raw,
      })),
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/burn_leaderboard`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ snapshot: JSON.stringify(snapshot), created_at: snapshot.timestamp }),
    });

    if (res.ok) {
      console.log(`\n[${ts()}] Saved snapshot to Supabase`);
    } else {
      const err = await res.text();
      console.error(`\n[${ts()}] Supabase error: ${res.status} ${err}`);
      // Save locally as fallback
      const outPath = path.join(__dirname, 'burn-snapshot.json');
      fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
      console.log(`[${ts()}] Saved locally to ${outPath}`);
    }
  } else {
    // No Supabase — save locally
    const snapshot = {
      timestamp: new Date().toISOString(),
      block: currentBlock,
      lifetime: lifetimeBoard.filter(r => BigInt(r.lifetime_burned_raw) > 0n),
      weekly: weeklyBoard.filter(r => BigInt(r.weekly_burned_raw) > 0n),
    };
    const outPath = path.join(__dirname, 'burn-snapshot.json');
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    console.log(`\n[${ts()}] Saved to ${outPath}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`[${ts()}] LEADERBOARD COMPLETE`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
