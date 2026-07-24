#!/usr/bin/env node
/**
 * patch-eating-seas.cjs — SURGICAL live patch that adds SERVER-AUTHORITATIVE UNIVERSAL EATING to the
 * live VPS seas-server.js, WITHOUT replacing the whole file. (founder 2026-06-28: "we want all pawns
 * to need to eat" — and the referee, not localStorage, must enforce it.)
 *
 * Mirrors deploy/patch-cooldowns-seas.cjs's anchored approach. The live server ALREADY has the forge +
 * cooldowns + rollchart patches applied, so this anchors around the CURRENT live state (cooldowns +
 * rollchart present, eating absent). It REUSES game/lib/upkeep.js's pure core (eatBatch /
 * starvationPenaltyFrom) — ONE source of truth for the −1/day math + cheapest-first batched eating.
 *
 * Idempotent (safe to re-run = no-op if fully patched). DRY by default; --write applies the edits.
 * Aborts LOUDLY if any anchor is missing/drifted (no blind double-insert). Backs up to .pre-eating.bak.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * PREREQUISITE — upkeep.js MUST live next to the battle-grid modules the server already imports.
 *   The server's init() loads game/seas/battle-grid/units.js + game/lib/{bilge-rats,goblin-cave}.js.
 *   units.js (Part A) now `import`s ../../lib/upkeep.js, so on the live host BOTH must be present:
 *       <server dir>/../lib/upkeep.js                  (the pure core: eatBatch, starvationPenaltyFrom)
 *       <server dir>/../seas/battle-grid/units.js      (Part A: applies the debuff in buildUnit)
 *   scp the CURRENT game/lib/upkeep.js + game/seas/battle-grid/units.js to the live game tree FIRST.
 *   This patch only touches seas-server.js; it does NOT ship upkeep.js for you. node --check the server
 *   AFTER scp'ing upkeep.js (the dynamic import resolves at init(), but --selftest exercises it).
 *   NO new seas-SERVER module require()s ethers as a result of this patch (upkeep.js is pure ESM, no
 *   ethers) — the crash-lesson invariant from patch-cooldowns holds.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * WHAT IT TOUCHES on the live host (server file only — NOT the web seas/ dir):
 *   <server dir>/seas-server.js  ← 8 surgical edits:
 *     (1) state.rations schema comment + the additive loadState() migration (default + parse)
 *     (2) init() COMBAT bundle — dynamic-import upkeep.js + expose it on the COMBAT object
 *     (3) the SERVER-EATING helpers block (serverRations / serverAutoEat / serverStarvePenalty /
 *         starveTeam) inserted before the COMBAT SETTLEMENT banner
 *     (4) issueSeed — once-per-day batched cheapest-first serverAutoEat the pawn + pin rec.starve
 *     (5) verifyFight — clamp the player team by the pinned penalty BEFORE resolveEncounter; debit
 *         the day's ration on a conclusive verdict (alongside the startCooldown block)
 *     (6) verifyFight return body — additive `starve` field (penalty applied) for client transparency
 *     (7) module.exports — add the eating symbols
 *     (8) the LIVE --selftest combat block — INJECT a starved-vs-fed case proving the server's
 *         authoritative verdict is WEAKER for a starved pawn on the SAME seed.
 *
 * BACKWARD-COMPAT: response changes are ADDITIVE only (new `starve` field on verify; issue-seed body
 *   unchanged). A pawn with NO ration record (never ate) has penalty 0 → ZERO behavior change → the
 *   existing client + selftest stay green. Eating only ever WEAKENS a pawn the server knows is hungry.
 *
 * USAGE (on the VPS, coordinator):
 *   node patch-eating-seas.cjs --server /var/www/tasern/server/seas-server.js          # DRY (prints plan)
 *   node patch-eating-seas.cjs --server /var/www/tasern/server/seas-server.js --write   # applies
 *
 * After patching: node --check, then node seas-server.js --selftest on the box (must print ALL PASSED),
 * then pm2 restart. NO SILENT CATCHES — any anchor it can't find aborts loudly (live file drifted).
 */
