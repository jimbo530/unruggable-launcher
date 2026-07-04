#!/usr/bin/env node
'use strict';
/**
 * fight.js — the bot's INCOME ENGINE: the real, hardened, server-refereed bilge-rats combat+claim loop.
 *
 * Combat is server-refereed (project_seas_combat_settlement): the seas-server pins a fight's RNG seed
 * (anti-grind) via /seas/issue-seed; the bot PLAYS the deterministic battle-grid engine headlessly
 * (citizen/lib/play.js — the game's own squad AI, off the pinned seed); /seas/verify-fight then REPLAYS
 * the engine from only { seed, playerActions }, re-computes the rats itself, and returns the
 * AUTHORITATIVE winner. The bot cannot self-declare a win, cannot grind the seed, cannot weaken the foes.
 *
 * SKILL-BASED, REAL-OR-NOTHING (charter): we PLAY the pinned fight locally first; we only submit to the
 * referee when we genuinely WIN it (the charter's "only fight when you're clearly favored"). A predicted
 * loss is DECLINED and reported honestly — we never fake a win, and we report losses straight.
 *
 * COMMANDS
 *   node citizen/tools/fight.js play   [--fight bilge-rats] [--pawn <distributor:tokenId>] [--endowment '<json>'] [--force] [--no-submit]
 *   node citizen/tools/fight.js issue  '<fightJson>'    # just pin a seed (inspect the gate)
 *
 *   --pawn       bind the win to a real pawn NFT (collection,tokenId) for the loot claim. Without it the
 *                claim is described but not pawn-targeted (the keeper resolves ownerOf).
 *   --endowment  representative pawn stats (class-engine input). Default = strong demo leader {"burgers":40}.
 *                HONEST GAP: decoding a real pawn's on-chain endowment by crewId is the pawns.js TODO.
 *   --force      submit to the referee even on a predicted loss (to record the honest server verdict).
 *   --no-submit  play + locally verify only; never touch the network (pure offline proof).
 *
 * THE CLAIM (founder-gated, flagged not faked): a SERVER-VERIFIED win is payout-eligible — the bilge
 * LootPool (0xE07CE9Ec…, COPPER @ 1%) pays floor(bal×bps) to the pawn's owner via payout(collection,
 * tokenId), admin = agent treasury 0xE2a4. That firePayout is HARD-GATED on the founder
 * (SEAS_BILGE_FIRE=YES) inside mftusd-build/bilge-payout-keeper.cjs. This tool NEVER sends a tx — on a
 * win it prints EXACTLY what would be claimed and routes it to that DRY keeper. CITIZEN_ALLOW_LIVE has
 * no effect here (no swap), and is irrelevant to the founder-gated loot.
 */
