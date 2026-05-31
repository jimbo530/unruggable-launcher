// MycoPad Token Metadata API
// Stores token images and metadata for the launchpad gallery.
// Deploy on VPS: node server.js (runs on port 3456)

try { require("dotenv").config(); } catch (e) { /* dotenv optional */ }

const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const PORT = 3456;
const DATA_DIR = path.join(__dirname, "data");
const IMG_DIR = path.join(DATA_DIR, "images");
const BASE_RPC = "https://mainnet.base.org";
const BASE_URL = "https://tasern.quest/api/unrugable";
const LAUNCHER_URL = "https://tasern.quest/launcher/unrugable.html";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hhniimufxjjgmessjtbc.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const API_SECRET = process.env.MYCOPAD_API_SECRET || "";

// Ensure dirs exist
fs.mkdirSync(IMG_DIR, { recursive: true });

// ── Rate limiter (per IP, 5 POSTs per minute) ───────────────────────────────
const postRateMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const window = 60000;
  const max = 5;
  const entries = (postRateMap.get(ip) || []).filter(t => now - t < window);
  if (entries.length >= max) return false;
  entries.push(now);
  postRateMap.set(ip, entries);
  return true;
}
// Clean rate map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of postRateMap) {
    const valid = times.filter(t => now - t < 60000);
    if (valid.length === 0) postRateMap.delete(ip);
    else postRateMap.set(ip, valid);
  }
}, 300000);

// ── Factory configs ──────────────────────────────────────────────────────────
// Old factories use getLaunch(), new V4.3/V5.2 use launches()
const OLD_FACTORIES = [
  "0x655e0Ca995D10912574a92a3a67AE9D466424925",
  "0xb74fe5fA2D030706B4A0C901fDC42C5244695A6e",
  "0x2e0b20a4FFEaCAcB8D3CD0cF6b9bBE6660c4262e",
];
const NEW_FACTORIES = [
  "0x51eF41E0730c0e607950421e1EE113b089867d3e",  // V4.3
  "0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51",  // V5.2
  "0x65F8227f37932e1aF1771398DFA76B4079fbDb21",  // V5.3
  "0xb1fE1deeA42F85F124E7cB166B2f52a1D7f1d054",  // V5.4
  "0x9FCE6fF019570dC09678C6Fcd513bDF5cf766fC9",  // V5.5
];
const OLD_FACTORY_ABI = [
  "function launchCount() view returns (uint256)",
  "function getLaunch(uint256 index) view returns (address token, address reactor, address charReactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)",
  "function isReactor(address) view returns (bool)",
  "function reactorOf(address) view returns (address)",
  "function minSeed() view returns (uint256)",
  "function upstreamReactor() view returns (address)",
];
const NEW_FACTORY_ABI = [
  "function launchCount() view returns (uint256)",
  "function launches(uint256) view returns (address token, address reactor, address charReactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)",
  "function isReactor(address) view returns (bool)",
  "function minSeed() view returns (uint256)",
  "function upstreamReactor() view returns (address)",
];
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const ADOPTION_ADDR = "0x013a1091108D50eF5F9cC3FDa38f9b2BA4D3F81d";
const ADOPTION_ABI = [
  "function adoptionCount() view returns (uint256)",
  "function adopterOf(address token) view returns (address)",
  "function reactorOf(address token) view returns (address)",
];
function getAdoption() {
  return new ethers.Contract(ADOPTION_ADDR, ADOPTION_ABI, getProvider());
}

let _provider;
let _providerCreated = 0;
function getProvider() {
  // Recreate provider every 5 minutes to avoid stale connections
  if (!_provider || Date.now() - _providerCreated > 300000) {
    _provider = new ethers.JsonRpcProvider(BASE_RPC);
    _providerCreated = Date.now();
  }
  return _provider;
}
function getFactory(addr) {
  const isNew = NEW_FACTORIES.some(f => f.toLowerCase() === addr.toLowerCase());
  return new ethers.Contract(addr, isNew ? NEW_FACTORY_ABI : OLD_FACTORY_ABI, getProvider());
}

