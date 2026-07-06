#!/usr/bin/env node
/**
 * init-wallet.js — generate the First Citizen's OWN dedicated wallet (Base).
 *
 * Writes a fresh privkey to ../../.citizen-wallet.env (seas root) and prints the ADDRESS as JSON
 * so the founder can fund it. IDEMPOTENT + SAFE: if the env file already exists it NEVER
 * overwrites (refuses, prints the existing address) — we never clobber a key that may hold funds
 * (memory: never_change_keys). This wallet is the Citizen's alone; it is NOT the shared agent
 * treasury 0xE2a4… (peg-bot) and NOT the shark wallet.
 *
 *   node citizen/tools/init-wallet.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ENV_PATH = path.join(__dirname, '..', '..', '.citizen-wallet.env');

function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

function readExisting() {
  if (!fs.existsSync(ENV_PATH)) return null;
  const txt = fs.readFileSync(ENV_PATH, 'utf8');
  const m = txt.match(/CITIZEN_PRIVATE_KEY\s*=\s*(0x[0-9a-fA-F]{64})/);
  if (!m) throw new Error(`${ENV_PATH} exists but has no valid CITIZEN_PRIVATE_KEY — refusing to touch it.`);
  return new ethers.Wallet(m[1]);
}

function main() {
  const existing = readExisting();
  if (existing) {
    out({
      ok: true, created: false, envPath: ENV_PATH, address: existing.address,
      note: 'Wallet already exists — NOT overwritten. Fund this address with a little ETH (gas) + USDC.',
    });
    return;
  }
  const w = ethers.Wallet.createRandom();
  const body =
    '# First Citizen agent-player wallet (Base 8453). DEDICATED — not the shared treasury.\n' +
    '# Generated ' + new Date().toISOString() + ' by init-wallet.js. Keep secret; git-ignored.\n' +
    `CITIZEN_PRIVATE_KEY=${w.privateKey}\n` +
    `CITIZEN_ADDRESS=${w.address}\n`;
  // wx flag = fail if it somehow exists (race-safe; never clobber)
  fs.writeFileSync(ENV_PATH, body, { encoding: 'utf8', flag: 'wx' });
  out({
    ok: true, created: true, envPath: ENV_PATH, address: w.address,
    note: 'NEW wallet created. FUND this address with a little ETH (gas) + USDC, then the founder flips the bot live.',
  });
}

try { main(); } catch (e) { out({ ok: false, tool: 'init-wallet', error: e.message || String(e), hint: 'check write permission on the wallet env file; init is idempotent and never overwrites an existing key.' }); process.exit(1); }
