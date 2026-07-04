/*
  game/seas/audio/audio-core.js — MASTER AUDIO CONTROLLER for "Seize the Seas".

  ONE shared Web Audio AudioContext + a routing tree:

      [source] --> musicGain --\
                                >--> masterGain --> destination (speakers)
      [source] --> sfxGain ----/

  Anything that makes sound (music-manager.js, sfx.js, achievement-chime.js)
  routes through this so the global MUTE + master volume affect everything.

  KEY BEHAVIOURS
  --------------
  • AUTOPLAY BLOCK: browsers suspend the AudioContext until a user gesture.
    Call SeasAudio.unlock() from the first tap/click (title "Tap to Begin").
    unlock() resumes the context and fires any onFirstGesture() callbacks.
  • PERSISTENCE: mute + per-bus volumes saved to localStorage, restored on load.
  • GRACEFUL NO-OP: if Web Audio is unavailable the module still loads and every
    method is a safe no-op — the game never throws because audio failed.

  USAGE (browser, no build step):
      <script src="audio/audio-core.js"></script>
      // then, on first tap:  window.SeasAudio.unlock();

  Exposes a singleton as  window.SeasAudio  and (if module system present)
  module.exports for DOM-less logic tests.
*/
(function (root) {
  "use strict";

  var LS_KEY = "sts_audio_v1"; // { muted, master, music, sfx }

  // ---- Web Audio availability (graceful) ---------------------------------
  var AudioCtx =
    (typeof root !== "undefined" &&
      (root.AudioContext || root.webkitAudioContext)) || null;

  function clamp01(n) {
    n = Number(n);
    if (isNaN(n)) return 1;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // ---- Persistence -------------------------------------------------------
  function loadPrefs() {
    var def = { muted: false, master: 0.9, music: 0.6, sfx: 0.8 };
    try {
      var raw = root.localStorage && root.localStorage.getItem(LS_KEY);
      if (!raw) return def;
      var p = JSON.parse(raw);
      return {
        muted: !!p.muted,
        master: p.master == null ? def.master : clamp01(p.master),
        music: p.music == null ? def.music : clamp01(p.music),
        sfx: p.sfx == null ? def.sfx : clamp01(p.sfx)
      };
    } catch (_e) {
      return def;
    }
  }

  function savePrefs(prefs) {
    try {
      root.localStorage &&
        root.localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    } catch (_e) {
      /* storage may be disabled (private mode) — not fatal, keep in-memory */
    }
  }

  // ---- The controller ----------------------------------------------------
  function AudioCore() {
    this.available = !!AudioCtx;
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.unlocked = false;
    this._gestureCbs = [];
    this._changeCbs = [];
    this.prefs = loadPrefs();

    if (this.available) {
      try {
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.sfxBus = this.ctx.createGain();
        this.musicBus.connect(this.master);
        this.sfxBus.connect(this.master);
        this.master.connect(this.ctx.destination);
        this._applyGains();
      } catch (e) {
        // Constructor failed — fall back to no-op mode, but make it VISIBLE.
        console.warn("[SeasAudio] Web Audio init failed, running silent:", e);
        this.available = false;
      }
    } else {
      console.warn("[SeasAudio] Web Audio unavailable — audio disabled (no-op).");
    }
  }

  // Push current prefs into the gain nodes.
  AudioCore.prototype._applyGains = function () {
    if (!this.available) return;
    var m = this.prefs.muted ? 0 : this.prefs.master;
    // small ramp to avoid clicks
    var t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(m, t, 0.015);
    this.musicBus.gain.setTargetAtTime(this.prefs.music, t, 0.015);
    this.sfxBus.gain.setTargetAtTime(this.prefs.sfx, t, 0.015);
  };

  AudioCore.prototype._emitChange = function () {
    for (var i = 0; i < this._changeCbs.length; i++) {
      try {
        this._changeCbs[i](this.getState());
      } catch (e) {
        console.warn("[SeasAudio] change listener threw:", e);
      }
    }
  };

  // ---- Public: unlock / autoplay ----------------------------------------
  // Call from the FIRST user gesture (tap/click/keydown). Safe to call many times.
  AudioCore.prototype.unlock = function () {
    if (!this.available) return Promise.resolve(false);
    var self = this;
    var resume =
      this.ctx.state === "suspended"
        ? this.ctx.resume()
        : Promise.resolve();
    return resume
      .then(function () {
        if (!self.unlocked) {
          self.unlocked = true;
          var cbs = self._gestureCbs.slice();
          self._gestureCbs.length = 0;
          for (var i = 0; i < cbs.length; i++) {
            try {
              cbs[i]();
            } catch (e) {
              console.warn("[SeasAudio] onFirstGesture cb threw:", e);
            }
          }
        }
        return true;
      })
      .catch(function (e) {
        console.warn("[SeasAudio] resume() failed:", e);
        return false;
      });
  };

  // Register a callback to run once, right after the first successful unlock.
  // If already unlocked, runs on next tick.
  AudioCore.prototype.onFirstGesture = function (cb) {
    if (typeof cb !== "function") return;
    if (this.unlocked) {
      Promise.resolve().then(cb);
    } else {
      this._gestureCbs.push(cb);
    }
  };

  // Convenience: attach one-shot gesture listeners to the document so unlock
  // happens on the very first interaction anywhere. Idempotent.
  AudioCore.prototype.attachAutoUnlock = function (targetDoc) {
    if (!this.available) return;
    var doc = targetDoc || (root.document || null);
    if (!doc || this._autoUnlockBound) return;
    this._autoUnlockBound = true;
    var self = this;
    var evts = ["pointerdown", "touchstart", "mousedown", "keydown"];
    function handler() {
      self.unlock();
      // once unlocked, stop listening
      if (self.unlocked) {
        for (var i = 0; i < evts.length; i++) {
          doc.removeEventListener(evts[i], handler, true);
        }
      }
    }
    for (var i = 0; i < evts.length; i++) {
      doc.addEventListener(evts[i], handler, true);
    }
  };

  // ---- Public: bus access (for music-manager / sfx / chime) --------------
  AudioCore.prototype.getContext = function () {
    return this.ctx;
  };
  AudioCore.prototype.getMasterGain = function () {
    return this.master;
  };
  AudioCore.prototype.getMusicBus = function () {
    return this.musicBus;
  };
  AudioCore.prototype.getSfxBus = function () {
    return this.sfxBus;
  };

  // ---- Public: settings API ---------------------------------------------
  AudioCore.prototype.setMasterVolume = function (v) {
    this.prefs.master = clamp01(v);
    this._applyGains();
    savePrefs(this.prefs);
    this._emitChange();
  };
  AudioCore.prototype.setMusicVolume = function (v) {
    this.prefs.music = clamp01(v);
    this._applyGains();
    savePrefs(this.prefs);
    this._emitChange();
  };
  AudioCore.prototype.setSfxVolume = function (v) {
    this.prefs.sfx = clamp01(v);
    this._applyGains();
    savePrefs(this.prefs);
    this._emitChange();
  };
  AudioCore.prototype.setMuted = function (on) {
    this.prefs.muted = !!on;
    this._applyGains();
    savePrefs(this.prefs);
    this._emitChange();
  };
  AudioCore.prototype.toggleMute = function () {
    this.setMuted(!this.prefs.muted);
    return this.prefs.muted;
  };
  AudioCore.prototype.isMuted = function () {
    return !!this.prefs.muted;
  };

  // Snapshot of current settings (for wiring UI sliders).
  AudioCore.prototype.getState = function () {
    return {
      available: this.available,
      unlocked: this.unlocked,
      muted: this.prefs.muted,
      master: this.prefs.master,
      music: this.prefs.music,
      sfx: this.prefs.sfx
    };
  };

  // Subscribe to settings changes (so a settings panel stays in sync across tabs/pages).
  AudioCore.prototype.onChange = function (cb) {
    if (typeof cb === "function") this._changeCbs.push(cb);
  };

  // ---- Singleton ---------------------------------------------------------
  var instance = new AudioCore();

  // Auto-bind document-level unlock if a DOM is present (harmless in tests).
  if (root.document) instance.attachAutoUnlock(root.document);

  root.SeasAudio = instance;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { AudioCore: AudioCore, instance: instance, clamp01: clamp01 };
  }
})(typeof window !== "undefined" ? window : this);