'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WRITE = args.includes('--write');
const SERVER = opt('--server');
if (!SERVER) { console.error('required: --server <path to live seas-server.js>'); process.exit(1); }

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (1) STATE SCHEMA + loadState() ADDITIVE MIGRATION — add the `rations` authority map, exactly the
//   same additive pattern the cooldowns/orbs migration uses. Anchored on the byte-exact cooldown-era
//   strings (present on the live cooldowns-patched file).
// ──────────────────────────────────────────────────────────────────────────────────────────────
const STATE_COMMENT_FROM =
`//   orbs      : { [lowercaseAddr]: wholeChronoOrbBalance }                       — server-attributed orb bal
// pawnKey = \`\${collection.toLowerCase()}:\${tokenId}\` (a pawn = collection + tokenId, see pawnKey()).`;
const STATE_COMMENT_TO =
`//   orbs      : { [lowercaseAddr]: wholeChronoOrbBalance }                       — server-attributed orb bal
//   rations   : { [pawnKey]: { fedUntil:ms, foodInv:{ [foodId]:qty } } }          — SERVER-authoritative eating
// pawnKey = \`\${collection.toLowerCase()}:\${tokenId}\` (a pawn = collection + tokenId, see pawnKey()).`;

const LOADSTATE_RET_FROM = `  if (!fs.existsSync(storeFile)) return { players: {}, cooldowns: {}, orbs: {} };`;
const LOADSTATE_RET_TO = `  if (!fs.existsSync(storeFile)) return { players: {}, cooldowns: {}, orbs: {}, rations: {} };`;

const LOADSTATE_MIG_FROM =
`    if (!parsed.cooldowns || typeof parsed.cooldowns !== 'object') parsed.cooldowns = {};
    if (!parsed.orbs || typeof parsed.orbs !== 'object') parsed.orbs = {};
    return parsed;`;
const LOADSTATE_MIG_TO =
`    if (!parsed.cooldowns || typeof parsed.cooldowns !== 'object') parsed.cooldowns = {};
    if (!parsed.orbs || typeof parsed.orbs !== 'object') parsed.orbs = {};
    // universal eating (founder 2026-06-28): the server-authoritative ration store. Additive, same as above.
    if (!parsed.rations || typeof parsed.rations !== 'object') parsed.rations = {};
    return parsed;`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (2) init() COMBAT bundle — dynamic-import upkeep.js alongside the bilge/goblin libs and expose it on
//   the COMBAT object so the eating helpers + verifyFight can use the SHARED pure core. Anchored on the
//   goblin import line + the COMBAT assignment (byte-exact in the cooldown-era file).
// ──────────────────────────────────────────────────────────────────────────────────────────────
const INIT_IMPORT_FROM =
`    const goblin = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'goblin-cave.js')).href);`;
const INIT_IMPORT_TO =
`    const goblin = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'goblin-cave.js')).href);
    const upkeep = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'upkeep.js')).href);`;

const INIT_ASSIGN_FROM =
`    COMBAT = { resolveEncounter: resolver.resolveEncounter, SPELLS: engine.SPELLS, bilge, goblin };`;
const INIT_ASSIGN_TO =
`    if (typeof upkeep.eatBatch !== 'function' || typeof upkeep.starvationPenaltyFrom !== 'function') {
      throw new Error('[seas] upkeep.js did not export the expected eating API (eatBatch / starvationPenaltyFrom) — scp the current game/lib/upkeep.js');
    }
    COMBAT = { resolveEncounter: resolver.resolveEncounter, SPELLS: engine.SPELLS, bilge, goblin, upkeep };`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (3) SERVER-EATING helpers — a self-contained block inserted BEFORE the COMBAT SETTLEMENT banner
