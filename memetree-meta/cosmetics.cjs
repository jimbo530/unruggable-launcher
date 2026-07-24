// ============================================================
//  cosmetics.cjs - Acorn cosmetics "closet" (shared by store + games + NFT metadata)
//  Inventory (per wallet) + look (per NFT: worn items + laminated sticker sheet).
//  Backed by Supabase REST. Buying cosmetics is the ONE operator-revenue line:
//  it sends gold (cbBTC) to the shop till; this VERIFIES that on-chain payment
//  before granting. Every other Grove flow routes to players/impact, never us.
//
//  Tables (see cosmetics-schema.sql): cosmetics_inventory, cosmetics_look, cosmetics_purchases.
//  Needs in the service .env: SUPABASE_URL, SUPABASE_KEY (service_role), SHOP_TILL, CDP_RPC_URL.
// ============================================================
const { ethers } = require('ethers');

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_KEY; // service_role - server-side writes, bypasses RLS
const SHOP_TILL = (process.env.SHOP_TILL || '0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2').toLowerCase();
const CBBTC = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'; // cbBTC (= gold), lowercase
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const LIVE_STICKER_CAP = 10; // movable stickers at once; "move to level 0" (laminate) frees slots to add more

if (!SUPA_URL || !SUPA_KEY) {
  console.warn('[cosmetics] SUPABASE_URL / SUPABASE_KEY not set - closet endpoints will fail until the .env is configured');
}

const lc = (a) => String(a).toLowerCase();
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const isTokenId = (t) => /^\d+$/.test(String(t));

// ---- Supabase REST helper ----
async function supa(method, path, body, prefer) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      Prefer: prefer || 'return=representation',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!r.ok) throw new Error('supabase ' + r.status + ' ' + path + ': ' + (typeof data === 'string' ? data : JSON.stringify(data)));
  return data;
}
const UPSERT = 'resolution=merge-duplicates,return=representation';

// ---- exported: read a token's current look (used by the NFT metadata route) ----
async function getLook(tokenId) {
  const rows = await supa('GET', `cosmetics_look?token_id=eq.${encodeURIComponent(tokenId)}&select=items,sticker_sheet_url,working_stickers`);
  return (rows && rows[0]) || { items: {}, sticker_sheet_url: null, working_stickers: [] };
}

