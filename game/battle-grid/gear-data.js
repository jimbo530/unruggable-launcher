// @ts-check
/**
 * gear-data.js — the full Seize the Seas armory, D&D 3.5-grounded, generated from
 * compact base tables × material tiers. Each entry: { id, name, slot, emoji, priceCp,
 * gold, desc, mods, sprite, material, masterwork, enchantable, enchant }.
 *
 * PRICES are authentic D&D 3.5 values (gp), denominated in the game's coins
 * (gold/silver/copper = gp/sp/cp, 1g=10s=100c). Stored as priceCp (copper) and shown
 * via formatCoins(). MATERIAL price ladder (founder 2026-06-25): wooden ½ · iron 1× ·
 * bronze 2× ("copper" tier) · steel 4× (LOCKED — unlocks later). Exotic markets later.
 *
 * STATS map D&D → the game's mods (attack/atkBonus/ac/maxHp/attackRange/castingMod).
 * CRAFTING (craft.js): material + masterwork; ONLY masterwork items can be enchanted.
 */

// material tiers. bonus = STAT bump (to attack/ac). priceMul = cost vs the iron baseline.
export const MATERIALS = {
  wooden: { label: 'Wooden', bonus: 0, priceMul: 0.5, locked: false },
  iron:   { label: 'Iron',   bonus: 1, priceMul: 1.0, locked: false },
  bronze: { label: 'Bronze', bonus: 2, priceMul: 2.0, locked: false },
  steel:  { label: 'Steel',  bonus: 3, priceMul: 4.0, locked: true },  // unlocks later
  leather:{ label: 'Leather',bonus: 0, priceMul: 1.0, locked: false }, // helmet-leather / soft gear
};

// base weapon table: dmg=base flat attack, fin=finesse(+to-hit), reach=+1 range,
// rng=ranged range bonus, two=two-handed(+1 dmg). gp = D&D 3.5 list price (gold pieces).
const W = (name, emoji, dmg, gp, opt = {}) => ({ name, emoji, dmg, gp, slot: 'weapon', ...opt });
export const WEAPONS = {
  // ── light / simple ──
  dagger:        W('Dagger', '🗡️', 1, 2, { fin: true }),
  club:          W('Club', '🏏', 1, 0.1),
  sickle:        W('Sickle', '🌙', 1, 6),
  kama:          W('Kama', '⚒️', 1, 2, { fin: true }),
  sai:           W('Sai', '🔱', 1, 1, { fin: true }),
  nunchaku:      W('Nunchaku', '🥢', 1, 2),
  'light-hammer':W('Light Hammer', '🔨', 1, 1),
  handaxe:       W('Handaxe', '🪓', 2, 6),
  // ── one-hand martial ──
  mace:          W('Mace', '🔨', 2, 12),
  morningstar:   W('Morningstar', '✴️', 2, 8),
  warhammer:     W('Warhammer', '🔨', 2, 12),
  hammer:        W('War Hammer', '🔨', 2, 12),
  shortsword:    W('Short Sword', '🗡️', 2, 10, { fin: true }),
  scimitar:      W('Scimitar', '🗡️', 2, 15),
  rapier:        W('Rapier', '🤺', 1, 20, { fin: true }),
  kukri:         W('Kukri', '🔪', 1, 8, { fin: true }),
  longsword:     W('Long Sword', '⚔️', 2, 15),
  sword:         W('Long Sword', '⚔️', 2, 15),
  battleaxe:     W('Battleaxe', '🪓', 2, 10),
  flail:         W('Flail', '🔗', 2, 8),
  'bastard-sword':W('Bastard Sword', '⚔️', 3, 35),
  // ── two-handed ──
  quarterstaff:  W('Quarterstaff', '🥢', 2, 0.2, { two: true }),
  greatsword:    W('Greatsword', '⚔️', 3, 50, { two: true }),
  greataxe:      W('Greataxe', '🪓', 3, 20, { two: true }),
  greatclub:     W('Greatclub', '🏏', 3, 5, { two: true }),
  maul:          W('Maul', '🔨', 3, 30, { two: true }),
  'dwarven-waraxe':   W('Dwarven Waraxe', '🪓', 3, 30),
  'dwarven-urgrosh':  W('Dwarven Urgrosh', '🔱', 3, 50, { two: true }),
  'gnome-hooked-hammer': W('Gnome Hooked Hammer', '🔨', 2, 20, { two: true }),
  'orc-double-axe':   W('Orc Double Axe', '🪓', 3, 60, { two: true }),
  // ── reach ──
  spear:   W('Spear', '🔱', 2, 2, { reach: true }),
  glaive:  W('Glaive', '🔱', 2, 8, { reach: true, two: true }),
  halberd: W('Halberd', '🪓', 3, 10, { reach: true, two: true }),
  pike:    W('Pike', '🔱', 2, 5, { reach: true, two: true }),
  lance:   W('Lance', '🐴', 3, 10, { reach: true }),
  mancatcher: W('Mancatcher', '🔱', 1, 15, { reach: true }),
  // ── ranged ──
  shortbow:  W('Short Bow', '🏹', 1, 30, { rng: 2 }),
  longbow:   W('Long Bow', '🏹', 2, 75, { rng: 3 }),
  crossbow:  W('Crossbow', '🏹', 2, 35, { rng: 2 }),
  'hand-crossbow': W('Hand Crossbow', '🏹', 1, 100, { rng: 2 }),
  'heavy-crossbow': W('Heavy Crossbow', '🏹', 3, 50, { rng: 3, two: true }),
  'repeating-crossbow': W('Repeating Crossbow', '🏹', 2, 250, { rng: 2 }),
  dart:    W('Dart', '🎯', 1, 0.5, { rng: 1 }),
  javelin: W('Javelin', '🔱', 1, 1, { rng: 1 }),
  shuriken:W('Shuriken', '✴️', 1, 0.1, { rng: 1, fin: true }),
  sling:   W('Sling', '🪨', 1, 0.1, { rng: 1 }),
  blowgun: W('Blowgun', '💨', 1, 2, { rng: 1 }),
  bolas:   W('Bolas', '🪢', 1, 5, { rng: 1 }),
  net:     W('Net', '🕸️', 0, 20, { rng: 1 }),
};

