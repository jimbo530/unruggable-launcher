#!/usr/bin/env node
/*
  build-water-levels.cjs — READ-ONLY snapshot builder for the WATER→stats system.
  Vaults are ADD-ONLY (water only goes up), so a cached snapshot is never too-high — only
  slightly stale-low. This reads each pawn's water held and writes game/seas/water-levels.json
  = { "<collection>:<tokenId>": <endowmentMap> } (only watered pawns; absent = level 0).
  The game (tavern/crew/units.js) reads the JSON + class-engine resolve → level/stats/class.
  NO txs, no keys. Run periodically (daily cron). See project_seas_stat_levels memory.

    node game/seas/build-water-levels.cjs            # write the snapshot
*/
'use strict';
const fs = require('fs'); const path = require('path');
const { ethers } = require('ethers');

const RPC = process.env.KEEPER_RPC || 'https://mainnet.base.org';
const OUT = process.env.WATER_LEVELS_OUT || path.join(__dirname, 'water-levels.json'); // VPS cron → live web path

// The 4 crew collections (pawns). 100 ids each (FeeShareDistributor).
const CREWS = [
  '0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f', // Black Tide (Orc)
  '0x9500880DEC9B310b4a728C75A271a25615A2443E', // Sol del Mar (Elf)
  '0x4ECe491951B759363bCBAF75389a202Fe0584080', // Redrum (Goblin)
  '0x8C1f935F6DbB17d593BF3EC8114A2f045e350545', // Harbor Guard (Human)
];
const MAX_ID = 99;

// vault → endowment key (class-engine cause id, or "_diffuse" for plain water). treeWater = USDC(6dec)=$.
//
// GLOBAL vaults apply to EVERY crew collection (e.g. the one generic WATER vault). DIFFUSE vaults
// (key '_diffuse') spread 1/6 across all six stats; the resolver SUMS every '_diffuse' contribution
// into one diffuse total (see resolver.normalizeEndowment), so listing more than one diffuse source
// here just adds into the same pool — no resolver change needed. Cause vaults (single-stat) can be
// appended with their cause id as the key as they're confirmed live.
const VAULTS = [
  { addr: '0x9789c459f08896148E8D1a8b2B7a4Bb95FAAf8B2', key: '_diffuse', dec: 6 },
];

// ⛔ ECONOMY WATERS — NEVER ADD TO VAULTS OR ROW_VAULTS (founder rule 2026-06-30).
// FISHw 0x37be8d2137c084f4ec0c23aE9C34f9b87e79F01F and CRABw 0xcF1db6430FAeb0D93104D5c39b4681F9Bb17a1F7
// are FISHING/CRABBING ENDOWMENT vaults — pure economy flow (yield→GOLD→keeper buys fish/crab + moves
// them to markets). Their trees sit on SYSTEM-treasury pawns (Black Tide #98 = CRAB, #99 = FISH), which
// are dedicated non-player seats, NOT crew the engine levels. A player NEVER holds economy water as a
// STAT. Likewise the coin/prize/job/mill waters (COPPER/SILVER/GOLD/SALT/RATIONS/etc., the STR/DEX/CON/
// INT/WIS/CHA *job* vaults, the MayorVault flow vault 0x44c5…, mill lumber water) are NOT stat sources.
// ONLY the generic WATER vault (above) + the per-ship ROW vaults (below) are diffuse stat-level inputs.
// If you ever need a single-stat CAUSE vault, add it to VAULTS with its cause id as the key — never an
// economy water. Do not regress this: economy waters in VAULTS would mis-level every system-seat pawn.

// PER-SHIP ROW WATER (founder 2026-06-30): each ship's crew collection has its OWN "row" WaterV2
// vault whose PRINCIPAL counts as DIFFUSE level too — i.e. row water spreads 1/6 to every stat,
// exactly like the generic WATER vault. A pawn's _diffuse endowment is therefore the SUM of its
// principal in the generic vault PLUS its principal in its OWN ship's row vault (so $1 in 0x9789 +
// $1 in the row vault → _diffuse 2 → +2/6 = +1/3 to every stat). The row vault ALSO flows 50/50
// (its own WaterV2 behavior) — that is NOT the class-engine's concern; we only read the principal.
//
// Map keyed by crew collection (the ship) → its row vault. Same shape as VAULTS entries. EXTENSIBLE:
// add a ship's row vault here once its address is confirmed live on-chain. Collections NOT listed
// have no row vault (backward-compatible: they read the generic vault only, unchanged).
//
//   IMPORTANT: leave a collection OUT (or commented) until its row vault is verified live on-chain.
//   A wrong/undeployed address would make treeIdFor revert and FAIL the snapshot LOUDLY (by design —
//   we never want a silent mis-level), so do NOT paste unconfirmed placeholders here.
//
// VERIFIED LIVE WaterV2 on Base (code present + treeIdFor(coll,0) returns without reverting), 2026-06-30:
//   • Black Tide   → BTRow 0x9D24991AAb7850bc98cC2D74763afbD00EB15B87 (inventory: waterv2-btrow-deployment.json)
//   • Redrum       → 0x58E017369D36eB43688a331FaCA9664cee802130
//   • Harbor Guard → 0xA71Acb46924afeda08ad86D9B20D7AE8d52572DF
//   • Sol del Mar  → NO row vault found (none deployed / none in inventory). Reads generic vault only,
//                    unchanged — add here if/when one is deployed + verified. (See SKIP log at runtime.)
const ROW_VAULTS = {
  '0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f': { addr: '0x9D24991AAb7850bc98cC2D74763afbD00EB15B87', key: '_diffuse', dec: 6 }, // Black Tide row (BTRow)
  '0x4ECe491951B759363bCBAF75389a202Fe0584080': { addr: '0x58E017369D36eB43688a331FaCA9664cee802130', key: '_diffuse', dec: 6 }, // Redrum row
  '0x8C1f935F6DbB17d593BF3EC8114A2f045e350545': { addr: '0xA71Acb46924afeda08ad86D9B20D7AE8d52572DF', key: '_diffuse', dec: 6 }, // Harbor Guard row
  // Sol del Mar (0x9500…443E): no row vault deployed — intentionally absent (generic vault only).
};

