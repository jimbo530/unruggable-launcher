#!/usr/bin/env node
'use strict';
/**
 * pawns.js — report the pawns UNDER THE CITIZEN'S COMMAND + where they sit + what they earn.
 *
 * Pawn ownership model (same as the live crew page, game/seas/crew/index.html): pawns are crew
 * NFTs spread across per-ship "distributor" contracts; crewId = "<distributor>:<tokenId>". We read
 * holdings LIVE via the Alchemy NFT API getNFTsForOwner — the chain is the only source of truth.
 *
 * COMMAND ≠ same wallet: the Citizen holds "the con of the Guards of the Port" — it COMMANDS the
 * Harbor Guard crew, but those Guard pawns currently sit in the AGENT TREASURY wallet (0xE2a4…),
 * NOT the Citizen's dedicated wallet. So this tool scans a CONFIGURABLE SET of wallets and labels
 * which wallet holds each pawn + the command role. READ-ONLY — it NEVER moves a pawn (transfers
 * are a founder-gated decision the coordinator handles).
 *
 *   node citizen/tools/pawns.js                 # default command set (Citizen wallet + Guard treasury)
 *   node citizen/tools/pawns.js --full           # include the full per-pawn roster (large)
 *   node citizen/tools/pawns.js 0xWALLET ...     # report specific wallets instead
 *   CITIZEN_COMMAND_WALLETS=0xA,0xB node ...      # extend the default set via env
 */
const { ethers } = require('ethers');
const chain = require('../lib/chain.js');
const seas = require('../lib/seas-api.js');
const gs = require('../../gap-scan.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

const TREASURY = '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10'; // shared agent treasury — holds the Guard crew
const ALCHEMY_NFT_BASE = 'https://base-mainnet.g.alchemy.com/nft/v3/R0jSMqs90q_KV85ytn45H';

// The four ship crew distributors (from game/seas/crew/index.html — the live roster source).
const SHIPS = [
  { name: 'The Black Tide', dist: '0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f', species: 'Orc',    token: 'BLACKTIDE' },
  { name: 'Sol del Mar',    dist: '0x9500880DEC9B310b4a728C75A271a25615A2443E', species: 'Elf',    token: 'SOLM' },
  { name: 'Redrum Raiders', dist: '0x4ECe491951B759363bCBAF75389a202Fe0584080', species: 'Goblin', token: 'REDRUM' },
  { name: 'Harbor Guard',   dist: '0x8C1f935F6DbB17d593BF3EC8114A2f045e350545', species: 'Human',  token: 'GUARD' },
];
const distMeta = (c) => SHIPS.find((s) => s.dist.toLowerCase() === String(c).toLowerCase()) || null;

// What the Guard crew earns — the cbBTC Guard ladder (memory: prize pool / Guard endowment).
const GUARD_LADup = {
  ladder: 'Guard-the-Port (cbBTC) — registered achievement ids 1001–1006',
  cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  guardEndowmentVault: '0x44c504ce08635536635f153b6ae5d9d6d8b3131f',
  pool: 'cbBTC Mayor pool (CourtEndowment)',
};

/** getNFTsForOwner across the four ship distributors. THROWS on a bad response (never silent). */
async function fetchOwnedCrew(owner) {
  const contracts = SHIPS.map((s) => `contractAddresses[]=${s.dist}`).join('&');
  const base = `${ALCHEMY_NFT_BASE}/getNFTsForOwner?owner=${owner}&${contracts}&withMetadata=false&pageSize=100`;
  const out_ = [];
  let pageKey = null, guard = 0;
  do {
    const res = await fetch(base + (pageKey ? `&pageKey=${encodeURIComponent(pageKey)}` : ''));
    if (!res.ok) throw new Error(`Alchemy getNFTsForOwner HTTP ${res.status} for ${owner}`);
    const data = await res.json();
    for (const n of (data.ownedNfts || [])) out_.push({ contract: n.contractAddress, tokenId: String(n.tokenId) });
    pageKey = data.pageKey || null;
  } while (pageKey && ++guard < 25);
  return out_;
}

function toPawn(o, heldBy, role) {
  const meta = distMeta(o.contract);
  const dist = meta ? meta.dist : o.contract;
  return {
    crewId: dist + ':' + o.tokenId,
    ship: meta ? meta.name : 'unknown',
    species: meta ? meta.species : '',
    token: meta ? meta.token : 'CREW',
    tokenId: o.tokenId,
    distributor: dist,
    heldBy, commandRole: role,
  };
}

(async () => {
  const full = process.argv.includes('--full'); // include the full per-pawn roster (large)
  // Build the command set: explicit CLI wallets override; else default = Citizen + Guard treasury.
  const cli = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
  const citizen = chain.walletAddress();
  let set;
  if (cli.length) {
    set = cli.map((w) => ({ wallet: ethers.getAddress(w), role: 'queried' }));
  } else {
    set = [];
    if (citizen) set.push({ wallet: citizen, role: 'own', label: "Citizen's own pawns (dedicated wallet)" });
    set.push({ wallet: ethers.getAddress(TREASURY), role: 'guard-command', label: 'Harbor Guard — commanded by the Citizen; held in the agent treasury' });
    for (const w of (process.env.CITIZEN_COMMAND_WALLETS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (/^0x[0-9a-fA-F]{40}$/.test(w)) set.push({ wallet: ethers.getAddress(w), role: 'queried' });
    }
  }

  const command = [];
  let total = 0;
  for (const entry of set) {
    let pawns = [], error = null;
    try { pawns = (await fetchOwnedCrew(entry.wallet)).map((o) => toPawn(o, entry.wallet, entry.role)); }
    catch (e) { error = e.message; }
    const loc = await seas.location(entry.wallet).catch((e) => ({ ok: false, error: e.message }));
    const byShip = {};
    for (const p of pawns) byShip[p.ship] = (byShip[p.ship] || 0) + 1;
    total += pawns.length;
    command.push({
      ...entry,
      location: loc && loc.location !== undefined ? loc : { note: 'no server location (non-player wallet or server unreachable)' },
      pawnCount: pawns.length, byShip,
      sampleCrewIds: pawns.slice(0, 3).map((p) => p.crewId),
      pawns: full ? pawns : undefined,   // omit the heavy roster unless --full
      error,
    });
  }

  out({
    ok: true, tool: 'pawns', citizenWallet: citizen, totalPawnsUnderCommand: total,
    rosterIncluded: full ? 'full' : 'summary (pass --full for every pawn)',
    command,
    guardLadder: GUARD_LADup,
    statsSource: 'class-engine derives D&D stats (STR/DEX/CON/INT/WIS/CHA, HP) from each pawn\'s earned endowment; full on-chain stat decode per crewId is TODO (game uses crew/render + class-engine)',
    todo: [
      'decode per-pawn stats/level on-chain via the class-engine endowment (not just default Deckhand)',
      'map each commanded pawn to its current ship + sea location through the rules server',
      'read live Guard-ladder (cbBTC ids 1001-1006) accrual per Guard pawn',
    ],
    note: 'READ-ONLY command picture. Pawns are NOT moved — any transfer is a founder-gated on-chain decision.',
  });
})().catch((e) => { out({ ok: false, tool: 'pawns', error: e.message }); process.exit(1); });