//   (same stable anchor the cooldowns block used; the cooldown block is now ABOVE us, so we anchor on
//   the banner itself which the cooldowns patch left intact). Uses ONLY symbols present in the live
//   cooldown-era file (ensureState, saveState, _now, requireCombat) + the upkeep pure core on COMBAT.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const EATING_BLOCK = String.raw`// ════════════════════════════════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE UNIVERSAL EATING (founder 2026-06-28: "all pawns need to eat"). The SERVER
// (its clock + its ration store) is the gate: a pawn eats 1 food/day, town or wild; an UNFED pawn
// fights WEAKER (−1 to ALL stats per missed day, cumulative). localStorage may MIRROR this for the
// UI, but it is NEVER the gate — verify-fight re-derives the penalty here and CLAMPS the client's
// player team, so a fat-stat submission can't dodge hunger. The −1/day math + the once-per-day,
// batched, CHEAPEST-FIRST consumption are REUSED from game/lib/upkeep.js (eatBatch /
// starvationPenaltyFrom) — ONE source of truth shared with the client (no logic can drift).
//
// State shape: state.rations[pawnKey] = { fedUntil:ms, foodInv:{ [foodId]:qty } }. A pawn with NO
// record has penalty 0 (never-ate == not-yet-tracked), so this is a pure ADD: it can only weaken a
// pawn the server already knows is hungry — existing clients see zero change until food is tracked.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** The server ration authority map (state.rations). Seeded lazily; persisted via saveState(). */
function serverRations() {
  const s = ensureState();
  if (!s.rations || typeof s.rations !== 'object') s.rations = {};
  return s.rations;
}

/** A pawn's ration record { fedUntil, foodInv }, created (empty) on first touch. */
function rationRec(pawn) {
  const r = serverRations();
  if (!r[pawn]) r[pawn] = { fedUntil: 0, foodInv: {} };
  if (!r[pawn].foodInv || typeof r[pawn].foodInv !== 'object') r[pawn].foodInv = {};
  return r[pawn];
}

/** ADD food units to a pawn's server stores (the grant/restock path; relayer/keeper wires later). */
function grantFood(pawn, foodId, qty) {
  const rec = rationRec(pawn);
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  if (n <= 0) return rec.foodInv;
  rec.foodInv[String(foodId)] = (rec.foodInv[String(foodId)] || 0) + n;
  saveState();
  return rec.foodInv;
}

/**
 * ONCE-PER-DAY, BATCHED, CHEAPEST-FIRST catch-up for a pawn from ITS OWN server stores, using the
 * SHARED upkeep pure core (eatBatch). Advances fedUntil per food eaten; leftover days stay hungry.
 * Persists. Returns the upkeep eatBatch result ({ fedUntil, ate, foods, hungryDays }).
 */
function serverAutoEat(pawn, now) {
  const { upkeep } = requireCombat();
  const rec = rationRec(pawn);
  const res = upkeep.eatBatch(rec, rec.foodInv, now != null ? now : _now()); // MUTATES rec.foodInv
  rec.fedUntil = res.fedUntil;
  saveState();
  return res;
}

/** The all-stats starvation penalty (≤ 0) for a pawn, from the SERVER's authoritative fedUntil. */
function serverStarvePenalty(pawn, now) {
  const { upkeep } = requireCombat();
  const rec = serverRations()[pawn];
  return upkeep.starvationPenaltyFrom(rec ? rec.fedUntil : 0, now != null ? now : _now());
}

/** Eat ONE day's ration from a pawn's stores on a CONCLUSIVE fight (the "fighting burns the day" sink).
 *  Cheapest-first (eatBatch picks it). No-op (no throw) if the pawn has no food — it just stays hungry. */
function debitFightRation(pawn, now) {
  const { upkeep } = requireCombat();
  const rec = rationRec(pawn);
  const food = upkeep.cheapestFood(rec.foodInv);
  if (!food) return null;                          // no stores → nothing to debit (pawn keeps starving)
  rec.foodInv[food] -= 1; if (rec.foodInv[food] <= 0) delete rec.foodInv[food];
  saveState();
  return food;
}

