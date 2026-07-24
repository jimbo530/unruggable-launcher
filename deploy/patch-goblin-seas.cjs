#!/usr/bin/env node
// patch-goblin-seas.cjs — surgically back-port the GOBLIN-CAVE fight dispatch onto the LIVE VPS
// seas-server.js (which predates the local harvest feature, so the full local file can't be deployed
// as-is). Three EXACT string replacements, identical to the reviewed local edits. Idempotent: refuses
// to double-apply. No funds/keys touched — this only teaches the combat referee a second fight kind.
const fs = require('fs');
const FILE = process.argv[2] || '/var/www/tasern/server/seas-server.js';
let s = fs.readFileSync(FILE, 'utf8');
const before = s;

if (s.includes("'goblin-cave':")) { console.log('ALREADY PATCHED — no change'); process.exit(0); }

// ── EDIT 1: load goblin-cave alongside bilge in init() ───────────────────────────────────
const E1_FROM = `    const bilge = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'bilge-rats.js')).href);
    if (typeof resolver.resolveEncounter !== 'function' || !engine.SPELLS || typeof bilge.buildBilgeEnemies !== 'function') {
      throw new Error('[seas] combat modules did not export the expected verify API (resolveEncounter / SPELLS / buildBilgeEnemies)');
    }
    COMBAT = { resolveEncounter: resolver.resolveEncounter, SPELLS: engine.SPELLS, bilge };`;
const E1_TO = `    const bilge = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'bilge-rats.js')).href);
    const goblin = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'goblin-cave.js')).href);
    if (typeof resolver.resolveEncounter !== 'function' || !engine.SPELLS || typeof bilge.buildBilgeEnemies !== 'function') {
      throw new Error('[seas] combat modules did not export the expected verify API (resolveEncounter / SPELLS / buildBilgeEnemies)');
    }
    if (typeof goblin.buildGoblinEnemies !== 'function' || typeof goblin.caveTerrain !== 'function') {
      throw new Error('[seas] goblin-cave module did not export the expected verify API (buildGoblinEnemies / caveTerrain)');
    }
    COMBAT = { resolveEncounter: resolver.resolveEncounter, SPELLS: engine.SPELLS, bilge, goblin };`;

// ── EDIT 2: register goblin-cave as a known fight kind (generic builder map) ───────────────
const E2_FROM = `const FIGHT_KINDS = { 'bilge-rats': true };`;
const E2_TO = `const FIGHT_KINDS = {
  'bilge-rats':  { mod: 'bilge',  buildEnemies: 'buildBilgeEnemies',  terrain: 'bilgeTerrain', grid: 'SQUAD_GRID' },
  'goblin-cave': { mod: 'goblin', buildEnemies: 'buildGoblinEnemies', terrain: 'caveTerrain',  grid: 'SQUAD_GRID' },
};`;

// ── EDIT 3: dispatch verifyFight by fight kind (bilge rats vs goblin cave) ──────────────────
const E3_FROM = `  const { resolveEncounter, SPELLS, bilge } = requireCombat();
  const seed = rec.seed; // SERVER-PINNED — ignore any client-sent seed (anti-grind)

  // Reconstruct the rats from the seed alone (the SAME builder the client used → matching ids/hexes).
  const playerHexes = playerTeam.map((u) => u && u.position).filter(Boolean);
  const enemyTeam = bilge.buildBilgeEnemies(seed, playerHexes);
  const result = resolveEncounter({
    seed, playerTeam, enemyTeam, playerActions,
    spellbook: SPELLS, terrain: bilge.bilgeTerrain(), grid: bilge.SQUAD_GRID,
  });`;
const E3_TO = `  const COMBAT_ = requireCombat();
  const { resolveEncounter, SPELLS } = COMBAT_;
  const seed = rec.seed; // SERVER-PINNED — ignore any client-sent seed (anti-grind)

  // Resolve which combat module + builders this fight kind uses (bilge rats vs goblin cave).
  const kind = FIGHT_KINDS[rec.fight];
  if (!kind) throw new HttpError(400, \`cannot verify unknown fight "\${rec.fight}"\`);
  const mod = COMBAT_[kind.mod];

  // Reconstruct the foes from the seed alone (the SAME builder the client used → matching ids/hexes).
  const playerHexes = playerTeam.map((u) => u && u.position).filter(Boolean);
  const enemyTeam = mod[kind.buildEnemies](seed, playerHexes);
  const result = resolveEncounter({
    seed, playerTeam, enemyTeam, playerActions,
    spellbook: SPELLS, terrain: mod[kind.terrain](), grid: mod[kind.grid],
  });`;

for (const [n, from, to] of [['EDIT1', E1_FROM, E1_TO], ['EDIT2', E2_FROM, E2_TO], ['EDIT3', E3_FROM, E3_TO]]) {
  const i = s.indexOf(from);
  if (i === -1) { console.error(`FAILED: ${n} anchor not found — aborting, file unchanged`); process.exit(1); }
  if (s.indexOf(from, i + 1) !== -1) { console.error(`FAILED: ${n} anchor not unique — aborting`); process.exit(1); }
  s = s.replace(from, to);
  console.log(`applied ${n}`);
}

if (s === before) { console.error('FAILED: no change produced'); process.exit(1); }
fs.writeFileSync(FILE, s);
console.log('PATCHED OK ->', FILE);
