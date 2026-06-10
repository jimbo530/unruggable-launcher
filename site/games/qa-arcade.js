#!/usr/bin/env node
/**
 * qa-arcade.js — headless QA harness for the MfT Arcade catalog.
 *
 * Serves this games/ directory over http, loads every game (from BATCHES.json
 * plus the 3 flagships), and per game captures:
 *   - console errors / warnings
 *   - failed network requests
 *   - whether BaselingSprites / BaselingPlayer initialized (only checked when the
 *     game includes that script)
 *   - whether the largest canvas painted something non-blank within a timeout
 *   - a screenshot -> qa-shots/<game>.png
 * Writes qa-report.json and prints a readable pass/fail summary.
 *
 * Usage:
 *   node qa-arcade.js                 # whole catalog
 *   node qa-arcade.js --filter snow   # only games whose slug contains "snow"
 *   node qa-arcade.js --filter puzzle # NOTE: --filter matches the SLUG, not genre;
 *                                     #       use --batch for a genre/batch (see below)
 *   node qa-arcade.js --batch batch-3 # only the games in that BATCHES.json batch
 *   node qa-arcade.js --headful       # show the browser (debugging)
 *   node qa-arcade.js --timeout 8000  # per-game paint wait (ms, default 5000)
 *
 * No global installs. Uses puppeteer-core against the Chrome already cached at
 * ~/.cache/puppeteer. If puppeteer-core isn't installed in this dir, run:
 *   npm install puppeteer-core
 *
 * Exit code: 0 if every tested game PASSED, 1 if any FAILED (so CI / Task #7 can gate on it).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const DIR = __dirname;
const SHOTS_DIR = path.join(DIR, 'qa-shots');
const REPORT = path.join(DIR, 'qa-report.json');
const FLAGSHIPS = ['poop-man', 'reactor-jump', 'tunnel-bug'];

// ---- args ----
const argv = process.argv.slice(2);
function argVal(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }
const FILTER = argVal('--filter');
const BATCH = argVal('--batch');
const HEADFUL = argv.includes('--headful');
const PAINT_TIMEOUT = parseInt(argVal('--timeout') || '5000', 10);

// ---- puppeteer-core + cached chrome ----
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  console.error('puppeteer-core is not installed in', DIR);
  console.error('Run:  npm install puppeteer-core');
  process.exit(2);
}

function findChrome() {
  // Allow an explicit override.
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const home = process.env.USERPROFILE || process.env.HOME || 'C:/Users/bigji';
  const roots = [
    path.join(home, '.cache', 'puppeteer', 'chrome-headless-shell'),
    path.join(home, '.cache', 'puppeteer', 'chrome'),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter(d => /^win64-|^mac|^linux/.test(d)).sort().reverse();
    for (const d of dirs) {
      const candidates = [
        path.join(root, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
        path.join(root, d, 'chrome-win64', 'chrome.exe'),
        path.join(root, d, 'chrome-linux64', 'chrome'),
        path.join(root, d, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      ];
      for (const c of candidates) if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

// ---- which games to test ----
function loadGameList() {
  const batchesPath = path.join(DIR, 'BATCHES.json');
  if (!fs.existsSync(batchesPath)) {
    console.error('BATCHES.json not found — run _gen-batches.js first.');
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(batchesPath, 'utf8'));
  const slugToGenre = {};
  data.games.forEach(g => { slugToGenre[g.slug] = g.genre; });

  // Wave-2 games from the manifest + the 3 flagships (which are excluded there).
  let slugs = data.games.map(g => g.slug);
  FLAGSHIPS.forEach(f => { if (!slugs.includes(f)) { slugs.push(f); slugToGenre[f] = 'flagship'; } });

  if (BATCH) {
    const b = data.batches.find(x => x.id === BATCH || x.genre === BATCH);
    if (!b) { console.error('No batch/genre matching', BATCH, '— available:', data.batches.map(x => x.id + '(' + x.genre + ')').join(', ')); process.exit(2); }
    slugs = b.games.slice();
  }
  if (FILTER) slugs = slugs.filter(s => s.includes(FILTER));

  // Resolve to actual files (skip any slug whose .html is missing — report it).
  const games = [];
  for (const slug of slugs) {
    const file = slug + '.html';
    if (!fs.existsSync(path.join(DIR, file))) {
      games.push({ slug, file, genre: slugToGenre[slug] || '?', missing: true });
    } else {
      games.push({ slug, file, genre: slugToGenre[slug] || '?', missing: false });
    }
  }
  return games;
}

// ---- minimal static server (no deps) ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(req.url.split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        // Prevent path traversal: resolve and ensure it stays under DIR.
        const filePath = path.normalize(path.join(DIR, urlPath));
        if (!filePath.startsWith(DIR)) { res.writeHead(403); res.end('forbidden'); return; }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404); res.end('not found'); return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } catch (e) {
        res.writeHead(500); res.end('server error: ' + e.message);
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Injected into every page BEFORE its own scripts run. Bypasses the NFT gate (so
// games that block their loop behind it still boot) and provides a no-op wallet so
// wallet-detection paths don't throw. Does NOT stub BaselingSprites/BaselingPlayer —
// those load for real so we can verify they initialize.
function preloadStub() {
  // NB: this function is stringified and run in the page; keep it self-contained.
  window.__QA__ = { gateBypassed: false };
  // A NftLoader stub that passes the gate immediately. If the real nft-loader.js
  // loads afterward it will overwrite this — so we re-assert gate() as a passthrough
  // via a defineProperty guard on window.
  function makeStub() {
    return {
      gate: function (onSuccess) { window.__QA__.gateBypassed = true; if (typeof onSuccess === 'function') setTimeout(onSuccess, 0); },
      getStatBonuses: function () { return {}; },
      getSelectedCharacter: function () { return null; },
      isGated: function () { return false; },
    };
  }
  var _nl = makeStub();
  try {
    Object.defineProperty(window, 'NftLoader', {
      configurable: true,
      get: function () { return _nl; },
      set: function (v) {
        // Real loader assigns here — keep it but force gate() to passthrough.
        _nl = v || makeStub();
        if (_nl && typeof _nl === 'object') {
          _nl.gate = function (onSuccess) { window.__QA__.gateBypassed = true; if (typeof onSuccess === 'function') setTimeout(onSuccess, 0); };
        }
      }
    });
  } catch (e) {
    window.NftLoader = _nl;
  }
  // Minimal injected wallet so `window.ethereum` checks don't crash. Rejects real RPC.
  if (!window.ethereum) {
    window.ethereum = {
      isMetaMask: false, _qaStub: true,
      request: function () { return Promise.reject(new Error('QA stub wallet — no RPC')); },
      on: function () {}, removeListener: function () {},
    };
  }
}

// Evaluated in-page after load to inspect canvas + shared-module state.
function inspectPage() {
  // Largest canvas on the page = the game surface.
  var canvases = Array.prototype.slice.call(document.querySelectorAll('canvas'));
  var best = null, bestArea = 0;
  canvases.forEach(function (c) {
    var area = (c.width || 0) * (c.height || 0);
    if (area > bestArea) { bestArea = area; best = c; }
  });
  var painted = false, paintRatio = 0, canvasSize = null;
  if (best && bestArea > 0) {
    canvasSize = { w: best.width, h: best.height };
    try {
      var ctx = best.getContext('2d');
      if (ctx) {
        // Sample a grid of pixels (full getImageData can be huge); count non-blank.
        var sx = Math.max(1, Math.floor(best.width / 40));
        var sy = Math.max(1, Math.floor(best.height / 40));
        var total = 0, nonblank = 0;
        var data = ctx.getImageData(0, 0, best.width, best.height).data;
        for (var y = 0; y < best.height; y += sy) {
          for (var x = 0; x < best.width; x += sx) {
            var i = (y * best.width + x) * 4;
            total++;
            // non-blank = any visible pixel that isn't pure black-transparent
            if (data[i + 3] > 8 && (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8)) nonblank++;
          }
        }
        paintRatio = total ? (nonblank / total) : 0;
        painted = paintRatio > 0.01; // >1% of sampled pixels show something
      }
    } catch (e) {
      // WebGL canvas (no 2d ctx) — can't sample pixels; treat presence as "has canvas".
      return { hasCanvas: true, painted: null, paintRatio: null, canvasSize: canvasSize, webglOrTainted: true, error: e.message };
    }
  }
  return {
    hasCanvas: !!best,
    canvasCount: canvases.length,
    painted: painted,
    paintRatio: Math.round(paintRatio * 1000) / 1000,
    canvasSize: canvasSize,
    gateBypassed: !!(window.__QA__ && window.__QA__.gateBypassed),
    gateOverlayPresent: !!document.getElementById('nft-gate'),
    spritesPresent: typeof window.BaselingSprites !== 'undefined',
    spritesReady: !!(window.BaselingSprites && (typeof window.BaselingSprites.frame === 'function' || typeof window.BaselingSprites.draw === 'function')),
    playerPresent: typeof window.BaselingPlayer !== 'undefined',
    playerReady: !!(window.BaselingPlayer && typeof window.BaselingPlayer.getMults === 'function'),
  };
}

function gameSrcIncludes(file, scriptName) {
  const txt = fs.readFileSync(path.join(DIR, file), 'utf8');
  return new RegExp('<script[^>]+src=["\']' + scriptName.replace('.', '\\.')).test(txt);
}

async function testGame(browser, baseUrl, game) {
  const result = {
    slug: game.slug, file: game.file, genre: game.genre,
    pass: false, reasons: [],
    consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [],
    inspect: null, screenshot: null,
  };
  if (game.missing) {
    result.reasons.push('FILE MISSING: ' + game.file);
    return result;
  }

  const includesSprites = gameSrcIncludes(game.file, 'baseling-sprites.js');
  const includesPlayer = gameSrcIncludes(game.file, 'baseling-player.js');

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  try {
    await page.evaluateOnNewDocument(preloadStub);

    // A request URL is "benign to 404" when it's a baseling sprite image or the roster
    // API: Wimmple (the no-wallet default) has no art, and the roster API isn't running
    // under the local static server. Both are the documented procedural-fallback path
    // (see REMASTER-GUIDE Step 8 / ARCADE-STATS), not a game defect.
    const isBenignAsset = (u) => /\/api\/baseling\/images\/|\/images\/[^/]+\.(png|webp|jpg|gif)(\?|$)|\/arcade-roster/.test(u || '');

    page.on('console', (msg) => {
      const t = msg.type();
      const text = msg.text();
      // Ignore the expected QA-stub wallet rejection noise.
      if (/QA stub wallet/.test(text)) return;
      // The generic "Failed to load resource: ... 404" console line carries no URL, so we
      // can't tell benign from real here — drop it and judge 404s via the response handler
      // (which has the URL) instead.
      if (/Failed to load resource/i.test(text)) return;
      if (t === 'error') result.consoleErrors.push(text);
      else if (t === 'warning') result.consoleWarnings.push(text);
    });
    page.on('pageerror', (err) => { result.pageErrors.push(err.message); });
    page.on('requestfailed', (req) => {
      const f = req.failure();
      // net::ERR_ABORTED on the stub-wallet RPC and on intentionally-cancelled
      // requests is not a game defect; skip aborted. Skip benign sprite/API assets.
      if (f && /ERR_ABORTED/.test(f.errorText)) return;
      if (isBenignAsset(req.url())) return;
      result.failedRequests.push({ url: req.url(), error: f ? f.errorText : 'unknown' });
    });
    // 404s complete as responses (not requestfailed). A 404 on a real game asset is a
    // defect; a 404 on a benign sprite/API URL is the documented fallback path.
    page.on('response', (res) => {
      if (res.status() === 404 && !isBenignAsset(res.url())) {
        result.failedRequests.push({ url: res.url(), error: 'HTTP 404' });
      }
    });

    const url = baseUrl + '/' + encodeURIComponent(game.file);
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });

    // Wait up to PAINT_TIMEOUT for the canvas to paint something.
    const deadline = Date.now() + PAINT_TIMEOUT;
    let insp = await page.evaluate(inspectPage);
    while (!insp.painted && insp.painted !== null && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250));
      insp = await page.evaluate(inspectPage);
    }
    result.inspect = insp;

    // Screenshot regardless of pass/fail (useful evidence).
    if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const shotPath = path.join(SHOTS_DIR, game.slug + '.png');
    await page.screenshot({ path: shotPath });
    result.screenshot = path.relative(DIR, shotPath);

    // ---- pass/fail logic ----
    if (result.pageErrors.length) result.reasons.push(result.pageErrors.length + ' uncaught page error(s): ' + result.pageErrors[0]);
    if (result.consoleErrors.length) result.reasons.push(result.consoleErrors.length + ' console error(s): ' + result.consoleErrors[0]);
    if (result.failedRequests.length) result.reasons.push(result.failedRequests.length + ' failed request(s): ' + result.failedRequests[0].url);
    if (!insp.hasCanvas) {
      result.reasons.push('no canvas element found');
    } else if (insp.painted === false) {
      result.reasons.push('canvas blank after ' + PAINT_TIMEOUT + 'ms (paintRatio ' + insp.paintRatio + ')');
    } else if (insp.painted === null) {
      result.reasons.push('canvas is WebGL/unsamplable — paint not verified (manual check)');
    }
    if (insp.gateOverlayPresent) result.reasons.push('NFT gate overlay still present (bypass failed)');
    if (includesSprites && !insp.spritesReady) result.reasons.push('includes baseling-sprites.js but BaselingSprites did not initialize');
    if (includesPlayer && !insp.playerReady) result.reasons.push('includes baseling-player.js but BaselingPlayer did not initialize');

    // PASS = no hard failures. WebGL-unsamplable canvas is a soft pass (noted).
    const hardFail =
      result.pageErrors.length > 0 ||
      result.consoleErrors.length > 0 ||
      result.failedRequests.length > 0 ||
      !insp.hasCanvas ||
      insp.painted === false ||
      insp.gateOverlayPresent ||
      (includesSprites && !insp.spritesReady) ||
      (includesPlayer && !insp.playerReady);
    result.pass = !hardFail;
    if (result.pass && result.reasons.length === 0) result.reasons.push('ok');
  } catch (e) {
    result.reasons.push('harness error: ' + e.message);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

(async () => {
  const exe = findChrome();
  if (!exe) {
    console.error('No cached Chrome found under ~/.cache/puppeteer. Set PUPPETEER_EXECUTABLE_PATH or install Chrome for Testing.');
    process.exit(2);
  }
  const games = loadGameList();
  if (!games.length) { console.error('No games matched the filter.'); process.exit(2); }

  console.log('QA harness — chrome:', path.basename(path.dirname(exe)));
  console.log('Testing', games.length, 'game(s)' + (FILTER ? ' (filter: ' + FILTER + ')' : '') + (BATCH ? ' (batch: ' + BATCH + ')' : ''));

  const server = await startServer();
  const baseUrl = 'http://127.0.0.1:' + server.address().port;

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: HEADFUL ? false : true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--mute-audio'],
  });

  const results = [];
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    process.stdout.write('  [' + (i + 1) + '/' + games.length + '] ' + g.slug + ' ... ');
    const r = await testGame(browser, baseUrl, g);
    results.push(r);
    console.log(r.pass ? 'PASS' : 'FAIL' + ' — ' + r.reasons.join('; '));
  }

  await browser.close();
  server.close();

  const passed = results.filter(r => r.pass);
  const failed = results.filter(r => !r.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    chrome: exe,
    filter: FILTER || null,
    batch: BATCH || null,
    paintTimeoutMs: PAINT_TIMEOUT,
    totals: { tested: results.length, passed: passed.length, failed: failed.length },
    failed: failed.map(r => ({ slug: r.slug, reasons: r.reasons })),
    results,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  console.log('\n==== QA SUMMARY ====');
  console.log('tested', results.length, '| passed', passed.length, '| failed', failed.length);
  if (failed.length) {
    console.log('\nFAILURES:');
    failed.forEach(r => console.log('  - ' + r.slug + ': ' + r.reasons.join('; ')));
  }
  console.log('\nFull report: ' + path.relative(DIR, REPORT) + '  |  screenshots: ' + path.relative(DIR, SHOTS_DIR) + '/');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
