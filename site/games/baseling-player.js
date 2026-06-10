// Baseling Player — shared character module for MfT Arcade games.
// The single module every arcade game includes to: connect a wallet, pull the
// player's baseling roster (with forever-vault stats), let them pick a character,
// remember the choice, and expose gameplay multipliers + the chosen sprite.
//
// Depends on: baseling-sprites.js (BaselingSprites) for rendering. No other deps.
// ES5-compatible style to match baseling-sprites.js / nft-loader.js.
//
// IMPORTANT: games stay fully playable WITHOUT a wallet. If there's no wallet or no
// baselings, the player gets the default starter "Wimmple" (all stats 10). The NFT
// gate (NftLoader.gate()) is a SEPARATE concern and is unchanged.
//
// Public API:
//   BaselingPlayer.init(opts)            -> Promise, sets up wallet + roster (auto if connected)
//   BaselingPlayer.select(cb)            -> shows the character picker overlay; cb(entry) on pick
//   BaselingPlayer.getSelected()         -> the current roster entry (or Wimmple default)
//   BaselingPlayer.getStats()            -> {speed,stamina,power,luck,swim} (1-200)
//   BaselingPlayer.getMults(opts)        -> bounded gameplay multipliers (see below)
//   BaselingPlayer.sprite(size, frame)   -> canvas of the selected baseling at `size`
//   BaselingPlayer.getRoster()           -> array of roster entries (may be just [Wimmple])
//   BaselingPlayer.hasWallet()           -> bool
//   BaselingPlayer.connect()             -> Promise<address|null>

(function () {
"use strict";

// ---- Config (reuses nft-loader.js patterns; no new deps) ----
var BASE_CHAIN_ID = 8453;
var BASELING_NFT = "0xFCb825491490284189C75fD330Fd08Df5E9217b9";
var ROSTER_API = '/api/baseling/arcade-roster';
var ROSTER_TIMEOUT_MS = 4000;
var LS_KEY = 'mft_arcade_baseling'; // localStorage: last selected {tokenId, charId}

// Stat metadata — canonical labels/colors/icons (from Baselings gameplay.js RACE_STAT_META).
var STAT_META = {
  speed:   { label: 'SPD', color: '#fbbf24', icon: '⚡' },
  stamina: { label: 'STA', color: '#4ade80', icon: '♥' },
  power:   { label: 'PWR', color: '#ef4444', icon: '✦' },
  luck:    { label: 'LCK', color: '#c084fc', icon: '★' },
  swim:    { label: 'SWM', color: '#60a5fa', icon: '∼' }
};
var STAT_KEYS = ['speed', 'stamina', 'power', 'luck', 'swim'];

var RARITY_COLORS = {
  common: '#aaa', uncommon: '#5b5', rare: '#55f', epic: '#a5f', legendary: '#fa5', mythic: '#f55'
};

var STAGE_NAMES = ['Egg', 'Baby', 'Teen', 'Adult', 'Legend', 'Mega'];

// Default starter — playable with no wallet. Wimmple has a local webp sprite in the
// pet game; in the arcade it falls back to BaselingSprites' own fallback if the
// charId 'wimmple' doesn't resolve to an image. All stats 10 per spec.
function makeWimmple() {
  return {
    tokenId: null,
    charId: 'wimmple',
    charName: 'Wimmple',
    colorVariant: null,
    sparkle: false,
    isGiant: false,
    rarity: 'common',
    stage: 1,
    alive: true,
    isDefault: true,
    stats:     { speed: 10, stamina: 10, power: 10, luck: 10, swim: 10 },
    baseStats: { speed: 10, stamina: 10, power: 10, luck: 10, swim: 10 }
  };
}

// ---- Internal state ----
var _state = {
  wallet: null,
  roster: [],          // array of entries (always includes at least Wimmple)
  selected: null,      // current entry
  ready: false,
  rosterError: null,   // last roster fetch error (visible, never swallowed)
  initPromise: null
};

// ---- Wallet (mirrors nft-loader.js connectWallet) ----
function connectWallet() {
  if (!window.ethereum) return Promise.resolve(null);
  return window.ethereum.request({ method: "eth_requestAccounts" })
    .then(function (accounts) {
      if (!accounts || !accounts.length) return null;
      _state.wallet = accounts[0];
      // Best-effort switch to Base; failure is logged, not fatal (reads use roster API).
      return window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + BASE_CHAIN_ID.toString(16) }]
      }).then(function () {
        return _state.wallet;
      }).catch(function (e) {
        if (e && e.code === 4902) {
          return window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x" + BASE_CHAIN_ID.toString(16),
              chainName: "Base",
              rpcUrls: ["https://mainnet.base.org"],
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              blockExplorerUrls: ["https://basescan.org"]
            }]
          }).then(function () { return _state.wallet; })
            .catch(function (e2) { console.warn('[baseling-player] add Base chain failed:', e2.message); return _state.wallet; });
        }
        console.warn('[baseling-player] chain switch failed:', e && e.message);
        return _state.wallet; // still connected, just maybe wrong chain for writes
      });
    })
    .catch(function (e) {
      console.warn('[baseling-player] wallet connect failed:', e && e.message);
      return null;
    });
}

