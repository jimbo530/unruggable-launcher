/*
  game/seas/audio/sfx.js — Web-Audio-GENERATED sound effects for "Seize the Seas".

  ZERO asset, ZERO cost: every sound is synthesized live from oscillators +
  noise + envelopes, routed through the shared SeasAudio SFX bus (so global
  mute / SFX volume apply). Also supports OPTIONAL file-based SFX declared in
  the manifest's "sfx" map (falls back to synth if the file/name is missing).

  Built-in effects (all short + tasteful):
      coin      — bright two-note "cha-ching"
      hit       — metallic clash / thud (blade on blade)
      splash    — filtered noise burst (cannonball / man overboard)
      ui-click  — soft blip for button taps
      error     — low descending buzz
      win       — short major-arpeggio fanfare
      cannon    — low boom + noise tail

  API:
      const sfx = new SeasSfx(SeasAudio, manifest);
      sfx.play('coin');           // generic dispatcher
      sfx.coin(); sfx.hit(); ...  // named helpers
      sfx.play('example-cannon'); // file-based if in manifest.sfx, else synth

  No-op-safe when Web Audio is unavailable or not yet unlocked.
  Exposes window.SeasSfx (constructor). CommonJS export for tests.
*/
(function (root) {
  "use strict";

  function SeasSfx(core, manifest) {
    this.core = core || (root.SeasAudio || null);
    this.manifest = manifest || {};
    this.sfxFiles = (manifest && manifest.sfx) || {};
    this.sfxBasePath = (manifest && manifest.sfxBasePath) || "sfx/";
    this._buffers = {}; // decoded file cache
  }

  // Can we actually make noise right now?
  SeasSfx.prototype._ready = function () {
    return !!(this.core && this.core.available && this.core.unlocked && this.core.getContext());
  };

  SeasSfx.prototype._ctx = function () {
    return this.core.getContext();
  };
  SeasSfx.prototype._out = function () {
    return this.core.getSfxBus();
  };

  // ---- low-level helpers -------------------------------------------------
  // A single enveloped oscillator tone.
  SeasSfx.prototype._tone = function (opts) {
    if (!this._ready()) return;
    var ctx = this._ctx();
    var t0 = (opts.at != null ? opts.at : ctx.currentTime);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.toFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.toFreq), t0 + opts.dur);
    }
    var peak = opts.gain == null ? 0.3 : opts.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(g);
    g.connect(this._out());
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  };

  // A burst of filtered white noise (splashes, cannon tails, clashes).
  SeasSfx.prototype._noise = function (opts) {
    if (!this._ready()) return;
    var ctx = this._ctx();
    var t0 = (opts.at != null ? opts.at : ctx.currentTime);
    var dur = opts.dur || 0.25;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filt = ctx.createBiquadFilter();
    filt.type = opts.filter || "bandpass";
    filt.frequency.setValueAtTime(opts.freq || 1200, t0);
    if (opts.toFreq) filt.frequency.exponentialRampToValueAtTime(Math.max(80, opts.toFreq), t0 + dur);
    filt.Q.value = opts.q == null ? 0.8 : opts.q;
    var g = ctx.createGain();
    var peak = opts.gain == null ? 0.25 : opts.gain;
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this._out());
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  };

  // ---- named effects -----------------------------------------------------
  SeasSfx.prototype.coin = function () {
    if (!this._ready()) return;
    var t = this._ctx().currentTime;
    this._tone({ type: "square", freq: 988, dur: 0.09, gain: 0.22, at: t });        // B5
    this._tone({ type: "square", freq: 1319, dur: 0.16, gain: 0.22, at: t + 0.07 }); // E6
  };

  SeasSfx.prototype.hit = function () {
    if (!this._ready()) return;
    var t = this._ctx().currentTime;
    // metallic clash: quick high noise + a short low thud
    this._noise({ filter: "bandpass", freq: 2600, toFreq: 900, dur: 0.14, q: 1.2, gain: 0.28, at: t });
    this._tone({ type: "triangle", freq: 180, toFreq: 90, dur: 0.12, gain: 0.25, at: t });
  };

  SeasSfx.prototype.splash = function () {
    if (!this._ready()) return;
    this._noise({ filter: "lowpass", freq: 1800, toFreq: 300, dur: 0.35, q: 0.5, gain: 0.3 });
  };

  SeasSfx.prototype["ui-click"] = function () {
    this._tone({ type: "sine", freq: 660, toFreq: 880, dur: 0.05, gain: 0.16 });
  };
  SeasSfx.prototype.click = function () { this["ui-click"](); };

  SeasSfx.prototype.error = function () {
    if (!this._ready()) return;
    var t = this._ctx().currentTime;
    this._tone({ type: "sawtooth", freq: 220, toFreq: 110, dur: 0.28, gain: 0.2, at: t });
  };

  SeasSfx.prototype.win = function () {
    if (!this._ready()) return;
    var t = this._ctx().currentTime;
    // C-E-G-C major arpeggio
    var notes = [523.25, 659.25, 783.99, 1046.5];
    for (var i = 0; i < notes.length; i++) {
      this._tone({ type: "triangle", freq: notes[i], dur: 0.22, gain: 0.22, at: t + i * 0.09 });
    }
  };
  SeasSfx.prototype.fanfare = function () { this.win(); };

  SeasSfx.prototype.cannon = function () {
    if (!this._ready()) return;
    var t = this._ctx().currentTime;
    this._tone({ type: "sine", freq: 90, toFreq: 40, dur: 0.35, gain: 0.35, at: t });
    this._noise({ filter: "lowpass", freq: 900, toFreq: 200, dur: 0.4, q: 0.4, gain: 0.3, at: t });
  };

  // ---- file-based SFX (optional) ----------------------------------------
  SeasSfx.prototype._playFile = function (name) {
    var self = this;
    var ctx = this._ctx();
    if (this._buffers[name]) {
      this._emitBuffer(this._buffers[name]);
      return true;
    }
    var entry = this.sfxFiles[name];
    var file = entry && (entry.ogg || entry.mp3 || entry.file || entry);
    if (!file || typeof root.fetch !== "function" || !ctx.decodeAudioData) return false;
    root
      .fetch(this.sfxBasePath + file)
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return ctx.decodeAudioData(ab); })
      .then(function (buf) {
        self._buffers[name] = buf;
        self._emitBuffer(buf);
      })
      .catch(function (e) {
        console.warn("[SeasSfx] file '" + name + "' failed, no fallback synth for it:", e);
      });
    return true;
  };

  SeasSfx.prototype._emitBuffer = function (buf) {
    if (!this._ready()) return;
    var ctx = this._ctx();
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._out());
    src.start();
  };

  // ---- generic dispatcher ------------------------------------------------
  SeasSfx.prototype.play = function (name) {
    if (!name) return;
    // file-based takes precedence if declared in manifest
    if (this.sfxFiles[name]) {
      if (this._playFile(name)) return;
    }
    var fn = this[name];
    if (typeof fn === "function") {
      fn.call(this);
    } else {
      console.warn("[SeasSfx] unknown effect '" + name + "'.");
    }
  };

  root.SeasSfx = SeasSfx;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { SeasSfx: SeasSfx };
  }
})(typeof window !== "undefined" ? window : this);
