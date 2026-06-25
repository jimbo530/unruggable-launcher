// @ts-check
/**
 * index.js — public barrel for the Cause = Class engine.
 *
 * Usage:
 *   import { resolve, makeConfig } from "./game/class-engine/index.js";
 *   const config = makeConfig();                 // example config (designer replaces)
 *   const view = resolve({ reforestation: 4 }, config);
 *
 * The endowment object is a STUB. Later it is produced by the on-chain vault /
 * cross-version oracle and passed in unchanged — the engine never reads a chain.
 */

export * from "./schema.js";
export * from "./resolver.js";

import { validateConfig } from "./schema.js";
import { CAUSES } from "./config/causes.js";
import { CLASSES } from "./config/classes.js";

/**
 * Build + validate the bundled EXAMPLE config. Designers swap CAUSES/CLASSES or
 * pass their own arrays here.
 * @param {{ causes?: any[], classes?: any[] }} [override]
 */
export function makeConfig(override = {}) {
  const config = {
    causes: override.causes || CAUSES,
    classes: override.classes || CLASSES,
  };
  return validateConfig(config);
}

export { CAUSES, CLASSES };
