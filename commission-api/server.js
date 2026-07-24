// Tasern Hero commission queue - tiny isolated service (own PM2 process).
// Receives custom-hero commission requests from the marketplace, appends them
// to commissions.json, and serves the queue to a private admin page.
//
//   POST /submit            { email, xHandle, chain, txHash, answers{...} } -> { ok, id }
//   GET  /list?key=SECRET   -> [ {id, ts, status, ...} ]   (admin)
//   POST /status?key=SECRET { id, status }                 (admin)
//
// Runs on 127.0.0.1:3060, proxied at https://tasern.quest/api/commission/
const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.COMMISSION_PORT || 3060;
const ADMIN_KEY = process.env.COMMISSION_ADMIN_KEY; // required; set in .env (no hardcoded default). Admin endpoints fail closed if unset.
const STORE = path.join(__dirname, 'commissions.json');

// ---- Payment verification config ----
const RECEIVING_WALLET = (process.env.COMMISSION_WALLET || '0xEdc5999b1Ec1759970a681B9F5C197dd0B474016').toLowerCase();
const MIN_USDC = Number(process.env.COMMISSION_MIN_USDC || 9_500_000); // 6-decimals; $9.50 floor for a $10 ask
const RPC = { // RPC endpoints read from env; public RPC fallback keeps payment checks working with no key in source
  base: process.env.ALCHEMY_RPC || 'https://mainnet.base.org',
  polygon: process.env.ALCHEMY_RPC_POLYGON || 'https://polygon-rpc.com',
};
const USDC = { // accepted USDC token contracts per chain (lowercased)
  base: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
  polygon: ['0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'], // native + bridged
};
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const padTopic = addr => '0x' + '0'.repeat(24) + addr.toLowerCase().replace(/^0x/, '');

async function rpc(chain, method, params) {
  const r = await fetch(RPC[chain], {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}

// Verify a tx actually moved >= MIN_USDC of USDC to RECEIVING_WALLET on `chain`.
// Returns { ok:true, amount } or { ok:false, error, pending? }.
async function verifyPayment(chain, txHash) {
  if (!RPC[chain]) return { ok: false, error: 'Unsupported chain.' };
  let receipt;
  try { receipt = await rpc(chain, 'eth_getTransactionReceipt', [txHash]); }
  catch (e) { return { ok: false, error: 'Could not check payment on-chain, try again shortly.' }; }
  if (!receipt) return { ok: false, pending: true, error: 'Payment not on-chain yet — wait ~30s after sending, then submit.' };
  if (receipt.status && receipt.status !== '0x1') return { ok: false, error: 'That transaction failed on-chain.' };

  const want = padTopic(RECEIVING_WALLET).toLowerCase();
  const tokens = USDC[chain];
  let total = 0n;
  for (const log of receipt.logs || []) {
    if (!tokens.includes((log.address || '').toLowerCase())) continue;
    if ((log.topics?.[0] || '').toLowerCase() !== TRANSFER_TOPIC) continue;
    if ((log.topics?.[2] || '').toLowerCase() !== want) continue;     // transfer TO our wallet
    try { total += BigInt(log.data); } catch (_) {}
  }
  if (total >= BigInt(MIN_USDC)) return { ok: true, amount: Number(total) / 1e6, from: (receipt.from || '').toLowerCase() };
  if (total > 0n) return { ok: false, error: `Payment too small ($${(Number(total) / 1e6).toFixed(2)} USDC received, need $${(MIN_USDC / 1e6).toFixed(2)}).` };
  return { ok: false, error: 'No USDC payment to the commission wallet was found in that transaction.' };
}

const app = express();
app.use(express.json({ limit: '64kb' }));

// CORS - allow the marketplace origin
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function load() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { return []; } }
function save(list) { fs.writeFileSync(STORE, JSON.stringify(list, null, 1)); }

// strip control chars (0x00-0x1F and 0x7F), cap length
function clean(s, max) {
  const out = String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]+/g, ' ');
  return out.slice(0, max).trim();
}

// crude in-memory rate limit: max 6 submits / 10 min / IP
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 6;
}

app.post('/submit', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'Too many requests, slow down.' });

  const b = req.body || {};
  const email = clean(b.email, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Valid email required.' });
  const txHash = clean(b.txHash, 80);
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return res.status(400).json({ ok: false, error: 'Valid payment tx hash required (0x + 64 hex).' });
  const chain = (clean(b.chain, 12) || 'base').toLowerCase();

  const list = load();
  // replay guard: a payment tx can only be used once
  if (list.some(x => (x.txHash || '').toLowerCase() === txHash.toLowerCase()))
    return res.status(409).json({ ok: false, error: 'That payment transaction has already been submitted.' });

  // MUST be paid: verify >= $10 USDC actually reached the commission wallet
  const pay = await verifyPayment(chain, txHash);
  if (!pay.ok) return res.status(pay.pending ? 425 : 402).json({ ok: false, error: pay.error });

  const a = b.answers || {};
  const entry = {
    id: 'cm_' + Date.now().toString(36) + Math.floor(performance.now() % 1000).toString(36),
    ts: new Date().toISOString(),
    status: 'new',
    email,
    xHandle: clean(b.xHandle, 60),
    chain,
    txHash,
    paidUsdc: pay.amount,
    payerWallet: pay.from,                                      // who paid (from the tx)
    deliverWallet: clean(b.deliverWallet, 64) || pay.from,      // where to send the hero
    ip,
    answers: {
      name: clean(a.name, 80),
      race: clean(a.race, 80),
      role: clean(a.role, 80),
      weapon: clean(a.weapon, 80),
      colors: clean(a.colors, 120),
      vibe: clean(a.vibe, 200),
      backstory: clean(a.backstory, 1200),
      anything: clean(a.anything, 600),
    },
  };

  list.unshift(entry);
  save(list);
  console.log('[commission] PAID $' + pay.amount + ' ' + entry.id + ' from ' + email + ' tx ' + txHash.slice(0, 12));
  res.json({ ok: true, id: entry.id });
});

app.get('/list', (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) return res.status(403).json({ ok: false, error: 'forbidden' });
  res.json(load());
});

app.post('/status', (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) return res.status(403).json({ ok: false, error: 'forbidden' });
  const { id, status } = req.body || {};
  const allowed = ['new', 'in-progress', 'done', 'refunded', 'spam'];
  if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'bad status' });
  const list = load();
  const item = list.find(x => x.id === id);
  if (!item) return res.status(404).json({ ok: false, error: 'not found' });
  item.status = status;
  save(list);
  res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true, count: load().length }));

if (!ADMIN_KEY) console.warn('[commission] WARNING: COMMISSION_ADMIN_KEY not set — admin endpoints (/list, /status) are DISABLED until it is configured.');
app.listen(PORT, '127.0.0.1', () => console.log('commission-api on :' + PORT));
