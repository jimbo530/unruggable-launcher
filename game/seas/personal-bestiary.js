// @ts-check
'use strict';
/**
 * personal-bestiary.js — the PER-PAWN KILL-TRACKER + PERSONAL BESTIARY for "Seize the Seas".
 * Founder (2026-07-01): "a per player/pawn bestiary, and achievements for killing a certain number
 * of each monster … if they have the achievement they have the monster's strengths and weaknesses
 * in the bestiary to read." + Coordinator add-on: an UNLOCK EVENT (for the chime) on every new tier.
 *
 * WHAT THIS IS
 *   A PURE, TESTABLE module (no ethers, no I/O, no RNG) that owns the bookkeeping:
 *     • kill counts per (pawn, monster)   — the grind that earns the ladder
 *     • which titles a pawn has EARNED     — one entry per crossed kill/meta tier
 *     • which monsters a pawn has SEEN     — so the bestiary can list "encountered but not mastered"
 *     • the TOTAL earned count per pawn     — drives the GEM meta ladder
 *   It is DELIBERATELY server-authoritative: the LIVE seas-server counts kills from its OWN
 *   verify-fight replay (the same un-trickable path as the eating/cooldown enforcement) and calls
 *   recordKill(). The client is never trusted to report a kill. See the WIRING PLAN at the bottom.
 *
 *   The STORE is INJECTABLE. In a test you pass a plain object; in the server you pass the persistent
 *   state.bestiary map (added alongside state.cooldowns/state.orbs). The module never reads/writes
 *   disk itself — the caller persists (exactly like the cooldown spine).
 *
 * STATE SHAPE (per store)
 *   store = {
 *     pawns: {
 *       [pawnKey]: {
 *         kills:  { [monsterId]: number },   // running kill count
 *         earned: { [achId]:   { title, tier, monsterId?, count, at } },  // crossed tiers (kill + meta)
 *         seen:   { [monsterId]: { first, last, count } },                // encounter log
 *       }
 *     }
 *   }
 *   A `pawnKey` is a stable per-pawn string (collection+tokenId) — the FIGHTING UNIT earns its own
 *   knowledge (recommended per the founder). An optional player-level rollup is provided for the UI.
 *
 * EXPORTS
 *   makeStore()                                → a fresh empty store (for tests / bootstrap)
 *   recordKill(store, pawnKey, monsterId, n=1) → { newlyEarned:[unlockEvent…], killCount, totalEarned }
 *   markSeen(store, pawnKey, monsterId, n=1)   → record an encounter without a kill (optional)
 *   knownLore(store, pawnKey, monsterId)       → strengths/weaknesses IF earned, else a locked stub
 *   bestiaryFor(store, pawnKey)                → the pawn's full bestiary view
 *   totalEarned(store, pawnKey)                → count of achievements the pawn has earned
 *   UNLOCK_EVENT_KIND                          → 'achievement_unlocked' (the event.kind constant)
 *
 * node --check clean. ESM. Imports the ladder + lore modules only.
 */

import {
  getKillTiers, getMetaTiers, monsterMeta, TIERS,
} from './monster-achievements.js';
import { loreFor } from './bestiary-lore.js';

export const UNLOCK_EVENT_KIND = 'achievement_unlocked';

// ── store plumbing (injectable; the module never touches disk) ─────────────────────────────────
export function makeStore() { return { pawns: {} }; }

function ensurePawn(store, pawnKey) {
  if (!store || typeof store !== 'object') throw new Error('personal-bestiary: store required (inject state.bestiary)');
  if (!pawnKey || typeof pawnKey !== 'string') throw new Error('personal-bestiary: pawnKey (string) required');
  if (!store.pawns || typeof store.pawns !== 'object') store.pawns = {};
  let p = store.pawns[pawnKey];
  if (!p) { p = { kills: {}, earned: {}, seen: {} }; store.pawns[pawnKey] = p; }
  // forward-compat: an older record might miss a sub-map
  if (!p.kills) p.kills = {};
  if (!p.earned) p.earned = {};
  if (!p.seen) p.seen = {};
  return p;
}

