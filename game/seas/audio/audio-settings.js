/*
  game/seas/audio/audio-settings.js — tiny settings API + a drop-in HTML control
  for "Seize the Seas". Builds a small panel (mute toggle + music/SFX sliders)
  the client can inject anywhere. Everything respects the global mute.

  Also provides SeasAudioSystem.boot() — the ONE-LINE integration that:
    • loads audio-manifest.json,
    • constructs the music manager + sfx kit,
    • wires them to the shared SeasAudio controller,
  and returns { core, music, sfx, settings }.

  Load order (browser):
      <script src="audio/audio-core.js"></script>
      <script src="audio/music-manager.js"></script>
      <script src="audio/sfx.js"></script>
      <script src="audio/audio-settings.js"></script>
      <script>
        SeasAudioSystem.boot({ manifestUrl: 'audio/audio-manifest.json' })
          .then(sys => { window.Seas = sys; });
      </script>

  Exposes window.SeasAudioSystem. CommonJS export for tests.
*/
(function (root) {
  "use strict";

  // ---- Settings control (DOM) -------------------------------------------
  // Returns a DOM element (or null if no document). Reflects + drives SeasAudio.
  function buildControl(core, doc) {
    doc = doc || root.document;
    if (!doc) return null;
    var wrap = doc.createElement("div");
    wrap.className = "sts-audio-settings";
    wrap.innerHTML =
      '<div class="sts-audio-row">' +
      '  <label class="sts-audio-mute"><input type="checkbox" data-a="mute"> Mute all</label>' +
      "</div>" +
      '<div class="sts-audio-row">' +
      '  <label>Music <input type="range" min="0" max="1" step="0.01" data-a="music"></label>' +
      "</div>" +
      '<div class="sts-audio-row">' +
      '  <label>Effects <input type="range" min="0" max="1" step="0.01" data-a="sfx"></label>' +
      "</div>";

    var muteEl = wrap.querySelector('[data-a="mute"]');
    var musicEl = wrap.querySelector('[data-a="music"]');
    var sfxEl = wrap.querySelector('[data-a="sfx"]');

    function sync(state) {
      muteEl.checked = state.muted;
      musicEl.value = state.music;
      sfxEl.value = state.sfx;
      musicEl.disabled = state.muted;
      sfxEl.disabled = state.muted;
    }

    if (core) {
      sync(core.getState());
      core.onChange(sync);
      muteEl.addEventListener("change", function () {
        core.unlock(); // any settings interaction is a valid gesture too
        core.setMuted(muteEl.checked);
      });
      musicEl.addEventListener("input", function () {
        core.setMusicVolume(parseFloat(musicEl.value));
      });
      sfxEl.addEventListener("input", function () {
        core.setSfxVolume(parseFloat(sfxEl.value));
      });
    }
    return wrap;
  }

  // Inject the control into a container (id string or element).
  function mountControl(core, container, doc) {
    doc = doc || root.document;
    if (!doc) return null;
    var el = buildControl(core, doc);
    if (!el) return null;
    var target =
      typeof container === "string" ? doc.getElementById(container) : container;
    if (target) target.appendChild(el);
    return el;
  }

  // ---- Boot (one-line integration) --------------------------------------
  function boot(opts) {
    opts = opts || {};
    var core = root.SeasAudio;
    var manifestUrl = opts.manifestUrl || "audio/audio-manifest.json";

    function assemble(manifest) {
      var music = root.SeasMusic ? new root.SeasMusic(core, manifest) : null;
      var sfx = root.SeasSfx ? new root.SeasSfx(core, manifest) : null;
      if (music) music.init();
      var sys = {
        core: core,
        music: music,
        sfx: sfx,
        manifest: manifest,
        // convenience passthroughs
        setScene: function (s) { if (music) music.setScene(s); },
        playSfx: function (n) { if (sfx) sfx.play(n); },
        unlock: function () { return core ? core.unlock() : Promise.resolve(false); },
        mountSettings: function (container, doc) {
          return mountControl(core, container, doc);
        },
        buildSettings: function (doc) { return buildControl(core, doc); }
      };
      root.Seas = root.Seas || sys;
      return sys;
    }

    // Fetch manifest (browser). If fetch unavailable or fails, use inline fallback.
    if (typeof root.fetch === "function") {
      return root
        .fetch(manifestUrl)
        .then(function (r) {
          if (!r.ok) throw new Error("manifest HTTP " + r.status);
          return r.json();
        })
        .then(assemble)
        .catch(function (e) {
          console.warn("[SeasAudioSystem] manifest load failed, using minimal fallback:", e);
          return assemble({ basePath: "music/", scenes: {}, sfx: {} });
        });
    }
    return Promise.resolve(assemble(opts.manifest || { basePath: "music/", scenes: {}, sfx: {} }));
  }

  var api = {
    boot: boot,
    buildControl: buildControl,
    mountControl: mountControl
  };
  root.SeasAudioSystem = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : this);
