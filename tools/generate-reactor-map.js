#!/usr/bin/env node
// generate-reactor-map.js — builds api/reactor-map.json from Supabase + on-chain burns + on-chain prices
// Cron: every 6 hours
// Output: /var/www/tasern/api/reactor-map.json
// Rule: if a fresh read returns 0, keep the old value — never overwrite with 0

const https = require("https");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://hhniimufxjjgmessjtbc.supabase.co";
const SUPABASE_ANON = "sb_publishable_F471ZS8yTS8qiXU0ZLEqvQ_I-O3av-l";
const HUB = "0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045";
const RPC = process.env.ALCHEMY_RPC || "https://base-mainnet.g.alchemy.com/v2/bwii0dH70pKYTKnqj3aNU";
const BURN_ADDR = "0xfd780B0aE569e15e514B819ecFDF46f804953a4B";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MFT  = "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3";
const V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";

const IMPACT_TOKENS = [
  { symbol: "CHAR",    address: "0x20b048fA035D5763685D695e66aDF62c5D9F5055", decimals: 18 },
  { symbol: "BURGERS", address: "0x06A05043eb2C1691b19c2C13219dB9212269dDc5", decimals: 18 },
  { symbol: "TGN",     address: "0xD75dfa972C6136f1c594Fec1945302f885E1ab29", decimals: 18 },
  { symbol: "AZUSD",   address: "0x3595ca37596D5895B70EFAB592ac315D5B9809B2", decimals: 18 },
];

const VPS_PATH = "/var/www/tasern/api/reactor-map.json";
const LOCAL_PATH = path.join(__dirname, "..", "site", "api", "reactor-map.json");
const OUT = fs.existsSync(path.dirname(VPS_PATH)) ? VPS_PATH : LOCAL_PATH;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, headers };
    https.get(opts, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
        resolve(JSON.parse(body));
      });
    }).on("error", reject);
  });
}

function rpcCall(to, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] });
    const u = new URL(RPC);
    const proto = u.protocol === "https:" ? https : require("http");
    const opts = { hostname: u.hostname, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } };
    const req = proto.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(d);
          if (j.error) return reject(new Error(j.error.message));
          resolve(j.result);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function encodeBalanceOf(addr) {
  return "0x70a08231" + addr.slice(2).toLowerCase().padStart(64, "0");
}

function encodeGetPool(tokenA, tokenB, fee) {
  return "0x1698ee82" +
    tokenA.slice(2).toLowerCase().padStart(64, "0") +
    tokenB.slice(2).toLowerCase().padStart(64, "0") +
    fee.toString(16).padStart(64, "0");
}

function hexToFloat(hex, decimals) {
  if (!hex || hex === "0x" || hex === "0x0") return 0;
  const raw = BigInt(hex);
  if (raw === 0n) return 0;
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 12);
  return parseFloat(whole.toString() + "." + fracStr);
}

// sqrtPriceX96 -> rawPrice = token1/token0 in raw (unscaled) units
function sqrtPriceToRaw(sqrtHex) {
  const s = Number(BigInt(sqrtHex));
  if (s === 0) return 0;
  return (s ** 2) / (2 ** 192);
}

// Read a V3 pool's slot0 and return token1/token0 raw price
async function getPoolRawPrice(poolAddr) {
  const slot0 = await rpcCall(poolAddr, "0x3850c7bd");
  return sqrtPriceToRaw("0x" + slot0.slice(2, 66));
}

// ── On-chain price lookups ───────────────────────────────────────────────────

async function getEthPrice() {
  const poolHex = await rpcCall(V3_FACTORY, encodeGetPool(WETH, USDC, 500));
  const pool = "0x" + poolHex.slice(26);
  if (pool === "0x" + "0".repeat(40)) return 0;
  const raw = await getPoolRawPrice(pool);
  // token0 = lower address. WETH(0x4200) < USDC(0x8335) so WETH is token0
  // raw = USDC_raw / WETH_raw. Adjust for 18-6=12 decimal diff
  const wethIsT0 = WETH.toLowerCase() < USDC.toLowerCase();
  // ethPrice = raw * 10^(dec0-dec1) = raw * 10^12
  if (wethIsT0) return raw * 1e12;
  return 1e12 / raw;
}

async function getMftPriceUsd(ethPrice) {
  const poolHex = await rpcCall(V3_FACTORY, encodeGetPool(MFT, WETH, 10000));
  const pool = "0x" + poolHex.slice(26);
  if (pool === "0x" + "0".repeat(40)) return 0;
  const raw = await getPoolRawPrice(pool);
  // WETH(0x4200) < MFT(0x8FB8) so WETH is token0, MfT is token1
  // raw = MfT_raw / WETH_raw (both 18 dec, no adjustment needed)
  // raw = how many MfT per 1 WETH
  // MfT price = ethPrice / raw
  const mftIsT0 = MFT.toLowerCase() < WETH.toLowerCase();
  if (mftIsT0) {
    // raw = WETH/MfT, so mftPrice = ethPrice * raw... but this case shouldn't happen
    return ethPrice * raw;
  }
  return ethPrice / raw;
}

