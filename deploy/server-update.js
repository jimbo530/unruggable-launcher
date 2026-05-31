// MycoPad Token Metadata API
// Stores token images and metadata for the launchpad gallery.
// Deploy on VPS: node server.js (runs on port 3456)

const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const PORT = 3456;
const DATA_DIR = path.join(__dirname, "data");
const IMG_DIR = path.join(DATA_DIR, "images");
const BASE_RPC = "https://mainnet.base.org";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hhniimufxjjgmessjtbc.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

// Ensure dirs exist
fs.mkdirSync(IMG_DIR, { recursive: true });

// ── Factory read context (lazy init) ─────────────────────────────────────────
const FACTORIES = [
  "0x655e0Ca995D10912574a92a3a67AE9D466424925",
  "0xb74fe5fA2D030706B4A0C901fDC42C5244695A6e",
  "0x2e0b20a4FFEaCAcB8D3CD0cF6b9bBE6660c4262e"
];
const FACTORY_ABI = [
  "function launchCount() view returns (uint256)",
  "function getLaunch(uint256 index) view returns (address token, address reactor, address charReactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)",
  "function isReactor(address) view returns (bool)",
  "function reactorOf(address) view returns (address)",
  "function minSeed() view returns (uint256)",
  "function upstreamReactor() view returns (address)",
];
let _provider;
function getProvider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(BASE_RPC);
  return _provider;
}
function getFactory(addr) {
  return new ethers.Contract(addr || FACTORIES[FACTORIES.length - 1], FACTORY_ABI, getProvider());
}

function getMetaPath(addr) {
  return path.join(DATA_DIR, addr.toLowerCase() + ".json");
}