function getMetaPath(addr) {
  return path.join(DATA_DIR, addr.toLowerCase() + ".json");
}
function getImgPath(addr, ext) {
  return path.join(IMG_DIR, addr.toLowerCase() + "." + ext);
}
function hasImage(addr) {
  for (const ext of ["png", "jpg", "jpeg", "gif", "webp"]) {
    if (fs.existsSync(getImgPath(addr.toLowerCase(), ext))) return true;
  }
  return false;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function json(res, code, data) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ── EIP-7572 compliant metadata ─────────────────────────────────────────────
// Wraps stored or generated metadata into EIP-7572 contractURI format
function toEIP7572(meta) {
  const addr = (meta.address || "").toLowerCase();
  const imgPath = hasImage(addr)
    ? BASE_URL + "/image/" + addr
    : null;
  return {
    name: meta.name || "Unknown Token",
    symbol: meta.symbol || "???",
    description: meta.description || (meta.name || meta.symbol || "Token") + " — launched on MfT Unrugable Launcher. Liquidity locked forever.",
    image: imgPath || meta.image || null,
    external_link: LAUNCHER_URL,
    decimals: 18,
    // Extra fields (not EIP-7572, but useful for galleries/agents)
    address: addr,
    supply: meta.supply || null,
    seed: meta.seed || null,
    reactor: meta.reactor || null,
    charReactor: meta.charReactor || null,
    grower: meta.grower || null,
    created: meta.created || null,
  };
}

// ── Verify token exists in a known factory ──────────────────────────────────
async function isFactoryToken(addr) {
  const provider = getProvider();
  const allFactories = [...OLD_FACTORIES, ...NEW_FACTORIES];
  for (const factoryAddr of allFactories) {
    try {
      const factory = getFactory(factoryAddr);
      const count = Number(await factory.launchCount());
      const isNew = NEW_FACTORIES.some(f => f.toLowerCase() === factoryAddr.toLowerCase());
      for (let i = 0; i < count; i++) {
        try {
          const l = isNew ? await factory.launches(i) : await factory.getLaunch(i);
          const token = (l.token || l[0]).toLowerCase();
          if (token === addr.toLowerCase()) return true;
        } catch (e) {
          console.error("Factory scan error at index", i, e.message);
        }
      }
    } catch (e) {
      console.error("Factory check error for", factoryAddr, e.message);
    }
  }
  return false;
}

// ── Chain fallback: fetch name/symbol/supply from ERC20 ─────────────────────
async function fetchFromChain(addr) {
  try {
    const token = new ethers.Contract(addr, ERC20_ABI, getProvider());
    const [name, symbol, supply] = await Promise.all([
      token.name(), token.symbol(), token.totalSupply(),
    ]);
    return {
      address: addr.toLowerCase(),
      name,
      symbol,
      supply: ethers.formatUnits(supply, 18),
    };
  } catch (e) {
    console.error("Chain fetch failed for", addr, e.message);
    return null;
  }
}

async function saveToSupabase(addr, body) {
  try {
    const supplyStr = body.supply
      ? String(BigInt(body.supply) * BigInt("1000000000000000000"))
      : null;
    const seedStr = body.seed
      ? String(BigInt(Math.round(parseFloat(body.seed) * 1e6)))
      : null;
    const row = {
      token_address: addr.startsWith("0x") ? addr : "0x" + addr,
      name: body.name,
      symbol: body.symbol,
      supply: supplyStr,
      seed: seedStr,
      launcher_address: body.grower || null,
      factory_address: body.factoryAddress || NEW_FACTORIES[NEW_FACTORIES.length - 1],
      reactor_address: body.reactor || null,
      char_reactor_address: body.charReactor || null,
      tx_hash: body.txHash || null,
      launched_at: new Date().toISOString()
    };
    const res = await fetch(SUPABASE_URL + "/rest/v1/launched_tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
        Prefer: "return=minimal"
      },
      body: JSON.stringify(row)
    });
    console.log("Supabase save:", res.status, addr);
  } catch (e) {
    console.error("Supabase save error:", e.message);
  }
}

