// Resolve harness (staging only) — proves the ported SPECIES logic against the
// staged ship-species.js + asset-manifest.js + the real data/ship-species.json and
// the real assets/base/<species>/ art. No sharp/aura needed (pure resolution).
const fs = require('fs');
const path = require('path');
const { speciesForCrewKey, getShipSpecies, DB_FILE } = require('./ship-species');
const { speciesId, speciesName, speciesBodyRel } = require('./asset-manifest');

const ASSETS = path.join(__dirname, '..', 'assets'); // same as render.js ASSETS

// Mirror render.js baseFile(): pick the body PNG for a species+gender with fallback.
function baseFile(base, species) {
  const r = speciesBodyRel(species, base, ASSETS, fs.existsSync);
  return { file: path.join(ASSETS, r.rel), rel: r.rel, species: r.species, fellBack: r.fellBack };
}

console.log('DB_FILE:', DB_FILE, 'exists:', fs.existsSync(DB_FILE));
console.log('ASSETS :', ASSETS, 'exists:', fs.existsSync(ASSETS));
console.log('');

let fail = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + ' => ' + got + (ok ? '' : '  (wanted ' + want + ')'));
}

// 1) crewKey -> species (mapped addresses + token suffix), seed slug, unmapped fallback.
check('orc addr :5      ', speciesForCrewKey('0x2E2AB7ae48876f1b4497a04d864c025f7df58e1f:5'), 'orc');
check('elf addr :12     ', speciesForCrewKey('0x9500880dec9b310b4a728c75a271a25615a2443e:12'), 'elf');
check('goblin addr :1   ', speciesForCrewKey('0x4ece491951b759363bcbaf75389a202fe0584080:1'), 'goblin');
check('human addr :99   ', speciesForCrewKey('0x8c1f935f6dbb17d593bf3ec8114a2f045e350545:99'), 'human');
check('redrum-raiders:3 ', speciesForCrewKey('redrum-raiders:3'), 'goblin');     // seed default
check('black-tide:7     ', speciesForCrewKey('black-tide:7'), 'orc');            // seed default
check('UNMAPPED addr :7 ', speciesForCrewKey('0xDEADBEEFdeadbeefdeadbeefdeadbeefdeadbeef:7'), 'human'); // DEFAULT_SHIP_SPECIES, not a crash
check('no-crewKey path  ', speciesId(undefined), 'acorn');                       // render.js path when look has no crewKey

console.log('');
// 2) baseFile picks the right body art path for the resolved species (boy + girl).
const orc = baseFile('boy', speciesForCrewKey('0x2E2AB7ae48876f1b4497a04d864c025f7df58e1f:5'));
check('orc boy rel      ', orc.rel, 'base/orc/orcboy.png');
check('orc boy fellBack ', orc.fellBack, false);
console.log('     orc boy file on disk:', fs.existsSync(orc.file), orc.file);

const elfGirl = baseFile('girl', speciesForCrewKey('0x9500880dec9b310b4a728c75a271a25615a2443e:12'));
check('elf girl rel     ', elfGirl.rel, 'base/elf/elfgirl.png');
console.log('     elf girl file on disk:', fs.existsSync(elfGirl.file), elfGirl.file);

// 3) unmapped crew -> human body art (default), still valid art on disk.
const unmapped = baseFile('boy', speciesForCrewKey('0xDEADBEEFdeadbeefdeadbeefdeadbeefdeadbeef:7'));
check('unmapped->human  ', unmapped.rel, 'base/human/humanboy.png');
console.log('     human boy file on disk:', fs.existsSync(unmapped.file), unmapped.file);

// 4) species with NO art (skeleton) -> ACORN fallback, never a crash.
const skel = baseFile('boy', 'skeleton');
check('skeleton->acorn  ', skel.rel, 'base/acornboy.png');
check('skeleton fellBack', skel.fellBack, true);
console.log('     acorn boy file on disk:', fs.existsSync(skel.file), skel.file);

// 5) trait label sanity.
check('speciesName orc  ', speciesName('orc'), 'Orc');
check('speciesName unkwn', speciesName('nope'), 'Acorn');

console.log('\n' + (fail ? ('*** ' + fail + ' FAILURES ***') : 'ALL RESOLVE CHECKS PASSED'));
process.exit(fail ? 1 : 0);
