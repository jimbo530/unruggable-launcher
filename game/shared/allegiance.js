// @ts-check
/**
 * allegiance.js — the game-layer RECRUIT / PLEDGE / FLEET / MUTINY engine for
 * "Seize the Seas". Pure localStorage (beta). NO network, NO on-chain txs.
 *
 * The old on-chain reactor-chaining recruit loop is RETIRED. This is the
 * skill/work-based replacement:
 *
 *   • A recruit link (?recruit=<inviterId>) makes a visitor PLEDGE to the
 *     inviter — but only once the visitor does real WORK (recruits a pawn /
 *     captains a ship). Opening a link alone earns nothing. Recruiting is work.
 *   • When a pledged crewmember WORKS, a reward flows into the INVITER's ship
 *     HOLD (a game-layer record). Bringing in crew + their work raises rank.
 *   • Allegiance is contestable + LOSABLE: a ship can MUTINY (sail free, or
 *     re-pledge to another admiral), and a captain can CONTEST a free/rival
 *     ship to flip its loyalty — a skill roll, winnable or losable both ways.
 *
 * All cross-tab/cross-page reads use the same shared keys so the Port, the
 * Shipyard, the Tavern, and Town Work all see one consistent fleet.
 *
 * Keys (kept compatible with the existing shipyard):
 *   sts_myId       — this player's short id (shared with shipyard)
 *   sts_captain    — "1" if captained a ship
 *   sts_crew       — recruited pawns (shared with Tavern/Crew/Decks)
 *   sts_admiral    — id of the admiral THIS player pledges to (or absent)
 *   sts_fleet      — [{id,name,joinedAt,lastWorkAt,loyalty}] ships pledged to ME
 *   sts_hold       — {total, log:[{from,kind,amount,at}]} rewards in MY hold
 *   sts_pending    — pending recruiter id captured from a link, not yet earned
 *   sts_log        — lightweight event feed for the UI
 */

const K = {
  id: 'sts_myId',
  captain: 'sts_captain',
  crew: 'sts_crew',
  admiral: 'sts_admiral',
  fleet: 'sts_fleet',
  hold: 'sts_hold',
  pending: 'sts_pending',
  log: 'sts_log',
};

// ---- tiny safe JSON helpers (no silent catches — warn on bad data) -------
function readJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch (e) { console.warn(`[allegiance] bad JSON in ${key}, resetting:`, e); return fallback; }
}
function writeJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ---- identity ------------------------------------------------------------
export function myId() {
  let v = localStorage.getItem(K.id);
  if (!v) {
    v = (crypto.randomUUID ? crypto.randomUUID() : 'cap' + Date.now()).slice(0, 8);
    localStorage.setItem(K.id, v);
  }
  return v;
}

export function isCaptain() { return localStorage.getItem(K.captain) === '1'; }
export function setCaptain(on) { localStorage.setItem(K.captain, on ? '1' : '0'); }

export function crew() { const c = readJSON(K.crew, []); return Array.isArray(c) ? c : []; }

// who I pledge to (my admiral), or null
export function myAdmiral() { return localStorage.getItem(K.admiral) || null; }

// ships pledged to ME
export function fleet() { const f = readJSON(K.fleet, []); return Array.isArray(f) ? f : []; }
function setFleet(f) { writeJSON(K.fleet, f); }

// my reward hold
export function hold() {
  const h = readJSON(K.hold, { total: 0, log: [] });
  return { total: Number(h.total) || 0, log: Array.isArray(h.log) ? h.log : [] };
}
function setHold(h) { writeJSON(K.hold, h); }

// ---- event log (UI feed) -------------------------------------------------
function pushLog(text) {
  const log = readJSON(K.log, []);
  log.unshift({ text, at: Date.now() });
  writeJSON(K.log, log.slice(0, 40));
}
export function eventLog() { const l = readJSON(K.log, []); return Array.isArray(l) ? l : []; }

// ---- recruit-link capture (Port) ----------------------------------------
/**
 * Call on the Port with the current URL. If ?recruit=<id> is present and it's
 * not me and I'm not already pledged, stash it as PENDING (not earned yet —
 * you must do work to actually pledge). Returns the recruiter id if a fresh
 * pending pledge was captured, else null.
 */
export function captureRecruitFromUrl(search = location.search) {
  const params = new URLSearchParams(search);
  const rec = (params.get('recruit') || '').trim();
  if (!rec) return null;
  if (rec === myId()) return null;            // can't recruit yourself
  if (myAdmiral()) return null;               // already sworn to someone
  if (fleet().some((s) => s.id === rec)) return null; // they're already in YOUR fleet
  localStorage.setItem(K.pending, rec);
  return rec;
}

export function pendingRecruiter() { return localStorage.getItem(K.pending) || null; }
export function clearPending() { localStorage.removeItem(K.pending); }