// armor: ac bonus, hp (bulk), gp = D&D list price.
const A = (name, emoji, ac, gp, opt = {}) => ({ name, emoji, ac, gp, slot: 'armor', ...opt });
export const ARMORS = {
  'armor':              A('Leather Armor', '🦺', 2, 10),
  'armor-studded':      A('Studded Leather', '🦺', 3, 25),
  'armor-hide':         A('Hide Armor', '🐾', 3, 15),
  'armor-chain-shirt':  A('Chain Shirt', '⛓️', 4, 100),
  'armor-scalemail':    A('Scale Mail', '🐉', 4, 50, { hp: 2 }),
  'armor-chainmail':    A('Chainmail', '⛓️', 5, 150, { hp: 2 }),
  'armor-ring-mail':    A('Ring Mail', '⛓️', 4, 30, { hp: 2 }),
  'armor-breastplate':  A('Breastplate', '🛡️', 5, 200, { hp: 4 }),
  'armor-splint':       A('Splint Mail', '🛡️', 6, 200, { hp: 4 }),
  'armor-half-plate':   A('Half-Plate', '🛡️', 7, 600, { hp: 4 }),
  'armor-plate':        A('Full Plate', '🛡️', 8, 1500, { hp: 6 }),
  shield:               A('Shield', '🛡️', 2, 20, { tiered: true }),
  helmet:               A('Helm', '⛑️', 1, 5, { tiered: true }),
};

// trinkets (curated; flat mods, no material tiers). gp = D&D list price.
export const TRINKETS = {
  spyglass: { name: 'Spyglass', emoji: '🔭', slot: 'trinket', gp: 1000, mods: { attackRange: 1, atkBonus: 1 }, desc: '+1 reach, +1 to-hit' },
  lantern:  { name: 'Lantern', emoji: '🏮', slot: 'trinket', gp: 7, mods: { atkBonus: 1, castingMod: 1 }, desc: '+1 to-hit, +1 spell' },
  'healers-kit': { name: "Healer's Kit", emoji: '🧰', slot: 'trinket', gp: 50, mods: { maxHp: 4 }, desc: '+4 HP' },
  relic:    { name: 'Ancient Relic', emoji: '🗿', slot: 'trinket', gp: 500, mods: { atkBonus: 1, castingMod: 1 }, desc: '+1 to-hit, +1 spell' },
};

const TIERED = new Set(['battleaxe','club','dagger','flail','glaive','greataxe','greatclub','greatsword',
  'halberd','handaxe','lance','light-hammer','mace','pike','quarterstaff','rapier','scimitar','shortbow',
  'shortsword','sword','longsword','spear','crossbow','dart','javelin','sling','sickle','warhammer','shield','helmet']);

/** Format a copper amount into D&D-style gold/silver/copper, e.g. 1525 -> "15g 2s 5c". */
export function formatCoins(cp) {
  cp = Math.max(0, Math.round(cp));
  const g = Math.floor(cp / 100), r = cp % 100, s = Math.floor(r / 10), c = r % 10;
  const parts = [];
  if (g) parts.push(g + 'g'); if (s) parts.push(s + 's'); if (c) parts.push(c + 'c');
  return parts.length ? parts.join(' ') : '0c';
}
const priceCp = (gp, mul) => Math.max(1, Math.round((gp || 1) * 100 * mul));

