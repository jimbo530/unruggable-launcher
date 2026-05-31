#!/usr/bin/env node
// Polls MycoPadV3 factory for TokenLaunched events, inserts into Supabase
// Run: node launch-tracker.js
// PM2: pm2 start launch-tracker.js --name launch-tracker

const path = require("path");
const fs = require("fs");
const localEnv = path.join(__dirname, "..", "..", "Baselings", "api", ".env");
require("dotenv").config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, ".env") });
const { ethers } = require("ethers");

const RPC = "https://mainnet.base.org";
const FACTORIES = [
  "0x73dA1ac6f2f83291acbe2eBCA9Ab4BF970f9dE29", // V4.2
  "0x51eF41E0730c0e607950421e1EE113b089867d3e", // V4.3
  "0xb74fe5fA2D030706B4A0C901fDC42C5244695A6e", // V5
  "0x2e0b2d7c9b0680F3050BB3Da460F9B4E16BB5F3d", // V5.1
  "0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51", // V5.2
  "0x65F8227f37932e1aF1771398DFA76B4079fbDb21", // V5.3
  "0xb1fE1deeA42F85F124E7cB166B2f52a1D7f1d054", // V5.4
  "0x9FCE6fF019570dC09678C6Fcd513bDF5cf766fC9", // V5.5
  "0x2bDF872a40A785E1194ffecB2097B7073c672343", // V5.7 (mftUSD floor)
];
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const POLL_MS = 60_000; // 1 minute

const EVENT_ABI = [
  "event TokenLaunched(address indexed token, address indexed reactor, address indexed charReactor, address launcher, string name, string symbol, uint256 supply, uint256 seed)"
];

const provider = new ethers.JsonRpcProvider(RPC);
const factories = FACTORIES.map(addr => ({
  addr,
  contract: new ethers.Contract(addr, EVENT_ABI, provider)
}));

let lastBlock = 0;

async function loadLastBlock() {
  // Check Supabase for most recent entry's block
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/launched_tokens?select=block_number&order=block_number.desc&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const rows = await res.json();
  if (rows.length > 0 && rows[0].block_number) {
    lastBlock = Number(rows[0].block_number);
    console.log(`Resuming from block ${lastBlock}`);
  } else {
    // Start from current block if no entries
    lastBlock = await provider.getBlockNumber();
    console.log(`No prior entries, starting from block ${lastBlock}`);
  }
}

async function insertLaunch(event, factoryAddr) {
  const { token, reactor, charReactor, launcher, name, symbol, supply, seed } = event.args;
  const block = event.blockNumber;
  const txHash = event.transactionHash;

  const row = {
    token_address: token,
    reactor_address: reactor,
    char_reactor_address: charReactor,
    launcher_address: launcher,
    name,
    symbol,
    supply: supply.toString(),
    seed: seed.toString(),
    factory_address: factoryAddr,
    chain_id: 8453,
    block_number: block,
    tx_hash: txHash
  };

  console.log(`New launch: ${symbol} (${name}) at ${token}`);
  console.log(`  Reactor: ${reactor}, CHAR Reactor: ${charReactor}`);
  console.log(`  Seed: ${ethers.formatUnits(seed, 6)} USDC, Block: ${block}`);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/launched_tokens`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  });

  if (res.ok) {
    console.log(`  Saved to Supabase`);
  } else {
    const err = await res.text();
    console.error(`  Supabase error: ${res.status} ${err}`);
  }
}

async function poll() {
  try {
    const currentBlock = await provider.getBlockNumber();
    if (currentBlock <= lastBlock) return;

    for (const { addr, contract } of factories) {
      const events = await contract.queryFilter("TokenLaunched", lastBlock + 1, currentBlock);
      for (const event of events) {
        await insertLaunch(event, addr);
      }
    }

    lastBlock = currentBlock;
  } catch (e) {
    console.error("Poll error:", e.message);
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Set SUPABASE_URL and SUPABASE_KEY env vars");
    process.exit(1);
  }

  console.log(`Launch tracker started — watching ${FACTORIES.length} factories`);
  await loadLastBlock();

  // Poll immediately, then every POLL_MS
  await poll();
  setInterval(poll, POLL_MS);
}

main();