// ---- the WORK hook (the heart of skill/work-based recruiting) ------------
/**
 * Record that THIS player did a unit of work (recruited a pawn, captained,
 * finished a shift). Two effects:
 *   1) If a pending recruiter is waiting, the FIRST work finalizes the pledge
 *      (you now sail under them) and seeds their fleet with your ship.
 *   2) For whoever you already pledge to, this work earns them a reward into
 *      their hold — recorded here AND mirrored so their Shipyard can show it.
 *
 * kind: 'recruit' | 'captain' | 'shift' | 'launch' (label only)
 * Returns {pledgedNow, reward} for UI feedback.
 */
const REWARD = { recruit: 5, captain: 25, launch: 25, shift: 3 };

export function recordWork(kind = 'shift', name = '') {
  let pledgedNow = null;

  // 1) finalize a pending pledge on first real work
  const pending = pendingRecruiter();
  if (pending && !myAdmiral() && pending !== myId()) {
    localStorage.setItem(K.admiral, pending);
    clearPending();
    pledgedNow = pending;
    pushLog(`You swore your ship to Captain ${pending}. Work you do now strengthens their fleet.`);
    // seed the inviter's fleet record on MY side too, so if they open this
    // browser/session as the admiral they'd see it; cross-device is on-chain later.
    addToFleetOf(pending, { id: myId(), name: name || ('Ship ' + myId()) });
  }

  // 2) reward my admiral for this work
  const admiral = myAdmiral();
  let reward = 0;
  if (admiral) {
    reward = REWARD[kind] || 1;
    creditHoldFor(admiral, { from: myId(), kind, amount: reward });
    bumpFleetWork(admiral, myId());
  }

  return { pledgedNow, reward };
}

// ---- fleet + hold writes (game-layer mirror) ----------------------------
// In beta there's no shared backend, so "the inviter's fleet/hold" lives under
// namespaced keys we can also surface locally. The admiral's OWN session reads
// sts_fleet / sts_hold; we mirror into sts_fleet_<admiral> / sts_hold_<admiral>
// so the data survives even when the admiral isn't the active session, and the
// Shipyard merges its own id's mirror on load.

function fleetKeyOf(id) { return `${K.fleet}_${id}`; }
function holdKeyOf(id) { return `${K.hold}_${id}`; }

function addToFleetOf(adminId, ship) {
  const key = fleetKeyOf(adminId);
  const f = readJSON(key, []);
  if (!f.some((s) => s.id === ship.id)) {
    f.push({ id: ship.id, name: ship.name, joinedAt: Date.now(), lastWorkAt: Date.now(), loyalty: 100 });
    writeJSON(key, f);
  }
  // if I AM the admiral in this session, reflect into the live fleet too
  if (adminId === myId()) mergeMirrorIntoLive();
}

function bumpFleetWork(adminId, shipId) {
  const key = fleetKeyOf(adminId);
  const f = readJSON(key, []);
  const s = f.find((x) => x.id === shipId);
  if (s) { s.lastWorkAt = Date.now(); s.loyalty = Math.min(100, (s.loyalty || 100) + 1); writeJSON(key, f); }
  if (adminId === myId()) mergeMirrorIntoLive();
}

function creditHoldFor(adminId, entry) {
  const key = holdKeyOf(adminId);
  const h = readJSON(key, { total: 0, log: [] });
  h.total = (Number(h.total) || 0) + entry.amount;
  h.log.unshift({ ...entry, at: Date.now() });
  h.log = h.log.slice(0, 50);
  writeJSON(key, h);
  if (adminId === myId()) mergeMirrorIntoLive();
}

/**
 * Pull MY mirror (sts_fleet_<me> / sts_hold_<me>) into the live keys the
 * Shipyard reads. Idempotent — call on Shipyard load.
 */
export function mergeMirrorIntoLive() {
  const me = myId();
  const mFleet = readJSON(fleetKeyOf(me), []);
  if (Array.isArray(mFleet) && mFleet.length) {
    const live = fleet();
    const byId = new Map(live.map((s) => [s.id, s]));
    for (const s of mFleet) {
      const ex = byId.get(s.id);
      if (!ex) byId.set(s.id, s);
      else { ex.lastWorkAt = Math.max(ex.lastWorkAt || 0, s.lastWorkAt || 0); ex.loyalty = s.loyalty ?? ex.loyalty; }
    }
    setFleet([...byId.values()]);
  }
  const mHold = readJSON(holdKeyOf(me), null);
  if (mHold) setHold({ total: Number(mHold.total) || 0, log: Array.isArray(mHold.log) ? mHold.log : [] });
}

// ---- MUTINY (a ship in MY fleet sails free, or re-pledges elsewhere) ------
/**
 * A ship in MY fleet mutinies. shipId leaves my fleet. If newAdmiral is given
 * (and isn't me), it re-pledges there; otherwise it sails free.
 * Game-layer: this is the admiral-side record. Returns the removed ship.
 */