/** How many achievements this pawn has earned (kill rungs + meta rungs). Drives the GEM meta ladder. */
export function totalEarned(store, pawnKey) {
  const p = store && store.pawns && store.pawns[pawnKey];
  return p ? Object.keys(p.earned).length : 0;
}

/** Build the standard UNLOCK EVENT the UI/chime reacts to. tier ∈ bronze|silver|gold|gem. */
function unlockEvent(rung, monsterId, killCount) {
  return {
    kind: UNLOCK_EVENT_KIND,
    title: rung.title,
    tier: rung.tier,                              // 'bronze' | 'silver' | 'gold' | 'gem'
    monsterId: monsterId || null,                 // null for a meta (collect-N) unlock
    achId: rung.achId,
    prize: {
      coin: rung.coin || rung.gem || null,        // COPPER/SILVER/GOLD or a GEM symbol
      prizeToken: rung.prizeToken || null,        // verified Base token address (null only if TBD)
    },
    // context for the toast + the keeper (the payout is fired by the founder-gated keeper, see wiring)
    killCount: typeof killCount === 'number' ? killCount : undefined,
  };
}

/** Record an ENCOUNTER (seen) without a kill — optional; recordKill also marks seen. */
export function markSeen(store, pawnKey, monsterId, n = 1) {
  if (!monsterId) throw new Error('personal-bestiary: monsterId required');
  const p = ensurePawn(store, pawnKey);
  const now = Date.now();
  const s = p.seen[monsterId] || (p.seen[monsterId] = { first: now, last: now, count: 0 });
  s.last = now;
  s.count += Math.max(0, Math.floor(Number(n) || 0));
  return s;
}

/**
 * Record N kills of a monster by a pawn, cross any newly-earned tiers, and (if any kill tier crossed)
 * re-check the GEM meta ladder. Returns the list of UNLOCK EVENTS the caller fires (coin/gem prize +
 * chime). IDEMPOTENT per tier: a tier already in `earned` is never re-fired (so a re-count or replay
 * can't double-pay). Real-or-nothing: an unknown monster still counts the kill (so the number is true)
 * but simply has no ladder to cross.
 *
 * @returns {{ newlyEarned: object[], killCount: number, totalEarned: number }}
 */
export function recordKill(store, pawnKey, monsterId, n = 1) {
  if (!monsterId) throw new Error('personal-bestiary: monsterId required');
  const add = Math.max(0, Math.floor(Number(n) || 0));
  const p = ensurePawn(store, pawnKey);

  // count the kill(s) + mark seen (a killed monster was, by definition, encountered)
  const prev = Number(p.kills[monsterId]) || 0;
  const now = Date.now();
  const killCount = prev + add;
  p.kills[monsterId] = killCount;
  const s = p.seen[monsterId] || (p.seen[monsterId] = { first: now, last: now, count: 0 });
  s.last = now; s.count += add;

  const newlyEarned = [];
  if (add <= 0) return { newlyEarned, killCount, totalEarned: totalEarned(store, pawnKey) };

  // cross any KILL tiers whose threshold is now met and that aren't already earned.
  for (const rung of getKillTiers(monsterId)) {
    if (killCount < rung.count) continue;         // threshold not reached
    if (p.earned[rung.achId]) continue;           // already earned (idempotent — never re-fire)
    p.earned[rung.achId] = { title: rung.title, tier: rung.tier, monsterId, count: rung.count, at: now };
    newlyEarned.push(unlockEvent(rung, monsterId, killCount));
  }

  // if we earned at least one kill tier, the TOTAL rose → re-check the GEM meta ladder.
  if (newlyEarned.length) {
    const total = Object.keys(p.earned).length;   // NEW total (includes the kill tiers just added)
    for (const meta of getMetaTiers(total)) {
      if (p.earned[meta.achId]) continue;         // already earned this milestone
      p.earned[meta.achId] = { title: meta.title, tier: meta.tier, monsterId: null, count: meta.count, at: now };
      newlyEarned.push(unlockEvent(meta, null, total));
    }
  }

  return { newlyEarned, killCount, totalEarned: totalEarned(store, pawnKey) };
}