// Silently detect an already-authorized wallet (no popup) for auto-init.
function detectWallet() {
  if (!window.ethereum) return Promise.resolve(null);
  return window.ethereum.request({ method: "eth_accounts" })
    .then(function (accounts) {
      if (accounts && accounts.length) { _state.wallet = accounts[0]; return _state.wallet; }
      return null;
    })
    .catch(function (e) {
      console.warn('[baseling-player] eth_accounts failed:', e && e.message);
      return null;
    });
}

// ---- Roster fetch ----
// Handles BOTH the new v2 shape ({found, source, roster:[...]}) and the older
// shape ({baselings:[...]}). Returns an array (possibly empty). Never swallows
// errors silently — failures set _state.rosterError and are warned to console.
function fetchRoster(wallet) {
  if (!wallet) return Promise.resolve([]);
  var controller = ('AbortController' in window) ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, ROSTER_TIMEOUT_MS) : null;

  return fetch(ROSTER_API + '?wallet=' + encodeURIComponent(wallet), controller ? { signal: controller.signal } : {})
    .then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      // New shape: data.roster ; old shape: data.baselings
      var list = (data && data.roster) || (data && data.baselings) || [];
      if (!Array.isArray(list)) {
        throw new Error('roster payload was not an array');
      }
      return list.map(normalizeEntry).filter(function (e) { return e.alive !== false; });
    })
    .catch(function (e) {
      if (timer) clearTimeout(timer);
      _state.rosterError = e && e.message ? e.message : String(e);
      console.warn('[baseling-player] arcade-roster fetch failed:', _state.rosterError);
      return []; // caller falls back to Wimmple
    });
}

// Normalize a roster entry to a known shape, filling stats if the API gave the old
// (no-stats) shape. Default stats are all 10 (matches the API's own default block).
function normalizeEntry(b) {
  b = b || {};
  var stats = b.stats && typeof b.stats === 'object' ? b.stats : null;
  var baseStats = b.baseStats && typeof b.baseStats === 'object' ? b.baseStats : null;
  // If the old API shape (no stats), default everything to 10 so games still work.
  if (!stats) {
    stats = { speed: 10, stamina: 10, power: 10, luck: 10, swim: 10 };
  }
  if (!baseStats) baseStats = cloneStats(stats);
  // Coerce/clamp every stat key to a valid 1-200 integer.
  stats = sanitizeStats(stats);
  baseStats = sanitizeStats(baseStats);

  return {
    tokenId: (b.tokenId !== undefined ? b.tokenId : null),
    charId: b.charId || null,
    charName: b.charName || b.charId || 'Baseling',
    colorVariant: b.colorVariant || null,
    sparkle: !!b.sparkle,
    isGiant: !!b.isGiant,
    rarity: (b.rarity ? String(b.rarity).toLowerCase() : 'common'),
    stage: (typeof b.stage === 'number' ? b.stage : 1),
    alive: b.alive !== false,
    spriteUrl: b.spriteUrl || null,
    tokenFeeds: (b.tokenFeeds && typeof b.tokenFeeds === 'object') ? b.tokenFeeds : {},
    feedTier: b.feedTier || null,
    careScore: (typeof b.careScore === 'number' ? b.careScore : null),
    stats: stats,
    baseStats: baseStats,
    isDefault: false
  };
}

