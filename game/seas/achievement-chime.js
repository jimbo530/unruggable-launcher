// @ts-check
'use strict';
/**
 * achievement-chime.js — a small, SELF-CONTAINED unlock CHIME for "Seize the Seas".
 * Coordinator/founder (2026-07-01): "we also need a chime or tone when they unlock an achievement."
 *
 * Plays a short, pleasant tone on an achievement unlock, ESCALATING by tier:
 *     bronze → a single soft ping
 *     silver → a rising two-note interval
 *     gold   → a bright three-note arpeggio
 *     gem    → a triumphant four-note flourish (the meta-collector fanfare)
 *
 * NO ASSET DEPENDENCY — the tones are SYNTHESIZED with the Web Audio API (oscillator + a short
 * gain envelope), so there is nothing to load and nothing to 404. GRACEFUL NO-OP if Web Audio is
 * unavailable (SSR / Node / an old browser / a locked-down context): playAchievementChime() simply
 * returns false and never throws — a missing chime must never break the game (no silent CRASH, but
 * a silent no-op for an OPTIONAL cosmetic is correct here; the return value tells the caller).
 *
 * USAGE (the Coordinator wires this into the client on the unlock event — see the note at bottom):
 *     import { playAchievementChime } from './achievement-chime.js';
 *     // when a server unlock event arrives:  { kind:'achievement_unlocked', tier, title, ... }
 *     if (evt.kind === 'achievement_unlocked') playAchievementChime(evt.tier);
 *
 * EXPORTS
 *   playAchievementChime(tier)  → boolean (true = played, false = audio unavailable / bad tier)
 *   TIER_MELODIES               → the note tables (exported for tuning / tests)
 *   primeAudio()                → resume a suspended AudioContext from a user gesture (optional)
 *
 * node --check clean. ESM. Zero imports, zero assets, browser-only effect.
 */

// Note frequencies (Hz), roughly a bright major feel. Each tier is a short melody; the higher the
// tier, the longer + more triumphant. Times are OFFSETS in seconds from the start of the chime.
export const TIER_MELODIES = {
  // bronze: a single soft ping (C6)
  bronze: [{ f: 1046.5, t: 0.00, d: 0.18, g: 0.16, type: 'sine' }],
  // silver: a rising two-note interval (E6 → G6)
  silver: [
    { f: 1318.5, t: 0.00, d: 0.14, g: 0.16, type: 'sine' },
    { f: 1568.0, t: 0.12, d: 0.20, g: 0.17, type: 'sine' },
  ],
  // gold: a bright three-note arpeggio (C6 → E6 → G6)
  gold: [
    { f: 1046.5, t: 0.00, d: 0.12, g: 0.16, type: 'triangle' },
    { f: 1318.5, t: 0.10, d: 0.12, g: 0.17, type: 'triangle' },
    { f: 1568.0, t: 0.20, d: 0.26, g: 0.19, type: 'triangle' },
  ],
  // gem: a triumphant four-note flourish (C6 → E6 → G6 → C7)
  gem: [
    { f: 1046.5, t: 0.00, d: 0.11, g: 0.17, type: 'triangle' },
    { f: 1318.5, t: 0.09, d: 0.11, g: 0.18, type: 'triangle' },
    { f: 1568.0, t: 0.18, d: 0.11, g: 0.19, type: 'triangle' },
    { f: 2093.0, t: 0.27, d: 0.34, g: 0.22, type: 'triangle' },
  ],
};

// one shared AudioContext (lazily created; browsers cap the count).
let _ctx = null;
// The shared audio system, if the client mounted it. When present we REUSE its AudioContext and
// route the chime through its SFX bus so the global mute + effects slider apply to the chime too.
function seasAudio() {
  const S = (typeof globalThis !== 'undefined') && globalThis.SeasAudio;
  return (S && typeof S.getContext === 'function' && typeof S.getSfxBus === 'function') ? S : null;
}
function audioContext() {
  // Prefer the shared SeasAudio context (so a mute there mutes the chime); fall back to our own.
  const S = seasAudio();
  if (S) { const c = S.getContext(); if (c) return c; }
  if (_ctx) return _ctx;
  const AC = (typeof globalThis !== 'undefined') && (globalThis.AudioContext || globalThis.webkitAudioContext);
  if (!AC) return null;                 // no Web Audio here (Node/SSR/old browser) → graceful no-op
  try { _ctx = new AC(); } catch (_e) { _ctx = null; } // ctor can throw in a locked context
  return _ctx;
}
// Where the chime's final gain connects: the SeasAudio SFX bus if present (obeys mute/SFX slider),
// else the context's own destination. Falls back safely if the bus is unavailable.
function outputNode(ctx) {
  const S = seasAudio();
  if (S) { try { const bus = S.getSfxBus(); if (bus) return bus; } catch (_e) {} }
  return ctx.destination;
}

/** Resume a suspended context from a user gesture (browsers auto-suspend until a click). Optional —
 *  call it from your first click handler so the very first unlock chime is audible. */
export function primeAudio() {
  const ctx = audioContext();
  if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') { try { ctx.resume(); } catch (_e) {} }
  return !!ctx;
}

/**
 * Play the chime for a tier. Returns true if a tone was scheduled, false if audio is unavailable or
 * the tier is unknown. Never throws (an optional cosmetic must not break the game).
 * @param {'bronze'|'silver'|'gold'|'gem'} tier
 */
export function playAchievementChime(tier) {
  const melody = TIER_MELODIES[tier];
  if (!melody) return false;                          // unknown tier → no-op (honest false)
  const ctx = audioContext();
  if (!ctx) return false;                             // no Web Audio → graceful no-op
  try {
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') { ctx.resume(); }
    const out = outputNode(ctx);        // SeasAudio SFX bus if present (honors global mute), else destination
    const start = ctx.currentTime + 0.01;
    for (const n of melody) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type || 'sine';
      osc.frequency.value = n.f;
      const t0 = start + n.t;
      // a quick attack + exponential decay = a pleasant "ping" with no click.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(n.g, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d);
      osc.connect(gain).connect(out);
      osc.start(t0);
      osc.stop(t0 + n.d + 0.02);
    }
    return true;
  } catch (_e) {
    return false;                                     // scheduling failed → no-op, never crash
  }
}

export default { playAchievementChime, primeAudio, TIER_MELODIES };
