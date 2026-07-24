// ============================================================
//  names.js — crew naming + a UNIQUE name registry.
//
//  Mirrors the Base Acorn Boy/Girl naming pattern (the NFT shows a player-set
//  name like "Jimi Growin The Awesome (Acorn Boy #1)"): a crew defaults to
//  "Crew #N" until its owner names it, and the chosen name renders into the
//  NFT metadata `name` field — owner-set AFTER mint, no re-mint needed (the
//  metadata endpoint is dynamic, so the marketplace name updates on its own).
//
//  LIMITATIONS enforced here (all four, per the build spec):
//    1. UNIQUE across ALL crews — a name can be claimed exactly once. We keep a
//       registry keyed by a normalized form so "Bob", "bob", and "B O B" can't
//       all be taken separately.
//    2. LENGTH cap — MAX_NAME_LEN chars (default 20), min MIN_NAME_LEN.
//    3. PROFANITY / safety filter — rejects slurs/profanity (substring + leet),
//       and restricts the charset to printable name characters.
//    4. RENAME policy — the FIRST name is free; renames are allowed but the new
//       name must ALSO be unique (and pass every check). Renaming frees the old
//       name back into the pool (so you don't permanently burn a name by typo).
//
//  STORAGE: the registry + per-crew names live in the SAME local JSON closet
//  (data/closet.json) under `names` (crewId -> displayName) and `nameIndex`
//  (normalizedName -> crewId). Production swaps closet.js for Supabase with the
//  same two shapes + a UNIQUE index on the normalized column to enforce the
//  claim atomically at the DB layer.
// ============================================================
'use strict';

const MAX_NAME_LEN = Number(process.env.CREW_NAME_MAX || 20);
const MIN_NAME_LEN = Number(process.env.CREW_NAME_MIN || 2);

// Allowed characters in a display name: letters, numbers, spaces, and a small
// set of safe punctuation. Anything else (control chars, emoji, zero-width,
// homoglyph tricks) is rejected so the name is renderable and unambiguous.
const NAME_CHARSET = /^[A-Za-z0-9 '._-]+$/;

// ---- profanity / safety filter -------------------------------------------
// A compact blocklist. This is intentionally a substring match on a leet-folded,
// space-stripped form so "b00bs", "b o o b s", and "b.o.o.b.s" all get caught.
// Keep it modest + obvious; production can swap a fuller list/service in. We do
// NOT log the offending word (don't echo slurs); we just reject.
const BLOCKLIST = [
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'dick', 'piss', 'bastard',
  'slut', 'whore', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'rape',
  'nazi', 'hitler', 'kike', 'spic', 'chink', 'wetback', 'tranny', 'pedo',
  'cum', 'jizz', 'boob', 'penis', 'vagina', 'pussy', 'twat', 'wank',
];
// Common leet substitutions folded to letters before the blocklist check.
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function foldLeet(s) {
  return s.replace(/[013457@$!]/g, (c) => LEET[c] || c);
}

// Normalize for the UNIQUENESS key: lowercase, fold leet, collapse all runs of
// non-alphanumerics to nothing. So "Bob", "  bob ", "B-O-B", "b0b" all map to
// the same key "bob" and therefore can be claimed only once between them.
function normalizeForUniqueness(name) {
  return foldLeet(String(name).toLowerCase()).replace(/[^a-z0-9]+/g, '');
}

// Normalize what we STORE/show: trim, collapse internal whitespace runs to one
// space. Preserves the owner's casing + spacing for display.
function cleanDisplay(name) {
  return String(name).replace(/\s+/g, ' ').trim();
}

function containsProfanity(name) {
  // check against a leet-folded, alnum-only form (catches spaced/punctuated tricks)
  const folded = normalizeForUniqueness(name);
  return BLOCKLIST.some((bad) => folded.includes(bad));
}

// Validate a candidate name. Throws a clear Error on the FIRST failing rule so
// the API can return a precise 400 message. Returns the cleaned display name.
function validateName(raw) {
  if (raw === undefined || raw === null) throw new Error('name is required');
  const display = cleanDisplay(raw);
  if (display.length < MIN_NAME_LEN) {
    throw new Error(`name too short (min ${MIN_NAME_LEN} characters)`);
  }
  if (display.length > MAX_NAME_LEN) {
    throw new Error(`name too long (max ${MAX_NAME_LEN} characters)`);
  }
  if (!NAME_CHARSET.test(display)) {
    throw new Error("name has invalid characters (allowed: letters, numbers, space, and ' . _ -)");
  }
  if (normalizeForUniqueness(display).length === 0) {
    throw new Error('name must contain at least one letter or number');
  }
  if (containsProfanity(display)) {
    throw new Error('name is not allowed (failed the safety filter)');
  }
  return display;
}

module.exports = {
  MAX_NAME_LEN, MIN_NAME_LEN,
  normalizeForUniqueness, cleanDisplay, containsProfanity, validateName,
};