async function getTokenPriceVsMft(tokenAddr, mftPriceUsd) {
  for (const fee of [10000, 3000, 500]) {
    try {
      const poolHex = await rpcCall(V3_FACTORY, encodeGetPool(tokenAddr, MFT, fee));
      const pool = "0x" + poolHex.slice(26);
      if (pool === "0x" + "0".repeat(40)) continue;
      const raw = await getPoolRawPrice(pool);
      if (raw === 0) continue;
      const tokenIsT0 = tokenAddr.toLowerCase() < MFT.toLowerCase();
      // Both 18 decimals. raw = token1/token0
      // tokenIsT0 true:  raw = MfT_per_TOKEN  -> tokenPrice = raw * mftPrice
      // tokenIsT0 false: raw = TOKEN_per_MfT   -> tokenPrice = mftPrice / raw
      if (tokenIsT0) return raw * mftPriceUsd;
      return mftPriceUsd / raw;
    } catch (e) { continue; }
  }
  return 0;
}

// ── Load previous data for fallback ──────────────────────────────────────────

function loadPrevious() {
  try { return JSON.parse(fs.readFileSync(OUT, "utf8")); }
  catch (e) { return null; }
}

function findPrevLaunch(prev, token) {
  if (!prev || !prev.launches) return null;
  return prev.launches.find(l => l.token && l.token.toLowerCase() === token.toLowerCase());
}

