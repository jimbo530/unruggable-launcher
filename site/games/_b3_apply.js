// One-off helper for batch-3: applies the 3 MECHANICAL, identical-structure edits to a
// standard TAS-engine shmup game file (script tag, statB recompute synthesis, initTouch c).
// Per-game unique work (drawBaseling anim, title C-key, title preview, D&D text remap) by hand.
'use strict';
const fs = require('fs');
const path = require('path');
const slug = process.argv[2];
if (!slug) { console.error('usage: node _b3_apply.js <slug>'); process.exit(1); }
const file = path.join(__dirname, slug + '.html');
let txt = fs.readFileSync(file, 'utf8');
const before = txt;
function must(re, what) { if (!re.test(txt)) { console.error('MISSING ANCHOR in ' + slug + ': ' + what); process.exit(2); } }

if (txt.indexOf('baseling-player.js') === -1) {
  must(/<script src="baseling-sprites\.js"><\/script>/, 'baseling-sprites tag');
  txt = txt.replace('<script src="baseling-sprites.js"></script>',
    '<script src="baseling-sprites.js"></script>\n<script src="baseling-player.js"></script>');
}

const statBLine = /var statB = \{ damage: 1[^\n]*icon: 'B' \};\n/;
must(statBLine, 'var statB legacy line');
const tryLine = /try \{ if \(window\.NftLoader && NftLoader\.getStatBonuses\) statB = NftLoader\.getStatBonuses\(\); \} catch\(e\) \{[^\n]*\}\n/;
must(tryLine, 'try getStatBonuses line');

const block =
`var statB = { damage: 1, speed: 1, lives: 0, hpMult: 1, scoreMult: 1, cooldown: 1, luck: 1, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, level: 0, color: '#44dd88', name: 'Baseling', icon: 'B' };
// BASELING STAT INTEGRATION (via BaselingPlayer.getMults — see ARCADE-STATS.md).
// Shmup, not a wager game -> single-player band 0.8–1.6. SPD->ship speed, STA->shield/HP,
// PWR->shot damage, LCK->powerup drops, SWM unused. This game's helpers read old D&D
// fields, so we synthesize them from the clamped multipliers; every gameplay number
// traces back to a clamped getMults().
try {
  if (window.NftLoader && NftLoader.getStatBonuses) {
    var _b = NftLoader.getStatBonuses();
    if (_b) { statB.color = _b.color || statB.color; statB.name = _b.name || statB.name; statB.icon = _b.icon || statB.icon; statB.level = _b.level || statB.level; }
  }
} catch (e) { console.warn('[${slug}] NftLoader display info failed:', e && e.message); }
function recomputeStats() {
  var m = (window.BaselingPlayer && BaselingPlayer.getMults) ? BaselingPlayer.getMults() : { moveSpeed: 1, health: 1, damage: 1, luck: 1, swim: 1 };
  function dnd(x) { return Math.round(10 + (x - 1) * 20); }
  statB.damage = m.damage; statB.speed = m.moveSpeed; statB.hpMult = m.health; statB.luck = m.luck;
  statB.scoreMult = 1; statB.cooldown = 1 / m.moveSpeed; statB.lives = m.health > 1.3 ? 1 : 0;
  statB.str = dnd(m.damage); statB.dex = dnd(m.moveSpeed); statB.con = dnd(m.health);
  statB.int = dnd(m.luck); statB.wis = dnd(m.luck); statB.cha = dnd(m.luck);
}
recomputeStats();
var picking = false; // baseling character-select overlay is open
if (window.BaselingPlayer && BaselingPlayer.init) {
  BaselingPlayer.init().then(function () { recomputeStats(); }).catch(function (e) { console.warn('[${slug}] player init failed:', e && e.message); });
}
`;
const twoLines = new RegExp(statBLine.source + tryLine.source);
must(twoLines, 'consecutive statB+try lines');
txt = txt.replace(twoLines, block);

const it = /TAS\.input\.initTouch\(\{ buttons: \['a',\s*'b'\], labels: \{ a: '([^']*)', b: '([^']*)' \} \}\);/;
if (it.test(txt)) {
  txt = txt.replace(it, "TAS.input.initTouch({ buttons: ['a', 'b', 'c'], labels: { a: '$1', b: '$2', c: 'PICK' } });");
} else {
  console.warn('NOTE ' + slug + ': initTouch a/b pattern not found — add c by hand if needed');
}

if (txt === before) { console.log(slug + ': no change'); }
else { fs.writeFileSync(file, txt); console.log(slug + ': applied mechanical edits'); }
