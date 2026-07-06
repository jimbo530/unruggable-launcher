#!/usr/bin/env node
'use strict';
/**
 * inventory.js — what do I actually HOLD? Read-only sweep of the wallet's TRADE-GOOD balances
 * (every commodity ERC20 in commodity-tokens.csv except the coins, which wallet.js covers).
 * Loot goods (salt, rations, hides, meats, gems…) are real tradeable wealth — a bot that can't
 * see its own hold can't play the goods economy. This is the missing eye.
 *
 * Paced for the free RPC (small chunks, short gaps) and cached to citizen/brain/cache/ for
 * 15 minutes so repeated ticks don't hammer the provider.
 *
 *   node citizen/tools/inventory.js            # nonzero goods for my profile wallet (cached)
 *   node citizen/tools/inventory.js --fresh    # bypass the cache
 *   node citizen/tools/inventory.js 0xADDR     # sweep a specific address
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const chain = require('../lib/chain.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CSV_PATH = path.join(__dirname, '..', '..', 'commodity-tokens.csv');
const CACHE_DIR = path.join(__dirname, '..', 'brain', 'cache');
const CACHE_TTL_MS = 15 * 60 * 1000;
const CHUNK = 8;          // balanceOf calls per burst
const GAP_MS = 250;       // pause between bursts (free-RPC pacing)

function loadGoods() {
  const rows = fs.readFileSync(CSV_PATH, 'utf8').split(/\r?\n/);
  const goods = [];
  for (const line of rows) {
    if (!line || line.startsWith('#') || line.startsWith('category,')) continue;
    const parts = line.split(',');
    if (parts.length < 5) continue;
    const [category, symbol, name, address, decimals] = parts;
    if (category === 'coin') continue; // wallet.js already reports coins
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
    goods.push({ category, symbol, name, address, decimals: Number(decimals) || 18 });
  }
  return goods;
}

async function sweep(addr, goods) {
  const held = [];
  let errors = 0;
  for (let i = 0; i < goods.length; i += CHUNK) {
    const batch = goods.slice(i, i + CHUNK);
    const bals = await Promise.all(batch.map((g) =>
      chain.erc(g.address).balanceOf(addr).catch(() => { errors++; return null; })
    ));
    for (let j = 0; j < batch.length; j++) {
      const raw = bals[j];
      if (raw === null || raw === 0n) continue;
      const bal = Number(ethers.formatUnits(raw, batch[j].decimals));
      if (bal > 0) held.push({ symbol: batch[j].symbol, category: batch[j].category, balance: bal });
    }
    if (i + CHUNK < goods.length) await sleep(GAP_MS);
  }
  held.sort((a, b) => a.category.localeCompare(b.category) || b.balance - a.balance);
  return { held, errors };
}

(async () => {
  const argAddr = process.argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
  const addr = argAddr || chain.walletAddress();
  if (!addr) { out({ ok: false, tool: 'inventory', error: 'no wallet address', hint: 'pass a 0x address, or run init-wallet.js / set CITIZEN_WALLET_ENV + CITIZEN_KEY_NAME for a profile.' }); process.exit(1); }
  const fresh = process.argv.includes('--fresh');

  const cachePath = path.join(CACHE_DIR, `inventory-${addr.toLowerCase()}.json`);
  if (!fresh && fs.existsSync(cachePath) && Date.now() - fs.statSync(cachePath).mtimeMs < CACHE_TTL_MS) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    out({ ...cached, cached: true });
    return;
  }

  const goods = loadGoods();
  const { held, errors } = await sweep(addr, goods);
  const result = {
    ok: true, tool: 'inventory', address: addr, at: new Date().toISOString(),
    goodsChecked: goods.length, readErrors: errors,
    held,
    note: held.length
      ? 'these goods are real tradeable wealth — sell dear at the right port, or keep what feeds/equips the crew.'
      : 'hold is empty — loot from wins and harvests lands here.',
  };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
  out(result);
})().catch((e) => { out({ ok: false, tool: 'inventory', error: e.message || String(e), hint: 'read failed (RPC) — retry, or pass --fresh to bypass the cache; this is read-only.' }); process.exit(1); });