// ── Reactor cards cache ─────────────────────────────────────────────────────
let reactorCardsCache = {};
const REACTOR_POOL_ABI = [
  "function poolCount() view returns (uint256)",
  "function pools(uint256) view returns (uint256 tokenId, address xToken, address poolAddress, uint24 fee, bool tokenIsToken0, bool disabled)",
];
const CARDS_CACHE_PATH = path.join(__dirname, "reactor-cards.json");

if (fs.existsSync(CARDS_CACHE_PATH)) {
  try { reactorCardsCache = JSON.parse(fs.readFileSync(CARDS_CACHE_PATH, "utf8")); } catch (e) { console.error("Failed to load reactor cards cache:", e.message); }
}

async function refreshReactorCards() {
  try {
    const provider = getProvider();
    const reactors = [];
    const allFactories = [...OLD_FACTORIES, ...NEW_FACTORIES];
    for (const factoryAddr of allFactories) {
      const factory = getFactory(factoryAddr);
      let count;
      try { count = Number(await factory.launchCount()); } catch (e) { console.error("launchCount failed for", factoryAddr, e.message); continue; }
      const isNew = NEW_FACTORIES.some(f => f.toLowerCase() === factoryAddr.toLowerCase());
      for (let i = 0; i < count; i++) {
        try {
          const l = isNew ? await factory.launches(i) : await factory.getLaunch(i);
          reactors.push(l.reactor || l[1], l.charReactor || l[2]);
        } catch (e) { console.error("getLaunch failed at", i, e.message); }
      }
    }
    for (const addr of reactors) {
      if (!addr || addr === ethers.ZeroAddress) continue;
      const key = addr.toLowerCase();
      const rx = new ethers.Contract(addr, REACTOR_POOL_ABI, provider);
      let poolCount;
      try { poolCount = Number(await rx.poolCount()); } catch (e) { console.error("poolCount failed for", addr, e.message); continue; }
      const existing = new Set(reactorCardsCache[key] || []);
      for (let i = 0; i < poolCount; i++) {
        try {
          const pool = await rx.pools(i);
          existing.add((pool.xToken || pool[1]).toLowerCase());
        } catch (e) { console.error("pool read failed at", i, "for", addr, e.message); }
      }
      reactorCardsCache[key] = [...existing];
    }
    fs.writeFileSync(CARDS_CACHE_PATH, JSON.stringify(reactorCardsCache, null, 2));
    console.log("Reactor cards cache updated:", Object.keys(reactorCardsCache).length, "reactors");
  } catch (e) {
    console.error("Reactor cards refresh error:", e.message);
  }
}

setTimeout(refreshReactorCards, 10000);
setInterval(refreshReactorCards, 30 * 60 * 1000);

// ── Auto-listing: Trust Wallet PR on new token launch ───────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const TRUSTWALLET_REPO = "trustwallet/assets";
const TW_CHAIN_DIR = "blockchains/base/assets";

