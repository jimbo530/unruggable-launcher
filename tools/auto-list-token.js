#!/usr/bin/env node
// auto-list-token.js — Post-launch auto-lister
// Submits new token metadata + logo to all free automatable platforms
//
// Usage: node auto-list-token.js <tokenAddress>
// Env:   GITHUB_TOKEN          — GitHub PAT for Trust Wallet PR
//        BASESCAN_API_KEY      — for auto-verification of child contracts
//        MYCOPAD_API_SECRET    — metadata API auth (optional, factory tokens auto-verify)

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const BASE_RPC = "https://mainnet.base.org";
const METADATA_API = "https://tasern.quest/api/unrugable";
const TRUSTWALLET_REPO = "trustwallet/assets";
const CHAIN_DIR = "blockchains/base/assets";

// ── Helpers ─────────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "UnrugableLauncher/1.0" } }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    }).on("error", reject);
  });
}

function githubApi(method, endpoint, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "api.github.com",
      path: endpoint,
      method,
      headers: {
        "User-Agent": "UnrugableLauncher/1.0",
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github.v3+json",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const respBody = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(respBody) }); }
        catch { resolve({ status: res.statusCode, data: respBody }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function basescanApi(params) {
  const key = process.env.BASESCAN_API_KEY;
  if (!key) return Promise.resolve(null);
  const qs = new URLSearchParams({ ...params, apikey: key }).toString();
  return httpGet("https://api.basescan.org/api?" + qs);
}

// ── 1. Fetch token metadata from our API ────────────────────────────────────

async function getTokenMeta(addr) {
  const res = await httpGet(METADATA_API + "/metadata/" + addr.toLowerCase());
  if (res.status !== 200) throw new Error("Token not found in metadata API: " + addr);
  return JSON.parse(res.body);
}

// ── 2. Download token logo from our API ─────────────────────────────────────

async function getTokenLogo(addr) {
  const res = await httpGet(METADATA_API + "/image/" + addr.toLowerCase());
  if (res.status !== 200) return null;
  // Re-fetch as binary
  return new Promise((resolve, reject) => {
    https.get(METADATA_API + "/image/" + addr.toLowerCase(), (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

// ── 3. Trust Wallet Assets auto-PR ──────────────────────────────────────────

async function submitTrustWallet(addr, meta, logoBuf) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.log("  [TrustWallet] SKIP — no GITHUB_TOKEN env var"); return; }
  if (!logoBuf) { console.log("  [TrustWallet] SKIP — no logo image available"); return; }

  const checksumAddr = ethers.getAddress(addr);
  console.log("  [TrustWallet] Creating PR for", meta.symbol, checksumAddr);

  // Step 1: Get our GitHub username
  const userRes = await githubApi("GET", "/user", null, token);
  if (userRes.status !== 200) { console.log("  [TrustWallet] FAIL — bad GitHub token"); return; }
  const username = userRes.data.login;

  // Step 2: Fork the repo (idempotent — returns existing fork if already forked)
  console.log("  [TrustWallet] Forking", TRUSTWALLET_REPO, "...");
  const forkRes = await githubApi("POST", "/repos/" + TRUSTWALLET_REPO + "/forks", {}, token);
  if (forkRes.status !== 202 && forkRes.status !== 200) {
    console.log("  [TrustWallet] FAIL — could not fork:", forkRes.status, JSON.stringify(forkRes.data).slice(0, 200));
    return;
  }
  // Wait for fork to be ready
  await new Promise(r => setTimeout(r, 3000));

  // Step 3: Get default branch ref
  const refRes = await githubApi("GET", "/repos/" + username + "/assets/git/ref/heads/master", null, token);
  if (refRes.status !== 200) {
    console.log("  [TrustWallet] FAIL — could not get ref:", refRes.status);
    return;
  }
  const baseSha = refRes.data.object.sha;

  // Step 4: Create branch
  const branchName = "add-" + meta.symbol.toLowerCase() + "-base-" + Date.now();
  const branchRes = await githubApi("POST", "/repos/" + username + "/assets/git/refs", {
    ref: "refs/heads/" + branchName,
    sha: baseSha,
  }, token);
  if (branchRes.status !== 201) {
    console.log("  [TrustWallet] FAIL — could not create branch:", branchRes.status);
    return;
  }

  // Step 5: Upload logo.png
  const logoPath = CHAIN_DIR + "/" + checksumAddr + "/logo.png";
  const logoB64 = logoBuf.toString("base64");
  const uploadRes = await githubApi("PUT", "/repos/" + username + "/assets/contents/" + logoPath, {
    message: "Add " + meta.symbol + " logo on Base",
    content: logoB64,
    branch: branchName,
  }, token);
  if (uploadRes.status !== 201) {
    console.log("  [TrustWallet] FAIL — could not upload logo:", uploadRes.status);
    return;
  }

  // Step 6: Upload info.json
  const info = {
    name: meta.name,
    symbol: meta.symbol,
    type: "ERC20",
    decimals: 18,
    description: meta.description || (meta.name + " — launched on Unrugable Launcher. Liquidity locked forever."),
    website: "https://tasern.quest/launcher/unrugable.html",
    explorer: "https://basescan.org/token/" + checksumAddr,
    status: "active",
    id: checksumAddr,
    links: [
      { name: "twitter", url: "https://x.com/memefortrees" },
      { name: "website", url: "https://tasern.quest" },
    ],
  };
  const infoPath = CHAIN_DIR + "/" + checksumAddr + "/info.json";
  const infoB64 = Buffer.from(JSON.stringify(info, null, 2)).toString("base64");
  const infoRes = await githubApi("PUT", "/repos/" + username + "/assets/contents/" + infoPath, {
    message: "Add " + meta.symbol + " info on Base",
    content: infoB64,
    branch: branchName,
  }, token);
  if (infoRes.status !== 201) {
    console.log("  [TrustWallet] WARN — info.json upload failed (logo PR still valid):", infoRes.status);
  }

  // Step 7: Create PR
  const prRes = await githubApi("POST", "/repos/" + TRUSTWALLET_REPO + "/pulls", {
    title: "Add " + meta.symbol + " (" + meta.name + ") on Base",
    body: "Adding " + meta.symbol + " token on Base chain.\n\n"
      + "- Contract: `" + checksumAddr + "`\n"
      + "- [BaseScan](" + "https://basescan.org/token/" + checksumAddr + ")\n"
      + "- Liquidity permanently locked via Unrugable Launcher reactor\n"
      + "- Logo: 256x256 PNG\n",
    head: username + ":" + branchName,
    base: "master",
  }, token);

  if (prRes.status === 201) {
    console.log("  [TrustWallet] SUCCESS — PR created:", prRes.data.html_url);
  } else {
    console.log("  [TrustWallet] FAIL — PR creation:", prRes.status, JSON.stringify(prRes.data).slice(0, 300));
  }
}

// ── 4. Basescan auto-verify child contract ──────────────────────────────────

async function verifyOnBasescan(addr, meta) {
  const key = process.env.BASESCAN_API_KEY;
  if (!key) { console.log("  [Basescan] SKIP — no BASESCAN_API_KEY"); return; }

  // Check if already verified
  const checkRes = await basescanApi({
    module: "contract", action: "getabi", address: addr,
  });
  if (checkRes) {
    const parsed = JSON.parse(checkRes.body);
    if (parsed.status === "1") {
      console.log("  [Basescan] Already verified");
      return;
    }
  }

  // Read the flattened source or compile input
  // For factory-deployed tokens, we need the LaunchToken source + constructor args
  const srcPath = path.join(__dirname, "..", "contracts", "LaunchToken.sol");
  if (!fs.existsSync(srcPath)) {
    console.log("  [Basescan] SKIP — LaunchToken.sol not found locally");
    return;
  }
  const source = fs.readFileSync(srcPath, "utf8");

  // Encode constructor args: (string name, string symbol, uint256 supply, address recipient, string baseURI)
  // We need to fetch these from chain
  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const token = new ethers.Contract(addr, [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
  ], provider);

  let tokenName, tokenSymbol, totalSupply;
  try {
    [tokenName, tokenSymbol, totalSupply] = await Promise.all([
      token.name(), token.symbol(), token.totalSupply(),
    ]);
  } catch (e) {
    console.log("  [Basescan] SKIP — cannot read token data:", e.message);
    return;
  }

  // Find which factory deployed this token to get the recipient (factory address)
  // and the METADATA_BASE URI
  // For now, encode with known METADATA_BASE
  const metadataBase = "https://tasern.quest/api/unrugable/metadata/";
  const abiCoder = new ethers.AbiCoder();
  const constructorArgs = abiCoder.encode(
    ["string", "string", "uint256", "address", "string"],
    [tokenName, tokenSymbol, totalSupply, addr, metadataBase] // recipient = needs to be factory
  );

  // Note: The recipient in constructor was the factory, not the token itself.
  // We'd need to determine which factory deployed it. For now, attempt verification
  // using hardhat verify which handles this better.
  console.log("  [Basescan] Auto-verify via API is complex for factory children.");
  console.log("  [Basescan] Use: npx hardhat verify --network base", addr, tokenName, tokenSymbol, totalSupply.toString(), "<factoryAddr>", metadataBase);
  console.log("  [Basescan] Or verify the factory contract — Basescan can then show child source via 'Similar Match Source Code'.");
}

// ── 5. Update our own token list (trigger refresh) ──────────────────────────

async function refreshTokenList() {
  try {
    const res = await httpGet(METADATA_API + "/tokenlist.json");
    if (res.status === 200) {
      const list = JSON.parse(res.body);
      console.log("  [TokenList] Refreshed — now serving", list.tokens.length, "tokens");
    }
  } catch (e) {
    console.log("  [TokenList] WARN — could not refresh:", e.message);
  }
}

// ── 6. Notify metadata for Sourcify / contract metadata ─────────────────────

async function checkSourcify(addr) {
  try {
    const res = await httpGet("https://repo.sourcify.dev/contracts/full_match/8453/" + ethers.getAddress(addr) + "/metadata.json");
    if (res.status === 200) {
      console.log("  [Sourcify] Already verified on Sourcify");
    } else {
      console.log("  [Sourcify] Not on Sourcify — verify factory to get child coverage");
    }
  } catch (e) {
    console.log("  [Sourcify] Check failed:", e.message);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const addr = process.argv[2];
  if (!addr || !addr.startsWith("0x")) {
    console.log("Usage: node auto-list-token.js <tokenAddress>");
    console.log("");
    console.log("Env vars:");
    console.log("  GITHUB_TOKEN       — GitHub PAT for Trust Wallet PR");
    console.log("  BASESCAN_API_KEY   — for Basescan verification");
    process.exit(1);
  }

  console.log("\n=== Auto-Listing Token:", addr, "===\n");

  // Get metadata
  let meta;
  try {
    meta = await getTokenMeta(addr);
    console.log("Token:", meta.name, "(" + meta.symbol + ")");
  } catch (e) {
    console.error("FATAL:", e.message);
    console.log("Make sure the token has metadata at", METADATA_API + "/metadata/" + addr.toLowerCase());
    process.exit(1);
  }

  // Get logo
  const logoBuf = await getTokenLogo(addr);
  console.log("Logo:", logoBuf ? (logoBuf.length + " bytes") : "none");
  console.log("");

  // Run all submissions
  console.log("[1/5] Token List (auto-served)...");
  await refreshTokenList();

  console.log("[2/5] Trust Wallet Assets PR...");
  await submitTrustWallet(addr, meta, logoBuf);

  console.log("[3/5] Basescan verification...");
  await verifyOnBasescan(addr, meta);

  console.log("[4/5] Sourcify check...");
  await checkSourcify(addr);

  console.log("[5/5] Platform auto-index status...");
  console.log("  [Defined.fi] Auto-indexed from DEX pools (no action needed)");
  console.log("  [GeckoTerminal] Auto-indexed from DEX pools (no action needed)");
  console.log("  [GoPlus] Auto-scanned (no action needed)");
  console.log("  [TokenSniffer] Auto-scanned (no action needed)");
  console.log("  [DexTools] Auto-indexed from DEX pools (no action needed)");

  console.log("\n=== Done ===");
  console.log("\nManual steps remaining (one-time, not per-token):");
  console.log("  - Submit token list URL to aggregators: " + METADATA_API + "/tokenlist.json");
  console.log("  - CoinGecko: manual form at https://www.coingecko.com/en/coins/new");
  console.log("  - CoinMarketCap: manual form at https://coinmarketcap.com/listing/");
  console.log("");
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
