// One-off generator for BATCHES.json (Task #8). Inventories every Wave-2 game,
// detects shared-script includes + avatar draw style + wager membership, assigns
// genre from ARCADE-100.md, and groups into batches of 12-15 by genre.
// Run: node _gen-batches.js   (writes BATCHES.json next to it). Safe to delete after.
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = __dirname;

// --- Exclusions (from Task #8 description) ---
const FLAGSHIPS = ['poop-man', 'reactor-jump', 'tunnel-bug'];
const TOOLS = ['dice-roller', 'ttrpg-notepad'];
const HUB_INFRA = ['index', 'arcade', 'GAME-TEMPLATE', 'wager-demo', 'tournament', 'sprite-test', '_player-test'];
const EXCLUDE_EXACT = new Set([].concat(FLAGSHIPS, TOOLS, HUB_INFRA));
function isBackup(base) { return /-backup$/i.test(base); }

// --- Genre map, parsed from ARCADE-100.md batch headers ---
// slug -> genre label. (ARCADE-100 groups by NES-classic genre.)
const GENRE = {};
function tag(genre, slugs) { slugs.forEach(s => { GENRE[s] = genre; }); }
tag('platformer-action', ['fungal-fury','spore-knight','poop-man','reactor-jump','spore-crystal','hex-ninja','iron-maw','baseling-bounce','chain-reaction','blaster-baseling','jumpy-bros']);
tag('puzzle', ['poop-drop','bubble-baseling','spore-lemmings','token-columns','spore-n-ice','rainbow-bridge','reactor-pipes','boulder-baseling','poop-puzznic','kickle-spore','blocks-burg','solomon-key','spore-sphere','ooze-battle']);
tag('shmup', ['reactor-force','spore-storm','over-horizon','super-turrican','scat-attack','zombie-nation','baseling-sky-patrol','power-blade','spore-force','metal-storm','spore-invaders','spore-defense']);
tag('racing-sports', ['micro-baselings','rc-reactor','baseling-bowl','blades-of-poop','track-n-field','super-dodge','rad-racer','baseling-sluggers','spore-tributaries','baseling-grind']);
tag('rpg-adventure', ['legend-of-tasern','tasern-quest','fungi-quest','river-city-brawl','sporegoyle-quest','willow-grove','solstice-tower','startropics-hex','spore-mansion','pirates-of-tasern','rygar-realm','spore-crystal','whodunit']);
tag('strategy-board', ['garden-wars','spore-trader','north-south-war','rampart-siege','garden-guerrilla','spy-hunter','spore-breaker','poop-bomber','baseling-island','chess','checkers','meme-city']);
tag('misc-action', ['spore-roll','snake-rattle','little-baseling','spore-icarus','bucky-baseling','dark-spore','snow-bros','spore-tales','ufouria','spore-samson','double-baseling','punch-out','shadow-baseling','toads-of-tasern','baseling-rescue','tiny-toons','shatter-hand','shadow-ninja','golden-spore','comix-spore','streets-of-tasern','spore-maze','rodeo-toad','swamp-hop','seasons','poop-chomp','poop-out','baseling-depths','rhythm-baseling','reactor-rash','spore-sprint','tasern-pinball']);

// --- WAGER_GAMES (from tasern-wager.js) — pvp:true required ---
function parseWagerGames() {
  const txt = fs.readFileSync(path.join(DIR, 'tasern-wager.js'), 'utf8');
  const m = txt.match(/WAGER_GAMES\s*=\s*\{([\s\S]*?)\n\};/);
  if (!m) throw new Error('Could not find WAGER_GAMES block in tasern-wager.js');
  const keys = [];
  const re = /'([a-z0-9-]+)'\s*:/g; let k;
  while ((k = re.exec(m[1]))) keys.push(k[1]);
  return new Set(keys);
}
const WAGER = parseWagerGames();