/** Clamp a submitted player TEAM by an all-stats starvation penalty (≤ 0): lower every combat stat +
 *  HP by |pen|, floored at 1 — the server's authoritative override of any client-sent player stats.
 *  Mirrors upkeep.applyStarvation's clamp, applied to the DERIVED combat fields the engine reads.
 *  Pure: returns a NEW team (deep-ish clone of stats); pen 0 → the team passes through unchanged. */
function starveTeam(team, pen) {
  if (!Array.isArray(team) || !(pen < 0)) return team;          // pen 0/≥0 → no-op (byte-identical)
  const lo = (v) => Math.max(1, (Number(v) || 0) + pen);        // STARVE_STAT_FLOOR = 1
  return team.map((u) => {
    if (!u || typeof u !== 'object') return u;
    const stats = u.stats && typeof u.stats === 'object' ? { ...u.stats } : u.stats;
    if (stats) for (const k of ['attack', 'atkBonus', 'ac', 'def', 'mDef', 'mAtk']) {
      if (typeof stats[k] === 'number') stats[k] = lo(stats[k]);
    }
    const out = { ...u, stats };
    if (typeof u.maxHp === 'number') out.maxHp = lo(u.maxHp);
    if (typeof u.currentHp === 'number') out.currentHp = Math.min(out.maxHp != null ? out.maxHp : u.currentHp, lo(u.currentHp));
    return out;
  });
}

`;
// the COMBAT SETTLEMENT banner — the block is inserted directly before this (stable in every build).
const EATING_ANCHOR =
`// ════════════════════════════════════════════════════════════════════════════════════════════
// COMBAT SETTLEMENT — issue-seed (anti-grind anchor) + verify-fight (server-replay referee).`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (4) issueSeed — once-per-day batched cheapest-first serverAutoEat the pawn + pin rec.starve. We
//   anchor on the byte-exact cooldown-era _fights.set line (it carries `pawn`) and INSERT the eat +
//   penalty-pin right before it, then add `starve` to the set payload via a second short edit.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const ISSUE_SET_FROM =
`  _fights.set(nonce, { player: addrKey(player), fight, seed, used: false, issuedAt: now, pawn });
  return { status: 200, body: { ok: true, seed, nonce, fight, pawn } };`;
const ISSUE_SET_TO =
`  // UNIVERSAL EATING: catch the pawn up from its server stores (once-per-day, batched, cheapest-first)
  // and PIN the resulting starvation penalty to THIS fight, so the hunger state can't change between
  // issue and submit. A pawn with no ration record / no food → penalty 0 (pure add). Only pawn-bearing
  // fights (cooldown kinds carry a pawn) are tracked; a pawn-less fight pins starve 0.
  let starve = 0;
  if (pawn) { serverAutoEat(pawn, now); starve = serverStarvePenalty(pawn, now); }
  _fights.set(nonce, { player: addrKey(player), fight, seed, used: false, issuedAt: now, pawn, starve });
  return { status: 200, body: { ok: true, seed, nonce, fight, pawn } };`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (5) verifyFight — TWO short byte-exact edits:
//   (5a) CLAMP the player team by the pinned penalty BEFORE resolveEncounter (stop trusting client
//        player stats for the player). Anchored on the byte-exact enemyTeam-build + resolveEncounter.
//   (5b) DEBIT the day's ration on a conclusive verdict — inserted right after the cooldown-start
//        block (anchored on its byte-exact closing lines).
// ──────────────────────────────────────────────────────────────────────────────────────────────
const VERIFY_CLAMP_FROM =
`  const playerHexes = playerTeam.map((u) => u && u.position).filter(Boolean);
  const enemyTeam = mod[kind.buildEnemies](seed, playerHexes);
  const result = resolveEncounter({
    seed, playerTeam, enemyTeam, playerActions,`;
