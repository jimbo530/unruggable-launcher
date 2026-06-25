/*
  employment.js — JOBCLOCK READER/WRITER (same-origin, no build step).

  SOURCE OF TRUTH = the on-chain JobClock contract (Base 8453). A pawn that an owner
  has "Put to work" via JobClock.setEmployment(...) is EMPLOYED. EMPLOYED = at work =
  LOCKED from combat/sea. Clocking out (JobClock.clockOut) frees it. There is NO more
  off-chain localStorage employment store and NO daily reset — employment is CONTINUOUS
  (the contract settles worked-time itself). isEmployed / totalWorked are REAL on-chain
  state; we never fabricate employment.

  ── THE SYNC/ASYNC BRIDGE (why there's a cache) ───────────────────────────────────
  The pages were written against a synchronous store (crew/index.html and units.js call
  Employment.get(crewId) inline while rendering a list). On-chain reads are async (RPC),
  so we keep a small in-memory cache:
      • get(crewId)      → SYNCHRONOUS: returns the last cached record (or null) and
                           kicks off a background refresh if the entry is missing/stale.
      • refresh(crewId)  → async: reads JobClock views over a public Base RPC and updates
                           the cache. Resolves to the fresh record (or null).
      • refreshMany(ids) → async: warm the cache for a list of crewIds, then resolve.
  Pages that list many pawns should `await Employment.refreshMany([...])` once on load and
  then re-render so the synchronous get() returns live data. The cache TTL (~20s) keeps a
  big roster from spamming the RPC.

  ── RECORD SHAPE (cache value) ────────────────────────────────────────────────────
    { job:'<jobKey>'|'<vaultAddr>',     // jobKey ('str'..'cha') if the vault maps to one, else the raw vault address
      jobVault:'<vaultAddr>',           // the on-chain JobClock `job` arg (a WaterV2 vault)
      intensity:'single'|'double',      // from payoutMode (1=single, 2=double)
      startedAt:<unixSeconds>,          // employedSince()
      totalWorkedSec:<seconds>,         // totalWorked()
      daysWorked:<int> }                // floor(totalWorkedSec / 86400) — the streak now derives from chain
    crewId === "<pawnsCollection>:<tokenId>"  — the ONE key every page shares.

  Loaded with a plain <script src> (no module) so it works inside the jobs page (classic
  script) AND the ES-module battle pages (window.Employment global).
*/
(function (root) {
  'use strict';

  // ── Work clocks (Base 8453) ──
  // MIGRATION MODEL: a pawn employed on EITHER clock counts as at-work. The LIVE clock is
  // WorkClock V2; JobClock V1 is the legacy clock kept readable so already-employed pawns
  // aren't dropped. refresh() reads V2 first (live), falls back to V1 (legacy).
  var JOBCLOCK   = '0xafD8FAe33d12D5d368F0c09c93903606977D0acB'; // V1 legacy (JobClock)
  var WORKCLOCK2 = '0xE5DE012B9123C8594abb032471b6E7511f0bC601'; // V2 LIVE (WorkClock)
  var PAWNS    = '0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f';
  var CHAIN_ID = 8453;
  var DAY_SEC  = 86400;

  // Public read RPCs (rotated on failure). Reads only — writes go through the page's signer.
  var RPCS = [
    'https://base-rpc.publicnode.com',
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
    'https://1rpc.io/base',
  ];

  // job vault → jobKey map (mirror of the jobs page JOBS config). Lets crew/battle pages
  // show a friendly job name. If a vault isn't in here we still work (job = raw address).
  var VAULT_TO_KEY = {
    '0xd6d793628dc6eed71eb37dd6c51678e8a9c25f22': 'str', // Haul cargo
    '0xb303c91724485462e3450a0bd4513a521df997cb': 'dex', // Mend the nets
    '0x893531a85f249cc38da772be9056762e188302f6': 'con', // Stock the rations
    '0x90b54da4ac020fb163c51237e169feceac2369be': 'int', // Tend the beacon
    '0x8c121fc0171944c3ea40d14fe549dff7107bdf39': 'wis', // Sea-calling rites
    '0xc0813524820df5c6bb9a63a521fe218ff974b1b4': 'cha', // Barter & haggle
    '0x44c504ce08635536635f153b6ae5d9d6d8b3131f': 'guard', // Guard the Port (Mayor's civic job)
  };

  // JobClock V1 ABI (the bits this reader/writer uses).
  var JOBCLOCK_ABI = [
    'function setEmployment(address collection,uint256 tokenId,address job,uint8 mode)',
    'function clockOut(address collection,uint256 tokenId)',
    'function isEmployed(address,uint256) view returns (bool)',
    'function totalWorked(address,uint256) view returns (uint256)',
    'function employment(address,uint256) view returns (address job,uint8 payoutMode,uint64 startedAt,uint64 accumulated,bool employed)',
  ];

  // WorkClock V2 ABI (LIVE). work(...) returns the full job tuple; isEmployed(...) is the fast bool.
  // mode (uint8) carries intensity exactly like V1's payoutMode (1=single, 2=double).
  var WORKCLOCK2_ABI = [
    'function isEmployed(address,uint256) view returns (bool)',
    'function work(address,uint256) view returns (address target,uint8 ttype,uint8 mode,uint64 startedAt,uint64 accumulated,bool employed)',
  ];

  var CACHE_TTL_MS = 20000;       // 20s — avoids RPC spam when listing a roster
  var cache = {};                 // crewId → { rec, ts }
  var inflight = {};              // crewId → Promise (dedupe concurrent refreshes)

  // ── ethers + rotating read provider ──
  function hasEthers() { return typeof root.ethers !== 'undefined' && root.ethers; }
  var rpcIdx = 0, _readProvider = null;
  function readProvider() {
    if (!hasEthers()) return null;
    if (!_readProvider) _readProvider = new root.ethers.JsonRpcProvider(RPCS[rpcIdx], CHAIN_ID, { staticNetwork: true });
    return _readProvider;
  }
  function rotateRpc() { rpcIdx = (rpcIdx + 1) % RPCS.length; _readProvider = null; }

  // Parse the tokenId out of a "<collection>:<tokenId>" crewId.
  function parseCrewId(crewId) {
    if (!crewId || typeof crewId !== 'string') return null;
    var i = crewId.lastIndexOf(':');
    if (i < 0) return null;
    var collection = crewId.slice(0, i);
    var tokenId = crewId.slice(i + 1);
    if (tokenId === '' || isNaN(Number(tokenId))) return null;
    return { collection: collection, tokenId: tokenId };
  }

  function modeToIntensity(mode) { return Number(mode) === 2 ? 'double' : 'single'; }

  // Build the cache record from a JobClock V1 employment() tuple. Returns null if not employed.
  function recFromEmployment(emp, totalWorkedSec) {
    // emp = [job, payoutMode, startedAt, accumulated, employed]
    var employed = !!emp[4];
    if (!employed) return null;
    var vault = String(emp[0]);
    var key = VAULT_TO_KEY[vault.toLowerCase()] || vault; // friendly job key if known, else raw address
    var worked = Number(totalWorkedSec || 0);
    return {
      job: key,
      jobVault: vault,
      intensity: modeToIntensity(emp[1]),
      startedAt: Number(emp[2]) || 0,
      totalWorkedSec: worked,
      daysWorked: Math.floor(worked / DAY_SEC),
      clock: 1,
    };
  }

  // Build the cache record from a WorkClock V2 work() tuple. Returns null if not employed.
  // tuple = [target, ttype, mode, startedAt, accumulated, employed]
  function recFromWork(w) {
    var employed = !!w[5];
    if (!employed) return null;
    var vault = String(w[0]);
    var key = VAULT_TO_KEY[vault.toLowerCase()] || vault; // friendly job key if known, else raw address
    var worked = Number(w[4] || 0); // accumulated worked-seconds
    return {
      job: key,
      jobVault: vault,
      intensity: modeToIntensity(w[2]), // mode: 1=single, 2=double
      startedAt: Number(w[3]) || 0,
      totalWorkedSec: worked,
      daysWorked: Math.floor(worked / DAY_SEC),
      clock: 2,
    };
  }

  // Async: read JobClock for one crewId, update the cache, resolve to the record (or null).
  function refresh(crewId) {
    if (!crewId) return Promise.resolve(null);
    if (inflight[crewId]) return inflight[crewId];
    var parsed = parseCrewId(crewId);
    if (!parsed || !hasEthers()) { return Promise.resolve(cache[crewId] ? cache[crewId].rec : null); }

    var p = (function attempt(triesLeft) {
      var provider = readProvider();
      // MIGRATION READ: V2 (live) is the source of truth; V1 (legacy) is a fallback so
      // pawns clocked in on the old contract still read as at-work. A hit on EITHER counts.
      var v2 = new root.ethers.Contract(WORKCLOCK2, WORKCLOCK2_ABI, provider);
      var v1 = new root.ethers.Contract(JOBCLOCK, JOBCLOCK_ABI, provider);
      return Promise.all([
        v2.work(parsed.collection, parsed.tokenId),
        v1.employment(parsed.collection, parsed.tokenId),
        v1.totalWorked(parsed.collection, parsed.tokenId),
      ]).then(function (out) {
        // prefer V2 (live); fall back to V1 (legacy) if not employed on V2
        var rec = recFromWork(out[0]) || recFromEmployment(out[1], out[2]);
        cache[crewId] = { rec: rec, ts: Date.now() };
        return rec;
      }).catch(function (e) {
        if (triesLeft > 1) { rotateRpc(); return attempt(triesLeft - 1); }
        // visible, never silent — keep the last cached value (don't wipe to "free")
        console.warn('WorkClock read failed for', crewId, ':', e && (e.shortMessage || e.message || e));
        return cache[crewId] ? cache[crewId].rec : null;
      });
    })(RPCS.length);

    inflight[crewId] = p;
    p.then(function () { delete inflight[crewId]; }, function () { delete inflight[crewId]; });
    return p;
  }

  // Async: warm the cache for many crewIds (sequential-ish to be gentle on the RPC).
  function refreshMany(crewIds) {
    if (!crewIds || !crewIds.length) return Promise.resolve();
    // small concurrency so a 100-pawn roster doesn't open 100 sockets at once
    var i = 0, CONC = 5, ids = crewIds.slice();
    function worker() {
      if (i >= ids.length) return Promise.resolve();
      var id = ids[i++];
      return refresh(id).then(worker, worker);
    }
    var runners = [];
    for (var k = 0; k < Math.min(CONC, ids.length); k++) runners.push(worker());
    return Promise.all(runners);
  }

  var Employment = {
    DAY_SEC: DAY_SEC,
    JOBCLOCK: JOBCLOCK,     // V1 legacy
    WORKCLOCK2: WORKCLOCK2, // V2 live
    PAWNS: PAWNS,

    /**
     * SYNCHRONOUS read for inline rendering. Returns the last cached employment record
     * (or null). If the entry is missing or stale, fires a background refresh (the caller
     * should re-render when its own refresh()/refreshMany() resolves). NEVER blocks.
     */
    get: function (crewId) {
      if (!crewId) return null;
      var hit = cache[crewId];
      if (!hit || (Date.now() - hit.ts) > CACHE_TTL_MS) {
        refresh(crewId); // fire-and-forget; visible failures logged in refresh()
      }
      return hit ? hit.rec : null;
    },

    /** Async: force-read JobClock for a crewId and update the cache. Resolves to the record. */
    refresh: refresh,
    /** Async: warm the cache for a list of crewIds, then resolve. */
    refreshMany: refreshMany,

    /** True if the pawn is currently EMPLOYED on-chain (locked from combat/sea). Sync (cache). */
    isEmployed: function (crewId) { return !!this.get(crewId); },

    /** Worked seconds (from JobClock.totalWorked), via the cache. */
    totalWorked: function (crewId) {
      var rec = this.get(crewId);
      return rec ? (rec.totalWorkedSec || 0) : 0;
    },

    /**
     * Put a pawn to work: owner signs JobClock.setEmployment(pawns, tokenId, jobVault, mode).
     * @param {string} crewId    "<pawns>:<tokenId>"
     * @param {string} jobVault  the stat's WaterV2 vault address (the JobClock `job` arg)
     * @param {string} intensity 'single' (mode 1) | 'double' (mode 2)
     * @param {object} signer    an ethers Signer (owner). REQUIRED — this is a real tx.
     * @returns {Promise<object|null>} the fresh on-chain record after the tx confirms.
     */
    employ: function (crewId, jobVault, intensity, signer) {
      var parsed = parseCrewId(crewId);
      if (!parsed) return Promise.reject(new Error('bad crewId: ' + crewId));
      if (!jobVault) return Promise.reject(new Error('no job vault for employment'));
      if (!signer) return Promise.reject(new Error('connect a wallet to put a hand to work'));
      if (!hasEthers()) return Promise.reject(new Error('ethers not loaded'));
      var mode = intensity === 'double' ? 2 : 1;
      var c = new root.ethers.Contract(JOBCLOCK, JOBCLOCK_ABI, signer);
      // setEmployment overwrites any prior job (the contract settles worked-time on switch).
      return c.setEmployment(parsed.collection, parsed.tokenId, jobVault, mode)
        .then(function (tx) { return tx.wait(); })
        .then(function () { delete cache[crewId]; return refresh(crewId); }); // re-read truth
    },

    /**
     * Clock a pawn out: owner signs JobClock.clockOut(pawns, tokenId). Frees it to fight/sail.
     * @returns {Promise<null>} (record is null after a successful clock-out).
     */
    clockOut: function (crewId, signer) {
      var parsed = parseCrewId(crewId);
      if (!parsed) return Promise.reject(new Error('bad crewId: ' + crewId));
      if (!signer) return Promise.reject(new Error('connect a wallet to clock out'));
      if (!hasEthers()) return Promise.reject(new Error('ethers not loaded'));
      var c = new root.ethers.Contract(JOBCLOCK, JOBCLOCK_ABI, signer);
      return c.clockOut(parsed.collection, parsed.tokenId)
        .then(function (tx) { return tx.wait(); })
        .then(function () { delete cache[crewId]; return refresh(crewId); });
    },

    intensityLabel: function (intensity) {
      return intensity === 'double' ? 'Double 16h' : 'Single 8h';
    },

    /** Days worked derived from on-chain totalWorked seconds (the "streak" now). */
    daysWorkedFor: function (crewId) {
      var rec = this.get(crewId);
      return rec ? (rec.daysWorked || 0) : 0;
    },
  };

  // expose as a global (works for classic scripts AND ES-module pages)
  root.Employment = Employment;
  if (typeof module !== 'undefined' && module.exports) module.exports = Employment;
})(typeof window !== 'undefined' ? window : this);