// --- Per-file detection ---
// --- Manual overrides (Task #10) ---
// Three games were auto-flagged avatar:'unknown'. After reading each fully, their
// focal entity, genre, and stat mapping are pinned here so Wave-2 builders hit zero
// ambiguity. These win over the auto-detected genre/avatar/notes.
const OVERRIDES = {
  // Filename says "city builder" but the implemented game is a 1v1 FIGHTER
  // (drawFighter / charSelect / KO / boss). P1's procedural body is the avatar.
  'meme-city': {
    genre: 'misc-action',
    avatar: 'procedural',
    focalEntity: 'P1 fighter body in drawFighter(f) (the !f.isP2 fighter). P2 is the opponent/NPC.',
    notes: [
      'MISLABELED: this is a Street-Fighter-style 1v1 FIGHTER, not a city builder. Genre corrected to misc-action (brawler).',
      'Avatar = P1 fighter, drawn procedurally in drawFighter(f) (~line 1441) from ch.height/body parts; already tinted by statB.color for !f.isP2.',
      'Remaster: replace P1 procedural body with TAS.drawBaseling()/BaselingPlayer.draw() at the fighter origin (X.translate(f.x,f.y), draw at head/body offsets). Keep P2 as a CHARS opponent.',
      'Has a PvP mode — if a wager mode is wired, gate stat effects with getMults({pvp:true}) (0.95-1.10). Single-player vs CPU: default 0.8-1.6.',
      'Replace old statB (NftLoader.getStatBonuses) with BaselingPlayer.getMults().',
      'add baseling-player.js + character picker',
    ],
    statMap: { speed: 'walk/dash speed', stamina: 'health bar (maxHp)', power: 'attack/special damage + block-break', luck: 'crit chance / super-meter gain rate', swim: 'unused (no water)' },
  },
  // Snake Rattle N Roll — isometric snake. The HEAD (snake[0]) is the avatar.
  'snake-rattle': {
    genre: 'misc-action',
    avatar: 'procedural',
    focalEntity: 'snake head = snake[0], drawn in the render loop where i===0 (~line 1889).',
    notes: [
      'Isometric snake; avatar = the HEAD (snake[0]). Body segments stay procedural.',
      'Auto-flagged unknown only because it draws via helper wrappers (drawPixelCircle/drawPixelRect) instead of raw ctx.* — it IS procedural with an obvious swap point.',
      'Remaster: at the i===0 branch (~line 1889, already commented "Baseling icon on head"), replace the pixel sphere + eyes with TAS.drawBaseling()/BaselingPlayer.draw() centered at (sx, sy - radius*0.5), sized ~radius*2.5. Leave body spheres alone.',
      'Replace old statB (NftLoader.getStatBonuses) with BaselingPlayer.getMults().',
      'add baseling-player.js + character picker',
    ],
    statMap: { speed: 'snake step/move-tick speed', stamina: 'starting length + poison resistance (segments lost slower)', power: 'tongue / boss damage', luck: 'power-up + food spawn rate', swim: 'swamp/water-tile traversal (level 4+ has water/poison tiles)' },
  },
  // Clue/Cluedo board game. Player is a baseling detective TOKEN on the board +
  // a HUD portrait. ALREADY integrates a baseling via TAS.drawBaseling (line ~985).
  'whodunit': {
    genre: 'rpg-adventure',
    avatar: 'sprite-bridge', // already calls TAS.drawBaseling for the human player's token
    focalEntity: "human player's detective token in drawBoard() (~line 985, `=== BASELING SPRITE ===`) and the HUD portrait.",
    notes: [
      'Clue/Cluedo board game. The human player is a moving baseling detective TOKEN on the board, plus a HUD portrait.',
      'ALREADY draws a baseling: drawBoard() calls `TAS.drawBaseling(c, px, py, radius*2, {...})` for the human token with a procedural circle fallback (~line 985). Most-complete of the three.',
      'Remaster is light: confirm TAS.drawBaseling resolves to the SELECTED baseling (via BaselingPlayer), and also draw it in the HUD portrait + char/turn UI.',
      'KEY: its tutorial text maps D&D stats (STR/DEX/CON/CHA) to mechanics via the OLD statB. Re-map to the 5 ARCADE stats (see statMap) and update the tutorial copy to match.',
      'add baseling-player.js + character picker',
    ],
    statMap: { speed: 'bonus dice/movement steps (was DEX)', stamina: 'survive one wrong accusation (was CON 16+); interrogation stamina', power: 'interrogation / suggestion success (was STR)', luck: 'evidence-card & secret-passage draw odds (was CHA/witness cooperation)', swim: 'unused (no water)' },
  },
};

