/*
  quest-ladder.js — SEIZE THE SEAS · QUEST LADDER (Phase 1) — the GAME-LAYER watcher + awards.

  WHAT THIS IS (and is NOT)
  -------------------------
  This is the OFF-CHAIN, in-game progress mirror for the Seas Quest Ladder. It:
    1. holds the LOCKED achievement catalog (60 rungs: 7 job ladders × 6 + 3 ship ladders × 6),
       mirrored VERBATIM from the registration scripts so the board, the future on-chain
       registration, and the live attestation keeper all read the same ids/names/tiers;
    2. WATCHES quest progress from game events — it reads the pawn's LIVE work run (the same
       on-chain run the Option-C watcher reconstructs) and folds it into per-pawn progress;
    3. GRANTS awards on completion — banks a trophy/title locally the moment a rung's mark is hit.

  It NEVER sends a transaction. It does NOT register achievements, attest eligibility, or claim a
  prize. Those are a SEPARATE, founder-gated, on-chain keeper step (seas-ladder/seas-watcher.cjs +
  register-achievements.cjs / register-guard-ladder.cjs). This layer stops exactly short of the chain.

  RUN RULES (locked 2026-06-24 — mirror of SeasQuestLadder-SPEC.md / seas-watcher.cjs):
    • A run = one continuous stretch at ONE job. WorkClock V2 (0xE5DE…C601) keeps the run-start in
      `startedAt` and resets it ONLY on a real job switch — a payout-mode flip does NOT reset it.
      employment.js surfaces that run as { job, jobVault, startedAt, … }, so this watcher reads the
      true continuous run directly: runSecs = now − startedAt. (Same metric as eligibleIdsFor().)
    • Hitting a mark = a banked trophy. Banked trophies are kept FOREVER — switching jobs loses the
      in-progress *run*, never an earned *trophy*.

  COMPLIANCE (locked): a prize is "a Noble's FAVOR — a best-effort gift from the court purse, never
  promised", funded by Aave/Uniswap yield (not us), self-custodied by the player. NEVER framed as
  "deposit → earn BTC", never an amount promise, never the word "invest". (See user memory.)

  DATA SOURCES (all addresses referenced from existing project files — none invented):
    • catalog ids/names/tiers ........ mftusd-build/seas-ladder/register-achievements.cjs (54)
                                       + mftusd-build/register-guard-ladder.cjs (6, Guard the Port)
    • tier pool addresses ............ same scripts + seas-watcher.cjs POOLS
    • job → vault map ................ jobs/index.html JOBS + employment.js VAULT_TO_KEY
    • run semantics .................. employment.js (WorkClock V2) + seas-watcher.cjs applyEvent()

  LOADING: plain <script src="quest-ladder.js"></script> exposes window.QuestLadder. Also
  require()-able in Node (module.exports) so `node --check` + the smoke test run headless.
*/
(function (root) {
  'use strict';

  var STORE_PREFIX = 'seas.quest.v1.';     // localStorage key prefix, per crewId
  var DAY = 86400;

  // ── TIER POOLS (cbBTC court purses). addr verified from register-achievements.cjs + seas-watcher.cjs.
  var POOLS = {
    Mayor:     { addr: '0xB10fbbCB67d68d1f43E566089FFa0f36Bd057193', tag: 1 },
    Lord:      { addr: '0x4cC809378135F9501e37532dFDF3df6aED2B3342', tag: 2 },
    PettyKing: { addr: '0x1D6dA6b28a62A45588411eEE66C94AC951A461D2', tag: 3 },
    HighKing:  { addr: '0x2983E3d4250d01ba05013F1E9995Cd457D7aBa65', tag: 4 },
    Emperor:   { addr: '0xF3dA6a1D7d1a57F4E4782213D831646C7E45d6B0', tag: 5 },
  };

  // ── RUNGS: the six marks. secs/tier mirror register-achievements.cjs RUNGS + seas-watcher.cjs.
  var RUNGS = [
    { rung: 1, secs: 86400,    label: '1 day',    tier: 'Mayor' },
    { rung: 2, secs: 604800,   label: '1 week',   tier: 'Mayor' },
    { rung: 3, secs: 2592000,  label: '1 month',  tier: 'Lord' },
    { rung: 4, secs: 7776000,  label: '3 months', tier: 'PettyKing' },
    { rung: 5, secs: 15552000, label: '6 months', tier: 'HighKing' },
    { rung: 6, secs: 31536000, label: '1 year',   tier: 'Emperor' },
  ];
  var TIER_LABEL = { Mayor: 'Mayor', Lord: 'Lord', PettyKing: 'Petty King', HighKing: 'High King', Emperor: 'Emperor' };

  // ── JOB LADDERS. id = jobNum*100 + rung (jobNum 10 → 1001..1006, same formula).
  //    metric 'jobRun' = continuous seconds employed at THIS job's vault (lose-on-switch).
  //    vault addrs mirror jobs/index.html JOBS + seas-watcher.cjs JOB_VAULTS.
  var JOB_LADDERS = {
    1:  { jobKey: 'str',   stat: 'STR',   group: 'Haul Cargo',        emoji: '📦', vault: '0xD6D793628dc6Eed71EB37dd6c51678E8a9c25f22',
          names: ['Signed On the Docks', 'Crate Hauler', 'Stevedore', 'Dockmaster', 'Harbor Foreman', 'Cargo Baron'] },
    2:  { jobKey: 'dex',   stat: 'DEX',   group: 'Mend the Nets',     emoji: '🪢', vault: '0xb303c91724485462e3450A0Bd4513a521df997cB',
          names: ['Net Threader', 'Net Mender', 'Rigging Hand', 'Sailmaker', 'Master of the Weave', 'Net Lord'] },
    3:  { jobKey: 'con',   stat: 'CON',   group: 'Stock the Rations', emoji: '🛢️', vault: '0x893531A85f249cC38Da772be9056762E188302F6',
          names: ['Cellar Boy', 'Rationer', 'Provisioner', 'Steward', 'Quartermaster', 'Larder King'] },
    4:  { jobKey: 'int',   stat: 'INT',   group: 'Tend the Beacon',   emoji: '🗼', vault: '0x90B54DA4Ac020fB163C51237e169FecEaC2369be',
          names: ['Lamp Lighter', 'Beacon Keeper', 'Chart Reader', 'Lorekeeper', 'Master Cartographer', 'Lord of the Light'] },
    5:  { jobKey: 'wis',   stat: 'WIS',   group: 'Sea-Rites',         emoji: '🐚', vault: '0x8C121fC0171944C3EA40d14FE549dFf7107BDf39',
          names: ['Shell Gatherer', 'Shell Listener', 'Tide Reader', 'Sea-Caller', 'Oracle of the Deep', 'Lord of Tides'] },
    6:  { jobKey: 'cha',   stat: 'CHA',   group: 'Barter at Market',  emoji: '⚖️', vault: '0xc0813524820df5C6bb9a63a521fE218ff974b1B4',
          names: ['Stall Hand', 'Haggler', 'Trader', 'Broker', 'Market Master', 'Merchant Prince'] },
    10: { jobKey: 'guard', stat: 'GUARD', group: 'Guard the Port',    emoji: '🛡️', vault: '0x44c504Ce08635536635f153B6Ae5d9D6d8b3131F',
          names: ['Posted to the Watch', 'Harbor Watchman', 'Port Warden', 'Watch Captain', 'Harbor Marshal', 'Lord Protector of the Port'] },
  };
  var JOB_ORDER = [1, 2, 3, 4, 5, 6, 10];

  // ── SHIP LADDERS (700/800/900). Names mirror register-achievements.cjs SHIP_LADDERS (’ kept verbatim).
  //    metric: 'loyaltyTime' / 'mercTime' = ship-allegiance time (NOT yet sourced in-game — see GAPS);
  //            'jobVariety' = count of DISTINCT jobs the pawn has worked (the in-game proxy we DO have).
  var SHIP_LADDERS = {
    700: { key: 'loyalty',     group: 'Loyalty (Stay Loyal)',   emoji: '⚓', metric: 'loyaltyTime',
           names: ['Deckhand of the Watch', 'Ship’s Hand', 'Bonded Crew', 'Sworn Hand', 'Ship’s Veteran', 'True Crew'] },
    800: { key: 'seadog',      group: 'Sea Dog for Hire',       emoji: '🪝', metric: 'mercTime',
           names: ['Drifter', 'Hired Oar', 'Roving Hand', 'Wandering Mate', 'Salt-Worn Mercenary', 'Old Sea Dog'] },
    900: { key: 'versatility', group: 'Versatility (All Hands)', emoji: '🧭', metric: 'jobVariety',
           counts: [2, 3, 4, 5, 6, 7],
           names: ['Two-Trade Hand', 'Three-Trade Hand', 'Four-Trade Hand', 'Five-Trade Hand', 'Six-Trade Hand', 'Jack of All Trades'] },
  };
  var SHIP_ORDER = [700, 800, 900];

  // ── lookups ─────────────────────────────────────────────────────────────────
  var JOBKEY_TO_NUM = {}, VAULT_TO_NUM = {};
  JOB_ORDER.forEach(function (n) {
    var L = JOB_LADDERS[n];
    JOBKEY_TO_NUM[L.jobKey] = n;
    VAULT_TO_NUM[L.vault.toLowerCase()] = n;
  });

  // ── FLAT CATALOG (60) — the single source of truth the board + readiness checks iterate. ──
  function rungTier(rIdx) { return RUNGS[rIdx].tier; }
  var ACHIEVEMENTS = [];
  (function build() {
    JOB_ORDER.forEach(function (n) {
      var L = JOB_LADDERS[n];
      RUNGS.forEach(function (r, i) {
        ACHIEVEMENTS.push({
          id: n * 100 + r.rung, kind: 'JOB', ladderId: n, ladderKey: L.jobKey, group: L.group,
          name: L.names[i], rung: r.rung, rungLabel: r.label, tier: r.tier, tierTag: POOLS[r.tier].tag,
          pool: POOLS[r.tier].addr, metric: 'jobRun', jobNum: n, jobKey: L.jobKey, thresholdSecs: r.secs,
        });
      });
    });
    SHIP_ORDER.forEach(function (series) {
      var S = SHIP_LADDERS[series];
      RUNGS.forEach(function (r, i) {
        var entry = {
          id: series + r.rung, kind: 'SHIP', ladderId: series, ladderKey: S.key, group: S.group,
          name: S.names[i], rung: r.rung, rungLabel: r.label, tier: r.tier, tierTag: POOLS[r.tier].tag,
          pool: POOLS[r.tier].addr, metric: S.metric,
        };
        if (S.metric === 'jobVariety') entry.thresholdCount = S.counts[i];
        else entry.thresholdSecs = r.secs; // loyalty/seadog = time-based
        ACHIEVEMENTS.push(entry);
      });
    });
  })();
  var BY_ID = {};
  ACHIEVEMENTS.forEach(function (a) { BY_ID[a.id] = a; });

  // ── OPEN ITEMS — the spec's "do not register until cleared" list, with what THIS layer closes.
  //    Items 1-4 are CLOSED in-repo (read-only verification, no chain). Item 5 is a fire-time keeper
  //    COURTESY -> reclassified DEFERRED (non-blocking, self-guarding), not a catalog blocker. This
  //    layer still NEVER registers / attests / claims -- that stays a founder-gated keeper step.
  var OPEN_ITEMS = [
    { n: 1, item: 'JobClock reads per-job continuous time', status: 'CLOSED',
      note: 'WorkClock V2 (0xE5DE…C601) keeps the current run in startedAt and resets only on a real job switch (not a payout-mode flip). employment.js surfaces it; this watcher reads that run. seas-watcher.cjs reconstructs the same run from events.' },
    { n: 2, item: 'Gather + confirm the 5 tier-pool addresses', status: 'CLOSED',
      note: 'Mayor/Lord/Petty King/High King/Emperor mirrored from register-achievements.cjs. Admin==curator is re-verified on-chain by the --live registration before any write.' },
    { n: 3, item: 'Confirm CHA payout vault (= TGNw 0xc081…?)', status: 'CLOSED',
      note: 'VERIFIED read-only from three project refs that AGREE: seas-watcher.cjs JOB_VAULTS[6]=0xc081…b1B4 ("CHA TGNw (market)"); jobs/index.html cha.vault=0xc081…b1B4 ("Barter & haggle, market square"); and JOB_LADDERS[6].vault here. Job 6 = Barter at Market (CHA), ids 601-606. No on-chain probing.' },
    { n: 4, item: 'Lock final rung names/titles', status: 'CLOSED',
      note: 'All 60 names mirror the locked registration scripts verbatim.' },
    { n: 5, item: 'Tier pools funded enough that 1% is non-dust', status: 'DEFERRED',
      note: 'NON-BLOCKING fire-time courtesy, NOT a catalog gate. A poolBalance>0 check belongs to the founder-gated --live keeper at send time; BPS_OF_POOL reverts gracefully on an empty pool, so an unfunded pool is a UX nicety, never a safety risk. This game layer is read-only and sends nothing, so it cannot (and must not fake) an on-chain balance read -- deferred to the keeper by design.' },
  ];

  // ── storage (localStorage in the browser; in-memory fallback for Node / private mode) ──
  function makeStore() {
    try {
      if (root.localStorage) {
        var ls = root.localStorage;
        return {
          get: function (k) { var v = ls.getItem(k); return v ? JSON.parse(v) : null; },
          set: function (k, v) { ls.setItem(k, JSON.stringify(v)); },
          del: function (k) { ls.removeItem(k); },
        };
      }
    } catch (e) { /* fall through to memory */ }
    var mem = {};
    return {
      get: function (k) { return mem[k] ? JSON.parse(mem[k]) : null; },
      set: function (k, v) { mem[k] = JSON.stringify(v); },
      del: function (k) { delete mem[k]; },
    };
  }
  var store = makeStore();

  function blank() { return { trophies: {}, bestRunByJob: {}, distinctJobs: [], claimsAck: {}, updatedAt: 0 }; }
  function loadState(crewId) {
    var s = store.get(STORE_PREFIX + crewId);
    if (!s || typeof s !== 'object') return blank();
    s.trophies = s.trophies || {}; s.bestRunByJob = s.bestRunByJob || {};
    s.distinctJobs = s.distinctJobs || []; s.claimsAck = s.claimsAck || {};
    return s;
  }
  function saveState(crewId, s) { s.updatedAt = nowSec(); store.set(STORE_PREFIX + crewId, s); }

  // ── small helpers ──
  function nowSec() { return Math.floor(Date.now() / 1000); }
  function clampPct(n) { return Math.max(0, Math.min(100, n)); }
  function jobNumFor(record) {
    if (!record) return null;
    if (record.job != null && JOBKEY_TO_NUM[record.job] != null) return JOBKEY_TO_NUM[record.job];
    if (record.jobVault) { var n = VAULT_TO_NUM[String(record.jobVault).toLowerCase()]; if (n != null) return n; }
    return null;
  }
  function runSecsFor(record, ts) {
    if (!record || !record.startedAt) return 0;
    return Math.max(0, (ts || nowSec()) - Number(record.startedAt));
  }
  function emitAward(crewId, ach) {
    try {
      if (root.dispatchEvent && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('seas:quest-award', { detail: { crewId: crewId, achievement: ach } }));
      }
    } catch (e) { /* non-fatal: awards still bank to the store */ }
  }
  function fmtDuration(secs) {
    secs = Math.max(0, Math.floor(secs || 0));
    var d = Math.floor(secs / DAY);
    if (d >= 365) { var y = (d / 365); return (Math.round(y * 10) / 10) + 'y'; }
    if (d >= 1) { var h0 = Math.floor((secs % DAY) / 3600); return d + 'd' + (h0 ? ' ' + h0 + 'h' : ''); }
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    return h ? (h + 'h ' + m + 'm') : (m + 'm');
  }

  // ── THE WATCHER: fold a live work observation into per-pawn progress, banking trophies. ──
  // record = an employment.js cache record (or any { job|jobVault, startedAt }), or null when free.
  // Returns { state, newlyEarned:[ach…] }. Pure w.r.t. the chain — reads the run, writes localStorage.
  function foldObservation(crewId, record, ts) {
    ts = ts || nowSec();
    var s = loadState(crewId);
    var newly = [];
    function bank(id) {
      if (s.trophies[id]) return;
      s.trophies[id] = { at: ts };
      var ach = BY_ID[id];
      if (ach) { newly.push(ach); emitAward(crewId, ach); }
    }

    var jobNum = jobNumFor(record);
    if (jobNum != null) {
      var L = JOB_LADDERS[jobNum];
      var run = runSecsFor(record, ts);
      // best continuous run ever seen at this job (so a trophy never un-banks if a run is mid-flight)
      var prevBest = s.bestRunByJob[L.jobKey] || 0;
      if (run > prevBest) s.bestRunByJob[L.jobKey] = run;
      var bestRun = s.bestRunByJob[L.jobKey];
      // distinct jobs worked (versatility signal — genuine: the pawn really worked this trade)
      if (s.distinctJobs.indexOf(L.jobKey) < 0) s.distinctJobs.push(L.jobKey);
      // bank every job rung the current continuous run has cleared
      RUNGS.forEach(function (r) { if (bestRun >= r.secs) bank(jobNum * 100 + r.rung); });
    }

    // versatility (900): bank by distinct-jobs count
    var distinct = s.distinctJobs.length;
    RUNGS.forEach(function (r, i) { if (distinct >= SHIP_LADDERS[900].counts[i]) bank(900 + r.rung); });

    // loyalty(700)/seadog(800): NO in-game ship-allegiance signal yet — intentionally NOT banked.
    // (Mirrors seas-watcher.cjs SHIP-LADDER GAP: needs continuous-crewing + per-ship-allegiance events.)

    saveState(crewId, s);
    return { state: s, newlyEarned: newly };
  }

  // ── build the board model (read-only): merges banked trophies + the LIVE run/variety view. ──
  function buildModel(crewId, record, ts) {
    ts = ts || nowSec();
    var s = loadState(crewId);
    var liveJobNum = jobNumFor(record);
    var liveRun = liveJobNum != null ? runSecsFor(record, ts) : 0;
    var distinct = s.distinctJobs.length;

    function jobRungView(jobNum) {
      var L = JOB_LADDERS[jobNum];
      var isLive = (jobNum === liveJobNum);
      var bestRun = Math.max(s.bestRunByJob[L.jobKey] || 0, isLive ? liveRun : 0);
      var nextFound = false, rungs = RUNGS.map(function (r) {
        var id = jobNum * 100 + r.rung;
        var banked = !!s.trophies[id];
        var reached = banked || bestRun >= r.secs;
        var pct = reached ? 100 : clampPct(bestRun / r.secs * 100);
        var isNext = !reached && !nextFound; if (isNext) nextFound = true;
        return { id: id, name: L.names[r.rung - 1], rungLabel: r.label, tier: r.tier, tierLabel: TIER_LABEL[r.tier],
          tierTag: POOLS[r.tier].tag, pool: POOLS[r.tier].addr, threshold: r.secs, thresholdLabel: r.label,
          reached: reached, banked: banked, isNext: isNext, pct: pct, progressLabel: fmtDuration(bestRun) + ' / ' + r.label };
      });
      return { id: jobNum, kind: 'JOB', key: L.jobKey, stat: L.stat, group: L.group, emoji: L.emoji,
        metric: 'jobRun', live: isLive, liveRunSecs: isLive ? liveRun : 0, bestRunSecs: bestRun, rungs: rungs };
    }

    function shipRungView(series) {
      var S = SHIP_LADDERS[series];
      var variety = (S.metric === 'jobVariety');
      var nextFound = false, rungs = RUNGS.map(function (r, i) {
        var id = series + r.rung;
        var banked = !!s.trophies[id];
        var reached, pct, threshLabel;
        if (variety) {
          var need = S.counts[i];
          reached = banked || distinct >= need;
          pct = reached ? 100 : clampPct(distinct / need * 100);
          threshLabel = need + ' trades';
        } else {
          // loyalty/seadog: no ship-time source in-game yet → pending (never falsely "reached")
          reached = banked; pct = banked ? 100 : 0; threshLabel = r.label;
        }
        var isNext = !reached && !nextFound; if (isNext) nextFound = true;
        return { id: id, name: S.names[i], rungLabel: r.label, tier: r.tier, tierLabel: TIER_LABEL[r.tier],
          tierTag: POOLS[r.tier].tag, pool: POOLS[r.tier].addr, threshold: variety ? S.counts[i] : r.secs,
          thresholdLabel: threshLabel, reached: reached, banked: banked, isNext: isNext, pct: pct,
          progressLabel: variety ? (distinct + ' / ' + S.counts[i] + ' trades') : 'awaiting sail logs' };
      });
      return { id: series, kind: 'SHIP', key: S.key, group: S.group, emoji: S.emoji, metric: S.metric,
        pending: !variety, rungs: rungs };
    }

    var ladders = JOB_ORDER.map(jobRungView).concat(SHIP_ORDER.map(shipRungView));

    var trophies = Object.keys(s.trophies).map(function (id) {
      var a = BY_ID[id]; if (!a) return null;
      return { id: a.id, name: a.name, group: a.group, tier: a.tier, tierLabel: TIER_LABEL[a.tier],
        at: s.trophies[id].at, acked: !!s.claimsAck[id] };
    }).filter(Boolean).sort(function (a, b) { return (b.at || 0) - (a.at || 0); });

    var live = null;
    if (liveJobNum != null) {
      var LL = JOB_LADDERS[liveJobNum];
      var lv = jobRungView(liveJobNum);
      var next = lv.rungs.filter(function (x) { return !x.reached; })[0] || null;
      live = { jobNum: liveJobNum, jobKey: LL.jobKey, group: LL.group, emoji: LL.emoji, runSecs: liveRun,
        runLabel: fmtDuration(liveRun), next: next };
    }

    return {
      crewId: crewId, live: live, ladders: ladders, trophies: trophies, distinctJobs: s.distinctJobs.slice(),
      gaps: [
        'Loyalty (700) + Sea Dog (800) need continuous ship-crewing + per-ship allegiance events — the harbor isn’t logging ship-time yet (same gap the on-chain watcher flags). Versatility (900) is tracked from the trades you’ve worked.',
      ],
    };
  }

  // ── public API ───────────────────────────────────────────────────────────────
  // ── CATALOG AUDIT (read-only): prove the 60-rung catalog is COMPLETE + internally CONSISTENT.
  //    Pure — no chain, no store. Mirrors register-achievements.cjs (54) + register-guard-ladder.cjs (6).
  function catalogAudit() {
    var problems = [];
    var ids = ACHIEVEMENTS.map(function (a) { return a.id; });
    var idsUnique = (new Set(ids)).size === ids.length;
    if (!idsUnique) problems.push('duplicate achievement ids');
    var jobs = ACHIEVEMENTS.filter(function (a) { return a.kind === 'JOB'; }).length;
    var ships = ACHIEVEMENTS.filter(function (a) { return a.kind === 'SHIP'; }).length;
    if (ACHIEVEMENTS.length !== 60) problems.push('expected 60 rungs, got ' + ACHIEVEMENTS.length);
    if (jobs !== 42) problems.push('expected 42 job rungs (7x6), got ' + jobs);
    if (ships !== 18) problems.push('expected 18 ship rungs (3x6), got ' + ships);
    // each job ladder + ship series carries exactly its six rungs.
    JOB_ORDER.forEach(function (n) {
      var c = ACHIEVEMENTS.filter(function (a) { return a.kind === 'JOB' && a.ladderId === n; }).length;
      if (c !== 6) problems.push('job ladder ' + n + ' has ' + c + ' rungs (expected 6)');
    });
    SHIP_ORDER.forEach(function (s) {
      var c = ACHIEVEMENTS.filter(function (a) { return a.kind === 'SHIP' && a.ladderId === s; }).length;
      if (c !== 6) problems.push('ship ladder ' + s + ' has ' + c + ' rungs (expected 6)');
    });
    // every rung: pool addr + tierTag resolve, and thresholds are the LOCKED values.
    ACHIEVEMENTS.forEach(function (a) {
      var P = POOLS[a.tier];
      if (!P) { problems.push('rung ' + a.id + ' has unknown tier ' + a.tier); return; }
      if (a.pool !== P.addr) problems.push('rung ' + a.id + ' pool addr mismatch');
      if (a.tierTag !== P.tag) problems.push('rung ' + a.id + ' tierTag mismatch');
      if (a.metric === 'jobVariety') {
        if (a.thresholdCount !== SHIP_LADDERS[900].counts[a.rung - 1]) problems.push('rung ' + a.id + ' thresholdCount mismatch');
      } else if (a.thresholdSecs !== RUNGS[a.rung - 1].secs) {
        problems.push('rung ' + a.id + ' thresholdSecs mismatch');
      }
    });
    // Loyalty (700) + Sea Dog (800): time-metric, but no in-game allegiance signal exists yet (mirrors
    // the on-chain seas-watcher SHIP-LADDER GAP). These 12 rungs are DEFINED + consistent but honestly
    // PENDING — a documented, intentional state owned by the chain-event layer, NOT a catalog defect.
    return {
      complete: ACHIEVEMENTS.length === 60 && jobs === 42 && ships === 18,
      consistent: problems.length === 0,
      total: ACHIEVEMENTS.length, jobs: jobs, ships: ships, idsUnique: idsUnique,
      sources: { 'register-achievements.cjs': 54, 'register-guard-ladder.cjs': 6 },
      shipTimeLaddersPending: ['loyaltyTime', 'mercTime'],
      registersOnChain: false,
      problems: problems,
    };
  }

  var QuestLadder = {
    VERSION: '1.0.0-phase1',
    POOLS: POOLS, RUNGS: RUNGS, JOB_LADDERS: JOB_LADDERS, SHIP_LADDERS: SHIP_LADDERS,
    JOB_ORDER: JOB_ORDER, SHIP_ORDER: SHIP_ORDER, ACHIEVEMENTS: ACHIEVEMENTS, OPEN_ITEMS: OPEN_ITEMS,
    TIER_LABEL: TIER_LABEL,

    byId: function (id) { return BY_ID[id] || null; },
    catalogAudit: catalogAudit,
    jobNumFor: jobNumFor,
    runSecsFor: runSecsFor,
    fmtDuration: fmtDuration,

    /** WATCH: fold a live employment record (or null) into per-pawn progress, banking trophies.
     *  Returns { state, newlyEarned:[ach…] }. No chain writes. */
    observe: function (crewId, record, ts) {
      if (!crewId) return { state: blank(), newlyEarned: [] };
      return foldObservation(crewId, record, ts);
    },

    /** READ: the full board model for a pawn (banked trophies + live run/variety). No banking. */
    progressFor: function (crewId, record, ts) { return buildModel(crewId, record || null, ts); },

    /** Convenience: observe THEN return the fresh model (what the board calls after a refresh). */
    update: function (crewId, record, ts) { foldObservation(crewId, record, ts); return buildModel(crewId, record || null, ts); },

    /** Banked trophies for a pawn (sorted newest-first). */
    trophiesFor: function (crewId) { return buildModel(crewId, null).trophies; },

    /** LOCAL acknowledgement that the player has SEEN a trophy. This is NOT an on-chain claim and
     *  sends nothing — the real prize claim is a separate, founder-gated, player-signed step. */
    ackClaim: function (crewId, id) {
      var s = loadState(crewId); if (!s.trophies[id]) return false;
      s.claimsAck[id] = nowSec(); saveState(crewId, s); return true;
    },

    /** Registration-readiness summary (closed / deferred / still-open founder gates). Doc only. */
    readiness: function () {
      var open = OPEN_ITEMS.filter(function (o) { return o.status === 'OPEN'; }).length;
      var deferred = OPEN_ITEMS.filter(function (o) { return o.status === 'DEFERRED'; }).length;
      var closed = OPEN_ITEMS.filter(function (o) { return o.status === 'CLOSED'; }).length;
      return { total: OPEN_ITEMS.length, open: open, deferred: deferred, closed: closed, blocking: open,
        registered: false, registersOnChain: false, items: OPEN_ITEMS,
        achievements: ACHIEVEMENTS.length, audit: catalogAudit() };
    },

    /** Inject a store (tests). */
    setStore: function (s) { if (s && s.get && s.set) store = s; },
    /** Clear one pawn's progress (QA/dev only). */
    reset: function (crewId) { try { store.del(STORE_PREFIX + crewId); } catch (e) { if (root.console) root.console.warn('QuestLadder.reset failed:', e && e.message); } },
  };

  // ── live game-event bridge: auto-observe whenever employment.js refreshes a pawn's run. ──
  // (employment.js dispatches 'seas:employment' with { crewId, rec } after a refresh — additive hook.)
  try {
    if (root.addEventListener) {
      root.addEventListener('seas:employment', function (ev) {
        var d = ev && ev.detail; if (d && d.crewId) foldObservation(d.crewId, d.rec || null);
      });
    }
  } catch (e) { /* non-DOM host (Node): the bridge is simply inert */ }

  root.QuestLadder = QuestLadder;
  if (typeof module !== 'undefined' && module.exports) module.exports = QuestLadder;
})(typeof window !== 'undefined' ? window : this);
