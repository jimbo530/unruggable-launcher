/*
  audio.selftest.cjs — DOM-less logic tests for the Seas audio system.
  Runs under plain node (no browser, no Web Audio). Verifies:
   • graceful no-op when Web Audio is unavailable
   • prefs persistence via a fake localStorage
   • clamp + mute/volume state transitions
   • music-manager rotation + scene queueing while "locked"
   • sfx dispatcher recognizes built-ins and warns (not throws) on unknown
  Run:  node game/seas/audio/audio.selftest.cjs
*/
"use strict";

var assert = require("assert");
var path = require("path");

// ---- fake browser globals (no Web Audio on purpose) --------------------
var store = {};
global.window = global; // modules attach to `window`; alias to global
global.localStorage = {
  getItem: function (k) { return k in store ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
// NO AudioContext defined → exercises the graceful no-op path.
// NO document → attachAutoUnlock is skipped.

var core = require(path.join(__dirname, "audio-core.js")).instance;
var mm = require(path.join(__dirname, "music-manager.js"));
var sfxMod = require(path.join(__dirname, "sfx.js"));

var pass = 0;
function ok(name) { pass++; console.log("  ok  - " + name); }

// ---- audio-core: no-op + persistence ----------------------------------
assert.strictEqual(core.available, false, "should be unavailable (no AudioContext)");
ok("core degrades gracefully with no Web Audio");

core.setMusicVolume(0.42);
core.setSfxVolume(0.7);
core.setMuted(true);
var s = core.getState();
assert.strictEqual(s.music, 0.42);
assert.strictEqual(s.sfx, 0.7);
assert.strictEqual(s.muted, true);
ok("volumes + mute stored in state");

// clamp
core.setMasterVolume(5);
assert.strictEqual(core.getState().master, 1, "master clamps to 1");
core.setMasterVolume(-3);
assert.strictEqual(core.getState().master, 0, "master clamps to 0");
ok("volume clamps to [0,1]");

// persisted?
var raw = JSON.parse(store["sts_audio_v1"]);
assert.strictEqual(raw.music, 0.42);
assert.strictEqual(raw.muted, true);
ok("prefs persisted to localStorage");

// change listener fires
var fired = 0;
core.onChange(function () { fired++; });
core.toggleMute();
assert.ok(fired >= 1, "onChange fired");
ok("onChange listener fires on settings change");

// unlock() resolves false with no engine and doesn't throw.
// With no engine there is nothing to unlock, so gesture callbacks do NOT fire
// (that's correct: no point running audio-start work when audio can't play).
var gestureRan = false;
core.onFirstGesture(function () { gestureRan = true; });
core.unlock().then(function (r) {
  assert.strictEqual(r, false, "unlock resolves false with no engine");
});

// ---- music-manager: rotation + queue-while-locked ----------------------
var manifest = {
  basePath: "music/",
  scenes: {
    tavern: [{ ogg: "a.ogg", mp3: "a.mp3" }, { ogg: "b.ogg", mp3: "b.mp3" }],
    sea: [{ ogg: "sea.ogg" }],
    default: [{ ogg: "d.ogg" }]
  }
};
var music = new mm.SeasMusic(core, manifest);
music.init();

// _resolve rotates through the tavern list
// (no DOM probe in node → pickSrc chooses the mp3 fallback; we assert on the base name)
var r1 = music._resolve("tavern");
var r2 = music._resolve("tavern");
assert.ok(/[\\/]a\.(ogg|mp3)$/.test(r1.src), "first tavern track is 'a' (" + r1.src + ")");
assert.ok(/[\\/]b\.(ogg|mp3)$/.test(r2.src), "second tavern track rotates to 'b' (" + r2.src + ")");
ok("music rotates multiple tracks per scene");

// unknown scene falls back to default
var rd = music._resolve("nonexistent-scene");
assert.ok(rd && /[\\/]d\.(ogg|mp3)$/.test(rd.src), "unknown scene falls back to default track");
ok("unknown scene falls back to default");

// setScene while not-unlocked just queues (no throw, engine unavailable)
music.setScene("sea");
assert.strictEqual(music.getScene(), "sea", "scene queued while locked/unavailable");
ok("setScene queues target while audio locked");

// normTrack + pickSrc units
assert.deepStrictEqual(mm.normTrack("x.ogg"), { file: "x.ogg" });
assert.ok(/music\/x\.mp3$/.test(mm.pickSrc("music/", { mp3: "x.mp3" }, function(){ return false; })));
ok("normTrack + pickSrc helpers behave");

// ---- sfx: dispatcher recognizes built-ins, warns on unknown ------------
var sfx = new sfxMod.SeasSfx(core, manifest);
// not ready (no engine) → every call is a safe no-op, must not throw
sfx.play("coin");
sfx.play("hit");
sfx.play("win");
sfx.coin();
ok("sfx calls are safe no-ops when engine unavailable");

// unknown name should warn, not throw
var warned = false;
var origWarn = console.warn;
console.warn = function () { warned = true; origWarn.apply(console, arguments); };
sfx.play("does-not-exist");
console.warn = origWarn;
assert.ok(warned, "unknown sfx warns");
ok("unknown sfx warns (not throws)");

// ---- engine PATH: fake AudioContext so unlock() + gesture callbacks fire --
// Fresh module instance with a minimal fake Web Audio API.
function fakeGain() {
  return {
    gain: {
      value: 1,
      setTargetAtTime: function () {},
      setValueAtTime: function () {},
      cancelScheduledValues: function () {},
      linearRampToValueAtTime: function () {}
    },
    connect: function () {}
  };
}
global.AudioContext = function () {
  this.state = "suspended";
  this.currentTime = 0;
  this.destination = {};
  var self = this;
  this.createGain = fakeGain;
  this.resume = function () { self.state = "running"; return Promise.resolve(); };
};

delete require.cache[require.resolve(path.join(__dirname, "audio-core.js"))];
var core2 = require(path.join(__dirname, "audio-core.js")).instance;
assert.strictEqual(core2.available, true, "core2 sees the fake AudioContext");
ok("core initializes gain graph when Web Audio present");

var gestureRan2 = false;
core2.onFirstGesture(function () { gestureRan2 = true; });
core2.unlock().then(function (r) {
  assert.strictEqual(r, true, "unlock resolves true with an engine");
  assert.strictEqual(core2.unlocked, true, "core marked unlocked");
});

setTimeout(function () {
  assert.strictEqual(gestureRan, false, "onFirstGesture must NOT fire when no audio engine exists");
  ok("onFirstGesture correctly skipped when audio unavailable");
  assert.strictEqual(gestureRan2, true, "onFirstGesture fires after real unlock()");
  ok("onFirstGesture fires after unlock() when engine present");
  console.log("\nAll " + pass + " audio self-tests passed.");
}, 40);
