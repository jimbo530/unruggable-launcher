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
const FACTORY_ADDRESS = "0xbfE4fa5B630d662c375b8F06CF26e75f91CcA4d5";
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