function getImgPath(addr, ext) {
  return path.join(IMG_DIR, addr.toLowerCase() + "." + ext);
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
      factory_address: body.factoryAddress || FACTORIES[FACTORIES.length - 1],
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

// ── Reactor cards cache ────────���────────────────────────────────────────────
// Reads xTokens from all launched reactor pools, caches result.
// Pools are permanent — once discovered, never removed from cache.
let reactorCardsCache = {}; // { reactorAddr: [xToken1, xToken2, ...] }
const REACTOR_POOL_ABI = [
  "function poolCount() view returns (uint256)",
  "function pools(uint256) view returns (uint256 tokenId, address xToken, address poolAddress, uint24 fee, bool tokenIsToken0, bool disabled)",
];
const CARDS_CACHE_PATH = path.join(__dirname, "reactor-cards.json");

// Load from disk on startup
if (fs.existsSync(CARDS_CACHE_PATH)) {
  try { reactorCardsCache = JSON.parse(fs.readFileSync(CARDS_CACHE_PATH, "utf8")); } catch (e) { console.warn('server-update: failed to load reactor cards cache:', e.message || e); }
}

async function refreshReactorCards() {
  try {
    const provider = getProvider();
    // Discover all reactors from all factories
    const reactors = [];
    for (const factoryAddr of FACTORIES) {
      const factory = getFactory(factoryAddr);
      let count;
      try { count = Number(await factory.launchCount()); } catch (e) { console.warn('server-update: failed to read launchCount:', e.message || e); continue; }
      for (let i = 0; i < count; i++) {
        try {
          const l = await factory.getLaunch(i);
          reactors.push(l.reactor, l.charReactor);
        } catch (e) { console.warn('server-update: failed to getLaunch index', i, e.message || e); }
      }
    }
    // For each reactor, read pools and collect xTokens
    for (const addr of reactors) {
      const key = addr.toLowerCase();
      const rx = new ethers.Contract(addr, REACTOR_POOL_ABI, provider);
      let poolCount;
      try { poolCount = Number(await rx.poolCount()); } catch (e) { console.warn('server-update: failed to read poolCount for', addr, e.message || e); continue; }
      const existing = new Set(reactorCardsCache[key] || []);
      for (let i = 0; i < poolCount; i++) {
        try {
          const pool = await rx.pools(i);
          const xt = pool.xToken.toLowerCase();
          existing.add(xt);
        } catch (e) { console.warn('server-update: failed to read pool', i, 'from reactor', addr, e.message || e); }
      }
      reactorCardsCache[key] = [...existing];
    }
    // Save to disk
    fs.writeFileSync(CARDS_CACHE_PATH, JSON.stringify(reactorCardsCache, null, 2));
    console.log("Reactor cards cache updated:", Object.keys(reactorCardsCache).length, "reactors");
  } catch (e) {
    console.error("Reactor cards refresh error:", e.message);
  }
}

// Refresh on startup (delayed 10s) then every 30 min
setTimeout(refreshReactorCards, 10000);
setInterval(refreshReactorCards, 30 * 60 * 1000);

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, "http://localhost:" + PORT);
  const parts = url.pathname.split("/").filter(Boolean);

  // GET /metadata/:address
  if (req.method === "GET" && parts[0] === "metadata" && parts[1]) {
    const addr = parts[1].toLowerCase();
    const metaPath = getMetaPath(addr);
    if (!fs.existsSync(metaPath)) return json(res, 404, { error: "not found" });
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return json(res, 200, meta);
  }

  // GET /image/:address
  if (req.method === "GET" && parts[0] === "image" && parts[1]) {
    const addr = parts[1].toLowerCase();
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "svg"]) {
      const imgPath = getImgPath(addr, ext);
      if (fs.existsSync(imgPath)) {
        const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
        cors(res);
        res.writeHead(200, { "Content-Type": mimeMap[ext], "Cache-Control": "public, max-age=86400" });
        fs.createReadStream(imgPath).pipe(res);
        return;
      }
    }
    return json(res, 404, { error: "no image" });
  }

  // POST /metadata/:address — store metadata + image + save to Supabase
  if (req.method === "POST" && parts[0] === "metadata" && parts[1]) {
    try {
      const addr = parts[1].toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr)) return json(res, 400, { error: "invalid address" });

      const body = JSON.parse((await parseBody(req)).toString("utf8"));
      const { name, symbol, supply, seed, reactor, grower, image } = body;

      if (!name || !symbol) return json(res, 400, { error: "name and symbol required" });

      // Save image if provided (base64 data URL)
      let imageUrl = null;
      if (image && image.startsWith("data:image/")) {
        const match = image.match(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,(.+)$/);
        if (match) {
          const ext = match[1].replace("+xml", "");
          const buf = Buffer.from(match[2], "base64");
          if (buf.length > 2 * 1024 * 1024) return json(res, 400, { error: "image too large (2MB max)" });
          fs.writeFileSync(getImgPath(addr, ext), buf);
          imageUrl = "/image/" + addr;
        }
      }

      // Save metadata
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

      // Save to Supabase launched_tokens (non-blocking)
      if (reactor) {
        saveToSupabase(addr, body);
      }

      return json(res, 200, { ok: true, metadata: meta });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // GET /all — list all tokens with metadata
  if (req.method === "GET" && parts[0] === "all") {
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
      const tokens = files.map(f => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")));
      tokens.sort((a, b) => new Date(b.created) - new Date(a.created));
      return json(res, 200, tokens);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // GET /factory — factory info + recent launches (for agents)
  if (req.method === "GET" && parts[0] === "factory") {
    try {
      const factory = getFactory();
      const [launchCount, minSeed, upstream] = await Promise.all([
        factory.launchCount(),
        factory.minSeed(),
        factory.upstreamReactor(),
      ]);
      const total = Number(launchCount);
      const count = Math.min(total, 10);
      const launches = [];
      for (let i = total - 1; i >= total - count; i--) {
        const l = await factory.getLaunch(i);
        launches.push({
          token: l.token, reactor: l.reactor, charReactor: l.charReactor, launcher: l.launcher,
          supply: ethers.formatUnits(l.supply, 18),
          seedUSDC: (Number(l.seed) / 1e6).toFixed(2),
          date: new Date(Number(l.timestamp) * 1000).toISOString(),
        });
      }
      return json(res, 200, {
        factory: FACTORIES[FACTORIES.length - 1],
        chain: "Base (8453)",
        launchCount: total,
        minSeedUSDC: (Number(minSeed) / 1e6).toFixed(2),
        upstreamReactor: upstream,
        recentLaunches: launches,
        launchUrl: "https://tasern.quest/launcher/unrugable.html",
      });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // GET /reactor/:address
  if (req.method === "GET" && parts[0] === "reactor" && parts[1]) {
    try {
      const addr = parts[1].toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr)) return json(res, 400, { error: "invalid address" });
      const factory = getFactory();
      const isReactor = await factory.isReactor(addr);
      return json(res, 200, { address: addr, isReactor });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // GET /reactor-cards — cached xToken badges per reactor
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
        return json(res, 500, { error: e.message });
      }
    }
    return json(res, 404, { error: "no leaderboard data yet" });
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
    const metaPath = getMetaPath(addr);
    const baseUrl = "https://tasern.quest/api/unrugable";
    const launcherUrl = "https://tasern.quest/launcher/unrugable.html";
    let title = "MfT Unrugable Launcher";
    let desc = "Launch an unrugable token. Liquidity locked forever.";
    let image = "https://tasern.quest/launcher/og-launcher.png";
    let redirect = launcherUrl;
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      title = (meta.name || meta.symbol || "Token") + " on MfT Unrugable Launcher";
      desc = (meta.description || meta.symbol + " launched on MfT.") + " Liquidity locked forever. Join the network!";
      if (meta.image) image = baseUrl + meta.image;
      if (meta.reactor) redirect = launcherUrl + "?ref=" + meta.reactor;
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

  // GET /tokenomics
  if (req.method === "GET" && parts[0] === "tokenomics") {
    return json(res, 200, {
      network: "Unrugable Launcher",
      chain: "Base (8453)",
      factory: FACTORIES[FACTORIES.length - 1],
      description: "Every token launched creates permanently locked liquidity paired against MfT, BB, and EB.",
      links: {
        launcher: "https://tasern.quest/launcher/unrugable.html",
        reactorDashboard: "https://tasern.quest/launcher/reactor-dashboard.html",
        api: "https://tasern.quest/api/unrugable"
      }
    });
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log("MycoPad metadata API running on http://localhost:" + PORT);
});
