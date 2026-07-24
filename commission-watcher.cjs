// ============================================================
//  commission-watcher.cjs — CommissionBooth event watcher → songsmith queue.
//
//  PHASE 2 — STUB ONLY.  Fill BOOTH_ADDRESS after the contract is deployed.
//
//  This watcher runs as a PM2 process (or node daemon) on the VPS.
//  It polls Base for Commissioned events from CommissionBooth and
//  POSTs each one into the existing songsmith queue endpoint.
//
//  ── SONGSMITH QUEUE ENDPOINT (from commission-api/server.js) ────────────────
//
//  The existing commission-api/server.js at port 3060 has:
//
//    POST /submit   { email, xHandle, chain, txHash, answers{...} }
//
//  That endpoint was designed for USDC hero commissions (requires a USDC payment
//  tx, verifies it on-chain before accepting).  The songsmith commission is paid
//  via band token on-chain in the CommissionBooth tx — the USDC check does not
//  apply and the /submit endpoint would reject our txHash (no USDC Transfer log).
//
//  RECOMMENDATION: add a new endpoint to commission-api/server.js:
//
//    POST /submit-song
//    Auth header: Authorization: Bearer <COMMISSION_ADMIN_KEY>
//    Body (JSON):
//      {
//        txHash:   "0x...",           // CommissionBooth tx (dedup key)
//        bandId:   1,                 // uint8
//        band:     "EBM",             // human label
//        token:    "0xF113fe2A...",   // band token address
//        price:    "100000000000000000000000",  // wei string
//        idea:     "a storm at sea", // fan's song idea (trimmed to 500 chars)
//        handle:   "@stormfan",      // fan's X handle
//        payer:    "0xabc...",        // fan's wallet
//        source:   "bankr",          // always "bankr" from this watcher
//        ts:       1720000000         // block.timestamp
//      }
//    Response: { ok: true, id: "song_..." }
//
//  The endpoint should:
//    - Require the admin key (same pattern as /list, /status).
//    - Dedupe by txHash: if already in store, return { ok: true, id: existing.id }.
//    - NOT verify on-chain payment (the CommissionBooth contract already did).
//    - Store under a "song_" prefixed id in commissions.json (or a separate
//      songs.json to keep hero and song queues distinct — founder to decide).
//    - NOT require email (replace with payer wallet address).
//
//  ── WATCHER DESIGN ──────────────────────────────────────────────────────────

'use strict';
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

// ── CONFIG (fill after deploy) ───────────────────────────────────────────────
const BOOTH_ADDRESS = process.env.BOOTH_ADDRESS || '';  // set after deploy
if (!BOOTH_ADDRESS) {
  console.error('[watcher] BOOTH_ADDRESS not set in env — fill after deploy and restart.');
  process.exit(1);
}

const RPC              = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const QUEUE_URL        = process.env.QUEUE_URL || 'http://127.0.0.1:3060';
const QUEUE_ADMIN_KEY  = process.env.COMMISSION_ADMIN_KEY || '';
const STATE_FILE       = path.join(__dirname, 'commission-watcher-state.json');
const POLL_INTERVAL_MS = 30_000;  // 30 s — no keepers when idle per house rules
const LOG_WINDOW       = 2_000;   // blocks to look back on first run (~67 min on Base)

// Band id → symbol lookup (mirrors deploy script).
const BAND_LABELS = {
  1:'EBM', 2:'DD', 3:'MYCO', 4:'MR', 5:'JS', 6:'NN', 7:'DGT',
  8:'BONGO', 9:'RICKY', 10:'HT', 11:'WM', 12:'BIGGINS', 13:'JASMINE', 14:'RISH',
};

// Commissioned(address indexed payer, uint8 indexed bandId, address token,
//              uint256 price, string idea, string handle, uint256 ts)
const COMMISSIONED_TOPIC =
  '0x' + require('crypto').createHash('sha256')
    .update('Commissioned(address,uint8,address,uint256,string,string,uint256)')
    .digest('hex');
// NOTE: the real topic is keccak256 of the signature, not sha256.
// The actual topic must be computed at runtime with ethers.id() — see poll().