export function mutinyFromMyFleet(shipId, newAdmiral = null) {
  const f = fleet();
  const idx = f.findIndex((s) => s.id === shipId);
  if (idx < 0) return null;
  const [ship] = f.splice(idx, 1);
  setFleet(f);
  // keep the mirror in sync
  const mk = fleetKeyOf(myId());
  const mf = readJSON(mk, []).filter((s) => s.id !== shipId);
  writeJSON(mk, mf);
  if (newAdmiral && newAdmiral !== myId()) {
    addToFleetOf(newAdmiral, { id: ship.id, name: ship.name });
    pushLog(`${ship.name || ship.id} mutinied and re-pledged to Captain ${newAdmiral}.`);
  } else {
    pushLog(`${ship.name || ship.id} mutinied and now sails free.`);
  }
  return ship;
}

/** I (as a pledged ship) mutiny against MY admiral — sail free or re-pledge. */
export function mutinyMine(newAdmiral = null) {
  const old = myAdmiral();
  if (!old) return false;
  if (newAdmiral && newAdmiral !== myId()) localStorage.setItem(K.admiral, newAdmiral);
  else localStorage.removeItem(K.admiral);
  pushLog(old
    ? `You broke from Captain ${old}${newAdmiral ? ` and swore to ${newAdmiral}` : ' and now sail free'}.`
    : 'You sail free.');
  return true;
}

// ---- CONTEST / FLIP allegiance (skill roll) ------------------------------
/**
 * Press-gang a target ship to flip its loyalty to ME. SKILL-BASED, not random
 * chance: the outcome is decided by your fleet's pressed strength vs the
 * target's loyalty + its current admiral's backing. (We add a small jitter for
 * texture, but the deciding factor is the skill gap — never pure luck, to stay
 * clear of gambling mechanics.)
 *
 * target: {id, name, loyalty, admiral} (admiral null = sails free)
 * Returns {won, margin, target}. On a win the ship joins MY fleet (and leaves
 * its old admiral's mirror). On a loss, the target's loyalty hardens.
 */
export function contestFlip(target) {
  if (!target || !target.id || target.id === myId()) return { won: false, margin: 0, target };

  // my pressed strength = fleet size + captain bonus + total hold (work proves muscle)
  const myStrength = fleet().length * 8 + (isCaptain() ? 10 : 0) + Math.min(40, Math.floor(hold().total / 5));
  // target defends with its loyalty; a backed ship (has an admiral) defends harder
  const defense = (Number(target.loyalty) || 50) + (target.admiral && target.admiral !== myId() ? 20 : 0);

  // skill gap decides it; tiny ±5 texture jitter, capped so skill dominates
  const jitter = (Math.random() * 10 - 5);
  const margin = (myStrength - defense) + jitter;
  const won = margin > 0;

  if (won) {
    // if it was pledged to someone else, pull it from their mirror
    if (target.admiral && target.admiral !== myId()) {
      const ok = fleetKeyOf(target.admiral);
      const of = readJSON(ok, []).filter((s) => s.id !== target.id);
      writeJSON(ok, of);
    }
    addToFleetOf(myId(), { id: target.id, name: target.name || ('Ship ' + target.id) });
    bumpFleetWork(myId(), target.id);
    pushLog(`You pressed ${target.name || target.id} into your fleet (margin +${Math.round(margin)}).`);
  } else {
    pushLog(`${target.name || target.id} held the line against your press-gang (margin ${Math.round(margin)}).`);
  }
  return { won, margin, target };
}

// ---- rank ----------------------------------------------------------------
export const GRAND_ADMIRAL_AT = 5;
export function rankOf() {
  const f = fleet().length;
  if (f >= GRAND_ADMIRAL_AT) return { rank: 'Grand Admiral', badge: '👑', sub: `${f} ships under your flag. The seas are yours — but a mutiny still costs you rank.` };
  if (f >= 1) return { rank: 'Admiral', badge: '🎖️', sub: `Commanding a fleet of ${f}. Win ${GRAND_ADMIRAL_AT - f} more loyal ship(s) to rise to Grand Admiral.` };
  if (isCaptain()) return { rank: 'Captain', badge: '🧭', sub: 'You own a ship + crew. Recruit friends to rise to Admiral.' };
  if (crew().length > 0) return { rank: 'Crew', badge: '⚔️', sub: `Sailing with ${crew().length} pawn(s). Captain a ship to lead your own.` };
  return { rank: 'Deckhand', badge: '⚓', sub: 'Just made port. Recruit a crew or captain a ship.' };
}

// ---- dev/demo helper: seed a couple of contestable free ships ------------
/** Returns a small pool of "ships on the open sea" you can try to press-gang. */
export function openSeaShips() {
  // free agents + (for texture) a rival's loyal ship you'd have to fight harder for
  const me = myId();
  const mine = new Set(fleet().map((s) => s.id));
  const pool = [
    { id: 'free-' + (me).slice(0, 3) + '1', name: 'The Drifting Gull', loyalty: 30, admiral: null },
    { id: 'free-' + (me).slice(0, 3) + '2', name: 'Saltbones', loyalty: 45, admiral: null },
    { id: 'rival-' + (me).slice(0, 3) + '1', name: 'Crimson Maw', loyalty: 55, admiral: 'rivalCap' },
  ];
  return pool.filter((s) => !mine.has(s.id));
}
