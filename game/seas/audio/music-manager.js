/*
  game/seas/audio/music-manager.js — per-SCENE looping background music
  with CROSSFADE on scene change, for "Seize the Seas".

  Data-driven from audio-manifest.json. Each scene maps to one or more tracks;
  if a scene has multiple tracks it ROTATES between them each time you setScene()
  to that scene (so the tavern doesn't play the same shanty every visit).

  Playback uses HTMLAudioElement (streams, tiny memory, seamless loop via .loop)
  routed through the shared SeasAudio music bus so global mute/volume apply.
  We fade with per-track GainNodes on the graph, not element.volume, so a mute
  on the master bus silences everything instantly and correctly.

  API:
      const mm = new SeasMusic(SeasAudio, manifest);   // manifest = parsed JSON
      await mm.init();            // (optional) preloads nothing heavy; safe
      mm.setScene('sea');         // crossfade into the sea scene
      mm.play(); mm.pause(); mm.stop();
      mm.setMusicVolume(0.6);     // delegates to SeasAudio music bus
      mm.toggleMute();            // delegates to SeasAudio

  Autoplay: if SeasAudio isn't unlocked yet, setScene() remembers the target
  and starts as soon as SeasAudio.unlock() fires (via onFirstGesture).

  Exposes window.SeasMusic (constructor). CommonJS export for tests.
*/
(function (root) {
  "use strict";

  var CROSSFADE_SEC = 1.6;

  function noop() {}

  // Normalize a manifest track entry to { ogg, mp3, gain, loopStart, loopEnd }.
  function normTrack(entry) {
    if (typeof entry === "string") return { file: entry };
    return entry || {};
  }

  // Pick the best source URL the browser can play (ogg preferred, mp3 fallback).
  function pickSrc(basePath, track, probe) {
    var ogg = track.ogg || (track.file && /\.ogg$/i.test(track.file) ? track.file : null);
    var mp3 = track.mp3 || (track.file && /\.mp3$/i.test(track.file) ? track.file : null);
    var canOgg = probe ? probe('audio/ogg; codecs="vorbis"') : "maybe";
    if (ogg && canOgg) return basePath + ogg;
    if (mp3) return basePath + mp3;
    if (ogg) return basePath + ogg; // last resort — try ogg anyway
    if (track.file) return basePath + track.file;
    return null;
  }

  function SeasMusic(core, manifest) {
    this.core = core || (root.SeasAudio || null);
    this.manifest = manifest || { basePath: "music/", scenes: {} };
    this.basePath = this.manifest.basePath || "music/";
    this.scenes = this.manifest.scenes || {};
    this._rotIdx = {}; // scene -> next track index (rotation)
    this.current = null; // { el, gain, scene }
    this.pending = null; // scene queued until unlock
    this.paused = false;
    this._boundUnlock = false;
  }

  // Feature-probe for element playback (DOM only). No-op-safe in tests.
  SeasMusic.prototype._probe = function () {
    if (this._probeEl === undefined) {
      try {
        this._probeEl = root.document ? root.document.createElement("audio") : null;
      } catch (_e) {
        this._probeEl = null;
      }
    }
    var el = this._probeEl;
    return function (type) {
      if (!el || !el.canPlayType) return false;
      var r = el.canPlayType(type);
      return r === "probably" || r === "maybe";
    };
  };

  SeasMusic.prototype.init = function () {
    // Ensure we start playing the queued scene once audio is unlocked.
    if (this.core && !this._boundUnlock) {
      this._boundUnlock = true;
      var self = this;
      this.core.onFirstGesture(function () {
        if (self.pending && !self.paused) {
          var s = self.pending;
          self.pending = null;
          self.setScene(s);
        }
      });
    }
    return Promise.resolve(this);
  };

  // Resolve a scene name to a concrete src URL, honoring rotation.
  SeasMusic.prototype._resolve = function (scene) {
    var list = this.scenes[scene] || this.scenes["default"] || null;
    if (!list || !list.length) return null;
    var i = this._rotIdx[scene] || 0;
    var track = normTrack(list[i % list.length]);
    this._rotIdx[scene] = (i + 1) % list.length;
    var src = pickSrc(this.basePath, track, this._probe());
    return src ? { src: src, gain: track.gain == null ? 1 : track.gain, track: track } : null;
  };

  // Core operation: crossfade from current track to the new scene's track.
  SeasMusic.prototype.setScene = function (scene) {
    if (!scene) return;
    // No audio engine → nothing to do (but remember intent for demo/logic).
    if (!this.core || !this.core.available) {
      this.pending = scene;
      return;
    }
    // Not unlocked yet → queue; init()'s onFirstGesture will start it.
    if (!this.core.unlocked) {
      this.pending = scene;
      return;
    }
    // Same scene already playing? do nothing (avoid restart on repeated calls).
    if (this.current && this.current.scene === scene && !this.paused) return;

    var resolved = this._resolve(scene);
    if (!resolved) {
      // Scene has no (droppable) track yet — fade out whatever plays, stay silent.
      console.warn("[SeasMusic] no track for scene '" + scene + "' (drop a file + manifest line).");
      this._fadeOutCurrent();
      return;
    }

    var ctx = this.core.getContext();
    var bus = this.core.getMusicBus();
    var el, node;
    try {
      el = new root.Audio();
      el.src = resolved.src;
      el.loop = true;
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      // Route element through Web Audio so master mute/volume apply.
      var srcNode = ctx.createMediaElementSource(el);
      node = ctx.createGain();
      node.gain.value = 0;
      srcNode.connect(node);
      node.connect(bus);
    } catch (e) {
      console.warn("[SeasMusic] failed to build track for '" + scene + "':", e);
      return;
    }

    var t = ctx.currentTime;
    var target = resolved.gain;
    node.gain.setValueAtTime(0, t);
    node.gain.linearRampToValueAtTime(target, t + CROSSFADE_SEC);

    var playPromise = el.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(function (err) {
        console.warn("[SeasMusic] play() rejected (autoplay?):", err);
      });
    }

    // Fade out + tear down the previous track.
    this._fadeOutCurrent();

    this.current = { el: el, gain: node, scene: scene, src: resolved.src };
    this.paused = false;
  };

  SeasMusic.prototype._fadeOutCurrent = function () {
    var cur = this.current;
    if (!cur) return;
    this.current = null;
    var ctx = this.core.getContext();
    var t = ctx.currentTime;
    try {
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(0, t + CROSSFADE_SEC);
    } catch (_e) {}
    var el = cur.el;
    setTimeout(function () {
      try {
        el.pause();
        el.src = "";
      } catch (_e) {}
    }, (CROSSFADE_SEC + 0.2) * 1000);
  };

  SeasMusic.prototype.play = function () {
    this.paused = false;
    if (this.current && this.current.el) {
      var p = this.current.el.play();
      if (p && p.catch) p.catch(noop);
    } else if (this.pending) {
      var s = this.pending;
      this.pending = null;
      this.setScene(s);
    }
  };

  SeasMusic.prototype.pause = function () {
    this.paused = true;
    if (this.current && this.current.el) {
      try {
        this.current.el.pause();
      } catch (_e) {}
    }
  };

  SeasMusic.prototype.stop = function () {
    this.paused = true;
    if (this.current) {
      this._fadeOutCurrent();
    }
    this.pending = null;
  };

  // Delegate volume/mute to the shared controller (single source of truth).
  SeasMusic.prototype.setMusicVolume = function (v) {
    if (this.core) this.core.setMusicVolume(v);
  };
  SeasMusic.prototype.toggleMute = function () {
    return this.core ? this.core.toggleMute() : false;
  };

  // Which scene is currently playing (or queued)? Handy for tests/UI.
  SeasMusic.prototype.getScene = function () {
    return (this.current && this.current.scene) || this.pending || null;
  };

  root.SeasMusic = SeasMusic;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      SeasMusic: SeasMusic,
      normTrack: normTrack,
      pickSrc: pickSrc
    };
  }
})(typeof window !== "undefined" ? window : this);
