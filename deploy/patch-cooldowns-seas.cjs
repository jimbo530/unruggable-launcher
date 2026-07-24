#!/usr/bin/env node
/**
 * patch-cooldowns-seas.cjs — SURGICAL live patch that adds the SERVER-AUTHORITATIVE COOLDOWN system +
 * the unified CHRONO-ORB skip + the new orb-skippable BILGE RATS QUEST + the goblin-cave server-cooldown
 * migration to the live VPS seas-server.js, WITHOUT replacing the whole file.
 *
 * Mirrors deploy/patch-forge-title-seas.cjs's anchored approach. The live server ALREADY has the forge
 * patch applied, so this anchors around the CURRENT live state (forge present, cooldowns absent).
 *
 * Idempotent (safe to re-run = no-op if fully patched). DRY by default; --write applies the edits.
 * Aborts LOUDLY if any anchor is missing/drifted (no blind double-insert). Backs up to .pre-cooldowns.bak.
 *
 * WHAT IT TOUCHES on the live host (server file only — NOT the web seas/ dir):
 *   <server dir>/seas-server.js  ← 5 surgical edits:
 *     (1) state.cooldowns/state.orbs schema comment + the additive loadState() migration
 *     (2) ORB_DEPLOY_JSON + ERC20_BAL_ABI config
 *     (3) the SERVER COOLDOWN system + /seas/use-chrono-orb block (inserted before COMBAT SETTLEMENT)
 *     (4) FIGHT_KINDS + issueSeed + verifyFight updates (new bilge-rats-quest kind + cooldown gate/start)
 *     (5) the new routes (use-chrono-orb + cooldown) + the updated issue-seed route + ROUTES lines + exports
 *     (6) the LIVE --selftest combat block — fix the OLD issueSeed call shape (now { status, body }) +
 *         INJECT goblin-migration + cooldown-spine + bilge-rats-quest + chrono-orb coverage so the
 *         patched server prints "[selftest] ALL PASSED". DEP-FREE (no roll-charts / forge / harvest —
 *         only symbols the patch itself adds + the battle-grid modules the selftest already imports).
 *
 * IMPORTANT (the crash lesson): this patch adds NO new seas-SERVER module that require()s ethers. The
 * cooldown/orb logic is INLINE in seas-server.js (which already lives in <server dir> with node_modules).
 * The orb deploy record is read by fs only. NO web-dir module require()s ethers as a result of this patch.
 *
 * USAGE (on the VPS, coordinator):
 *   node patch-cooldowns-seas.cjs --server /var/www/tasern/server/seas-server.js          # DRY (prints plan)
 *   node patch-cooldowns-seas.cjs --server /var/www/tasern/server/seas-server.js --write   # applies
 *
 * After patching: the server AUTO-READS the live CHRONO ORB address from deploy/orb-deployed.json (or set
 * SEAS_ORB_TOKEN in the env). node --check, then node seas-server.js --selftest on the box, then pm2 restart.
 *
 * NO SILENT CATCHES — any anchor it can't find aborts loudly (tells you the live file drifted).
 */
'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WRITE = args.includes('--write');
const SERVER = opt('--server');
if (!SERVER) { console.error('required: --server <path to live seas-server.js>'); process.exit(1); }

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (1) STATE SCHEMA + loadState() ADDITIVE MIGRATION
//   The live (forge-era) file has the ORIGINAL one-line state comment + a loadState() that returns
//   { players: {} } and only seeds/validates { players }. Replace both with the cooldown/orb-aware
//   versions. Anchored on the exact original strings.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const STATE_DECL_FROM =
`let state = null; // { players: { [lowercaseAddr]: { hex:{q,r}, voyage:{fromHex,toHex,departAt,arriveAt,distance}|null } } }`;
const STATE_DECL_TO =
`// state shape (all persisted to storeFile):
//   players   : { [lowercaseAddr]: { hex:{q,r}, voyage:{…}|null } }              — location authority
//   cooldowns : { [pawnKey]: { [actionKey]: untilMs } }                          — SERVER-clock cooldowns
//   orbs      : { [lowercaseAddr]: wholeChronoOrbBalance }                       — server-attributed orb bal
// pawnKey = \`\${collection.toLowerCase()}:\${tokenId}\` (a pawn = collection + tokenId, see pawnKey()).
let state = null;`;

const LOADSTATE_RET_FROM = `  if (!fs.existsSync(storeFile)) return { players: {} };`;
const LOADSTATE_RET_TO = `  if (!fs.existsSync(storeFile)) return { players: {}, cooldowns: {}, orbs: {} };`;

const LOADSTATE_MIG_FROM =
`      throw new Error('store missing { players } shape');
    }
    return parsed;`;