const VERIFY_CLAMP_TO =
`  const playerHexes = playerTeam.map((u) => u && u.position).filter(Boolean);
  const enemyTeam = mod[kind.buildEnemies](seed, playerHexes);
  // UNIVERSAL EATING: the server is the referee — CLAMP the client-submitted player team by the
  // pinned starvation penalty (rec.starve, set at issue from the SERVER's ration store) so a starving
  // pawn genuinely fights weaker here and a fat-stat client submission is overridden. pen 0 = no-op.
  const starvedTeam = starveTeam(playerTeam, Number(rec.starve) || 0);
  const result = resolveEncounter({
    seed, playerTeam: starvedTeam, enemyTeam, playerActions,`;

const VERIFY_DEBIT_FROM =
`  if (kind.cooldownSecs && rec.pawn && !result.finalState.exhausted) {
    cooldownStarted = startCooldown(rec.pawn, rec.fight, kind.cooldownSecs);
  }`;
const VERIFY_DEBIT_TO =
`  if (kind.cooldownSecs && rec.pawn && !result.finalState.exhausted) {
    cooldownStarted = startCooldown(rec.pawn, rec.fight, kind.cooldownSecs);
  }
  // UNIVERSAL EATING SINK: a conclusive fight burns ONE day's ration from the pawn's server stores
  // (cheapest-first). Entering + concluding a fight consumes the day's food, the same "run consumes
  // it" rule as the cooldown. No food → no-op (the pawn just stays hungry → debuff next time).
  if (rec.pawn && !result.finalState.exhausted) debitFightRation(rec.pawn);`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (6) verifyFight return body — additive `starve` field (the penalty the referee applied) for client
//   transparency. Anchored on the byte-exact pawn-field line the cooldowns patch added.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const VERIFY_BODY_FROM = `      ok: true, nonce, fight: rec.fight, seed, pawn: rec.pawn || null,`;
const VERIFY_BODY_TO = `      ok: true, nonce, fight: rec.fight, seed, pawn: rec.pawn || null,
      // UNIVERSAL EATING: the all-stats penalty (≤ 0) the server APPLIED to the player team this fight
      // (0 = fully fed / untracked). Additive + display-only; the verdict already reflects the clamp.
      starve: Number(rec.starve) || 0,`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (7) module.exports — add the eating symbols. RECONCILED to the LIVE snapshot: the deployed exports
//   are `// combat settlement\n  issueSeed, verifyFight,` (NO rollResult on the export line — the live
//   build differs from canonical here). We anchor on that exact 2-line live block and INSERT the eating
//   export lines BEFORE the `// combat settlement` comment (short, byte-exact, unique substring).
// ──────────────────────────────────────────────────────────────────────────────────────────────
const EXPORTS_FROM =
`  // combat settlement
  issueSeed, verifyFight,`;
const EXPORTS_TO =
`  // server-authoritative universal eating (shared upkeep core)
  serverRations, rationRec, grantFood, serverAutoEat, serverStarvePenalty, debitFightRation, starveTeam,
  // combat settlement
  issueSeed, verifyFight,`;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// (8) LIVE SELFTEST — INJECT a starved-vs-fed case proving the server's authoritative verdict is
//   WEAKER for a starved pawn on the SAME seed. Anchored on the byte-exact goblin-cave verify
//   assertion (the LAST combat-settlement assertion the rollchart/cooldowns era left); we APPEND the
//   eating coverage right after it. DEP-FREE: reuses already-imported bgUnits/bilge/ci/eng/gc/res +
//   the patched server's own eating helpers + requireCombat().upkeep.
// ──────────────────────────────────────────────────────────────────────────────────────────────
const ST_TAIL_FROM =
`    const gVerify = verifyFight({ player, nonce: gIss.nonce, playerTeam: [{ ...leader }], playerActions: [{ unit: 'LEADER', type: 'end' }] });
    assert(gVerify.status === 200 && gVerify.body.fight === 'goblin-cave' && gVerify.body.enemies === gEnemies.length,
      ` + "`verify-fight resolves the goblin-cave kind (rebuilt ${gVerify.body.enemies} goblins)`" + `);`;