function cloneStats(s) {
  return { speed: s.speed, stamina: s.stamina, power: s.power, luck: s.luck, swim: s.swim };
}

function sanitizeStats(s) {
  var out = {};
  for (var i = 0; i < STAT_KEYS.length; i++) {
    var k = STAT_KEYS[i];
    var v = s[k];
    v = (typeof v === 'number' && isFinite(v)) ? v : 10;
    out[k] = Math.max(1, Math.min(200, Math.round(v)));
  }
  return out;
}

// Pre-load all sprites in the roster through BaselingSprites.
function preloadSprites() {
  if (!window.BaselingSprites) return;
  for (var i = 0; i < _state.roster.length; i++) {
    var e = _state.roster[i];
    if (e.charId) BaselingSprites.load(e.charId, e.colorVariant);
  }
}

// Restore the last-selected entry from localStorage, matching by tokenId then charId.
function restoreSelection() {
  var saved = null;
  try {
    var raw = window.localStorage ? window.localStorage.getItem(LS_KEY) : null;
    if (raw) saved = JSON.parse(raw);
  } catch (e) {
    console.warn('[baseling-player] could not read saved selection:', e && e.message);
  }
  if (!saved) return null;
  for (var i = 0; i < _state.roster.length; i++) {
    var e = _state.roster[i];
    if (saved.tokenId != null && e.tokenId != null && String(e.tokenId) === String(saved.tokenId)) return e;
  }
  for (var j = 0; j < _state.roster.length; j++) {
    if (saved.charId && _state.roster[j].charId === saved.charId) return _state.roster[j];
  }
  return null;
}

function persistSelection(entry) {
  if (!entry) return;
  try {
    if (window.localStorage) {
      window.localStorage.setItem(LS_KEY, JSON.stringify({ tokenId: entry.tokenId, charId: entry.charId }));
    }
  } catch (e) {
    console.warn('[baseling-player] could not persist selection:', e && e.message);
  }
}