const SHARED = [
  ['tasern-engine.js', 'engine'],
  ['tasern-theme.js', 'theme'],
  ['tasern-wager.js', 'wager'],
  ['baseling-sprites.js', 'sprites'],
  ['baseling-player.js', 'player'],
  ['nft-loader.js', 'nftLoader'],
];
function detect(file) {
  const txt = fs.readFileSync(path.join(DIR, file), 'utf8');
  const loads = {};
  SHARED.forEach(([fname, key]) => {
    loads[key] = new RegExp('<script[^>]+src=["\']' + fname.replace('.', '\\.')).test(txt);
  });
  // Avatar draw style:
  //  - 'sprite'      : already renders via BaselingSprites/BaselingPlayer
  //  - 'procedural'  : has a player/baseling draw fn using raw ctx primitives
  //  - 'unknown'     : neither clearly detected
  const usesSpriteApi = /BaselingSprites\.(draw|frame)\s*\(|BaselingPlayer\.(draw|sprite)\s*\(/.test(txt);
  const hasDrawFn = /function\s+(drawPlayer|drawBaseling|drawHero|drawAvatar)\b/.test(txt) ||
                    /drawPlayer\s*[:=]\s*function/.test(txt);
  const ctxShapes = (txt.match(/ctx\.(fillRect|arc|ellipse|beginPath)\s*\(/g) || []).length;
  let avatar;
  if (usesSpriteApi) avatar = 'sprite';
  else if (hasDrawFn || ctxShapes > 20) avatar = 'procedural';
  else avatar = 'unknown';
  return { loads, avatar, ctxShapes, hasDrawFn, usesSpriteApi };
}

// --- Inventory ---
const all = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.html'));
const games = [];
const skipped = [];
for (const file of all) {
  const base = file.replace(/\.html$/i, '');
  if (EXCLUDE_EXACT.has(base)) { skipped.push({ file, reason: FLAGSHIPS.includes(base) ? 'flagship' : TOOLS.includes(base) ? 'tool' : 'hub/infra' }); continue; }
  if (isBackup(base)) { skipped.push({ file, reason: 'backup' }); continue; }
  const lineCount = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n').length;
  const d = detect(file);
  const ov = OVERRIDES[base] || null;
  const entry = {
    slug: base,
    file,
    lineCount,
    genre: (ov && ov.genre) || GENRE[base] || 'unclassified',
    wager: WAGER.has(base),
    loads: d.loads,
    avatar: (ov && ov.avatar) || d.avatar,
    needsPlayerModule: !d.loads.player,           // every Wave-2 game must add baseling-player.js
    needsSpriteSwap: ((ov && ov.avatar) || d.avatar) !== 'sprite', // not yet sprite-based via shared module
    notes: (ov && ov.notes) ? ov.notes.slice() : buildNotes(base, d),
  };
  if (ov) {
    entry.reviewed = true;                         // hand-inspected (Task #10)
    if (ov.focalEntity) entry.focalEntity = ov.focalEntity;
    if (ov.statMap) entry.statMap = ov.statMap;
  }
  games.push(entry);
}

function buildNotes(base, d) {
  const n = [];
  if (WAGER.has(base)) n.push('WAGER game — getMults({pvp:true}) required (0.95-1.10 band)');
  if (!d.loads.player) n.push('add baseling-player.js + character picker');
  if (d.avatar === 'sprite') n.push('already draws via BaselingSprites/Player — verify stat wiring only');
  else if (d.avatar === 'procedural') n.push('procedural avatar — swap player draw to BaselingPlayer.draw()');
  else n.push('avatar draw style unclear — inspect before remaster');
  if (!d.loads.sprites) n.push('does not load baseling-sprites.js yet');
  if (!d.loads.engine) n.push('no tasern-engine.js');
  if (!d.loads.theme) n.push('no tasern-theme.js');
  return n;
}

// --- Group into batches of 12-15 by genre ---
const GENRE_ORDER = ['puzzle','platformer-action','shmup','racing-sports','rpg-adventure','strategy-board','misc-action','unclassified'];
games.sort((a, b) => {
  const ga = GENRE_ORDER.indexOf(a.genre), gb = GENRE_ORDER.indexOf(b.genre);
  if (ga !== gb) return ga - gb;
  return a.slug.localeCompare(b.slug);
});
const BATCH_MAX = 14;
const batches = [];
let cur = null;
for (const g of games) {
  if (!cur || cur.genre !== g.genre || cur.games.length >= BATCH_MAX) {
    cur = { id: 'batch-' + (batches.length + 1), genre: g.genre, games: [] };
    batches.push(cur);
  }
  cur.games.push(g.slug);
}

// --- Summary table ---
const byGenre = {};
for (const g of games) {
  byGenre[g.genre] = byGenre[g.genre] || { count: 0, wager: 0, sprite: 0, 'sprite-bridge': 0, procedural: 0, unknown: 0 };
  byGenre[g.genre].count++;
  if (g.wager) byGenre[g.genre].wager++;
  if (byGenre[g.genre][g.avatar] === undefined) byGenre[g.genre][g.avatar] = 0;
  byGenre[g.genre][g.avatar]++;
}

const out = {
  generatedAt: new Date().toISOString(),
  source: 'ARCADE-100.md genres + tasern-wager.js WAGER_GAMES; avatar/script detection by content scan',
  totals: {
    htmlFiles: all.length,
    waveTwoGames: games.length,
    skipped: skipped.length,
    wagerGames: games.filter(g => g.wager).length,
    spriteAvatars: games.filter(g => g.avatar === 'sprite').length,
    spriteBridgeAvatars: games.filter(g => g.avatar === 'sprite-bridge').length,
    proceduralAvatars: games.filter(g => g.avatar === 'procedural').length,
    unknownAvatars: games.filter(g => g.avatar === 'unknown').length,
    reviewed: games.filter(g => g.reviewed).length,
    alreadyLoadPlayerModule: games.filter(g => g.loads.player).length,
  },
  summaryByGenre: byGenre,
  batches: batches.map(b => ({ id: b.id, genre: b.genre, count: b.games.length, games: b.games })),
  games,
  skipped,
  legend: {
    avatar: { sprite: 'already renders via BaselingSprites/BaselingPlayer', 'sprite-bridge': 'already calls TAS.drawBaseling for the avatar — just point it at the selected baseling', procedural: 'raw ctx-drawn avatar, swap to BaselingPlayer.draw()', unknown: 'inspect before remaster' },
    loads: 'true = the game already includes that shared script',
    reviewed: 'hand-inspected (Task #10); has focalEntity + statMap with finalized notes',
    focalEntity: 'where the player avatar / focal entity is drawn (the sprite-swap point)',
    statMap: 'per-stat gameplay mapping for THIS game (see ARCADE-STATS.md for the formula/clamp)',
    needsPlayerModule: 'baseling-player.js not yet included (Wave-2 must add it)',
    needsSpriteSwap: 'avatar is not yet sprite-based via the shared module',
    wager: 'in tasern-wager.js WAGER_GAMES — must call getMults({pvp:true})',
  },
};

fs.writeFileSync(path.join(DIR, 'BATCHES.json'), JSON.stringify(out, null, 2));
console.log('Wrote BATCHES.json');
console.log('HTML files:', all.length, '| Wave-2 games:', games.length, '| skipped:', skipped.length);
console.log('wager:', out.totals.wagerGames, '| sprite:', out.totals.spriteAvatars, '| procedural:', out.totals.proceduralAvatars, '| unknown:', out.totals.unknownAvatars);
console.log('unclassified:', games.filter(g => g.genre === 'unclassified').map(g => g.slug).join(', ') || '(none)');
console.log('skipped detail:', skipped.map(s => s.file + ' (' + s.reason + ')').join(', '));
console.log('batches:', batches.map(b => b.id + ':' + b.genre + '=' + b.games.length).join('  '));