const ST_TAIL_TO = String.raw`    const gVerify = verifyFight({ player, nonce: gIss.nonce, playerTeam: [{ ...leader }], playerActions: [{ unit: 'LEADER', type: 'end' }] });
    assert(gVerify.status === 200 && gVerify.body.fight === 'goblin-cave' && gVerify.body.enemies === gEnemies.length,
      ` + "`verify-fight resolves the goblin-cave kind (rebuilt ${gVerify.body.enemies} goblins)`" + `);

    // ── SERVER-AUTHORITATIVE UNIVERSAL EATING ─────────────────────────────────────────────────
    // Prove (a) the shared upkeep core is wired, (b) an UNFED pawn's authoritative verdict is WEAKER
    // than a FED pawn's on the SAME seed (the referee clamps the client team), (c) eating restores it.
    console.log('\\n[selftest] server-authoritative universal eating:');
    const { upkeep } = requireCombat();
    assert(typeof upkeep.eatBatch === 'function' && typeof upkeep.starvationPenaltyFrom === 'function',
      'upkeep.js pure core is wired into the COMBAT bundle (eatBatch / starvationPenaltyFrom)');

    // a STR-build leader so the −1/day debuff visibly moves the fight. Cooldown-gated kind carries a pawn.
    const ECOLL = '0x9500880DEC9B310b4a728C75A271a25615A2443E';
    const eatPawn = { collection: ECOLL, tokenId: '42' };
    const eatKey = pawnKey(eatPawn.collection, eatPawn.tokenId);
    const eatLeader = () => bgUnits.buildUnit({ id: 'LEADER', isPlayer: true, name: 'Captain', emoji: '🦜', endowment: { burgers: 40, egp: 20 }, role: 'melee', position: { q: 1, r: 4 } });

    // (i) penalty math from the SERVER store: stock food, advance time, confirm batched cheapest-first eat.
    grantFood(eatKey, 'rations', 1); grantFood(eatKey, 'wine', 3);  // 1 staple + 3 gourmet in ship stores
    let baseNow = _now();
    serverAutoEat(eatKey, baseNow);                                  // first touch: fedUntil 0 → eats to catch up
    assert(serverStarvePenalty(eatKey, baseNow) === 0, 'after eating, a stocked pawn is fed → penalty 0');

    // (ii) starve it 3 days with the staple gone (only gourmet left, eaten last): drain to force hunger.
    //      Burn the stores so the next catch-up can't fully cover → a real penalty accrues.
    serverRations()[eatKey].foodInv = {};                           // empty the stores (consumed/none left)
    serverRations()[eatKey].fedUntil = baseNow - 3 * upkeep.DAY_MS;  // 3 days behind, nothing to eat
    saveState();
    const starveNow = baseNow;
    serverAutoEat(eatKey, starveNow);                               // nothing to eat → stays 3 days hungry
    const pen = serverStarvePenalty(eatKey, starveNow);
    assert(pen === -3, ` + "`an unfed-3-days pawn carries a −3 all-stats penalty (got ${pen})`" + `);

    // (iii) AUTHORITATIVE verdict comparison on the SAME pinned seed: fed leader vs starved leader.
    //       Build a fed reference team + the starved clamp; the clamped team must have LOWER stats.
    const fedTeam = [eatLeader()];
    const clamped = starveTeam([eatLeader()], pen);
    assert(clamped[0].stats.attack === Math.max(1, fedTeam[0].stats.attack - 3), 'starveTeam lowers attack by |pen| (server clamp)');
    assert(clamped[0].stats.atkBonus < fedTeam[0].stats.atkBonus && clamped[0].stats.ac < fedTeam[0].stats.ac, 'starved team: to-hit + AC drop');
    assert(clamped[0].maxHp === Math.max(1, fedTeam[0].maxHp - 3), 'starved team: HP drops by |pen|');
    assert(starveTeam(fedTeam, 0) === fedTeam, 'pen 0 → starveTeam is a byte-identical no-op (backward-compat)');

    // (iv) end-to-end through verify-fight: issue pins the penalty, verify CLAMPS the client team. A
    //      pawn with stocked food → starve 0 in the response (fed); a hungry pawn → starve < 0.
    grantFood(eatKey, 'rations', 5); serverRations()[eatKey].fedUntil = _now() + upkeep.DAY_MS; saveState(); // fed
    clearCooldown(eatKey, 'goblin-cave');
    const fedIss = issueSeed(player, 'goblin-cave', eatPawn);
    assert(fedIss.status === 200, 'fed pawn can enter');
    const fedV = verifyFight({ player, nonce: fedIss.body.nonce, playerTeam: [eatLeader()], playerActions: [{ unit: 'LEADER', type: 'end' }] });
    assert(fedV.status === 200 && (Number(fedV.body.starve) || 0) === 0, 'a FED pawn verify carries starve 0 (additive field, no debuff)');

    clearCooldown(eatKey, 'goblin-cave');
    serverRations()[eatKey].foodInv = {}; serverRations()[eatKey].fedUntil = _now() - 2 * upkeep.DAY_MS; saveState(); // 2 days hungry, no food
    const hungryIss = issueSeed(player, 'goblin-cave', eatPawn);
    assert(hungryIss.status === 200, 'hungry pawn can still enter (universal eating weakens, never blocks)');
    const hungryV = verifyFight({ player, nonce: hungryIss.body.nonce, playerTeam: [eatLeader()], playerActions: [{ unit: 'LEADER', type: 'end' }] });
    assert(hungryV.status === 200 && hungryV.body.starve === -2, 'a 2-days-hungry pawn verify carries starve −2 (server-authoritative)');
    clearCooldown(eatKey, 'goblin-cave');`;