function githubApi(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    if (!GITHUB_TOKEN) return resolve({ status: 0, data: "no token" });
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "api.github.com",
      path: endpoint,
      method,
      headers: {
        "User-Agent": "UnrugableLauncher/1.0",
        Authorization: "Bearer " + GITHUB_TOKEN,
        Accept: "application/vnd.github.v3+json",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = require("https").request(opts, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const r = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(r) }); }
        catch { resolve({ status: res.statusCode, data: r }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function autoListToken(addr, meta) {
  if (!GITHUB_TOKEN) {
    console.log("[AutoList] No GITHUB_TOKEN — skipping Trust Wallet PR for", meta.symbol);
    return;
  }

  const checksumAddr = ethers.getAddress(addr);
  console.log("[AutoList] Starting auto-list for", meta.symbol, checksumAddr);

  // Check if logo exists
  if (!hasImage(addr)) {
    console.log("[AutoList] No logo — skipping Trust Wallet PR");
    return;
  }

  try {
    // Get GitHub user
    const userRes = await githubApi("GET", "/user");
    if (userRes.status !== 200) { console.log("[AutoList] Bad GitHub token"); return; }
    const username = userRes.data.login;

    // Fork (idempotent)
    await githubApi("POST", "/repos/" + TRUSTWALLET_REPO + "/forks", {});
    await new Promise(r => setTimeout(r, 3000));

    // Get default branch SHA
    const refRes = await githubApi("GET", "/repos/" + username + "/assets/git/ref/heads/master");
    if (refRes.status !== 200) { console.log("[AutoList] Cannot get fork ref"); return; }
    const baseSha = refRes.data.object.sha;

    // Create branch
    const branchName = "add-" + meta.symbol.toLowerCase().replace(/[^a-z0-9]/g, "") + "-base-" + Date.now();
    const branchRes = await githubApi("POST", "/repos/" + username + "/assets/git/refs", {
      ref: "refs/heads/" + branchName, sha: baseSha,
    });
    if (branchRes.status !== 201) { console.log("[AutoList] Cannot create branch"); return; }

    // Read logo file and upload
    let logoB64 = null;
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp"]) {
      const p = getImgPath(addr, ext);
      if (fs.existsSync(p)) {
        logoB64 = fs.readFileSync(p).toString("base64");
        break;
      }
    }
    if (!logoB64) { console.log("[AutoList] Logo file disappeared"); return; }

    const logoPath = TW_CHAIN_DIR + "/" + checksumAddr + "/logo.png";
    const upRes = await githubApi("PUT", "/repos/" + username + "/assets/contents/" + logoPath, {
      message: "Add " + meta.symbol + " logo on Base",
      content: logoB64,
      branch: branchName,
    });
    if (upRes.status !== 201) { console.log("[AutoList] Logo upload failed:", upRes.status); return; }

    // Upload info.json
    const info = {
      name: meta.name, symbol: meta.symbol, type: "ERC20", decimals: 18,
      description: meta.description || (meta.name + " on Unrugable Launcher. Liquidity locked forever."),
      website: "https://tasern.quest",
      explorer: "https://basescan.org/token/" + checksumAddr,
      status: "active", id: checksumAddr,
      links: [
        { name: "twitter", url: "https://x.com/memefortrees" },
        { name: "website", url: "https://tasern.quest" },
      ],
    };
    await githubApi("PUT", "/repos/" + username + "/assets/contents/" + TW_CHAIN_DIR + "/" + checksumAddr + "/info.json", {
      message: "Add " + meta.symbol + " info on Base",
      content: Buffer.from(JSON.stringify(info, null, 2)).toString("base64"),
      branch: branchName,
    });

    // Create PR
    const prRes = await githubApi("POST", "/repos/" + TRUSTWALLET_REPO + "/pulls", {
      title: "Add " + meta.symbol + " (" + meta.name + ") on Base",
      body: "- Contract: `" + checksumAddr + "`\n- [BaseScan](https://basescan.org/token/" + checksumAddr + ")\n- Liquidity permanently locked via Unrugable Launcher\n",
      head: username + ":" + branchName,
      base: "master",
    });

    if (prRes.status === 201) {
      console.log("[AutoList] Trust Wallet PR created:", prRes.data.html_url);
    } else {
      console.log("[AutoList] PR failed:", prRes.status);
    }
  } catch (e) {
    console.error("[AutoList] Error:", e.message);
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, "http://localhost:" + PORT);
  const parts = url.pathname.split("/").filter(Boolean);

  // GET /metadata/:address — EIP-7572 compliant contractURI response
  if (req.method === "GET" && parts[0] === "metadata" && parts[1]) {
    const addr = parts[1].toLowerCase();
    const metaPath = getMetaPath(addr);

    // Try stored metadata first
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      return json(res, 200, toEIP7572(meta));
    }

    // Fallback: fetch from chain
    const chainMeta = await fetchFromChain(addr);
    if (chainMeta) {
      return json(res, 200, toEIP7572(chainMeta));
    }

    return json(res, 404, { error: "not found" });
  }

  // GET /image/:address
  if (req.method === "GET" && parts[0] === "image" && parts[1]) {
    const addr = parts[1].toLowerCase();
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp"]) {
      const imgPath = getImgPath(addr, ext);
      if (fs.existsSync(imgPath)) {
        const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
        cors(res);
        res.writeHead(200, { "Content-Type": mimeMap[ext], "Cache-Control": "public, max-age=86400" });
        fs.createReadStream(imgPath).pipe(res);
        return;
      }
    }
    return json(res, 404, { error: "no image" });
  }

  // POST /metadata/:address — store metadata + image + save to Supabase
  // SECURITY: rate-limited, no-overwrite, factory-verified or API-key authenticated
  if (req.method === "POST" && parts[0] === "metadata" && parts[1]) {
    try {
      const clientIP = req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      if (!checkRateLimit(clientIP)) {
        return json(res, 429, { error: "rate limit exceeded — max 5 POSTs per minute" });
      }

      const addr = parts[1].toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr)) return json(res, 400, { error: "invalid address" });

      // No-overwrite: existing metadata cannot be replaced
      const metaPath = getMetaPath(addr);
      if (fs.existsSync(metaPath)) {
        return json(res, 409, { error: "metadata already exists for this token — cannot overwrite" });
      }

      // Auth: require API secret OR verify token exists in a known factory
      const authHeader = req.headers["authorization"] || "";
      const hasApiKey = API_SECRET && authHeader === "Bearer " + API_SECRET;

      if (!hasApiKey) {
        const isValid = await isFactoryToken(addr);
        if (!isValid) {
          console.log("POST rejected: " + addr + " not found in any factory (IP: " + clientIP + ")");
          return json(res, 403, { error: "token not found in any known factory — unauthorized" });
        }
      }

      const body = JSON.parse((await parseBody(req)).toString("utf8"));
      const { name, symbol, supply, seed, reactor, grower, image } = body;

      if (!name || !symbol) return json(res, 400, { error: "name and symbol required" });

      // Save image if provided (base64 data URL) — reject SVG (XSS risk)
      let imageUrl = null;
      if (image && image.startsWith("data:image/")) {
        const match = image.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
        if (match) {
          const ext = match[1];
          const buf = Buffer.from(match[2], "base64");
          if (buf.length > 2 * 1024 * 1024) return json(res, 400, { error: "image too large (2MB max)" });
          fs.writeFileSync(getImgPath(addr, ext), buf);
          imageUrl = "/image/" + addr;
        }
      }

      const meta = {
        address: addr,
        name,
        symbol,
        description: body.description || null,
        supply: supply || null,
        seed: seed || null,
        seedUnit: body.seedUnit || "USDC",
        reactor: reactor || null,
        charReactor: body.charReactor || null,
        grower: grower || null,
        image: imageUrl,
        created: new Date().toISOString()
      };
      fs.writeFileSync(getMetaPath(addr), JSON.stringify(meta, null, 2));

      if (reactor) {
        saveToSupabase(addr, body);
      }

      // Fire auto-listing in background (non-blocking)
      autoListToken(addr, meta).catch(e => console.error("Auto-list error:", e.message));

      return json(res, 200, { ok: true, metadata: toEIP7572(meta) });
    } catch (e) {
      console.error("POST /metadata error:", e.message);
      return json(res, 500, { error: "internal error" });
    }
  }

  // GET /all — list all tokens with metadata
  if (req.method === "GET" && parts[0] === "all") {
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
      const tokens = files.map(f => {
        const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
        return toEIP7572(meta);
      });
      tokens.sort((a, b) => new Date(b.created) - new Date(a.created));
      return json(res, 200, tokens);
    } catch (e) {
      console.error("GET /all error:", e.message);
      return json(res, 500, { error: "internal error" });
    }
  }

  // GET /factory — factory info + recent launches (from local metadata)
  if (req.method === "GET" && parts[0] === "factory") {
    try {
      const latestFactory = NEW_FACTORIES[NEW_FACTORIES.length - 1];
      // Read from local metadata files (reliable, no RPC needed)
      const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
      const allTokens = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")); } catch { return null; }
      }).filter(Boolean).sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
      const launches = allTokens.slice(0, 10).map(t => ({
        token: t.address, reactor: t.reactor || null, charReactor: t.charReactor || null,
        launcher: t.grower || null, supply: t.supply || null,
        seedUSDC: t.seed ? Number(t.seed).toFixed(2) : null,
        date: t.created || null,
      }));
      return json(res, 200, {
        factory: latestFactory,
        chain: "Base (8453)",
        launchCount: allTokens.length,
        minSeedUSDC: "5.00",
        upstreamReactor: "0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045",
        recentLaunches: launches,
        launchUrl: LAUNCHER_URL,
      });
    } catch (e) {
      console.error("GET /factory error:", e.message);
      return json(res, 500, { error: "internal error" });
    }
  }

  // GET /reactor/:address
  if (req.method === "GET" && parts[0] === "reactor" && parts[1]) {
    try {
      const addr = parts[1].toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr)) return json(res, 400, { error: "invalid address" });
      const factory = getFactory(NEW_FACTORIES[NEW_FACTORIES.length - 1]);
      const isReactor = await factory.isReactor(addr);
      return json(res, 200, { address: addr, isReactor });
    } catch (e) {
      console.error("GET /reactor error:", e.message);
      return json(res, 500, { error: "internal error" });
    }
  }

  // GET /reactor-cards
  if (req.method === "GET" && parts[0] === "reactor-cards") {
    return json(res, 200, reactorCardsCache);
  }

  // GET /leaderboard
  if (req.method === "GET" && parts[0] === "leaderboard") {
    const snapPath = path.join(__dirname, "burn-snapshot.json");
    if (fs.existsSync(snapPath)) {
      try {
        return json(res, 200, JSON.parse(fs.readFileSync(snapPath, "utf8")));
      } catch (e) {
        console.error("GET /leaderboard error:", e.message);
        return json(res, 500, { error: "internal error" });
      }
    }
    return json(res, 404, { error: "no leaderboard data yet" });
  }

  // GET /tokenlist.json — Uniswap Token List standard (EIP-2678)
  // Aggregators, wallets, and portfolio trackers pull from this format
  if (req.method === "GET" && (parts[0] === "tokenlist.json" || parts[0] === "tokenlist")) {
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
      const tokens = [];
      for (const f of files) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
          if (!meta.address || !meta.symbol || !meta.name) continue;
          const addr = meta.address.toLowerCase();
          const entry = {
            chainId: 8453,
            address: ethers.getAddress(addr),
            name: meta.name,
            symbol: meta.symbol,
            decimals: 18,
          };
          if (hasImage(addr)) {
            entry.logoURI = BASE_URL + "/image/" + addr;
          }
          tokens.push(entry);
        } catch (e) { /* skip malformed */ }
      }
      // Version bumps on each request based on token count
      const ver = { major: 1, minor: Math.floor(tokens.length / 10), patch: tokens.length % 10 };
      const list = {
        name: "Unrugable Tokens",
        timestamp: new Date().toISOString(),
        version: ver,
        logoURI: "https://tasern.quest/launcher/og-launcher.png",
        keywords: ["unrugable", "mft", "base", "reactor"],
        tags: {
          launched: { name: "Launched", description: "Tokens launched via Unrugable Launcher" },
          adopted: { name: "Adopted", description: "Tokens adopted into the reactor network" },
        },
        tokens,
      };
      return json(res, 200, list);
    } catch (e) {
      console.error("GET /tokenlist.json error:", e.message);
      return json(res, 500, { error: "internal error" });
    }
  }

  // GET /openapi.json
  if (req.method === "GET" && (parts[0] === "openapi.json" || (parts[0] === "openapi" && parts[1] === "json"))) {
    const specPath = path.join(__dirname, "openapi.json");
    if (fs.existsSync(specPath)) {
      cors(res);
      res.writeHead(200, { "Content-Type": "application/json" });
      fs.createReadStream(specPath).pipe(res);
      return;
    }
    return json(res, 404, { error: "openapi.json not found" });
  }

  // GET /share/:tokenAddress — dynamic OG tags
  if (req.method === "GET" && parts[0] === "share" && parts[1]) {
    const addr = parts[1].toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) return json(res, 400, { error: "invalid address" });
    const metaPath = getMetaPath(addr);
    let title = "MfT Unrugable Launcher";
    let desc = "Launch an unrugable token. Liquidity locked forever.";
    let image = "https://tasern.quest/launcher/og-launcher.png";
    let redirect = LAUNCHER_URL;
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      title = (meta.name || meta.symbol || "Token") + " on MfT Unrugable Launcher";
      desc = (meta.description || meta.symbol + " launched on MfT.") + " Liquidity locked forever. Join the network!";
      if (meta.image) image = BASE_URL + meta.image;
      if (meta.reactor) redirect = LAUNCHER_URL + "?ref=" + meta.reactor;
    }
    const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const html = [
      "<!DOCTYPE html><html><head>",
      '<meta charset="utf-8">',
      '<meta property="og:title" content="' + esc(title) + '">',
      '<meta property="og:description" content="' + esc(desc) + '">',
      '<meta property="og:image" content="' + esc(image) + '">',
      '<meta property="og:type" content="website">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title" content="' + esc(title) + '">',
      '<meta name="twitter:description" content="' + esc(desc) + '">',
      '<meta name="twitter:image" content="' + esc(image) + '">',
      '<meta http-equiv="refresh" content="0;url=' + esc(redirect) + '">',
      "</head><body><p>Redirecting to <a href=\"" + esc(redirect) + "\">launcher</a>...</p></body></html>"
    ].join("\n");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // GET /adoption — adoption contract info, or /adoption/{tokenAddr} for specific token
  if (req.method === "GET" && parts[0] === "adoption") {
    try {
      const adoption = getAdoption();
      if (parts[1] && parts[1].startsWith("0x")) {
        const tokenAddr = parts[1];
        const [adopter, reactor] = await Promise.all([
          adoption.adopterOf(tokenAddr),
          adoption.reactorOf(tokenAddr),
        ]);
        const isAdopted = adopter !== ethers.ZeroAddress;
        return json(res, 200, {
          token: tokenAddr,
          isAdopted,
          adopter: isAdopted ? adopter : null,
          reactor: isAdopted ? reactor : null,
          adoptUrl: LAUNCHER_URL.replace("unrugable.html", "adopt.html"),
        });
      }
      const count = Number(await adoption.adoptionCount());
      return json(res, 200, {
        contract: ADOPTION_ADDR,
        chain: "Base (8453)",
        adoptionCount: count,
        fee: "$5 USDC",
        description: "Adopt any existing token into the Unrugable reactor network. Creates permanent locked liquidity and automated buy-back reactor.",
        adoptUrl: LAUNCHER_URL.replace("unrugable.html", "adopt.html"),
      });
    } catch (e) {
      console.error("GET /adoption error:", e.message);
      return json(res, 500, { error: "internal error" });
    }
  }

  // GET /tokenomics
  if (req.method === "GET" && parts[0] === "tokenomics") {
    return json(res, 200, {
      network: "Unrugable Launcher",
      chain: "Base (8453)",
      factory: NEW_FACTORIES[NEW_FACTORIES.length - 1],
      description: "Every token launched creates permanently locked liquidity paired against MfT, cbBTC, WETH, and AZUSD.",
      links: {
        launcher: LAUNCHER_URL,
        reactorDashboard: "https://tasern.quest/launcher/reactor-dashboard.html",
        api: BASE_URL
      }
    });
  }

  json(res, 404, { error: "not found" });
});

// ── Global error handlers — prevent unhandled rejections from crashing PM2 ──
process.on("unhandledRejection", (reason) => {
  console.error(`[${new Date().toISOString()}] Unhandled rejection:`, reason?.message || reason);
});
process.on("uncaughtException", (err) => {
  console.error(`[${new Date().toISOString()}] Uncaught exception:`, err?.message || err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log("MycoPad metadata API running on http://localhost:" + PORT);
});
