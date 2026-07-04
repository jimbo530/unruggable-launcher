/*
  seas-config.js — SEIZE THE SEAS · SHARED CONFIG (single source of truth for the CLASSIC-script world).

  WHY THIS EXISTS
  ---------------
  The same job→vault→stat mapping used to be hand-copied into employment.js (VAULT_TO_KEY) and
  quest-ladder.js (JOB_LADDERS[n].vault/.stat), and the crew species list lived only in a CSV with no
  shared JS constant. Copies drift. This module is the ONE definition; both files now derive from it, so
  a vault address can never silently disagree between the JobClock reader and the Quest Ladder.

  SCOPE (module-system reality — read before adding ship data here)
  ----------------------------------------------------------------
  This is a CLASSIC UMD script: it attaches window.SeasConfig for <script src> pages AND sets
  module.exports for Node/require(). It is loaded by employment.js + quest-ladder.js (both classic).
  SHIP hull data is NOT duplicated here on purpose: the ship catalog is consumed by ES-module code
  (game/lib/ship-catalog.js, imported by shipyard/store.html and game/seas/boat-craft.js as `import`).
  A file that carries `export` cannot also load as a classic <script src>, so the ship ladder stays the
  single source in game/lib/ship-catalog.js (boat-craft.js imports it — no more mirrored price table).

  LOADING
  -------
  • Browser (classic): <script src=".../config/seas-config.js"></script> BEFORE employment.js /
    quest-ladder.js. Exposes window.SeasConfig.
  • Node: require('./config/seas-config.js') (module.exports === SeasConfig). Used by the smoke test.

  ADDRESS PROVENANCE (verified byte-identical, read-only — no chain probing):
    Job vaults mirror THREE agreeing project refs — jobs/index.html JOBS, seas-watcher.cjs JOB_VAULTS,
    and the (now-derived) quest-ladder.js JOB_LADDERS. Checksummed exactly as those sources carry them.
*/
(function (root) {
  'use strict';

  // ── JOBS: the 7 Seas jobs, in canonical order. { jobKey, stat, vault }.
  //    vault = the on-chain WaterV2 stat vault (Base 8453) the JobClock employs a pawn against.
  //    THIS is the single source — employment.js and quest-ladder.js both read it.
  var JOBS = [
    { jobKey: 'str',   stat: 'STR',   vault: '0xD6D793628dc6Eed71EB37dd6c51678E8a9c25f22' }, // Haul Cargo
    { jobKey: 'dex',   stat: 'DEX',   vault: '0xb303c91724485462e3450A0Bd4513a521df997cB' }, // Mend the Nets
    { jobKey: 'con',   stat: 'CON',   vault: '0x893531A85f249cC38Da772be9056762E188302F6' }, // Stock the Rations
    { jobKey: 'int',   stat: 'INT',   vault: '0x90B54DA4Ac020fB163C51237e169FecEaC2369be' }, // Tend the Beacon
    { jobKey: 'wis',   stat: 'WIS',   vault: '0x8C121fC0171944C3EA40d14FE549dFf7107BDf39' }, // Sea-Rites
    { jobKey: 'cha',   stat: 'CHA',   vault: '0xc0813524820df5C6bb9a63a521fE218ff974b1B4' }, // Barter at Market
    { jobKey: 'guard', stat: 'GUARD', vault: '0x44c504Ce08635536635f153B6Ae5d9D6d8b3131F' }, // Guard the Port
  ];

  // ── derived lookups (built once from JOBS so they cannot drift from it) ──
  var VAULT_TO_KEY = {}; // lowercased vault address → jobKey (employment.js does vault.toLowerCase() lookups)
  var KEY_TO_VAULT = {}; // jobKey → checksummed vault (quest-ladder.js stores the checksummed form)
  var KEY_TO_STAT  = {}; // jobKey → stat label
  JOBS.forEach(function (j) {
    VAULT_TO_KEY[j.vault.toLowerCase()] = j.jobKey;
    KEY_TO_VAULT[j.jobKey] = j.vault;
    KEY_TO_STAT[j.jobKey]  = j.stat;
  });

  // ── SPECIES: the crew species every hiring hall sells (mirror of hiring-halls.csv, same order).
  //    One constant so UI, hall data, and docs agree. Specialized-town species come later.
  var SPECIES = ['human', 'elf', 'dwarf', 'orc', 'dragonborn', 'goblin'];

  var SeasConfig = {
    JOBS: JOBS,
    VAULT_TO_KEY: VAULT_TO_KEY,
    KEY_TO_VAULT: KEY_TO_VAULT,
    KEY_TO_STAT: KEY_TO_STAT,
    SPECIES: SPECIES,
  };

  root.SeasConfig = SeasConfig;
  if (typeof module !== 'undefined' && module.exports) module.exports = SeasConfig;
})(typeof window !== 'undefined' ? window : this);
