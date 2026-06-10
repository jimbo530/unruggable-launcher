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
tag('platformer-action', ['fungal-fury','spore-knight','poop-man','reactor-jump','crystal-quest','hex-ninja','iron-maw','baseling-bounce','chain-reaction','blaster-baseling','jumpy-bros']);
tag('puzzle', ['poop-drop','bubble-baseling','lp-lemmings','token-columns','fire-n-ice','rainbow-bridge','reactor-pipes','boulder-baseling','poop-puzznic','kickle-kube','blocks-burg','solomon-key','lolo-puzzle','ooze-battle']);
tag('shmup', ['reactor-force','spore-storm','over-horizon','super-turrican','scat-attack','zombie-nation','legendary-wings','power-blade','crisis-force','metal-storm','spore-invaders','spore-defense']);
tag('racing-sports', ['micro-baselings','rc-reactor','baseling-bowl','blades-of-poop','track-n-field','super-dodge','rad-racer','baseball-stars','cobra-triangle','720-grind']);
tag('rpg-adventure', ['legend-of-tasern','tasern-quest','faxanadu-fungi','river-city-brawl','gargoyle-quest','willow-grove','solstice-tower','startropics-hex','maniac-mansion','pirates-of-tasern','rygar-realm','crystal-quest','whodunit']);
tag('strategy-board', ['archon-battle','elite-trader','north-south-war','rampart-siege','guerrilla-war','spy-hunter','arkanoid-mft','bomberman-poop','adventure-island','chess','checkers','meme-city']);
tag('misc-action', ['marble-madness','snake-rattle','little-nemo','kid-icarus','bucky-ohare','dark-wing','snow-bros','duck-tales','ufouria','little-samson','double-dragon','punch-out','batman-baseling','battletoads','chip-n-dale','tiny-toons','shatter-hand','shadow-ninja','golden-axe','comix-zone','streets-of-tasern','maze-runner','rodeo-toad','swamp-hop','seasons','poop-chomp','poop-out','ecco-deep','rhythm-baseling','reactor-rash','spore-sprint','tasern-pinball']);

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
  games.push({
    slug: base,
    file,
    lineCount,
    genre: GENRE[base] || 'unclassified',
    wager: WAGER.has(base),
    loads: d.loads,
    avatar: d.avatar,
    needsPlayerModule: !d.loads.player,           // every Wave-2 game must add baseling-player.js
    needsSpriteSwap: d.avatar !== 'sprite',        // procedural avatar -> swap to BaselingPlayer.draw
    notes: buildNotes(base, d),
  });
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
  byGenre[g.genre] = byGenre[g.genre] || { count: 0, wager: 0, sprite: 0, procedural: 0, unknown: 0 };
  byGenre[g.genre].count++;
  if (g.wager) byGenre[g.genre].wager++;
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
    proceduralAvatars: games.filter(g => g.avatar === 'procedural').length,
    unknownAvatars: games.filter(g => g.avatar === 'unknown').length,
    alreadyLoadPlayerModule: games.filter(g => g.loads.player).length,
  },
  summaryByGenre: byGenre,
  batches: batches.map(b => ({ id: b.id, genre: b.genre, count: b.games.length, games: b.games })),
  games,
  skipped,
  legend: {
    avatar: { sprite: 'already renders via BaselingSprites/BaselingPlayer', procedural: 'raw ctx-drawn avatar, swap to BaselingPlayer.draw()', unknown: 'inspect before remaster' },
    loads: 'true = the game already includes that shared script',
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