// ---- mount the closet endpoints onto an existing Express app ----
function mount(app, { provider, treesAddress }) {
  const trees = new ethers.Contract(treesAddress, ['function ownerOf(uint256) view returns (address)'], provider);

  async function ownsToken(wallet, tokenId) {
    try { return lc(await trees.ownerOf(tokenId)) === lc(wallet); }
    catch (e) { console.error('[cosmetics] ownerOf failed', tokenId, e.message); return false; }
  }

  // A purchase is only granted if this tx really paid the till in cbBTC (>= price) from this wallet.
  async function verifyPayment(txHash, wallet, gold) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) throw new Error('bad txHash');
    const rec = await provider.getTransactionReceipt(txHash);
    if (!rec) throw new Error('payment tx not found / not mined yet');
    if (rec.status !== 1) throw new Error('payment tx failed on-chain');
    const want = BigInt(gold);
    for (const log of rec.logs) {
      if (lc(log.address) !== CBBTC) continue;
      if (!log.topics || log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
      const from = '0x' + log.topics[1].slice(26);
      const to = '0x' + log.topics[2].slice(26);
      let value; try { value = BigInt(log.data); } catch (_) { continue; }
      if (lc(from) === lc(wallet) && lc(to) === SHOP_TILL && value >= want) return true;
    }
    throw new Error('no matching cbBTC payment to the shop till in that tx');
  }

  // GET what a wallet owns
  app.get('/cosmetics/inventory/:wallet', async (req, res) => {
    try {
      const wallet = lc(req.params.wallet);
      if (!isAddr(wallet)) return res.status(400).json({ error: 'bad wallet' });
      const rows = await supa('GET', `cosmetics_inventory?wallet=eq.${wallet}&qty=gt.0&select=item_id,kind,qty`);
      res.json({ wallet, items: rows || [] });
    } catch (e) { console.error('[cosmetics] inventory', e.message); res.status(502).json({ error: e.message }); }
  });

  // GET a token's current look (worn items + laminated sticker sheet + live working stickers)
  app.get('/cosmetics/look/:tokenId', async (req, res) => {
    try {
      const tokenId = req.params.tokenId;
      if (!isTokenId(tokenId)) return res.status(400).json({ error: 'bad tokenId' });
      res.json({ tokenId, ...(await getLook(tokenId)) });
    } catch (e) { console.error('[cosmetics] look', e.message); res.status(502).json({ error: e.message }); }
  });

  // POST buy - verify the cbBTC payment, then grant the item (idempotent per tx)
  app.post('/cosmetics/buy', async (req, res) => {
    try {
      const { wallet, itemId, kind, gold, txHash } = req.body || {};
      if (!isAddr(wallet)) return res.status(400).json({ error: 'bad wallet' });
      if (!itemId || !kind) return res.status(400).json({ error: 'itemId + kind required' });
      const goldN = Number(gold);
      if (!Number.isInteger(goldN) || goldN <= 0) return res.status(400).json({ error: 'bad gold amount' });

      await verifyPayment(txHash, wallet, goldN); // throws if the payment is not real

      // Log the purchase first; UNIQUE(tx_hash) blocks granting the same payment twice.
      try {
        await supa('POST', 'cosmetics_purchases', { wallet: lc(wallet), item_id: itemId, gold: goldN, tx_hash: lc(txHash) });
      } catch (e) {
        if (/duplicate|unique|already|409|23505/i.test(e.message)) return res.json({ ok: true, alreadyGranted: true });
        throw e;
      }

      // Grant: qty + 1 (read-then-write; per-wallet concurrency is tiny).
      const cur = await supa('GET', `cosmetics_inventory?wallet=eq.${lc(wallet)}&item_id=eq.${encodeURIComponent(itemId)}&select=qty`);
      const qty = (cur && cur[0] ? Number(cur[0].qty) : 0) + 1;
      await supa('POST', 'cosmetics_inventory', { wallet: lc(wallet), item_id: itemId, kind, qty }, UPSERT);
      res.json({ ok: true, item_id: itemId, qty });
    } catch (e) { console.error('[cosmetics] buy', e.message); res.status(400).json({ error: e.message }); }
  });

  // POST equip - set or clear a worn item slot on a token (items are NOT consumed)
  app.post('/cosmetics/equip', async (req, res) => {
    try {
      const { wallet, tokenId, slot, itemId } = req.body || {};
      if (!isAddr(wallet)) return res.status(400).json({ error: 'bad wallet' });
      if (!isTokenId(tokenId)) return res.status(400).json({ error: 'bad tokenId' });
      if (!slot) return res.status(400).json({ error: 'slot required' });
      if (!(await ownsToken(wallet, tokenId))) return res.status(403).json({ error: 'not the token owner' });
      if (itemId) {
        const inv = await supa('GET', `cosmetics_inventory?wallet=eq.${lc(wallet)}&item_id=eq.${encodeURIComponent(itemId)}&qty=gt.0&select=qty`);
        if (!inv || !inv[0]) return res.status(403).json({ error: 'you do not own that item' });
      }
      const look = await getLook(tokenId);
      const items = { ...(look.items || {}) };
      if (itemId) items[slot] = itemId; else delete items[slot];
      await supa('POST', 'cosmetics_look', { token_id: Number(tokenId), items, updated_at: new Date().toISOString() }, UPSERT);
      res.json({ ok: true, items });
    } catch (e) { console.error('[cosmetics] equip', e.message); res.status(400).json({ error: e.message }); }
  });

  // POST working - save the live (un-laminated) sticker batch, capped for smooth dragging
  app.post('/cosmetics/working', async (req, res) => {
    try {
      const { wallet, tokenId, working } = req.body || {};
      if (!isAddr(wallet)) return res.status(400).json({ error: 'bad wallet' });
      if (!isTokenId(tokenId)) return res.status(400).json({ error: 'bad tokenId' });
      if (!Array.isArray(working)) return res.status(400).json({ error: 'working must be an array' });
      if (working.length > LIVE_STICKER_CAP) return res.status(400).json({ error: 'too many live stickers (max ' + LIVE_STICKER_CAP + ') - laminate first' });
      if (!(await ownsToken(wallet, tokenId))) return res.status(403).json({ error: 'not the token owner' });
      await supa('POST', 'cosmetics_look', { token_id: Number(tokenId), working_stickers: working, updated_at: new Date().toISOString() }, UPSERT);
      res.json({ ok: true, count: working.length });
    } catch (e) { console.error('[cosmetics] working', e.message); res.status(400).json({ error: e.message }); }
  });

  // POST laminate - bake the working stickers into the PERMANENT sheet (client uploads the flat PNG
  // and passes its https URL). Consumes the laminated stickers from inventory; clears working. Forever.
  app.post('/cosmetics/laminate', async (req, res) => {
    try {
      const { wallet, tokenId, sheetUrl, consumed } = req.body || {};
      if (!isAddr(wallet)) return res.status(400).json({ error: 'bad wallet' });
      if (!isTokenId(tokenId)) return res.status(400).json({ error: 'bad tokenId' });
      if (!sheetUrl || !/^https:\/\//.test(sheetUrl)) return res.status(400).json({ error: 'sheetUrl (https) required' });
      if (!(await ownsToken(wallet, tokenId))) return res.status(403).json({ error: 'not the token owner' });
      // consume laminated stickers from inventory: consumed = [{ item_id, n }]
      if (Array.isArray(consumed)) {
        for (const c of consumed) {
          if (!c || !c.item_id || !Number.isInteger(Number(c.n))) continue;
          const cur = await supa('GET', `cosmetics_inventory?wallet=eq.${lc(wallet)}&item_id=eq.${encodeURIComponent(c.item_id)}&select=qty,kind`);
          const have = cur && cur[0] ? Number(cur[0].qty) : 0;
          const kind = cur && cur[0] ? cur[0].kind : 'sticker';
          const left = Math.max(0, have - Number(c.n));
          await supa('POST', 'cosmetics_inventory', { wallet: lc(wallet), item_id: c.item_id, kind, qty: left }, UPSERT);
        }
      }
      await supa('POST', 'cosmetics_look', { token_id: Number(tokenId), sticker_sheet_url: sheetUrl, working_stickers: [], updated_at: new Date().toISOString() }, UPSERT);
      res.json({ ok: true, sticker_sheet_url: sheetUrl });
    } catch (e) { console.error('[cosmetics] laminate', e.message); res.status(400).json({ error: e.message }); }
  });

  console.log('[cosmetics] closet endpoints mounted (inventory / look / buy / equip / working / laminate)');
}

module.exports = { mount, getLook };
