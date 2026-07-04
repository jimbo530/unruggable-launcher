// ============================================================
//  build-achievements-catalog.cjs — generate achievements-catalog.json for the Seas
//  achievement-list PAGE. PURE DATA / PRESENTATION — touches NO chain, registers nothing.
//
//  It mirrors the REAL on-chain achievement registrations (read, never invented):
//    * jobs  101-606  (job#*100 + rung#)            seas-ladder/register-achievements.cjs
//    * ship  701-906  (700/800/900 + rung#)         seas-ladder/register-achievements.cjs
//    * guard 1001-1006                              register-guard-ladder.cjs
//  ...registered on BOTH lines:
//    * CIVIC = the GOLD tier pools  (register-gold-achievements.cjs / register-gold-ladder.cjs)
//    * ROGUE = the cbBTC tier pools (the original seas-ladder + register-guard-ladder.cjs)
//  Same id + same deed on both lines; only the NAME/LORE differs (the founder "reskin").
//
//  GOLD pool addresses are LOADED from mftusd-build/prize-ladders-deployment.json (never typed).
//  cbBTC pool addresses are the verified constants from register-guard-ladder.cjs (the rogue line;
//  the deploy json only records GOLD+ETH).
//
//  RUN: node build-achievements-catalog.cjs   →   writes achievements-catalog.json beside it.
// ============================================================
const fs = require('fs');
const path = require('path');

// ---- load GOLD (civic) pools from the deploy record — verify, never type ----
const DEPLOY_REC = 'C:/Users/bigji/Documents/mftusd-build/prize-ladders-deployment.json';
const rec = JSON.parse(fs.readFileSync(DEPLOY_REC, 'utf8'));
const goldPool = (tier) => {
  const e = rec.pools[`GOLD-${tier}`];
  if (!e || e.line !== 'GOLD' || !e.prizePool) throw new Error(`deploy record missing GOLD-${tier}`);
  return e.prizePool;
};
const GOLD_TOKEN = rec.pools['GOLD-Mayor'].token; // 0x2065d87b… (18 dec)

// ---- cbBTC (rogue) pools — verified constants from register-guard-ladder.cjs ----
const ROGUE = {
  Mayor:     '0xB10fbbCB67d68d1f43E566089FFa0f36Bd057193',
  Lord:      '0x4cC809378135F9501e37532dFDF3df6aED2B3342',
  PettyKing: '0x1D6dA6b28a62A45588411eEE66C94AC951A461D2',
  HighKing:  '0x2983E3d4250d01ba05013F1E9995Cd457D7aBa65',
  Emperor:   '0xF3dA6a1D7d1a57F4E4782213D831646C7E45d6B0',
};
const CBBTC_TOKEN = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'; // 8 dec

const TIERS = ['Mayor', 'Lord', 'PettyKing', 'HighKing', 'Emperor'];
const TIER_TAG = { Mayor: 1, Lord: 2, PettyKing: 3, HighKing: 4, Emperor: 5 };
const TIER_LABEL = { Mayor: 'Mayor', Lord: 'Lord', PettyKing: 'Petty King', HighKing: 'High King', Emperor: 'Emperor' };

// rung -> {label, tier}
const RUNGS = [
  { rung: 1, label: '1 day',    tier: 'Mayor' },
  { rung: 2, label: '1 week',   tier: 'Mayor' },
  { rung: 3, label: '1 month',  tier: 'Lord' },
  { rung: 4, label: '3 months', tier: 'PettyKing' },
  { rung: 5, label: '6 months', tier: 'HighKing' },
  { rung: 6, label: '1 year',   tier: 'Emperor' },
];

