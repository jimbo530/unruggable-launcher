# Social Bot VPS Deployment Checklist

Target: Deploy social-bot.js to Hostinger VPS (147.93.58.149) via PM2.

---

## Pre-Flight

- [ ] Confirm VPS SSH access works: `ssh vps`
- [ ] Confirm PM2 is installed on VPS: `pm2 --version`
- [ ] Confirm Node 18+ on VPS: `node --version`

## Files to Copy

```bash
scp C:\Users\bigji\Documents\MfT-Launch\marketing\social-bot.js vps:/root/social-bot/social-bot.js
scp C:\Users\bigji\Documents\MfT-Launch\marketing\package.json vps:/root/social-bot/package.json
scp C:\Users\bigji\Documents\MfT-Launch\marketing\.env vps:/root/social-bot/.env
```

Note: Only these 3 files are needed. social-bot.js is self-contained (no imports from other marketing scripts). Dependencies (twitter-api-v2, dotenv) are in package.json.

## Env Vars Required (.env on VPS)

| Variable | Status | Source |
|----------|--------|--------|
| NEYNAR_API_KEY | SET (72A0...) | Already in .env |
| FARCASTER_SIGNER_UUID | MISSING - BLOCKER | Run neynar-signer-setup.js locally, approve in Warpcast |
| X_APP_KEY | MISSING - BLOCKER | Copy from x-poster .env (same account) |
| X_APP_SECRET | MISSING - BLOCKER | Copy from x-poster .env |
| X_ACCESS_TOKEN | MISSING - BLOCKER | Copy from x-poster .env |
| X_ACCESS_SECRET | MISSING - BLOCKER | Copy from x-poster .env |

## Install and Start

```bash
ssh vps
mkdir -p /root/social-bot
cd /root/social-bot
npm install
pm2 start social-bot.js --name social-bot
pm2 save
```

## Verify

```bash
pm2 logs social-bot --lines 20
# Should see: [SOCIAL] MfT Social Bot starting
# Should see: [SOCIAL] X: configured
# Should see: [SOCIAL] Farcaster: configured
```

## Blockers (must resolve before deploy)

1. **X API keys**: The social-bot uses different env var names (X_APP_KEY) than the x-poster (API_KEY). Copy the 4 Twitter API values from x-poster's .env into social-bot's .env using the X_ prefix names.

2. **Farcaster signer UUID**: User must run `node neynar-signer-setup.js` locally and approve the signer in Warpcast mobile app. This is a one-time ~2 minute step. Without this, all Farcaster posts will silently fail.

## Post-Deploy

- [ ] Verify first post appears on X within 30 minutes
- [ ] Verify first Farcaster cast appears (after signer setup)
- [ ] Check `pm2 logs social-bot` for any errors after first cycle
- [ ] Confirm social-bot-state.json is being written: `cat /root/social-bot/social-bot-state.json`

## Important: No Conflict with x-poster

The x-poster (poster.js) posts memes/music/promos every 20 minutes. The social-bot posts text content every 4 hours. These are complementary, not duplicates. The x-poster handles media-heavy meme content; the social-bot handles informational/promotional text posts. They can run simultaneously.