const log = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (_) { return { lastBlock: 0, seen: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json();
  if (j.error) throw new Error('rpc ' + method + ': ' + (j.error.message || JSON.stringify(j.error)));
  return j.result;
}

// Decode a Commissioned event log into a plain object.
// ABI: Commissioned(address indexed payer, uint8 indexed bandId, address token,
//                   uint256 price, string idea, string handle, uint256 ts)
// Indexed: topics[1]=payer, topics[2]=bandId. Non-indexed: ABI-encoded in data.
function decodeLog(log) {
  // Dynamic ABI decode of (address token, uint256 price, string idea, string handle, uint256 ts)
  // We use ethers inline — import at top of real file.
  // STUB: in the real implementation, use ethers.AbiCoder.defaultAbiCoder().decode().
  return {
    payer:  '0x' + log.topics[1].slice(26),        // last 20 bytes of topic[1]
    bandId: parseInt(log.topics[2], 16),             // topic[2] is padded uint8
    txHash: log.transactionHash,
    block:  parseInt(log.blockNumber, 16),
    // data decode is stubbed — real impl uses ethers AbiCoder
    _rawData: log.data,
  };
}

async function submitToQueue(entry) {
  if (!QUEUE_ADMIN_KEY) throw new Error('COMMISSION_ADMIN_KEY not set — cannot POST to queue');
  const r = await fetch(QUEUE_URL + '/submit-song', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + QUEUE_ADMIN_KEY,
    },
    body: JSON.stringify(entry),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '(no body)');
    throw new Error('queue /submit-song HTTP ' + r.status + ': ' + text);
  }
  return r.json();
}

async function poll() {
  const state = loadState();
  const latestHex = await rpc('eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);

  const fromBlock = state.lastBlock > 0
    ? state.lastBlock + 1
    : Math.max(0, latest - LOG_WINDOW);

  if (fromBlock > latest) { log('nothing new (at tip)'); return; }

  log('scanning blocks ' + fromBlock + '→' + latest);

  // eth_getLogs for Commissioned events from our booth.
  // Real impl: compute topic0 = ethers.id('Commissioned(address,uint8,address,uint256,string,string,uint256)')
  const TOPIC0 = ''; // fill with ethers.id(...) in real impl
  const logs = await rpc('eth_getLogs', [{
    address:   BOOTH_ADDRESS,
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + latest.toString(16),
    topics:    [TOPIC0],
  }]);

  log('got ' + logs.length + ' Commissioned event(s)');

  for (const rawLog of logs) {
    const txHash = rawLog.transactionHash;
    if (state.seen[txHash]) { log('  already processed: ' + txHash); continue; }

    let decoded;
    try { decoded = decodeLog(rawLog); }
    catch (e) { console.error('  decode error on ' + txHash + ':', e.message); continue; }

    const entry = {
      txHash,
      bandId: decoded.bandId,
      band:   BAND_LABELS[decoded.bandId] || 'unknown',
      // token, price, idea, handle decoded from data in real impl
      payer:  decoded.payer,
      source: 'bankr',
      ts:     decoded.block,  // block number until block.timestamp decoded
    };

    try {
      const result = await submitToQueue(entry);
      log('  queued: ' + txHash + ' → id=' + result.id);
      state.seen[txHash] = { id: result.id, ts: Date.now() };
    } catch (e) {
      console.error('  queue error for ' + txHash + ':', e.message);
      // Do NOT advance lastBlock — will retry next poll.
      return;
    }
  }

  state.lastBlock = latest;
  saveState(state);
}

// ── Main loop ────────────────────────────────────────────────────────────────
(async () => {
  log('commission-watcher started (booth=' + BOOTH_ADDRESS + ')');
  log('polling every ' + POLL_INTERVAL_MS / 1000 + 's');
  // Initial poll immediately.
  try { await poll(); } catch (e) { console.error('poll error:', e.message); }
  setInterval(async () => {
    try { await poll(); } catch (e) { console.error('poll error:', e.message); }
  }, POLL_INTERVAL_MS);
})();
