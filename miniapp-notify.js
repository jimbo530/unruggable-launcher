// miniapp-notify.js — Base Mini App Notification Service
// Receives webhook events from Base/Farcaster, stores subscriber tokens,
// exposes /notify endpoint for agents to push notifications.
//
// PM2: pm2 start miniapp-notify.js --name miniapp-notify
// Nginx: proxy /api/miniapp/* → localhost:3005

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = 3005;
const TOKENS_FILE = path.join(__dirname, 'miniapp-tokens.json');
const NOTIFY_SECRET = process.env.MINIAPP_SECRET || process.env.AGENT_BUS_SECRET || 'mft-notify-2026';

// ─── Token Storage ──────────────────────────────────────
// { subscribers: { "fid_or_addr": { url, token, addedAt } } }

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); }
  catch { return { subscribers: {} }; }
}

function saveTokens(data) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
}

// ─── POST /webhook — Base/Farcaster sends events here ───
app.post('/webhook', (req, res) => {
  try {
    const body = req.body;

    // Farcaster wraps events in a signed envelope (header.payload.signature)
    // Decode payload if present, otherwise treat body as the event directly
    let event;
    if (body.header && body.payload) {
      event = JSON.parse(Buffer.from(body.payload, 'base64url').toString());
    } else {
      event = body;
    }

    const fid = String(event.fid || event.address || 'unknown');
    const data = loadTokens();

    switch (event.event) {
      case 'miniapp_added':
      case 'notifications_enabled': {
        const details = event.notificationDetails;
        if (details && details.url && details.token) {
          data.subscribers[fid] = {
            url: details.url,
            token: details.token,
            addedAt: new Date().toISOString(),
          };
          saveTokens(data);
          console.log(`[notify] ${event.event} fid=${fid} total=${Object.keys(data.subscribers).length}`);
        }
        break;
      }
      case 'miniapp_removed':
      case 'notifications_disabled':
        delete data.subscribers[fid];
        saveTokens(data);
        console.log(`[notify] ${event.event} fid=${fid} total=${Object.keys(data.subscribers).length}`);
        break;
      default:
        console.log(`[notify] unknown event: ${event.event || 'none'}`);
    }

    // Must respond 200 quickly — Base waits for this before activating token
    res.status(200).json({ success: true });
  } catch (e) {
    console.error('[notify] webhook error:', e.message);
    res.status(200).json({ success: true }); // always 200 to avoid retries
  }
});

// ─── POST /notify — agents call this to send notifications ───
app.post('/notify', async (req, res) => {
  const { secret, title, body: msgBody, targetUrl } = req.body;

  if (secret !== NOTIFY_SECRET) {
    return res.status(403).json({ error: 'bad secret' });
  }
  if (!title || !msgBody) {
    return res.status(400).json({ error: 'need title and body' });
  }
  if (title.length > 32) {
    return res.status(400).json({ error: 'title max 32 chars, got ' + title.length });
  }
  if (msgBody.length > 128) {
    return res.status(400).json({ error: 'body max 128 chars, got ' + msgBody.length });
  }

  const data = loadTokens();
  const subs = Object.entries(data.subscribers);
  if (subs.length === 0) {
    return res.json({ sent: 0, invalid: 0, subscribers: 0, message: 'no subscribers yet' });
  }

  // Group tokens by notification URL (different clients use different URLs)
  const byUrl = {};
  for (const [fid, sub] of subs) {
    if (!byUrl[sub.url]) byUrl[sub.url] = [];
    byUrl[sub.url].push({ fid, token: sub.token });
  }

  const notificationId = crypto.randomUUID();
  const target = targetUrl || 'https://tasern.quest/memefortrees';
  let totalSent = 0;
  let totalInvalid = 0;

  for (const [notifUrl, entries] of Object.entries(byUrl)) {
    // Batch max 100 tokens per POST
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      const tokens = batch.map(e => e.token);

      try {
        const resp = await fetch(notifUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notificationId,
            title,
            body: msgBody,
            targetUrl: target,
            tokens,
          }),
        });

        if (!resp.ok) {
          console.error(`[notify] POST ${notifUrl} returned ${resp.status}`);
          continue;
        }

        const result = await resp.json();
        totalSent += (result.successfulTokens || []).length;

        // Purge invalid tokens
        if (result.invalidTokens && result.invalidTokens.length > 0) {
          const badSet = new Set(result.invalidTokens);
          totalInvalid += badSet.size;
          for (const entry of batch) {
            if (badSet.has(entry.token)) {
              delete data.subscribers[entry.fid];
            }
          }
        }
      } catch (e) {
        console.error(`[notify] POST to ${notifUrl} failed:`, e.message);
      }
    }
  }

  if (totalInvalid > 0) saveTokens(data);

  console.log(`[notify] "${title}" → ${totalSent} sent, ${totalInvalid} invalid, ${subs.length} total`);
  res.json({ sent: totalSent, invalid: totalInvalid, subscribers: subs.length });
});

// ─── GET /subscribers — quick status check ───
app.get('/subscribers', (req, res) => {
  const data = loadTokens();
  const count = Object.keys(data.subscribers).length;
  res.json({ count });
});

// ─── GET /health ───
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'miniapp-notify' });
});

app.listen(PORT, () => {
  console.log(`[miniapp-notify] listening on :${PORT}`);
});
