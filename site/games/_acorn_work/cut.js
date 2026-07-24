// Wrapper: cut out an Acorn NFT character with the locked, verified parameters.
// Usage: node cut.js <in.png> <out.png>
// Runs key.js with the tuned env so every variant uses the same recipe.
const { execFileSync } = require('child_process');
const path = require('path');
const inP = process.argv[2], outP = process.argv[3];
if (!inP || !outP) { console.error('usage: node cut.js <in.png> <out.png>'); process.exit(1); }
const env = Object.assign({}, process.env, {
  VAL_LO: '105',        // linen value floor (protect darker cap bumps as figure)
  OPEN_R: '0',          // morph-open OFF (its connectivity assumption breaks the face)
  CLOSE_C: '5',         // solidify the fuzzy acorn cap
  GROUND_FRAC: '0.085', // strip the cast shadow in the bottom 8.5%
  // TEX_MIN omitted -> key.js computes it adaptively per image (weave smoothness varies)
  POCKET_MIN: '900',    // enclosed bg >= this stays transparent (leg gaps); smaller filled
  KEEP_MIN: '2000',     // keep every figure component >= this (preserves the face)
  SCRUB: '1', SCRUB_SKIP_TOP: '0', // remove residual textured linen everywhere (cap refilled by close)
  PRUNE_R: '2', PRUNE_MIN: '1500', // sever thin-thread stray specks; real thin features survive
});
delete env.TEX_MIN; // force adaptive per-image texture threshold
execFileSync(process.execPath, [path.join(__dirname, 'key.js'), inP, outP, '1'], { stdio: 'inherit', env });
