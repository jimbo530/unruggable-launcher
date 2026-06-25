// ============================================================
//  names.js — crew display-name validation + uniqueness normalization.
//  Minimal port of crew-render-ref/names.js: enough to keep names sane and the
//  per-crew uniqueness registry consistent. Profanity list is intentionally tiny
//  here (the live service carries the full list); extend before going live.
// ============================================================

const MIN_LEN = 1;
const MAX_LEN = 24;
// Only letters, numbers, spaces, and a few safe punctuation marks.
const NAME_RE = /^[\p{L}\p{N} ._'-]+$/u;
const BANNED = ['admin', 'null', 'undefined']; // placeholder; extend for production

// Validate + return the cleaned display name, or throw with a precise reason.
function validateName(raw) {
  if (typeof raw !== 'string') throw new Error('name must be a string');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < MIN_LEN) throw new Error('name is empty');
  if (name.length > MAX_LEN) throw new Error('name too long (max ' + MAX_LEN + ')');
  if (!NAME_RE.test(name)) throw new Error('name has invalid characters');
  const low = name.toLowerCase();
  if (BANNED.some((b) => low === b)) throw new Error('name is not allowed');
  return name;
}

// Normalize for the uniqueness registry: case-fold + collapse spacing.
function normalizeForUniqueness(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

module.exports = { validateName, normalizeForUniqueness, MIN_LEN, MAX_LEN };