// ---- the ladders: REAL ids, civic names (on-chain registry), rogue reskin names ----
const JOB_LADDERS = {
  1: {
    job: 'Haul Cargo', stat: 'STR', base: 100, kind: 'JOB', attest: 'live',
    civic: { lore: "Honest backs move Port Royal's cargo. Clock shifts on the haul crew and the docks learn your name.",
             names: ['Signed On the Docks', 'Crate Hauler', 'Stevedore', 'Dockmaster', 'Harbor Foreman', 'Cargo Baron'] },
    rogue: { lore: "The Redrum crew hauls what it takes. Every crate dragged from a broken hold is one more for the black ledger.",
             names: ['Press-Ganged', 'Loot Lugger', 'Hold-Breaker', 'Plunder Boss', 'Raid Foreman', 'Plunder Baron'] },
  },
  2: {
    job: 'Mend the Nets', stat: 'DEX', base: 200, kind: 'JOB', attest: 'live',
    civic: { lore: "Quick hands keep the fleet's nets and rigging whole through every storm.",
             names: ['Net Threader', 'Net Mender', 'Rigging Hand', 'Sailmaker', 'Master of the Weave', 'Net Lord'] },
    rogue: { lore: "The same quick hands rig boarding lines and snares for the next prize.",
             names: ['Snare Setter', 'Trap Weaver', 'Boarding-Line Hand', 'Black-Sail Maker', 'Master of Snares', 'Snare Lord'] },
  },
  3: {
    job: 'Stock the Rations', stat: 'CON', base: 300, kind: 'JOB', attest: 'live',
    civic: { lore: "Steady stomachs win long voyages. Keep the larder full and the crew sails farther.",
             names: ['Cellar Boy', 'Rationer', 'Provisioner', 'Steward', 'Quartermaster', 'Larder King'] },
    rogue: { lore: "A raider's belly is filled with stolen stores. Hoard the spoils, ration the grog.",
             names: ['Bilge Scrounger', 'Grog Hoarder', 'Spoils Keeper', 'Plunder Steward', 'Quartermaster of the Black', 'Glutton King'] },
  },
  4: {
    job: 'Tend the Beacon', stat: 'INT', base: 400, kind: 'JOB', attest: 'live',
    civic: { lore: "A true light guides ships home through the cold dark.",
             names: ['Lamp Lighter', 'Beacon Keeper', 'Chart Reader', 'Lorekeeper', 'Master Cartographer', 'Lord of the Light'] },
    rogue: { lore: "A false light guides ships onto the rocks — then the Redrum crew takes what washes up.",
             names: ["Wrecker's Lamp", 'False-Light Keeper', "Smuggler's Chartsman", 'Keeper of Forbidden Lore', 'Master of Dark Charts', 'Lord of the Wrecking Light'] },
  },
  5: {
    job: 'Sea-Rites', stat: 'WIS', base: 500, kind: 'JOB', attest: 'live',
    civic: { lore: "Read the tides, honor the deep, and the sea answers kindly.",
             names: ['Shell Gatherer', 'Shell Listener', 'Tide Reader', 'Sea-Caller', 'Oracle of the Deep', 'Lord of Tides'] },
    rogue: { lore: "Cast the bones to the Drowned God and bargain for dark favor on the waves.",
             names: ['Bone Caster', 'Omen Reader', 'Curse Whisperer', 'Drowned-God Caller', 'Oracle of the Drowned', 'Lord of the Drowned'] },
  },
  6: {
    job: 'Barter at Market', stat: 'CHA', base: 600, kind: 'JOB', attest: 'live',
    civic: { lore: "Fair dealing builds the trust that holds Port Royal's market square together.",
             names: ['Stall Hand', 'Haggler', 'Trader', 'Broker', 'Market Master', 'Merchant Prince'] },
    rogue: { lore: "Stolen goods need a quiet buyer. Move the loot, take your cut, ask no questions.",
             names: ["Fence's Runner", 'Black-Market Haggler', 'Fence', 'Smuggler-Broker', 'Master of the Black Market', 'Smuggler Prince'] },
  },
};

const SHIP_LADDERS = {
  700: {
    job: 'Loyalty', stat: 'Stay loyal to one ship', base: 700, kind: 'SHIP', attest: 'pending',
    civic: { lore: "Stay with one ship and earn the lasting trust of its captain.",
             names: ['Deckhand of the Watch', "Ship's Hand", 'Bonded Crew', 'Sworn Hand', "Ship's Veteran", 'True Crew'] },
    rogue: { lore: "Swear the blood oath to the Redrum crew and never break it.",
             names: ['Blooded Hand', 'Oathbound Rogue', 'Sworn to the Black', 'Blood-Bonded', 'Crew-for-Life', 'True Reaver'] },
  },
  800: {
    job: 'Sea Dog for Hire', stat: 'Sail under many flags', base: 800, kind: 'SHIP', attest: 'pending',
    civic: { lore: "Sail under many flags for honest wages — a hand worth hiring anywhere.",
             names: ['Drifter', 'Hired Oar', 'Roving Hand', 'Wandering Mate', 'Salt-Worn Mercenary', 'Old Sea Dog'] },
    rogue: { lore: "Sell your blade to whoever pays in blood and plunder.",
             names: ['Cutthroat-for-Hire', 'Hired Blade', 'Roving Cutthroat', 'Wandering Marauder', 'Salt-Worn Reaver', 'Old Sea Wolf'] },
  },
  900: {
    job: 'Versatility', stat: 'Work every trade', base: 900, kind: 'SHIP', attest: 'pending',
    civic: { lore: "Master every trade aboard and no shift is beyond you.",
             names: ['Two-Trade Hand', 'Three-Trade Hand', 'Four-Trade Hand', 'Five-Trade Hand', 'Six-Trade Hand', 'Jack of All Trades'] },
    rogue: { lore: "A rogue who can do every job is dangerous on any deck.",
             names: ['Two-Trade Rogue', 'Three-Trade Rogue', 'Four-Trade Rogue', 'Five-Trade Rogue', 'Six-Trade Rogue', 'Jack of All Raids'] },
  },
};