// ── ordered edit plan ──────────────────────────────────────────────────────────────────────────
const EDITS = [
  { name: '(1a) state schema comment (rations)',     kind: 'replace', from: STATE_COMMENT_FROM, to: STATE_COMMENT_TO },
  { name: '(1b) loadState default return',           kind: 'replace', from: LOADSTATE_RET_FROM,  to: LOADSTATE_RET_TO },
  { name: '(1c) loadState additive migration',       kind: 'replace', from: LOADSTATE_MIG_FROM,  to: LOADSTATE_MIG_TO },
  { name: '(2a) init() upkeep import',               kind: 'replace', from: INIT_IMPORT_FROM,    to: INIT_IMPORT_TO },
  { name: '(2b) init() COMBAT bundle (upkeep)',      kind: 'replace', from: INIT_ASSIGN_FROM,    to: INIT_ASSIGN_TO },
  { name: '(3)  server-eating helpers block',        kind: 'insertBefore', anchor: EATING_ANCHOR, text: EATING_BLOCK },
  { name: '(4)  issueSeed serverAutoEat + pin starve', kind: 'replace', from: ISSUE_SET_FROM,    to: ISSUE_SET_TO },
  { name: '(5a) verifyFight clamp player team',      kind: 'replace', from: VERIFY_CLAMP_FROM,   to: VERIFY_CLAMP_TO },
  { name: '(5b) verifyFight ration debit',           kind: 'replace', from: VERIFY_DEBIT_FROM,   to: VERIFY_DEBIT_TO },
  { name: '(6)  verifyFight body starve field',      kind: 'replace', from: VERIFY_BODY_FROM,    to: VERIFY_BODY_TO },
  { name: '(7)  module.exports additions',           kind: 'replace', from: EXPORTS_FROM,        to: EXPORTS_TO },
  { name: '(8)  selftest starved-vs-fed coverage',   kind: 'replace', from: ST_TAIL_FROM,        to: ST_TAIL_TO },
];