const LOADSTATE_MIG_TO =
`      throw new Error('store missing { players } shape');
    }
    // forward-compat: an older state file (pre-cooldown/orb) has no cooldowns/orbs maps — seed empties.
    // This is NOT a silent recovery from corruption (the { players } shape above is still enforced); it
    // is an intentional, additive schema migration so the live state file upgrades in place.
    if (!parsed.cooldowns || typeof parsed.cooldowns !== 'object') parsed.cooldowns = {};
    if (!parsed.orbs || typeof parsed.orbs !== 'object') parsed.orbs = {};
    return parsed;`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (2) CONFIG — ORB_DEPLOY_JSON + ERC20_BAL_ABI. Inserted right after the POOL_ABI line (stable anchor
//   present in every build). The HARVEST_GROUNDS_JSON line may or may not exist on the live build, so we
//   anchor on POOL_ABI which is older + universal.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const CONFIG_ANCHOR = `const POOL_ABI = ['function location() view returns (uint256)'];`;
const CONFIG_INSERT =
`
// CHRONO ORB (cooldown-skip consumable) deploy record — written by deploy/deploy-chrono-orb.js. The
// server tracks an ATTRIBUTED orb balance in state.orbs and reconciles it against this on-chain ERC20
// balance (wallet-holds + server-attributed, the same model as gold). null address until deployed.
const ORB_DEPLOY_JSON = path.join(__dirname, '..', '..', 'deploy', 'orb-deployed.json');
const ERC20_BAL_ABI = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (3) COOLDOWN SYSTEM + /seas/use-chrono-orb logic — inserted as a self-contained block immediately
//   BEFORE the COMBAT SETTLEMENT banner (a stable anchor). Uses ONLY symbols already present in the
//   live file (ethers, HttpError, ensureState, saveState, addrKey, normalizeAddr, _now, RPC, CHAIN_ID)
//   plus FIGHT_KINDS (defined just below in the combat section — read lazily inside skippableAction).
// ──────────────────────────────────────────────────────────────────────────────────────────────
const COOLDOWN_BLOCK = String.raw`// ════════════════════════════════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE COOLDOWN SYSTEM — the reusable spine. The SERVER (its clock) is the gate for
// EVERY recharge-gated action (bilge / goblin / build / travel). A cooldown is keyed by
// (pawn = collection+tokenId, actionKey) and stored in persistent state.cooldowns. The client's
// localStorage may MIRROR these for display, but it is NEVER the gate — the server re-checks on every
// request and answers 429 { secsLeft } while cooling. This closes the localStorage-edit free-skip hole.
//
// A "pawn" is a collection + tokenId (the NFT that took the field), NOT a wallet — so a cooldown
// follows the pawn even if it changes hands, exactly like the on-chain LootPool per-pawn cooldown.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** The canonical pawn key (collection + tokenId). Checksums the collection, BigInt-normalises tokenId. */
function pawnKey(collectionRaw, tokenId) {
  const collection = ethers.getAddress(typeof collectionRaw === 'string' ? collectionRaw : '');
  if (tokenId === undefined || tokenId === null || ` + "`${tokenId}`" + ` === '') throw new HttpError(400, 'tokenId required');
  const tid = BigInt(tokenId); // throws (visibly) on garbage
  return ` + "`${collection.toLowerCase()}:${tid.toString()}`" + `;
}

/** Seconds left on a (pawn, action) cooldown by the SERVER clock (0 = ready). Read-only; sweeps expiry. */
function cooldownLeft(pawn, action) {
  if (!pawn || !action) throw new HttpError(400, 'cooldownLeft requires (pawn, action)');
  const s = ensureState();
  const forPawn = s.cooldowns[pawn];
  const until = forPawn ? Number(forPawn[action]) || 0 : 0;
  return Math.max(0, Math.ceil((until - _now()) / 1000));
}

/** Start (or extend) a (pawn, action) cooldown for ` + "`seconds`" + ` from now (server clock). Persists. */
function startCooldown(pawn, action, seconds) {
  if (!pawn || !action) throw new HttpError(400, 'startCooldown requires (pawn, action)');
  const secs = Number(seconds);
  if (!(secs > 0)) throw new HttpError(400, ` + "`startCooldown seconds must be > 0 (got ${seconds})`" + `);
  const s = ensureState();
  if (!s.cooldowns[pawn]) s.cooldowns[pawn] = {};
  s.cooldowns[pawn][action] = _now() + secs * 1000;
  saveState();
  return s.cooldowns[pawn][action];
}

/** Clear a (pawn, action) cooldown (the orb-skip + admin path). Persists. Returns true if one existed. */
function clearCooldown(pawn, action) {
  if (!pawn || !action) throw new HttpError(400, 'clearCooldown requires (pawn, action)');
  const s = ensureState();
  const forPawn = s.cooldowns[pawn];
  if (!forPawn || forPawn[action] === undefined) return false;
  delete forPawn[action];
  if (Object.keys(forPawn).length === 0) delete s.cooldowns[pawn]; // keep the map tidy
  saveState();
  return true;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// UNIFIED CHRONO-ORB SKIP — one mechanism reused for ALL cooldowns. The server tracks an ATTRIBUTED
// orb balance per player (state.orbs, backed by the on-chain CHRONO ORB ERC20, reconciled periodically
// — tamper-proof + NO per-skip gas, the same "wallet-holds + server-attributed" model as gold). The
// skip endpoint: verify the pawn is the caller's, verify the player holds >=1 orb, DEBIT 1 orb, then
// clearCooldown(pawn, action). REAL-OR-NOTHING (debit-then-clear): no orb → no skip → a clear reason.
// GUARDRAIL: the orb buys the WAIT ONLY — the player still has to RUN + WIN the quest. No win/prize is
// ever bought (clearCooldown lets the pawn ENTER again; it records no claim + pays nothing).
// ════════════════════════════════════════════════════════════════════════════════════════════

/** Live CHRONO ORB token address (deploy record), or null until deploy-chrono-orb.js --execute runs. */
function orbTokenAddr() {
  if (process.env.SEAS_ORB_TOKEN) return ethers.getAddress(process.env.SEAS_ORB_TOKEN);
  if (!fs.existsSync(ORB_DEPLOY_JSON)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(ORB_DEPLOY_JSON, 'utf8'));
    const e = j && j.orbs && j.orbs['chrono-orb'];
    return e && e.address ? ethers.getAddress(e.address) : null;
  } catch (e) { throw new HttpError(500, ` + "`corrupt orb deploy record: ${e.message}`" + `); }
}

/** Server-attributed CHRONO ORB balance for a wallet (whole units). 0 if none. */
function getOrbBalance(checksummed) {
  const s = ensureState();
  const v = Number(s.orbs[addrKey(checksummed)] || 0);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}
/** Set the server-attributed orb balance (whole, never negative). Persists. */
function setOrbBalance(checksummed, units) {
  const s = ensureState();
  s.orbs[addrKey(checksummed)] = Math.max(0, Math.floor(Number(units) || 0));
  saveState();
  return s.orbs[addrKey(checksummed)];
}

// TEST/OPS SEAM: the selftest injects an offline on-chain orb-balance reader + the pawn-owner check so
// the full skip path is provable with NO RPC. Prod leaves these null → real on-chain reads.
let _orbDeps = null;
function setOrbDeps(d) { _orbDeps = d; }

/** Read the wallet's REAL on-chain CHRONO ORB balance (whole units). For periodic reconciliation. */
async function readOnchainOrbs(checksummed) {
  if (_orbDeps && _orbDeps.readOnchainOrbs) return _orbDeps.readOnchainOrbs(checksummed);
  const token = orbTokenAddr();
  if (!token) return null; // not deployed yet — nothing to reconcile against
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  const c = new ethers.Contract(token, ERC20_BAL_ABI, provider);
  const [bal, dec] = await Promise.all([c.balanceOf(checksummed), c.decimals()]);
  return Math.floor(Number(ethers.formatUnits(bal, dec)));
}

/** Verify a pawn is owned by the caller (on-chain ownerOf). Throwing/visible; injectable for tests. */
async function readPawnOwner(collectionRaw, tokenId) {
  const collection = ethers.getAddress(typeof collectionRaw === 'string' ? collectionRaw : '');
  const tid = BigInt(tokenId);
  if (_orbDeps && _orbDeps.ownerOf) return _orbDeps.ownerOf(collection, tid);
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  const c = new ethers.Contract(collection, ['function ownerOf(uint256) view returns (address)'], provider);
  return c.ownerOf(tid);
}

/** Human label for an orb-skippable action (display only). Any registered server cooldown is skippable. */
const ACTION_LABELS = {
  'goblin-cave': 'Goblin Cave',
  'bilge-rats-quest': 'Bilge Rats (Quest)',
};
/** Is this action orb-skippable? An action is skippable iff it is a SERVER-cooldown fight kind (the
 *  single source of truth is FIGHT_KINDS[kind].cooldownSecs) OR a future non-fight cooldown action
 *  explicitly registered in ACTION_LABELS. One skip endpoint serves them all — generic by design.
 *  NOTE: FIGHT_KINDS is defined further down (combat section); this is a function so it reads it lazily. */
function skippableAction(action) {
  const k = FIGHT_KINDS[action];
  if (k && k.cooldownSecs) return { ok: true, label: ACTION_LABELS[action] || action };
  if (ACTION_LABELS[action]) return { ok: true, label: ACTION_LABELS[action] };
  return { ok: false };
}

/**
 * The orb-skip referee. RECONCILE the attributed balance up to the live on-chain balance first (so a
 * fresh on-chain top-up is honoured without per-skip gas), then: ownership gate → balance gate → DEBIT
 * 1 orb → clearCooldown(pawn, action). Real-or-nothing: the debit happens BEFORE the clear, and only if
 * the balance is sufficient. Returns { status, body }.
 *   Input: { player, collection, tokenId, action }.
 */
async function useChronoOrb({ player: playerRaw, collection: collRaw, tokenId, action: actionRaw }) {
  const player = normalizeAddr(playerRaw);
  const action = String(actionRaw || '').trim();
  const skip = skippableAction(action);
  if (!skip.ok) {
    const known = [...new Set([...Object.keys(FIGHT_KINDS).filter((k) => FIGHT_KINDS[k].cooldownSecs), ...Object.keys(ACTION_LABELS)])];
    return { status: 400, body: { ok: false, reason: ` + "`unknown skippable action \"${actionRaw}\" (known: ${known.join(', ')})`" + ` } };
  }
  const pawn = pawnKey(collRaw, tokenId); // validates collection + tokenId (throws on garbage)
  const collection = ethers.getAddress(collRaw);
  const tid = BigInt(tokenId);

  // 1) OWNERSHIP — you can only skip a cooldown on a pawn you OWN (the orb is debited from YOUR balance).
  const owner = await readPawnOwner(collection, tid);
  if (String(owner).toLowerCase() !== player.toLowerCase()) {
    return { status: 403, body: { ok: false, action, collection, tokenId: tid.toString(),
      reason: 'this pawn is not owned by the connected wallet — you can only skip a cooldown for your OWN pawn' } };
  }

  // 2) is it even on cooldown? don't waste an orb on a ready pawn.
  const left = cooldownLeft(pawn, action);
  if (left <= 0) {
    return { status: 409, body: { ok: false, action, collection, tokenId: tid.toString(), secsLeft: 0,
      reason: ` + "`${skip.label} is not on cooldown for this pawn — nothing to skip (an orb would be wasted)`" + ` } };
  }

  // 3) RECONCILE the attributed balance up to the live on-chain balance (tamper-proof; no per-skip gas).
  //    We only ever RAISE the attributed balance to match chain (never silently lower a spent balance —
  //    a debit the server already applied stays applied until the next settlement run reconciles down).
  let onchain = null;
  try { onchain = await readOnchainOrbs(player); }
  catch (e) { return { status: 502, body: { ok: false, action, reason: ` + "`could not read on-chain CHRONO ORB balance: ${e.message}`" + ` } }; }
  let attributed = getOrbBalance(player);
  if (onchain !== null && onchain > attributed) { attributed = setOrbBalance(player, onchain); }

  // 4) BALANCE gate — real-or-nothing: no orb → no skip, with a clear reason (never a free skip).
  if (attributed < 1) {
    const tokenInfo = orbTokenAddr();
    return { status: 402, body: { ok: false, action, collection, tokenId: tid.toString(), secsLeft: left, orbs: attributed,
      orbToken: tokenInfo,
      reason: tokenInfo
        ? 'you hold no Chrono Orb — acquire one (buy/win) to skip a cooldown. No orb, no skip.'
        : 'the Chrono Orb token is not deployed yet — skipping is unavailable until the coordinator deploys it. No fake skip.' } };
  }

  // 5) DEBIT 1 orb FIRST (real-or-nothing), then CLEAR the cooldown. If the clear somehow no-ops (race),
  //    the debit still stands — the orb was genuinely spent on a skip request for a cooling pawn.
  const orbsLeft = setOrbBalance(player, attributed - 1);
  const cleared = clearCooldown(pawn, action);

  return {
    status: 200,
    body: {
      ok: true, action, collection, tokenId: tid.toString(),
      skipped: true, cleared, orbsLeft, orbToken: orbTokenAddr(),
      // GUARDRAIL, stated to the client: the orb bought the WAIT only.
      note: ` + "`Chrono Orb spent — ${skip.label} cooldown cleared. You may ENTER again now, but you still have to RUN and WIN the quest. No win or prize was bought.`" + `,
    },
  };
}

`;
// the COMBAT SETTLEMENT banner — the block is inserted directly before this (stable in every build).
// The block is inserted directly before the COMBAT SETTLEMENT banner. We anchor on the 2-line banner
// (the ═ rule + the unique COMBAT SETTLEMENT comment) so the block lands cleanly ABOVE the whole banner
// (not between the rule and the comment). The ═ rule line is identical across builds (shared origin);
// apply() verifies the anchor is present + unique and aborts loudly otherwise. The block ends with its
// OWN ═ banners so the section sequence reads correctly after insertion.
const COOLDOWN_ANCHOR =
`// ════════════════════════════════════════════════════════════════════════════════════════════
// COMBAT SETTLEMENT — issue-seed (anti-grind anchor) + verify-fight (server-replay referee).`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (4a) FIGHT_KINDS — SHORT byte-exact anchor. The live doc comment drifted (it's 2 lines, not 4), so
//   we DO NOT touch the comment. We anchor on the single, byte-exact, UNIQUE 'goblin-cave' DATA line
//   (identical in the live snapshot) and replace it with: goblin-cave + cooldownSecs, then the NEW
//   bilge-rats-quest line. 'bilge-rats' stays exactly as-is (un-gated arena). This adds the cooldown
//   metadata + the new kind without depending on the fragile multi-line comment block.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const FIGHT_KINDS_FROM =
`  'goblin-cave': { mod: 'goblin', buildEnemies: 'buildGoblinEnemies', terrain: 'caveTerrain',  grid: 'SQUAD_GRID' },`;
const FIGHT_KINDS_TO =
`  // goblin cave — MIGRATED to the server cooldown (168h = 7 days), orb-skippable. localStorage display-only.
  'goblin-cave':      { mod: 'goblin', buildEnemies: 'buildGoblinEnemies', terrain: 'caveTerrain',  grid: 'SQUAD_GRID',
                        cooldownSecs: Number(process.env.SEAS_GOBLIN_CD_SECS || 168 * 3600) },
  // NEW server-gated bilge quest — reuses the HARDENED bilge engine, but its recharge lives on the SERVER
  // (1h, orb-skippable), NOT in an immutable on-chain LootPool. This is the quest born server-gated.
  'bilge-rats-quest': { mod: 'bilge',  buildEnemies: 'buildBilgeEnemies',  terrain: 'bilgeTerrain', grid: 'SQUAD_GRID',
                        cooldownSecs: Number(process.env.SEAS_BILGE_QUEST_CD_SECS || 3600) },`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (4b) issueSeed — replace the ORIGINAL signature + body with the pawn-aware, cooldown-gating version.
//   Anchored on the ORIGINAL function (returns { seed, nonce, fight }).
// ──────────────────────────────────────────────────────────────────────────────────────────────
const ISSUESEED_FROM = String.raw`function issueSeed(playerRaw, fightRaw) {
  const player = normalizeAddr(playerRaw);
  const fight = String(fightRaw || 'bilge-rats');
  if (!FIGHT_KINDS[fight]) throw new HttpError(400, ` + "`unknown fight \"${fight}\" (known: ${Object.keys(FIGHT_KINDS).join(', ')})`" + `);
  const now = _now();
  gcFights(now);
  const seed = 'seas-' + fight + '-' + crypto.randomBytes(16).toString('hex'); // unguessable RNG anchor
  const nonce = crypto.randomBytes(12).toString('hex');
  _fights.set(nonce, { player: addrKey(player), fight, seed, used: false, issuedAt: now });
  return { seed, nonce, fight };
}`;
const ISSUESEED_TO = String.raw`function issueSeed(playerRaw, fightRaw, opts = {}) {
  const player = normalizeAddr(playerRaw);
  const fight = String(fightRaw || 'bilge-rats');
  const kind = FIGHT_KINDS[fight];
  if (!kind) throw new HttpError(400, ` + "`unknown fight \"${fight}\" (known: ${Object.keys(FIGHT_KINDS).join(', ')})`" + `);

  // cooldown-gated kinds: require the pawn + check the SERVER cooldown (the real gate).
  let pawn = null;
  if (kind.cooldownSecs) {
    if (!opts || opts.collection === undefined || opts.tokenId === undefined) {
      throw new HttpError(400, ` + "`the \"${fight}\" fight is cooldown-gated — pass { collection, tokenId } (the pawn entering) so the server can gate it`" + `);
    }
    pawn = pawnKey(opts.collection, opts.tokenId);
    const left = cooldownLeft(pawn, fight);
    if (left > 0) {
      return { status: 429, body: { ok: false, fight, secsLeft: left,
        reason: ` + "`this pawn is spent — ${fight} recharges in ${left}s. Skip the wait with a Chrono Orb (POST /seas/use-chrono-orb), or wait it out.`" + ` } };
    }
  }

  const now = _now();
  gcFights(now);
  const seed = 'seas-' + fight + '-' + crypto.randomBytes(16).toString('hex'); // unguessable RNG anchor
  const nonce = crypto.randomBytes(12).toString('hex');
  _fights.set(nonce, { player: addrKey(player), fight, seed, used: false, issuedAt: now, pawn });
  return { status: 200, body: { ok: true, seed, nonce, fight, pawn } };
}`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (4c) verifyFight — done as THREE SHORT byte-exact edits (no fragile multi-line block):
//   (4c-i)  insert the cooldown-start logic AFTER the unique "rec.used = true;" line
//   (4c-ii) add the `pawn` field to the return body (unique "ok: true, nonce, fight: rec.fight, seed," line)
//   (4c-iii) swap the payoutEligible line for playerWon + the cooldown fields (unique payoutEligible line)
//   All anchors verified byte-exact + unique in the live snapshot.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const VERIFY_NONCE_FROM = `  if (!result.finalState.exhausted) rec.used = true;`;
const VERIFY_NONCE_TO = `  if (!result.finalState.exhausted) rec.used = true;

  // SERVER COOLDOWN: a cooldown-gated kind STARTS the pawn's cooldown on a conclusive verdict (win OR
  // loss — entering + concluding the fight consumes the slot, the bilge/goblin "run consumes it" rule).
  // We do this on the SERVER clock (the authority), keyed by the pawn the issue-seed recorded. An
  // inconclusive/exhausted log is NOT a conclusion → no cooldown started (you may resubmit / retry).
  const playerWon = result.winner === 'player' && !result.finalState.exhausted;
  let cooldownStarted = 0;
  if (kind.cooldownSecs && rec.pawn && !result.finalState.exhausted) {
    cooldownStarted = startCooldown(rec.pawn, rec.fight, kind.cooldownSecs);
  }`;

const VERIFY_BODY_FROM = `      ok: true, nonce, fight: rec.fight, seed,`;
const VERIFY_BODY_TO = `      ok: true, nonce, fight: rec.fight, seed, pawn: rec.pawn || null,`;

const VERIFY_PAYOUT_FROM =
`      // a server-verified player win is the keeper's gate to fire LootPool.payout (DRY until founder opens it)
      payoutEligible: result.winner === 'player' && !result.finalState.exhausted,`;
const VERIFY_PAYOUT_TO =
`      // a server-verified player win is the keeper's gate to fire the reward payout (DRY until founder opens it)
      payoutEligible: playerWon,
      // when this pawn can fight this kind again (server-cooldown kinds only; 0 = no server cooldown)
      cooldownUntil: cooldownStarted || 0,
      cooldownSecs: kind.cooldownSecs || 0,`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (5a) issue-seed ROUTE — replace the original (no pawn) route with the pawn-aware version + add the
//   use-chrono-orb + cooldown routes. Anchored on the ORIGINAL issue-seed route handler.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const ROUTE_FROM = String.raw`  if (route === 'POST /seas/issue-seed') {
    const body = await readBody(req);
    const out = issueSeed(body.player, body.fight);
    return sendJSON(res, 200, { ok: true, ...out });
  }`;
const ROUTE_TO = String.raw`  if (route === 'POST /seas/issue-seed') {
    const body = await readBody(req);
    const out = issueSeed(body.player, body.fight, { collection: body.collection, tokenId: body.tokenId });
    return sendJSON(res, out.status, out.body);
  }

  if (route === 'POST /seas/use-chrono-orb') {
    const body = await readBody(req);
    const result = await useChronoOrb(body);
    return sendJSON(res, result.status, result.body);
  }

  if (route === 'GET /seas/cooldown') {
    // UI helper: how long until this pawn can do ` + "`action`" + ` again (server clock). Client may MIRROR for
    // display, but THIS is the truth. ?collection=0x..&tokenId=..&action=goblin-cave
    const collection = u.searchParams.get('collection');
    const tokenId = u.searchParams.get('tokenId');
    const action = String(u.searchParams.get('action') || '').trim();
    if (!action) throw new HttpError(400, 'action required (e.g. goblin-cave | bilge-rats-quest)');
    const pawn = pawnKey(collection, tokenId);
    const secsLeft = cooldownLeft(pawn, action);
    return sendJSON(res, 200, { ok: true, pawn, action, secsLeft, ready: secsLeft <= 0 });
  }`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (5b) ROUTES help list — replace the original issue-seed/verify-fight help lines with the augmented
//   ones + the two new help lines. Anchored on the ORIGINAL issue-seed help line.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const ROUTES_HELP_FROM =
`  'POST /seas/issue-seed   { player, fight }                              — pin a fight RNG seed + nonce (anti-grind)',
  'POST /seas/verify-fight { player, nonce, playerTeam, playerActions }   — REPLAY the engine → authoritative { winner }',`;
const ROUTES_HELP_TO =
`  'POST /seas/issue-seed   { player, fight, collection?, tokenId? }       — pin a fight RNG seed + nonce (anti-grind); 429 if pawn cooling (cooldown kinds need collection+tokenId)',
  'POST /seas/verify-fight { player, nonce, playerTeam, playerActions }   — REPLAY the engine → authoritative { winner }; starts the server cooldown on a conclusive cooldown-kind run',
  'POST /seas/use-chrono-orb { player, collection, tokenId, action }      — DEBIT 1 server-attributed Chrono Orb → clear a server cooldown (skip the WAIT only; must still RUN+WIN). 402 no orb, 403 not owner, 409 not cooling',
  'GET  /seas/cooldown?collection=0x..&tokenId=..&action=goblin-cave      — server-clock secsLeft for a pawn+action (display truth)',`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (5c) module.exports — add the cooldown + orb symbols. Anchored on the ORIGINAL combat-settlement
//   export line ("// combat settlement\n  issueSeed, verifyFight,").
// ──────────────────────────────────────────────────────────────────────────────────────────────
const EXPORTS_FROM =
`  // combat settlement
  issueSeed, verifyFight,`;
const EXPORTS_TO =
`  // server-authoritative cooldown system (the reusable spine)
  pawnKey, cooldownLeft, startCooldown, clearCooldown,
  // unified chrono-orb skip
  useChronoOrb, getOrbBalance, setOrbBalance, orbTokenAddr, readOnchainOrbs, setOrbDeps,
  // combat settlement
  issueSeed, verifyFight,`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (6) LIVE SELFTEST FIX — the live --selftest still calls issueSeed the OLD way (reads iss.seed
//   directly), but issueSeed now returns { status, body }. Three SHORT byte-exact edits make the
//   live selftest exercise the NEW signature + assert the new cooldown/quest/orb behavior, so the
//   patched server prints "[selftest] ALL PASSED". DEP-FREE: uses ONLY symbols the patched server now
//   has (pawnKey/cooldownLeft/startCooldown/clearCooldown/useChronoOrb/setOrbDeps/setOrbBalance/
//   getOrbBalance) + the battle-grid modules the live selftest ALREADY dynamic-imports (bilge/ci/eng/
//   gc/res/leader/playBilge/requireCombat). NO roll-charts, NO forge, NO harvest — nothing the VPS lacks.
//
//   (6a-i)  the FIRST  bilge-rats issue-seed → read .body (the original arena is NOT cooldown-gated)
//   (6a-ii) the SECOND bilge-rats issue-seed → read .body
//   (6b)    AFTER the last original combat assertion, INJECT goblin-migration + cooldown-spine +
//           bilge-rats-quest + chrono-orb coverage (mirrors the canonical 72/72 block, minus deps).
// ──────────────────────────────────────────────────────────────────────────────────────────────
const ST_ISS1_FROM = `    const iss = issueSeed(player, 'bilge-rats');`;
const ST_ISS1_TO   = `    const iss = issueSeed(player, 'bilge-rats').body; // issueSeed now returns { status, body }; arena is NOT cooldown-gated`;

const ST_ISS2_FROM = `    const iss2 = issueSeed(player, 'bilge-rats');`;
const ST_ISS2_TO   = `    const iss2 = issueSeed(player, 'bilge-rats').body;`;

// anchor = the LAST original combat assertion line (byte-exact, unique); we APPEND the new coverage
// after it (still inside the try{} block, before the "ALL PASSED" log).
const ST_TAIL_FROM = `    assert(verifyFight({ player, nonce: iss2.nonce, playerTeam: [leader], playerActions: [{ unit: 'LEADER', type: 'end' }] }).status === 200, 'an inconclusive nonce is still resubmittable (not consumed)');`;
const ST_TAIL_TO = String.raw`    assert(verifyFight({ player, nonce: iss2.nonce, playerTeam: [leader], playerActions: [{ unit: 'LEADER', type: 'end' }] }).status === 200, 'an inconclusive nonce is still resubmittable (not consumed)');

    // GOBLIN CAVE — now MIGRATED to the server cooldown (was localStorage). It is cooldown-gated, so
    // issue-seed REQUIRES the pawn (collection+tokenId) + gates on the server clock. Prove the dispatch
    // still reconstructs GOBLINS (not rats). DEP-FREE: reuses the already-imported battle-grid modules.
    const GCOLL = '0x9500880DEC9B310b4a728C75A271a25615A2443E';
    let gThrew = false;
    try { issueSeed(player, 'goblin-cave'); } catch (e) { gThrew = /cooldown-gated — pass/.test(e.message); }
    assert(gThrew, 'goblin-cave issue-seed REFUSES without a pawn (it is server-cooldown-gated now)');
    const gIssR = issueSeed(player, 'goblin-cave', { collection: GCOLL, tokenId: '5' });
    assert(gIssR.status === 200, 'goblin-cave issue-seed with a fresh pawn → 200 (not on cooldown)');
    const gIss = gIssR.body;
    assert(typeof gIss.seed === 'string' && gIss.seed.startsWith('seas-goblin-cave-') && gIss.fight === 'goblin-cave', 'issue-seed accepts goblin-cave + tags the seed');
    const { goblin } = requireCombat();
    const gEnemies = goblin.buildGoblinEnemies(gIss.seed, [leader.position]);
    assert(Array.isArray(gEnemies) && gEnemies.length >= 1, 'goblin-cave reconstructs a goblin squad from the pinned seed');
    const gVerify = verifyFight({ player, nonce: gIss.nonce, playerTeam: [{ ...leader }], playerActions: [{ unit: 'LEADER', type: 'end' }] });
    assert(gVerify.status === 200 && gVerify.body.fight === 'goblin-cave' && gVerify.body.enemies === gEnemies.length,
      ` + "`verify-fight resolves the goblin-cave kind (rebuilt ${gVerify.body.enemies} goblins)`" + `);

    // SERVER-AUTHORITATIVE COOLDOWN SYSTEM (the reusable spine) — direct helper tests.
    console.log('\\n[selftest] server-authoritative cooldown system:');
    const cdPawn = pawnKey(GCOLL, '5');
    assert(cdPawn === GCOLL.toLowerCase() + ':5', 'pawnKey == collection.toLowerCase():tokenId');
    assert(cooldownLeft(cdPawn, 'goblin-cave') === 0, 'fresh pawn: cooldownLeft == 0 (ready)');
    startCooldown(cdPawn, 'goblin-cave', 3600);
    assert(cooldownLeft(cdPawn, 'goblin-cave') === 3600, 'startCooldown(3600) → cooldownLeft == 3600s (server clock)');
    assert(cooldownLeft(cdPawn, 'bilge-rats-quest') === 0, 'cooldowns are keyed per (pawn, action) — a different action is unaffected');
    assert(cooldownLeft(pawnKey(GCOLL, '6'), 'goblin-cave') === 0, 'cooldowns are per-pawn — a different tokenId is unaffected');
    const cooling = issueSeed(player, 'goblin-cave', { collection: GCOLL, tokenId: '5' });
    assert(cooling.status === 429 && cooling.body.secsLeft === 3600, 'a cooling pawn → issue-seed 429 { secsLeft } (SERVER is the gate)');
    T += 1800 * 1000;
    assert(cooldownLeft(cdPawn, 'goblin-cave') === 1800, 'after 1800s the cooldown has drained to 1800s (server clock is the truth)');
    assert(clearCooldown(cdPawn, 'goblin-cave') === true && cooldownLeft(cdPawn, 'goblin-cave') === 0, 'clearCooldown frees the pawn (cooldownLeft → 0)');
    assert(clearCooldown(cdPawn, 'goblin-cave') === false, 'clearCooldown on an already-clear (pawn,action) → false (no-op)');
    startCooldown(cdPawn, 'goblin-cave', 7200);
    state = null; // force a reload from disk
    assert(cooldownLeft(cdPawn, 'goblin-cave') === 7200, 'cooldown PERSISTS across a state reload (durable authority, not memory)');
    clearCooldown(cdPawn, 'goblin-cave');

    // NEW BILGE RATS QUEST — born SERVER-GATED (1h server cooldown), reuses the hardened bilge engine.
    console.log('\\n[selftest] NEW bilge-rats-quest (server-gated, orb-skippable):');
    const qPawn = { collection: GCOLL, tokenId: '7' };
    const qKey = pawnKey(qPawn.collection, qPawn.tokenId);
    let qThrew = false;
    try { issueSeed(player, 'bilge-rats-quest'); } catch (e) { qThrew = /cooldown-gated — pass/.test(e.message); }
    assert(qThrew, 'bilge-rats-quest issue-seed REFUSES without a pawn (server-cooldown-gated, NOT an on-chain LootPool gate)');
    const qIssR = issueSeed(player, 'bilge-rats-quest', qPawn);
    assert(qIssR.status === 200 && qIssR.body.seed.startsWith('seas-bilge-rats-quest-'), 'bilge-rats-quest issue-seed → 200, seed tagged with the kind');
    const qIss = qIssR.body;
    const qPlay = playBilge(qIss.seed, { ...leader }, bilge, ci, eng, gc, res);
    const qV = verifyFight({ player, nonce: qIss.nonce, playerTeam: [{ ...leader }], playerActions: qPlay.actions });
    assert(qV.status === 200 && qV.body.fight === 'bilge-rats-quest', 'verify-fight resolves the new bilge-rats-quest kind (reuses the bilge engine)');
    assert(qV.body.winner === 'player' && qV.body.payoutEligible === true, 'a server-verified quest WIN is payout-eligible (skill-based, must win)');
    assert(qV.body.cooldownSecs === 3600 && qV.body.cooldownUntil > 0, 'a conclusive quest run STARTS the 1h server cooldown for the pawn');
    assert(cooldownLeft(qKey, 'bilge-rats-quest') === 3600, 'after the win the pawn is cooling (cooldownLeft == 3600s)');
    const qReenter = issueSeed(player, 'bilge-rats-quest', qPawn);
    assert(qReenter.status === 429 && qReenter.body.secsLeft === 3600, 're-entry while cooling → 429 (the quest cannot be ground)');

    // UNIFIED CHRONO-ORB SKIP — debit 1 orb → clear a server cooldown; real-or-nothing; skips WAIT only.
    console.log('\\n[selftest] unified chrono-orb skip (/seas/use-chrono-orb):');
    const orbState = { owner: player, onchain: 0 };
    setOrbDeps({ ownerOf: async () => orbState.owner, readOnchainOrbs: async () => orbState.onchain });
    const stranger = '0x0000000000000000000000000000000000000099';
    let o = await useChronoOrb({ player: stranger, collection: GCOLL, tokenId: '7', action: 'bilge-rats-quest' });
    assert(o.status === 403 && /not owned by the connected wallet/.test(o.body.reason), 'orb-skip REFUSES a pawn the caller does not own → 403');
    o = await useChronoOrb({ player, collection: GCOLL, tokenId: '7', action: 'no-such-action' });
    assert(o.status === 400 && /unknown skippable action/.test(o.body.reason), 'orb-skip rejects an unknown action → 400');
    setOrbBalance(player, 0); orbState.onchain = 0;
    o = await useChronoOrb({ player, collection: GCOLL, tokenId: '7', action: 'bilge-rats-quest' });
    assert(o.status === 402 && o.body.orbs === 0, 'no orb → 402 with a clear reason (real-or-nothing: no free skip)');
    assert(cooldownLeft(qKey, 'bilge-rats-quest') === 3600, 'a failed (no-orb) skip leaves the cooldown UNTOUCHED');
    orbState.onchain = 2;
    o = await useChronoOrb({ player, collection: GCOLL, tokenId: '7', action: 'bilge-rats-quest' });
    assert(o.status === 200 && o.body.skipped === true && o.body.cleared === true, 'orb-skip with a balance → 200, cooldown cleared');
    assert(o.body.orbsLeft === 1, 'exactly ONE orb debited (2 reconciled in → 1 left)');
    assert(cooldownLeft(qKey, 'bilge-rats-quest') === 0, 'after the orb skip the pawn is READY again (the WAIT is skipped)');
    assert(/still have to RUN and WIN|No win or prize was bought/.test(o.body.note), 'orb-skip note states the guardrail: WAIT only, no win/prize bought');
    const qAfter = issueSeed(player, 'bilge-rats-quest', qPawn);
    assert(qAfter.status === 200, 'after the skip the pawn may ENTER again (but must still play + win for any reward)');
    clearCooldown(qKey, 'bilge-rats-quest');
    o = await useChronoOrb({ player, collection: GCOLL, tokenId: '7', action: 'bilge-rats-quest' });
    assert(o.status === 409 && /not on cooldown/.test(o.body.reason), 'skipping a ready pawn → 409 (no orb wasted)');
    assert(getOrbBalance(player) === 1, 'a refused skip does NOT debit an orb (still 1)');
    setOrbDeps(null);`;

// ── ordered edit plan: each step is { name, kind, from, to } | { name, kind:'insertBefore', anchor, text } ──
const EDITS = [
  { name: '(1a) state schema comment',            kind: 'replace', from: STATE_DECL_FROM,    to: STATE_DECL_TO },
  { name: '(1b) loadState default return',         kind: 'replace', from: LOADSTATE_RET_FROM, to: LOADSTATE_RET_TO },
  { name: '(1c) loadState additive migration',     kind: 'replace', from: LOADSTATE_MIG_FROM, to: LOADSTATE_MIG_TO },
  { name: '(2)  ORB config (deploy json + ABI)',   kind: 'after',   anchor: CONFIG_ANCHOR,    text: CONFIG_INSERT },
  { name: '(3)  cooldown system + use-chrono-orb', kind: 'insertBefore', anchor: COOLDOWN_ANCHOR, text: COOLDOWN_BLOCK },
  { name: '(4a) FIGHT_KINDS (goblin cd + bilge-rats-quest)', kind: 'replace', from: FIGHT_KINDS_FROM, to: FIGHT_KINDS_TO },
  { name: '(4b) issueSeed (pawn + cooldown gate)', kind: 'replace', from: ISSUESEED_FROM,     to: ISSUESEED_TO },
  { name: '(4c-i) verifyFight cooldown-start',     kind: 'replace', from: VERIFY_NONCE_FROM,  to: VERIFY_NONCE_TO },
  { name: '(4c-ii) verifyFight body pawn field',   kind: 'replace', from: VERIFY_BODY_FROM,   to: VERIFY_BODY_TO },
  { name: '(4c-iii) verifyFight payout+cooldown',  kind: 'replace', from: VERIFY_PAYOUT_FROM, to: VERIFY_PAYOUT_TO },
  { name: '(5a) issue-seed + new routes',          kind: 'replace', from: ROUTE_FROM,         to: ROUTE_TO },
  { name: '(5b) ROUTES help lines',                kind: 'replace', from: ROUTES_HELP_FROM,   to: ROUTES_HELP_TO },
  { name: '(5c) module.exports additions',         kind: 'replace', from: EXPORTS_FROM,       to: EXPORTS_TO },
  { name: '(6a-i) selftest iss .body',             kind: 'replace', from: ST_ISS1_FROM,       to: ST_ISS1_TO },
  { name: '(6a-ii) selftest iss2 .body',           kind: 'replace', from: ST_ISS2_FROM,       to: ST_ISS2_TO },
  { name: '(6b) selftest cooldown/quest/orb cover', kind: 'replace', from: ST_TAIL_FROM,      to: ST_TAIL_TO },
];

// idempotency markers — if ALL present, the file is fully patched (no-op). Cover one symbol per step.
const MARKERS = [
  'function useChronoOrb(',               // step 3
  "'bilge-rats-quest':",                  // step 4a
  'function pawnKey(',                    // step 3 (cooldown spine)
  "if (!parsed.orbs || typeof parsed.orbs", // step 1c migration
  'const ORB_DEPLOY_JSON',                // step 2
  "if (route === 'POST /seas/use-chrono-orb')", // step 5a
  "issueSeed(player, 'bilge-rats').body", // step 6a (live selftest now reads .body)
  "[selftest] NEW bilge-rats-quest (server-gated, orb-skippable):", // step 6b (injected selftest coverage)
];

function fullyPatched(s) { return MARKERS.every((m) => s.includes(m)); }
function partiallyPatched(s) { return MARKERS.some((m) => s.includes(m)) && !fullyPatched(s); }

function apply(src) {
  let s = src;
  const changes = [];

  if (fullyPatched(s)) return { s, changes: ['(already fully patched — no changes)'] };
  if (partiallyPatched(s)) {
    const present = MARKERS.filter((m) => s.includes(m));
    throw new Error('PARTIAL cooldown patch detected — these markers are present but not all:\n  ' +
      present.join('\n  ') + '\nThe live file is in a mixed state; fix by hand, do NOT auto-patch (would duplicate symbols).');
  }

  for (const e of EDITS) {
    if (e.kind === 'replace') {
      if (!s.includes(e.from)) {
        throw new Error('ANCHOR NOT FOUND for ' + e.name + ' — the live file drifted from the expected (forge-era) text.\n' +
          'Patch by hand. Expected to find:\n--- BEGIN ANCHOR ---\n' + e.from + '\n--- END ANCHOR ---');
      }
      // guard against an ambiguous anchor (must be unique so we replace exactly the intended block)
      if (s.indexOf(e.from) !== s.lastIndexOf(e.from)) {
        throw new Error('AMBIGUOUS anchor for ' + e.name + ' — appears more than once; refusing to guess. Patch by hand.');
      }
      s = s.replace(e.from, e.to);
      changes.push('~ ' + e.name);
    } else if (e.kind === 'after') {
      if (!s.includes(e.anchor)) throw new Error('ANCHOR NOT FOUND for ' + e.name + ' (after: ' + e.anchor + ') — live file drifted, patch by hand');
      if (s.indexOf(e.anchor) !== s.lastIndexOf(e.anchor)) throw new Error('AMBIGUOUS anchor for ' + e.name + ' — patch by hand');
      s = s.replace(e.anchor, e.anchor + e.text);
      changes.push('+ ' + e.name);
    } else if (e.kind === 'insertBefore') {
      if (!s.includes(e.anchor)) throw new Error('ANCHOR NOT FOUND for ' + e.name + ' (before COMBAT SETTLEMENT banner) — live file drifted, patch by hand');
      if (s.indexOf(e.anchor) !== s.lastIndexOf(e.anchor)) throw new Error('AMBIGUOUS anchor for ' + e.name + ' — patch by hand');
      s = s.replace(e.anchor, e.text + e.anchor);
      changes.push('+ ' + e.name);
    }
  }

  // post-condition: every marker must now be present (proves all 6 step-groups landed, incl. the
  // live-selftest fix in step 6 — without it the patched server's --selftest FAILS at combat settlement)
  if (!fullyPatched(s)) {
    const missing = MARKERS.filter((m) => !s.includes(m));
    throw new Error('POST-PATCH CHECK FAILED — these markers are still missing after applying edits:\n  ' + missing.join('\n  '));
  }
  return { s, changes };
}

(function main() {
  if (!fs.existsSync(SERVER)) { console.error('server file not found:', SERVER); process.exit(1); }
  const src = fs.readFileSync(SERVER, 'utf8');
  const { s, changes } = apply(src);

  console.log('patch plan for', SERVER);
  for (const c of changes) console.log('  ', c);

  if (!WRITE) {
    console.log('\nDRY — re-run with --write to apply.');
    console.log('After --write (coordinator):');
    console.log('  1) node --check ' + SERVER);
    console.log('  2) node ' + SERVER + ' --selftest        (must print "ALL PASSED")');
    console.log('  3) pm2 restart seas-server');
    console.log('  4) curl-verify the new routes (see report).');
    console.log('Note: the server AUTO-READS the live CHRONO ORB address from deploy/orb-deployed.json');
    console.log('      (or set SEAS_ORB_TOKEN in the seas-server env). No web-dir module require()s ethers.');
    return;
  }

  if (changes[0] && changes[0].startsWith('(already')) { console.log('\nserver already patched — left as-is'); return; }

  const bak = SERVER + '.pre-cooldowns.bak';
  fs.copyFileSync(SERVER, bak);
  fs.writeFileSync(SERVER, s);
  console.log('\npatched', SERVER, '(backup:', bak + ')');
  console.log('NEXT (coordinator): node --check → node seas-server.js --selftest → pm2 restart seas-server → curl-verify.');
})();
