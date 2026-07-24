#!/usr/bin/env node
/**
 * patch-forge-title-seas.cjs — SURGICAL live patch that adds the Rogues Guild "Forge a Title"
 * gate endpoint (/seas/forge-title) to an OLDER seas-server.js on the VPS, WITHOUT replacing the
 * whole file. Idempotent (safe to re-run). DRY by default; --write applies the edit.
 *
 * WHY surgical: the live VPS seas-server is an older build than the repo. Re-uploading the whole
 * file risks clobbering live state/edits. This anchors on stable strings and inserts only the new
 * forge bits. It also copies the two NEW files the endpoint needs (the forge module — required by
 * the server — and the UI screen).
 *
 * WHAT IT TOUCHES on the live host:
 *   1. <seas dir>/forge-title.js          ← copied from the repo (game/seas/forge-title.js) — the gate module the server requires
 *   2. <site dir>/forge/index.html        ← copied from the repo (game/seas/forge/index.html) — the player UI screen
 *   3. <server dir>/seas-server.js        ← surgically patched: require + forgeTitle() + route + ROUTES line
 *
 * USAGE (on the VPS, coordinator):
 *   node patch-forge-title-seas.cjs --server /var/www/.../seas-server.js \
 *        --forge-module /var/www/.../seas/forge-title.js \
 *        --repo-root /path/to/MfT-Launch                     # (DRY: prints the diff plan)
 *   node patch-forge-title-seas.cjs ... --write              # applies
 *
 * After patching, set SEAS_TITLES_VAULT=<deployed TITLEw vault> in the seas-server env and restart
 * (pm2 restart seas-server). The endpoint returns a clear 503 until SEAS_TITLES_VAULT is set — never
 * a fake forge.
 *
 * NO SILENT CATCHES — any anchor it can't find aborts loudly (tells you the live file drifted).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WRITE = args.includes('--write');
const SERVER = opt('--server');
if (!SERVER) { console.error('required: --server <path to live seas-server.js>'); process.exit(1); }

// ── the three insertions (anchored on stable strings present in every seas-server build) ──
const REQUIRE_ANCHOR = "const { signSwap } = require('./location-signer.cjs');";
const REQUIRE_INSERT = "\n// FORGE A TITLE (Rogues Guild) — the gate + on-chain step builder. Compute/read only; moves no funds.\nconst forge = require('./forge-title.js');";

// the forgeTitle() function body + helpers (self-contained; mirrors the repo build).
const FORGE_FN = String.raw`
// ════════════════════════════════════════════════════════════════════════════════════════════
// FORGE A TITLE — the Rogues Guild prestige forge (compute/read only; moves no funds, signs nothing).
// Gate: the pawn must have EARNED the Rogues Guild 1-week rung (cbBTC achievement id 1002). Returns
// the EXACT forge steps (relayer plantTree + buyer EXACT-USDC-approve + depositAndWater). 503 if the
// Titles vault isn't deployed (never a fake forge). NOT a financial product — in-game gold + prestige.
// ════════════════════════════════════════════════════════════════════════════════════════════
function titlesVaultAddr() { return process.env.SEAS_TITLES_VAULT || forge.TITLES_VAULT || null; }
let _forgeDeps = null;
function setForgeDeps(d) { _forgeDeps = d; }
async function forgeTitle({ player: playerRaw, collection: collRaw, tokenId }) {
  const player = normalizeAddr(playerRaw);
  const collection = ethers.getAddress(typeof collRaw === 'string' ? collRaw : '');
  if (tokenId === undefined || tokenId === null || ` + "`${tokenId}`" + ` === '') throw new HttpError(400, 'tokenId required');
  const tid = BigInt(tokenId);
  const provider = _forgeDeps ? null : new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  const owner = _forgeDeps ? await _forgeDeps.ownerOf(collection, tid)
    : await new ethers.Contract(collection, ['function ownerOf(uint256) view returns (address)'], provider).ownerOf(tid);
  if (owner.toLowerCase() !== player.toLowerCase()) {
    return { status: 403, body: { ok: false, collection, tokenId: tid.toString(), reason: 'this pawn is not owned by the connected wallet — you can only forge a title for your OWN pawn' } };
  }
  const gate = _forgeDeps ? await _forgeDeps.earned(collection, tid) : await forge.hasEarnedRogue1Week(provider, collection, tid);
  if (!gate.earned) {
    return { status: 403, body: { ok: false, collection, tokenId: tid.toString(), gated: true, achievementId: gate.achievementId, prizePool: gate.prizePool,
      reason: 'the forge is sealed — only a pawn that has earned its week in the Rogues Guild may forge a title. Stand the dockside week (the 1-week Rogues Guild rung) first.' } };
  }
  const vaultAddr = titlesVaultAddr();
  if (!vaultAddr) {
    return { status: 503, body: { ok: false, collection, tokenId: tid.toString(), gated: false, earned: true,
      reason: 'the forge is being lit — the Titles vault is not deployed yet. The gate PASSED; ask the coordinator to deploy it (deploy-ocean-water.cjs WATER_NAME=TITLEw) and set SEAS_TITLES_VAULT.' } };
  }
  const treeId = _forgeDeps ? await _forgeDeps.treeId(vaultAddr, collection, tid) : await forge.treeIdForPawn(provider, vaultAddr, collection, tid);
  const price = forge.FORGE_PRICE_USDC;
  const planted = treeId !== null;
  const steps = planted ? forge.forgeSteps({ vaultAddr, treeId, priceUsdc: price })
    : [ { step: 1, by: 'relayer', target: vaultAddr, method: 'plantTree(address,uint256)', args: { collection, tokenId: tid.toString() }, note: 'the forge-title-keeper relayer registers your pawn first (idempotent; no funds), THEN you approve + deposit.' },
        { step: 2, by: 'buyer', target: forge.USDC, method: 'approve(address,uint256)', args: { spender: vaultAddr, amount: String(price) }, note: 'EXACT approval only — approve precisely the forge price, never MaxUint256.' },
        { step: 3, by: 'buyer', target: vaultAddr, method: 'depositAndWater(uint256,uint256)', args: { treeId: '<assigned by plantTree>', usdcAmount: String(price) }, note: 'LOCKS the principal forever — a permanent endowment; your forged title trickles gold for good.' } ];
  const stipend = _forgeDeps ? await _forgeDeps.stipend(vaultAddr, collection, tid) : await forge.forgedStipendView(provider, vaultAddr, collection, tid);
  return { status: 200, body: { ok: true, collection, tokenId: tid.toString(), owner, earned: true, gated: false, planted,
    titlesVault: vaultAddr, goldToken: forge.GOLD, price: { usdc: String(price), display: (Number(price) / 1e6).toFixed(2) + ' USDC' }, steps, stipend,
    note: 'Forge a magic-ink Rogues Guild title: pay the price, seed a permanent gold-water endowment into your pawn, and hold a forged title that trickles in-game gold to its owner. A prestige artifact — not a financial product.' } };
}
`;
const FORGE_FN_ANCHOR = "// ── deployment info (best-effort; warns, never silent) ───────────────────────────────────────";

const ROUTE_ANCHOR = "  if (route === 'POST /seas/verify-fight') {";
const ROUTE_INSERT = String.raw`  if (route === 'POST /seas/forge-title') {
    const body = await readBody(req);
    const result = await forgeTitle(body);
    return sendJSON(res, result.status, result.body);
  }

`;

const ROUTES_LINE_ANCHOR = "  'POST /seas/sail";
const ROUTES_LINE_INSERT = "  'POST /seas/forge-title  { player, collection, tokenId } — Rogues Guild gate (1-week rung) -> EXACT forge steps + stipend view',\n";

function apply(src) {
  let s = src;
  const changes = [];

  // already patched? (idempotent). If ANY forge marker is present, treat as patched and do NOT
  // re-insert (re-inserting would duplicate `forgeTitle`/`_forgeDeps` → a syntax error). A partial
  // state means the live file drifted — refuse loudly rather than blindly double-insert.
  const hasReq = s.includes("require('../seas/forge-title.js')");
  const hasFn = s.includes("async function forgeTitle(");
  const hasRoute = s.includes("'POST /seas/forge-title'");
  if (hasReq && hasFn && hasRoute) return { s, changes: ['(already patched — no changes)'] };
  if (hasReq || hasFn || hasRoute) {
    throw new Error('PARTIAL forge patch detected (require=' + hasReq + ' fn=' + hasFn + ' route=' + hasRoute + ') — the live file is in a mixed state; fix by hand, do not auto-patch (would duplicate symbols)');
  }

  if (!s.includes(REQUIRE_ANCHOR)) throw new Error('anchor not found: harvest-signer require — live file drifted, patch by hand');
  s = s.replace(REQUIRE_ANCHOR, REQUIRE_ANCHOR + REQUIRE_INSERT); changes.push('+ require forge module');

  if (!s.includes(FORGE_FN_ANCHOR)) throw new Error('anchor not found: deployInfo header — live file drifted, patch by hand');
  s = s.replace(FORGE_FN_ANCHOR, FORGE_FN + '\n' + FORGE_FN_ANCHOR); changes.push('+ forgeTitle() function');

  if (!s.includes(ROUTE_ANCHOR)) throw new Error('anchor not found: /seas/harvest route — live file drifted, patch by hand');
  s = s.replace(ROUTE_ANCHOR, ROUTE_INSERT + ROUTE_ANCHOR); changes.push('+ POST /seas/forge-title route');

  // ROUTES list line (best-effort — only if the harvest line exists; skip quietly if not, the route still works)
  if (s.includes(ROUTES_LINE_ANCHOR)) {
    s = s.replace(ROUTES_LINE_ANCHOR, ROUTES_LINE_INSERT + ROUTES_LINE_ANCHOR); changes.push('+ ROUTES help line');
  } else { changes.push('(ROUTES help line anchor not found — skipped; route still works)'); }

  return { s, changes };
}

(function main() {
  const src = fs.readFileSync(SERVER, 'utf8');
  const { s, changes } = apply(src);
  console.log('patch plan for', SERVER);
  for (const c of changes) console.log('  ', c);

  // copy the two new files the endpoint + UI need (best-effort; only if paths given)
  const repoRoot = opt('--repo-root');
  const forgeModuleDest = opt('--forge-module');
  const uiDest = opt('--ui');
  const copies = [];
  if (repoRoot && forgeModuleDest) copies.push([path.join(repoRoot, 'game', 'seas', 'forge-title.js'), forgeModuleDest]);
  if (repoRoot && uiDest) copies.push([path.join(repoRoot, 'game', 'seas', 'forge', 'index.html'), uiDest]);
  for (const [from, to] of copies) console.log('  copy', from, '->', to);

  if (!WRITE) { console.log('\nDRY — re-run with --write to apply. (set SEAS_TITLES_VAULT + pm2 restart after.)'); return; }

  if (!changes[0].startsWith('(already')) {
    fs.copyFileSync(SERVER, SERVER + '.pre-forge.bak');
    fs.writeFileSync(SERVER, s);
    console.log('\npatched', SERVER, '(backup:', SERVER + '.pre-forge.bak)');
  } else { console.log('\nserver already patched — left as-is'); }

  for (const [from, to] of copies) {
    if (!fs.existsSync(from)) { console.warn('  WARN: source missing, skipped:', from); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to); console.log('  copied', path.basename(from), '->', to);
  }
  console.log('\nDONE. NEXT (coordinator): set SEAS_TITLES_VAULT=<TITLEw vault> in the seas-server env, then pm2 restart seas-server.');
})();
