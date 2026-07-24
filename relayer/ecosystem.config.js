// PM2 config — Shipyard relayer keeper + gas watcher (Base, 24/7).
//
// SETUP on the VPS:
//   1. Copy this MfT-Launch/relayer/ folder to the VPS (or git pull the repo).
//   2. Copy ~/.shipyard-wallets.env to the VPS home (~/.shipyard-wallets.env).
//      It holds the RELAYER key — the keeper reads it from there, never hardcoded.
//   3. cd relayer && npm i ethers dotenv   (if not already installed)
//   4. pm2 start ecosystem.config.js && pm2 save
//   5. pm2 logs shipyard-keeper
//
// NOTE: the keeper uses the DEDICATED relayer wallet (0xC404…), NOT the shared
// agent wallet — so it will NOT collide with your existing PM2 bots. The relayer
// can only call Dock.fulfill (ships go to the stored user; it can never steal)
// and only ever spends its own gas.
module.exports = {
  apps: [
    {
      name: 'shipyard-keeper',
      script: 'run-keeper-live.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'shipyard-watcher',
      script: 'relayer-watcher.js',
      cwd: __dirname,
      autorestart: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