const GUARD = {
  job: 'Guard the Port', stat: 'Stand the watch', base: 1000, kind: 'GUARD', attest: 'live',
  civic: { lore: "Stand the Mayor's watch and keep Port Royal safe — earned by clocking guard shifts at the Mayor's Vault.",
           names: ['Posted to the Watch', 'Harbor Watchman', 'Port Warden', 'Watch Captain', 'Harbor Marshal', 'Lord Protector of the Port'] },
  rogue: { lore: "Run the docks your own way — to a rogue, protection is a fee, not a duty.",
           names: ['Shook Down the Docks', 'Dockside Enforcer', 'Racket Warden', 'Racket Captain', 'Harbor Kingpin', 'Dread Lord of the Port'] },
};

// ---- build achievement rows keyed by REAL id ----
const achievements = [];
function pushLadder(L) {
  for (const r of RUNGS) {
    achievements.push({
      id: L.base + r.rung,
      ladder: L.job,
      stat: L.stat,
      kind: L.kind,
      rung: r.rung,
      rungLabel: r.label,
      tier: r.tier,
      tierTag: TIER_TAG[r.tier],
      reward: '1% of the tier pool',
      rewardType: 'BPS_OF_POOL',
      rewardBps: 100,
      attest: L.attest, // "live" = seas-watcher attests this deed; "pending" = registered, attestation not wired yet
      civic: { title: L.civic.names[r.rung - 1], lore: L.civic.lore },
      rogue: { title: L.rogue.names[r.rung - 1], lore: L.rogue.lore },
    });
  }
}
for (const j of [1, 2, 3, 4, 5, 6]) pushLadder(JOB_LADDERS[j]);
for (const s of [700, 800, 900]) pushLadder(SHIP_LADDERS[s]);
pushLadder(GUARD);

// sanity: 10 ladders * 6 rungs = 60 ids, unique
if (achievements.length !== 60) throw new Error('expected 60 achievements, got ' + achievements.length);
const ids = achievements.map(a => a.id);
if (new Set(ids).size !== ids.length) throw new Error('duplicate ids');

const catalog = {
  meta: {
    generatedAt: new Date().toISOString().slice(0, 10),
    note: 'Presentation/data only — mirrors on-chain achievement registrations. No chain writes. Same id + deed on both lines; only the name/lore differs (founder reskin 2026-06-27).',
    rpc: 'https://mainnet.base.org',
    reward: 'Every achievement pays 1% of its tier pool (BPS_OF_POOL, 100 bps), once per pawn (oneTimePerNFT), attested by the seas-watcher. Self-limiting — never a fixed promise.',
    attestLegend: {
      live: 'The seas-watcher attests this deed automatically (job + guard shift time).',
      pending: 'Registered on-chain, but the watcher cannot attest it yet (ship-loyalty/versatility need continuous-crewing events). Shown for completeness — does not pay until wired.',
    },
  },
  tiers: TIERS.map(t => ({ tier: t, label: TIER_LABEL[t], tag: TIER_TAG[t] })),
  lines: {
    civic: {
      key: 'civic',
      label: 'Civic — Gold',
      blurb: 'Upstanding crew sworn to Port Royal. Honest deeds pay in GOLD.',
      token: GOLD_TOKEN,
      tokenSymbol: 'GOLD',
      tokenDecimals: 18,
      pools: Object.fromEntries(TIERS.map(t => [t, goldPool(t)])),
    },
    rogue: {
      key: 'rogue',
      label: 'Rogue — Black Coin',
      blurb: 'The Redrum Raiders and the dark side. Dark deeds pay in cbBTC.',
      token: CBBTC_TOKEN,
      tokenSymbol: 'cbBTC',
      tokenDecimals: 8,
      pools: ROGUE,
    },
  },
  achievements,
};

const OUT = path.join(__dirname, 'achievements-catalog.json');
fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2));
console.log('wrote', OUT);
console.log('civic GOLD pools:', catalog.lines.civic.pools);
console.log('rogue cbBTC pools:', catalog.lines.rogue.pools);
console.log('achievements:', achievements.length, '| ids', Math.min(...ids), '…', Math.max(...ids));