function findPrevImpact(prev, symbol) {
  if (!prev || !prev.impactBurns) return null;
  return prev.impactBurns.find(b => b.symbol === symbol);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prev = loadPrevious();

  // 1. Fetch ALL launches from Supabase (all factories, all versions)
  const rows = await fetchUrl(
    SUPABASE_URL + "/rest/v1/launched_tokens?select=token_address,reactor_address,char_reactor_address,name,symbol,seed,upstream_address,launcher_address&chain_id=eq.8453&limit=500",
    { apikey: SUPABASE_ANON, Authorization: "Bearer " + SUPABASE_ANON }
  );
  console.log("Fetched " + rows.length + " tokens from Supabase");

  const launches = [];
  const reactors = {};

  for (const row of rows) {
    launches.push({
      name: row.symbol,
      fullName: row.name,
      token: row.token_address,
      seed: row.seed,
      reactor: row.reactor_address,
      charReactor: row.char_reactor_address,
    });
    if (row.reactor_address) {
      reactors[row.reactor_address] = { tags: [{ sym: row.symbol }, { sym: "MfT" }], upstream: row.char_reactor_address || HUB };
    }
    if (row.char_reactor_address) {
      reactors[row.char_reactor_address] = { tags: [{ sym: "CHAR" }, { sym: row.symbol }], upstream: row.upstream_address || null };
    }
  }

  // Read CHAR reactor upstreams from chain (Supabase upstream_address is often null)
  console.log("Reading CHAR reactor upstreams from chain...");
  const UPSTREAM_SEL = "0x14148322"; // upstreamReactor()
  for (const l of launches) {
    if (!l.charReactor || !reactors[l.charReactor]) continue;
    if (reactors[l.charReactor].upstream) continue; // already have it from Supabase
    try {
      const hex = await rpcCall(l.charReactor, UPSTREAM_SEL);
      const addr = "0x" + hex.slice(26);
      if (addr && addr !== "0x" + "0".repeat(40)) {
        reactors[l.charReactor].upstream = addr;
        console.log("  " + l.name + " CHAR -> " + addr.slice(0, 10) + "...");
      } else {
        reactors[l.charReactor].upstream = HUB;
      }
    } catch (e) {
      console.warn("  " + l.name + " CHAR upstream read failed, defaulting to Hub");
      reactors[l.charReactor].upstream = HUB;
    }
  }

  // 2. Read actual pool tags from chain for each reactor
  console.log("Reading reactor pools from chain...");
  const POOL_COUNT_SEL = "0xf525cb68"; // poolCount()
  const POOLS_SEL = "0xac4afa38";      // pools(uint256)
  const SYMBOL_SEL = "0x95d89b41";     // symbol()
  const symCache = {};

  async function getSymbol(addr) {
    const k = addr.toLowerCase();
    if (symCache[k]) return symCache[k];
    try {
      const raw = await rpcCall(addr, SYMBOL_SEL);
      // ABI-decode string: offset at bytes 0-31, length at 32-63, data at 64+
      const len = parseInt(raw.slice(66, 130), 16);
      const hex = raw.slice(130, 130 + len * 2);
      const sym = Buffer.from(hex, "hex").toString("utf8").replace(/\0/g, "");
      symCache[k] = sym;
      return sym;
    } catch (e) { return addr.slice(0, 6) + "..." + addr.slice(-4); }
  }

  const allReactorAddrs = [];
  for (const l of launches) {
    if (l.reactor) allReactorAddrs.push(l.reactor);
    if (l.charReactor) allReactorAddrs.push(l.charReactor);
  }

  for (const rAddr of allReactorAddrs) {
    if (!reactors[rAddr]) continue;
    try {
      const countHex = await rpcCall(rAddr, POOL_COUNT_SEL);
      const count = parseInt(countHex, 16);
      const tags = [];
      const readCount = Math.min(count, 10);
      for (let i = 0; i < readCount; i++) {
        try {
          const poolData = await rpcCall(rAddr, POOLS_SEL + i.toString(16).padStart(64, "0"));
          // pools() returns: tokenId(32), xToken(32), poolAddress(32), fee(32), tokenIsToken0(32), disabled(32)
          const xToken = "0x" + poolData.slice(90, 130);
          const disabled = parseInt(poolData.slice(322, 386), 16) !== 0;
          const sym = await getSymbol(xToken);
          tags.push({ sym, disabled });
        } catch (e) { continue; }
      }
      if (count > readCount) tags.push({ sym: "+" + (count - readCount), disabled: false });
      if (tags.length > 0) reactors[rAddr].tags = tags;
      console.log("  " + rAddr.slice(0, 10) + "... " + count + " pools: " + tags.map(t => t.sym).join(", "));
    } catch (e) {
      console.warn("  " + rAddr.slice(0, 10) + "... pool read failed");
    }
  }

  // 3. Get base prices on-chain
  console.log("Getting on-chain prices...");
  let ethPrice = 0;
  let mftPrice = 0;
  try {
    ethPrice = await getEthPrice();
    console.log("  ETH = $" + ethPrice.toFixed(2));
    mftPrice = await getMftPriceUsd(ethPrice);
    console.log("  MfT = $" + mftPrice.toExponential(4));
  } catch (e) {
    console.warn("  Price fetch failed: " + e.message);
  }

  // 3. Impact token burns + prices
  console.log("Reading impact token burns...");
  const impactBurns = [];
  for (const t of IMPACT_TOKENS) {
    const old = findPrevImpact(prev, t.symbol);
    let burned = 0, price = 0;

    try {
      const hex = await rpcCall(t.address, encodeBalanceOf(BURN_ADDR));
      burned = hexToFloat(hex, t.decimals);
    } catch (e) {
      console.warn("  " + t.symbol + ": burn read failed");
    }

    if (t.symbol === "AZUSD") {
      price = 1.0;
    } else if (mftPrice > 0) {
      try { price = await getTokenPriceVsMft(t.address, mftPrice); } catch (e) { console.warn('[reactor-map] token price fetch failed:', e.message || e); }
    }

    // Never write 0 if we had a previous value
    if (burned === 0 && old && old.burned > 0) burned = old.burned;
    if (price === 0 && old && old.price > 0) price = old.price;

    const value = burned * price;
    console.log("  " + t.symbol + ": " + burned.toFixed(6) + " burned, $" + (price > 0.01 ? price.toFixed(4) : price.toExponential(4)) + "/token, value $" + value.toFixed(4));
    impactBurns.push({ symbol: t.symbol, address: t.address, burned, price, value });
  }

  // 4. Launched token burns + prices
  console.log("Reading launched token burns...");
  for (const l of launches) {
    const old = findPrevLaunch(prev, l.token);
    let burned = 0, price = 0;

    try {
      const hex = await rpcCall(l.token, encodeBalanceOf(BURN_ADDR));
      burned = hexToFloat(hex, 18);
    } catch (e) {
      console.warn("  " + l.name + ": burn read failed");
    }

    if (mftPrice > 0) {
      try { price = await getTokenPriceVsMft(l.token, mftPrice); } catch (e) { console.warn('[reactor-map] pool token price failed:', e.message || e); }
    }

    // Never write 0 if we had a previous value
    if (burned === 0 && old && old.burned > 0) burned = old.burned;
    if (price === 0 && old && old.price > 0) price = old.price;

    l.burned = burned;
    l.price = price;
    l.burnValue = burned * price;

    if (burned > 0 || price > 0) {
      console.log("  " + l.name + ": " + burned.toFixed(4) + " burned, $" + (price > 0.001 ? price.toFixed(6) : price.toExponential(4)) + "/token");
    }
  }

  const data = {
    launches,
    reactors,
    hub: HUB,
    impactBurns,
    generatedAt: new Date().toISOString(),
  };

  const outDir = path.dirname(OUT);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log("Wrote " + OUT + " (" + launches.length + " launches, " + impactBurns.length + " impact tokens)");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