function weaponMods(w, matBonus, mw, enchant) {
  const mods = {};
  const atk = (w.dmg || 0) + (w.two ? 1 : 0) + matBonus + enchant;
  if (atk) mods.attack = atk;
  const toHit = (w.fin ? 1 : 0) + (mw ? 1 : 0) + enchant;
  if (toHit) mods.atkBonus = toHit;
  const range = (w.reach ? 1 : 0) + (w.rng || 0);
  if (range) mods.attackRange = range;
  return mods;
}
function armorMods(a, matBonus, mw, enchant) {
  const mods = { ac: (a.ac || 0) + matBonus + enchant };
  if (a.hp) mods.maxHp = a.hp;
  if (enchant) mods.atkBonus = enchant;
  return mods;
}
const descFromMods = (m) => [
  m.attack ? `+${m.attack} dmg` : '', m.atkBonus ? `+${m.atkBonus} to-hit` : '',
  m.ac ? `+${m.ac} AC` : '', m.maxHp ? `+${m.maxHp} HP` : '',
  m.attackRange ? `+${m.attackRange} reach` : '', m.castingMod ? `+${m.castingMod} spell` : '',
].filter(Boolean).join(', ');

/** Build the full armory. */
export function buildArmory() {
  const items = {};
  const add = (id, base, name, mods, cp, extra) => {
    items[id] = { id, name, slot: base.slot, emoji: base.emoji, priceCp: cp, gold: Math.max(1, Math.round(cp / 100)),
      mods, desc: descFromMods(mods) || '—', sprite: `../art/gear/${id}.png`, ...extra };
  };
  // weapons × material tiers (or single base entry where no art tiers)
  for (const [key, w] of Object.entries(WEAPONS)) {
    if (TIERED.has(key)) {
      for (const [mid, mat] of Object.entries(MATERIALS)) {
        if (mid === 'leather') continue;
        const id = `${key}-${mid}`;
        add(id, w, `${mat.label} ${w.name}`, weaponMods(w, mat.bonus, false, 0), priceCp(w.gp, mat.priceMul),
          { material: mid, locked: mat.locked, masterwork: false, enchantable: false, enchant: 0 });
      }
    } else {
      add(key, w, w.name, weaponMods(w, 1, false, 0), priceCp(w.gp, 1),
        { material: 'iron', locked: false, masterwork: false, enchantable: false, enchant: 0 });
    }
  }
  // armors
  for (const [key, a] of Object.entries(ARMORS)) {
    if (a.tiered) {
      for (const mid of ['leather','iron','bronze','steel']) {
        if (key === 'shield' && mid === 'leather') continue;
        const id = `${key}-${mid}`;
        const mat = MATERIALS[mid];
        add(id, a, `${mat.label} ${a.name}`, armorMods(a, key === 'helmet' ? Math.floor(mat.bonus / 2) : mat.bonus, false, 0),
          priceCp(a.gp, mat.priceMul), { material: mid, locked: mat.locked, masterwork: false, enchantable: false, enchant: 0 });
      }
    } else {
      add(key, a, a.name, armorMods(a, 0, false, 0), priceCp(a.gp, 1),
        { material: 'cloth', locked: false, masterwork: false, enchantable: false, enchant: 0 });
    }
  }
  // trinkets
  for (const [id, t] of Object.entries(TRINKETS)) {
    items[id] = { id, slot: 'trinket', sprite: `../art/gear/${id}.png`, priceCp: priceCp(t.gp, 1), gold: Math.max(1, Math.round(t.gp)),
      masterwork: false, enchantable: false, enchant: 0, material: null, locked: false, ...t };
  }
  return items;
}

/** Masterwork upgrade (+1 to-hit, unlocks enchant). */
export function masterwork(item) {
  const mods = { ...item.mods, atkBonus: (item.mods.atkBonus || 0) + 1 };
  return { ...item, masterwork: true, enchantable: true, name: `Masterwork ${item.name}`, mods, desc: descFromMods(mods) };
}
/** Enchant a MASTERWORK item by +n. Throws if not masterwork (founder rule). */
export function enchant(item, n) {
  if (!item.masterwork) throw new Error('only masterwork items can be enchanted');
  const mods = { ...item.mods, atkBonus: (item.mods.atkBonus || 0) + n };
  if (item.slot === 'weapon') mods.attack = (item.mods.attack || 0) + n;
  return { ...item, enchant: n, name: `${item.name} +${n}`, mods, desc: descFromMods(mods) };
}
