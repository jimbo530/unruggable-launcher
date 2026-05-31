#!/usr/bin/env node
/**
 * update-leaderboard.js — Reads ImpactGenerator events and updates
 * the static LEADERBOARD_DATA in generator.html. Run weekly.
 *
 * Usage: node tools/update-leaderboard.js
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const GENERATOR = '0xe0cD43F031A9F8b3C5A2eB89EA0B1fCa06B6C4b1';
const DEPLOY_BLOCK = 30000000; // approximate deploy block, adjust if needed
const BATCH_SIZE = 50000;

const POOL_TOKENS = [
  '0x8fb87d13b40b1a67b22ed1a17e2835fe7e3a9ba3',
  '0x06a05043eb2c1691b19c2c13219db9212269ddc5',
  '0xd75dfa972c6136f1c594fec1945302f885e1ab29'
];

const TOKEN_NAMES = {
  '0x8fb87d13b40b1a67b22ed1a17e2835fe7e3a9ba3': 'Meme for Trees',
  '0x06a05043eb2c1691b19c2c13219db9212269ddc5': 'BURGERS',
  '0xd75dfa972c6136f1c594fec1945302f885e1ab29': 'TGN'
};

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const gen = new ethers.Contract(GENERATOR, [
    'event LiquidityCompounded(uint256 indexed poolIndex, uint256 moneyUsed, uint256 xBought)',
    'event XTokenBurned(address indexed xToken, uint256 amount)'
  ], provider);

  const currentBlock = await provider.getBlockNumber();
  console.log(`Scanning blocks ${DEPLOY_BLOCK} to ${currentBlock} (${currentBlock - DEPLOY_BLOCK} blocks)`);

  const moneyByToken = {};
  const burnedByToken = {};

  // Batch event queries to avoid RPC limits
  for (let from = DEPLOY_BLOCK; from <= currentBlock; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE - 1, currentBlock);
    process.stdout.write(`  Batch ${from}-${to}...`);

    const [compoundLogs, burnLogs] = await Promise.all([
      gen.queryFilter(gen.filters.LiquidityCompounded(), from, to),
      gen.queryFilter(gen.filters.XTokenBurned(), from, to)
    ]);

    for (const log of compoundLogs) {
      const poolIdx = Number(log.args[0]);
      const moneyUsed = log.args[1];
      const addr = POOL_TOKENS[poolIdx] || 'unknown';
      moneyByToken[addr] = (moneyByToken[addr] || 0n) + moneyUsed;
    }
    for (const log of burnLogs) {
      const addr = log.args[0].toLowerCase();
      const amount = log.args[1];
      burnedByToken[addr] = (burnedByToken[addr] || 0n) + amount;
    }

    console.log(` ${compoundLogs.length} compounds, ${burnLogs.length} burns`);
  }

  // Build output
  const entries = POOL_TOKENS.map(addr => ({
    name: TOKEN_NAMES[addr] || addr.slice(0, 10),
    money: Number(ethers.formatUnits(moneyByToken[addr] || 0n, 6)),
    burned: Number(ethers.formatUnits(burnedByToken[addr] || 0n, 18))
  })).sort((a, b) => b.money - a.money);

  const totalMoney = entries.reduce((s, e) => s + e.money, 0);
  const today = new Date().toISOString().slice(0, 10);

  const data = {
    updated: today,
    totalMoney: Math.round(totalMoney * 100) / 100,
    entries: entries.map(e => ({
      name: e.name,
      money: Math.round(e.money * 100) / 100,
      burned: Math.round(e.burned)
    }))
  };

  console.log('\nLeaderboard data:');
  console.log(JSON.stringify(data, null, 2));

  // Update generator.html
  const genPath = path.join(__dirname, '..', 'site', 'generator.html');
  let html = fs.readFileSync(genPath, 'utf8');

  const regex = /const LEADERBOARD_DATA = \{[\s\S]*?\};/;
  const replacement = `const LEADERBOARD_DATA = ${JSON.stringify(data, null, 2)};`;

  if (regex.test(html)) {
    html = html.replace(regex, replacement);
    fs.writeFileSync(genPath, html);
    console.log('\n✓ Updated site/generator.html');
  } else {
    console.error('\n✗ Could not find LEADERBOARD_DATA in generator.html');
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