/**
 * The strengths/weaknesses/tactics a pawn may READ for a monster. GATED: revealed only once the pawn
 * has EARNED that monster's (any-tier) achievement. Otherwise returns a locked stub with the kill
 * progress toward the first (bronze) rung and the "fight it more to learn its ways" prompt.
 *
 * @returns {{ unlocked:boolean, name, cr, lore?, progress?:{ kills, need, remaining, nextTitle }, prompt? }}
 */
export function knownLore(store, pawnKey, monsterId) {
  const meta = monsterMeta(monsterId);
  const lore = loreFor(monsterId);
  const name = (meta && meta.name) || (lore && lore.name) || monsterId;
  const cr = (meta && meta.cr) || (lore && lore.cr) || null;
  const p = store && store.pawns && store.pawns[pawnKey];
  const kills = (p && Number(p.kills[monsterId])) || 0;

  const earnedThisMonster = !!(p && Object.values(p.earned).some((e) => e.monsterId === monsterId));
  if (earnedThisMonster && lore) {
    return { unlocked: true, name, cr, lore };
  }

  // locked: show progress toward the first (bronze) rung so the player knows the goal.
  const tiers = getKillTiers(monsterId);
  const first = tiers[0] || null;
  const need = first ? first.count : null;
  return {
    unlocked: false, name, cr,
    progress: first ? { kills, need, remaining: Math.max(0, need - kills), nextTitle: first.title } : { kills, need: null, remaining: null, nextTitle: null },
    prompt: 'Fight it more to learn its ways.',
  };
}

/**
 * The pawn's FULL bestiary view for the UI:
 *   monsters : one row per SEEN monster — { monsterId, name, cr, kills, titles[], unlocked, lore|null,
 *              nextTier:{ title, tier, need, remaining } | null }
 *   titles   : every earned title (kill + meta), newest first
 *   meta     : { total, nextMilestone:{ title, count, remaining } | null }
 */
export function bestiaryFor(store, pawnKey) {
  const p = store && store.pawns && store.pawns[pawnKey];
  if (!p) return { pawnKey, monsters: [], titles: [], meta: { total: 0, nextMilestone: nextMilestoneView(0) } };

  const monsters = [];
  const seenIds = new Set([...Object.keys(p.seen), ...Object.keys(p.kills)]);
  for (const id of seenIds) {
    const meta = monsterMeta(id);
    const lore = loreFor(id);
    const kills = Number(p.kills[id]) || 0;
    const earnedRungs = Object.values(p.earned).filter((e) => e.monsterId === id);
    const unlocked = earnedRungs.length > 0;
    // next uncrossed kill tier for this monster (progress bar)
    let nextTier = null;
    for (const rung of getKillTiers(id)) {
      if (!p.earned[rung.achId]) { nextTier = { title: rung.title, tier: rung.tier, need: rung.count, remaining: Math.max(0, rung.count - kills) }; break; }
    }
    monsters.push({
      monsterId: id, name: (meta && meta.name) || (lore && lore.name) || id,
      cr: (meta && meta.cr) || (lore && lore.cr) || null,
      kills, titles: earnedRungs.map((e) => e.title),
      unlocked, lore: unlocked ? lore : null, nextTier,
    });
  }
  monsters.sort((a, b) => b.kills - a.kills || String(a.name).localeCompare(String(b.name)));

  const titles = Object.entries(p.earned)
    .map(([id, e]) => ({ achId: id, title: e.title, tier: e.tier, monsterId: e.monsterId || null, at: e.at }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));

  const total = titles.length;
  return { pawnKey, monsters, titles, meta: { total, nextMilestone: nextMilestoneView(total) } };
}

// small local helper so bestiaryFor doesn't import nextMetaTier's shape twice.
import { nextMetaTier } from './monster-achievements.js';
function nextMilestoneView(total) {
  const m = nextMetaTier(total);
  return m ? { title: m.title, count: m.count, remaining: Math.max(0, m.count - total), gem: m.gem } : null;
}
