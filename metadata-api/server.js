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

// Ensure dirs exist
fs.mkdirSync(IMG_DIR, { recursive: true });

// ── Factory read context (lazy init) ─────────────────────────────────────────
const FACTORY_ADDRESS = "0x51eF41E0730c0e607950421e1EE113b089867d3e";
const FACTORY_ABI = [
  "function launchCount() view returns (uint256)",
  "function getLaunch(uint256 index) view returns (address token, address reactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)",
  "function isReactor(address) view returns (bool)",
  "function reactorOf(address) view returns (address)",
  "function minSeed() view returns (uint256)",
  "function upstreamReactor() view returns (address)",
];
let _provider, _factory;
function getFactory() {
  if (!_factory) {
    _provider = new ethers.JsonRpcProvider(BASE_RPC);
    _factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, _provider);
  }
  return _factory;
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

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  // GET /metadata/:address — return metadata JSON
  if (req.method === "GET" && parts[0] === "metadata" && parts[1]) {
    const addr = parts[1].toLowerCase();
    const metaPath = getMetaPath(addr);
    if (!fs.existsSync(metaPath)) return json(res, 404, { error: "not found" });
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return json(res, 200, meta);
  }

  // GET /image/:address — return the image file
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

  // POST /metadata/:address — store metadata + image
  // Body: JSON with { name, symbol, supply, seed, reactor, grower, image (base64 data URL) }
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
          imageUrl = `/image/${addr}`;
        }
      }

      // Save metadata
      const meta = {
        address: addr,
        name,
        symbol,
        supply: supply || null,
        seed: seed || null,
        reactor: reactor || null,
        grower: grower || null,
        image: imageUrl,
        created: new Date().toISOString()
      };
      fs.writeFileSync(getMetaPath(addr), JSON.stringify(meta, null, 2));

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
        const [token, reactor, launcher, supply, seed, timestamp] = await factory.getLaunch(i);
        launches.push({
          token, reactor, launcher,
          supply: ethers.formatUnits(supply, 18),
          seedETH: ethers.formatEther(seed),
          date: new Date(Number(timestamp) * 1000).toISOString(),
        });
      }
      return json(res, 200, {
        factory: FACTORY_ADDRESS,
        chain: "Base (8453)",
        launchCount: total,
        minSeedETH: ethers.formatEther(minSeed),
        upstreamReactor: upstream,
        recentLaunches: launches,
        launchUrl: "https://mycopad.memefortrees.com",
        sdkUrl: "npm install / import from agent-sdk/launch.js",
      });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // GET /reactor/:address — check if address is a registered reactor
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

  // GET /leaderboard — latest burn leaderboard snapshot
  if (req.method === "GET" && parts[0] === "leaderboard") {
    // Local file (burn-leaderboard.js saves here)
    const snapPath = path.join(__dirname, "burn-snapshot.json");
    if (fs.existsSync(snapPath)) {
      try {
        return json(res, 200, JSON.parse(fs.readFileSync(snapPath, "utf8")));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    return json(res, 404, { error: "no leaderboard data yet — run burn-leaderboard.js first" });
  }

  // GET /openapi.json — OpenAPI spec for agent discovery
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

  // GET /share/:tokenAddress — dynamic OG tags for X/Twitter share cards
  if (req.method === "GET" && parts[0] === "share" && parts[1]) {
    const addr = parts[1].toLowerCase();
    const metaPath = getMetaPath(addr);
    const baseUrl = "https://tasern.quest/api/unruggable";
    const launcherUrl = "https://tasern.quest/launcher/unruggable.html";
    let title = "MfT Unruggable Launcher";
    let desc = "Launch an unruggable token. Liquidity locked forever.";
    let image = "https://tasern.quest/launcher/og-launcher.png";
    let redirect = launcherUrl;
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      title = (meta.name || meta.symbol || "Token") + " on MfT Unruggable Launcher";
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

  // GET /tokenomics — infrastructure token overview for agents
  if (req.method === "GET" && parts[0] === "tokenomics") {
    return json(res, 200, {
      network: "Unruggable Launcher",
      chain: "Base (8453)",
      factory: FACTORY_ADDRESS,
      description: "Every token launched creates permanently locked liquidity paired against MfT, BB, and EB. More launches = more volume = higher floors for all infrastructure tokens.",
      infrastructureTokens: {
        MfT: {
          role: "Network heartbeat — every launched token has 3 sell walls paired against MfT at 1.1x, 2x, 5x launch price",
          token: "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3",
          mechanism: "Reactor Prime collects all upstream fees and pumps MfT. More launches = longer call line = bigger aggregate push.",
          garden: "https://app.gardens.fund/gardens/8453/0x630dcb0eae7231c7afc8a6414c8c6732b25f8b84/0x944c64f899f48dc5b84b5eab3cba93af32ad729a",
          gardenInfo: "Stake MfT to vote on which pools get deeper liquidity. Withdraw any time."
        },
        BB: {
          role: "Floor token — 30% of every launch seed creates TOKEN/BB floor pool",
          token: "0xf967bf3dccF8b6826F82de1781C98E61Bda3b106",
          mechanism: "BTC-correlated floor. As BTC rises, BB floors appreciate in dollar terms."
        },
        EB: {
          role: "Floor token — 30% of every launch seed creates TOKEN/EB floor pool",
          token: "0x17a176Ab2379b86F1E65D79b03bD8c75981244D8",
          mechanism: "ETH-correlated floor. As ETH rises, EB floors appreciate in dollar terms."
        },
        AZUSD: {
          role: "Green stablecoin floor — 40% of every launch seed creates TOKEN/AZUSD floor pool",
          token: "0x3595ca37596D5895B70EFAB592ac315D5B9809B2",
          mechanism: "Dollar-pegged green stablecoin. AZUSD is an environmentally positive asset — every floor pool supports the environment just by existing. Combined with CHAR carbon retirement, launches are net-positive for the planet."
        },
        CHAR: {
          role: "Carbon retirement — 6% of launch seed funds CHAR reactor pools",
          token: "0x20b048fA035D5763685D695e66aDF62c5D9F5055",
          mechanism: "Every trade burns CHAR, permanently retiring carbon credits. CHAR reactor feeds upstream into Unruggable network."
        }
      },
      reactorChain: {
        description: "Bottom-up fire order. Each reactor sells MfT as it compounds, temporarily pushing price down. Reactor Prime fires last with accumulated fees from entire network — the pump.",
        order: [
          "Token CHAR Reactors (bottom)",
          "Token Primary Reactors",
          "Feeder Reactors",
          "Band Reactors (BB/EB)",
          "Unruggable Hub",
          "Main Chain (TGN → AZUSD → BURGERS → CHAR → EGP)",
          "MfT V1 Reactor Prime (top — all fees funnel here)"
        ],
        upstreamFee: "5% of collected fees at each level",
        flywheel: "Arb bots equalize MfT price across pools after each reactor fires, generating more fees, feeding more reactors. Self-sustaining."
      },
      agentOpportunity: {
        thesis: "BB, EB, and MfT are index funds for the Unruggable network. Every new launch deepens their liquidity and generates volume through their pools.",
        actions: [
          "Accumulate MfT/BB/EB as infrastructure plays",
          "Stake MfT in Garden to vote for pools that benefit your holdings",
          "Launch tokens to generate network activity",
          "Call execute() on reactors to trigger burn+compound cycles (permissionless, every 2hrs)",
          "Arb MfT price discrepancies across pools after reactor fires"
        ]
      },
      links: {
        launcher: "https://tasern.quest/launcher/unruggable.html",
        networkMap: "https://tasern.quest/launcher/reactor-map.html",
        garden: "https://app.gardens.fund/gardens/8453/0x630dcb0eae7231c7afc8a6414c8c6732b25f8b84/0x944c64f899f48dc5b84b5eab3cba93af32ad729a",
        api: "https://tasern.quest/api/unruggable",
        basescan: "https://basescan.org/address/" + FACTORY_ADDRESS
      }
    });
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`MycoPad metadata API running on http://localhost:${PORT}`);
  console.log(`  POST /metadata/:address  — store token metadata + image`);
  console.log(`  GET  /metadata/:address  — get token metadata`);
  console.log(`  GET  /image/:address     — get token image`);
  console.log(`  GET  /all                — list all tokens`);
  console.log(`  GET  /factory            — factory info + recent launches (agents)`);
  console.log(`  GET  /reactor/:address   — check if address is a reactor`);
});