const WATER_ABI = [
  'function treeIdFor(address collection, uint256 tokenId) view returns (uint256)', // treeId+1 (0 = none)
  'function treeWater(uint256 treeId) view returns (uint256)',
];

const provider = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function tryRead(fn, label) {
  for (let i = 1; i <= 4; i++) { try { return await fn(); } catch (e) { if (i === 4) throw new Error(`${label} failed: ${e.shortMessage || e.message}`); await sleep(400 * i); } }
}

/**
 * Pre-flight: confirm each configured ROW vault is a LIVE WaterV2 (has code AND treeIdFor doesn't
 * revert) BEFORE we sweep. Per the founder rule, a dead/wrong row vault is SKIPPED with a LOUD log —
 * never silently included (which would mis-level) and never silently dropped. Returns a NEW map
 * holding only the verified-live row vaults. Crews with no configured row vault are logged too.
 */
async function liveRowVaults() {
  const live = {};
  for (const coll of CREWS) {
    const rv = ROW_VAULTS[coll];
    if (!rv) { console.log(`[water-levels] ${coll}: no row vault configured — generic WATER only (OK).`); continue; }
    const code = await tryRead(() => provider.getCode(rv.addr), `getCode ${rv.addr}`);
    if (code === '0x') { console.warn(`[water-levels] SKIP row vault ${rv.addr} for ${coll}: NO CONTRACT (code 0x) — NOT live. Generic WATER only for this crew; FIX the address.`); continue; }
    try {
      await provider.call({ to: rv.addr, data: new ethers.Interface(WATER_ABI).encodeFunctionData('treeIdFor', [coll, 0]) });
    } catch (e) {
      console.warn(`[water-levels] SKIP row vault ${rv.addr} for ${coll}: treeIdFor REVERTED (${e.shortMessage || e.message}) — not a WaterV2. Generic WATER only for this crew; FIX the address.`);
      continue;
    }
    live[coll] = rv;
    console.log(`[water-levels] row vault LIVE for ${coll}: ${rv.addr} (counts as _diffuse, summed with generic WATER).`);
  }
  return live;
}

(async () => {
  const net = await provider.getNetwork(); if (Number(net.chainId) !== 8453) throw new Error('wrong chain');
  const head = await provider.getBlockNumber();
  const snapshot = {};
  let watered = 0, checked = 0;
  const allVaultAddrs = new Set(VAULTS.map(v => v.addr));
  const rowVaults = await liveRowVaults(); // only verified-live row vaults are summed

  for (const coll of CREWS) {
    // Vaults to read for THIS collection: the GLOBAL vaults (generic WATER + any cause vaults)
    // PLUS this ship's OWN row vault, if one is configured AND verified live. Multiple '_diffuse'
    // entries all sum into the same diffuse pool downstream (resolver.normalizeEndowment), so a pawn
    // ends up with _diffuse = generic principal + its row principal — no resolver change needed.
    const collVaults = rowVaults[coll] ? [...VAULTS, rowVaults[coll]] : VAULTS;
    for (const v of collVaults) {
      allVaultAddrs.add(v.addr);
      const vault = new ethers.Contract(v.addr, WATER_ABI, provider);
      // batch the id sweep for speed
      for (let base = 0; base <= MAX_ID; base += 10) {
        const ids = []; for (let i = base; i < base + 10 && i <= MAX_ID; i++) ids.push(i);
        const treeIds = await Promise.all(ids.map(id => tryRead(() => vault.treeIdFor(coll, id), `treeIdFor ${coll}:${id}`)));
        for (let j = 0; j < ids.length; j++) {
          checked++;
          const raw = treeIds[j];
          if (raw === 0n) continue;                       // not planted in this vault → 0 contribution
          const held = await tryRead(() => vault.treeWater(raw - 1n), `treeWater ${coll}:${ids[j]}`);
          const usd = Number(ethers.formatUnits(held, v.dec));
          if (usd <= 0) continue;
          const crewId = `${coll}:${ids[j]}`;
          (snapshot[crewId] || (snapshot[crewId] = {}))[v.key] = (snapshot[crewId][v.key] || 0) + usd;
          watered++;
        }
      }
    }
  }

  const out = { _meta: { builtAtBlock: head, chain: 'base', vaults: [...allVaultAddrs], note: 'water-driven levels; $1=1 level; absent crewId = level 0; _diffuse sums generic WATER + per-ship row vault' }, endowments: snapshot };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`[water-levels] checked ${checked} pawn-slots across ${allVaultAddrs.size} vault(s) (${VAULTS.length} global + ${Object.keys(rowVaults).length} live row) → ${watered} watered entries. wrote ${OUT}`);
})().catch(e => { console.error('[water-levels] FATAL:', e.message); process.exit(1); });