// idempotency markers — if ALL present, the file is fully patched (no-op). One per step-group.
const MARKERS = [
  'rations   : { [pawnKey]:',                 // step 1a
  "if (!parsed.rations || typeof parsed.rations", // step 1c
  "const upkeep = await import",              // step 2a
  'function serverAutoEat(',                  // step 3
  'function starveTeam(',                     // step 3
  'if (pawn) { serverAutoEat(pawn, now);',    // step 4
  'const starvedTeam = starveTeam(playerTeam', // step 5a
  'if (rec.pawn && !result.finalState.exhausted) debitFightRation', // step 5b
  'starve: Number(rec.starve) || 0,',         // step 6
  '[selftest] server-authoritative universal eating:', // step 8
];

function fullyPatched(s) { return MARKERS.every((m) => s.includes(m)); }
function partiallyPatched(s) { return MARKERS.some((m) => s.includes(m)) && !fullyPatched(s); }

function apply(src) {
  let s = src;
  const changes = [];

  if (fullyPatched(s)) return { s, changes: ['(already fully patched — no changes)'] };
  if (partiallyPatched(s)) {
    const present = MARKERS.filter((m) => s.includes(m));
    throw new Error('PARTIAL eating patch detected — these markers are present but not all:\n  ' +
      present.join('\n  ') + '\nThe live file is in a mixed state; fix by hand, do NOT auto-patch (would duplicate symbols).');
  }

  for (const e of EDITS) {
    if (e.kind === 'replace') {
      if (!s.includes(e.from)) {
        throw new Error('ANCHOR NOT FOUND for ' + e.name + ' — the live file drifted from the expected (cooldowns/rollchart-era) text.\n' +
          'Patch by hand. Expected to find:\n--- BEGIN ANCHOR ---\n' + e.from + '\n--- END ANCHOR ---');
      }
      if (s.indexOf(e.from) !== s.lastIndexOf(e.from)) {
        throw new Error('AMBIGUOUS anchor for ' + e.name + ' — appears more than once; refusing to guess. Patch by hand.');
      }
      s = s.replace(e.from, e.to);
      changes.push('~ ' + e.name);
    } else if (e.kind === 'insertBefore') {
      if (!s.includes(e.anchor)) throw new Error('ANCHOR NOT FOUND for ' + e.name + ' (before COMBAT SETTLEMENT banner) — live file drifted, patch by hand');
      if (s.indexOf(e.anchor) !== s.lastIndexOf(e.anchor)) throw new Error('AMBIGUOUS anchor for ' + e.name + ' — patch by hand');
      s = s.replace(e.anchor, e.text + e.anchor);
      changes.push('+ ' + e.name);
    }
  }

  // post-condition: every marker must now be present (proves all step-groups landed, incl. the
  // live-selftest case — without it the patched server's --selftest would not exercise eating).
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
    console.log('PREREQUISITE: scp the CURRENT game/lib/upkeep.js + game/seas/battle-grid/units.js to the live game tree FIRST');
    console.log('              (upkeep.js is the shared pure core; units.js applies the buildUnit debuff).');
    console.log('After --write (coordinator):');
    console.log('  1) node --check ' + SERVER);
    console.log('  2) node ' + SERVER + ' --selftest        (must print "ALL PASSED")');
    console.log('  3) pm2 restart seas-server');
    console.log('  4) curl-verify: a hungry pawn verify carries starve < 0 (see report).');
    return;
  }

  if (changes[0] && changes[0].startsWith('(already')) { console.log('\nserver already patched — left as-is'); return; }

  const bak = SERVER + '.pre-eating.bak';
  fs.copyFileSync(SERVER, bak);
  fs.writeFileSync(SERVER, s);
  console.log('\npatched', SERVER, '(backup:', bak + ')');
  console.log('NEXT (coordinator): node --check → node seas-server.js --selftest → pm2 restart seas-server → curl-verify.');
})();