const chain = require('../lib/chain.js');
const seas = require('../lib/seas-api.js');
const play = require('../lib/play.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] || true) : null; }
function has(name) { return process.argv.includes(name); }

// The deployed bilge LootPool (matches bilge-rats.js + mftusd-build/bilge-lootpool-deployed.json).
const LOOT_POOL = '0xE07CE9Ec642d42C5c8A0068203068BAc6042bF57';
const LOOT_ADMIN = '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10'; // agent treasury (pool admin)

/** Build the would-claim record for a server-verified win (DESCRIBES the claim; sends nothing). */
function buildClaim(pawnCrewId, verify) {
  let collection = null, tokenId = null;
  if (pawnCrewId && pawnCrewId.includes(':')) {
    const [c, t] = String(pawnCrewId).split(':');
    if (/^0x[0-9a-fA-F]{40}$/.test(c)) { collection = c; tokenId = t; }
  }
  return {
    lootPool: LOOT_POOL,
    admin: LOOT_ADMIN,
    payoutCall: collection ? `payout(${collection}, ${tokenId})` : 'payout(<pawn collection>, <tokenId>)',
    collection, tokenId,
    pawnBound: !!collection,
    drops: 'floor(balance × dropBps/1e4) of EACH stocked token (COPPER @ 1% now) → ownerOf(tokenId)',
    perPawnCooldownSecs: 3600,
    claimableNow: false,
    gate: 'FOUNDER-GATED — firePayout() in mftusd-build/bilge-payout-keeper.cjs is hard-off until SEAS_BILGE_FIRE=YES',
    keeper: 'mftusd-build/bilge-payout-keeper.cjs (DRY: preview only; never sends a tx)',
    achievementNote: 'no bot-callable achievement claim wired for bilge yet — the LootPool IS the bilge reward; Guard cbBTC ladder is a separate gated path',
    note: !collection
      ? 'pass --pawn <distributor:tokenId> to target a real pawn NFT; without it the keeper would resolve ownerOf.'
      : 'verified win recorded; the founder-gated keeper would settle this on the founder\'s go.',
    provenance: { seed: verify && verify.seed, nonce: verify && verify.nonce },
  };
}

async function cmdPlay() {
  const player = chain.walletAddress();
  if (!player) throw new Error('no player wallet — run init-wallet.js (or set CITIZEN_WALLET_ENV / CITIZEN_KEY_NAME for a bot profile)');

  const fight = flag('--fight') || 'bilge-rats';
  if (fight !== 'bilge-rats') throw new Error(`only "bilge-rats" is wired right now (got "${fight}")`);
  const pawn = flag('--pawn');                 // distributor:tokenId
  const noSubmit = has('--no-submit');
  const force = has('--force');
  let endowment;
  const endArg = flag('--endowment');
  if (endArg && endArg !== true) { try { endowment = JSON.parse(endArg); } catch { throw new Error('--endowment must be JSON, e.g. \'{"burgers":40}\''); } }

  const steps = [];

  // 1) ISSUE-SEED — the server pins the RNG (we cannot pre-roll / re-roll it).
  const iss = await seas.issueSeed(player, fight);
  if (iss.ok === false || !iss.seed || !iss.nonce) {
    out({ ok: false, tool: 'fight', step: 'issue-seed', player, serverBase: seas.BASE, result: iss,
          note: iss.transport === 'unreachable'
            ? 'seas-server unreachable — set SEAS_API_BASE (prod: https://tasern.quest/seas-api). NOT faking a fight.'
            : 'issue-seed did not return a seed/nonce.' });
    process.exit(1);
  }
  steps.push({ step: 'issue-seed', seed: iss.seed, nonce: iss.nonce, fight: iss.fight });

  // 2) BUILD the encounter from the pinned seed (player pawn + rats reconstructed from the seed).
  const built = await play.buildBilgeFight({ seed: iss.seed, endowment });
  steps.push({ step: 'build', enemies: built.enemyTeam.length, playerPawn: { name: built.playerTeam[0].name, hp: built.playerTeam[0].maxHp, ac: built.playerTeam[0].stats.ac, attack: built.playerTeam[0].stats.attack }, demoEndowment: endowment || { burgers: 40 } });

  // 3) PLAY it headlessly (the game's own squad AI, off the pinned seed) → record the player's actions.
  const played = await play.playFight({ seed: iss.seed, playerTeam: built.playerTeam, enemyTeam: built.enemyTeam, terrain: built.terrain });
  const survivors = play.survivors(played.units);
  steps.push({ step: 'play', predictedWinner: played.winner, rounds: played.rounds, playerActions: played.playerActions.length, survivors });

  // 4) OFFLINE cross-check via the REAL replay fn (resolveEncounter) — same code /seas/verify-fight runs.
  const localVerify = await play.verifyLocal({ seed: iss.seed, playerTeam: built.playerTeam, enemyTeam: built.enemyTeam, playerActions: played.playerActions, terrain: built.terrain });
  steps.push({ step: 'verify-local', winner: localVerify.winner, exhausted: localVerify.exhausted, note: 'resolveEncounter replay (offline) — must match the server verdict' });

  // FAVORABILITY GATE (charter): only carry a fight to the referee when we genuinely won it.
  const favored = played.winner === 'player' && localVerify.winner === 'player';
  if (!favored && !force) {
    out({ ok: true, tool: 'fight', player, serverBase: seas.BASE, fight, decision: 'DECLINE',
          reason: `not favored — local play resolves "${played.winner}" (offline replay "${localVerify.winner}"). Charter: only fight when clearly favored; walk a fight we can\'t win.`,
          steps, submitted: false, won: false });
    return;
  }
  if (noSubmit) {
    out({ ok: true, tool: 'fight', player, serverBase: seas.BASE, fight, decision: favored ? 'WIN (offline only)' : 'LOSS (offline only)',
          steps, submitted: false, won: favored,
          wouldClaim: favored ? buildClaim(pawn, { seed: iss.seed, nonce: iss.nonce }) : null,
          note: '--no-submit: proved end-to-end OFFLINE (issue-seed → play → resolveEncounter replay). Drop --no-submit to get the authoritative server verdict.' });
    return;
  }

  // 5) SUBMIT to the referee — the AUTHORITATIVE verdict (server recomputes the rats + the dice).
  const v = await seas.verifyFight({ player, nonce: iss.nonce, playerTeam: built.playerTeam, playerActions: played.playerActions });
  steps.push({ step: 'verify-fight', httpStatus: v.httpStatus, serverWinner: v.winner, payoutEligible: v.payoutEligible, exhausted: v.exhausted, reason: v.reason });

  const won = v.ok && v.winner === 'player' && v.payoutEligible === true;
  out({
    ok: v.ok !== false, tool: 'fight', player, serverBase: seas.BASE, fight,
    decision: won ? 'WIN (server-verified)' : (v.winner ? `LOSS/${v.winner}` : 'inconclusive'),
    submitted: true, won,
    serverVerdict: { winner: v.winner, payoutEligible: v.payoutEligible, exhausted: v.exhausted, seed: v.seed, nonce: iss.nonce },
    wouldClaim: won ? buildClaim(pawn, { seed: iss.seed, nonce: iss.nonce }) : null,
    steps,
    note: won
      ? 'Server-verified win. The loot claim is DESCRIBED above and routed to the founder-gated DRY keeper — NO transaction sent (real-or-nothing).'
      : 'No win recorded. Reported honestly — nothing claimed.',
  });
}

async function cmdIssue(fightArg) {
  const player = chain.walletAddress();
  if (!player) throw new Error('no player — run init-wallet.js');
  let fight;
  try { fight = fightArg ? JSON.parse(fightArg) : 'bilge-rats'; }
  catch { fight = fightArg; }   // allow a bare string like bilge-rats
  const res = await seas.issueSeed(player, typeof fight === 'string' ? fight : 'bilge-rats');
  out({ ok: res.ok !== false, tool: 'fight', step: 'issue-seed', player, serverBase: seas.BASE, result: res,
        next: 'run `fight.js play` to issue → play → verify → (would-)claim end to end' });
}

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'issue') return cmdIssue(process.argv[3]);
  if (cmd === 'play' || cmd === 'dry' || cmd === undefined) return cmdPlay();
  throw new Error(`unknown command "${cmd}" — use: play | issue`);
})().catch((e) => { out({ ok: false, tool: 'fight', error: e.message }); process.exit(1); });