// ---- Public API ----
var BaselingPlayer = {

  STAT_META: STAT_META,
  STAT_KEYS: STAT_KEYS,

  // Initialize. opts:
  //   { autoConnect: bool (default false — don't trigger a wallet popup),
  //     wallet: '0x..' (skip detection, use this address) }
  // Always resolves; on any failure the roster is [Wimmple] and games stay playable.
  init: function (opts) {
    opts = opts || {};
    if (_state.initPromise) return _state.initPromise;

    var self = this;
    _state.initPromise = Promise.resolve()
      .then(function () {
        if (opts.wallet) { _state.wallet = opts.wallet; return _state.wallet; }
        if (opts.autoConnect) return connectWallet();
        return detectWallet(); // silent — no popup
      })
      .then(function (wallet) {
        if (!wallet) return [];
        return fetchRoster(wallet);
      })
      .then(function (list) {
        // Always include Wimmple as a fallback/option so there's never an empty roster.
        var roster = list.slice();
        roster.push(makeWimmple());
        _state.roster = roster;
        preloadSprites();

        // Pick selection: saved -> first real baseling -> Wimmple.
        var restored = restoreSelection();
        _state.selected = restored || (list.length > 0 ? roster[0] : roster[roster.length - 1]);
        _state.ready = true;
        return self;
      });

    return _state.initPromise;
  },

  // Trigger an explicit wallet connect (popup) and refresh the roster.
  connect: function () {
    var self = this;
    return connectWallet().then(function (wallet) {
      if (!wallet) return null;
      return fetchRoster(wallet).then(function (list) {
        var roster = list.slice();
        roster.push(makeWimmple());
        _state.roster = roster;
        preloadSprites();
        var restored = restoreSelection();
        _state.selected = restored || (list.length > 0 ? roster[0] : roster[roster.length - 1]);
        _state.ready = true;
        return wallet;
      });
    });
  },

  hasWallet: function () { return !!_state.wallet; },
  isReady: function () { return _state.ready; },
  getRoster: function () { return _state.roster.slice(); },
  getRosterError: function () { return _state.rosterError; },

  // The currently selected entry. Falls back to Wimmple if init hasn't run.
  getSelected: function () {
    return _state.selected || makeWimmple();
  },

  // Programmatically set the selection by tokenId or charId. Returns the entry or null.
  setSelected: function (idOrCharId) {
    for (var i = 0; i < _state.roster.length; i++) {
      var e = _state.roster[i];
      if ((e.tokenId != null && String(e.tokenId) === String(idOrCharId)) || e.charId === idOrCharId) {
        _state.selected = e;
        persistSelection(e);
        return e;
      }
    }
    return null;
  },

  // Raw stats of the selected character, 1-200.
  getStats: function () {
    var sel = this.getSelected();
    return cloneStats(sel.stats);
  },

  // Bounded gameplay multipliers derived from stats.
  //   moveSpeed <- speed, health <- stamina, damage <- power, luck <- luck, swim <- swim
  // Formula: 1 + (stat - 50) / 125, then clamped.
  //   Single-player default clamp: 0.8 .. 1.6
  //   Wager/PvP modes: pass { pvp: true } to clamp 0.95 .. 1.1 (keeps matches fair).
  // opts: { pvp: bool, min: number, max: number } (min/max override the clamp)
  getMults: function (opts) {
    opts = opts || {};
    var lo = (typeof opts.min === 'number') ? opts.min : (opts.pvp ? 0.95 : 0.8);
    var hi = (typeof opts.max === 'number') ? opts.max : (opts.pvp ? 1.10 : 1.6);
    var s = this.getStats();
    function mult(stat) {
      var m = 1 + (stat - 50) / 125;
      return Math.max(lo, Math.min(hi, m));
    }
    return {
      moveSpeed: mult(s.speed),
      health:    mult(s.stamina),
      damage:    mult(s.power),
      luck:      mult(s.luck),
      swim:      mult(s.swim)
    };
  },

  // Canvas of the selected baseling at `size` px. `frame` is the animation clock
  // (pass a frame counter for idle bob / sparkle / rainbow). Returns null if the
  // sprite isn't loaded yet (caller can retry next frame).
  sprite: function (size, frame) {
    var sel = this.getSelected();
    if (!sel.charId || !window.BaselingSprites) return null;
    if (!BaselingSprites.isLoaded(sel.charId)) {
      BaselingSprites.load(sel.charId, sel.colorVariant);
      return null;
    }
    // Use the idle animation; frame drives the bob/sparkle/rainbow phase.
    var fi = Math.floor((frame || 0) / 10);
    return BaselingSprites.frame(sel.charId, sel.colorVariant, 'idle', fi, size || 48);
  },

  // Draw the selected baseling directly to a ctx (convenience wrapper over draw()).
  // x,y = center; size = diameter; opts passed through to BaselingSprites.draw
  // (anim/frameIndex/flipX/alpha/frame).
  draw: function (ctx, x, y, size, opts) {
    var sel = this.getSelected();
    if (!sel.charId || !window.BaselingSprites) return false;
    if (!BaselingSprites.isLoaded(sel.charId)) {
      BaselingSprites.load(sel.charId, sel.colorVariant);
      return false;
    }
    return BaselingSprites.draw(ctx, sel.charId, sel.colorVariant, sel.sparkle, x, y, size, opts || {});
  },

  // Show the character-select overlay (DOM). cb(entry) fires when the player picks.
  // If init() hasn't run yet it runs first (silent detection). Always shows at least
  // Wimmple so the player can start without a wallet.
  select: function (cb) {
    var self = this;
    var run = _state.ready ? Promise.resolve(this) : this.init();
    run.then(function () { self._buildPicker(cb); });
  },

  // ---- Picker overlay (DOM, pixel-art cards) ----
  _buildPicker: function (cb) {
    var self = this;
    var roster = _state.roster;

    var overlay = document.createElement('div');
    overlay.id = 'baseling-player-picker';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(8,11,23,0.95);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:flex-start;' +
      'font-family:monospace;overflow:auto;padding:24px 12px;';

    var title = document.createElement('div');
    title.textContent = 'CHOOSE YOUR BASELING';
    title.style.cssText = 'color:#0052FF;font-size:1.2rem;font-weight:900;letter-spacing:0.12em;margin-bottom:4px;text-align:center;';
    overlay.appendChild(title);

    var sub = document.createElement('div');
    if (_state.wallet) {
      var real = roster.filter(function (e) { return !e.isDefault; }).length;
      sub.textContent = real > 0
        ? (real + ' baseling' + (real === 1 ? '' : 's') + ' in your wallet — better-fed pets play stronger')
        : 'No baselings found in this wallet — playing as Wimmple';
    } else {
      sub.textContent = 'No wallet connected — playing as Wimmple. Connect to use your baselings.';
    }
    sub.style.cssText = 'color:#9fb0c8;font-size:0.62rem;letter-spacing:0.06em;margin-bottom:14px;text-align:center;max-width:340px;';
    overlay.appendChild(sub);

    // Optional connect button when no wallet
    if (!_state.wallet && window.ethereum) {
      var connectBtn = document.createElement('button');
      connectBtn.textContent = 'CONNECT WALLET';
      connectBtn.style.cssText = 'margin-bottom:14px;padding:8px 18px;border-radius:8px;border:2px solid #0052FF;' +
        'background:rgba(0,82,255,0.12);color:#cfe0ff;font-family:monospace;font-weight:900;font-size:0.7rem;cursor:pointer;letter-spacing:0.1em;';
      connectBtn.onclick = function () {
        connectBtn.textContent = 'CONNECTING...';
        connectBtn.disabled = true;
        self.connect().then(function (w) {
          overlay.remove();
          if (w) self._buildPicker(cb); else self._buildPicker(cb);
        });
      };
      overlay.appendChild(connectBtn);
    }

    var grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:720px;';
    overlay.appendChild(grid);

    // Build a card per roster entry
    var cards = [];
    for (var i = 0; i < roster.length; i++) {
      (function (entry) {
        var card = self._buildCard(entry, function () {
          _state.selected = entry;
          persistSelection(entry);
          // Visual confirm then close
          for (var c = 0; c < cards.length; c++) cards[c].style.outline = 'none';
          card.style.outline = '3px solid #fff';
          setTimeout(function () {
            overlay.style.transition = 'opacity 0.2s';
            overlay.style.opacity = '0';
            setTimeout(function () {
              overlay.remove();
              stopAnim();
              if (cb) cb(entry);
            }, 200);
          }, 180);
        });
        cards.push(card);
        grid.appendChild(card);
      })(roster[i]);
    }

    document.body.appendChild(overlay);

    // Animate the sprite canvases on the cards (idle bob).
    var animFrame = 0;
    var rafId = null;
    function tick() {
      animFrame++;
      for (var i = 0; i < cards.length; i++) {
        var fn = cards[i]._drawSprite;
        if (fn) fn(animFrame);
      }
      rafId = requestAnimationFrame(tick);
    }
    function stopAnim() { if (rafId) cancelAnimationFrame(rafId); }
    rafId = requestAnimationFrame(tick);

    // Block keys while open so the game underneath doesn't react
    function blockKeys(e) { e.stopPropagation(); }
    overlay.addEventListener('keydown', blockKeys, true);
  },

  // Build one pixel-art character card. Returns the card element with a
  // `_drawSprite(frame)` method the picker calls each animation tick.
  _buildCard: function (entry, onPick) {
    var rColor = RARITY_COLORS[entry.rarity] || '#aaa';
    var card = document.createElement('div');
    card.style.cssText = 'width:140px;border-radius:12px;border:2px solid ' + rColor + '55;' +
      'background:linear-gradient(180deg, rgba(19,24,38,0.95), rgba(11,14,23,0.95));' +
      'padding:10px 8px;cursor:pointer;text-align:center;transition:transform 0.12s, border-color 0.12s;';
    card.onmouseenter = function () { card.style.transform = 'translateY(-3px)'; card.style.borderColor = rColor; };
    card.onmouseleave = function () { card.style.transform = 'none'; card.style.borderColor = rColor + '55'; };
    card.onclick = onPick;

    // Sprite canvas (pixelated)
    var spriteWrap = document.createElement('div');
    spriteWrap.style.cssText = 'height:72px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;';
    var canvas = document.createElement('canvas');
    canvas.width = 72; canvas.height = 72;
    canvas.style.cssText = 'width:72px;height:72px;image-rendering:pixelated;';
    var cx = canvas.getContext('2d');
    spriteWrap.appendChild(canvas);
    card.appendChild(spriteWrap);

    // Draw function: renders the baseling (or loads then draws). Falls back to an
    // egg glyph if the sprite never resolves, so the card is never blank.
    var fellBack = false;
    card._drawSprite = function (frame) {
      cx.clearRect(0, 0, 72, 72);
      if (entry.charId && window.BaselingSprites) {
        if (BaselingSprites.isLoaded(entry.charId)) {
          var drawn = BaselingSprites.draw(cx, entry.charId, entry.colorVariant, entry.sparkle,
            36, 38, 60, { anim: 'idle', frame: frame });
          if (drawn) { fellBack = false; return; }
        } else {
          BaselingSprites.load(entry.charId, entry.colorVariant);
        }
      }
      // fallback glyph
      fellBack = true;
      cx.font = '40px monospace';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillStyle = rColor;
      cx.fillText('🥚', 36, 40);
    };

    // Name
    var name = document.createElement('div');
    name.textContent = entry.charName + (entry.tokenId != null ? (' #' + entry.tokenId) : '');
    name.style.cssText = 'color:#fff;font-size:0.62rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    card.appendChild(name);

    // Stage + rarity badge row
    var badges = document.createElement('div');
    badges.style.cssText = 'display:flex;gap:4px;justify-content:center;margin:3px 0 6px;flex-wrap:wrap;';
    var stageBadge = document.createElement('span');
    stageBadge.textContent = (STAGE_NAMES[entry.stage] || ('S' + entry.stage)).toUpperCase();
    stageBadge.style.cssText = 'font-size:0.5rem;color:#9fb0c8;border:1px solid #2a3650;border-radius:4px;padding:1px 5px;letter-spacing:0.05em;';
    badges.appendChild(stageBadge);
    var rarBadge = document.createElement('span');
    rarBadge.textContent = entry.rarity.toUpperCase();
    rarBadge.style.cssText = 'font-size:0.5rem;color:' + rColor + ';border:1px solid ' + rColor + '55;border-radius:4px;padding:1px 5px;letter-spacing:0.05em;';
    badges.appendChild(rarBadge);
    if (entry.isGiant) {
      var giantBadge = document.createElement('span');
      giantBadge.textContent = 'GIANT';
      giantBadge.style.cssText = 'font-size:0.5rem;color:#fbbf24;border:1px solid #fbbf2455;border-radius:4px;padding:1px 5px;';
      badges.appendChild(giantBadge);
    }
    card.appendChild(badges);

    // Stat bars
    var statsWrap = document.createElement('div');
    statsWrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
    for (var i = 0; i < STAT_KEYS.length; i++) {
      var key = STAT_KEYS[i];
      var meta = STAT_META[key];
      var val = entry.stats[key];
      var pct = Math.max(2, Math.min(100, val / 2)); // 200 = full bar

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;';

      var lbl = document.createElement('span');
      lbl.textContent = meta.label;
      lbl.style.cssText = 'color:' + meta.color + ';font-size:0.5rem;width:22px;text-align:left;flex:none;';
      row.appendChild(lbl);

      var track = document.createElement('div');
      track.style.cssText = 'flex:1;height:6px;background:#1a2030;border-radius:3px;overflow:hidden;';
      var fill = document.createElement('div');
      fill.style.cssText = 'height:100%;width:' + pct + '%;background:' + meta.color + ';border-radius:3px;';
      track.appendChild(fill);
      row.appendChild(track);

      var num = document.createElement('span');
      num.textContent = String(val);
      num.style.cssText = 'color:#cbd5e1;font-size:0.5rem;width:22px;text-align:right;flex:none;';
      row.appendChild(num);

      statsWrap.appendChild(row);
    }
    card.appendChild(statsWrap);

    return card;
  }
};

window.BaselingPlayer = BaselingPlayer;

})();
