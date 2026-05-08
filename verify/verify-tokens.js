#!/usr/bin/env node
/**
 * verify-tokens.js — Auto-verify all LaunchToken contracts on Basescan
 *
 * Discovers all tokens from both factories on-chain, checks which
 * are already verified, and submits verification for any that aren't.
 *
 * Usage:
 *   node verify/verify-tokens.js          — scan & verify all unverified tokens
 *   node verify/verify-tokens.js 0xAddr   — verify a specific token address
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config({ path: path.join(__dirname, "..", "tools", ".env") });

const API_KEY = process.env.BASESCAN_API_KEY;
const API_URL = "https://api.etherscan.io/v2/api?chainid=8453";
const RPC = process.env.ALCHEMY_RPC || "https://mainnet.base.org";

if (!API_KEY) {
  console.error("ERROR: Set BASESCAN_API_KEY in tools/.env");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC);

// ── Factory configs ────────────────────────────────────────────────────────
// Compiler settings that produced each factory's embedded LaunchToken.
// Both use: solc 0.8.24, viaIR, runs=1, evmVersion=paris, revertStrings=strip
const FACTORIES = [
  {
    name: "V4.3",
    address: "0x51eF41E0730c0e607950421e1EE113b089867d3e",
    compiler: "v0.8.24+commit.e11b9ed9",
    metadataBase: "https://tasern.quest/api/mycopad/metadata/",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 1 },
      evmVersion: "paris",
      debug: { revertStrings: "strip" },
    },
  },
  {
    name: "V5.2",
    address: "0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51",
    compiler: "v0.8.24+commit.e11b9ed9",
    metadataBase: "https://tasern.quest/api/unruggable/metadata/",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 1 },
      evmVersion: "paris",
      debug: { revertStrings: "strip" },
    },
  },
];

const FACTORY_ABI = [
  "function launchCount() view returns (uint256)",
  "function launches(uint256) view returns (address token, address reactor, address charReactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)",
];

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Retry wrapper for RPC calls ────────────────────────────────────────────
async function retry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

// ── Discover all tokens from all factories ─────────────────────────────────
async function discoverTokens() {
  const tokens = [];
  for (const factory of FACTORIES) {
    const contract = new ethers.Contract(factory.address, FACTORY_ABI, provider);
    const count = Number(await retry(() => contract.launchCount()));
    console.log(`${factory.name} (${factory.address}): ${count} launches`);
    for (let i = 0; i < count; i++) {
      await sleep(1000);
      const [tokenAddr] = await retry(() => contract.launches(i));
      tokens.push({ address: tokenAddr, factory });
    }
  }
  return tokens;
}

// ── Check if already verified on Basescan ──────────────────────────────────
async function isVerified(address) {
  const url = `${API_URL}&module=contract&action=getabi&address=${address}&apikey=${API_KEY}`;
  const resp = await fetch(url);
  const data = await resp.json();
  return data.status === "1";
}

// ── Build standard JSON input for LaunchToken ──────────────────────────────
function buildInput(settings) {
  const source = fs.readFileSync(path.join(__dirname, "..", "contracts", "LaunchToken.sol"), "utf8");
  return JSON.stringify({
    language: "Solidity",
    sources: { "LaunchToken.sol": { content: source } },
    settings: {
      ...settings,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  }, null, 2);
}

// ── ABI-encode constructor args ────────────────────────────────────────────
function encodeConstructorArgs(name, symbol, supply, recipient, baseURI) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "string", "uint256", "address", "string"],
    [name, symbol, supply, recipient, baseURI]
  ).slice(2);
}

// ── Submit verification to Basescan ────────────────────────────────────────
async function submitVerification(address, compiler, sourceCode, constructorArgs) {
  const params = new URLSearchParams({
    apikey: API_KEY,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: address,
    sourceCode,
    codeformat: "solidity-standard-json-input",
    contractname: "LaunchToken.sol:LaunchToken",
    compilerversion: compiler,
    constructorArguements: constructorArgs,
  });
  const resp = await fetch(API_URL, { method: "POST", body: params });
  return resp.json();
}

async function checkStatus(guid) {
  const url = `${API_URL}&apikey=${API_KEY}&module=contract&action=checkverifystatus&guid=${guid}`;
  const resp = await fetch(url);
  return resp.json();
}

// ── Verify a single token ──────────────────────────────────────────────────
async function verifyToken(tokenAddr, factory) {
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
  const [name, symbol, supply] = await Promise.all([
    token.name(), token.symbol(), token.totalSupply(),
  ]);

  console.log(`  ${symbol} (${name}) — ${factory.name} factory`);

  const constructorArgs = encodeConstructorArgs(name, symbol, supply, factory.address, factory.metadataBase);
  const sourceCode = buildInput(factory.settings);

  const result = await submitVerification(tokenAddr, factory.compiler, sourceCode, constructorArgs);

  if (result.result && result.result.includes("Already Verified")) {
    console.log(`  Already verified`);
    return true;
  }

  if (result.status !== "1") {
    console.log(`  API error: ${result.result}`);
    return false;
  }

  const guid = result.result;
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const status = await checkStatus(guid);
    if (status.result === "Pass - Verified") {
      console.log(`  Verified!`);
      return true;
    }
    if (status.result.includes("Already Verified")) {
      console.log(`  Already verified`);
      return true;
    }
    if (status.result.includes("Fail") && !status.result.includes("Pending")) {
      console.log(`  Failed: ${status.result}`);
      return false;
    }
  }
  console.log(`  Timed out waiting for verification`);
  return false;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const singleAddr = process.argv[2];

  if (singleAddr) {
    // Single-token mode: find which factory it belongs to
    console.log(`Verifying single token: ${singleAddr}`);
    const allTokens = await discoverTokens();
    const match = allTokens.find(t => t.address.toLowerCase() === singleAddr.toLowerCase());
    if (!match) {
      console.error(`Token ${singleAddr} not found in any factory. Check the address.`);
      process.exit(1);
    }
    console.log(`\n${match.address}`);
    await verifyToken(match.address, match.factory);
    return;
  }

  // Auto mode: discover all, skip verified, verify the rest
  console.log("Scanning factories for launched tokens...\n");
  const tokens = await discoverTokens();
  console.log(`\nFound ${tokens.length} tokens total. Checking verification status...\n`);

  let alreadyOk = 0, newlyVerified = 0, failed = 0;

  for (const t of tokens) {
    try {
      await sleep(1000);
      const verified = await isVerified(t.address);
      if (verified) {
        let sym = t.address.slice(0, 10);
        try { const tk = new ethers.Contract(t.address, ERC20_ABI, provider); sym = await tk.symbol(); } catch {}
        console.log(`${t.address} (${sym}) — already verified`);
        alreadyOk++;
      } else {
        console.log(`${t.address} — NOT verified, submitting...`);
        const ok = await verifyToken(t.address, t.factory);
        if (ok) newlyVerified++; else failed++;
      }
    } catch (e) {
      console.log(`${t.address} — ERROR: ${e.message.slice(0, 80)}`);
      failed++;
    }
    await sleep(1500);
  }

  console.log(`\nDone: ${alreadyOk} already verified, ${newlyVerified} newly verified, ${failed} failed`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
